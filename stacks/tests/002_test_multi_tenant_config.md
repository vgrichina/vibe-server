# Test Multi-Tenant Configuration

Generate comprehensive unit tests for multi-tenant configuration:

- **Test Framework**: Use `tape` with Node.js builtins.
- **Mocking**:
  - Mock the Redis client with an in-memory object supporting `set`, `get`, and basic error simulation.
  - Preload the mock with `tenant:abc:config` matching the spec above.
- **Test Cases**:
  1. **Redis Connection**:
     - Verify server exits with code 1 if Redis connection fails (mock an error).
     - Check `[ERROR] Redis connection failed` in logs.
  2. **Config Initialization**:
     - Verify `tenant:abc:config` is set in Redis on startup if missing.
  3. **Middleware - Valid Tenant**:
     - Send a request with `X-Tenant-Id: abc`.
     - Assert config is fetched and attached to context.
     - Check `[INFO] Loaded tenant config for abc` in logs.
  4. **Middleware - Missing Header**:
     - Send a request without `X-Tenant-Id`.
     - Assert 400 status with `{"error": "Missing X-Tenant-Id header"}`.
  5. **Middleware - Invalid Tenant**:
     - Send a request with `X-Tenant-Id: xyz` (not in Redis).
     - Assert 400 status with `{"error": "Invalid tenant ID"}`.

- **Implementation Notes**:
  - Use Node’s `http` module for requests.
  - Mock `console.log` to verify logs.
  - Simulate Redis operations with async functions.

## Context: bin/server.js, src/redis.js
## Output: tests/test_multi_tenant.js
