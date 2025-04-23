# Test SSO Integration
Generate comprehensive unit tests for SSO integration:

## Test Cases

### OAuth Authentication
- **Google Auth Success**:
  - Send `POST /abc/auth/login` with body:
    ```json
    {
      "provider": "google",
      "token": "mock-oauth-token"
    }
    ```
  - Assert 200 with response:
    ```json
    {
      "api_key": "vs_user_123456789abcdef",
      "expires_at": "2023-12-31T23:59:59Z",
      "user": {
        "id": "user_123",
        "email": "user@example.com",
        "group": "google_logged_in"
      },
      "remaining_tokens": 950
    }
    ```
  - Verify Redis contains `apiKey:vs_user_123456789abcdef` with user data
  - Check `[INFO] User authenticated for abc:user_123` log

- **Invalid OAuth Token**:
  - Send `POST /abc/auth/login` with invalid token
  - Assert 401 with error response

### API Key Refresh
- **Successful Refresh**:
  - First authenticate to get API key
  - Send `POST /abc/auth/refresh` with `Authorization: Bearer vs_user_123456789abcdef`
  - Assert 200 with new API key and extended expiration
  - Verify Redis updated with new key

- **Invalid API Key Refresh**:
  - Send `POST /abc/auth/refresh` with invalid/expired key
  - Assert 401 with error response

### Chat Completions with Authentication
- **Authenticated Request**:
  - First authenticate to get API key
  - Send `POST /abc/v1/chat/completions` with `Authorization: Bearer vs_user_123456789abcdef`
  - Assert 200 with proper chat response

- **Missing Authorization**:
  - Send `POST /abc/v1/chat/completions` without Authorization header
  - Assert 401 with error: `{"error": "Missing authorization header"}`

- **Invalid API Key**:
  - Send `POST /abc/v1/chat/completions` with `Authorization: Bearer invalid`
  - Assert 401 with error: `{"error": "Invalid API key"}`

### Token Management
- **Token Depletion**:
  - Authenticate user with limited tokens
  - Make multiple chat completion requests
  - Assert 429 error when tokens depleted

- **Group-Based Limits**:
  - Authenticate users with different groups (google_logged_in vs stripe_premium)
  - Verify different rate limits apply

### Multi-Provider Support
- **Apple Auth**:
  - Send `POST /abc/auth/login` with provider: "apple"
  - Assert successful authentication with Apple-specific validation

- **Same Email Different Providers**:
  - Authenticate with Google
  - Authenticate with Apple using same email
  - Verify same user account is returned

### Stripe Integration
- **Subscription Check**:
  - Mock Stripe API to return subscription data
  - Authenticate user and verify group updated to `stripe_premium`
  - Verify higher token allocation

## Implementation Notes
- Use Node's `http` module for requests
- Mock OAuth validation logic for Google and Apple
- Mock Stripe API responses
- Use test fixtures for tenant configurations

## Context: bin/server.js, src/endpoints/auth.js, src/auth.js, tests/test_chat_completions.test.js
## Output: tests/test_sso.test.js