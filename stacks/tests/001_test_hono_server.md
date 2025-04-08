# Test Hono Server Setup

Generate comprehensive unit tests for the basic Hono server setup:

- **Test Framework**: Use `tape` with Node.js builtins (no external dependencies beyond `tape`).
- **Test Cases**:
  1. **Server Startup**:
     - Verify the server starts and listens on port 3000.
     - Check that binding to `0.0.0.0` works (test via localhost).
  2. **Root Endpoint (GET /)**:
     - Send a GET request to `/`.
     - Assert status code is 200.
     - Assert response body is `{"message": "ResuLLM API is running"}`.
     - Assert `Content-Type` header is `application/json`.
  3. **Error Handling**:
     - Simulate an uncaught exception (e.g., throw an error in a test route).
     - Verify console log contains `[ERROR]` prefix (mock console.log).
     - Verify response is 500 with `{"error": "Internal Server Error"}`.
  4. **Graceful Shutdown**:
     - Send SIGTERM to the process.
     - Verify console log shows `[INFO] Server shutting down` (mock process.on).

- **Implementation Notes**:
  - Use Node’s `http` module to simulate HTTP requests.
  - Mock `console.log` and `process.on` to capture logs and signals.
  - Start the server in a child process to test startup/shutdown.

## Output: tests/test_server.js
