# Test Chat Completions Endpoint

Generate comprehensive unit tests for the chat completions endpoint:

- **Test Cases**:
  1. **Streaming Response**:
     - Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "stream": true, "group_id": "anonymous"}`.
     - Assert SSE headers and stream contains `Hello world`.
  2. **Non-Streaming Response**:
     - Send same request with `stream: false`.
     - Assert 200 status with `{"id": "job-123", "status": "queued", "eta": 2}`.
  3. **Invalid Group**:
     - Send with `group_id: "invalid"`.
     - Assert 400 with `{"error": "Invalid group_id"}`.
  4. **Insufficient Tokens**:
     - Set `tokens:abc:anonymous:anonymous-uuid` to 0.
     - Assert 429 with `{"error": "Insufficient tokens"}`.
  5. **Missing API Key**:
     - Mock tenant config without `openai` key.
     - Assert 403 with `{"error": "No OpenAI API key configured"}`.

- **Implementation Notes**:
  - Use Node’s `http` module to send requests.
  - Parse SSE stream manually to verify chunks.
  - Mock `console.log` for logging checks. Don't use `jest.mock` for this.

## Context: bin/server.js, src/redis.js, src/endpoints/chat.js
## Output: tests/test_chat_completions.js
