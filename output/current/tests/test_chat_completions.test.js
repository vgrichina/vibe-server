import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { ReadableStream } from 'stream/web';

let redisClient;
let server;
let baseURL;
let mockOpenAIServer;
let mockOpenAIURL;
let apiKey;

// PROMPT: Setup full tenant config in Redis pointing to mock OpenAI API.
async function setupTenantConfig() {
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
    }
  };

  await redisClient.set(tenantConfigKey, JSON.stringify(config));
  return config;
}

// PROMPT: Mock OpenAI API calls by starting a mock server and setting up API URL to point to it.
async function setupMockOpenAIServer() {
  const mockApp = new Koa();
  const mockRouter = new Router();
  mockApp.use(bodyParser());

  // Standard response handler for non-streaming requests
  mockRouter.post('/v1/chat/completions', async (ctx) => {
    const { stream, model } = ctx.request.body;

    // Handle missing API key
    const authHeader = ctx.request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 403;
      ctx.body = { error: { message: "No API key provided" } };
      return;
    }

    // Handle invalid model
    if (model === 'invalid-model') {
      ctx.status = 400;
      ctx.body = { error: { message: "Model not found" } };
      return;
    }

    if (stream) {
      ctx.set('Content-Type', 'text/event-stream');
      ctx.set('Cache-Control', 'no-cache');
      ctx.set('Connection', 'keep-alive');
      ctx.status = 200;

      const writer = ctx.res;
      writer.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0613","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{"role":"assistant"},"logprobs":null,"finish_reason":null}]}\n\n');
      writer.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0613","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{"content":"Hello"},"logprobs":null,"finish_reason":null}]}\n\n');
      writer.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0613","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{"content":"!"},"logprobs":null,"finish_reason":null}]}\n\n');
      writer.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo-0613","system_fingerprint":"fp_44709d6fcb","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}]}\n\n');
      writer.write('data: [DONE]\n\n');
      writer.end();
    } else {
      ctx.status = 200;
      ctx.body = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1694268190,
        model: "gpt-3.5-turbo-0613",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I assist you today?"
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
    }
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

// PROMPT: Need to obtain API key from POST /:tenantId/auth/anonymous. 
async function getAnonymousApiKey() {
  const response = await fetch(`${baseURL}/abc/auth/anonymous`, {
    method: 'POST'
  });
  const data = await response.json();
  return data.apiKey;
}

beforeAll(async () => {
  // Connect to Redis
  redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

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

  // Setup tenant config
  await setupTenantConfig();

  // Get an API key
  apiKey = await getAnonymousApiKey();
});

afterAll(async () => {
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

// PROMPT: Clean up Redis test data after each test.
afterEach(async () => {
  // Keep tenant config, but clean user data
  const keys = await redisClient.keys('user:*');
  keys.push(...(await redisClient.keys('apiKey:*')));
  keys.push(...(await redisClient.keys('rate_limit:*')));
  
  if (keys.length > 0) {
    await redisClient.del(keys);
  }
  
  // Get a new API key for next test
  apiKey = await getAnonymousApiKey();
});

describe('Chat Completions Endpoint Tests', () => {
  // PROMPT: Basic Chat Completion: Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-3.5-turbo", "group_id": "anonymous"}`.
  test('Basic chat completion works correctly', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo"
      })
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    // Verify response format matches OpenAI API structure
    expect(data.id).toBeTruthy();
    expect(data.object).toBe("chat.completion");
    expect(data.choices[0].message.content).toBeTruthy();
    expect(data.choices[0].message.role).toBe("assistant");
    expect(data.usage).toBeTruthy();
  });

  // PROMPT: Streaming Response: Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "stream": true}`.
  test('Streaming response works correctly', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo",
        stream: true
      })
    });

    expect(response.status).toBe(200);
    
    // Assert SSE headers
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');
    
    // Read the stream
    const reader = response.body.getReader();
    const chunks = [];
    
    let done = false;
    while (!done) {
      const { done: isDone, value } = await reader.read();
      done = isDone;
      if (!done) {
        chunks.push(new TextDecoder().decode(value));
      }
    }
    
    // Join all chunks and split by SSE event delimiter
    const events = chunks.join('').split('\n\n').filter(e => e.trim());
    
    // Should have at least some events
    expect(events.length).toBeGreaterThan(0);
    
    // Check that each event is properly formatted
    for (const event of events) {
      // Skip the [DONE] event
      if (event === 'data: [DONE]') continue;
      
      // Each event should start with 'data: '
      expect(event.startsWith('data: ')).toBe(true);
      
      // Extract and parse the JSON
      const jsonStr = event.replace('data: ', '');
      const eventData = JSON.parse(jsonStr);
      
      // Verify it follows OpenAI streaming format
      expect(eventData.id).toBeTruthy();
      expect(eventData.object).toBe('chat.completion.chunk');
      expect(eventData.choices).toBeTruthy();
      // Delta can contain role, content, or be empty (for finish reason)
      expect(eventData.choices[0].index).toBeDefined();
      expect(eventData.choices[0].delta).toBeDefined();
    }
  });

  // PROMPT: Non-Streaming Response: Send same request with `stream: false`.
  test('Non-streaming response works correctly', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo",
        stream: false
      })
    });

    expect(response.status).toBe(200);
    
    const data = await response.json();
    
    // Verify response format
    expect(data.id).toBeTruthy();
    expect(data.choices).toBeTruthy();
  });

  // PROMPT: Insufficient Tokens: Set `tokens:abc:anonymous:anonymous-uuid` to 0. Assert 429
  test('Returns 429 when insufficient tokens', async () => {
    // Get user ID associated with API key
    const userId = await redisClient.get(`apiKey:${apiKey}`);
    const userDataStr = await redisClient.get(`user:${userId}`);
    const userData = JSON.parse(userDataStr);
    
    // Update user data with 0 tokens
    userData.tokensLeft = 0;
    await redisClient.set(`user:${userId}`, JSON.stringify(userData));
    
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(response.status).toBe(429);
    
    const data = await response.json();
    expect(data.error.message).toBe('Insufficient tokens');
  });

  // PROMPT: Missing API Key: Mock tenant config without `openai` key. Mock OpenAI API to return 403 when no API key is provided. Assert 403
  test('Returns 403 when provider API key is missing', async () => {
    // Update tenant config to remove API key
    const tenantConfig = await redisClient.get('tenant:abc:config');
    const config = JSON.parse(tenantConfig);
    delete config.providers.text.endpoints.openai.api_key;
    await redisClient.set('tenant:abc:config', JSON.stringify(config));
    
    try {
      const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hi" }],
          model: "gpt-3.5-turbo"
        })
      });
      
      expect(response.status).toBe(403);
      
      const data = await response.json();
      expect(data.error.message).toBe('Provider API key missing in tenant configuration');
    } finally {
      // Restore the API key
      config.providers.text.endpoints.openai.api_key = "sk-abc123";
      await redisClient.set('tenant:abc:config', JSON.stringify(config));
    }
  });

  // PROMPT: Rate Limiting: Send multiple requests in quick succession. Assert 429 after exceeding rate limit
  test('Returns 429 when rate limit is exceeded', async () => {
    // Get tenant config to check rate limit settings
    const tenantConfig = await redisClient.get('tenant:abc:config');
    const config = JSON.parse(tenantConfig);
    const rateLimit = config.user_groups.anonymous.rate_limit;
    
    // Send requests up to the rate limit
    const requests = [];
    for (let i = 0; i < rateLimit; i++) {
      requests.push(fetch(`${baseURL}/abc/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: `Request ${i}` }],
          model: "gpt-3.5-turbo"
        })
      }));
    }
    
    // Wait for all requests to complete
    const responses = await Promise.all(requests);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    
    // Send one more request that should exceed the rate limit
    const rateLimitResponse = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "One too many" }],
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(rateLimitResponse.status).toBe(429);
    
    const data = await rateLimitResponse.json();
    expect(data.error.message).toBe('Rate limit exceeded');
  });

  // PROMPT: Invalid Model: Send request with `model: "invalid-model"`. Assert 400
  test('Returns 400 when invalid model is provided', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "invalid-model"
      })
    });
    
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error.message).toBe('Model not found');
  });

  // PROMPT: Missing Messages: Send request without messages array. Assert 400 with appropriate error message.
  test('Returns 400 when messages array is missing', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error.message).toBe('Invalid messages format');
  });

  // PROMPT: Invalid Message Format: Send request with malformed messages array. Assert 400 with validation error.
  test('Returns 400 when message format is invalid', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ invalid: "field" }],
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.error.message).toBe('Messages must have role and content fields');
  });

  // PROMPT: Large Context Window: Send request with messages approaching token limit. Verify proper handling of context window.
  test('Handles large context window appropriately', async () => {
    // Generate a long message that would approach token limits
    const longContent = "This is a test message. ".repeat(100);
    
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helpful assistant" },
          { role: "user", content: longContent }
        ],
        model: "gpt-3.5-turbo"
      })
    });
    
    // Even with large context, it should still return 200 as our mock server accepts any input
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.choices[0].message.content).toBeTruthy();
  });

  // PROMPT: Test unauthorized access
  test('Returns 401 when authorization token is missing', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error.message).toBe('Missing or invalid authorization token');
  });

  // PROMPT: Test with invalid authorization token
  test('Returns 401 when authorization token is invalid', async () => {
    const response = await fetch(`${baseURL}/abc/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-token'
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: "gpt-3.5-turbo"
      })
    });
    
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error.message).toBe('Invalid authorization token');
  });
});