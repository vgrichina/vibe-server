/**
 * Cache utilities for tenant-specific caching
 */

// Check if caching is enabled and get cache configuration for a tenant
export const getCacheConfig = (tenantConfig) => {
  if (!tenantConfig?.caching?.enabled) {
    return null;
  }
  
  return {
    enabled: true,
    text_ttl: tenantConfig.caching.text_ttl || 86400, // Default 24 hours
    transcription_ttl: tenantConfig.caching.transcription_ttl || 3600, // Default 1 hour
    fee_percentage: tenantConfig.caching.fee_percentage || 20 // Default 20%
  };
};

// Generate a cache key based on tenantId and provided cache key
export const generateCacheKey = (tenantId, cacheKey) => {
  return `cache:${tenantId}:${cacheKey}`;
};

// Check if a response exists in cache
export const getFromCache = async (redisClient, tenantId, cacheKey) => {
  if (!cacheKey) return null;
  
  const fullCacheKey = generateCacheKey(tenantId, cacheKey);
  const cachedResponse = await redisClient.get(fullCacheKey);
  
  if (cachedResponse) {
    console.log(`[INFO] Cache hit for ${cacheKey}`);
    return JSON.parse(cachedResponse);
  }
  
  return null;
};

// Store a response in cache
export const storeInCache = async (redisClient, tenantId, cacheKey, response, ttl) => {
  if (!cacheKey) return;
  
  const fullCacheKey = generateCacheKey(tenantId, cacheKey);
  await redisClient.setEx(fullCacheKey, ttl, JSON.stringify(response));
  console.log(`[INFO] Cache miss, stored ${cacheKey}`);
};