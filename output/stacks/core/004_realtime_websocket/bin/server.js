import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import websockify from 'koa-easy-ws';
import { handleChatCompletions } from '../src/endpoints/chat.js';
import realtimeEndpoints from '../src/endpoints/realtime.js';

// PROMPT: Store tenant configs in Redis using the key pattern: `tenant:<tenantId>:config`.
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

// PROMPT: Expose `createApp` function
export async function createApp(deps) {
  const app = new Koa();
  const router = new Router();
  const redisClient = deps?.redisClient || createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  
  // PROMPT: Use `koa-easy-ws` with `ws` npm package.
  app.use(websockify());
  
  // Make Redis client available to all routes
  app.redisClient = redisClient;
  
  // PROMPT: Ensure Redis client is initialized before the server starts listening.
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
    } catch (error) {
      console.error(`[ERROR] Redis connection failed: ${error.message}`);
      process.exit(1);
    }
  }

  // PROMPT: Ensure default tenant config is set up
  const defaultTenantKey = 'tenant:abc:config';
  const existingConfig = await redisClient.get(defaultTenantKey);
  if (!existingConfig) {
    await redisClient.set(defaultTenantKey, JSON.stringify(DEFAULT_TENANT_CONFIG));
  }

  // PROMPT: Catch uncaught exceptions and log them to console with prefix `[ERROR]`.
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[ERROR] ${err.stack || err.message}`);
      ctx.status = 500;
      ctx.body = { error: 'Internal Server Error' };
    }
  });

  app.use(bodyParser());

  // PROMPT: Root Endpoint Returns a JSON response: `{"message": "vibe-server API is running"}`
  router.get('/', (ctx) => {
    ctx.status = 200;
    ctx.set('Content-Type', 'application/json');
    ctx.body = { message: 'vibe-server API is running' };
  });

  // PROMPT: Fetch the tenant config from Redis using `GET` and parse with `JSON.parse`.
  const tenantMiddleware = async (ctx, next) => {
    const { tenantId } = ctx.params;
    const tenantConfigKey = `tenant:${tenantId}:config`;
    const tenantConfig = await redisClient.get(tenantConfigKey);

    if (!tenantConfig) {
      ctx.status = 400;
      ctx.body = { error: 'Invalid tenant ID' };
      return;
    }

    ctx.state.tenantConfig = JSON.parse(tenantConfig);
    console.log(`[INFO] Loaded tenant config for ${tenantId}`);
    await next();
  };

  // PROMPT: Create new temporary user in Redis with anonymous user group limits
  router.post('/:tenantId/auth/anonymous', tenantMiddleware, async (ctx) => {
    const { tenantId } = ctx.params;
    const { tenantConfig } = ctx.state;
    const userId = `anonymous_${uuidv4()}`;
    const apiKey = `temp_${uuidv4()}`;
    const tokensLeft = tenantConfig.user_groups.anonymous.tokens;
    
    const userData = {
      createdAt: new Date().toISOString(),
      tokensLeft,
      userGroup: 'anonymous'
    };
    
    await redisClient.set(`user:${userId}`, JSON.stringify(userData));
    await redisClient.set(`apiKey:${apiKey}`, userId);
    
    ctx.status = 200;
    ctx.body = {
      apiKey,
      tokensLeft
    };
  });

  // PROMPT: GET retrieves current tenant config for the specified tenant.
  router.get('/:tenantId/admin/config', tenantMiddleware, async (ctx) => {
    // Basic admin auth check - in a real implementation, this would be more robust
    const authHeader = ctx.request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }
    
    ctx.status = 200;
    ctx.body = {
      config: ctx.state.tenantConfig
    };
  });

  // PROMPT: PUT updates tenant config (full replace).
  router.put('/:tenantId/admin/config', tenantMiddleware, async (ctx) => {
    const { tenantId } = ctx.params;
    const authHeader = ctx.request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Unauthorized' };
      return;
    }
    
    const { config } = ctx.request.body;
    if (!config) {
      ctx.status = 400;
      ctx.body = { error: 'Config object is required' };
      return;
    }
    
    await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
    
    ctx.status = 200;
    ctx.body = { success: true };
  });

  // PROMPT: Add the `/:tenantId/v1/chat/completions` endpoint
  router.post('/:tenantId/v1/chat/completions', tenantMiddleware, handleChatCompletions);

  // PROMPT: Initialize Endpoint: `POST /v1/realtime/initialize`
  router.post('/v1/realtime/initialize', realtimeEndpoints.initializeRealtimeSession);

  // PROMPT: WebSocket Endpoint: `/v1/realtime/stream`
  router.get('/v1/realtime/stream', realtimeEndpoints.handleRealtimeStream);

  app.use(router.routes());
  app.use(router.allowedMethods());

  // PROMPT: Ensure the server shuts down gracefully on SIGTERM/SIGINT
  const gracefulShutdown = async () => {
    console.log('[INFO] Server shutting down');
    await redisClient.quit();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  return app;
}

// PROMPT: Don't start server when used as a module.
if (import.meta.url.endsWith(process.argv[1])) {
  const app = await createApp();
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || 'localhost';
  
  app.listen(port, host, () => {
    console.log(`[INFO] Server listening on http://${host}:${port}`);
  });
}