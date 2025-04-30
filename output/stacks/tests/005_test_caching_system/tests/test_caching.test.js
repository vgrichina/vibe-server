import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';

let redisClient;
let server;
let baseURL;
let mockOpenAIServer;
let mockOpenAIURL;
let apiKey;
let originalConsoleLog;
let logMessages = [];

// PROMPT: Use Node's `http` module for requests.
async function setupServer() {
  // Setup mock OpenAI server
  mockOpenAIServer = await setupMockOpenAIServer();

  // Setup our app server
  const app = await createApp({ redisClient });
  server = http.createServer(app.callback());

  await new Promise(resolve => {
    server.listen(0, () => {
      baseURL = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
}

// PROMPT: Mock OpenAI API and update URL in tenant config.
async function setupMockOpenAIServer() {
  const mockApp = new Koa();
  const mockRouter = new Router();
  mockApp.use(bodyParser());

  mockRouter.post('/v1/chat/completions', async (ctx) => {
    ctx.status = 200;
    ctx.body = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "This is a mock response"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18
      }
    };
  });

  mockApp.use(mockRouter.routes());
  mockApp.use(mockRouter.allowedMethods());

  const mockServer = http.createServer(mockApp.callback());
  await new Promise(resolve => {
    mockServer.listen(0, () => {
      const port = mockServer.address().port;
      mockOpenAIURL = `http://localhost:${port}/v1/chat/completions`;
      resolve();
    });
  });

  return mockServer;
}

// PROMPT: Preload `cache:abc:intro-conversation-v1` with mock data.
async function preloadCache(cacheKey, data) {
  await redisClient.setEx(`cache:abc:${cacheKey}`, 86400, JSON.stringify(data));
}

async function setupTenantConfig(cachingEnabled = true) {
  const tenantId = 'abc';
  const tenantConfigKey = `tenant:${tenantId}:config`;
  const config = {
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
            url: mockOpenAIURL,
            default_model: "gpt-4o",
            api_key: "sk-abc123"
          }
        }
      }
    },
    caching: {
      enabled: cachingEnabled,
      text_ttl: 86400
    }
  };

  await redisClient.set(tenantConfigKey, JSON.stringify(config));
  return config;
}

async function getAnonymousApiKey() {
  const response = await fetch(`${baseURL}/abc/auth/anonymous`, {
    method: 'POST'
  });
  const data = await response.json();
  return data.apiKey;
}

async function cleanupRedis() {
  const keys = await redisClient.keys('cache:*');
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
}

beforeAll(async () => {
  // PROMPT: Use only real Redis for testing. Don't mock it.
  redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

  // Mock console.log to capture log messages
  originalConsoleLog = console.log;
  console.log = jest.fn((message) => {
    logMessages.push(message);
    originalConsoleLog(message);
  });

  await setupServer();
  await setupTenantConfig(true);
  apiKey = await getAnonymousApiKey();
});

beforeEach(async () => {
  // Clear log messages before each test
  logMessages = [];
  // Clean up cache
  await cleanupRedis();
});

afterAll(async () => {
  // Restore original console.log
  console.log = originalConsoleLog;
  
  if (server && server.listening) {
    await new Promise(resolve => server.close(resolve));
  }
  
  if (mockOpenAIServer && mockOpenAIServer.listening) {
    await new Promise(resolve => mockOpenAIServer.close(resolve));
  }
  
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
});

describe('Cache System Tests', () => {
  // PROMPT: Cache Hit: Preload `cache:abc:intro-conversation-v1` with mock data. Send `POST /v1/chat/completions` with `cache_key: "intro-conversation-v1"`. Assert cached response returned instantly. Check `[INFO] Cache hit` log.
  test('Returns cached response when cache hit', async () => {
    // Preload cache with mock data
    const cacheKey = 'intro-conversation-v1';
    const cachedData = {
      id: "cached-response-123",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "This is a cached response"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 5,
        total_tokens: 10
      }
    };
    
    await preloadCache(cacheKey, cachedData);
    
    // Send request with cache_key
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        cache_key: cacheKey
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Verify we got the cached response
    expect(data.id).toBe(cachedData.id);
    expect(data.choices[0].message.content).toBe("This is a cached response");
    
    // Check for cache hit log
    const cacheHitLog = logMessages.find(msg => msg.includes("[INFO] Cache hit"));
    expect(cacheHitLog).toBeTruthy();
    expect(cacheHitLog).toContain(`[INFO] Cache hit for ${cacheKey}`);
  });

  // PROMPT: Cache Miss: Send same request with empty cache. Assert new response stored with TTL 86400. Check `[INFO] Cache miss` log.
  test('Stores new response when cache miss', async () => {
    const cacheKey = 'intro-conversation-v1';
    
    // Ensure cache is empty
    await cleanupRedis();
    
    // Send request with cache_key
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        cache_key: cacheKey
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Check for cache miss log
    const cacheMissLog = logMessages.find(msg => msg.includes("[INFO] Cache miss"));
    expect(cacheMissLog).toBeTruthy();
    expect(cacheMissLog).toContain(`[INFO] Cache miss, stored ${cacheKey}`);
    
    // Verify the response was stored in Redis with the correct TTL
    const fullCacheKey = `cache:abc:${cacheKey}`;
    const cachedResponse = await redisClient.get(fullCacheKey);
    expect(cachedResponse).toBeTruthy();
    
    const ttl = await redisClient.ttl(fullCacheKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86400);
    
    // Verify stored data matches the response
    const parsedCache = JSON.parse(cachedResponse);
    expect(parsedCache.id).toBeTruthy();
    expect(parsedCache.choices[0].text).toBe("Cached response");
  });

  // PROMPT: Caching Disabled: Mock config with `caching.enabled: false`. Assert no cache check occurs.
  test('Does not check cache when caching is disabled', async () => {
    // Setup tenant config with caching disabled
    await setupTenantConfig(false);
    
    const cacheKey = 'intro-conversation-v1';
    
    // Preload cache with mock data (which should be ignored)
    const cachedData = {
      id: "cached-response-123",
      object: "chat.completion",
      created: Date.now(),
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "This is a cached response"
          },
          finish_reason: "stop"
        }
      ]
    };
    
    await preloadCache(cacheKey, cachedData);
    
    // Send request with cache_key
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        cache_key: cacheKey
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Verify we did not get the cached response
    expect(data.id).not.toBe(cachedData.id);
    
    // Check there's no cache hit or miss log
    const cacheHitLog = logMessages.find(msg => msg.includes("[INFO] Cache hit"));
    const cacheMissLog = logMessages.find(msg => msg.includes("[INFO] Cache miss"));
    expect(cacheHitLog).toBeFalsy();
    expect(cacheMissLog).toBeFalsy();
    
    // Re-enable caching for subsequent tests
    await setupTenantConfig(true);
  });

  test('Handles multiple requests with same cache key correctly', async () => {
    const cacheKey = 'multiple-requests-test';
    
    // First request should miss cache
    const response1 = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        model: "gpt-4o",
        cache_key: cacheKey
      })
    });
    
    expect(response1.status).toBe(200);
    await response1.json();
    
    // Second request should hit cache
    const response2 = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Different message but same cache key" }],
        model: "gpt-4o",
        cache_key: cacheKey
      })
    });
    
    expect(response2.status).toBe(200);
    await response2.json();
    
    // Count cache hit and miss logs
    const cacheMissLogs = logMessages.filter(msg => msg.includes("[INFO] Cache miss"));
    const cacheHitLogs = logMessages.filter(msg => msg.includes("[INFO] Cache hit"));
    
    expect(cacheMissLogs.length).toBe(1);
    expect(cacheHitLogs.length).toBe(1);
  });

  test('Requests without cache_key bypass cache system', async () => {
    // Send request without cache_key
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello without cache" }],
        model: "gpt-4o"
      })
    });
    
    expect(response.status).toBe(200);
    await response.json();
    
    // Check there's no cache hit or miss log
    const cacheHitLog = logMessages.find(msg => msg.includes("[INFO] Cache hit"));
    const cacheMissLog = logMessages.find(msg => msg.includes("[INFO] Cache miss"));
    const storedLog = logMessages.find(msg => msg.includes("[INFO] Stored response in cache"));
    
    expect(cacheHitLog).toBeFalsy();
    expect(cacheMissLog).toBeFalsy();
    expect(storedLog).toBeFalsy();
  });
});