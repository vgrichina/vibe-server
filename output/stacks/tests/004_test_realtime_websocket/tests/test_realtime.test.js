import { jest } from '@jest/globals';
import { WebSocket } from 'ws';
import { createClient } from 'redis';
import http from 'http';
import { createApp } from '../bin/server.js';

// PROMPT: Use Node's `ws` module for WebSocket testing.
describe('Realtime WebSocket API', () => {
  let server;
  let app;
  let redisClient;
  let port;
  let baseUrl;

  // Set up server and redis for tests
  beforeAll(async () => {
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redisClient.connect();
    
    // Ensure the default tenant config exists
    const existingConfig = await redisClient.get('tenant:abc:config');
    if (!existingConfig) {
      const defaultConfig = {
        providers: {
          realtime: {
            default: "openai_realtime",
            endpoints: {
              openai_realtime: {
                model: "gpt-4o-realtime-preview-2024-12-17",
                voice: "alloy",
                api_key: "sk-rt-abc123"
              }
            }
          }
        }
      };
      await redisClient.set('tenant:abc:config', JSON.stringify(defaultConfig));
    }
    
    app = await createApp({ redisClient });
    server = http.createServer(app.callback());
    server.listen();
    
    const address = server.address();
    port = address.port;
    baseUrl = `http://localhost:${port}`;
  });
  
  afterAll(async () => {
    // Clean up
    if (server && server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  // PROMPT: Initialize Session: Send `POST /v1/realtime/initialize` with `X-Tenant-Id: abc`, body as above.
  test('should initialize a realtime session', async () => {
    const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant.',
        tools: [],
        ttsService: 'openai',
        cache_key: 'test-cache'
      })
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.sessionId).toBeDefined();
    expect(data.sessionId).toMatch(/tenant:abc:session:[a-f0-9-]+/);
    expect(data.wsUrl).toBeDefined();
    expect(data.wsUrl).toContain(`ws://localhost:${port}/v1/realtime/stream?sid=`);
    expect(data.remainingTokens).toBeDefined();
    
    // PROMPT: Verify session state in Redis.
    const sessionState = await redisClient.get(`session:abc:${data.sessionId}:state`);
    expect(sessionState).toBeDefined();
    
    const parsedState = JSON.parse(sessionState);
    expect(parsedState.backend).toBe('openai_realtime');
    expect(parsedState.systemPrompt).toBe('You are a helpful assistant.');
    expect(parsedState.tokensUsed).toBe(0);
    
    return { sessionId: data.sessionId, wsUrl: data.wsUrl };
  });

  // PROMPT: WebSocket Text Echo: Connect to `wsUrl` with `sid`, send message, assert response
  test('should echo text messages through WebSocket', async () => {
    // Initialize session first
    const initResponse = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant.',
        tools: [],
        ttsService: 'openai',
        cache_key: 'test-cache'
      })
    });
    
    const initData = await initResponse.json();
    const wsUrl = initData.wsUrl;
    
    // Connect to the WebSocket
    const socket = new WebSocket(wsUrl);
    
    // Set up message handler and connection handler
    const connectedPromise = new Promise(resolve => {
      socket.on('open', resolve);
    });
    
    let receivedMessage = null;
    const messagePromise = new Promise(resolve => {
      socket.on('message', data => {
        receivedMessage = JSON.parse(data.toString());
        resolve();
      });
    });
    
    // Wait for connection to be established
    await connectedPromise;
    
    // PROMPT: Send `{"inputType": "text", "data": "Hi"}`.
    socket.send(JSON.stringify({
      inputType: 'text',
      data: 'Hi'
    }));
    
    // Wait for response
    await messagePromise;
    
    // PROMPT: Assert `{"outputType": "text", "data": "Hello back"}` received
    expect(receivedMessage).toEqual({
      outputType: 'text',
      data: 'Hello back'
    });
    
    // Verify message was stored in Redis history
    const history = await redisClient.lRange(`session:abc:${initData.sessionId}:history`, 0, -1);
    expect(history.length).toBeGreaterThanOrEqual(2);
    
    // Close the connection
    socket.close();
    
    return new Promise(resolve => {
      socket.on('close', resolve);
    });
  });

  // PROMPT: WebSocket Audio Echo: Send audio message, assert response
  test('should echo audio messages through WebSocket', async () => {
    // Initialize session first
    const initResponse = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant.',
        tools: [],
        ttsService: 'openai',
        cache_key: 'test-cache'
      })
    });
    
    const initData = await initResponse.json();
    const wsUrl = initData.wsUrl;
    
    // Connect to the WebSocket
    const socket = new WebSocket(wsUrl);
    
    // Set up message handler and connection handler
    const connectedPromise = new Promise(resolve => {
      socket.on('open', resolve);
    });
    
    let receivedMessage = null;
    const messagePromise = new Promise(resolve => {
      socket.on('message', data => {
        receivedMessage = JSON.parse(data.toString());
        resolve();
      });
    });
    
    // Wait for connection to be established
    await connectedPromise;
    
    // PROMPT: Send `{"inputType": "audio", "data": "base64-audio"}`.
    const audioData = "base64-audio";
    socket.send(JSON.stringify({
      inputType: 'audio',
      data: audioData
    }));
    
    // Wait for response
    await messagePromise;
    
    // PROMPT: Assert `{"outputType": "audio", "data": "base64-echo"}` received.
    expect(receivedMessage).toEqual({
      outputType: 'audio',
      data: audioData
    });
    
    // Verify message was stored in Redis history
    const history = await redisClient.lRange(`session:abc:${initData.sessionId}:history`, 0, -1);
    expect(history.length).toBeGreaterThanOrEqual(2);
    
    // Close the connection
    socket.close();
    
    return new Promise(resolve => {
      socket.on('close', resolve);
    });
  });

  // PROMPT: Invalid Session: Connect with invalid `sid`, assert connection closes with code 1008
  test('should reject WebSocket connection with invalid session ID', async () => {
    const invalidSid = 'tenant:abc:session:invalid-uuid';
    const wsUrl = `ws://localhost:${port}/v1/realtime/stream?sid=${invalidSid}`;
    
    // Connect to the WebSocket with invalid sid
    const socket = new WebSocket(wsUrl);
    
    // Wait for close event with appropriate code
    const closePromise = new Promise(resolve => {
      socket.on('close', (code, reason) => {
        resolve({ code, reason });
      });
    });
    
    const { code, reason } = await closePromise;
    
    // PROMPT: Assert connection closes with code 1008
    expect(code).toBe(1008);
    expect(reason.toString()).toBe('Invalid session ID');
  });
});