# Test Multi-Tenant Configuration

Generate comprehensive unit tests for multi-tenant configuration:

- **Test Cases**:
  - **Config Initialization**:
     - Verify `tenant:abc:config` is set in Redis on startup if missing.
  - **Middleware - Valid Tenant**:
     - Send a request with `X-Tenant-Id: abc`
     - Assert config is fetched and attached to context as `tenantConfig`
     - Check `[INFO] Loaded tenant config for abc` in logs
  - **Middleware - Missing Header**:
     - Send a request without `X-Tenant-Id`.
     - Assert 400 status with `{"error": "Missing X-Tenant-Id header"}`.
  - **Middleware - Invalid Tenant**:
     - Send a request with `X-Tenant-Id: xyz` (not in Redis).
     - Assert 400 status with `{"error": "Invalid tenant ID"}`.

- **Implementation Notes**:
  - Mock `console.log` to capture logs.

## Context: bin/server.js, tests/test_server.test.js
## Output: tests/test_multi_tenant.test.js
