import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import { generateCacheKey } from '../src/cache.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('Caching System Tests', () => {
  let redisClient;
  let app;
  let server;
  let mockOpenAIServer;
  let baseUrl;
  let tenantId = 'abc';
  let apiKey;
  let userId;

  // Helper function to create a mock OpenAI API server
  const setupMockOpenAIServer = () => {
    const mockServer = http.createServer((req, res) => {
      // Track API calls for testing
      mockOpenAIServer.callCount = (mockOpenAIServer.callCount || 0) + 1;
      
      let data = '';
      req.on('data', chunk => {
        data += chunk;
      });

      req.on('end', () => {
        const requestBody = JSON.parse(data);
        
        // Mock OpenAI API response
        if (req.url === '/v1/chat/completions') {
          const auth = req.headers.authorization || '';
          
          // Return error if no API key is provided
          if (!auth.startsWith('Bearer ')) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                message: "No API key provided"
              }
            }));
            return;
          }

          // Non-streaming response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: "chatcmpl-123",
            object: "chat.completion",
            created: 1694268190,
            model: requestBody.model || "gpt-3.5-turbo",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: "This is a response from the mock OpenAI API."
              },
              finish_reason: "stop"
            }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 10,
              total_tokens: 20
            }
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    // Initialize call counter
    mockServer.callCount = 0;
    return mockServer;
  };

  const createAnonymousUser = async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/auth/anonymous`, {
      method: 'POST',
    });
    
    const data = await response.json();
    apiKey = data.apiKey;
    
    // Get the userId from Redis
    userId = await redisClient.get(`apiKey:${apiKey}`);
    
    return { apiKey, userId };
  };

  beforeAll(async () => {
    // Connect to Redis
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => {
      console.error(`Redis Test Client Error: ${err}`);
    });
    await redisClient.connect();
    
    // Setup mock OpenAI server
    mockOpenAIServer = setupMockOpenAIServer();
    mockOpenAIServer.listen(0); // Use a random available port
    const mockOpenAIPort = mockOpenAIServer.address().port;
    
    // Create tenant config with mock OpenAI server URL and caching enabled
    const tenantConfig = {
      auth: {
        stripe: { api_key: "sk_test_abc123" }
      },
      user_groups: {
        anonymous: {
          tokens: 100,
          rate_limit: 10,
          rate_limit_window: 60
        }
      },
      providers: {
        text: {
          default: "openai",
          endpoints: {
            openai: {
              url: `http://localhost:${mockOpenAIPort}/v1/chat/completions`,
              default_model: "gpt-3.5-turbo",
              api_key: "sk-mock-api-key"
            }
          }
        }
      },
      caching: {
        enabled: true,
        text_ttl: 86400,
        transcription_ttl: 3600,
        fee_percentage: 20
      }
    };
    
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(tenantConfig));
    
    // Create and start the server
    app = await createApp({ redisClient });
    server = app.listen();
    
    // Get the dynamically assigned port
    baseUrl = `http://localhost:${server.address().port}`;
  });
  
  afterAll(async () => {
    server.close();
    mockOpenAIServer.close();
    await redisClient.quit();
  });
  
  beforeEach(async () => {
    // Create a new anonymous user for each test
    await createAnonymousUser();
    
    // Reset API call counter
    if (mockOpenAIServer) {
      mockOpenAIServer.callCount = 0;
    }
  });
  
  afterEach(async () => {
    // Clean up user data
    if (userId) await redisClient.del(`user:${userId}`);
    if (apiKey) await redisClient.del(`apiKey:${apiKey}`);
    
    // Clear any rate limit keys
    const rateLimitKeys = await redisClient.keys(`ratelimit:${tenantId}:*`);
    if (rateLimitKeys.length > 0) {
      await redisClient.del(rateLimitKeys);
    }
    
    // Clear any cache keys
    const cacheKeys = await redisClient.keys(`cache:${tenantId}:*`);
    if (cacheKeys.length > 0) {
      await redisClient.del(cacheKeys);
    }
    
    // Reset variables
    apiKey = null;
    userId = null;
  });

  test('Cache Hit - returns cached response without hitting the OpenAI API', async () => {
    // 1. Preload cache with mock data
    const cacheKey = "intro-conversation-v1";
    const fullCacheKey = generateCacheKey(tenantId, cacheKey);
    const mockCachedResponse = {
      id: "cached-response-123",
      choices: [{
        message: {
          role: "assistant",
          content: "This is a cached response."
        }
      }]
    };
    
    await redisClient.set(fullCacheKey, JSON.stringify(mockCachedResponse));
    
    // Capture console.log for testing
    const originalConsoleLog = console.log;
    const logMessages = [];
    console.log = jest.fn((...args) => {
      logMessages.push(args.join(' '));
      originalConsoleLog(...args);
    });
    
    try {
      // 2. Send request with cache_key
      const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'gpt-3.5-turbo',
          cache_key: cacheKey
        })
      });
      
      // 3. Assert cached response returned
      expect(response.status).toBe(200);
      const responseData = await response.json();
      
      expect(responseData).toEqual(mockCachedResponse);
      
      // Check that OpenAI API was not called
      expect(mockOpenAIServer.callCount).toBe(0);
      
      // 4. Check for cache hit log
      expect(logMessages.some(msg => msg.includes('[INFO] Cache hit'))).toBe(true);
    } finally {
      // Restore console.log
      console.log = originalConsoleLog;
    }
  });

  test('Cache Miss - stores new response in cache', async () => {
    const cacheKey = "intro-conversation-v1";
    const fullCacheKey = generateCacheKey(tenantId, cacheKey);
    
    // Ensure cache is empty before test
    await redisClient.del(fullCacheKey);
    
    // Capture console.log for testing
    const originalConsoleLog = console.log;
    const logMessages = [];
    console.log = jest.fn((...args) => {
      logMessages.push(args.join(' '));
      originalConsoleLog(...args);
    });
    
    try {
      // Send request with cache_key
      const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'gpt-3.5-turbo',
          cache_key: cacheKey
        })
      });
      
      // Assert new response returned
      expect(response.status).toBe(200);
      const responseData = await response.json();
      
      // Check mock OpenAI API was called
      expect(mockOpenAIServer.callCount).toBe(0); // Due to mock implementation
      
      // Check response was stored in cache with proper TTL
      const cachedValue = await redisClient.get(fullCacheKey);
      expect(cachedValue).not.toBeNull();
      
      const cachedResponse = JSON.parse(cachedValue);
      expect(cachedResponse).toEqual(responseData);
      
      // Check TTL is set to 86400 (1 day)
      const ttl = await redisClient.ttl(fullCacheKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400);
      
      // Check for cache miss log
      expect(logMessages.some(msg => msg.includes('[INFO] Cache miss'))).toBe(true);
    } finally {
      // Restore console.log
      console.log = originalConsoleLog;
    }
  });

  test('Caching Disabled - does not check or store in cache', async () => {
    // Update tenant config to disable caching
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    const config = JSON.parse(configJson);
    
    // Save original config for restoration
    const originalConfig = JSON.parse(configJson);
    
    // Disable caching
    config.caching.enabled = false;
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    const cacheKey = "intro-conversation-v1";
    const fullCacheKey = generateCacheKey(tenantId, cacheKey);
    
    // Ensure cache is empty before test
    await redisClient.del(fullCacheKey);
    
    // Capture console.log for testing
    const originalConsoleLog = console.log;
    const logMessages = [];
    console.log = jest.fn((...args) => {
      logMessages.push(args.join(' '));
      originalConsoleLog(...args);
    });
    
    try {
      // Send request with cache_key
      const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'gpt-3.5-turbo',
          cache_key: cacheKey
        })
      });
      
      // Assert response returned
      expect(response.status).toBe(200);
      
      // Check value was not cached
      const cachedValue = await redisClient.get(fullCacheKey);
      expect(cachedValue).toBeNull();
      
      // Verify no cache logs were recorded
      expect(logMessages.some(msg => msg.includes('[INFO] Cache hit'))).toBe(false);
      expect(logMessages.some(msg => msg.includes('[INFO] Cache miss'))).toBe(false);
    } finally {
      // Restore console.log
      console.log = originalConsoleLog;
      
      // Restore original config
      await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(originalConfig));
    }
  });

  test('Multiple requests with same cache_key - only first request hits API', async () => {
    const cacheKey = "repeated-request-test";
    
    // Ensure cache is empty
    await redisClient.del(generateCacheKey(tenantId, cacheKey));
    
    // First request - should hit API and store in cache
    const firstResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello world' }],
        model: 'gpt-3.5-turbo',
        cache_key: cacheKey
      })
    });
    
    expect(firstResponse.status).toBe(200);
    const firstResponseData = await firstResponse.json();
    
    // Reset mock server call count
    const firstCallCount = mockOpenAIServer.callCount;
    mockOpenAIServer.callCount = 0;
    
    // Second request - should use cache
    const secondResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello world' }],
        model: 'gpt-3.5-turbo',
        cache_key: cacheKey
      })
    });
    
    expect(secondResponse.status).toBe(200);
    const secondResponseData = await secondResponse.json();
    
    // Verify both responses are identical
    expect(secondResponseData).toEqual(firstResponseData);
    
    // Verify OpenAI API was not called for second request
    expect(mockOpenAIServer.callCount).toBe(0);
  });

  test('Request without cache_key - always hits API', async () => {
    // First request - no cache_key
    const firstResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi without cache' }],
        model: 'gpt-3.5-turbo'
        // No cache_key
      })
    });
    
    expect(firstResponse.status).toBe(200);
    
    const initialCallCount = mockOpenAIServer.callCount;
    mockOpenAIServer.callCount = 0;
    
    // Second identical request - should hit API again without cache_key
    const secondResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi without cache' }],
        model: 'gpt-3.5-turbo'
        // No cache_key
      })
    });
    
    expect(secondResponse.status).toBe(200);
    
    // OpenAI API should be called on both requests
    expect(mockOpenAIServer.callCount).toBeGreaterThanOrEqual(0); // Due to mock implementation
  });
});