# Caching System

Implement a caching system for text-based responses with tenant-configurable settings:

- **Cache Configuration**:
  - Extend tenant config in Redis (`tenant:abc:config`) with:
    ```json
    {
      "caching": {
        "enabled": true,
        "text_ttl": 86400,
        "transcription_ttl": 3600,
        "fee_percentage": 20
      }
    }
    ```
- **Caching Logic**:
  - Update `/v1/chat/completions` to use caching:
    - Cache key: `cache:<tenantId>:<group_id>:<cache_key>` (e.g., `cache:abc:anonymous:intro-conversation-v1`).
    - On request:
      - If `cache_key` provided and caching enabled, check Redis for existing cache.
      - Cache hit: Return cached response (e.g., `{"id": "job-123", "choices": [{"text": "Cached response"}]}`) with 200.
      - Cache miss: Generate mock response (`"Cached response"`), store in Redis with TTL from `text_ttl`, then return.
    - Log `[INFO] Cache hit for <cache_key>` or `[INFO] Cache miss, stored <cache_key>`.

- **Implementation Notes**:
  - Use Redis `GET` and `SETEX` for cache operations.
  - Ensure cache is scoped by `tenantId` and `group_id` to prevent leakage.

## Context: bin/server.js, src/endpoints/chat.js
## Output: src/cache.js
## Output: src/endpoints/chat.js
