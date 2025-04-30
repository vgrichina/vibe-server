# Text-Based Chat Completions Endpoint

Add the `/:tenantId/v1/chat/completions` endpoint for text-based LLM interactions, supporting resumable streaming:

- **Endpoint**: `POST /:tenantId/v1/chat/completions`
- **Request**:
  - Authorization: Bearer token (required)
  - Path Parameters:
    - `tenantId`: Tenant identifier (required)
  - Body: OpenAI-compatible JSON with additional fields:
    ```json
    {
      "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, who are you?"}
      ],
      "model": "gpt-4",
      "stream": true
    }
    ```
  - Validate body:
    - `messages` (array, required): Must be properly formatted with `role` and `content`
    - `model` (string, optional): Must be a supported model, return 400 if invalid
    - `stream` (boolean, optional)

- **Authorization**:
  - Validate Bearer token with auth service
  - Extract user ID from token claims
  - Validate that user has access to the specified tenant
  - Use tenant ID from path to fetch config from Redis

- **Behavior**:
  - Fetch tenant config from Redis using tenant ID from auth token
  - Check provider API key in tenant config; return 403 if missing
  - Generate conversation ID if not provided
  - Rate limit requests per user per tenant:
    - Redis Key: `rate_limit:{user_id}:{window_timestamp}` (e.g., `rate_limit:user123:2025-04-30T12:00)`.
    - Counter: Use INCR to track requests in the window.
    - Expire: Use EXPIRE to set a TTL for the counter to 2x the window size.
    - Return 429 with `{"error": {"message": "Rate limit exceeded"}}` if exceeded
  - Validate context window size; return 400 if messages exceed token limit
  - If `stream: true`:
    - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    - Set `ctx.status` to 200.
    - Stream response via SSE (set `ctx.body` to a stream):
    ```
    data: {"id": "conv-123", "choices": [{"delta": {"content": "I"}}]}
    data: {"id": "conv-123", "choices": [{"delta": {"content": " am"}}]}
    data: {"id": "conv-123", "choices": [{"delta": {"content": " Claude"}}]}
    ```
  - If `stream: false`:
    - Return JSON response:
    ```json
    {
      "id": "conv-123",
      "choices": [{
        "message": {
          "role": "assistant",
          "content": "I am Claude, an AI assistant created by Anthropic to be helpful, harmless, and honest."
        }
      }]
    }
    ```

    - Pass through the response from the provider, don't remove any fields. This includes error responses.

- **Token Check**:
  - Fetch user ID based on API key from auth token
  - Fetch user data from Redis using user ID. This includes the user's token balance.
  - If tokens < 1, return 429 with `{"error": "Insufficient tokens"}`

- **Error Responses**:
  - 400: Invalid request body, unsupported model, messages exceed token limit
  - 401: Invalid or missing Bearer token
  - 403: Missing API key configuration or unauthorized tenant access
  - 429: Rate limit exceeded or insufficient tokens
  - 500: Internal server error

- **Implementation Notes**:
  - Use `PassThrough` to stream the response from the provider.
  - Log `[INFO] Processing chat completion for <tenantId>:<jobId>` for each request
  - Support any OpenAI-compatible provider as a backend. Don't mock the provider.
  - Make sure to update `bin/server.js` to add the new endpoint, including tenant middleware.
  - Don't forget to use tenant middleware to get the tenant ID from the request.
  - Don't validate the model in the endpoint. That should be done by the backend provider.

## Context: bin/server.js
## Output: src/endpoints/chat.js
## Output: bin/server.js
