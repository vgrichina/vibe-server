# Realtime Voice/Text WebSocket API

Add WebSocket support for realtime voice/text interactions with detailed session management:

- **Initialize Endpoint**: `POST /v1/realtime/initialize`
  - Header: `X-Tenant-Id` (required).
  - Body:
    ```json
    {
      "backend": "openai_realtime",
      "systemPrompt": "You are a helpful assistant",
      "tools": [
        {
          "name": "getWeather",
          "description": "Get current weather for a location",
          "parameters": {
            "location": { "type": "string", "description": "City and country" }
          },
          "type": "http",
          "httpUrl": "https://api.example.com/weather"
        }
      ],
      "ttsService": "openai",
      "group_id": "anonymous",
      "cache_key": "weather-assistant-v1"
    }
    ```
  - Validate: `backend` (enum: `openai_realtime`, `ultravox`), `group_id` (required), others optional.
  - Check token balance in Redis (`tokens:<tenantId>:<group_id>:<userId>`); return 429 if < 1.
  - Generate `sessionId`: `tenant:<tenantId>:session:<uuid>`.
  - Store session state in Redis: `session:<tenantId>:<sessionId>:state` with:
    ```json
    {
      "backend": "openai_realtime",
      "systemPrompt": "You are a helpful assistant",
      "tools": [{...}],
      "ttsService": "openai",
      "group_id": "anonymous",
      "cache_key": "weather-assistant-v1",
      "tokensUsed": 0
    }
    ```
  - Return:
    ```json
    {
      "sessionId": "tenant:abc:session:xyz",
      "wsUrl": "ws://localhost:3000/v1/realtime/stream?sid=tenant:abc:session:xyz",
      "remainingTokens": 100
    }
    ```
- **WebSocket Endpoint**: `/v1/realtime/stream`
  - Query param: `sid` (required).
  - Validate `sid` matches session in Redis; close connection with code 1008 if invalid.
  - Handle client messages:
    - **Text Input**: `{"inputType": "text", "data": "Hi"}` → echo `{"outputType": "text", "data": "Hello back"}`.
    - **Audio Input**: `{"inputType": "audio", "data": "base64-audio"}` → echo `{"outputType": "audio", "data": "base64-echo"}`.
  - Store message history in Redis: `session:<tenantId>:<sessionId>:history` as a list.

- **Implementation Notes**:
  - Use `ws` npm package for WebSocket support.
  - Log `[INFO] New realtime session: <sessionId>` on initialization.
  - Mock backend responses for now.

## Context: bin/server.js, src/redis.js
## Output: src/endpoints/realtime.js
## Output: bin/server.js
