/**
 * Cache utility functions for text responses
 */

// Get cache configuration from tenant config
export const getCacheConfig = (tenantConfig) => {
  return tenantConfig.caching || {
    enabled: false,
    text_ttl: 86400,      // Default: 1 day in seconds
    transcription_ttl: 3600, // Default: 1 hour in seconds
    fee_percentage: 20    // Default: 20% fee reduction for cached responses
  };
};

// Generate cache key
export const generateCacheKey = (tenantId, cacheKey) => {
  return `cache:${tenantId}:${cacheKey}`;
};

// Check if a response is cached
export const getCachedResponse = async (redisClient, tenantId, cacheKey) => {
  if (!cacheKey) return null;
  
  const key = generateCacheKey(tenantId, cacheKey);
  const cachedResponse = await redisClient.get(key);
  
  if (cachedResponse) {
    console.log(`[INFO] Cache hit for ${cacheKey}`);
    return JSON.parse(cachedResponse);
  }
  
  console.log(`[INFO] Cache miss for ${cacheKey}`);
  return null;
};

// Store response in cache
export const cacheResponse = async (redisClient, tenantId, cacheKey, response, ttl) => {
  if (!cacheKey) return;
  
  const key = generateCacheKey(tenantId, cacheKey);
  await redisClient.setEx(key, ttl, JSON.stringify(response));
  console.log(`[INFO] Cache miss, stored ${cacheKey}`);
};