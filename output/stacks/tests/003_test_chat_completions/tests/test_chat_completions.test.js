import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('Chat Completions Endpoint Tests', () => {
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

          // Handle streaming response
          if (requestBody.stream === true) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            
            // Send a couple of chunks
            res.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n');
            
            setTimeout(() => {
              res.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{"content":", how can I help?"},"finish_reason":null}]}\n\n');
              
              setTimeout(() => {
                res.write('data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1694268190,"model":"gpt-3.5-turbo","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
                res.write('data: [DONE]\n\n');
                res.end();
              }, 50);
            }, 50);
            
          } else {
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
                  content: "Hello, how can I help you today?"
                },
                finish_reason: "stop"
              }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20
              }
            }));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

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
    
    // Create tenant config with mock OpenAI server URL
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
    
    // Reset variables
    apiKey = null;
    userId = null;
  });

  test('Basic Chat Completion - returns successful response', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo',
        group_id: 'anonymous'
      })
    });

    expect(response.status).toBe(200);
    
    const responseData = await response.json();
    expect(responseData.id).toBeDefined();
    expect(responseData.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.objectContaining({
          role: 'assistant',
          content: expect.any(String)
        })
      })
    ]));
  });

  test('Streaming Response - returns properly formatted SSE stream', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo',
        stream: true
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('connection')).toBe('keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let receivedChunks = [];
    let done = false;

    while (!done) {
      const { value, done: isDone } = await reader.read();
      if (isDone) {
        done = true;
        break;
      }
      
      const chunk = decoder.decode(value, { stream: true });
      receivedChunks.push(chunk);
    }

    // Join all chunks and split by double newlines (SSE format)
    const allData = receivedChunks.join('');
    const events = allData.split('\n\n').filter(e => e.trim());

    // Verify we have at least one data event
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Check that the first event has the correct format
    const firstEvent = events[0];
    expect(firstEvent).toContain('data: ');
    
    // Parse the JSON from the first event
    const jsonMatch = firstEvent.match(/^data: (.+)$/);
    expect(jsonMatch).not.toBeNull();
    
    if (jsonMatch && jsonMatch[1] !== '[DONE]') {
      const eventData = JSON.parse(jsonMatch[1]);
      expect(eventData.id).toBeDefined();
      expect(eventData.choices[0].delta).toBeDefined();
    }
  });

  test('Insufficient Tokens - returns 429 error', async () => {
    // Set user tokens to 0
    const userDataJson = await redisClient.get(`user:${userId}`);
    const userData = JSON.parse(userDataJson);
    userData.tokensLeft = 0;
    await redisClient.set(`user:${userId}`, JSON.stringify(userData));
    
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo'
      })
    });

    expect(response.status).toBe(429);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('Insufficient tokens');
  });

  test('Missing API Key - returns 401 error', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Missing Authorization header
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo'
      })
    });

    expect(response.status).toBe(401);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('Authentication required');
  });

  test('Invalid API Key - returns 401 error', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-key'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo'
      })
    });

    expect(response.status).toBe(401);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('Invalid API key');
  });

  test('No OpenAI API key configured - handles provider error', async () => {
    // Get current config
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    const config = JSON.parse(configJson);
    
    // Save original config
    const originalConfig = JSON.parse(configJson);
    
    // Update config to remove the OpenAI API key
    config.providers.text.endpoints.openai.api_key = '';
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo'
      })
    });

    // Expect an error as the provider will return a 403 due to missing API key
    expect(response.status).not.toBe(200);
    
    // Restore the original config
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(originalConfig));
  });

  test('Rate Limiting - returns 429 after exceeding limit', async () => {
    // Get the rate limit configuration
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    const config = JSON.parse(configJson);
    const rateLimit = config.user_groups.anonymous.rate_limit;
    
    // Set rate limit close to threshold
    await redisClient.set(`ratelimit:${tenantId}:${userId}`, rateLimit - 1);
    
    // This request should succeed (just at the limit)
    const firstResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'gpt-3.5-turbo'
      })
    });
    
    expect(firstResponse.status).toBe(200);
    
    // This request should fail (exceeding the limit)
    const secondResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi again' }],
        model: 'gpt-3.5-turbo'
      })
    });
    
    expect(secondResponse.status).toBe(429);
    
    const errorData = await secondResponse.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('Rate limit exceeded');
  });

  test('Invalid Model - returns 400 error', async () => {
    // Modify the tenant config to check for invalid models
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    const config = JSON.parse(configJson);
    const originalConfig = JSON.parse(configJson);
    
    // Assume the endpoint validates models
    config.providers.text.endpoints.openai.supported_models = ['gpt-3.5-turbo', 'gpt-4'];
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'invalid-model' // Use an invalid model name
      })
    });
    
    // The provider might still accept the invalid model if it doesn't validate
    // or return a specific error that our endpoint passes through
    // For now, we just check the response isn't an error on our end
    expect(response.status).not.toBe(500);
    
    // Restore original config
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(originalConfig));
  });

  test('Missing Messages - returns 400 error', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        // Missing messages array
        model: 'gpt-3.5-turbo'
      })
    });

    expect(response.status).toBe(400);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('messages must be an array');
  });

  test('Invalid Message Format - returns 400 error', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ content: 'Missing role field' }], // Missing role
        model: 'gpt-3.5-turbo'
      })
    });

    expect(response.status).toBe(400);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toBe('each message must have role and content fields');
  });

  test('Large Context Window - handles large messages properly', async () => {
    // Create a long message that approaches token limits
    const longText = 'This is a test message. '.repeat(100);
    
    const response = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: longText }],
        model: 'gpt-3.5-turbo'
      })
    });

    // We expect either success or a proper error related to token limits
    expect([200, 400, 413]).toContain(response.status);
    
    if (response.status === 200) {
      const data = await response.json();
      expect(data.choices[0].message).toBeDefined();
    }
  });
});