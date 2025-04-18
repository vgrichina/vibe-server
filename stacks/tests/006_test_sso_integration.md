# Test SSO Integration

Generate comprehensive unit tests for SSO integration:

- **Test Cases**:
  1. **Google Auth**:
     - Send `POST /auth/google?tenantId=abc` with mock body.
     - Assert 200 with valid `token`.
     - Check `[INFO] User authenticated` log.
  2. **Chat with Valid Token**:
     - Send `POST /v1/chat/completions` with `Authorization: Bearer mock-jwt-abc-user-123`.
  3. **Chat with Invalid Token**:
     - Send with `Authorization: Bearer invalid`.
     - Assert 401 with `{"error": "Invalid or missing token"}`.

- **Implementation Notes**:
  - Use Node’s `http` module for requests.
  - Mock JWT validation logic.

## Context: bin/server.js, src/endpoints/chat.js, src/auth.js
## Output: tests/test_sso.test.js
