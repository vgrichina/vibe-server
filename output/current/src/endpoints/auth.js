import { 
  generateApiKey, 
  calculateExpirationTime, 
  storeApiKey, 
  validateApiKey,
  getRemainingTokens,
  verifyAppleIdToken,
  checkStripeSubscription
} from '../auth.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handle OAuth login from various providers
 */
export const oauthLogin = (redisClient) => async (ctx) => {
  const { tenantId, tenantConfig } = ctx.state;
  const { provider, token } = ctx.request.body;

  if (!provider || !token) {
    ctx.status = 400;
    ctx.body = { error: "Provider and token are required" };
    return;
  }

  try {
    let userData;
    let providerConfig;

    // Get provider-specific configuration
    switch (provider) {
      case 'google':
        providerConfig = tenantConfig.auth.google_oauth;
        userData = await handleGoogleAuth(token, providerConfig);
        break;
      case 'apple':
        providerConfig = tenantConfig.auth.apple_oauth;
        userData = await handleAppleAuth(token, providerConfig);
        break;
      default:
        ctx.status = 400;
        ctx.body = { error: `Unsupported provider: ${provider}` };
        return;
    }

    if (!userData) {
      ctx.status = 401;
      ctx.body = { error: "Authentication failed" };
      return;
    }

    // Check user's subscription status with Stripe if configured
    let userGroup = `${provider}_logged_in`;
    if (tenantConfig.auth.stripe && tenantConfig.auth.stripe.api_key) {
      userGroup = await checkStripeSubscription(
        tenantConfig.auth.stripe, 
        userData.email
      );
    }

    // Get token allocation for this user group
    const groupConfig = tenantConfig.user_groups[userGroup] || 
                        tenantConfig.user_groups.google_logged_in;
    
    // Generate API key and expiration
    const apiKey = generateApiKey();
    const expiresAt = calculateExpirationTime(groupConfig);
    
    // Create user ID if not already existing
    const userId = userData.id || `user_${uuidv4()}`;
    
    // Store user data in Redis
    const userDataToStore = {
      tenantId,
      userId,
      email: userData.email,
      name: userData.name,
      group: userGroup,
      expires_at: expiresAt,
      totalTokens: groupConfig.tokens
    };
    
    // Store API key with user data
    await storeApiKey(redisClient, apiKey, userDataToStore, expiresAt);
    
    console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
    
    // Return success response
    ctx.status = 200;
    ctx.body = {
      api_key: apiKey,
      expires_at: expiresAt,
      user: {
        id: userId,
        email: userData.email,
        group: userGroup
      },
      remaining_tokens: groupConfig.tokens
    };
  } catch (error) {
    console.error(`[ERROR] Authentication error for ${tenantId}: ${error}`);
    ctx.status = 401;
    ctx.body = { error: "Authentication failed: " + error.message };
  }
};

/**
 * Handle API key refresh
 */
export const refreshApiKey = (redisClient) => async (ctx) => {
  const { tenantId, tenantConfig } = ctx.state;
  const authHeader = ctx.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: "Authentication required" };
    return;
  }
  
  const currentApiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    // Validate the current API key
    const userData = await validateApiKey(redisClient, currentApiKey);
    
    if (!userData || userData.tenantId !== tenantId) {
      ctx.status = 401;
      ctx.body = { error: "Invalid API key" };
      return;
    }
    
    // Get remaining tokens
    const remainingTokens = await getRemainingTokens(redisClient, currentApiKey);
    
    // Generate new API key
    const newApiKey = generateApiKey();
    
    // Get user group config for expiration
    const groupConfig = tenantConfig.user_groups[userData.group];
    const expiresAt = calculateExpirationTime(groupConfig);
    
    // Store new API key
    await storeApiKey(redisClient, newApiKey, {
      ...userData,
      expires_at: expiresAt
    }, expiresAt);
    
    // Return success response
    ctx.status = 200;
    ctx.body = {
      api_key: newApiKey,
      expires_at: expiresAt,
      remaining_tokens: remainingTokens
    };
    
  } catch (error) {
    console.error(`[ERROR] API key refresh error for ${tenantId}: ${error}`);
    ctx.status = 500;
    ctx.body = { error: "Failed to refresh API key" };
  }
};

/**
 * Handle Google OAuth authentication
 * @param {string} token - Google OAuth token
 * @param {Object} config - Google OAuth configuration
 * @returns {Promise<Object>} - User data if authenticated
 */
async function handleGoogleAuth(token, config) {
  // Verify the token with Google
  const response = await fetch(config.userinfo_url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    console.error('[ERROR] Google authentication failed:', await response.text());
    return null;
  }
  
  // Get user data from Google
  const userData = await response.json();
  
  return {
    id: userData.id,
    email: userData.email,
    name: userData.name,
    picture: userData.picture
  };
}

/**
 * Handle Apple OAuth authentication
 * @param {string} token - Apple identity token (JWT)
 * @param {Object} config - Apple OAuth configuration
 * @returns {Promise<Object>} - User data if authenticated
 */
async function handleAppleAuth(token, config) {
  try {
    // Verify Apple ID token
    const payload = await verifyAppleIdToken(token, config);
    
    // Extract user information
    return {
      id: payload.sub,  // Apple User ID
      email: payload.email,
      name: payload.name || null, // May not be available after first login
      email_verified: payload.email_verified,
      is_private_email: payload.is_private_email
    };
  } catch (error) {
    console.error('[ERROR] Apple authentication failed:', error);
    throw error;
  }
}