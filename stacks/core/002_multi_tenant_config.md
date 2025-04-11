# Multi-Tenant Configuration with Redis

Add multi-tenant support to the Hono server by integrating Redis for configuration storage:

- **Redis Integration**:
  - Use the `redis` npm package to connect to a Redis instance (default: `redis://localhost:6379`).
  - Handle connection errors by logging `[ERROR] Redis connection failed: <error>` and exiting with code 1.

- **Tenant Configuration**:
  - Store tenant configs in Redis using the key pattern: `tenant:<tenantId>:config`.
  - Set an initial tenant config for `tenantId: "abc"` with the following structure:
    ```json
    {
      "auth": {
        "stripe": {
          "api_key": "sk_test_abc123"
        },
        "google_oauth": {
          "client_id": "google-client-abc",
          "client_secret": "google-secret-abc"
        },
        "apple_oauth": {
          "client_id": "apple-client-abc",
          "client_secret": "apple-secret-abc"
        }
      },
      "user_groups": {
        "anonymous": {
          "tokens": 100,
          "rate_limit": 10,
          "rate_limit_window": 60
        },
        "google_logged_in": {
          "tokens": 1000,
          "rate_limit": 50,
          "rate_limit_window": 60
        },
        "stripe_basic": {
          "tokens": 5000,
          "rate_limit": 100,
          "rate_limit_window": 60
        },
        "stripe_premium": {
          "tokens": 20000,
          "rate_limit": 500,
          "rate_limit_window": 60
        }
      },
      "providers": {
        "text": {
          "default": "openai",
          "endpoints": {
            "openai": {
              "url": "https://api.openai.com/v1/chat/completions",
              "default_model": "gpt-4o",
              "api_key": "sk-abc123"
            },
            "anthropic": {
              "url": "https://api.anthropic.com/v1/messages",
              "default_model": "claude-3-opus-20240229",
              "api_key": "sk-ant123"
            }
          }
        },
        "realtime": {
          "default": "openai_realtime",
          "endpoints": {
            "openai_realtime": {
              "model": "gpt-4o-realtime-preview-2024-12-17",
              "voice": "alloy",
              "api_key": "sk-rt-abc123"
            },
            "ultravox": {
              "voice": "Mark",
              "sampleRate": 48000,
              "encoding": "pcm_s16le",
              "api_key": "Zk9Ht7Lm.wX7pN9fM3kLj6tRq2bGhA8yE5cZvD4sT"
            }
          }
        }
      },
      "caching": {
        "enabled": true,
        "text_ttl": 86400,
        "transcription_ttl": 3600,
        "fee_percentage": 20
      }
    }
    ```
  - Use Redis `SET` with JSON.stringify to store the config on server startup if it doesn't exist.

- **Middleware**:
  - Extract tenant ID from the URL path prefix (e.g., `/:tenantId/...`)
  - If no tenant ID in path, use "default" as the tenant ID
  - Fetch the tenant config from Redis using `GET` and parse with JSON.parse
  - If tenant config isn't found in Redis, return 400 with `{"error": "Invalid tenant ID"}`
  - Attach the parsed config to the request context (e.g., `c.set('tenantConfig', config)`)

- **Token Management**:
  - Store token balances in Redis using key pattern: `apiKey:<apiKey>`.
  - For anonymous users, generate API keys with prefix "temp_" using uuid.
  - For registered users, generate API keys with prefix "user_" using uuid.
  - Store API key metadata in Redis using structure:
    ```json
    {
      "userId": "<userId or null for anonymous>",
      "createdAt": "<timestamp>",
      "tokensLeft": 1000
    }
    ```
  - Track token usage by decrementing `tokensLeft` field.
  - When `tokensLeft` reaches 0, return 402 Payment Required.
  - Expire anonymous API keys after 24 hours.

- **Implementation Notes**:
  - Ensure Redis client is initialized before the server starts listening.
  - Log `[INFO] Loaded tenant config for <tenantId>` on successful config fetch.
  - Use async/await for Redis operations.
  - Make sure `createApp` takes the Redis client as part of the `deps` object.
  - Update `test_server.js` to pass the Redis client as needed.
  - IMPORTANT: Don't introduce any new tests. Don't mock the Redis client.
  - Use `uuid` to generate IDs when needed.

- **API Endpoints**:

  - **Anonymous Login**:
    ```
    POST /:tenantId/auth/anonymous
    Response 200:
    {
      "apiKey": "temp_<uuid>",
      "tokensLeft": 100
    }
    ```
    - Generates a new temporary API key with anonymous user group limits
    - Sets expiration for 24 hours in Redis
    - Returns the API key and initial token balance

  - **Tenant Configuration**:
    ```
    GET /:tenantId/admin/config
    Headers:
      Authorization: Bearer <admin_token>
    Response 200:
    {
      "config": <tenant_config_object>
    }
    ```

    ```
    PUT /:tenantId/admin/config
    Headers:
      Authorization: Bearer <admin_token>
    Body:
    {
      "config": <tenant_config_object>
    }
    Response 200:
    {
      "success": true
    }
    ```
    - Admin-only endpoints for managing tenant configuration
    - Requires valid admin authentication
    - GET retrieves current tenant config for the specified tenant
    - PUT updates tenant config (full replace)

## Context: bin/server.js, tests/test_server.test.js
## Output: bin/server.js
## Output: tests/test_server.test.js
