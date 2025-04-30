import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

let redisClient;
let server;
let port;
let baseURL;

// PROMPT: Use real Redis instance for tests (no mocking).
beforeAll(async () => {
  redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();
  
  // Clean up any existing test data
  await redisClient.del('tenant:abc:config');
  await redisClient.del('tenant:xyz:config');
});

// PROMPT: Clean up Redis test data after each test.
afterEach(async () => {
  // Clean Redis keys created during tests
  const keys = await redisClient.keys('*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
});

afterAll(async () => {
  if (server && server.listening) {
    server.close();
  }
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
});

// PROMPT: Use server.listen without port or host to use a random port during tests.
async function setupServer() {
  const app = await createApp({ redisClient });
  server = http.createServer(app.callback());
  
  await new Promise(resolve => {
    server.listen(0, () => {
      port = server.address().port;
      baseURL = `http://localhost:${port}`;
      resolve();
    });
  });
  
  return { server, port, baseURL };
}

describe('Server Tests', () => {
  
  // PROMPT: Verify the server starts and listens on a given port by making an HTTP request to the server.
  test('server starts and listens on a port', async () => {
    const { baseURL } = await setupServer();
    
    const response = await fetch(baseURL);
    expect(response.status).toBe(200);
    
    if (server.listening) {
      server.close();
    }
  });
  
  // PROMPT: Send a GET request to `/`. Assert status code is 200. Assert response body is `{"message": "vibe-server API is running"}`. Assert `Content-Type` header is `application/json` (allow for `charset=utf-8`).
  test('root endpoint returns correct response', async () => {
    const { baseURL } = await setupServer();
    
    const response = await fetch(baseURL);
    expect(response.status).toBe(200);
    
    const contentType = response.headers.get('content-type');
    expect(contentType).toMatch(/application\/json/);
    
    const body = await response.json();
    expect(body).toEqual({ message: 'vibe-server API is running' });
    
    if (server.listening) {
      server.close();
    }
  });
  
  // PROMPT: Verify `tenant:abc:config` is set in Redis on startup if missing.
  test('config initialization sets default tenant config if missing', async () => {
    // Ensure the tenant config doesn't exist before the test
    await redisClient.del('tenant:abc:config');
    
    // Start the server which should initialize the config
    await setupServer();
    
    // Check that the config was initialized
    const config = await redisClient.get('tenant:abc:config');
    expect(config).toBeTruthy();
    
    const parsedConfig = JSON.parse(config);
    expect(parsedConfig.auth).toBeTruthy();
    expect(parsedConfig.user_groups).toBeTruthy();
    expect(parsedConfig.providers).toBeTruthy();
    
    if (server.listening) {
      server.close();
    }
  });
  
  // PROMPT: GET `/abc/admin/config`. Assert config is fetched and attached to context as `tenantConfig`. Make sure to use full valid config for testing.
  test('middleware - valid tenant', async () => {
    const { baseURL } = await setupServer();
    
    // Setup valid auth token
    const authToken = 'valid-token';
    
    const response = await fetch(`${baseURL}/abc/admin/config`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    expect(response.status).toBe(200);
    const body = await response.json();
    
    // Verify the config structure
    expect(body.config).toBeTruthy();
    expect(body.config.auth).toBeTruthy();
    expect(body.config.user_groups).toBeTruthy();
    expect(body.config.user_groups.anonymous.tokens).toBe(100);
    
    if (server.listening) {
      server.close();
    }
  });
  
  // PROMPT: Send a request to `/xyz/admin/config` (tenant not in Redis). Assert 400 status with `{"error": "Invalid tenant ID"}`.
  test('middleware - invalid tenant', async () => {
    const { baseURL } = await setupServer();
    
    // No need to setup the xyz tenant in Redis - we want it to be invalid
    
    const response = await fetch(`${baseURL}/xyz/admin/config`, {
      headers: {
        'Authorization': 'Bearer valid-token'
      }
    });
    
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid tenant ID' });
    
    if (server.listening) {
      server.close();
    }
  });
  
  // PROMPT: Send POST to `/abc/auth/anonymous`. Assert 200 response with structure: `{"apiKey": "temp_<uuid>", "tokensLeft": 100}`. Verify API key exists in Redis with correct metadata.
  test('anonymous login', async () => {
    const { baseURL } = await setupServer();
    
    const response = await fetch(`${baseURL}/abc/auth/anonymous`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    expect(response.status).toBe(200);
    const body = await response.json();
    
    // Check response structure
    expect(body.apiKey).toMatch(/^temp_[0-9a-f-]+$/);
    expect(body.tokensLeft).toBe(100);
    
    // Verify API key exists in Redis with correct metadata
    const userId = await redisClient.get(`apiKey:${body.apiKey}`);
    expect(userId).toBeTruthy();
    expect(userId).toMatch(/^anonymous_[0-9a-f-]+$/);
    
    const userData = await redisClient.get(`user:${userId}`);
    expect(userData).toBeTruthy();
    
    const parsedUserData = JSON.parse(userData);
    expect(parsedUserData.tokensLeft).toBe(100);
    expect(parsedUserData.userGroup).toBe('anonymous');
    expect(parsedUserData.createdAt).toBeTruthy();
    
    if (server.listening) {
      server.close();
    }
  });
  
  describe('Tenant Config Management', () => {
    
    // PROMPT: GET `/abc/admin/config` without auth header returns 401.
    test('GET config without auth header returns 401', async () => {
      const { baseURL } = await setupServer();
      
      const response = await fetch(`${baseURL}/abc/admin/config`);
      
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unauthorized' });
      
      if (server.listening) {
        server.close();
      }
    });
    
    // PROMPT: GET `/abc/admin/config` with valid auth returns current config.
    test('GET config with valid auth returns current config', async () => {
      const { baseURL } = await setupServer();
      
      const response = await fetch(`${baseURL}/abc/admin/config`, {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.config).toBeTruthy();
      expect(body.config.user_groups.anonymous.tokens).toBe(100);
      
      if (server.listening) {
        server.close();
      }
    });
    
    // PROMPT: PUT `/abc/admin/config` with valid auth updates config.
    test('PUT config with valid auth updates config', async () => {
      const { baseURL } = await setupServer();
      
      // Get the current config to modify
      const getResponse = await fetch(`${baseURL}/abc/admin/config`, {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      const { config } = await getResponse.json();
      
      // Modify the config
      const updatedConfig = {
        ...config,
        user_groups: {
          ...config.user_groups,
          anonymous: {
            ...config.user_groups.anonymous,
            tokens: 200
          }
        }
      };
      
      // Update the config
      const putResponse = await fetch(`${baseURL}/abc/admin/config`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config: updatedConfig })
      });
      
      expect(putResponse.status).toBe(200);
      
      // Verify the config was updated
      const verifyResponse = await fetch(`${baseURL}/abc/admin/config`, {
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      const updatedBody = await verifyResponse.json();
      expect(updatedBody.config.user_groups.anonymous.tokens).toBe(200);
      
      if (server.listening) {
        server.close();
      }
    });
    
    // PROMPT: PUT `/abc/admin/config` with invalid config schema returns 400.
    test('PUT config with invalid config schema returns 400', async () => {
      const { baseURL } = await setupServer();
      
      // Send an invalid config (missing the 'config' property)
      const response = await fetch(`${baseURL}/abc/admin/config`, {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer valid-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ invalidProperty: 'value' })
      });
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: 'Config object is required' });
      
      if (server.listening) {
        server.close();
      }
    });
  });
});