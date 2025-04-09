# Test Chat Completions Endpoint

Generate comprehensive unit tests for the chat completions endpoint:

- **Test Cases**:
  1. **Basic Chat Completion**:
     - Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-3.5-turbo", "group_id": "anonymous"}`.
     - Assert 200 status with response containing `choices[0].message.content`.
     - Verify response format matches OpenAI API structure.

  2. **Streaming Response**:
     - Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "stream": true, "group_id": "anonymous"}`.
     - Assert SSE headers and stream contains chunks with delta content.
     - Verify each chunk follows OpenAI streaming format.

  3. **Non-Streaming Response**:
     - Send same request with `stream: false`.
     - Assert 200 status with `{"id": "job-123", "status": "queued", "eta": 2}`.

  4. **Invalid Group**:
     - Send with `group_id: "invalid"`.
     - Assert 400 with `{"error": "Invalid group_id"}`.

  5. **Insufficient Tokens**:
     - Set `tokens:abc:anonymous:anonymous-uuid` to 0.
     - Assert 429 with `{"error": "Insufficient tokens"}`.

  6. **Missing API Key**:
     - Mock tenant config without `openai` key.
     - Assert 403 with `{"error": "No OpenAI API key configured"}`.

  7. **Rate Limiting**:
     - Send multiple requests in quick succession.
     - Assert 429 after exceeding rate limit with `{"error": {"message": "Rate limit exceeded"}}`.

  8. **Invalid Model**:
     - Send request with `model: "invalid-model"`.
     - Assert 400 with `{"error": {"message": "Model not supported"}}`.

  9. **Missing Messages**:
     - Send request without messages array.
     - Assert 400 with appropriate error message.

  10. **Invalid Message Format**:
      - Send request with malformed messages array.
      - Assert 400 with validation error.

  11. **Large Context Window**:
      - Send request with messages approaching token limit.
      - Verify proper handling of context window.

- **Implementation Notes**:
  - Mock OpenAI API calls by starting a mock server and setting up API URL to point to it.
  - Test both success and error paths.

## Context: bin/server.js, src/redis.js, src/endpoints/chat.js, tests/test_server.js
## Output: tests/test_chat_completions.js
