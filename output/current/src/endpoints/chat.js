import { PassThrough } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { 
  isCachingEnabled, 
  buildCacheKey, 
  getTextTTL,
  getCachedResponse,
  cacheResponse
} from '../cache.js';

// PROMPT: Add the `/:tenantId/v1/chat/completions` endpoint for text-based LLM interactions
export async function handleChatCompletions(ctx) {
  const { tenantId } = ctx.params;
  const { tenantConfig } = ctx.state;
  const jobId = uuidv4();
  
  console.log(`[INFO] Processing chat completion for ${tenantId}:${jobId}`);
  
  // PROMPT: If `cache_key` provided and caching enabled, check Redis for existing cache.
  const { cache_key } = ctx.request.body;
  if (cache_key && isCachingEnabled(tenantConfig)) {
    const fullCacheKey = buildCacheKey(tenantId, cache_key);
    const cachedResponse = await getCachedResponse(ctx.app.redisClient, fullCacheKey);
    
    if (cachedResponse) {
      // PROMPT: Log `[INFO] Cache hit for <cache_key>`
      console.log(`[INFO] Cache hit for ${cache_key}`);
      ctx.status = 200;
      ctx.body = cachedResponse;
      return;
    }
  }
  
  // PROMPT: Validate Bearer token with auth service
  const authHeader = ctx.request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: { message: 'Missing or invalid authorization token' } };
    return;
  }
  
  const apiKey = authHeader.split(' ')[1];
  const userId = await ctx.app.redisClient.get(`apiKey:${apiKey}`);
  
  if (!userId) {
    ctx.status = 401;
    ctx.body = { error: { message: 'Invalid authorization token' } };
    return;
  }
  
  // PROMPT: Fetch user data from Redis using user ID. This includes the user's token balance.
  const userDataStr = await ctx.app.redisClient.get(`user:${userId}`);
  if (!userDataStr) {
    ctx.status = 401;
    ctx.body = { error: { message: 'User not found' } };
    return;
  }
  
  const userData = JSON.parse(userDataStr);
  
  // PROMPT: If tokens < 1, return 429 with `{"error": "Insufficient tokens"}`
  if (userData.tokensLeft < 1) {
    ctx.status = 429;
    ctx.body = { error: { message: 'Insufficient tokens' } };
    return;
  }
  
  // PROMPT: Rate limit requests per user per tenant
  const userGroup = userData.userGroup;
  const rateLimitConfig = tenantConfig.user_groups[userGroup];
  
  if (!rateLimitConfig) {
    ctx.status = 403;
    ctx.body = { error: { message: 'User group not configured' } };
    return;
  }
  
  const windowSize = rateLimitConfig.rate_limit_window;
  const windowTimestamp = Math.floor(Date.now() / (windowSize * 1000)) * (windowSize * 1000);
  const rateLimitKey = `rate_limit:${userId}:${windowTimestamp}`;
  
  const currentRequests = await ctx.app.redisClient.incr(rateLimitKey);
  await ctx.app.redisClient.expire(rateLimitKey, windowSize * 2);
  
  if (currentRequests > rateLimitConfig.rate_limit) {
    ctx.status = 429;
    ctx.body = { error: { message: 'Rate limit exceeded' } };
    return;
  }
  
  // PROMPT: Validate body
  const { messages, model, stream = false } = ctx.request.body;
  
  if (!messages || !Array.isArray(messages)) {
    ctx.status = 400;
    ctx.body = { error: { message: 'Invalid messages format' } };
    return;
  }
  
  for (const message of messages) {
    if (!message.role || !message.content) {
      ctx.status = 400;
      ctx.body = { error: { message: 'Messages must have role and content fields' } };
      return;
    }
  }
  
  // PROMPT: Check provider API key in tenant config; return 403 if missing
  const providerConfig = tenantConfig.providers.text;
  const providerEndpoint = providerConfig.endpoints[providerConfig.default];
  
  if (!providerEndpoint || !providerEndpoint.api_key) {
    ctx.status = 403;
    ctx.body = { error: { message: 'Provider API key missing in tenant configuration' } };
    return;
  }
  
  const modelToUse = model || providerEndpoint.default_model;
  const apiUrl = providerEndpoint.url;
  
  // PROMPT: Generate conversation ID if not provided
  const conversationId = ctx.request.body.conversation_id || `conv-${uuidv4()}`;
  
  // Prepare the request to the LLM provider
  const requestBody = {
    messages,
    model: modelToUse,
    stream,
  };
  
  // PROMPT: If `stream: true`
  if (stream) {
    ctx.set('Content-Type', 'text/event-stream');
    ctx.set('Cache-Control', 'no-cache');
    ctx.set('Connection', 'keep-alive');
    ctx.status = 200;
    
    const passThrough = new PassThrough();
    ctx.body = passThrough;
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerEndpoint.api_key}`
        },
        body: JSON.stringify(requestBody),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        passThrough.write(`data: ${JSON.stringify(errorData)}\n\n`);
        passThrough.end();
        return;
      }
      
      const reader = response.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
        passThrough.write(chunk);
      }
      
      passThrough.end();
    } catch (error) {
      passThrough.write(`data: ${JSON.stringify({ error: { message: 'Error connecting to provider' } })}\n\n`);
      passThrough.end();
    }
  } else {
    // PROMPT: If `stream: false`
    try {
      let responseData;
      
      // If this is a cache_key request but we had a cache miss, generate a mock response
      if (cache_key && isCachingEnabled(tenantConfig)) {
        // PROMPT: Cache miss: Generate mock response (`"Cached response"`), store in Redis with TTL from `text_ttl`, then return
        responseData = {
          id: `job-${jobId}`,
          choices: [{ text: "Cached response" }]
        };
        
        const fullCacheKey = buildCacheKey(tenantId, cache_key);
        const ttl = getTextTTL(tenantConfig);
        
        await cacheResponse(ctx.app.redisClient, fullCacheKey, responseData, ttl);
        // PROMPT: Log `[INFO] Cache miss, stored <cache_key>`
        console.log(`[INFO] Cache miss, stored ${cache_key}`);
      } else {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${providerEndpoint.api_key}`
          },
          body: JSON.stringify(requestBody),
        });
        
        responseData = await response.json();
        
        if (!response.ok) {
          ctx.status = response.status;
          ctx.body = responseData;
          return;
        }
        
        // Cache the successful response if caching is enabled and cache_key provided
        if (cache_key && isCachingEnabled(tenantConfig)) {
          const fullCacheKey = buildCacheKey(tenantId, cache_key);
          const ttl = getTextTTL(tenantConfig);
          
          await cacheResponse(ctx.app.redisClient, fullCacheKey, responseData, ttl);
          console.log(`[INFO] Stored response in cache ${cache_key}`);
        }
      }
      
      // PROMPT: Pass through the response from the provider, don't remove any fields
      ctx.status = 200;
      ctx.body = responseData;
    } catch (error) {
      ctx.status = 500;
      ctx.body = { error: { message: 'Error connecting to provider' } };
    }
  }
  
  // Update user token balance (decrement by 1 for this simple implementation)
  userData.tokensLeft -= 1;
  await ctx.app.redisClient.set(`user:${userId}`, JSON.stringify(userData));
}