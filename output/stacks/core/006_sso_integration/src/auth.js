import jwt from 'jsonwebtoken';

// Google OAuth authentication handler
export const googleAuth = (redisClient) => async (ctx) => {
  const { tenantId } = ctx.query;
  const { code } = ctx.request.body;

  // Validate required parameters
  if (!tenantId) {
    ctx.status = 400;
    ctx.body = { error: "tenantId is required as a query parameter" };
    return;
  }

  if (!code) {
    ctx.status = 400;
    ctx.body = { error: "code is required in request body" };
    return;
  }

  try {
    // Fetch tenant config from Redis
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    if (!configJson) {
      ctx.status = 400;
      ctx.body = { error: "Invalid tenant ID" };
      return;
    }

    const tenantConfig = JSON.parse(configJson);
    
    // Validate Google OAuth configuration exists
    if (!tenantConfig.auth?.google_oauth?.client_id || 
        !tenantConfig.auth?.google_oauth?.client_secret) {
      ctx.status = 400;
      ctx.body = { error: "Google OAuth not configured for this tenant" };
      return;
    }

    // For this simulation, we just check if the code exists (always "mock-google-code")
    if (code !== "mock-google-code") {
      ctx.status = 401;
      ctx.body = { error: "Invalid authorization code" };
      return;
    }

    // Create mock user data
    const userId = "user-123";
    const userGroup = "google_logged_in";
    
    // Generate mock JWT with 1 hour expiration
    const expirationTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const token = jwt.sign({
      tenantId,
      userId,
      group: userGroup,
      exp: expirationTime
    }, 'your-jwt-secret'); // In production, use a proper secret key
    
    // Log successful authentication
    console.log(`[INFO] User authenticated for ${tenantId}:${userId}`);
    
    // Return token
    ctx.status = 200;
    ctx.body = { token: `mock-jwt-${tenantId}-${userId}` };
    
  } catch (error) {
    console.error(`[ERROR] Google authentication error: ${error.message}`);
    ctx.status = 500;
    ctx.body = { error: "Authentication failed" };
  }
};