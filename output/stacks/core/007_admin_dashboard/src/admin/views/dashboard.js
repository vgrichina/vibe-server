// PROMPT: Render table with HTMX for interactive elements
export default function dashboardView({ tenants, csrfToken, admin, contentOnly = false }) {
  const content = `
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold">Tenant Management</h1>
      <a 
        href="/admin/tenants/new" 
        hx-get="/admin/tenants/new" 
        hx-target="#main-content" 
        class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
      >
        Create New Tenant
      </a>
    </div>

    ${tenants.length === 0 ? `
      <div class="bg-gray-100 p-6 rounded-lg text-center">
        <p class="text-gray-600 mb-2">No tenants found</p>
        <a 
          href="/admin/tenants/new"
          hx-get="/admin/tenants/new"
          hx-target="#main-content"
          class="text-blue-500 underline"
        >
          Create your first tenant
        </a>
      </div>
    ` : `
      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domains</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${tenants.map((tenant) => `
              <tr hx-get="/admin/tenants/${tenant.id}" hx-target="#tenant-detail" class="hover:bg-gray-50 cursor-pointer">
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-900">${tenant.id}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-900">${tenant.name}</td>
                <td class="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                  ${tenant.domains && tenant.domains.length > 0
                    ? tenant.domains.join(', ')
                    : '<span class="text-gray-400">No domains</span>'
                  }
                </td>
                <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button 
                    hx-get="/admin/tenants/${tenant.id}/edit" 
                    hx-target="#main-content" 
                    class="text-blue-600 hover:text-blue-900 mr-4"
                    onclick="event.stopPropagation();"
                  >
                    Edit
                  </button>
                  <button 
                    hx-delete="/admin/tenants/${tenant.id}"
                    hx-target="#main-content"
                    hx-confirm="Are you sure you want to delete this tenant? This action cannot be undone."
                    class="text-red-600 hover:text-red-900"
                    onclick="event.stopPropagation();"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}

    <div id="tenant-detail" class="mt-8"></div>
  `;
  
  if (contentOnly) {
    return content;
  }
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tenant Management - Vibe Server Admin</title>
  <script src="https://unpkg.com/htmx.org@1.9.6"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen">
  <nav class="bg-white shadow">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex">
          <div class="flex-shrink-0 flex items-center">
            <span class="font-bold text-xl">Vibe Server Admin</span>
          </div>
        </div>
        <div class="flex items-center">
          <div class="hidden md:ml-4 md:flex-shrink-0 md:flex md:items-center">
            <div class="ml-3 relative">
              <div class="flex items-center">
                <span class="text-gray-700 mr-4">Logged in as <strong>${admin.username}</strong></span>
                <a 
                  href="/admin/logout" 
                  hx-get="/admin/logout"
                  class="bg-red-100 text-red-800 px-3 py-1 rounded hover:bg-red-200"
                >
                  Logout
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
    <div id="main-content" class="px-4 py-6 sm:px-0">
      ${content}
    </div>
  </main>
</body>
</html>
  `;
}