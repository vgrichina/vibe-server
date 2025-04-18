# Web Server Setup with Multi-Tenant Configuration

- **Dependencies**:
  - Node.js v18+
  - `koa`
  - `koa-router`
  - `koa-bodyparser`
  - `redis`
  - `uuid`

- **Server Configuration**:
  - Listen on port 3000 by default. Use `process.env.PORT` to override.
  - Bind to `localhost` by default.

- **Root Endpoint**:
  - `GET /`
  - Returns a JSON response: `{"message": "vibe-server API is running"}`.
  - Status code: 200.
  - Headers: `Content-Type: application/json`.

- **Error Handling**:
  - Catch uncaught exceptions and log them to console with prefix `[ERROR]`.
  - Return a 500 status with JSON: `{"error": "Internal Server Error"}` for unhandled errors.


- **Redis Integration**:
  - Use the `redis` npm package to connect to a Redis instance (default: `redis://localhost:6379`).
  - Handle connection errors by logging `[ERROR] Redis connection failed: <error>` and exiting with code 1.

- **Tenant Configuration**:
  - Store tenant configs in Redis using the key pattern: `tenant:<tenantId>:config`.
  - Set an initial tenant config for `tenantId: "abc"` with the following structure on server startup if it doesn't exist:
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
      }
    }
    ```
  - Use Redis `SET` with `JSON.stringify` to store the config.

- **Middleware**:
  - Explicitly use with all /:tenantId/... routes.
  - Fetch the tenant config from Redis using `GET` and parse with `JSON.parse`.
  - If tenant config isn't found in Redis, return 400 with `{"error": "Invalid tenant ID"}`.
  - Attach the parsed config to the request context.

- **Token Management**:
  - Generate API keys using uuid.
  - Store API key metadata in Redis using `SET apiKey:<apiKey>` to point to associated user ID.
  - Store user data in Redis using `SET user:<userId>` with structure:
    ```json
    {
      "createdAt": "<timestamp>",
      "tokensLeft": 1000
    }
    ```
  - Track token usage by decrementing `tokensLeft` field.
  - When `tokensLeft` reaches 0, return 402 Payment Required.

- **Implementation Notes**:
  - Use plain JavaScript (ES6+)
  - Ensure the server shuts down gracefully on SIGTERM/SIGINT with a console log: `[INFO] Server shutting down`.
  - Don't start server when used as a module. Use `import.meta.url.endsWith(process.argv[1])` to check.
  - Expose `createApp` function that takes `deps` object (including Redis client) as an argument and returns a promise that resolves to the `app` instance for testing.
  - Ensure Redis client is initialized before the server starts listening.
  - Log `[INFO] Loaded tenant config for <tenantId>` on successful config fetch.
  - Use async/await for Redis operations.

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
    - Create new temporary user in Redis with anonymous user group limits (tokens, rate limit, etc).
    - Generate a new temporary API key associated with the user.
    - Returns the API key and current token balance / rate limit.
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
    - Admin-only endpoints for managing tenant configuration.
    - Requires valid admin authentication.
    - GET retrieves current tenant config for the specified tenant.
    - PUT updates tenant config (full replace).

## Output: bin/server.js