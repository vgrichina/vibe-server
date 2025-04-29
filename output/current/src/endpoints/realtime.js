import { v4 as uuidv4 } from 'uuid';

// Initialize a new realtime session
export const initializeRealtimeSession = (redisClient) => async (ctx) => {
  const tenantId = ctx.headers['x-tenant-id'];
  
  if (!tenantId) {
    ctx.status = 400;
    ctx.body = { error: "X-Tenant-Id header is required" };
    return;
  }

  // Parse request body
  const { backend, systemPrompt, tools, ttsService, cache_key } = ctx.request.body;

  // Validate backend type
  const validBackends = ['openai_realtime', 'ultravox'];
  if (!validBackends.includes(backend)) {
    ctx.status = 400;
    ctx.body = { error: "Invalid backend. Must be one of: " + validBackends.join(', ') };
    return;
  }

  // Check token balance
  const tokenBalance = await getTokenBalance(redisClient, tenantId);
  if (tokenBalance < 1) {
    ctx.status = 429;
    ctx.body = { error: "Insufficient token balance" };
    return;
  }

  // Generate session ID
  const sessionUuid = uuidv4();
  const sessionId = `tenant:${tenantId}:session:${sessionUuid}`;

  // Store session state in Redis
  const sessionState = {
    backend,
    systemPrompt,
    tools,
    ttsService,
    cache_key,
    tokensUsed: 0,
    createdAt: new Date().toISOString()
  };

  await redisClient.set(
    `session:${tenantId}:${sessionId}:state`,
    JSON.stringify(sessionState)
  );

  // Create empty history
  await redisClient.del(`session:${tenantId}:${sessionId}:history`);

  // Log new session creation
  console.log(`[INFO] New realtime session: ${sessionId}`);

  // Prepare response
  const { protocol, host } = ctx;
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  const wsUrl = `${wsProtocol}://${host}/v1/realtime/stream?sid=${sessionId}`;

  ctx.status = 200;
  ctx.body = {
    sessionId,
    wsUrl,
    remainingTokens: tokenBalance
  };
};

// Helper to get token balance (mocked for now)
async function getTokenBalance(redisClient, tenantId) {
  // This would be replaced with actual token balance lookup
  return 100;
}

// WebSocket handler for realtime streaming
export const handleRealtimeStream = (ws, redisClient) => async (ctx) => {
  if (!ctx.ws) {
    ctx.status = 400;
    ctx.body = { error: "This endpoint requires WebSocket connection" };
    return;
  }

  // Get the WebSocket connection
  const socket = await ctx.ws();

  // Get session ID from query parameters
  const { sid } = ctx.query;
  if (!sid) {
    socket.close(1008, "Missing session ID");
    return;
  }

  // Parse session ID to extract tenant ID
  const sessionParts = sid.split(':');
  if (sessionParts.length !== 4 || sessionParts[0] !== 'tenant' || sessionParts[2] !== 'session') {
    socket.close(1008, "Invalid session ID format");
    return;
  }
  
  const tenantId = sessionParts[1];
  
  // Validate the session exists in Redis
  const sessionStateKey = `session:${tenantId}:${sid}:state`;
  const sessionState = await redisClient.get(sessionStateKey);
  
  if (!sessionState) {
    socket.close(1008, "Invalid or expired session");
    return;
  }

  // Handle incoming messages
  socket.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      const { inputType, data } = parsedMessage;

      // Handle different input types
      if (inputType === 'text') {
        // Mock text response for now
        socket.send(JSON.stringify({
          outputType: 'text',
          data: `Hello back! You sent: ${data}`
        }));

        // Store message in history
        await storeMessageInHistory(redisClient, tenantId, sid, {
          role: 'user',
          content: data,
          timestamp: Date.now()
        });

        await storeMessageInHistory(redisClient, tenantId, sid, {
          role: 'assistant',
          content: `Hello back! You sent: ${data}`,
          timestamp: Date.now()
        });
      } 
      else if (inputType === 'audio') {
        // Mock audio response for now
        socket.send(JSON.stringify({
          outputType: 'audio',
          data: data  // Echo back the same audio data for now
        }));

        // Store message in history
        await storeMessageInHistory(redisClient, tenantId, sid, {
          role: 'user',
          content: '[audio input]',
          timestamp: Date.now()
        });

        await storeMessageInHistory(redisClient, tenantId, sid, {
          role: 'assistant',
          content: '[audio output]',
          timestamp: Date.now()
        });
      }
      else {
        socket.send(JSON.stringify({
          outputType: 'error',
          data: `Unsupported input type: ${inputType}`
        }));
      }
    } catch (error) {
      console.error(`[ERROR] WebSocket message handling error: ${error}`);
      socket.send(JSON.stringify({
        outputType: 'error',
        data: 'Failed to process message'
      }));
    }
  });

  // Handle socket close
  socket.on('close', () => {
    console.log(`[INFO] WebSocket closed for session: ${sid}`);
  });
};

// Helper to store messages in history
async function storeMessageInHistory(redisClient, tenantId, sessionId, message) {
  const historyKey = `session:${tenantId}:${sessionId}:history`;
  await redisClient.rPush(historyKey, JSON.stringify(message));
}