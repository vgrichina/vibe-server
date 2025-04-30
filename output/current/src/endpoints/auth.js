import { 
  generateApiKey, 
  storeUserData, 
  validateGoogleToken, 
  validateAppleToken,
  checkStripeSubscription,
  validateApiKey,
  getRemainingTokens,
  getExpirationTime
} from '../auth.js';

import { v4 as uuidv4 } from 'uuid';

// PROMPT: OAuth Authentication Endpoint: `POST /:tenantId/auth/login`
export const loginWithOAuth = (redisClient) => async (ctx) => {
  const { tenantId, tenantConfig } = ctx.state;
  const { provider, token } = ctx.request.body;

  if (!provider || !token) {
    ctx.status = 400;
    ctx.body = { error: "Provider and token are required" };
    return;
  }

  // PROMPT: Support multiple OAuth providers with same endpoint structure
  if (provider === 'google') {
    // PROMPT: Fetch tenant config from Redis; use tenant's `auth.google_oauth.client_id` and `client_secret`
    const googleConfig = tenantConfig.auth.google_oauth;
    
    if (!googleConfig) {
      ctx.status = 400;
      ctx.body = { error: "Google OAuth not configured for this tenant" };
      return;
    }
    
    // PROMPT: Default to standard provider endpoints if not specified
    const userInfoUrl = googleConfig.userinfo_url || 'https://www.googleapis.com/oauth2/v1/userinfo';
    
    // PROMPT: Validate the OAuth token with Google's API
    const validation = await validateGoogleToken(
      token, 
      googleConfig.client_id, 
      googleConfig.client_secret,
      userInfoUrl
    );

    if (!validation.valid) {
      ctx.status = 401;
      ctx.body = { error: validation.error };
      return;
    }

    // PROMPT: Retrieve user information (email, name, profile)
    const { email, name, picture, id: googleId } = validation.data;
    
    // Check if user already exists
    const userKey = `tenant:${tenantId}:user:email:${email}`;
    let userId = await redisClient.get(userKey);

    if (!userId) {
      // Create new user
      userId = `user_${uuidv4()}`;
      await redisClient.set(userKey, userId);
      
      // Store user profile
      await redisClient.set(`user:${userId}`, JSON.stringify({
        id: userId,
        email,
        name,
        picture,
        googleId,
        createdAt: new Date().toISOString(),
        tenantId
      }));
    }

    // PROMPT: Subscription Check: On successful authentication, check user's subscription status
    const stripeConfig = tenantConfig.auth.stripe;
    const subscriptionData = await checkStripeSubscription(userId, email, stripeConfig);
    const userGroup = subscriptionData.group;
    
    // PROMPT: Generate API key with format `vs_user_[alphanumeric]`
    const apiKey = generateApiKey();
    
    // PROMPT: Set appropriate API key expiration based on user group (longer for paid users)
    const expires_at = getExpirationTime(userGroup);
    
    // PROMPT: Store in Redis: `apiKey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
    await storeUserData(redisClient, apiKey, {
      tenantId,
      userId,
      email,
      group: userGroup,
      expires_at
    });
    
    // PROMPT: Include remaining token count in authentication responses
    const remainingTokens = await getRemainingTokens(redisClient, apiKey, userGroup, tenantConfig);
    
    // PROMPT: Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login
    console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
    
    // PROMPT: Return API key and user information
    ctx.status = 200;
    ctx.body = {
      api_key: apiKey,
      expires_at,
      user: {
        id: userId,
        email,
        group: userGroup
      },
      remaining_tokens: remainingTokens
    };
  } 
  else if (provider === 'apple') {
    // PROMPT: Validate using tenant's `auth.apple_oauth.client_id` and `client_secret`
    const appleConfig = tenantConfig.auth.apple_oauth;
    
    if (!appleConfig) {
      ctx.status = 400;
      ctx.body = { error: "Apple OAuth not configured for this tenant" };
      return;
    }
    
    // PROMPT: Fetch Apple's public keys from `keys_url` endpoint
    const keysUrl = appleConfig.keys_url || 'https://appleid.apple.com/auth/keys';
    
    // PROMPT: Apple-specific validation procedures
    const validation = await validateAppleToken(
      token,
      appleConfig.client_id,
      appleConfig.client_secret,
      keysUrl
    );

    if (!validation.valid) {
      ctx.status = 401;
      ctx.body = { error: validation.error };
      return;
    }
    
    // PROMPT: Extract user info from identity token claims
    const { sub: appleId, email, email_verified } = validation.data;
    
    // Handle optional user data that might be included only on first login
    const firstName = validation.data.given_name || '';
    const lastName = validation.data.family_name || '';
    const name = firstName && lastName ? `${firstName} ${lastName}` : '';
    
    // PROMPT: Handle Apple's private email relay service
    const isPrivateEmail = validation.data.is_private_email;
    
    // Check if user already exists
    const userKey = `tenant:${tenantId}:user:email:${email}`;
    let userId = await redisClient.get(userKey);

    if (!userId) {
      // Create new user
      userId = `user_${uuidv4()}`;
      await redisClient.set(userKey, userId);
      
      // Store user profile
      await redisClient.set(`user:${userId}`, JSON.stringify({
        id: userId,
        email,
        name,
        appleId,
        isPrivateEmail,
        createdAt: new Date().toISOString(),
        tenantId,
        firstName,
        lastName
      }));
    } else if (firstName && lastName) {
      // Update existing user with additional name info if provided
      const existingUser = JSON.parse(await redisClient.get(`user:${userId}`));
      existingUser.firstName = firstName;
      existingUser.lastName = lastName;
      existingUser.name = name;
      
      await redisClient.set(`user:${userId}`, JSON.stringify(existingUser));
    }

    // Check subscription status
    const stripeConfig = tenantConfig.auth.stripe;
    const subscriptionData = await checkStripeSubscription(userId, email, stripeConfig);
    const userGroup = subscriptionData.group;
    
    const apiKey = generateApiKey();
    const expires_at = getExpirationTime(userGroup);
    
    await storeUserData(redisClient, apiKey, {
      tenantId,
      userId,
      email,
      group: userGroup,
      expires_at
    });
    
    const remainingTokens = await getRemainingTokens(redisClient, apiKey, userGroup, tenantConfig);
    
    console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
    
    ctx.status = 200;
    ctx.body = {
      api_key: apiKey,
      expires_at,
      user: {
        id: userId,
        email,
        group: userGroup
      },
      remaining_tokens: remainingTokens
    };
  } 
  else {
    ctx.status = 400;
    ctx.body = { error: `Unsupported provider: ${provider}` };
  }
};

// PROMPT: API Key Refresh: `POST /:tenantId/auth/refresh`
export const refreshApiKey = (redisClient) => async (ctx) => {
  const { tenantId, tenantConfig } = ctx.state;
  const authHeader = ctx.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: "Authentication required" };
    return;
  }
  
  const currentApiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // PROMPT: Validate current API key from Redis
  const validation = await validateApiKey(redisClient, currentApiKey);
  if (!validation.valid) {
    ctx.status = 401;
    ctx.body = { error: validation.error };
    return;
  }
  
  const userData = validation.user;
  
  // Verify this API key belongs to the requested tenant
  if (userData.tenantId !== tenantId) {
    ctx.status = 403;
    ctx.body = { error: "API key does not belong to this tenant" };
    return;
  }
  
  // PROMPT: Generate new API key with extended expiration
  const newApiKey = generateApiKey();
  const expires_at = getExpirationTime(userData.group);
  
  // PROMPT: Update Redis with new key information
  await storeUserData(redisClient, newApiKey, {
    ...userData,
    expires_at
  });
  
  // Invalidate old API key (optional - alternative is to let it expire naturally)
  await redisClient.del(`apiKey:${currentApiKey}`);
  
  // PROMPT: Include remaining token count in authentication responses
  const remainingTokens = await getRemainingTokens(redisClient, newApiKey, userData.group, tenantConfig);
  
  ctx.status = 200;
  ctx.body = {
    api_key: newApiKey,
    expires_at,
    remaining_tokens: remainingTokens
  };
};