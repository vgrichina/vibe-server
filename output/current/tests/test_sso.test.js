import { jest } from '@jest/globals';
import http from 'http';
import Koa from 'koa';
import { createClient } from 'redis';
import jwt from 'jsonwebtoken';
import { createApp } from '../bin/server.js';

describe('SSO Integration Tests', () => {
  let app;
  let server;
  let redisClient;
  let port;
  let consoleLogSpy;

  beforeAll(async () => {
    // Create Redis client
    redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();

    // Set up initial tenant config
    const tenantId = 'abc';
    const tenantConfig = {
      auth: {
        google_oauth: {
          client_id: "google-client-abc",
          client_secret: "google-secret-abc"
        }
      },
      user_groups: {
        google_logged_in: {
          tokens: 1000,
          rate_limit: 50,
          rate_limit_window: 60
        }
      },
      providers: {
        text: {
          default: "openai",
          endpoints: {
            openai: {
              url: "https://api.openai.com/v1/chat/completions",
              default_model: "gpt-4o",
              api_key: "sk-abc123"
            }
          }
        }
      }
    };
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(tenantConfig));

    // Mock JWT sign to return predictable tokens for testing
    jest.spyOn(jwt, 'sign').mockImplementation(() => 'mock-jwt-abc-user-123');
    
    // Create app and start server
    app = await createApp({ redisClient });
    server = app.listen();
    
    // Get the randomly assigned port
    const address = server.address();
    port = address.port;
    
    // Spy on console.log to verify log messages
    consoleLogSpy = jest.spyOn(console, 'log');
  });

  afterAll(async () => {
    server.close();
    await redisClient.quit();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Google Auth - successful authentication', async () => {
    // Make a request to the Google Auth endpoint
    const response = await fetch(`http://localhost:${port}/auth/google?tenantId=abc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code: 'mock-google-code' })
    });

    // Verify response status and body
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ token: 'mock-jwt-abc-user-123' });
    
    // Verify that the authentication log message was output
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[INFO] User authenticated')
    );
  });

  test('Chat with valid token', async () => {
    // Set up a user in Redis
    const userId = 'user-123';
    const userData = {
      userId,
      userGroup: 'google_logged_in',
      tenantId: 'abc',
      tokensLeft: 1000
    };
    await redisClient.set(`user:${userId}`, JSON.stringify(userData));
    await redisClient.set(`apiKey:mock-jwt-abc-user-123`, userId);

    // Make a request to the chat endpoint with a valid token
    const response = await fetch(`http://localhost:${port}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-jwt-abc-user-123'
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello, world!' }
        ]
      })
    });

    // Verify response status is successful
    // Note: The actual response data may vary but we're just checking the auth works
    expect(response.status).toBe(200);
  });

  test('Chat with invalid token', async () => {
    // Make a request to the chat endpoint with an invalid token
    const response = await fetch(`http://localhost:${port}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid'
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello, world!' }
        ]
      })
    });

    // Verify response status and error message
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toEqual({ message: "Invalid API key" });
  });

  test('Chat without token', async () => {
    // Make a request to the chat endpoint without a token
    const response = await fetch(`http://localhost:${port}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello, world!' }
        ]
      })
    });

    // Verify response status and error message
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toEqual({ message: "Authentication required" });
  });
});