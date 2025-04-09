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
      "api_keys": {
        "openai": "sk-abc123",
        "openai_realtime": "sk-rt-abc123",
        "ultravox": "Zk9Ht7Lm.wX7pN9fM3kLj6tRq2bGhA8yE5cZvD4sT",
        "stripe": "sk_test_abc123",
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
      }
    }
    ```
  - Use Redis `SET` with JSON.stringify to store the config on server startup if it doesn’t exist.
- **Middleware**:
  - Add a Hono middleware to extract `X-Tenant-Id` from request headers.
  - Fetch the tenant config from Redis using `GET` and parse with JSON.parse.
  - If `X-Tenant-Id` is missing, return 400 with `{"error": "Missing X-Tenant-Id header"}`.
  - If tenant config isn’t found in Redis, return 400 with `{"error": "Invalid tenant ID"}`.
  - Attach the parsed config to the request context (e.g., `c.set('tenantConfig', config)`).

- **Implementation Notes**:
  - Ensure Redis client is initialized before the server starts listening.
  - Log `[INFO] Loaded tenant config for <tenantId>` on successful config fetch.
  - Use async/await for Redis operations.
  - Make sure `createApp` takes the Redis client as part of the `deps` object.
  - Update `test_server.js` to pass the Redis client as needed. IMPORTANT: Don't introduce any new tests.

## Context: bin/server.js, tests/test_server.js
## Output: src/redis.js
## Output: bin/server.js
## Output: tests/test_server.js
