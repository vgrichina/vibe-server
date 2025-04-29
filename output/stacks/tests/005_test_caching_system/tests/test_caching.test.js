import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('Chat Completions Caching Tests', () => {
  let redisClient;
  let app;
  let server;
  let mockOpenAIServer;
  let baseUrl;
  let tenantId = 'abc';
  let apiKey;
  let userId;
  let cacheKey = 'intro-conversation-v1';

  // Helper function to create a mock OpenAI API server
  const setupMockOpenAIServer = () => {
    return http.createServer((req, res) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
      });

      req.on('end', () => {
        if (req.url === '/v1/chat/completions') {
          // Send standard non-streaming response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Date.now(),
            model: "gpt-4o",
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: "This is a response from the mock OpenAI server."
              },
              finish_reason: "stop"
            }],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 12,
              total_tokens: 27
            }
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
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
              default_model: "gpt-4o",
              api_key: "sk-mock-api-key"
            }
          }
        }
      },
      caching: {
        enabled: true,
        text_ttl: 86400, // 24 hours
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
    
    // Clean up any cache entries before each test
    const cacheKeys = await redisClient.keys(`cache:${tenantId}:*`);
    if (cacheKeys.length > 0) {
      await redisClient.del(cacheKeys);
    }
  });
  
  afterEach(async () => {
    // Clean up user data
    if (userId) await redisClient.del(`user:${userId}`);
    if (apiKey) await redisClient.del(`apiKey:${apiKey}`);
    
    // Clean up cache entries
    const cacheKeys = await redisClient.keys(`cache:${tenantId}:*`);
    if (cacheKeys.length > 0) {
      await redisClient.del(cacheKeys);
    }
  });

  test('Cache Hit - returns cached response', async () => {
    // 1. Preload cache with mock data
    const cachedResponse = {
      id: "cached-response-id",
      choices: [{
        message: {
          role: "assistant",
          content: "This is a cached response"
        }
      }]
    };
    
    await redisClient.setEx(`cache:${tenantId}:${cacheKey}`, 86400, JSON.stringify(cachedResponse));
    
    // Spy on console.log to check for cache hit log message
    const consoleSpy = jest.spyOn(console, 'log');
    
    // 2. Send request with cache_key
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        cache_key: cacheKey
      })
    });

    // 3. Assert cached response returned
    expect(response.status).toBe(200);
    const responseData = await response.json();
    
    expect(responseData).toEqual(cachedResponse);
    
    // 4. Check for cache hit log
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    
    consoleSpy.mockRestore();
  });

  test('Cache Miss - stores new response in cache', async () => {
    // Spy on console.log to check for cache miss log message
    const consoleSpy = jest.spyOn(console, 'log');
    
    // 1. Ensure cache is empty
    const initialCacheEntry = await redisClient.get(`cache:${tenantId}:${cacheKey}`);
    expect(initialCacheEntry).toBeNull();
    
    // 2. Send request with cache_key
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        cache_key: cacheKey
      })
    });

    // 3. Assert response is successful
    expect(response.status).toBe(200);
    const responseData = await response.json();
    
    // 4. Check that response is now in cache
    const cachedData = await redisClient.get(`cache:${tenantId}:${cacheKey}`);
    expect(cachedData).not.toBeNull();
    
    const parsedCachedData = JSON.parse(cachedData);
    expect(parsedCachedData).toEqual(responseData);
    
    // 5. Check cache TTL is set properly
    const ttl = await redisClient.ttl(`cache:${tenantId}:${cacheKey}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400); // Should be at most 24 hours
    
    // 6. Check for cache miss log
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cache miss'));
    
    consoleSpy.mockRestore();
  });

  test('Caching Disabled - does not check or store in cache', async () => {
    // 1. Update tenant config to disable caching
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    const config = JSON.parse(configJson);
    
    // Save original config to restore later
    const originalConfig = { ...config };
    
    // Disable caching
    config.caching.enabled = false;
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    // Spy on console.log to verify no cache logs
    const consoleSpy = jest.spyOn(console, 'log');
    
    // 2. Send request with cache_key
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        cache_key: cacheKey
      })
    });

    // 3. Assert response is successful
    expect(response.status).toBe(200);
    
    // 4. Verify nothing was stored in cache
    const cachedData = await redisClient.get(`cache:${tenantId}:${cacheKey}`);
    expect(cachedData).toBeNull();
    
    // 5. Verify no cache logs were written
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache miss'));
    
    // Restore original config
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(originalConfig));
    
    consoleSpy.mockRestore();
  });

  test('No cache_key provided - bypasses cache', async () => {
    // Spy on console.log to verify no cache logs
    const consoleSpy = jest.spyOn(console, 'log');
    
    // 1. Send request without cache_key
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
        // No cache_key
      })
    });

    // 2. Assert response is successful
    expect(response.status).toBe(200);
    
    // 3. Verify no cache logs were written
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache miss'));
    
    consoleSpy.mockRestore();
  });

  test('Streaming requests - bypass caching', async () => {
    // Spy on console.log to verify no cache logs
    const consoleSpy = jest.spyOn(console, 'log');
    
    // 1. Send streaming request with cache_key
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o',
        stream: true,
        cache_key: cacheKey
      })
    });

    // 2. Assert streaming response setup
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    
    // Drain the response to complete the request
    const reader = response.body.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    
    // 3. Verify nothing was stored in cache
    const cachedData = await redisClient.get(`cache:${tenantId}:${cacheKey}`);
    expect(cachedData).toBeNull();
    
    // 4. Verify no cache logs were written
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache hit'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Cache miss'));
    
    consoleSpy.mockRestore();
  });
});