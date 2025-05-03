import { 
  generateApiKey, 
  validateGoogleToken, 
  validateAppleToken,
  checkStripeSubscription,
  getExpirationTime,
  createUserId,
  createUserRecord,
  createApiKeyRecord
} from '../auth.js';

// PROMPT: Auth Endpoint: `POST /:tenantId/auth/login`
export async function loginHandler(ctx) {
  const { tenantId } = ctx.params;
  const { provider, token } = ctx.request.body;
  
  if (!provider || !token) {
    ctx.status = 400;
    ctx.body = { error: 'Provider and token are required' };
    return;
  }
  
  // PROMPT: Fetch tenant config from Redis; use tenant's `auth.google_oauth.client_id` and `client_secret`
  const tenantConfig = ctx.state.tenantConfig;
  if (!tenantConfig.auth || !tenantConfig.auth[`${provider}_oauth`]) {
    ctx.status = 400;
    ctx.body = { error: `${provider} OAuth is not configured for this tenant` };
    return;
  }
  
  const providerConfig = tenantConfig.auth[`${provider}_oauth`];
  
  // Validate rate limiting
  const clientIp = ctx.request.ip;
  const rateLimitKey = `rate_limit:auth:${clientIp}:${tenantId}`;
  
  const currentAttempts = await ctx.app.redisClient.incr(rateLimitKey);
  if (currentAttempts === 1) {
    await ctx.app.redisClient.expire(rateLimitKey, 60); // 1 minute window
  }
  
  // PROMPT: Implement rate limiting for authentication attempts
  if (currentAttempts > 10) { // 10 attempts per minute
    ctx.status = 429;
    ctx.body = { error: 'Too many authentication attempts. Please try again later.' };
    return;
  }
  
  let validationResult;
  
  // PROMPT: Support multiple OAuth providers with same endpoint structure
  // PROMPT: Determine provider from request body `provider` field
  if (provider === 'google') {
    const userInfoUrl = providerConfig.userinfo_url || 'https://www.googleapis.com/oauth2/v1/userinfo';
    validationResult = await validateGoogleToken(token, providerConfig.client_id, userInfoUrl);
  } else if (provider === 'apple') {
    const keysUrl = providerConfig.keys_url || 'https://appleid.apple.com/auth/keys';
    validationResult = await validateAppleToken(token, providerConfig.client_id, keysUrl);
  } else {
    ctx.status = 400;
    ctx.body = { error: `Unsupported provider: ${provider}` };
    return;
  }
  
  if (!validationResult.valid) {
    ctx.status = 401;
    ctx.body = { error: validationResult.error || 'Invalid token' };
    return;
  }
  
  const userInfo = validationResult.userInfo;
  if (!userInfo.email) {
    ctx.status = 400;
    ctx.body = { error: 'Email is required' };
    return;
  }
  
  // PROMPT: Check if user already exists by email
  const emailKey = `email:${tenantId}:${userInfo.email}`;
  let userId = await ctx.app.redisClient.get(emailKey);
  let isNewUser = false;
  
  // If no user exists with this email, create a new user
  if (!userId) {
    isNewUser = true;
    userId = createUserId(provider, userInfo.id);
    await ctx.app.redisClient.set(emailKey, userId);
  }
  
  // Start with default group
  let userGroup = `${provider}_logged_in`;
  
  // PROMPT: On successful authentication, check user's subscription status with Stripe
  if (tenantConfig.auth.stripe && tenantConfig.auth.stripe.api_key) {
    const subscriptionResult = await checkStripeSubscription(userInfo.email, tenantConfig.auth.stripe);
    
    if (subscriptionResult.status === 'active') {
      userGroup = subscriptionResult.tier; // Either 'stripe_basic' or 'stripe_premium'
      
      // Store subscription info with user
      userInfo.subscription = {
        id: subscriptionResult.subscription_id,
        customer_id: subscriptionResult.customer_id,
        tier: subscriptionResult.tier
      };
    }
  }
  
  // Get appropriate expiration time based on user group
  const expiresAt = getExpirationTime(userGroup);
  
  // PROMPT: Generate API key with format `vs_user_[alphanumeric]`
  const apiKey = generateApiKey();
  
  // Create or update user record
  const userRecord = createUserRecord(userInfo, userGroup, tenantId);
  await ctx.app.redisClient.set(`user:${userId}`, JSON.stringify(userRecord));
  
  // PROMPT: Store in Redis: `apiKey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
  const apiKeyRecord = createApiKeyRecord(userId, tenantId, userGroup, expiresAt);
  await ctx.app.redisClient.set(`apiKey:${apiKey}`, JSON.stringify(apiKeyRecord));
  
  // PROMPT: Track token usage per API key: `tokens:<api_key>` in Redis
  const tokenLimit = tenantConfig.user_groups[userGroup]?.tokens || 1000;
  await ctx.app.redisClient.set(`tokens:${apiKey}`, tokenLimit);
  
  // PROMPT: Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login
  console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
  
  // PROMPT: Return API key and user information
  ctx.status = 200;
  ctx.body = {
    api_key: apiKey,
    expires_at: expiresAt.toISOString(),
    user: {
      id: userId,
      email: userInfo.email,
      group: userGroup
    },
    remaining_tokens: tokenLimit
  };
}

// PROMPT: Refresh Endpoint: `POST /:tenantId/auth/refresh`
export async function refreshHandler(ctx) {
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
  const apiKeyInfo = await ctx.app.redisClient.get(`apiKey:${currentApiKey}`);
  if (!apiKeyInfo) {
    ctx.status = 401;
    ctx.body = { error: 'Invalid or expired API key' };
    return;
  }
  
  const apiKeyData = JSON.parse(apiKeyInfo);
  
  // Verify tenant ID matches
  if (apiKeyData.tenantId !== tenantId) {
    ctx.status = 403;
    ctx.body = { error: 'API key does not belong to this tenant' };
    return;
  }
  
  // Check if the key is expired
  if (new Date(apiKeyData.expires_at) < new Date()) {
    ctx.status = 401;
    ctx.body = { error: 'API key has expired' };
    return;
  }
  
  // Get user data
  const userData = await ctx.app.redisClient.get(`user:${apiKeyData.userId}`);
  if (!userData) {
    ctx.status = 404;
    ctx.body = { error: 'User not found' };
    return;
  }
  
  const user = JSON.parse(userData);
  
  // PROMPT: Generate new API key with extended expiration
  const newApiKey = generateApiKey();
  const newExpiresAt = getExpirationTime(apiKeyData.group);
  
  // PROMPT: Update Redis with new key information
  const newApiKeyData = {
    ...apiKeyData,
    expires_at: newExpiresAt.toISOString()
  };
  
  await ctx.app.redisClient.set(`apiKey:${newApiKey}`, JSON.stringify(newApiKeyData));
  
  // Get remaining tokens
  let remainingTokens = parseInt(await ctx.app.redisClient.get(`tokens:${currentApiKey}`)) || 0;
  await ctx.app.redisClient.set(`tokens:${newApiKey}`, remainingTokens);
  
  // Delete the old API key
  await ctx.app.redisClient.del(`apiKey:${currentApiKey}`);
  await ctx.app.redisClient.del(`tokens:${currentApiKey}`);
  
  // PROMPT: Return:
  ctx.status = 200;
  ctx.body = {
    api_key: newApiKey,
    expires_at: newExpiresAt.toISOString(),
    remaining_tokens: remainingTokens
  };
}

export default {
  loginHandler,
  refreshHandler
};