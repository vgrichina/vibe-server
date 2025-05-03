import crypto from 'crypto';
import loginView from '../views/login.js';

// PROMPT: Apply rate limits to login attempts: `rate:admin:login:{ip}`
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60; // 15 minutes in seconds

// PROMPT: Render login form with HTMX and Tailwind
export async function renderLoginForm(ctx) {
  const error = ctx.query.error;
  ctx.body = loginView({
    csrfToken: ctx.session.csrfToken,
    error
  });
}

// PROMPT: On success: Set session cookie and redirect to dashboard
// PROMPT: On failure: Return to login with error
async function handleLogin(ctx) {
  const { username, password } = ctx.request.body;
  const ip = ctx.request.ip;
  
  // Check rate limiting
  const rateKey = `rate:admin:login:${ip}`;
  const attempts = await ctx.redis.get(rateKey);
  
  if (attempts && parseInt(attempts) >= MAX_LOGIN_ATTEMPTS) {
    ctx.status = 429;
    ctx.body = loginView({
      csrfToken: ctx.session.csrfToken,
      error: `Too many login attempts. Please try again in ${LOCKOUT_DURATION / 60} minutes.`
    });
    return;
  }
  
  // Validate credentials
  const adminKey = `admin:${username}`;
  const adminData = await ctx.redis.get(adminKey);
  
  if (!adminData) {
    await incrementLoginAttempts(ctx, ip);
    ctx.status = 401;
    ctx.body = loginView({
      csrfToken: ctx.session.csrfToken,
      error: 'Invalid username or password'
    });
    return;
  }
  
  const admin = JSON.parse(adminData);
  const { hashedPassword, salt } = admin;
  
  // Hash the provided password with the stored salt
  const inputHashedPassword = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
  
  // Check if passwords match
  if (inputHashedPassword !== hashedPassword) {
    await incrementLoginAttempts(ctx, ip);
    ctx.status = 401;
    ctx.body = loginView({
      csrfToken: ctx.session.csrfToken,
      error: 'Invalid username or password'
    });
    return;
  }
  
  // Success - clear rate limiting and set session
  await ctx.redis.del(rateKey);
  
  ctx.session.admin = {
    username,
    role: admin.role,
    loggedInAt: new Date().toISOString()
  };
  
  // PROMPT: Log all admin actions for audit purposes
  await logAdminAction(ctx, 'login', { username, ip });
  
  // If HTMX request, return redirect instruction
  if (ctx.request.headers['hx-request']) {
    ctx.set('HX-Redirect', '/admin/dashboard');
    ctx.status = 200;
    ctx.body = '';
  } else {
    ctx.redirect('/admin/dashboard');
  }
}

// PROMPT: Set temporary lockout after 5 failed attempts
async function incrementLoginAttempts(ctx, ip) {
  const rateKey = `rate:admin:login:${ip}`;
  const attempts = await ctx.redis.get(rateKey);
  
  if (!attempts) {
    await ctx.redis.set(rateKey, '1', { EX: LOCKOUT_DURATION });
  } else {
    const newAttempts = parseInt(attempts) + 1;
    await ctx.redis.set(rateKey, newAttempts.toString(), { EX: LOCKOUT_DURATION });
    
    // Log excessive attempts
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      await logAdminAction(ctx, 'login_lockout', { ip, attempts: newAttempts });
    }
  }
}

// Handle logout
async function handleLogout(ctx) {
  if (ctx.session.admin) {
    const { username } = ctx.session.admin;
    await logAdminAction(ctx, 'logout', { username, ip: ctx.request.ip });
  }
  
  ctx.session = null;
  
  if (ctx.request.headers['hx-request']) {
    ctx.set('HX-Redirect', '/admin/login');
    ctx.status = 200;
    ctx.body = '';
  } else {
    ctx.redirect('/admin/login');
  }
}

// PROMPT: Require valid admin session
async function requireAdmin(ctx, next) {
  if (!ctx.session.admin) {
    if (ctx.request.headers['hx-request']) {
      ctx.set('HX-Redirect', '/admin/login');
      ctx.status = 401;
      ctx.body = '';
    } else {
      ctx.redirect('/admin/login');
    }
    return;
  }
  
  await next();
}

// PROMPT: Log all admin actions for audit purposes: `log:admin:{action}:{timestamp}`
async function logAdminAction(ctx, action, details = {}) {
  const timestamp = Date.now();
  const logKey = `log:admin:${action}:${timestamp}`;
  
  const logData = {
    action,
    timestamp,
    ip: ctx.request.ip,
    username: ctx.session?.admin?.username || details.username || 'anonymous',
    ...details
  };
  
  await ctx.redis.set(logKey, JSON.stringify(logData));
  console.log(`[INFO] Admin action: ${action} by ${logData.username}`);
}

export default {
  renderLoginForm,
  handleLogin,
  handleLogout,
  requireAdmin,
  logAdminAction
};