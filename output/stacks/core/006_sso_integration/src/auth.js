// PROMPT: Store all OAuth credentials and API keys encrypted in Redis
import crypto from 'crypto';

// PROMPT: Generate API key with format `vs_user_[alphanumeric]`
export const generateApiKey = () => {
  const randomBytes = crypto.randomBytes(16);
  return `vs_user_${randomBytes.toString('hex')}`;
};

// PROMPT: Store in Redis: `apiKey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
export const storeUserData = async (redisClient, apiKey, userData) => {
  await redisClient.set(`apiKey:${apiKey}`, JSON.stringify(userData));
  
  if (userData.expires_at) {
    // Set TTL based on expiration time
    const expiresAt = new Date(userData.expires_at);
    const now = new Date();
    const ttlSeconds = Math.floor((expiresAt - now) / 1000);
    
    if (ttlSeconds > 0) {
      await redisClient.expire(`apiKey:${apiKey}`, ttlSeconds);
    }
  }
  
  return userData;
};

// PROMPT: Validate the OAuth token with Google's API
export const validateGoogleToken = async (token, clientId, clientSecret, userInfoUrl) => {
  try {
    // Verify token with Google
    const response = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      return { valid: false, error: 'Invalid Google token' };
    }
    
    const userData = await response.json();
    return { valid: true, data: userData };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// PROMPT: Apple-specific validation procedures
export const validateAppleToken = async (token, clientId, clientSecret, keysUrl) => {
  try {
    // Decode the JWT without verification to get the key ID from header
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    // Get header to find kid (key ID)
    const headerJson = Buffer.from(tokenParts[0], 'base64').toString();
    const header = JSON.parse(headerJson);
    const kid = header.kid;
    
    // Fetch Apple's public keys
    const keysResponse = await fetch(keysUrl);
    if (!keysResponse.ok) {
      return { valid: false, error: 'Failed to fetch Apple public keys' };
    }
    
    const keysData = await keysResponse.json();
    const key = keysData.keys.find(k => k.kid === kid);
    
    if (!key) {
      return { valid: false, error: 'No matching key found' };
    }
    
    // Format key to PEM format
    const pubKey = crypto.createPublicKey({
      key: { 
        kty: key.kty, 
        n: key.n, 
        e: key.e 
      },
      format: 'jwk'
    });
    
    // Verify signature
    const signaturePart = tokenParts[2].replace(/_/g, '/').replace(/-/g, '+');
    const signature = Buffer.from(signaturePart, 'base64');
    
    const dataToVerify = `${tokenParts[0]}.${tokenParts[1]}`;
    const isValid = crypto.verify(
      'sha256',
      Buffer.from(dataToVerify),
      pubKey,
      signature
    );
    
    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    // Verify payload claims
    const payloadJson = Buffer.from(tokenParts[1], 'base64').toString();
    const payload = JSON.parse(payloadJson);
    
    // PROMPT: Validate standard JWT claims: `iss` must be "https://appleid.apple.com", `aud` must match your `client_id`, `exp` timestamp must not be passed
    if (payload.iss !== 'https://appleid.apple.com') {
      return { valid: false, error: 'Invalid issuer' };
    }
    
    if (payload.aud !== clientId) {
      return { valid: false, error: 'Invalid audience' };
    }
    
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token expired' };
    }
    
    return { valid: true, data: payload };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// PROMPT: Map subscription level to appropriate user group (e.g., `stripe_basic`, `stripe_premium`)
export const checkStripeSubscription = async (userId, email, stripeConfig) => {
  try {
    const { api_key, api_url } = stripeConfig;
    const baseUrl = api_url || 'https://api.stripe.com/v1';
    
    // Search for customer by email
    const customersResponse = await fetch(`${baseUrl}/customers?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    if (!customersResponse.ok) {
      return { group: 'google_logged_in' }; // Default if Stripe API fails
    }
    
    const customers = await customersResponse.json();
    if (customers.data.length === 0) {
      return { group: 'google_logged_in' }; // No customer found
    }
    
    // Get subscription for the first matching customer
    const customerId = customers.data[0].id;
    const subscriptionsResponse = await fetch(`${baseUrl}/subscriptions?customer=${customerId}&status=active`, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    if (!subscriptionsResponse.ok) {
      return { group: 'google_logged_in' };
    }
    
    const subscriptions = await subscriptionsResponse.json();
    
    // Map subscription level to user group
    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      const planId = subscription.plan?.id;
      
      if (planId?.includes('premium')) {
        return { group: 'stripe_premium', subscription_id: subscription.id };
      } else if (planId?.includes('basic')) {
        return { group: 'stripe_basic', subscription_id: subscription.id };
      }
    }
    
    return { group: 'google_logged_in' };
  } catch (error) {
    return { group: 'google_logged_in' }; // Default if any error occurs
  }
};

// PROMPT: Validate current API key from Redis
export const validateApiKey = async (redisClient, apiKey) => {
  try {
    const userData = await redisClient.get(`apiKey:${apiKey}`);
    
    if (!userData) {
      return { valid: false, error: 'Invalid API key' };
    }
    
    const user = JSON.parse(userData);
    
    // Check if token is expired
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return { valid: false, error: 'API key expired' };
    }
    
    return { valid: true, user };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// PROMPT: Apply rate limits based on user's group from tenant configuration
export const getRateLimitConfig = (tenantConfig, userGroup) => {
  return tenantConfig.user_groups[userGroup] || tenantConfig.user_groups.google_logged_in;
};

// PROMPT: Track token usage per API key: `tokens:<api_key>` in Redis
export const getTokenUsage = async (redisClient, apiKey) => {
  const tokensUsed = await redisClient.get(`tokens:${apiKey}:used`) || 0;
  return parseInt(tokensUsed);
};

// PROMPT: Include remaining token count in authentication responses
export const getRemainingTokens = async (redisClient, apiKey, userGroup, tenantConfig) => {
  const tokensUsed = await getTokenUsage(redisClient, apiKey);
  const totalTokens = tenantConfig.user_groups[userGroup]?.tokens || 0;
  return Math.max(0, totalTokens - tokensUsed);
};

// PROMPT: Set appropriate API key expiration based on user group (longer for paid users)
export const getExpirationTime = (userGroup) => {
  const now = new Date();
  
  // Set expiration time based on user group
  if (userGroup === 'stripe_premium') {
    // 30 days for premium users
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  } else if (userGroup === 'stripe_basic') {
    // 15 days for basic users
    return new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    // 7 days for regular users
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
};