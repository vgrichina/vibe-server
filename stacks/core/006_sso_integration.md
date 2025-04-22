# SSO Integration
Add SSO integration for tenant-specific authentication:

## OAuth Authentication
- **Auth Endpoint**: `POST /:tenantId/auth/login`
  - Body: 
    ```json
    {
      "provider": "google",
      "token": "oauth-token-from-provider"
    }
    ```
  - Fetch tenant config from Redis; use tenant's `auth.google_oauth.client_id` and `client_secret`
  - Validate the OAuth token with Google's API
  - Retrieve user information (email, name, profile)
  - Generate API key with format `vs_user_[alphanumeric]`
  - Store in Redis: `apikey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
  - Return:
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

## API Key Refresh
- **Refresh Endpoint**: `POST /:tenantId/auth/refresh`
  - Header: `Authorization: Bearer vs_user_123456789abcdef`
  - Validate current API key from Redis
  - Generate new API key with extended expiration
  - Update Redis with new key information
  - Return:
    ```json
    {
      "api_key": "vs_user_987654321fedcba",
      "expires_at": "2023-12-31T23:59:59Z",
      "remaining_tokens": 850
    }
    ```

## Multi-Provider Support
- Support multiple OAuth providers with same endpoint structure
- Determine provider from request body `provider` field
- For Apple OAuth:
  - Validate using tenant's `auth.apple_oauth.client_id` and `client_secret`
  - Follow Apple-specific validation procedures
- Map all providers to same user account if emails match

## Stripe Subscription Integration
- **Subscription Check**: On successful authentication, check user's subscription status
  - Use tenant's `auth.stripe.api_key` to query Stripe API
  - Map subscription level to appropriate user group (e.g., `stripe_basic`, `stripe_premium`)
  - Update user's group in Redis

## Token Management
- Track token usage per API key: `tokens:<api_key>` in Redis
- Apply rate limits based on user's group from tenant configuration
- Include remaining token count in authentication responses

## Security Implementation
- Store all OAuth credentials and API keys encrypted in Redis
- Implement proper error handling with status codes:
  - 401: Invalid credentials
  - 403: Insufficient permissions 
  - 429: Rate limit exceeded
- Implement rate limiting for authentication attempts
- Add CSRF protection for authentication flows

## Implementation Notes
- Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login
- Set appropriate API key expiration based on user group (longer for paid users)
- Include tenant identifier in all logs for easier debugging
- Don't introduce any new npm dependencies.

## Context: bin/server.js, src/endpoints/chat.js, src/endpoints/realtime.js
## Output: src/auth.js
## Output: src/endpoints/auth.js
## Output: bin/server.js