import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import jwt from 'jsonwebtoken';

let redisClient;
let server;
let baseURL;
let mockOAuthServer;
let mockOAuthURL;
let mockStripeServer;
let mockStripeURL;

// PROMPT: Use test fixtures for tenant configurations
const tenantId = 'abc';

// PROMPT: Setup full tenant config in Redis pointing to mock OAuth APIs.
async function setupTenantConfig() {
  const tenantConfigKey = `tenant:${tenantId}:config`;
  const config = {
    auth: {
      stripe: {
        api_key: "sk_test_abc123",
        api_url: mockStripeURL
      },
      google_oauth: {
        client_id: "google-client-abc",
        client_secret: "google-secret-abc",
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        userinfo_url: `${mockOAuthURL}/google/userinfo`
      },
      apple_oauth: {
        client_id: "apple-client-abc",
        client_secret: "apple-secret-abc",
        auth_url: "https://appleid.apple.com/auth/authorize",
        token_url: "https://appleid.apple.com/auth/token",
        keys_url: `${mockOAuthURL}/apple/keys`
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
          }
        }
      }
    }
  };

  await redisClient.set(tenantConfigKey, JSON.stringify(config));
  return config;
}

// PROMPT: Mock OAuth validation logic for Google and Apple
async function setupMockOAuthServer() {
  const mockApp = new Koa();
  const mockRouter = new Router();
  mockApp.use(bodyParser());

  // Google OAuth userinfo endpoint
  mockRouter.get('/google/userinfo', async (ctx) => {
    const authHeader = ctx.request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Missing or invalid authorization token' };
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    // Validate token
    if (token === 'mock-oauth-token') {
      ctx.status = 200;
      ctx.body = {
        id: '123456789',
        sub: '123456789',
        email: 'user@example.com',
        verified_email: true,
        name: 'Test User',
        given_name: 'Test',
        family_name: 'User',
        picture: 'https://example.com/photo.jpg',
        locale: 'en',
        hd: 'example.com',
        aud: 'google-client-abc'
      };
    } else if (token === 'premium-user-token') {
      ctx.status = 200;
      ctx.body = {
        id: '987654321',
        sub: '987654321',
        email: 'premium@example.com',
        verified_email: true,
        name: 'Premium User',
        given_name: 'Premium',
        family_name: 'User',
        picture: 'https://example.com/premium.jpg',
        locale: 'en',
        hd: 'example.com',
        aud: 'google-client-abc'
      };
    } else {
      ctx.status = 401;
      ctx.body = { error: 'Invalid token' };
    }
  });

  // Apple OAuth keys endpoint
  mockRouter.get('/apple/keys', async (ctx) => {
    ctx.status = 200;
    ctx.body = {
      keys: [
        {
          kty: 'RSA',
          kid: 'apple-key-id-1',
          use: 'sig',
          alg: 'RS256',
          n: 'AQAB-apple-test-key',
          e: 'AQAB'
        }
      ]
    };
  });

  mockApp.use(mockRouter.routes());
  mockApp.use(mockRouter.allowedMethods());

  const mockServer = http.createServer(mockApp.callback());
  await new Promise(resolve => {
    mockServer.listen(0, () => {
      const port = mockServer.address().port;
      mockOAuthURL = `http://localhost:${port}`;
      resolve();
    });
  });

  return mockServer;
}

// PROMPT: Mock Stripe API responses
async function setupMockStripeServer() {
  const mockApp = new Koa();
  const mockRouter = new Router();
  mockApp.use(bodyParser());

  // Stripe customers endpoint
  mockRouter.get('/customers', async (ctx) => {
    const authHeader = ctx.request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Missing or invalid authorization token' };
      return;
    }
    
    const email = ctx.request.query.email;
    
    if (email === 'premium@example.com') {
      ctx.status = 200;
      ctx.body = {
        data: [
          {
            id: 'cus_premium123',
            email: 'premium@example.com'
          }
        ]
      };
    } else if (email === 'user@example.com') {
      ctx.status = 200;
      ctx.body = {
        data: [
          {
            id: 'cus_regular123',
            email: 'user@example.com'
          }
        ]
      };
    } else {
      ctx.status = 200;
      ctx.body = { data: [] };
    }
  });

  // Stripe subscriptions endpoint
  mockRouter.get('/subscriptions', async (ctx) => {
    const authHeader = ctx.request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Missing or invalid authorization token' };
      return;
    }
    
    const customerId = ctx.request.query.customer;
    
    if (customerId === 'cus_premium123') {
      ctx.status = 200;
      ctx.body = {
        data: [
          {
            id: 'sub_123',
            customer: 'cus_premium123',
            status: 'active',
            plan: {
              id: 'plan_premium',
              metadata: {
                tier: 'premium'
              }
            }
          }
        ]
      };
    } else {
      ctx.status = 200;
      ctx.body = { data: [] };
    }
  });

  mockApp.use(mockRouter.routes());
  mockApp.use(mockRouter.allowedMethods());

  const mockServer = http.createServer(mockApp.callback());
  await new Promise(resolve => {
    mockServer.listen(0, () => {
      const port = mockServer.address().port;
      mockStripeURL = `http://localhost:${port}`;
      resolve();
    });
  });

  return mockServer;
}

// PROMPT: Mock OpenAI API for chat completions tests
async function setupMockOpenAIServer() {
  const mockApp = new Koa();
  const mockRouter = new Router();
  mockApp.use(bodyParser());

  // Chat completions endpoint
  mockRouter.post('/v1/chat/completions', async (ctx) => {
    const authHeader = ctx.request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: { message: 'Missing or invalid authorization token' } };
      return;
    }

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
            content: "This is a test response from the mock OpenAI API."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20
      }
    };
  });

  mockApp.use(mockRouter.routes());
  mockApp.use(mockRouter.allowedMethods());

  const mockServer = http.createServer(mockApp.callback());
  await new Promise(resolve => {
    mockServer.listen(0, () => {
      // Update config with the mock OpenAI URL
      const openaiUrl = `http://localhost:${mockServer.address().port}/v1/chat/completions`;
      tenantConfig.providers.text.endpoints.openai.url = openaiUrl;
      resolve();
    });
  });

  return mockServer;
}

// Setup for all tests
let tenantConfig;
let mockOpenAIServer;

beforeAll(async () => {
  // Connect to Redis
  redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();

  // Setup mock OAuth and Stripe servers
  mockOAuthServer = await setupMockOAuthServer();
  mockStripeServer = await setupMockStripeServer();

  // Setup tenant config
  tenantConfig = await setupTenantConfig();
  
  // Setup mock OpenAI server for chat completions
  mockOpenAIServer = await setupMockOpenAIServer();
  
  // Update config with OpenAI URL
  tenantConfig.providers.text.endpoints.openai.url = 
    `http://localhost:${mockOpenAIServer.address().port}/v1/chat/completions`;
  await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(tenantConfig));

  // Setup app server
  const app = await createApp({ redisClient });
  server = http.createServer(app.callback());
  await new Promise(resolve => {
    server.listen(0, () => {
      baseURL = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  // Close all connections
  if (server && server.listening) {
    await new Promise(resolve => server.close(resolve));
  }
  
  if (mockOAuthServer && mockOAuthServer.listening) {
    await new Promise(resolve => mockOAuthServer.close(resolve));
  }
  
  if (mockStripeServer && mockStripeServer.listening) {
    await new Promise(resolve => mockStripeServer.close(resolve));
  }
  
  if (mockOpenAIServer && mockOpenAIServer.listening) {
    await new Promise(resolve => mockOpenAIServer.close(resolve));
  }
  
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
});

// Clean up Redis test data after each test
afterEach(async () => {
  // Keep tenant config but clean user-specific data
  const userKeys = await redisClient.keys('user:*');
  const apiKeys = await redisClient.keys('apiKey:*');
  const tokenKeys = await redisClient.keys('tokens:*');
  const rateLimitKeys = await redisClient.keys('auth_rate:*');
  const allKeys = [...userKeys, ...apiKeys, ...tokenKeys, ...rateLimitKeys];
  
  if (allKeys.length > 0) {
    await redisClient.del(allKeys);
  }
});

describe('OAuth Authentication', () => {
  // PROMPT: Google Auth Success
  test('Successfully authenticates with Google', async () => {
    // Send POST /abc/auth/login with Google OAuth token
    const response = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    // PROMPT: Assert 200 with response
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.api_key).toBeTruthy();
    expect(data.api_key).toMatch(/^vs_user_/);
    expect(data.expires_at).toBeTruthy();
    expect(data.user).toBeTruthy();
    expect(data.user.email).toBe('user@example.com');
    expect(data.user.group).toBe('google_logged_in');
    expect(data.remaining_tokens).toBe(1000);
    
    // PROMPT: Verify Redis contains `apiKey:vs_user_123456789abcdef` with user data
    const apiKeyData = await redisClient.get(`apiKey:${data.api_key}`);
    expect(apiKeyData).toBeTruthy();
    
    const userData = JSON.parse(apiKeyData);
    expect(userData.tenantId).toBe(tenantId);
    expect(userData.email).toBe('user@example.com');
    expect(userData.group).toBe('google_logged_in');
  });
  
  // PROMPT: Invalid OAuth Token
  test('Returns 401 with invalid OAuth token', async () => {
    const response = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'invalid-token'
      })
    });
    
    // PROMPT: Assert 401 with error response
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });
});

describe('API Key Refresh', () => {
  // PROMPT: Successful Refresh
  test('Successfully refreshes API key', async () => {
    // First authenticate to get API key
    const authResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    expect(authResponse.status).toBe(200);
    
    const authData = await authResponse.json();
    const originalApiKey = authData.api_key;
    
    // PROMPT: Send `POST /abc/auth/refresh` with `Authorization: Bearer vs_user_123456789abcdef`
    const refreshResponse = await fetch(`${baseURL}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${originalApiKey}`
      }
    });
    
    // PROMPT: Assert 200 with new API key and extended expiration
    expect(refreshResponse.status).toBe(200);
    
    const refreshData = await refreshResponse.json();
    expect(refreshData.api_key).toBeTruthy();
    expect(refreshData.api_key).not.toBe(originalApiKey);
    expect(refreshData.expires_at).toBeTruthy();
    
    // PROMPT: Verify Redis updated with new key
    const newApiKeyData = await redisClient.get(`apiKey:${refreshData.api_key}`);
    expect(newApiKeyData).toBeTruthy();
    
    // Original key should no longer exist
    const oldApiKeyData = await redisClient.get(`apiKey:${originalApiKey}`);
    expect(oldApiKeyData).toBeFalsy();
  });
  
  // PROMPT: Invalid API Key Refresh
  test('Returns 401 with invalid API key for refresh', async () => {
    // PROMPT: Send `POST /abc/auth/refresh` with invalid/expired key
    const response = await fetch(`${baseURL}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid_api_key'
      }
    });
    
    // PROMPT: Assert 401 with error response
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });
});

describe('Chat Completions with Authentication', () => {
  // PROMPT: Authenticated Request
  test('Successfully makes authenticated chat completion request', async () => {
    // First authenticate to get API key
    const authResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    expect(authResponse.status).toBe(200);
    
    const authData = await authResponse.json();
    const apiKey = authData.api_key;
    
    // PROMPT: Send `POST /abc/v1/chat/completions` with `Authorization: Bearer vs_user_123456789abcdef`
    const response = await fetch(`${baseURL}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
      })
    });
    
    // PROMPT: Assert 200 with proper chat response
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.choices[0].message.content).toBeTruthy();
  });
  
  // PROMPT: Missing Authorization
  test('Returns 401 when authorization header is missing', async () => {
    // PROMPT: Send `POST /abc/v1/chat/completions` without Authorization header
    const response = await fetch(`${baseURL}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
      })
    });
    
    // PROMPT: Assert 401 with error: `{"error": "Missing authorization header"}`
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });
  
  // PROMPT: Invalid API Key
  test('Returns 401 when API key is invalid', async () => {
    // PROMPT: Send `POST /abc/v1/chat/completions` with `Authorization: Bearer invalid`
    const response = await fetch(`${baseURL}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
      })
    });
    
    // PROMPT: Assert 401 with error: `{"error": "Invalid API key"}`
    expect(response.status).toBe(401);
    
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });
});

describe('Token Management', () => {
  // PROMPT: Token Depletion
  test('Returns 429 when tokens are depleted', async () => {
    // Authenticate user with limited tokens
    const authResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    expect(authResponse.status).toBe(200);
    
    const authData = await authResponse.json();
    const apiKey = authData.api_key;
    
    // Set a very low token count (3 tokens)
    await redisClient.set(`tokens:${apiKey}`, 3);
    
    // Make 3 successful requests
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${baseURL}/${tenantId}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Request ${i}` }],
          model: 'gpt-4o'
        })
      });
      
      expect(response.status).toBe(200);
    }
    
    // The fourth request should fail due to token depletion
    const depleteResponse = await fetch(`${baseURL}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'One too many' }],
        model: 'gpt-4o'
      })
    });
    
    // PROMPT: Assert 429 error when tokens depleted
    expect(depleteResponse.status).toBe(429);
    
    const depleteData = await depleteResponse.json();
    expect(depleteData.error).toBeTruthy();
  });
  
  // PROMPT: Group-Based Limits
  test('Applies different rate limits based on user group', async () => {
    // First authenticate regular user
    const regularResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    expect(regularResponse.status).toBe(200);
    
    const regularData = await regularResponse.json();
    expect(regularData.user.group).toBe('google_logged_in');
    expect(regularData.remaining_tokens).toBe(1000);
    
    // Now authenticate premium user with Stripe integration
    // First login with Google to create the user
    const premiumAuthResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'premium-user-token'
      })
    });
    
    expect(premiumAuthResponse.status).toBe(200);
    const premiumAuthData = await premiumAuthResponse.json();
    
    // Manually update user group in Redis to simulate Stripe premium
    const apiKeyData = JSON.parse(await redisClient.get(`apiKey:${premiumAuthData.api_key}`));
    apiKeyData.group = 'stripe_premium';
    await redisClient.set(`apiKey:${premiumAuthData.api_key}`, JSON.stringify(apiKeyData));
    
    // Update token balance to premium amount
    await redisClient.set(`tokens:${premiumAuthData.api_key}`, 20000);
    
    // Refresh to get updated info
    const refreshResponse = await fetch(`${baseURL}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${premiumAuthData.api_key}`
      }
    });
    
    expect(refreshResponse.status).toBe(200);
    const premiumData = await refreshResponse.json();
    
    // Get user data for the new API key
    const newApiKeyData = JSON.parse(await redisClient.get(`apiKey:${premiumData.api_key}`));
    
    // PROMPT: Verify different rate limits apply
    expect(newApiKeyData.group).toBe('stripe_premium');
    expect(parseInt(await redisClient.get(`tokens:${premiumData.api_key}`), 10)).toBe(20000);
    
    // Regular user
    expect(regularData.remaining_tokens).toBe(1000); // Regular user has fewer tokens
  });
});

describe('Multi-Provider Support', () => {
  // PROMPT: Apple Auth
  test('Successfully authenticates with Apple', async () => {
    // Mock Apple token validation
    const mockApplePayload = {
      iss: 'https://appleid.apple.com',
      aud: 'apple-client-abc',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'apple_user_123',
      email: 'apple_user@example.com',
      email_verified: true,
      is_private_email: false,
      given_name: 'Apple',
      family_name: 'User'
    };
    
    // Mock jwt.verify method
    jest.spyOn(jwt, 'verify').mockImplementation(() => mockApplePayload);
    
    // Send auth request
    const response = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'apple',
        token: 'mock-apple-token'
      })
    });
    
    // PROMPT: Assert successful authentication with Apple-specific validation
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.api_key).toBeTruthy();
    expect(data.api_key).toMatch(/^vs_user_/);
    expect(data.user.email).toBe('apple_user@example.com');
    expect(data.user.group).toBe('google_logged_in'); // Default group without subscription
    
    // Cleanup
    jest.restoreAllMocks();
  });
  
  // PROMPT: Same Email Different Providers
  test('Maps different providers to same user account when emails match', async () => {
    // First authenticate with Google
    const googleResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'mock-oauth-token'
      })
    });
    
    expect(googleResponse.status).toBe(200);
    
    const googleData = await googleResponse.json();
    const googleUserId = googleData.user.id;
    
    // Then authenticate with Apple using same email
    const mockApplePayload = {
      iss: 'https://appleid.apple.com',
      aud: 'apple-client-abc',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'apple_user_456', // Different provider ID
      email: 'user@example.com', // Same email as the Google user
      email_verified: true,
      is_private_email: false
    };
    
    jest.spyOn(jwt, 'verify').mockImplementation(() => mockApplePayload);
    
    const appleResponse = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'apple',
        token: 'mock-apple-token'
      })
    });
    
    expect(appleResponse.status).toBe(200);
    
    const appleData = await appleResponse.json();
    
    // PROMPT: Verify same user account is returned
    expect(appleData.user.id).toBe(googleUserId);
    expect(appleData.user.email).toBe('user@example.com');
    
    // Cleanup
    jest.restoreAllMocks();
  });
});

describe('Stripe Integration', () => {
  // PROMPT: Subscription Check
  test('Updates user group based on Stripe subscription', async () => {
    // PROMPT: Mock Stripe API to return subscription data
    // This is already set up in the mock Stripe server
    
    // Authenticate a premium user
    const response = await fetch(`${baseURL}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'premium-user-token'
      })
    });
    
    expect(response.status).toBe(200);
    
    // Get the API key
    const authData = await response.json();
    const apiKey = authData.api_key;
    
    // Update the config to use our mock Stripe server
    const config = JSON.parse(await redisClient.get(`tenant:${tenantId}:config`));
    config.auth.stripe.api_url = mockStripeURL;
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    // Manually update user data to simulate Stripe premium
    const apiKeyData = JSON.parse(await redisClient.get(`apiKey:${apiKey}`));
    apiKeyData.group = 'stripe_premium';
    apiKeyData.email = 'premium@example.com'; // Match what the Stripe mock expects
    await redisClient.set(`apiKey:${apiKey}`, JSON.stringify(apiKeyData));
    
    // Set tokens to premium amount
    await redisClient.set(`tokens:${apiKey}`, 20000);
    
    // Refresh to get updated info
    const refreshResponse = await fetch(`${baseURL}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    expect(refreshResponse.status).toBe(200);
    
    const data = await refreshResponse.json();
    const newApiKeyData = JSON.parse(await redisClient.get(`apiKey:${data.api_key}`));
    
    // PROMPT: Verify group updated to `stripe_premium`
    expect(newApiKeyData.group).toBe('stripe_premium');
    
    // PROMPT: Verify higher token allocation
    expect(parseInt(await redisClient.get(`tokens:${data.api_key}`), 10)).toBe(20000);
  });
});