import { jest } from '@jest/globals';
import { createServer } from 'http';
import WebSocket from 'ws';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import ws from 'koa-easy-ws';
import { createClient } from 'redis';
import { initializeRealtimeSession, handleRealtimeStream } from '../src/endpoints/realtime.js';

describe('Realtime WebSocket API', () => {
  let server;
  let redisClient;
  let port;
  let baseUrl;

  beforeAll(async () => {
    // Create Redis client
    redisClient = createClient();
    await redisClient.connect();

    // Create test server
    const app = new Koa();
    const router = new Router();
    
    // Add middleware
    app.use(bodyParser());
    app.use(ws());
    
    // Add routes
    router.post('/v1/realtime/initialize', initializeRealtimeSession(redisClient));
    router.get('/v1/realtime/stream', handleRealtimeStream(ws, redisClient));
    app.use(router.routes());

    // Create HTTP server
    server = createServer(app.callback());
    await new Promise(resolve => {
      server.listen(0, 'localhost', () => resolve());
    });
    port = server.address().port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    // Cleanup
    await new Promise((resolve) => server.close(resolve));
    
    // Clean up Redis
    await redisClient.flushDb();
    await redisClient.quit();
  });

  describe('Session Initialization', () => {
    test('should initialize a session with valid parameters', async () => {
      // Create request payload
      const payload = {
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant',
        tools: [],
        ttsService: 'openai',
        cache_key: 'test-cache'
      };

      // Send request
      const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': 'abc'
        },
        body: JSON.stringify(payload)
      });

      // Assert response
      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Check response structure
      expect(data.sessionId).toBeTruthy();
      expect(data.wsUrl).toBeTruthy();
      expect(data.remainingTokens).toBeGreaterThan(0);

      // Verify session exists in Redis
      const sessionId = data.sessionId;
      const sessionState = await redisClient.get(`session:abc:${sessionId}:state`);
      
      expect(sessionState).toBeTruthy();
      const parsedState = JSON.parse(sessionState);
      expect(parsedState.backend).toBe('openai_realtime');
      expect(parsedState.systemPrompt).toBe('You are a helpful assistant');
      expect(parsedState.createdAt).toBeTruthy();
    });

    test('should reject requests without tenant ID', async () => {
      const payload = {
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant'
      };

      const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('X-Tenant-Id header is required');
    });

    test('should reject requests with invalid backend', async () => {
      const payload = {
        backend: 'invalid_backend',
        systemPrompt: 'You are a helpful assistant'
      };

      const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': 'abc'
        },
        body: JSON.stringify(payload)
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid backend');
    });
  });

  describe('WebSocket Communication', () => {
    let sessionId;
    let wsUrl;

    beforeEach(async () => {
      // Initialize a session
      const payload = {
        backend: 'openai_realtime',
        systemPrompt: 'You are a helpful assistant',
        tools: [],
        ttsService: 'openai',
        cache_key: 'test-cache'
      };

      const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': 'abc'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      sessionId = data.sessionId;
      
      // Convert HTTP URL to WebSocket URL
      const wsUrlFromResponse = data.wsUrl;
      wsUrl = wsUrlFromResponse.replace('http://', 'ws://').replace('https://', 'wss://');
    });

    test('should handle text messages over WebSocket', async () => {
      // Create WebSocket client
      const client = new WebSocket(wsUrl);
      
      // Wait for connection to establish
      await new Promise(resolve => {
        client.on('open', resolve);
      });

      // Setup promise to wait for response
      const responsePromise = new Promise(resolve => {
        client.on('message', data => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send a text message
      const message = {
        inputType: 'text',
        data: 'Hi'
      };
      client.send(JSON.stringify(message));

      // Wait for and verify response
      const response = await responsePromise;
      expect(response.outputType).toBe('text');
      expect(response.data).toBe('Hello back! You sent: Hi');

      // Close connection
      client.close();
      
      // Wait for connection to close
      await new Promise(resolve => {
        client.on('close', resolve);
      });

      // Verify messages were stored in history
      const historyKey = `session:abc:${sessionId}:history`;
      const historyLength = await redisClient.lLen(historyKey);
      expect(historyLength).toBe(2); // 1 user message + 1 assistant response

      const userMessage = JSON.parse(await redisClient.lIndex(historyKey, 0));
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('Hi');

      const assistantMessage = JSON.parse(await redisClient.lIndex(historyKey, 1));
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toBe('Hello back! You sent: Hi');
    });

    test('should handle audio messages over WebSocket', async () => {
      // Create WebSocket client
      const client = new WebSocket(wsUrl);
      
      // Wait for connection to establish
      await new Promise(resolve => {
        client.on('open', resolve);
      });

      // Setup promise to wait for response
      const responsePromise = new Promise(resolve => {
        client.on('message', data => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send an audio message (using a dummy base64 string)
      const dummyBase64Audio = 'SGVsbG8sIHRoaXMgaXMgYSB0ZXN0'; // "Hello, this is a test" in base64
      const message = {
        inputType: 'audio',
        data: dummyBase64Audio
      };
      client.send(JSON.stringify(message));

      // Wait for and verify response
      const response = await responsePromise;
      expect(response.outputType).toBe('audio');
      expect(response.data).toBe(dummyBase64Audio); // Echo back for now

      // Close connection
      client.close();
      
      // Wait for connection to close
      await new Promise(resolve => {
        client.on('close', resolve);
      });

      // Verify messages were stored in history
      const historyKey = `session:abc:${sessionId}:history`;
      const historyLength = await redisClient.lLen(historyKey);
      expect(historyLength).toBe(2); // 1 user message + 1 assistant response

      const userMessage = JSON.parse(await redisClient.lIndex(historyKey, 0));
      expect(userMessage.role).toBe('user');
      expect(userMessage.content).toBe('[audio input]');

      const assistantMessage = JSON.parse(await redisClient.lIndex(historyKey, 1));
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.content).toBe('[audio output]');
    });
  });

  test('should reject connections with invalid session ID', async () => {
    const invalidWsUrl = `ws://localhost:${port}/v1/realtime/stream?sid=invalid_session_id`;
    const client = new WebSocket(invalidWsUrl);
    
    // Setup promise to wait for connection close
    const closePromise = new Promise(resolve => {
      client.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    // Wait for close event
    const closeEvent = await closePromise;
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toContain('Invalid session ID');
  });
});