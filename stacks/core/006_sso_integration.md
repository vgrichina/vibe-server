# SSO Integration

Add SSO integration for tenant-specific authentication using Google OAuth simulation:

- **Auth Endpoint**: `POST /auth/google`
  - Query param: `tenantId` (required).
  - Body: `{"code": "mock-google-code"}` (simulated OAuth code).
  - Fetch tenant config from Redis; validate `google_oauth.client_id` and `client_secret`.
  - Generate mock JWT:
    ```json
    {
      "tenantId": "<tenantId>",
      "userId": "user-123",
      "group": "google_logged_in",
      "exp": "<timestamp + 3600>"
    }
    ```
  - Return: `{"token": "mock-jwt-<tenantId>-<userId>"}`.

- **Implementation Notes**:
  - Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login.
  - Hardcode JWT expiration to 1 hour for now.

## Context: bin/server.js, src/endpoints/chat.js
## Output: src/auth.js
## Output: src/endpoints/chat.js
## Output: bin/server.js
