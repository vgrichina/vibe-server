# Test Realtime WebSocket API

Generate comprehensive unit tests for the realtime WebSocket API:

- **Test Cases**:
  1. **Initialize Session**:
     - Send `POST /v1/realtime/initialize` with `X-Tenant-Id: abc`, body as above.
     - Assert 200 with valid `sessionId` and `wsUrl`.
     - Verify session state in Redis.
  2. **WebSocket Text Echo**:
     - Connect to `wsUrl` with `sid`.
     - Send `{"inputType": "text", "data": "Hi"}`.
     - Assert `{"outputType": "text", "data": "Hello back"}` received.
  3. **WebSocket Audio Echo**:
     - Send `{"inputType": "audio", "data": "base64-audio"}`.
     - Assert `{"outputType": "audio", "data": "base64-echo"}` received.
  4. **Invalid Session**:
     - Connect with invalid `sid`.
     - Assert connection closes with code 1008.

- **Implementation Notes**:
  - Use Node’s `ws` module for WebSocket testing.
  - Mock Redis operations with async functions.

## Context: bin/server.js, src/endpoints/realtime.js
## Output: tests/test_realtime.test.js
