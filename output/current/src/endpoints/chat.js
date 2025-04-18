import { Readable } from 'stream';
import { getCacheConfig, getCachedResponse, cacheResponse } from '../cache.js';

// Validate the chat completion request body
const validateRequestBody = (body) => {
  // Check for required messages array
  if (!body.messages || !Array.isArray(body.messages)) {
    return { valid: false, error: "messages must be an array" };
  }

  // Validate each message has role and content
  for (const message of body.messages) {
    if (!message.role || !message.content) {
      return { valid: false, error: "each message must have role and content fields" };
    }
  }

  return { valid: true };
};

// Validate user authentication and extract user info
const validateAuth = async (ctx, redisClient) => {
  const authHeader = ctx.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: { message: "Authentication required" } };
    return null;
  }
  
  const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Get user ID from API key
  const userId = await redisClient.get(`apiKey:${apiKey}`);
  if (!userId) {
    ctx.status = 401;
    ctx.body = { error: { message: "Invalid API key" } };
    return null;
  }

  // Get user data
  const userDataJson = await redisClient.get(`user:${userId}`);
  if (!userDataJson) {
    ctx.status = 500;
    ctx.body = { error: { message: "User data not found" } };
    return null;
  }

  const userData = JSON.parse(userDataJson);
  
  // Check if user has access to this tenant
  if (userData.tenantId !== ctx.state.tenantId) {
    ctx.status = 403;
    ctx.body = { error: { message: "Unauthorized tenant access" } };
    return null;
  }

  return userData;
};

// Check if user has sufficient tokens
const checkUserTokens = async (ctx, userData) => {
  if (userData.tokensLeft < 1) {
    ctx.status = 429;
    ctx.body = { error: { message: "Insufficient tokens" } };
    return false;
  }
  return true;
};

// Create the streaming SSE response
const createStreamingResponse = (ctx, conversationId, provider, requestBody, providerEndpoint, apiKey) => {
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Connection', 'keep-alive');
  ctx.status = 200;

  const stream = new Readable({
    read() {}
  });

  ctx.body = stream;

  // Make streaming request to the provider
  (async () => {
    try {
      const providerResponse = await fetch(providerEndpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerEndpoint.api_key}`
        },
        body: JSON.stringify({
          ...requestBody,
          model: requestBody.model || providerEndpoint.default_model
        })
      });

      if (!providerResponse.ok) {
        const errorData = await providerResponse.json();
        stream.push(`data: ${JSON.stringify({ error: errorData })}\n\n`);
        stream.push(null);
        return;
      }

      const reader = providerResponse.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            // Forward the SSE data to client
            stream.push(`${line}\n\n`);
          } else if (line === 'data: [DONE]') {
            stream.push(`data: [DONE]\n\n`);
          }
        }
      }
      
      stream.push(null);
    } catch (error) {
      console.error(`[ERROR] Streaming error: ${error.message}`);
      stream.push(`data: ${JSON.stringify({ error: { message: "Streaming error occurred" } })}\n\n`);
      stream.push(null);
    }
  })();

  return stream;
};

// Handle non-streaming response
const handleNonStreamingResponse = async (ctx, conversationId, provider, requestBody, providerEndpoint) => {
  try {
    const providerResponse = await fetch(providerEndpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerEndpoint.api_key}`
      },
      body: JSON.stringify({
        ...requestBody,
        model: requestBody.model || providerEndpoint.default_model,
        stream: false
      })
    });

    if (!providerResponse.ok) {
      const errorData = await providerResponse.json();
      ctx.status = providerResponse.status;
      ctx.body = { error: { message: errorData.error?.message || "Provider error" } };
      return;
    }

    const responseData = await providerResponse.json();
    
    // Transform to OpenAI-compatible format if needed
    ctx.body = {
      id: conversationId,
      choices: [{
        message: {
          role: "assistant",
          content: responseData.content || responseData.choices?.[0]?.message?.content
        }
      }]
    };
    
  } catch (error) {
    console.error(`[ERROR] Non-streaming error: ${error.message}`);
    ctx.status = 500;
    ctx.body = { error: { message: "An error occurred processing your request" } };
  }
};

// Chat completions endpoint handler
export const chatCompletions = (redisClient) => async (ctx) => {
  const { tenantId, tenantConfig } = ctx.state;
  const jobId = Math.random().toString(36).substring(2, 10);
  console.log(`[INFO] Processing chat completion for ${tenantId}:${jobId}`);

  // Validate request body
  const requestBody = ctx.request.body;
  const validation = validateRequestBody(requestBody);
  if (!validation.valid) {
    ctx.status = 400;
    ctx.body = { error: { message: validation.error } };
    return;
  }

  // Check for cache_key in request
  const cacheKey = requestBody.cache_key;
  const cacheConfig = getCacheConfig(tenantConfig);

  // Check cache if caching is enabled and cache_key is provided
  if (cacheConfig.enabled && cacheKey && !requestBody.stream) {
    const cachedResponse = await getCachedResponse(redisClient, tenantId, cacheKey);
    if (cachedResponse) {
      ctx.status = 200;
      ctx.body = cachedResponse;
      return;
    }
  }

  // Authenticate user
  const userData = await validateAuth(ctx, redisClient);
  if (!userData) return;

  // Check user token balance
  const hasTokens = await checkUserTokens(ctx, userData);
  if (!hasTokens) return;

  // Apply rate limiting (based on tenant config and user group)
  const userGroup = userData.userGroup;
  const rateLimitConfig = tenantConfig.user_groups[userGroup];
  if (!rateLimitConfig) {
    ctx.status = 500;
    ctx.body = { error: { message: "Invalid user group configuration" } };
    return;
  }

  // Get rate limit key and check if exceeded
  const rateLimitKey = `ratelimit:${tenantId}:${userData.userId}`;
  const currentRequests = await redisClient.get(rateLimitKey) || 0;
  
  if (parseInt(currentRequests) >= rateLimitConfig.rate_limit) {
    ctx.status = 429;
    ctx.body = { error: { message: "Rate limit exceeded" } };
    return;
  }
  
  // Increment rate limit counter
  await redisClient.incr(rateLimitKey);
  await redisClient.expire(rateLimitKey, rateLimitConfig.rate_limit_window);

  // Get provider config
  const provider = tenantConfig.providers.text?.default || "openai";
  const providerEndpoint = tenantConfig.providers.text?.endpoints?.[provider];
  
  if (!providerEndpoint) {
    ctx.status = 500;
    ctx.body = { error: { message: "Provider configuration not found" } };
    return;
  }

  // Generate conversation ID if not provided
  const conversationId = requestBody.conversation_id || `conv-${Math.random().toString(36).substring(2, 10)}`;

  // Handle streaming vs non-streaming responses
  if (requestBody.stream === true) {
    createStreamingResponse(ctx, conversationId, provider, requestBody, providerEndpoint);
  } else {
    // Check if we need to store in cache after response
    const shouldCache = cacheConfig.enabled && cacheKey;
    
    if (shouldCache) {
      // For this implementation, we're using a mock cached response
      const response = {
        id: `job-${jobId}`,
        choices: [{
          message: {
            role: "assistant",
            content: "Cached response"
          }
        }]
      };
      
      // Store in cache with TTL from tenant config
      await cacheResponse(redisClient, tenantId, cacheKey, response, cacheConfig.text_ttl);
      
      // Return the cached response
      ctx.status = 200;
      ctx.body = response;
    } else {
      await handleNonStreamingResponse(ctx, conversationId, provider, requestBody, providerEndpoint);
    }
  }
};