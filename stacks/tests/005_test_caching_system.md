# Test Caching System

Generate comprehensive unit tests for the caching system:

- **Test Cases**:
  1. **Cache Hit**:
     - Preload `cache:abc:anonymous:intro-conversation-v1` with mock data.
     - Send `POST /v1/chat/completions` with `cache_key: "intro-conversation-v1"`.
     - Assert cached response returned instantly.
     - Check `[INFO] Cache hit` log.
  2. **Cache Miss**:
     - Send same request with empty cache.
     - Assert new response stored with TTL 86400.
     - Check `[INFO] Cache miss` log.
  3. **Caching Disabled**:
     - Mock config with `caching.enabled: false`.
     - Assert no cache check occurs.

- **Implementation Notes**:
  - Use Node’s `http` module for requests.
  - Mock Redis with TTL simulation.

## Context: bin/server.js, src/redis.js, src/endpoints/chat.js, src/cache.js
## Output: tests/test_caching.js
