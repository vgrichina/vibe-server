# Test Web Server Setup and Multi-Tenant Configuration

Generate comprehensive unit tests for the Web server and multi-tenant configuration:

- **Test Cases**:
  **Server Startup**:
     - Verify the server starts and listens on a given port by making an HTTP request to the server.
  **Root Endpoint (GET /)**:
     - Send a GET request to `/`.
     - Assert status code is 200.
     - Assert response body is `{"message": "vibe-server API is running"}`.
     - Assert `Content-Type` header is `application/json` (allow for `charset=utf-8`).
  **Config Initialization**:
     - Verify `tenant:abc:config` is set in Redis on startup if missing.
  **Middleware - Valid Tenant**:
     - Send a request to `/abc/some/path`.
     - Assert config is fetched and attached to context as `tenantConfig`. Make sure to use valid config.
     - Check `[INFO] Loaded tenant config for abc` in logs.
  **Middleware - Invalid Tenant**:
     - Send a request to `/xyz/some/path` (tenant not in Redis).
     - Assert 400 status with `{"error": "Invalid tenant ID"}`.
  **Anonymous Login**:
     - Send POST to `/abc/auth/anonymous`.
     - Assert 200 response with structure:
       ```json
       {
         "apiKey": "temp_<uuid>",
         "tokensLeft": 100
       }
       ```
     - Verify API key exists in Redis with correct metadata.
     - Verify 24-hour expiration is set.
  **Tenant Config Management**:
     - GET `/abc/admin/config` without auth header returns 401.
     - GET `/abc/admin/config` with invalid auth returns 403.
     - GET `/abc/admin/config` with valid auth returns current config.
     - PUT `/abc/admin/config` with valid auth updates config.
     - PUT `/abc/admin/config` with invalid config schema returns 400.

- **Implementation Notes**:
  - Mock `console.log` to capture logs.
  - Use server as a module to test the server instance.
  - Don't test stuff which requires starting a separate process (like signal handling).
  - Don't mock UUIDs.
  - Use real Redis instance for tests (no mocking).
  - Clean up Redis test data after each test.

## Context: bin/server.js
## Output: tests/test_server.test.js