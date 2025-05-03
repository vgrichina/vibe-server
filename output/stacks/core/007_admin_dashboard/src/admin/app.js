import Koa from 'koa';
import Router from 'koa-router';
import bodyParser from 'koa-bodyparser';
import session from 'koa-session';
import csrf from 'koa-csrf';
import serve from 'koa-static';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authController } from './controllers/auth.js';
import { tenantsController } from './controllers/tenants.js';

// PROMPT: Use Koa.js for routing and middleware
export const createAdminApp = async (redisClient) => {
  const app = new Koa();
  const router = new Router();
  
  // PROMPT: CSRF Protection - Generate CSRF token on login
  app.keys = [process.env.SESSION_SECRET || 'vibe-server-admin-secret'];
  
  // PROMPT: Use Koa-session for authentication
  app.use(session({
    key: 'admin:session',
    maxAge: 86400000, // 24 hours
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
  }, app));

  app.use(bodyParser());
  
  // PROMPT: CSRF Protection - Generate CSRF token on login
  app.use(new csrf({
    invalidTokenMessage: 'Invalid CSRF token',
    invalidTokenStatusCode: 403,
    excludedMethods: ['GET', 'HEAD', 'OPTIONS'],
    disableQuery: false
  }));

  // Make Redis client available
  app.context.redis = redisClient;

  // Error handling middleware
  // PROMPT: Show clear, actionable error messages
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error(`[ERROR] Admin: ${err.message}`);
      
      // Handle rate limit errors
      if (err.status === 429) {
        ctx.status = 429;
        ctx.body = { error: 'Too many requests, please try again later' };
        return;
      }
      
      // Handle CSRF errors
      if (err.status === 403 && err.message.includes('CSRF')) {
        ctx.status = 403;
        ctx.body = { error: 'Invalid or missing CSRF token' };
        return;
      }
      
      ctx.status = err.status || 500;
      ctx.body = {
        error: err.message || 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      };
    }
  });

  // Authentication middleware
  // PROMPT: Authorization: Require valid admin session
  const requireAuth = async (ctx, next) => {
    if (!ctx.session.admin) {
      ctx.redirect('/admin/login');
      return;
    }
    await next();
  };

  // CSRF token middleware for templates
  app.use(async (ctx, next) => {
    ctx.state.csrf = ctx.csrf;
    await next();
  });

  // Admin login routes
  // PROMPT: Endpoint: GET /admin/login
  // PROMPT: Endpoint: POST /admin/login
  router.get('/admin/login', authController.renderLoginForm);
  router.post('/admin/login', authController.login);
  router.post('/admin/logout', requireAuth, authController.logout);

  // Admin dashboard routes
  // PROMPT: Endpoint: GET /admin/dashboard
  router.get('/admin/dashboard', requireAuth, tenantsController.listTenants);
  
  // Tenant management routes
  // PROMPT: Endpoint: GET /admin/tenants/new
  router.get('/admin/tenants/new', requireAuth, tenantsController.renderNewForm);
  // PROMPT: Endpoint: POST /admin/tenants
  router.post('/admin/tenants', requireAuth, tenantsController.createTenant);
  // PROMPT: Endpoint: GET /admin/tenants/:id
  router.get('/admin/tenants/:id', requireAuth, tenantsController.getTenantDetail);
  // PROMPT: Endpoint: GET /admin/tenants/:id/edit
  router.get('/admin/tenants/:id/edit', requireAuth, tenantsController.renderEditForm);
  // PROMPT: Endpoint: PUT /admin/tenants/:id
  router.put('/admin/tenants/:id', requireAuth, tenantsController.updateTenant);
  // PROMPT: Endpoint: DELETE /admin/tenants/:id
  router.delete('/admin/tenants/:id', requireAuth, tenantsController.deleteTenant);

  // Use router
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
};

export default createAdminApp;