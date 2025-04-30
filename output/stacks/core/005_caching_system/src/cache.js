// PROMPT: Implement a caching system for text-based responses with tenant-configurable settings

/**
 * Checks if caching is enabled for the given tenant configuration
 */
export function isCachingEnabled(tenantConfig) {
  return tenantConfig?.caching?.enabled === true;
}

/**
 * Builds a cache key for the given tenant and cache key
 */
export function buildCacheKey(tenantId, cacheKey) {
  // PROMPT: Cache key: `cache:<tenantId>:<cache_key>` (e.g., `cache:abc:anonymous:intro-conversation-v1`)
  return `cache:${tenantId}:${cacheKey}`;
}

/**
 * Gets the text TTL from the tenant configuration
 */
export function getTextTTL(tenantConfig) {
  // PROMPT: Cache miss: Generate mock response (`"Cached response"`), store in Redis with TTL from `text_ttl`, then return.
  return tenantConfig?.caching?.text_ttl || 86400; // Default to 1 day if not specified
}

/**
 * Tries to get a cached response for the given key
 */
export async function getCachedResponse(redisClient, cacheKey) {
  // PROMPT: Use Redis `GET` and `SETEX` for cache operations.
  const cachedResponse = await redisClient.get(cacheKey);
  return cachedResponse ? JSON.parse(cachedResponse) : null;
}

/**
 * Stores a response in the cache with the specified TTL
 */
export async function cacheResponse(redisClient, cacheKey, response, ttl) {
  // PROMPT: Use Redis `GET` and `SETEX` for cache operations.
  await redisClient.setEx(cacheKey, ttl, JSON.stringify(response));
}