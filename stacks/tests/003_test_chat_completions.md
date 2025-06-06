# Test Chat Completions Endpoint

Generate comprehensive unit tests for the chat completions endpoint:

- **Test Cases**:
  **Basic Chat Completion**:
     - Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "model": "gpt-3.5-turbo", "group_id": "anonymous"}`.
     - Assert 200 status with response containing `choices[0].message.content`.
     - Verify response format matches OpenAI API structure.

  **Streaming Response**:
     - Send `POST /v1/chat/completions` with `X-Tenant-Id: abc`, body: `{"messages": [{"role": "user", "content": "Hi"}], "stream": true}`.
     - Assert SSE headers and stream contains chunks with delta content.
     - Verify each chunk follows OpenAI streaming format.

  **Non-Streaming Response**:
     - Send same request with `stream: false`.
     - Assert 200 status with `{"id": "job-123", "status": "queued", "eta": 2}`.

  **Insufficient Tokens**:
     - Set `tokens:abc:anonymous:anonymous-uuid` to 0.
     - Assert 429

  **Missing API Key**:
     - Mock tenant config without `openai` key.
     - Mock OpenAI API to return 403 when no API key is provided.
     - Assert 403

  **Rate Limiting**:
     - Send multiple requests in quick succession.
     - Assert 429 after exceeding rate limit

  **Invalid Model**:
     - Send request with `model: "invalid-model"`.
     - Assert 400

  **Missing Messages**:
     - Send request without messages array.
     - Assert 400 with appropriate error message.

  **Invalid Message Format**:
      - Send request with malformed messages array.
      - Assert 400 with validation error.

  **Large Context Window**:
      - Send request with messages approaching token limit.
      - Verify proper handling of context window.

- **Implementation Notes**:
  - Setup full tenant config in Redis pointing to mock OpenAI API.
  - Include `Authorization` header in requests:
    - Need to obtain API key from `POST /:tenantId/auth/anonymous`.
    - Obtain unique API key for each test to avoid conflicts with rate limiting, etc.

  - Mock OpenAI API calls by starting a mock server and setting up API URL to point to it.
  - Test both success and error paths.
  - Don't use `eventsource` module for SSE. Just use `fetch` and `getReader`. 

## Context: bin/server.js, src/endpoints/chat.js, tests/test_server.test.js
## Output: tests/test_chat_completions.test.js
