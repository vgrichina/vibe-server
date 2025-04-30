import { jest } from '@jest/globals';
import { createApp } from '../bin/server.js';
import { createClient } from 'redis';
import http from 'http';
import crypto from 'crypto';
import jsonwebtoken from 'jsonwebtoken';

// PROMPT: Use Node's `http` module for requests, Mock OAuth validation logic for Google and Apple, Mock Stripe API responses
describe('SSO Integration Tests', () => {
  let redisClient;
  let app;
  let server;
  let baseUrl;
  let tenantId = 'abc';
  
  // Mock servers
  let mockGoogleServer;
  let mockAppleServer;
  let mockStripeServer;
  let mockOpenAIServer;
  
  beforeAll(async () => {
    // Connect to Redis
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    redisClient.on('error', (err) => console.error(`Redis Test Client Error: ${err}`));
    await redisClient.connect();
    
    // PROMPT: Mock OAuth validation logic for Google and Apple
    mockGoogleServer = setupMockGoogleServer();
    mockAppleServer = setupMockAppleServer();
    mockStripeServer = setupMockStripeServer();
    mockOpenAIServer = setupMockOpenAIServer();
    
    await mockGoogleServer.listen(0); // Use random port
    await mockAppleServer.listen(0);
    await mockStripeServer.listen(0);
    await mockOpenAIServer.listen(0);
    
    const googlePort = mockGoogleServer.address().port;
    const applePort = mockAppleServer.address().port;
    const stripePort = mockStripeServer.address().port;
    const openaiPort = mockOpenAIServer.address().port;
    
    // PROMPT: Use test fixtures for tenant configurations
    const tenantConfig = {
      auth: {
        stripe: {
          api_key: "sk_test_abc123",
          api_url: `http://localhost:${stripePort}/v1`
        },
        google_oauth: {
          client_id: "google-client-abc",
          client_secret: "google-secret-abc",
          auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
          token_url: "https://oauth2.googleapis.com/token",
          userinfo_url: `http://localhost:${googlePort}/oauth2/v1/userinfo`
        },
        apple_oauth: {
          client_id: "com.example.app",
          client_secret: "apple-secret-abc",
          auth_url: "https://appleid.apple.com/auth/authorize",
          token_url: "https://appleid.apple.com/auth/token",
          keys_url: `http://localhost:${applePort}/auth/keys`
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
              url: `http://localhost:${openaiPort}/v1/chat/completions`,
              default_model: "gpt-4o",
              api_key: "sk-abc123"
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
    // Close servers and connections
    server.close();
    mockGoogleServer.close();
    mockAppleServer.close();
    mockStripeServer.close();
    mockOpenAIServer.close();
    await redisClient.flushDb(); // Clean database
    await redisClient.quit();
  });
  
  afterEach(async () => {
    // Clean up user and API key data after each test
    const keyPatterns = [
      'apiKey:vs_user_*',
      'user:user_*',
      'tenant:abc:user:email:*'
    ];
    
    for (const pattern of keyPatterns) {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }
  });
  
  // PROMPT: OAuth Authentication - Google Auth Success
  test('Google OAuth authentication - success', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    expect(response.status).toBe(200);
    
    const responseData = await response.json();
    expect(responseData.api_key).toBeDefined();
    expect(responseData.api_key).toMatch(/^vs_user_[a-f0-9]+$/);
    expect(responseData.expires_at).toBeDefined();
    expect(responseData.user.email).toBe('user@example.com');
    expect(responseData.user.group).toBe('google_logged_in');
    expect(responseData.remaining_tokens).toBe(1000);
    
    // PROMPT: Verify Redis contains `apiKey:vs_user_123456789abcdef` with user data
    const apiKey = responseData.api_key;
    const userData = await redisClient.get(`apiKey:${apiKey}`);
    expect(userData).toBeDefined();
    
    const userDataObj = JSON.parse(userData);
    expect(userDataObj.tenantId).toBe(tenantId);
    expect(userDataObj.email).toBe('user@example.com');
    expect(userDataObj.group).toBe('google_logged_in');
  });
  
  // PROMPT: Invalid OAuth Token
  test('Google OAuth authentication - invalid token', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'invalid-token'
      })
    });
    
    expect(response.status).toBe(401);
    
    const errorData = await response.json();
    expect(errorData.error).toBeDefined();
  });
  
  // PROMPT: API Key Refresh - Successful Refresh
  test('API key refresh - success', async () => {
    // First authenticate to get API key
    const loginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    expect(loginResponse.status).toBe(200);
    const loginData = await loginResponse.json();
    const apiKey = loginData.api_key;
    
    // Now refresh the API key
    const refreshResponse = await fetch(`${baseUrl}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    expect(refreshResponse.status).toBe(200);
    
    const refreshData = await refreshResponse.json();
    expect(refreshData.api_key).toBeDefined();
    expect(refreshData.api_key).not.toBe(apiKey); // New key should be different
    expect(refreshData.expires_at).toBeDefined();
    
    // PROMPT: Verify Redis updated with new key
    const newApiKey = refreshData.api_key;
    const newUserData = await redisClient.get(`apiKey:${newApiKey}`);
    expect(newUserData).toBeDefined();
    
    // Old API key should be invalidated
    const oldUserData = await redisClient.get(`apiKey:${apiKey}`);
    expect(oldUserData).toBeNull();
  });
  
  // PROMPT: Invalid API Key Refresh
  test('API key refresh - invalid key', async () => {
    const refreshResponse = await fetch(`${baseUrl}/${tenantId}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-key'
      }
    });
    
    expect(refreshResponse.status).toBe(401);
    
    const errorData = await refreshResponse.json();
    expect(errorData.error).toBeDefined();
  });
  
  // PROMPT: Chat Completions with Authentication - Authenticated Request
  test('Chat completions - authenticated request', async () => {
    // First authenticate to get API key
    const loginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    expect(loginResponse.status).toBe(200);
    const loginData = await loginResponse.json();
    const apiKey = loginData.api_key;
    
    // Send chat completion request with API key
    const chatResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
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
    
    expect(chatResponse.status).toBe(200);
    
    const chatData = await chatResponse.json();
    expect(chatData.choices).toBeDefined();
    expect(chatData.choices[0].message.content).toBeDefined();
  });
  
  // PROMPT: Missing Authorization Header
  test('Chat completions - missing authorization', async () => {
    const chatResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // Missing Authorization header
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
      })
    });
    
    expect(chatResponse.status).toBe(401);
    
    const errorData = await chatResponse.json();
    expect(errorData.error).toBeDefined();
  });
  
  // PROMPT: Invalid API Key
  test('Chat completions - invalid API key', async () => {
    const chatResponse = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer invalid-key'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4o'
      })
    });
    
    expect(chatResponse.status).toBe(401);
    
    const errorData = await chatResponse.json();
    expect(errorData.error).toBeDefined();
  });
  
  // PROMPT: Token Depletion
  test('Token management - token depletion', async () => {
    // First authenticate to get API key
    const loginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    expect(loginResponse.status).toBe(200);
    const loginData = await loginResponse.json();
    const apiKey = loginData.api_key;
    const userId = JSON.parse(await redisClient.get(`apiKey:${apiKey}`)).userId;
    const userDataKey = `user:${userId}`;
    
    // Make first chat completion request
    const chatResponse1 = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
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
    
    expect(chatResponse1.status).toBe(200);
    
    // Set tokens to 0
    const updatedUserData = JSON.parse(await redisClient.get(userDataKey) || '{}');
    updatedUserData.tokensLeft = 0;
    await redisClient.set(userDataKey, JSON.stringify(updatedUserData));
    
    // Set tokens used to max
    await redisClient.set(`tokens:${apiKey}:used`, '1000');
    
    // Make another request that should fail due to token depletion
    const chatResponse2 = await fetch(`${baseUrl}/${tenantId}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello again' }],
        model: 'gpt-4o'
      })
    });
    
    expect(chatResponse2.status).toBe(429);
    
    const errorData = await chatResponse2.json();
    expect(errorData.error).toBeDefined();
    expect(errorData.error.message).toContain('Insufficient tokens');
  });
  
  // PROMPT: Group-Based Limits
  test('Token management - group-based limits', async () => {
    // First user with google_logged_in group
    const googleLoginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    expect(googleLoginResponse.status).toBe(200);
    const googleLoginData = await googleLoginResponse.json();
    const googleUserTokens = googleLoginData.remaining_tokens;
    
    // Now set up a "premium" user by manipulating Stripe API response for next auth
    const stripeCustomerId = 'cus_premium123';
    await redisClient.set('mock:stripe:premium_customer', stripeCustomerId);
    
    // Re-authenticate same user to get premium status
    const premiumLoginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'valid-google-token'
      })
    });
    
    const premiumReauthData = await premiumLoginResponse.json();
    
    // Verify premium user has higher token allocation
    expect(premiumReauthData.user.group).toBe('stripe_premium');
    expect(premiumReauthData.remaining_tokens).toBeGreaterThan(googleUserTokens);
  });
  
  // PROMPT: Apple Auth
  test('Apple OAuth authentication - success', async () => {
    const response = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'apple',
        token: 'valid-apple-token'
      })
    });
    
    expect(response.status).toBe(200);
    
    const responseData = await response.json();
    expect(responseData.api_key).toBeDefined();
    expect(responseData.user.email).toBe('apple.user@example.com');
    expect(responseData.user.group).toBe('google_logged_in');
    expect(responseData.remaining_tokens).toBe(1000);
  });
  
  // PROMPT: Same Email Different Providers
  test('Multi-provider support - same email different providers', async () => {
    // First authenticate with Google
    const googleResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'same-email-token'
      })
    });
    
    expect(googleResponse.status).toBe(200);
    
    const googleData = await googleResponse.json();
    const googleUserId = googleData.user.id;
    
    // Now authenticate with Apple using same email
    const appleResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'apple',
        token: 'same-email-apple-token'
      })
    });
    
    expect(appleResponse.status).toBe(200);
    
    const appleData = await appleResponse.json();
    const appleUserId = appleData.user.id;
    
    // Verify same user account is returned
    expect(appleUserId).toBe(googleUserId);
  });
  
  // PROMPT: Stripe Integration - Subscription Check
  test('Stripe integration - subscription check', async () => {
    // Setup premium customer in mock Stripe API
    const stripeCustomerId = 'cus_premium_upgrade';
    await redisClient.set('mock:stripe:premium_customer', stripeCustomerId);
    
    // First authenticate to create user
    const loginResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'stripe-test-token'
      })
    });
    
    expect(loginResponse.status).toBe(200);
    const loginData = await loginResponse.json();
    
    // Verify first login is google_logged_in
    expect(loginData.user.group).toBe('google_logged_in');
    
    // Set up Stripe mock to return premium subscription
    await redisClient.set('mock:stripe:premium_subscription', 'true');
    
    // Re-authenticate to trigger subscription check
    const reauthResponse = await fetch(`${baseUrl}/${tenantId}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'google',
        token: 'stripe-test-token'
      })
    });
    
    const reauthData = await reauthResponse.json();
    
    // PROMPT: Verify group updated to `stripe_premium`
    expect(reauthData.user.group).toBe('stripe_premium');
    
    // PROMPT: Verify higher token allocation
    const tenantConfig = JSON.parse(await redisClient.get(`tenant:${tenantId}:config`));
    const premiumTokens = tenantConfig.user_groups.stripe_premium.tokens;
    expect(reauthData.remaining_tokens).toBe(premiumTokens);
  });
  
  // Helper function to setup mock Google OAuth server
  function setupMockGoogleServer() {
    // PROMPT: Mock OAuth validation logic for Google
    return http.createServer((req, res) => {
      const authHeader = req.headers.authorization || '';
      
      if (req.url === '/oauth2/v1/userinfo') {
        if (authHeader.includes('valid-google-token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'google_12345',
            email: 'user@example.com',
            verified_email: true,
            name: 'Test User',
            given_name: 'Test',
            family_name: 'User',
            picture: 'https://example.com/photo.jpg'
          }));
        } else if (authHeader.includes('same-email-token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'google_12345',
            email: 'same@example.com', // Same email for multi-provider test
            verified_email: true,
            name: 'Same Email User',
            given_name: 'Same',
            family_name: 'User'
          }));
        } else if (authHeader.includes('stripe-test-token')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'google_stripe_test',
            email: 'premium@example.com',
            verified_email: true,
            name: 'Premium User'
          }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Invalid token'
          }));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  }
  
  // Helper function to setup mock Apple OAuth server
  function setupMockAppleServer() {
    // PROMPT: Mock OAuth validation logic for Apple
    const privateKey = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048
    }).privateKey;
    
    const publicKey = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048
    }).publicKey;
    
    const jwk = {
      kty: 'RSA',
      kid: 'apple-key-1',
      use: 'sig',
      alg: 'RS256',
      n: publicKey.export({ format: 'jwk' }).n,
      e: publicKey.export({ format: 'jwk' }).e
    };
    
    // Generate valid Apple token
    const validAppleToken = jsonwebtoken.sign({
      iss: 'https://appleid.apple.com',
      aud: 'com.example.app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'apple_user_12345',
      email: 'apple.user@example.com',
      email_verified: true
    }, privateKey, { algorithm: 'RS256', keyid: 'apple-key-1' });
    
    // Generate token with same email as Google
    const sameEmailToken = jsonwebtoken.sign({
      iss: 'https://appleid.apple.com',
      aud: 'com.example.app',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'apple_user_67890',
      email: 'same@example.com', // Same email for multi-provider test
      email_verified: true
    }, privateKey, { algorithm: 'RS256', keyid: 'apple-key-1' });
    
    return http.createServer((req, res) => {
      if (req.url === '/auth/keys') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          keys: [jwk]
        }));
      } else if (req.url === '/validate') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            const token = data.token;
            
            if (token === 'valid-apple-token') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(validAppleToken);
            } else if (token === 'same-email-apple-token') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(sameEmailToken);
            } else {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid token' }));
            }
          } catch (e) {
            res.writeHead(400);
            res.end();
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  }
  
  // Helper function to setup mock Stripe server
  function setupMockStripeServer() {
    // PROMPT: Mock Stripe API responses
    return http.createServer(async (req, res) => {
      const urlObj = new URL(req.url, 'http://localhost');
      
      if (urlObj.pathname === '/v1/customers' && urlObj.searchParams.has('email')) {
        const email = urlObj.searchParams.get('email');
        
        // Check if we need to return a premium customer
        const premiumCustomerId = await redisClient.get('mock:stripe:premium_customer');
        const hasPremium = !!premiumCustomerId;
        
        if (email === 'premium@example.com' && hasPremium) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: [{
              id: premiumCustomerId,
              email: email,
              created: Math.floor(Date.now() / 1000),
              name: 'Premium User'
            }]
          }));
        } else if (email) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: [{
              id: 'cus_regular123',
              email: email,
              created: Math.floor(Date.now() / 1000),
              name: 'Regular User'
            }]
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        }
      } else if (urlObj.pathname === '/v1/subscriptions' && urlObj.searchParams.has('customer')) {
        const hasPremiumSubscription = await redisClient.get('mock:stripe:premium_subscription');
        
        if (hasPremiumSubscription) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            data: [{
              id: 'sub_premium123',
              customer: urlObj.searchParams.get('customer'),
              status: 'active',
              current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
              plan: {
                id: 'plan_premium',
                nickname: 'Premium Plan',
                amount: 19900
              }
            }]
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [] }));
        }
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
  }
  
  // Helper function to setup mock OpenAI server
  function setupMockOpenAIServer() {
    return http.createServer((req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-mock123',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: data.model || 'gpt-4o',
              choices: [{
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'This is a mock response from the OpenAI API.'
                },
                finish_reason: 'stop'
              }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 20,
                total_tokens: 30
              }
            }));
          } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid request' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  }
});