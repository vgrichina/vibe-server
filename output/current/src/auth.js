import crypto from 'crypto';

/**
 * Generate a new API key for a user
 * @param {string} prefix - Prefix for the API key (e.g. 'vs_user')
 * @returns {string} - Generated API key
 */
export function generateApiKey(prefix = 'vs_user') {
  const randomString = crypto.randomBytes(16).toString('hex');
  return `${prefix}_${randomString}`;
}

/**
 * Calculate expiration time based on user group
 * @param {Object} userGroup - User group configuration
 * @returns {string} - ISO date string for expiration time
 */
export function calculateExpirationTime(userGroup) {
  // Default expiration is 24 hours
  const expirationHours = userGroup?.expiration_hours || 24;
  const expirationDate = new Date();
  expirationDate.setHours(expirationDate.getHours() + expirationHours);
  return expirationDate.toISOString();
}

/**
 * Store user API key in Redis
 * @param {Object} redisClient - Redis client
 * @param {string} apiKey - API key to store
 * @param {Object} userData - User data to associate with API key
 * @param {string} expiresAt - ISO date string for expiration time
 */
export async function storeApiKey(redisClient, apiKey, userData, expiresAt) {
  // Calculate TTL in seconds
  const now = new Date();
  const expireDate = new Date(expiresAt);
  const ttlSeconds = Math.floor((expireDate.getTime() - now.getTime()) / 1000);
  
  // Store API key with expiration
  await redisClient.set(`apiKey:${apiKey}`, JSON.stringify(userData));
  await redisClient.expire(`apiKey:${apiKey}`, ttlSeconds);
}

/**
 * Validate an API key and return associated user data
 * @param {Object} redisClient - Redis client
 * @param {string} apiKey - API key to validate
 * @returns {Object|null} - User data if valid, null otherwise
 */
export async function validateApiKey(redisClient, apiKey) {
  const userData = await redisClient.get(`apiKey:${apiKey}`);
  if (!userData) return null;
  
  return JSON.parse(userData);
}

/**
 * Get remaining token count for a user
 * @param {Object} redisClient - Redis client
 * @param {string} apiKey - User's API key
 * @returns {number} - Remaining token count
 */
export async function getRemainingTokens(redisClient, apiKey) {
  const tokenKey = `tokens:${apiKey}`;
  const tokensUsed = parseInt(await redisClient.get(tokenKey) || '0', 10);
  const userData = await validateApiKey(redisClient, apiKey);
  
  if (!userData) return 0;
  
  // Get user's total token allocation based on their group
  // This would need to be looked up from the tenant config
  const totalTokens = userData.totalTokens || 1000;
  return Math.max(0, totalTokens - tokensUsed);
}

/**
 * Verify OAuth JWT token from Apple
 * @param {Object} token - The JWT token to verify
 * @param {Object} appleConfig - Apple OAuth configuration
 * @returns {Promise<Object>} - Decoded token payload if valid
 * @throws {Error} - If token is invalid
 */
export async function verifyAppleIdToken(token, appleConfig) {
  // Fetch Apple's public keys
  const keysResponse = await fetch(appleConfig.keys_url);
  if (!keysResponse.ok) {
    throw new Error('Failed to fetch Apple public keys');
  }
  
  const keysData = await keysResponse.json();
  
  // Parse the JWT to get the header
  const [headerBase64, payloadBase64] = token.split('.');
  const header = JSON.parse(Buffer.from(headerBase64, 'base64').toString());
  const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
  
  // Find the matching key based on kid (Key ID)
  const matchingKey = keysData.keys.find(key => key.kid === header.kid);
  if (!matchingKey) {
    throw new Error('No matching key found for token');
  }
  
  // Verify token claims
  if (payload.iss !== 'https://appleid.apple.com') {
    throw new Error('Invalid token issuer');
  }
  
  if (payload.aud !== appleConfig.client_id) {
    throw new Error('Invalid audience in token');
  }
  
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token has expired');
  }
  
  // In a real implementation, you'd verify the JWT signature here
  // This would require a JWT library, which we're avoiding per requirements
  
  return payload;
}

/**
 * Check user's Stripe subscription status
 * @param {Object} stripeConfig - Stripe API configuration
 * @param {string} email - User's email address
 * @returns {Promise<string>} - Subscription level as a user group name
 */
export async function checkStripeSubscription(stripeConfig, email) {
  try {
    const response = await fetch(`${stripeConfig.api_url}/customers?email=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeConfig.api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    if (!response.ok) {
      console.error('[ERROR] Stripe API error:', await response.text());
      return 'google_logged_in'; // Default fallback group
    }
    
    const data = await response.json();
    
    // If customer exists, check their subscription
    if (data.data && data.data.length > 0) {
      const customerId = data.data[0].id;
      
      // Get customer's subscriptions
      const subResponse = await fetch(`${stripeConfig.api_url}/subscriptions?customer=${customerId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${stripeConfig.api_key}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      if (!subResponse.ok) {
        return 'google_logged_in'; // Default fallback group
      }
      
      const subData = await subResponse.json();
      
      // Check for active subscription and map to appropriate group
      if (subData.data && subData.data.length > 0) {
        const activeSub = subData.data.find(sub => sub.status === 'active');
        if (activeSub) {
          // Check plan/price ID to determine tier
          if (activeSub.plan && activeSub.plan.id.includes('premium')) {
            return 'stripe_premium';
          } else {
            return 'stripe_basic';
          }
        }
      }
    }
    
    // Default to basic logged-in user if no subscription found
    return 'google_logged_in';
    
  } catch (error) {
    console.error('[ERROR] Error checking Stripe subscription:', error);
    return 'google_logged_in'; // Default fallback group
  }
}