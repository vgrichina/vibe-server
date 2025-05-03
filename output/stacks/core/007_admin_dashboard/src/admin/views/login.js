// PROMPT: Render login form with HTMX and Tailwind
export default function loginView({ csrfToken, error }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - Vibe Server</title>
  <script src="https://unpkg.com/htmx.org@1.9.6"></script>
  <script src="https://unpkg.com/htmx.org/dist/ext/response-targets.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="max-w-md w-full bg-white rounded-lg shadow-md p-8">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-800">Vibe Server</h1>
      <p class="text-gray-600">Admin Dashboard</p>
    </div>
    
    ${error ? `
    <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
      <span class="block sm:inline">${error}</span>
    </div>
    ` : ''}
    
    <form hx-post="/admin/login" hx-swap="outerHTML">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      
      <div class="mb-6">
        <label class="block text-gray-700 text-sm font-bold mb-2" for="username">
          Username
        </label>
        <input 
          class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" 
          id="username" 
          type="text" 
          name="username" 
          placeholder="admin" 
          required
        >
      </div>
      
      <div class="mb-6">
        <label class="block text-gray-700 text-sm font-bold mb-2" for="password">
          Password
        </label>
        <input 
          class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" 
          id="password" 
          type="password" 
          name="password" 
          placeholder="********" 
          required
        >
      </div>
      
      <div class="flex items-center justify-between">
        <button 
          class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full" 
          type="submit"
        >
          Sign In
        </button>
      </div>
    </form>
  </div>
</body>
</html>
  `;
}