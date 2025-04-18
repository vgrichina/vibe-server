import { v4 as uuidv4 } from 'uuid';

// Initialize a new realtime session
export const initializeRealtime = (redisClient) => async (ctx) => {
  // Get tenant ID from header
  const tenantId = ctx.headers['x-tenant-id'];
  
  if (!tenantId) {
    ctx.status = 400;
    ctx.body = { error: "X-Tenant-Id header is required" };
    return;
  }

  // Validate request body
  const { backend, systemPrompt, tools, ttsService, cache_key } = ctx.request.body;
  
  if (!backend) {
    ctx.status = 400;
    ctx.body = { error: "backend parameter is required" };
    return;
  }
  
  // Validate backend type
  const validBackends = ['openai_realtime', 'ultravox'];
  if (!validBackends.includes(backend)) {
    ctx.status = 400;
    ctx.body = { error: `Invalid backend. Must be one of: ${validBackends.join(', ')}` };
    return;
  }
  
  // Check token balance
  const userKey = `tenant:${tenantId}:tokens`;
  const remainingTokens = await redisClient.get(userKey) || 0;
  
  if (remainingTokens < 1) {
    ctx.status = 429;
    ctx.body = { error: "Insufficient tokens" };
    return;
  }
  
  // Generate session ID
  const sessionUuid = uuidv4();
  const sessionId = `tenant:${tenantId}:session:${sessionUuid}`;
  
  // Store session state in Redis
  const sessionState = {
    backend,
    systemPrompt: systemPrompt || "You are a helpful assistant",
    tools: tools || [],
    ttsService: ttsService || "openai",
    cache_key: cache_key || "",
    tokensUsed: 0
  };
  
  await redisClient.set(`session:${tenantId}:${sessionId}:state`, JSON.stringify(sessionState));
  
  // Create empty history
  await redisClient.del(`session:${tenantId}:${sessionId}:history`);
  
  console.log(`[INFO] New realtime session: ${sessionId}`);
  
  // Return session info
  ctx.status = 200;
  ctx.body = {
    sessionId,
    wsUrl: `ws://${ctx.request.host}/v1/realtime/stream?sid=${sessionId}`,
    remainingTokens: parseInt(remainingTokens)
  };
};

// Handle WebSocket connections for realtime streaming
export const handleWebSocketStream = (redisClient) => async (ctx, next) => {
  // Only process if it's a WebSocket request
  if (!ctx.ws) {
    return await next();
  }
  
  // Get session ID from query params
  const { sid } = ctx.query;
  
  if (!sid) {
    ctx.status = 400;
    ctx.body = { error: "sid query parameter is required" };
    return;
  }
  
  // Validate session ID format and extract tenant ID
  const sidParts = sid.split(':');
  if (sidParts.length !== 4 || sidParts[0] !== 'tenant' || sidParts[2] !== 'session') {
    ctx.status = 400;
    ctx.body = { error: "Invalid session ID format" };
    return;
  }
  
  const tenantId = sidParts[1];
  
  // Check if session exists
  const sessionKey = `session:${tenantId}:${sid}:state`;
  const sessionData = await redisClient.get(sessionKey);
  
  if (!sessionData) {
    ctx.status = 404;
    ctx.body = { error: "Session not found" };
    return;
  }
  
  // Establish WebSocket connection
  const ws = await ctx.ws();
  
  // Handle client messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const { inputType, data: inputData } = data;
      
      if (!inputType || !inputData) {
        ws.send(JSON.stringify({
          error: "Invalid message format. Expected: {inputType: 'text'|'audio', data: string}"
        }));
        return;
      }
      
      // Add message to history
      await redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
        role: 'user',
        type: inputType,
        content: inputData,
        timestamp: Date.now()
      }));
      
      // Mock response based on input type
      if (inputType === 'text') {
        // Echo text response
        ws.send(JSON.stringify({
          outputType: 'text',
          data: `Hello back! You said: ${inputData}`
        }));
        
      } else if (inputType === 'audio') {
        // Echo audio response (in a real implementation, this would be TTS)
        ws.send(JSON.stringify({
          outputType: 'audio',
          data: inputData.substring(0, 50) + '...' // Just echo part of the base64 data
        }));
      } else {
        ws.send(JSON.stringify({
          error: "Invalid inputType. Must be 'text' or 'audio'"
        }));
        return;
      }
      
      // Add assistant response to history
      await redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
        role: 'assistant',
        type: inputType,
        content: inputType === 'text' ? `Hello back! You said: ${inputData}` : 'audio-response',
        timestamp: Date.now()
      }));
      
      // Update tokens used (mock increment)
      const sessionState = JSON.parse(await redisClient.get(sessionKey));
      sessionState.tokensUsed += 10;
      await redisClient.set(sessionKey, JSON.stringify(sessionState));
      
    } catch (error) {
      console.error(`[ERROR] WebSocket message handling failed: ${error}`);
      ws.send(JSON.stringify({
        error: "Failed to process message"
      }));
    }
  });
  
  // Handle WebSocket close
  ws.on('close', () => {
    console.log(`[INFO] WebSocket closed for session: ${sid}`);
  });
  
  ws.on('error', (error) => {
    console.error(`[ERROR] WebSocket error for session ${sid}: ${error}`);
  });
};