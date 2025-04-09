# ResuLLM Hono Server Setup

Initialize the ResuLLM project with a basic Hono server to serve as the foundation for a multi-tenant LLM streaming API:

- **Framework**: Use Hono with Node.js runtime (v18+), written in plain JavaScript (ES6+).
- **Server Configuration**:
  - Listen on port 3000.
  - Bind to `localhost` by default.
- **Root Endpoint**: 
  - `GET /`
  - Returns a JSON response: `{"message": "ResuLLM API is running"}`.
  - Status code: 200.
  - Headers: `Content-Type: application/json`.
- **Error Handling**:
  - Catch uncaught exceptions and log them to console with prefix `[ERROR]`.
  - Return a 500 status with JSON: `{"error": "Internal Server Error"}` for unhandled errors.
  - Expose `/internal-error` route that throws an error for testing error handling.
- **Dependencies**:
  - Install `hono` as a Node.js module.
  - No external configuration files yet—just hardcode the port.

**Implementation Notes**:
- Use Hono’s built-in routing and middleware system.
- Ensure the server shuts down gracefully on SIGTERM/SIGINT with a console log: `[INFO] Server shutting down`.
- Don't start server when used as a module. 
- Expose `createApp` function that takes `deps` object as an argument and returns a promise that resolves to the `app` instance so that we can use it in tests like `createApp(deps).then(app => { app.fetch(...) })`.

## Output: bin/server.js
