// Authentication middleware for API routes
export const authenticate = (redisClient) => async (ctx, next) => {
  const authHeader = ctx.headers.authorization;
  const { tenantId } = ctx.params;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: "Authentication required" };
    return;
  }

  const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  try {
    // Get API key data
    const apiKeyDataJson = await redisClient.get(`apikey:${apiKey}`);
    
    if (!apiKeyDataJson) {
      ctx.status = 401;
      ctx.body = { error: "Invalid or expired API key" };
      return;
    }
    
    const apiKeyData = JSON.parse(apiKeyDataJson);
    
    // Verify tenant ID match
    if (apiKeyData.tenantId !== tenantId) {
      ctx.status = 403;
      ctx.body = { error: "API key not valid for this tenant" };
      return;
    }
    
    // Check if API key has expired (shouldn't happen due to Redis TTL, but just in case)
    const expiresAt = new Date(apiKeyData.expires_at);
    if (expiresAt < new Date()) {
      ctx.status = 401;
      ctx.body = { error: "API key has expired" };
      return;
    }
    
    // Get remaining tokens
    const remainingTokens = await redisClient.get(`tokens:${apiKey}`) || 0;
    
    // If no tokens remaining
    if (parseInt(remainingTokens) <= 0) {
      ctx.status = 429;
      ctx.body = { error: "Token limit exceeded" };
      return;
    }
    
    // Attach user data to context state
    ctx.state.user = {
      userId: apiKeyData.userId,
      email: apiKeyData.email,
      group: apiKeyData.group,
      apiKey: apiKey,
      remainingTokens: parseInt(remainingTokens)
    };
    
    // Apply rate limiting
    const userGroup = apiKeyData.group;
    const rateLimitConfig = ctx.state.tenantConfig?.user_groups?.[userGroup];
    
    if (rateLimitConfig) {
      const rateLimitKey = `ratelimit:${tenantId}:${apiKeyData.userId}`;
      const currentRequests = await redisClient.get(rateLimitKey) || 0;
      
      if (parseInt(currentRequests) >= rateLimitConfig.rate_limit) {
        ctx.status = 429;
        ctx.body = { error: "Rate limit exceeded" };
        return;
      }
      
      // Increment rate limit counter
      await redisClient.incr(rateLimitKey);
      await redisClient.expire(rateLimitKey, rateLimitConfig.rate_limit_window);
    }
    
    await next();
    
    // Decrement token count after successful request
    // (This assumes all authenticated requests consume 1 token)
    const newTokenCount = parseInt(remainingTokens) - 1;
    await redisClient.set(`tokens:${apiKey}`, newTokenCount);
  } catch (error) {
    console.error(`[ERROR] Authentication error: ${error.message}`);
    ctx.status = 500;
    ctx.body = { error: "Authentication failed" };
  }
};

// CSRF protection middleware
export const csrfProtection = () => async (ctx, next) => {
  // For non-GET requests, check CSRF token
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.method !== 'OPTIONS') {
    const csrfToken = ctx.headers['x-csrf-token'];
    
    // In a real implementation, you'd validate the CSRF token against
    // a token previously issued to the client
    if (!csrfToken) {
      ctx.status = 403;
      ctx.body = { error: "CSRF token required" };
      return;
    }
    
    // Add real CSRF token validation here
  }
  
  await next();
};