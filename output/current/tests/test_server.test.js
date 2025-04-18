import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

describe('Server Tests', () => {
  let redisClient;
  let app;
  let server;
  let port;
  let baseUrl;
  
  beforeAll(async () => {
    // Connect to Redis
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => {
      console.error(`Redis Test Client Error: ${err}`);
    });
    await redisClient.connect();
    
    // Create and start the server
    app = await createApp({ redisClient });
    server = app.listen();
    
    // Get the dynamically assigned port
    port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    
    // Set up tenant config for testing
    const tenantId = 'abc';
    const DEFAULT_TENANT_CONFIG = {
      auth: {
        stripe: {
          api_key: "sk_test_abc123"
        },
        google_oauth: {
          client_id: "google-client-abc",
          client_secret: "google-secret-abc"
        },
        apple_oauth: {
          client_id: "apple-client-abc",
          client_secret: "apple-secret-abc"
        }
      },
      user_groups: {
        anonymous: {
          tokens: 100,
          rate_limit: 10,
          rate_limit_window: 60
        },
        google_logged_in: {
          tokens: 1000,
          rate_limit: 50,
          rate_limit_window: 60
        },
        stripe_basic: {
          tokens: 5000,
          rate_limit: 100,
          rate_limit_window: 60
        },
        stripe_premium: {
          tokens: 20000,
          rate_limit: 500,
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
            },
            anthropic: {
              url: "https://api.anthropic.com/v1/messages",
              default_model: "claude-3-opus-20240229",
              api_key: "sk-ant123"
            }
          }
        },
        realtime: {
          default: "openai_realtime",
          endpoints: {
            openai_realtime: {
              model: "gpt-4o-realtime-preview-2024-12-17",
              voice: "alloy",
              api_key: "sk-rt-abc123"
            },
            ultravox: {
              voice: "Mark",
              sampleRate: 48000,
              encoding: "pcm_s16le",
              api_key: "Zk9Ht7Lm.wX7pN9fM3kLj6tRq2bGhA8yE5cZvD4sT"
            }
          }
        }
      }
    };
    
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(DEFAULT_TENANT_CONFIG));
  });
  
  afterAll(async () => {
    // Close server and Redis client
    server.close();
    await redisClient.quit();
  });
  
  afterEach(async () => {
    // Clean up test data after each test
    const keys = await redisClient.keys('apiKey:*');
    keys.push(...await redisClient.keys('user:anon_*'));
    
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  });
  
  // Test server startup
  test('Server starts and listens on a given port', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
  });
  
  // Test root endpoint
  test('Root endpoint returns correct response', async () => {
    const response = await fetch(baseUrl);
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data).toEqual({ message: "vibe-server API is running" });
    
    const contentType = response.headers.get('content-type');
    expect(contentType).toMatch(/^application\/json/);
  });
  
  // Test config initialization
  test('Tenant config is available in Redis', async () => {
    const configJson = await redisClient.get('tenant:abc:config');
    expect(configJson).toBeTruthy();
    
    const config = JSON.parse(configJson);
    expect(config.auth).toBeDefined();
    expect(config.user_groups).toBeDefined();
    expect(config.providers).toBeDefined();
  });
  
  // Test tenant middleware with valid tenant
  test('Middleware - Valid tenant loads config', async () => {
    // Create admin token for testing
    await redisClient.set('apiKey:admin-test-key', 'admin-user');
    
    const response = await fetch(`${baseUrl}/abc/admin/config`, {
      headers: {
        'Authorization': 'Bearer admin-test-key'
      }
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.config).toBeDefined();
    expect(data.config.auth).toBeDefined();
    expect(data.config.user_groups).toBeDefined();
    expect(data.config.providers).toBeDefined();
    
    // Clean up admin test key
    await redisClient.del('apiKey:admin-test-key');
  });
  
  // Test tenant middleware with invalid tenant
  test('Middleware - Invalid tenant returns 400', async () => {
    const response = await fetch(`${baseUrl}/xyz/admin/config`);
    
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data).toEqual({ error: "Invalid tenant ID" });
  });
  
  // Test anonymous login
  test('Anonymous login creates API key and user data', async () => {
    const response = await fetch(`${baseUrl}/abc/auth/anonymous`, {
      method: 'POST'
    });
    
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.apiKey).toBeTruthy();
    expect(data.apiKey).toMatch(/^temp_[0-9a-f-]+$/);
    expect(data.tokensLeft).toBe(100);
    
    // Verify API key exists in Redis and points to user
    const userId = await redisClient.get(`apiKey:${data.apiKey}`);
    expect(userId).toBeTruthy();
    expect(userId).toMatch(/^anon_/);
    
    // Verify user data exists in Redis
    const userDataJson = await redisClient.get(`user:${userId}`);
    expect(userDataJson).toBeTruthy();
    
    const userData = JSON.parse(userDataJson);
    expect(userData.userId).toBe(userId);
    expect(userData.tokensLeft).toBe(100);
    expect(userData.userGroup).toBe('anonymous');
    expect(userData.tenantId).toBe('abc');
  });
  
  // Test tenant config management
  test('GET config without auth returns 401', async () => {
    const response = await fetch(`${baseUrl}/abc/admin/config`);
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: "Authentication required" });
  });
  
  test('GET config with valid auth returns current config', async () => {
    // Set up admin token
    await redisClient.set('apiKey:valid-admin-key', 'admin-user');
    
    const response = await fetch(`${baseUrl}/abc/admin/config`, {
      headers: {
        'Authorization': 'Bearer valid-admin-key'
      }
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.config).toBeDefined();
    expect(data.config.auth.stripe.api_key).toBe("sk_test_abc123");
    
    // Clean up
    await redisClient.del('apiKey:valid-admin-key');
  });
  
  test('PUT config with valid auth updates config', async () => {
    // Set up admin token
    await redisClient.set('apiKey:valid-admin-key', 'admin-user');
    
    // Get current config
    const getResponse = await fetch(`${baseUrl}/abc/admin/config`, {
      headers: {
        'Authorization': 'Bearer valid-admin-key'
      }
    });
    
    const { config: currentConfig } = await getResponse.json();
    
    // Update config with modified version
    const updatedConfig = {
      ...currentConfig,
      auth: {
        ...currentConfig.auth,
        stripe: {
          api_key: "sk_test_updated_key"
        }
      }
    };
    
    const updateResponse = await fetch(`${baseUrl}/abc/admin/config`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer valid-admin-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ config: updatedConfig })
    });
    
    expect(updateResponse.status).toBe(200);
    
    // Verify config was updated in Redis
    const configJson = await redisClient.get('tenant:abc:config');
    const savedConfig = JSON.parse(configJson);
    expect(savedConfig.auth.stripe.api_key).toBe("sk_test_updated_key");
    
    // Restore original config
    await redisClient.set('tenant:abc:config', JSON.stringify(currentConfig));
    await redisClient.del('apiKey:valid-admin-key');
  });
  
  test('PUT config with missing config object returns 400', async () => {
    // Set up admin token
    await redisClient.set('apiKey:valid-admin-key', 'admin-user');
    
    const response = await fetch(`${baseUrl}/abc/admin/config`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer valid-admin-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({}) // Missing config object
    });
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: "Config object is required" });
    
    // Clean up
    await redisClient.del('apiKey:valid-admin-key');
  });
});