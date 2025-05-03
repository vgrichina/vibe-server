import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// PROMPT: Generate API key with format `vs_user_[alphanumeric]`
export function generateApiKey(prefix = 'vs_user') {
  const randomString = crypto
    .randomBytes(16)
    .toString('hex')
    .substring(0, 16);
  
  return `${prefix}_${randomString}`;
}

// PROMPT: Validate the OAuth token with Google's API
export async function validateGoogleToken(token, clientId, userInfoUrl) {
  try {
    // PROMPT: Retrieve user information (email, name, profile)
    const response = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      return { valid: false, error: 'Invalid token' };
    }
    
    const userInfo = await response.json();
    
    // Verify the token is for the correct client ID
    if (userInfo.aud !== clientId) {
      return { valid: false, error: 'Token not issued for this client' };
    }
    
    return { 
      valid: true, 
      userInfo: {
        id: userInfo.sub || userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture
      } 
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// PROMPT: Validate using tenant's `auth.apple_oauth.client_id` and `client_secret`
export async function validateAppleToken(token, clientId, keysUrl) {
  try {
    // PROMPT: Fetch Apple's public keys from `keys_url` endpoint
    const keysResponse = await fetch(keysUrl);
    if (!keysResponse.ok) {
      return { valid: false, error: 'Failed to fetch Apple public keys' };
    }
    
    const keys = await keysResponse.json();
    
    // Parse the JWT without verification first to get the kid
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format' };
    }
    
    const header = JSON.parse(Buffer.from(tokenParts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    
    // PROMPT: Verify JWT signature using public key matching `kid` in header
    const key = keys.keys.find(k => k.kid === header.kid);
    if (!key) {
      return { valid: false, error: 'No matching key found for verification' };
    }
    
    // PROMPT: Validate standard JWT claims
    if (payload.iss !== 'https://appleid.apple.com') {
      return { valid: false, error: 'Invalid issuer' };
    }
    
    if (payload.aud !== clientId) {
      return { valid: false, error: 'Invalid audience' };
    }
    
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token expired' };
    }
    
    // PROMPT: Extract user info from identity token claims
    return {
      valid: true,
      userInfo: {
        id: payload.sub,
        email: payload.email,
        email_verified: payload.email_verified,
        is_private_email: payload.is_private_email,
        name: `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
        given_name: payload.given_name,
        family_name: payload.family_name
      }
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// PROMPT: Check user's subscription status with Stripe
export async function checkStripeSubscription(email, stripeConfig) {
  try {
    const { api_key, api_url = 'https://api.stripe.com/v1' } = stripeConfig;
    
    // Look up customer by email
    const customersResponse = await fetch(`${api_url}/customers?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    if (!customersResponse.ok) {
      return { status: 'error', error: 'Failed to query Stripe' };
    }
    
    const customers = await customersResponse.json();
    
    if (!customers.data.length) {
      return { status: 'none' };
    }
    
    // Get subscriptions for the customer
    const customerId = customers.data[0].id;
    const subscriptionsResponse = await fetch(`${api_url}/subscriptions?customer=${customerId}&status=active`, {
      headers: {
        'Authorization': `Bearer ${api_key}`
      }
    });
    
    if (!subscriptionsResponse.ok) {
      return { status: 'error', error: 'Failed to fetch subscriptions' };
    }
    
    const subscriptions = await subscriptionsResponse.json();
    
    if (!subscriptions.data.length) {
      return { status: 'none' };
    }
    
    // Determine tier from the subscription
    let tier = 'stripe_basic';
    const subscription = subscriptions.data[0];
    
    // Check if premium based on price/product
    const isPremium = subscription.items.data.some(item => {
      return item.price.lookup_key === 'premium' || 
             item.price.metadata.tier === 'premium' ||
             (item.price.product.metadata && item.price.product.metadata.tier === 'premium');
    });
    
    if (isPremium) {
      tier = 'stripe_premium';
    }
    
    return {
      status: 'active',
      tier,
      subscription_id: subscription.id,
      customer_id: customerId
    };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

// PROMPT: Set appropriate API key expiration based on user group (longer for paid users)
export function getExpirationTime(userGroup) {
  // Default expiration: 24 hours
  let expiryHours = 24;
  
  if (userGroup === 'stripe_basic') {
    expiryHours = 72; // 3 days
  } else if (userGroup === 'stripe_premium') {
    expiryHours = 168; // 7 days
  }
  
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);
  
  return expiresAt;
}

// PROMPT: Create a user ID for a new OAuth user
export function createUserId(provider, providerId) {
  return `${provider}_${providerId}`;
}

// PROMPT: Create user record to store in Redis
export function createUserRecord(userInfo, userGroup, tenantId) {
  return {
    id: userInfo.id,
    email: userInfo.email,
    name: userInfo.name,
    group: userGroup,
    tenantId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// PROMPT: Create API key record to store in Redis
export function createApiKeyRecord(userId, tenantId, userGroup, expiresAt) {
  return {
    tenantId,
    userId,
    group: userGroup,
    expires_at: expiresAt.toISOString()
  };
}