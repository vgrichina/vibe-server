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
  - Store in Redis: `apiKey:<api_key>` → `{tenantId, userId, email, group, expires_at}`
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
  - Apple-specific validation procedures:
    1. **JWT Token Validation**:
       - Fetch Apple's public keys from `keys_url` endpoint
       - Verify JWT signature using public key matching `kid` in header
       - Validate standard JWT claims:
         - `iss` must be "https://appleid.apple.com"
         - `aud` must match your `client_id`
         - `exp` timestamp must not be passed
    
    2. **Identity Token Processing**:
       - Extract user info from identity token claims:
         - `sub`: Unique user identifier (Apple User ID)
         - `email`: User's email (if provided)
         - `email_verified`: Boolean flag for email verification
         - `is_private_email`: Check if using Apple's email relay service
    
    3. **First-time Login Handling**:
       - Apple may provide additional user data only on first login:
         - `given_name`: First name (optional)
         - `family_name`: Last name (optional)
       - Store these details when available as they won't be sent again
    
    4. **Email Relay Service**:
       - Handle Apple's private email relay service
       - Format: `unique-id@privaterelay.appleid.com`
       - Store both real email (if provided) and relay email
       - Update user profile if real email is later shared

- Map all providers to same user account if emails match

## Tenant Configuration
- Store OAuth provider configurations in tenant config:
  ```json
  {
    "auth": {
      "stripe": {
        "api_key": "sk_test_abc123",
        "api_url": "https://api.stripe.com/v1"
      },
      "google_oauth": {
        "client_id": "google-client-abc",
        "client_secret": "google-secret-abc",
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v1/userinfo"
      },
      "apple_oauth": {
        "client_id": "apple-client-abc",
        "client_secret": "apple-secret-abc",
        "auth_url": "https://appleid.apple.com/auth/authorize",
        "token_url": "https://appleid.apple.com/auth/token",
        "keys_url": "https://appleid.apple.com/auth/keys"
      }
    }
  }
  ```

- **URL Configuration**:
  - IMPORTANT: All OAuth provider URLs should be configurable per tenant. Don't hardcode any URLs.
  - Default to standard provider endpoints if not specified
  - Enable mock server usage for testing by overriding URLs in tenant config

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

## Implementation Notes
- Log `[INFO] User authenticated for <tenantId>:<userId>` on successful login
- Set appropriate API key expiration based on user group (longer for paid users)
- Include tenant identifier in all logs for easier debugging
- Don't introduce any new npm dependencies.

## Context: bin/server.js, src/endpoints/chat.js, src/endpoints/realtime.js
## Output: src/auth.js
## Output: src/endpoints/auth.js
## Output: bin/server.js