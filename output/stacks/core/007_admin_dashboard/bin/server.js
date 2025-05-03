import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import session from 'koa-session';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import websockify from 'koa-easy-ws';
import { handleChatCompletions } from '../src/endpoints/chat.js';
import realtimeEndpoints from '../src/endpoints/realtime.js';
import authEndpoints from '../src/endpoints/auth.js';
import adminAuthController from '../src/admin/controllers/auth.js';
import adminTenantsController from '../src/admin/controllers/tenants.js';

// PROMPT: Store tenant configs in Redis using the key pattern: `tenant:<tenantId>:config`.
const DEFAULT_TENANT_CONFIG = {
  name: "Default Tenant",
  domains: ["example.com"],
  auth: {
    stripe: {
      api_key: "sk_test_abc123",
      api_url: "https://api.stripe.com/v1"
    },
    google_oauth: {
      client_id: "google-client-abc",
      client_secret: "google-secret-abc",
      auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
      token_url: "https://oauth2.googleapis.com/token",
      userinfo_url: "https://www.googleapis.com/oauth2/v1/userinfo"
    },
    apple_oauth: {
      client_id: "apple-client-abc",
      client_secret: "apple-secret-abc",
      auth_url: "https://appleid.apple.com/auth/authorize",
      token_url: "https://appleid.apple.com/auth/token",
      keys_url: "https://appleid.apple.com/auth/keys"
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
    apple_logged_in: {
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
  const adminRouter = new Router({ prefix: '/admin' });
  const redisClient = deps?.redisClient || createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  
  // PROMPT: Use `koa-easy-ws` with `ws` npm package.
  app.use(websockify());
  
  // PROMPT: Use Koa-session for authentication
  app.keys = [process.env.SESSION_SECRET || 'vibe-server-secret-key'];
  const CONFIG = {
    key: 'vibe-server:sess',
    maxAge: 86400000, // 24 hours
    autoCommit: true,
    overwrite: true,
    httpOnly: true,
    signed: true,
    rolling: false,
    renew: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  };
  app.use(session(CONFIG, app));
  
  // Make Redis client available to all routes
  app.context.redis = redisClient;
  
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
  
  // PROMPT: Ensure admin user exists for initial login
  const adminUserKey = 'admin:admin';
  const existingAdmin = await redisClient.get(adminUserKey);
  if (!existingAdmin) {
    // Default admin user with password "secure-password"
    // In production, this should be set during deployment
    const crypto = await import('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hashedPassword = await new Promise((resolve, reject) => {
      crypto.scrypt('secure-password', salt, 64, (err, derivedKey) => {
        if (err) reject(err);
        resolve(derivedKey.toString('hex'));
      });
    });
    
    await redisClient.set(adminUserKey, JSON.stringify({
      username: 'admin',
      hashedPassword,
      salt,
      role: 'admin'
    }));
  }

  // PROMPT: Catch uncaught exceptions and log them to console with prefix `[ERROR]`.
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[ERROR] ${err.stack || err.message}`);
      
      // For HTMX requests, return appropriate error response
      if (ctx.request.headers['hx-request']) {
        ctx.status = err.status || 500;
        if (ctx.accepts('html')) {
          ctx.body = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong>Error:</strong> ${err.message || 'Internal Server Error'}
          </div>`;
          return;
        }
      }
      
      ctx.status = err.status || 500;
      ctx.body = { error: err.message || 'Internal Server Error' };
    }
  });

  app.use(bodyParser());

  // PROMPT: Set CSRF token on all GET requests
  app.use(async (ctx, next) => {
    if (ctx.method === 'GET' && !ctx.session.csrfToken) {
      const crypto = await import('crypto');
      ctx.session.csrfToken = crypto.randomBytes(16).toString('hex');
    }
    await next();
  });

  // PROMPT: Validate CSRF token on all mutating requests
  app.use(async (ctx, next) => {
    if (['POST', 'PUT', 'DELETE'].includes(ctx.method)) {
      const requestCsrfToken = ctx.request.body._csrf || ctx.headers['x-csrf-token'];
      const sessionCsrfToken = ctx.session.csrfToken;
      
      if (!sessionCsrfToken || requestCsrfToken !== sessionCsrfToken) {
        ctx.status = 403;
        ctx.body = { error: 'Invalid CSRF token' };
        return;
      }
    }
    await next();
  });

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

  // PROMPT: Auth Endpoint: `POST /:tenantId/auth/login`
  router.post('/:tenantId/auth/login', tenantMiddleware, authEndpoints.loginHandler);

  // PROMPT: Refresh Endpoint: `POST /:tenantId/auth/refresh`
  router.post('/:tenantId/auth/refresh', tenantMiddleware, authEndpoints.refreshHandler);

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

  // PROMPT: Admin Authentication
  adminRouter.get('/login', adminAuthController.renderLoginForm);
  adminRouter.post('/login', adminAuthController.handleLogin);
  adminRouter.get('/logout', adminAuthController.handleLogout);
  
  // PROMPT: Admin dashboard and tenant management
  adminRouter.get('/dashboard', adminAuthController.requireAdmin, adminTenantsController.renderDashboard);
  adminRouter.get('/tenants/new', adminAuthController.requireAdmin, adminTenantsController.renderNewTenantForm);
  adminRouter.post('/tenants', adminAuthController.requireAdmin, adminTenantsController.createTenant);
  adminRouter.get('/tenants/:id', adminAuthController.requireAdmin, adminTenantsController.getTenantDetail);
  adminRouter.get('/tenants/:id/edit', adminAuthController.requireAdmin, adminTenantsController.renderEditTenantForm);
  adminRouter.put('/tenants/:id', adminAuthController.requireAdmin, adminTenantsController.updateTenant);
  adminRouter.delete('/tenants/:id', adminAuthController.requireAdmin, adminTenantsController.deleteTenant);

  app.use(router.routes());
  app.use(adminRouter.routes());
  app.use(router.allowedMethods());
  app.use(adminRouter.allowedMethods());

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