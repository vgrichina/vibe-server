// PROMPT: Use server-rendered templates without client-side JavaScript frameworks
export default function tenantFormView({ tenant, isNew, csrfToken, error }) {
  const formTitle = isNew ? 'Create New Tenant' : `Edit Tenant: ${tenant.name || tenant.id}`;
  const submitUrl = isNew ? '/admin/tenants' : `/admin/tenants/${tenant.id}`;
  const submitMethod = isNew ? 'post' : 'put';
  
  // Helper to get nested values safely
  const getValue = (obj, path, defaultValue = '') => {
    return path.split('.').reduce((prev, curr) => {
      return prev && prev[curr] !== undefined ? prev[curr] : defaultValue;
    }, obj);
  };
  
  return `
<div class="bg-white shadow sm:rounded-lg p-6">
  <div class="flex justify-between items-center mb-6">
    <h1 class="text-2xl font-bold">${formTitle}</h1>
    <a 
      href="/admin/dashboard" 
      hx-get="/admin/dashboard" 
      hx-target="#main-content"
      class="text-blue-500 hover:text-blue-700"
    >
      Back to Tenant List
    </a>
  </div>

  ${error ? `
  <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
    <span class="block sm:inline">${error}</span>
  </div>
  ` : ''}

  <form 
    hx-${submitMethod}="${submitUrl}" 
    hx-target="#main-content"
    class="space-y-6"
  >
    <input type="hidden" name="_csrf" value="${csrfToken}">
    
    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
      ${isNew ? `
      <div class="col-span-2">
        <label for="tenantId" class="block text-sm font-medium text-gray-700">Tenant ID</label>
        <div class="mt-1">
          <input 
            type="text" 
            name="tenantId" 
            id="tenantId" 
            required
            pattern="^[a-zA-Z0-9-_]+$"
            class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
            placeholder="my-tenant-id"
            value="${tenant?.id || ''}"
            ${!isNew ? 'readonly' : ''}
          >
        </div>
        <p class="mt-1 text-xs text-gray-500">Alphanumeric characters, hyphens and underscores only. Cannot be changed later.</p>
      </div>
      ` : ''}

      <div class="col-span-2">
        <label for="name" class="block text-sm font-medium text-gray-700">Tenant Name</label>
        <div class="mt-1">
          <input 
            type="text" 
            name="name" 
            id="name" 
            required
            class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
            placeholder="My Company"
            value="${tenant?.name || ''}"
          >
        </div>
      </div>

      <div class="col-span-2">
        <label for="domains" class="block text-sm font-medium text-gray-700">Domains</label>
        <div class="mt-1">
          <input 
            type="text" 
            name="domains" 
            id="domains" 
            class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
            placeholder="example.com, app.example.com"
            value="${tenant?.domains ? tenant.domains.join(', ') : ''}"
          >
        </div>
        <p class="mt-1 text-xs text-gray-500">Comma-separated list of domains associated with this tenant</p>
      </div>
    </div>

    <div class="border-t border-gray-200 pt-6"></div>
    <h2 class="text-xl font-bold">Authentication Providers</h2>

    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <!-- Stripe Configuration -->
      <div class="border rounded-lg p-4">
        <h3 class="font-semibold mb-4">Stripe</h3>
        
        <div class="mb-4">
          <label for="stripeApiKey" class="block text-sm font-medium text-gray-700">API Key</label>
          <div class="mt-1">
            <input 
              type="text" 
              name="stripeApiKey" 
              id="stripeApiKey" 
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
              placeholder="sk_..."
              value="${getValue(tenant, 'auth.stripe.api_key')}"
            >
          </div>
        </div>
      </div>

      <!-- Google OAuth Configuration -->
      <div class="border rounded-lg p-4">
        <h3 class="font-semibold mb-4">Google OAuth</h3>
        
        <div class="mb-4">
          <label for="googleClientId" class="block text-sm font-medium text-gray-700">Client ID</label>
          <div class="mt-1">
            <input 
              type="text" 
              name="googleClientId" 
              id="googleClientId" 
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
              placeholder="Google OAuth Client ID"
              value="${getValue(tenant, 'auth.google_oauth.client_id')}"
            >
          </div>
        </div>
        
        <div>
          <label for="googleClientSecret" class="block text-sm font-medium text-gray-700">Client Secret</label>
          <div class="mt-1">
            <input 
              type="password" 
              name="googleClientSecret" 
              id="googleClientSecret" 
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
              placeholder="Google OAuth Client Secret"
              value="${getValue(tenant, 'auth.google_oauth.client_secret')}"
            >
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-gray-200 pt-6"></div>
    <h2 class="text-xl font-bold">AI Providers</h2>

    <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <!-- OpenAI Configuration -->
      <div class="border rounded-lg p-4">
        <h3 class="font-semibold mb-4">OpenAI</h3>
        
        <div>
          <label for="openaiApiKey" class="block text-sm font-medium text-gray-700">API Key</label>
          <div class="mt-1">
            <input 
              type="text" 
              name="openaiApiKey" 
              id="openaiApiKey" 
              class="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md" 
              placeholder="sk_..."
              value="${getValue(tenant, 'providers.text.endpoints.openai.api_key')}"
            >
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-gray-200 pt-6"></div>
    <div class="flex justify-end space-x-3">
      <a 
        href="/admin/dashboard" 
        hx-get="/admin/dashboard" 
        hx-target="#main-content"
        class="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        Cancel
      </a>
      <button 
        type="submit" 
        class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
        ${isNew ? 'Create' : 'Update'} Tenant
      </button>
    </div>
  </form>
</div>
  `;
}