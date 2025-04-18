import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import WebSocket from 'ws';
import http from 'http';

describe('Realtime WebSocket API Tests', () => {
  let app;
  let server;
  let redisClient;
  let baseUrl;
  let port;

  beforeAll(async () => {
    // Create Redis client
    redisClient = createClient({ url: 'redis://localhost:6379' });
    redisClient.on('error', (err) => {
      console.error(`Redis error: ${err}`);
    });
    await redisClient.connect();
    
    // Create app and start server on a random port
    app = await createApp({ redisClient });
    server = http.createServer(app.callback());
    server.listen();
    
    // Get the port assigned by the OS
    const address = server.address();
    port = address.port;
    baseUrl = `http://localhost:${port}`;
    
    // Set up test data for tenant
    await redisClient.set('tenant:abc:tokens', '100');
  });

  afterAll(async () => {
    // Clean up
    server.close();
    await redisClient.quit();
  });
  
  beforeEach(async () => {
    // Clear any session data before each test
    const keys = await redisClient.keys('session:abc:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  });

  test('Initialize Session', async () => {
    // Send initialize request
    const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime',
        systemPrompt: 'Test system prompt',
        tools: [],
        ttsService: 'openai'
      })
    });

    // Check response is successful
    expect(response.status).toBe(200);
    
    // Check response body
    const data = await response.json();
    expect(data.sessionId).toBeDefined();
    expect(data.sessionId.startsWith('tenant:abc:session:')).toBe(true);
    expect(data.wsUrl).toBeDefined();
    expect(data.wsUrl.includes('/v1/realtime/stream?sid=')).toBe(true);
    expect(data.remainingTokens).toBe(100);
    
    // Verify session state in Redis
    const sessionId = data.sessionId;
    const sessionState = await redisClient.get(`session:abc:${sessionId}:state`);
    expect(sessionState).toBeDefined();
    
    const parsedState = JSON.parse(sessionState);
    expect(parsedState.backend).toBe('openai_realtime');
    expect(parsedState.systemPrompt).toBe('Test system prompt');
    expect(parsedState.tokensUsed).toBe(0);
  });

  test('WebSocket Text Echo', async () => {
    // First initialize a session
    const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime'
      })
    });
    
    const initData = await response.json();
    const { sessionId } = initData;
    
    // Extract the WebSocket URL from response and adapt it to use the test server
    const wsUrl = `ws://localhost:${port}/v1/realtime/stream?sid=${sessionId}`;
    
    return new Promise((resolve, reject) => {
      // Connect to the WebSocket
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        // Send a text message
        ws.send(JSON.stringify({
          inputType: 'text',
          data: 'Hi'
        }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          // Verify the response
          expect(message.outputType).toBe('text');
          expect(message.data).toContain('Hello back');
          expect(message.data).toContain('Hi');
          
          // Close connection and resolve
          ws.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      ws.on('error', (error) => {
        reject(error);
      });
    });
  });
  
  test('WebSocket Audio Echo', async () => {
    // First initialize a session
    const response = await fetch(`${baseUrl}/v1/realtime/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'abc'
      },
      body: JSON.stringify({
        backend: 'openai_realtime'
      })
    });
    
    const initData = await response.json();
    const { sessionId } = initData;
    
    // Extract the WebSocket URL from response and adapt it to use the test server
    const wsUrl = `ws://localhost:${port}/v1/realtime/stream?sid=${sessionId}`;
    
    // Sample base64 audio data
    const sampleAudioBase64 = 'SGVsbG8gdGhpcyBpcyBhIHRlc3QgYXVkaW8gZmlsZQ=='; // "Hello this is a test audio file" in base64
    
    return new Promise((resolve, reject) => {
      // Connect to the WebSocket
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        // Send an audio message
        ws.send(JSON.stringify({
          inputType: 'audio',
          data: sampleAudioBase64
        }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          // Verify the response
          expect(message.outputType).toBe('audio');
          expect(message.data).toContain(sampleAudioBase64.substring(0, 20));
          
          // Close connection and resolve
          ws.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      ws.on('error', (error) => {
        reject(error);
      });
    });
  });
  
  test('Invalid Session', async () => {
    // Try to connect with an invalid session ID
    const invalidSessionId = 'tenant:abc:session:invalid-uuid';
    const wsUrl = `ws://localhost:${port}/v1/realtime/stream?sid=${invalidSessionId}`;
    
    return new Promise((resolve) => {
      // Connect to the WebSocket
      const ws = new WebSocket(wsUrl);
      
      // We expect the connection to fail, so we listen for the close event
      ws.on('close', (code) => {
        expect(code).toBe(1006); // Connection closed abnormally
        resolve();
      });
      
      // In case it doesn't close
      ws.on('open', () => {
        ws.close();
        resolve();
      });
      
      ws.on('error', () => {
        // Error is expected in this case, do nothing
      });
    });
  });
});