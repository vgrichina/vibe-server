import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

// Default configurations
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis client
const createRedisClient = async () => {
  const client = createClient({ url: REDIS_URL });
  
  client.on('error', (err) => {
    console.error(`[ERROR] Redis connection failed: ${err}`);
    process.exit(1);
  });

  await client.connect();
  return client;
};

// Default tenant configuration for "abc"
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

// Setup initial tenant config if it doesn't exist
const setupInitialTenantConfig = async (redisClient) => {
  const tenantId = 'abc';
  const key = `tenant:${tenantId}:config`;
  const existingConfig = await redisClient.get(key);
  
  if (!existingConfig) {
    await redisClient.set(key, JSON.stringify(DEFAULT_TENANT_CONFIG));
    console.log(`[INFO] Created initial tenant config for ${tenantId}`);
  } else {
    console.log(`[INFO] Using existing tenant config for ${tenantId}`);
  }
};

// Middleware to verify and load tenant config
const tenantMiddleware = (redisClient) => async (ctx, next) => {
  const tenantId = ctx.params.tenantId;
  if (!tenantId) {
    ctx.status = 400;
    ctx.body = { error: "Tenant ID is required" };
    return;
  }

  try {
    const configJson = await redisClient.get(`tenant:${tenantId}:config`);
    if (!configJson) {
      ctx.status = 400;
      ctx.body = { error: "Invalid tenant ID" };
      return;
    }

    ctx.state.tenantConfig = JSON.parse(configJson);
    ctx.state.tenantId = tenantId;
    console.log(`[INFO] Loaded tenant config for ${tenantId}`);
    await next();
  } catch (error) {
    console.error(`[ERROR] Failed to load tenant config: ${error}`);
    ctx.status = 500;
    ctx.body = { error: "Internal Server Error" };
  }
};

// Authentication middleware for admin routes
const adminAuthMiddleware = () => async (ctx, next) => {
  const authHeader = ctx.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { error: "Authentication required" };
    return;
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // For simplicity, we're just checking if the token exists
  // In a real app, you'd verify the token's validity
  if (!token) {
    ctx.status = 401;
    ctx.body = { error: "Invalid token" };
    return;
  }
  
  // TODO: Add proper admin token validation
  
  await next();
};

// Create a new anonymous user with API key
const createAnonymousUser = async (redisClient, tenantId, tenantConfig) => {
  const userId = `anon_${uuidv4()}`;
  const apiKey = `temp_${uuidv4()}`;
  const anonymousConfig = tenantConfig.user_groups.anonymous;
  
  const userData = {
    userId,
    createdAt: new Date().toISOString(),
    tokensLeft: anonymousConfig.tokens,
    userGroup: 'anonymous',
    tenantId
  };
  
  await redisClient.set(`user:${userId}`, JSON.stringify(userData));
  await redisClient.set(`apiKey:${apiKey}`, userId);
  
  return { 
    apiKey,
    tokensLeft: anonymousConfig.tokens
  };
};

// Create the Koa application
export const createApp = async ({ redisClient }) => {
  const app = new Koa();
  const router = new Router();
  
  // Setup error handling
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[ERROR] ${err}`);
      ctx.status = 500;
      ctx.body = { error: "Internal Server Error" };
    }
  });
  
  // Use body parser
  app.use(bodyParser());
  
  // Root endpoint
  router.get('/', async (ctx) => {
    ctx.status = 200;
    ctx.set('Content-Type', 'application/json');
    ctx.body = { message: "vibe-server API is running" };
  });
  
  // Anonymous login endpoint
  router.post('/:tenantId/auth/anonymous', tenantMiddleware(redisClient), async (ctx) => {
    const { tenantId, tenantConfig } = ctx.state;
    const userData = await createAnonymousUser(redisClient, tenantId, tenantConfig);
    ctx.status = 200;
    ctx.body = userData;
  });
  
  // Get tenant config (admin)
  router.get('/:tenantId/admin/config', 
    tenantMiddleware(redisClient),
    adminAuthMiddleware(),
    async (ctx) => {
      ctx.status = 200;
      ctx.body = { config: ctx.state.tenantConfig };
    }
  );
  
  // Update tenant config (admin)
  router.put('/:tenantId/admin/config', 
    tenantMiddleware(redisClient),
    adminAuthMiddleware(),
    async (ctx) => {
      const { tenantId } = ctx.state;
      const { config } = ctx.request.body;
      
      if (!config) {
        ctx.status = 400;
        ctx.body = { error: "Config object is required" };
        return;
      }
      
      try {
        await redisClient.set(`tenant:${tenantId}:config`, JSON.stringify(config));
        ctx.status = 200;
        ctx.body = { success: true };
      } catch (error) {
        console.error(`[ERROR] Failed to update tenant config: ${error}`);
        ctx.status = 500;
        ctx.body = { error: "Failed to update tenant configuration" };
      }
    }
  );
  
  app.use(router.routes());
  app.use(router.allowedMethods());
  
  return app;
};

// Start server only if file is executed directly (not imported)
if (import.meta.url.endsWith(process.argv[1])) {
  (async () => {
    try {
      const redisClient = await createRedisClient();
      await setupInitialTenantConfig(redisClient);
      
      const app = await createApp({ redisClient });
      const server = app.listen(PORT, HOST, () => {
        console.log(`[INFO] Server running at http://${HOST}:${PORT}`);
      });
      
      // Graceful shutdown
      const shutdown = async () => {
        console.log('[INFO] Server shutting down');
        server.close();
        await redisClient.quit();
        process.exit(0);
      };
      
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
      
    } catch (error) {
      console.error(`[ERROR] Server startup failed: ${error}`);
      process.exit(1);
    }
  })();
}