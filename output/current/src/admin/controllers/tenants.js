import dashboardView from '../views/dashboard.js';
import tenantFormView from '../views/tenant_form.js';
import authController from './auth.js';

// PROMPT: Fetch all tenant IDs from Redis using pattern matching: `tenant:*:config`
async function renderDashboard(ctx) {
  const tenantKeys = await ctx.redis.keys('tenant:*:config');
  const tenants = [];
  
  for (const key of tenantKeys) {
    // Extract tenant ID from the Redis key
    const tenantId = key.split(':')[1];
    const tenantData = await ctx.redis.get(key);
    
    if (tenantData) {
      const tenantConfig = JSON.parse(tenantData);
      tenants.push({
        id: tenantId,
        name: tenantConfig.name || 'Unnamed Tenant',
        domains: tenantConfig.domains || [],
      });
    }
  }
  
  ctx.body = dashboardView({
    tenants,
    csrfToken: ctx.session.csrfToken,
    admin: ctx.session.admin
  });
}

// PROMPT: Render form for new tenant with required fields
async function renderNewTenantForm(ctx) {
  ctx.body = tenantFormView({
    tenant: null,
    isNew: true,
    csrfToken: ctx.session.csrfToken,
    error: null
  });
}

// PROMPT: Validate tenant ID format (alphanumeric, no spaces)
// PROMPT: Check for existing tenant with same ID
// PROMPT: Create new tenant config in Redis: `tenant:<id>:config`
async function createTenant(ctx) {
  const { tenantId, name, domains } = ctx.request.body;
  
  // Validate tenant ID
  if (!tenantId || !/^[a-zA-Z0-9-_]+$/.test(tenantId)) {
    ctx.status = 400;
    return ctx.body = tenantFormView({
      tenant: ctx.request.body,
      isNew: true,
      csrfToken: ctx.session.csrfToken,
      error: 'Tenant ID must contain only alphanumeric characters, hyphens, and underscores.'
    });
  }
  
  // Check for existing tenant
  const existingTenant = await ctx.redis.get(`tenant:${tenantId}:config`);
  if (existingTenant) {
    ctx.status = 409;
    return ctx.body = tenantFormView({
      tenant: ctx.request.body,
      isNew: true,
      csrfToken: ctx.session.csrfToken,
      error: `Tenant with ID "${tenantId}" already exists.`
    });
  }
  
  // Create basic tenant config
  const domainsArray = domains ? domains.split(',').map(d => d.trim()) : [];
  const tenantConfig = {
    name: name || 'New Tenant',
    domains: domainsArray,
    auth: {
      stripe: {
        api_key: '',
        api_url: 'https://api.stripe.com/v1'
      },
      google_oauth: {
        client_id: '',
        client_secret: '',
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        userinfo_url: 'https://www.googleapis.com/oauth2/v1/userinfo'
      },
      apple_oauth: {
        client_id: '',
        client_secret: '',
        auth_url: 'https://appleid.apple.com/auth/authorize',
        token_url: 'https://appleid.apple.com/auth/token',
        keys_url: 'https://appleid.apple.com/auth/keys'
      }
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
            url: "https://api.openai.com/v1/chat/completions",
            default_model: "gpt-4o",
            api_key: ""
          }
        }
      }
    }
  };
  
  // Save the tenant config
  await ctx.redis.set(`tenant:${tenantId}:config`, JSON.stringify(tenantConfig));
  
  // Log the action
  await authController.logAdminAction(ctx, 'tenant_create', { tenantId, name });
  
  // Redirect to the edit page for the new tenant
  if (ctx.request.headers['hx-request']) {
    ctx.set('HX-Redirect', `/admin/tenants/${tenantId}/edit`);
    ctx.status = 200;
    ctx.body = '';
  } else {
    ctx.redirect(`/admin/tenants/${tenantId}/edit`);
  }
}

// PROMPT: Fetch tenant config from Redis: `tenant:<id>:config`
// PROMPT: Render tenant details with masked sensitive information
async function getTenantDetail(ctx) {
  const { id } = ctx.params;
  const tenantData = await ctx.redis.get(`tenant:${id}:config`);
  
  if (!tenantData) {
    ctx.status = 404;
    ctx.body = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
      Tenant not found
    </div>`;
    return;
  }
  
  const tenantConfig = JSON.parse(tenantData);
  
  // Mask sensitive information
  const maskedConfig = maskSensitiveData(JSON.parse(JSON.stringify(tenantConfig)));
  
  ctx.body = `
    <div id="tenant-detail" class="bg-white shadow overflow-hidden sm:rounded-lg p-4">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-2xl font-bold">${maskedConfig.name || id}</h2>
        <div>
          <button 
            hx-get="/admin/tenants/${id}/edit" 
            hx-target="#main-content"
            class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2">
            Edit
          </button>
          <button 
            hx-delete="/admin/tenants/${id}" 
            hx-confirm="Are you sure you want to delete this tenant? This action cannot be undone."
            hx-target="#main-content"
            hx-swap="outerHTML"
            class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
            Delete
          </button>
        </div>
      </div>
      
      <div class="mb-4">
        <h3 class="text-lg font-medium">Domains</h3>
        <div class="mt-1">
          ${maskedConfig.domains && maskedConfig.domains.length > 0 
            ? maskedConfig.domains.map(domain => `<span class="inline-block bg-gray-200 rounded-full px-3 py-1 text-sm font-semibold text-gray-700 mr-2 mb-2">${domain}</span>`).join('')
            : '<span class="text-gray-500">No domains configured</span>'
          }
        </div>
      </div>
      
      <div class="mb-4">
        <h3 class="text-lg font-medium">Authentication Providers</h3>
        <div class="mt-1 grid grid-cols-1 md:grid-cols-2 gap-4">
          ${Object.entries(maskedConfig.auth || {}).map(([provider, config]) => `
            <div class="border rounded p-3">
              <h4 class="font-bold capitalize">${provider.replace('_', ' ')}</h4>
              <div class="text-sm text-gray-700 space-y-1 mt-1">
                ${Object.entries(config).map(([key, value]) => `
                  <div><span class="font-medium">${key}:</span> ${value}</div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="mb-4">
        <h3 class="text-lg font-medium">User Groups</h3>
        <div class="mt-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          ${Object.entries(maskedConfig.user_groups || {}).map(([group, config]) => `
            <div class="border rounded p-3">
              <h4 class="font-bold capitalize">${group.replace('_', ' ')}</h4>
              <div class="text-sm text-gray-700 space-y-1 mt-1">
                ${Object.entries(config).map(([key, value]) => `
                  <div><span class="font-medium">${key}:</span> ${value}</div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div>
        <h3 class="text-lg font-medium">Provider Configurations</h3>
        <div class="mt-1">
          ${Object.entries(maskedConfig.providers || {}).map(([providerType, config]) => `
            <div class="mb-4">
              <h4 class="font-bold capitalize">${providerType} Providers</h4>
              <div>Default: <span class="font-medium">${config.default}</span></div>
              
              <div class="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-4">
                ${Object.entries(config.endpoints || {}).map(([endpoint, settings]) => `
                  <div class="border rounded p-3">
                    <h5 class="font-bold">${endpoint}</h5>
                    <div class="text-sm text-gray-700 space-y-1 mt-1">
                      ${Object.entries(settings).map(([key, value]) => `
                        <div><span class="font-medium">${key}:</span> ${value}</div>
                      `).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// PROMPT: Mask sensitive data (API keys) with partial visibility: `sk_...**********1234`
function maskSensitiveData(config) {
  // Recursive function to mask sensitive keys
  const maskObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    
    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        maskObject(obj[key]);
      } else if (
        typeof obj[key] === 'string' && 
        (key.includes('key') || key.includes('secret')) && 
        obj[key].length > 8
      ) {
        const value = obj[key];
        if (value.length > 12) {
          obj[key] = `${value.substring(0, 4)}...${'*'.repeat(Math.min(10, value.length - 8))}${value.substring(value.length - 4)}`;
        } else if (value.length > 0) {
          obj[key] = `${'*'.repeat(value.length)}`;
        }
      }
    });
    
    return obj;
  };
  
  return maskObject(config);
}

// PROMPT: Fetch tenant config from Redis: `tenant:<id>:config`
// PROMPT: Render edit form with current values
async function renderEditTenantForm(ctx) {
  const { id } = ctx.params;
  const tenantData = await ctx.redis.get(`tenant:${id}:config`);
  
  if (!tenantData) {
    ctx.status = 404;
    if (ctx.request.headers['hx-request']) {
      ctx.body = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        Tenant not found
      </div>`;
    } else {
      ctx.redirect('/admin/dashboard?error=Tenant not found');
    }
    return;
  }
  
  const tenant = JSON.parse(tenantData);
  tenant.id = id;
  
  ctx.body = tenantFormView({
    tenant,
    isNew: false,
    csrfToken: ctx.session.csrfToken,
    error: null
  });
}

// PROMPT: Validate configuration format
// PROMPT: Update Redis: `tenant:<id>:config`
async function updateTenant(ctx) {
  const { id } = ctx.params;
  const updates = ctx.request.body;
  
  // Check if tenant exists
  const tenantData = await ctx.redis.get(`tenant:${id}:config`);
  if (!tenantData) {
    ctx.status = 404;
    return ctx.body = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
      Tenant not found
    </div>`;
  }
  
  const currentConfig = JSON.parse(tenantData);
  
  // Update basic properties
  currentConfig.name = updates.name || currentConfig.name;
  currentConfig.domains = updates.domains ? updates.domains.split(',').map(d => d.trim()) : currentConfig.domains;
  
  // Handle nested updates (simplified for this example)
  // In a real implementation, you'd validate each field and handle complex nested updates
  
  if (updates.stripeApiKey) {
    if (!currentConfig.auth) currentConfig.auth = {};
    if (!currentConfig.auth.stripe) currentConfig.auth.stripe = {};
    currentConfig.auth.stripe.api_key = updates.stripeApiKey;
  }
  
  if (updates.googleClientId || updates.googleClientSecret) {
    if (!currentConfig.auth) currentConfig.auth = {};
    if (!currentConfig.auth.google_oauth) currentConfig.auth.google_oauth = {};
    if (updates.googleClientId) currentConfig.auth.google_oauth.client_id = updates.googleClientId;
    if (updates.googleClientSecret) currentConfig.auth.google_oauth.client_secret = updates.googleClientSecret;
  }
  
  if (updates.openaiApiKey) {
    if (!currentConfig.providers) currentConfig.providers = {};
    if (!currentConfig.providers.text) currentConfig.providers.text = { default: "openai", endpoints: {} };
    if (!currentConfig.providers.text.endpoints.openai) currentConfig.providers.text.endpoints.openai = {};
    currentConfig.providers.text.endpoints.openai.api_key = updates.openaiApiKey;
  }
  
  // Save updated config
  await ctx.redis.set(`tenant:${id}:config`, JSON.stringify(currentConfig));
  
  // Log the action
  await authController.logAdminAction(ctx, 'tenant_update', { tenantId: id });
  
  // Redirect to tenant detail view
  if (ctx.request.headers['hx-request']) {
    ctx.set('HX-Redirect', `/admin/tenants/${id}`);
    ctx.status = 200;
    ctx.body = '';
  } else {
    ctx.redirect(`/admin/tenants/${id}`);
  }
}

// PROMPT: Remove tenant config from Redis: `tenant:<id>:config`
async function deleteTenant(ctx) {
  const { id } = ctx.params;
  
  // Check if tenant exists
  const exists = await ctx.redis.exists(`tenant:${id}:config`);
  if (!exists) {
    ctx.status = 404;
    return ctx.body = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
      Tenant not found
    </div>`;
  }
  
  // Delete tenant config
  await ctx.redis.del(`tenant:${id}:config`);
  
  // Log the action
  await authController.logAdminAction(ctx, 'tenant_delete', { tenantId: id });
  
  // Return to dashboard with success message
  if (ctx.request.headers['hx-request']) {
    ctx.body = `<div id="main-content">
      <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
        Tenant "${id}" has been deleted successfully.
      </div>
      ${await renderDashboardContent(ctx)}
    </div>`;
  } else {
    ctx.redirect('/admin/dashboard?message=Tenant deleted successfully');
  }
}

// Helper function to render just the dashboard content for HTMX updates
async function renderDashboardContent(ctx) {
  const tenantKeys = await ctx.redis.keys('tenant:*:config');
  const tenants = [];
  
  for (const key of tenantKeys) {
    const tenantId = key.split(':')[1];
    const tenantData = await ctx.redis.get(key);
    
    if (tenantData) {
      const tenantConfig = JSON.parse(tenantData);
      tenants.push({
        id: tenantId,
        name: tenantConfig.name || 'Unnamed Tenant',
        domains: tenantConfig.domains || [],
      });
    }
  }
  
  return dashboardView({
    tenants,
    csrfToken: ctx.session.csrfToken,
    admin: ctx.session.admin,
    contentOnly: true
  });
}

export default {
  renderDashboard,
  renderNewTenantForm,
  createTenant,
  getTenantDetail,
  renderEditTenantForm,
  updateTenant,
  deleteTenant
};