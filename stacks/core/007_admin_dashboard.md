# Tenant Management Dashboard
Add a minimal viable admin dashboard for configuring tenants in the vibe-server system:

## Admin Authentication
- **Endpoint**: `GET /admin/login`
  - Render login form with HTMX and Tailwind
- **Endpoint**: `POST /admin/login`
  - **Request**:
    - Body: `{ "username": "admin", "password": "secure-password" }`
  - **Behavior**:
    - Validate credentials against Redis: `admin:<username>`
        - Store hashed password, and salt
        - Hash password with `crypto.scrypt(password, salt, 64)`
    - On success: Set session cookie and redirect to dashboard
    - On failure: Return to login with error
  - **Error Responses**:
    - 401: Invalid credentials
    - 429: Too many login attempts

## Tenant Listing
- **Endpoint**: `GET /admin/dashboard`
  - **Authorization**: Require valid admin session
  - **Behavior**:
    - Fetch all tenant IDs from Redis using pattern matching: `tenant:*:config`
    - For each tenant ID, fetch basic info (name, domains)
    - Render table with HTMX for interactive elements:
      ```html
      <tr hx-get="/admin/tenants/{id}" hx-target="#tenant-detail">
        <td>{tenant.id}</td>
        <td>{tenant.name}</td>
        <td>{tenant.domains.join(', ')}</td>
        <td>
          <button hx-get="/admin/tenants/{id}/edit" hx-target="#main-content">Edit</button>
          <button hx-delete="/admin/tenants/{id}" hx-confirm="Are you sure?">Delete</button>
        </td>
      </tr>
      ```
  - **Error Responses**:
    - 401: Unauthorized (no valid session)

## Tenant Creation
- **Endpoint**: `GET /admin/tenants/new`
  - **Authorization**: Require valid admin session
  - **Behavior**:
    - Render form for new tenant with required fields
- **Endpoint**: `POST /admin/tenants`
  - **Request**:
    - Body: Tenant configuration form data
  - **Behavior**:
    - Validate tenant ID format (alphanumeric, no spaces)
    - Check for existing tenant with same ID
    - Create new tenant config in Redis: `tenant:<id>:config`
    - Redirect to tenant detail page
  - **Error Responses**:
    - 400: Invalid tenant ID or configuration
    - 409: Tenant ID already exists

## Tenant Detail
- **Endpoint**: `GET /admin/tenants/:id`
  - **Authorization**: Require valid admin session
  - **Path Parameters**:
    - `id`: Tenant identifier
  - **Behavior**:
    - Fetch tenant config from Redis: `tenant:<id>:config`
    - Render tenant details with masked sensitive information
    - Include usage statistics if available
  - **Error Responses**:
    - 404: Tenant not found

## Tenant Editing
- **Endpoint**: `GET /admin/tenants/:id/edit`
  - **Authorization**: Require valid admin session
  - **Path Parameters**:
    - `id`: Tenant identifier
  - **Behavior**:
    - Fetch tenant config from Redis: `tenant:<id>:config`
    - Render edit form with current values
- **Endpoint**: `PUT /admin/tenants/:id`
  - **Request**:
    - Body: Updated tenant configuration
  - **Behavior**:
    - Validate configuration format
    - Update Redis: `tenant:<id>:config`
    - Redirect to tenant detail view
  - **Error Responses**:
    - 400: Invalid configuration format
    - 404: Tenant not found

## Tenant Deletion
- **Endpoint**: `DELETE /admin/tenants/:id`
  - **Authorization**: Require valid admin session
  - **Path Parameters**:
    - `id`: Tenant identifier
  - **Behavior**:
    - Remove tenant config from Redis: `tenant:<id>:config`
    - Remove all related tenant data (optional confirmation for this)
    - Return success message and updated tenant list
  - **Error Responses**:
    - 404: Tenant not found

## Security Implementation
- **CSRF Protection**:
  - Avoid using `koa-csrf`
  - Include in all form submissions: `<input type="hidden" name="_csrf" value="{csrf_token}">`
  - Validate on all POST/PUT/DELETE requests
- **Rate Limiting**:
  - Apply rate limits to login attempts: `rate:admin:login:{ip}`
  - Set temporary lockout after 5 failed attempts
- **Logging**:
  - Log all admin actions for audit purposes: `log:admin:{action}:{timestamp}`
  - Include IP address, admin username, and affected resources

## UI Design
- Use Tailwind CSS for styling without build step (CDN version)
- Make sure that the UI is responsive and works on all devices
- Utilize wide screen real estate to display more information
- Use HTMX for interactive elements (hx-get, hx-post, hx-put, hx-delete)
    - Make sure that every view can be rendered as a partial HTML snippet for HTMX requests
    - Use hx-target to specify the target element for the response, snippet should fit accordingly
    - Add confirmation dialogs for destructive actions using hx-confirm
    - Support incremental updates without full page refreshes using hx-swap

## Implementation Notes
- Use Koa.js for routing and middleware
- Use Koa-session for authentication
- Mask sensitive data (API keys) with partial visibility: `sk_...**********1234`
- Implement form validation with inline errors using HTMX validation response
- Use server-rendered templates without client-side JavaScript frameworks

## Error Handling
- Show clear, actionable error messages
- Maintain form state on validation errors
- Return appropriate HTTP status codes
- Log all errors with relevant context

## Context: bin/server.js
## Output: bin/server.js
## Output: src/admin/controllers/auth.js
## Output: src/admin/controllers/tenants.js
## Output: src/admin/views/login.js
## Output: src/admin/views/dashboard.js
## Output: src/admin/views/tenant_form.js