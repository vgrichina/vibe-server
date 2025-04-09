# Text-Based Chat Completions Endpoint

Add the `/v1/chat/completions` endpoint for text-based LLM interactions, supporting resumable streaming:

- **Endpoint**: `POST /v1/chat/completions`
- **Request**:
  - Header: `X-Tenant-Id` (required, validated by middleware).
  - Body: OpenAI-compatible JSON with additional fields:
    ```json
    {
      "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello, who are you?"}
      ],
      "model": "gpt-4o",
      "stream": true,
      "group_id": "team-xyz",
      "cache_key": "intro-conversation-v1",
      "provider": "openai"
    }
    ```
  - Validate body:
    - `messages` (array, required): Must be properly formatted with `role` and `content`
    - `model` (string, optional): Must be a supported model, return 400 if invalid
    - `stream` (boolean, optional)
    - `group_id` (string, required)
    - `cache_key` (string, optional)
    - `provider` (string, optional, defaults to tenant config's `default` provider)

- **Behavior**:
  - Fetch tenant config from Redis via middleware.
  - Validate `group_id` exists in `user_groups` of tenant config; return 400 with `{"error": "Invalid group_id"}` if not.
  - Check `api_keys.openai` exists in tenant config; return 403 with `{"error": "No OpenAI API key configured"}` if missing.
  - Check cache using `cache_key` if provided; return cached response if hit
  - If repeat request with same parameters, return existing conversation stream
  - Generate conversation ID if not provided
  - Rate limit requests per tenant; return 429 with `{"error": {"message": "Rate limit exceeded"}}` if exceeded
  - Validate context window size; return 400 if messages exceed token limit
  - If `stream: true`:
    - Use Hono's SSE support to stream response:
    ```
    data: {"id": "conv-123", "choices": [{"delta": {"content": "I"}}]}
    data: {"id": "conv-123", "choices": [{"delta": {"content": " am"}}]}
    data: {"id": "conv-123", "choices": [{"delta": {"content": " Claude"}}]}
    ```
    - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
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

- **Token Check**:
  - Fetch token balance from Redis: `tokens:<tenantId>:<group_id>:<userId>` (use `anonymous-<random-uuid>` as `userId` for `anonymous` group).
  - If tokens < 1, return 429 with `{"error": "Insufficient tokens"}`.

- **Error Responses**:
  - 400: Invalid request body, unsupported model, invalid group_id, messages exceed token limit
  - 403: Missing API key configuration
  - 429: Rate limit exceeded or insufficient tokens
  - 500: Internal server error

- **Implementation Notes**:
  - Log `[INFO] Processing chat completion for <tenantId>:<jobId>` for each request.
  - Support any OpenAI-compatible provider as a backend
  - Use Hono's `streamSSE` to stream the response

## Context: bin/server.js
## Output: src/endpoints/chat.js
## Output: bin/server.js
