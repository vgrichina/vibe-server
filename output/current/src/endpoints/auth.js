import { v4 as uuidv4 } from 'uuid';
import { 
  generateApiKey, 
  validateGoogleToken, 
  validateAppleToken,
  checkStripeSubscription,
  encryptSensitiveData,
  getTokenBalance,
  getRateLimits,
  checkAuthRateLimit,
  getExpirationTimestamp,
  handlePrivateEmail,
  AuthError
} from '../auth.js';

// PROMPT: Auth Endpoint: `POST /:tenantId/auth/login`
export async function handleLogin(ctx) {
  try {
    const { tenantId } = ctx.params;
    const { provider, token } = ctx.request.body;
    
    if (!provider || !token) {
      ctx.status = 400;
      ctx.body = { error: 'Provider and token are required' };
      return;
    }
    
    // PROMPT: Implement rate limiting for authentication attempts
    const clientIp = ctx.request.ip;
    await checkAuthRateLimit(ctx.app.redisClient, tenantId, clientIp);
    
    // PROMPT: Fetch tenant config from Redis; use tenant's auth provider settings
    const tenantConfigStr = await ctx.app.redisClient.get(`tenant:${tenantId}:config`);
    if (!tenantConfigStr) {
      ctx.status = 404;
      ctx.body = { error: 'Tenant not found' };
      return;
    }
    
    const tenantConfig = JSON.parse(tenantConfigStr);
    
    let userData = null;
    let providerId = '';
    
    // PROMPT: Support multiple OAuth providers with same endpoint structure
    if (provider === 'google') {
      if (!tenantConfig.auth.google_oauth) {
        ctx.status = 400;
        ctx.body = { error: 'Google OAuth not configured for this tenant' };
        return;
      }
      
      const { client_id, client_secret, userinfo_url } = tenantConfig.auth.google_oauth;
      userData = await validateGoogleToken(token, client_id, userinfo_url || 'https://www.googleapis.com/oauth2/v1/userinfo');
      providerId = userData.sub || userData.id;
      
    } else if (provider === 'apple') {
      if (!tenantConfig.auth.apple_oauth) {
        ctx.status = 400;
        ctx.body = { error: 'Apple OAuth not configured for this tenant' };
        return;
      }
      
      const { client_id, keys_url } = tenantConfig.auth.apple_oauth;
      const payload = await validateAppleToken(
        token, 
        client_id, 
        keys_url || 'https://appleid.apple.com/auth/keys'
      );
      
      // PROMPT: Handle Apple's private email relay service
      const appleUserData = handlePrivateEmail(payload);
      userData = {
        email: appleUserData.email,
        name: [appleUserData.profile.firstName, appleUserData.profile.lastName].filter(Boolean).join(' '),
        sub: appleUserData.profile.sub
      };
      providerId = appleUserData.profile.sub;
      
    } else {
      ctx.status = 400;
      ctx.body = { error: 'Unsupported provider' };
      return;
    }
    
    // Get user email
    const userEmail = userData.email;
    if (!userEmail) {
      ctx.status = 400;
      ctx.body = { error: 'Email not provided by authentication provider' };
      return;
    }
    
    // PROMPT: Map all providers to same user account if emails match
    // Check if user already exists
    const userKey = `user:email:${tenantId}:${userEmail}`;
    let userId = await ctx.app.redisClient.get(userKey);
    
    if (!userId) {
      // New user, create record
      userId = `user_${uuidv4()}`;
      await ctx.app.redisClient.set(userKey, userId);
    }
    
    // Map this provider's ID to the user
    await ctx.app.redisClient.set(`user:provider:${tenantId}:${provider}:${providerId}`, userId);
    
    // PROMPT: Subscription Check: On successful authentication, check user's subscription status
    let userGroup = 'google_logged_in';
    if (tenantConfig.auth.stripe && tenantConfig.auth.stripe.api_key) {
      userGroup = await checkStripeSubscription(
        userEmail, 
        tenantConfig.auth.stripe
      );
    }
    
    // PROMPT: Generate API key with format `vs_user_[alphanumeric]`
    const apiKey = generateApiKey();
    const expiresAt = getExpirationTimestamp(userGroup);
    
    // Get rate limits for this user group
    const rateLimits = await getRateLimits(ctx.app.redisClient, tenantId, userGroup);
    
    // PROMPT: Store in Redis: `apiKey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
    const userDataToStore = {
      tenantId,
      userId,
      email: userEmail,
      group: userGroup,
      expires_at: expiresAt
    };
    
    // Store API key mapping
    await ctx.app.redisClient.set(`apiKey:${apiKey}`, JSON.stringify(userDataToStore));
    
    // Set expiration on the API key
    const expiryDate = new Date(expiresAt);
    const ttlSeconds = Math.floor((expiryDate.getTime() - Date.now()) / 1000);
    await ctx.app.redisClient.expire(`apiKey:${apiKey}`, ttlSeconds);
    
    // Initialize token balance
    await ctx.app.redisClient.set(`tokens:${apiKey}`, rateLimits.tokens);
    
    // PROMPT: Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login
    console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
    
    // PROMPT: Return API key, expiration, user info, and remaining tokens
    ctx.status = 200;
    ctx.body = {
      api_key: apiKey,
      expires_at: expiresAt,
      user: {
        id: userId,
        email: userEmail,
        group: userGroup
      },
      remaining_tokens: rateLimits.tokens
    };
    
  } catch (error) {
    if (error instanceof AuthError) {
      ctx.status = error.statusCode;
      ctx.body = { error: error.message };
    } else {
      console.error(`[ERROR] Authentication error: ${error.message}`);
      ctx.status = 500;
      ctx.body = { error: 'Authentication failed' };
    }
  }
}

// PROMPT: API Key Refresh
export async function handleRefresh(ctx) {
  try {
    const { tenantId } = ctx.params;
    
    // PROMPT: Header: `Authorization: Bearer vs_user_123456789abcdef`
    const authHeader = ctx.request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Missing or invalid authorization token' };
      return;
    }
    
    const currentApiKey = authHeader.split(' ')[1];
    
    // PROMPT: Validate current API key from Redis
    const userDataStr = await ctx.app.redisClient.get(`apiKey:${currentApiKey}`);
    if (!userDataStr) {
      ctx.status = 401;
      ctx.body = { error: 'Invalid API key' };
      return;
    }
    
    const userData = JSON.parse(userDataStr);
    
    // Verify tenant
    if (userData.tenantId !== tenantId) {
      ctx.status = 403;
      ctx.body = { error: 'API key does not belong to this tenant' };
      return;
    }
    
    // Check if the key has expired
    if (new Date(userData.expires_at) < new Date()) {
      ctx.status = 401;
      ctx.body = { error: 'API key has expired' };
      return;
    }
    
    // PROMPT: Generate new API key with extended expiration
    const newApiKey = generateApiKey();
    const userGroup = userData.group;
    const expiresAt = getExpirationTimestamp(userGroup);
    
    // PROMPT: Update Redis with new key information
    const updatedUserData = {
      ...userData,
      expires_at: expiresAt
    };
    
    // Get remaining tokens
    const remainingTokens = await getTokenBalance(ctx.app.redisClient, currentApiKey) || 0;
    
    // Store new API key
    await ctx.app.redisClient.set(`apiKey:${newApiKey}`, JSON.stringify(updatedUserData));
    
    // Copy token balance to new key
    await ctx.app.redisClient.set(`tokens:${newApiKey}`, remainingTokens);
    
    // Set expiration on the new API key
    const expiryDate = new Date(expiresAt);
    const ttlSeconds = Math.floor((expiryDate.getTime() - Date.now()) / 1000);
    await ctx.app.redisClient.expire(`apiKey:${newApiKey}`, ttlSeconds);
    
    // Delete the old API key
    await ctx.app.redisClient.del(`apiKey:${currentApiKey}`);
    await ctx.app.redisClient.del(`tokens:${currentApiKey}`);
    
    // PROMPT: Return new API key, expiration and remaining tokens
    ctx.status = 200;
    ctx.body = {
      api_key: newApiKey,
      expires_at: expiresAt,
      remaining_tokens: remainingTokens
    };
    
  } catch (error) {
    console.error(`[ERROR] Refresh error: ${error.message}`);
    ctx.status = 500;
    ctx.body = { error: 'Failed to refresh API key' };
  }
}

// Export endpoints
export default {
  handleLogin,
  handleRefresh
};