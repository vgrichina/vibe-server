# Test Hono Server Setup

Generate comprehensive unit tests for the basic Hono server setup:

- **Test Framework**: Use `tape` with Node.js builtins (no external dependencies beyond `tape`).
- **Test Cases**:
  1. **Server Startup**:
     - Verify the server starts and listens on port 3000. Just make an HTTP request to the server, don't check where it's bound.
  2. **Root Endpoint (GET /)**:
     - Send a GET request to `/`.
     - Assert status code is 200.
     - Assert response body is `{"message": "ResuLLM API is running"}`.
     - Assert `Content-Type` header is `application/json`.
  3. **Error Handling**:
     - Use `/internal-error` route to test error handling.
     - Verify console log contains `[ERROR]` prefix (mock console.log).
     - Verify response is 500 with `{"error": "Internal Server Error"}`.

- **Implementation Notes**:
  - Use `app.fetch` to make HTTP requests without starting the server.
  - Mock `console.log` and `process.on` to capture logs and signals.
  - Use server as a module to test the server instance.
  - Use async/await with `tape`. Don't use `t.end` or `t.plan`. Cleanup using `finally`. Don't use `catch` unless you are expecting an error.

## Context: bin/server.js
## Output: tests/test_server.js
