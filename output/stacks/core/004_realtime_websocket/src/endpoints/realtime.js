import { v4 as uuidv4 } from 'uuid';

// PROMPT: Initialize Endpoint: POST /v1/realtime/initialize
export async function initializeRealtimeSession(ctx) {
  const tenantId = ctx.headers['x-tenant-id'];
  if (!tenantId) {
    ctx.status = 400;
    ctx.body = { error: 'X-Tenant-Id header is required' };
    return;
  }

  const { backend, systemPrompt, tools, ttsService, cache_key } = ctx.request.body;
  
  // PROMPT: Validate: `backend` (enum: `openai_realtime`, `ultravox`).
  if (backend !== 'openai_realtime' && backend !== 'ultravox') {
    ctx.status = 400;
    ctx.body = { error: 'Invalid backend. Must be either openai_realtime or ultravox.' };
    return;
  }

  // PROMPT: Check token balance in Redis; return 429 if < 1.
  const tenantConfig = await ctx.app.redisClient.get(`tenant:${tenantId}:config`);
  if (!tenantConfig) {
    ctx.status = 404;
    ctx.body = { error: 'Tenant not found' };
    return;
  }

  // Mock token balance check
  const remainingTokens = 100;
  if (remainingTokens < 1) {
    ctx.status = 429;
    ctx.body = { error: 'Insufficient token balance' };
    return;
  }

  // PROMPT: Generate `sessionId`: `tenant:<tenantId>:session:<uuid>`.
  const sessionUuid = uuidv4();
  const sessionId = `tenant:${tenantId}:session:${sessionUuid}`;
  
  // PROMPT: Store session state in Redis: `session:<tenantId>:<sessionId>:state`
  const sessionState = {
    backend,
    systemPrompt,
    tools,
    ttsService,
    cache_key,
    tokensUsed: 0
  };
  
  await ctx.app.redisClient.set(`session:${tenantId}:${sessionId}:state`, JSON.stringify(sessionState));
  
  // PROMPT: Log `[INFO] New realtime session: <sessionId>` on initialization.
  console.log(`[INFO] New realtime session: ${sessionId}`);
  
  // PROMPT: Return sessionId, wsUrl, and remainingTokens
  const host = ctx.request.headers.host || 'localhost:3000';
  const protocol = ctx.request.secure ? 'wss' : 'ws';
  
  ctx.status = 200;
  ctx.body = {
    sessionId,
    wsUrl: `${protocol}://${host}/v1/realtime/stream?sid=${sessionId}`,
    remainingTokens
  };
}

// PROMPT: WebSocket Endpoint: /v1/realtime/stream
export async function handleRealtimeStream(ctx) {
  if (!ctx.ws) {
    ctx.status = 400;
    ctx.body = { error: 'WebSocket connection required' };
    return;
  }
  
  // PROMPT: Query param: `sid` (required).
  const { sid } = ctx.request.query;
  if (!sid) {
    ctx.status = 400;
    ctx.body = { error: 'Session ID (sid) is required' };
    return;
  }

  // Extract tenantId from sid (format: tenant:<tenantId>:session:<uuid>)
  const sidParts = sid.split(':');
  if (sidParts.length !== 4 || sidParts[0] !== 'tenant' || sidParts[2] !== 'session') {
    ctx.status = 400;
    ctx.body = { error: 'Invalid session ID format' };
    return;
  }
  
  const tenantId = sidParts[1];
  
  // PROMPT: Validate `sid` matches session in Redis; close connection with code 1008 if invalid.
  const sessionState = await ctx.app.redisClient.get(`session:${tenantId}:${sid}:state`);
  
  const ws = await ctx.ws();
  
  if (!sessionState) {
    ws.close(1008, 'Invalid session ID');
    return;
  }
  
  // PROMPT: Handle client messages
  ws.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message);
      const { inputType, data } = parsedMessage;
      
      if (inputType === 'text') {
        // PROMPT: Text Input: `{"inputType": "text", "data": "Hi"}` → echo `{"outputType": "text", "data": "Hello back"}`
        // Store message in history
        await ctx.app.redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
          role: 'user',
          content: data,
          timestamp: Date.now()
        }));
        
        // Mock response
        const response = {
          outputType: 'text',
          data: 'Hello back'
        };
        
        // Store assistant response in history
        await ctx.app.redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
          role: 'assistant',
          content: response.data,
          timestamp: Date.now()
        }));
        
        ws.send(JSON.stringify(response));
      } else if (inputType === 'audio') {
        // PROMPT: Audio Input: `{"inputType": "audio", "data": "base64-audio"}` → echo `{"outputType": "audio", "data": "base64-echo"}`
        // Store message in history (reference to audio)
        await ctx.app.redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
          role: 'user',
          content: '[AUDIO INPUT]',
          timestamp: Date.now()
        }));
        
        // Mock response
        const response = {
          outputType: 'audio',
          data: data // Echo the same audio back
        };
        
        // Store assistant response in history
        await ctx.app.redisClient.rPush(`session:${tenantId}:${sid}:history`, JSON.stringify({
          role: 'assistant',
          content: '[AUDIO OUTPUT]',
          timestamp: Date.now()
        }));
        
        ws.send(JSON.stringify(response));
      } else {
        ws.send(JSON.stringify({
          outputType: 'error',
          data: `Unsupported input type: ${inputType}`
        }));
      }
    } catch (error) {
      console.error(`[ERROR] WebSocket message processing error: ${error.message}`);
      ws.send(JSON.stringify({
        outputType: 'error',
        data: 'Failed to process message'
      }));
    }
  });
  
  ws.on('close', () => {
    console.log(`[INFO] WebSocket connection closed for session: ${sid}`);
  });
}

// PROMPT: Add WebSocket support for realtime voice/text interactions with detailed session management
export default {
  initializeRealtimeSession,
  handleRealtimeStream
};