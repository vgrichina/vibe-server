import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// PROMPT: Generate API key with format `vs_user_[alphanumeric]`
export function generateApiKey() {
  const randomString = crypto.randomBytes(16).toString('hex');
  return `vs_user_${randomString}`;
}

// PROMPT: Implement proper error handling with status codes
export class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

// PROMPT: Validate the OAuth token with Google's API
export async function validateGoogleToken(token, clientId, userInfoUrl) {
  try {
    const response = await fetch(userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new AuthError('Invalid token', 401);
    }

    const userData = await response.json();
    
    // Verify the token was intended for our app
    if (userData.aud !== clientId) {
      throw new AuthError('Token not intended for this application', 401);
    }

    return userData;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Failed to validate Google token', 401);
  }
}

// PROMPT: Fetch Apple's public keys from `keys_url` endpoint
async function fetchApplePublicKeys(keysUrl) {
  try {
    const response = await fetch(keysUrl);
    if (!response.ok) {
      throw new AuthError('Failed to fetch Apple public keys', 500);
    }
    
    const { keys } = await response.json();
    return keys;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Error fetching Apple public keys', 500);
  }
}

// PROMPT: Verify JWT signature using public key matching `kid` in header
export async function validateAppleToken(token, clientId, keysUrl) {
  try {
    // Decode the token without verification to get the header
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.header.kid) {
      throw new AuthError('Invalid token format', 401);
    }

    // Fetch Apple's public keys
    const keys = await fetchApplePublicKeys(keysUrl);
    
    // Find the key matching the kid in the token header
    const matchingKey = keys.find(key => key.kid === decoded.header.kid);
    if (!matchingKey) {
      throw new AuthError('No matching key found', 401);
    }

    // Convert the JWK to PEM format
    const publicKey = crypto.createPublicKey({
      key: matchingKey,
      format: 'jwk'
    });
    const pemKey = publicKey.export({ type: 'spki', format: 'pem' });

    // Verify the token
    const payload = jwt.verify(token, pemKey, {
      algorithms: ['RS256']
    });

    // PROMPT: Validate standard JWT claims
    if (payload.iss !== 'https://appleid.apple.com') {
      throw new AuthError('Invalid token issuer', 401);
    }

    if (payload.aud !== clientId) {
      throw new AuthError('Token not intended for this application', 401);
    }

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new AuthError('Token has expired', 401);
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Failed to validate Apple token', 401);
  }
}

// PROMPT: Check user's subscription status
export async function checkStripeSubscription(email, stripeConfig) {
  try {
    const { api_key, api_url } = stripeConfig;
    
    // Search for customers by email
    const customersUrl = `${api_url}/customers?email=${encodeURIComponent(email)}`;
    
    const customersResponse = await fetch(customersUrl, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!customersResponse.ok) {
      throw new Error(`Stripe API error: ${customersResponse.statusText}`);
    }

    const { data: customers } = await customersResponse.json();
    
    if (customers.length === 0) {
      return 'google_logged_in'; // Default group if no Stripe customer found
    }

    // Get customer's subscriptions
    const customerId = customers[0].id;
    const subscriptionsUrl = `${api_url}/subscriptions?customer=${customerId}&status=active`;
    
    const subscriptionsResponse = await fetch(subscriptionsUrl, {
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!subscriptionsResponse.ok) {
      throw new Error(`Stripe API error: ${subscriptionsResponse.statusText}`);
    }

    const { data: subscriptions } = await subscriptionsResponse.json();
    
    if (subscriptions.length === 0) {
      return 'google_logged_in'; // Default group if no active subscription
    }

    // Map subscription to user group based on price/product
    const subscription = subscriptions[0];
    let userGroup = 'google_logged_in';
    
    // Check subscription plan
    if (subscription.plan && subscription.plan.metadata) {
      if (subscription.plan.metadata.tier === 'premium') {
        userGroup = 'stripe_premium';
      } else if (subscription.plan.metadata.tier === 'basic') {
        userGroup = 'stripe_basic';
      }
    }

    return userGroup;
  } catch (error) {
    console.error(`[ERROR] Stripe subscription check failed: ${error.message}`);
    return 'google_logged_in'; // Default to standard group on error
  }
}

// PROMPT: Store all OAuth credentials and API keys encrypted in Redis
export function encryptSensitiveData(data, encryptionKey) {
  if (!encryptionKey) {
    return data; // If no encryption key provided, return as-is
  }
  
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error(`[ERROR] Encryption failed: ${error.message}`);
    return data; // Return unencrypted on error
  }
}

// PROMPT: Track token usage per API key
export async function getTokenBalance(redisClient, apiKey) {
  const tokenKey = `tokens:${apiKey}`;
  const balance = await redisClient.get(tokenKey);
  return balance ? parseInt(balance, 10) : null;
}

// PROMPT: Apply rate limits based on user's group from tenant configuration
export async function getRateLimits(redisClient, tenantId, userGroup) {
  try {
    const tenantConfig = await redisClient.get(`tenant:${tenantId}:config`);
    if (!tenantConfig) {
      return { tokens: 100, rate_limit: 10, rate_limit_window: 60 }; // Default values
    }
    
    const config = JSON.parse(tenantConfig);
    const groupConfig = config.user_groups[userGroup] || config.user_groups.google_logged_in;
    
    return {
      tokens: groupConfig.tokens,
      rate_limit: groupConfig.rate_limit,
      rate_limit_window: groupConfig.rate_limit_window
    };
  } catch (error) {
    console.error(`[ERROR] Failed to get rate limits: ${error.message}`);
    return { tokens: 100, rate_limit: 10, rate_limit_window: 60 }; // Default values
  }
}

// PROMPT: Implement rate limiting for authentication attempts
export async function checkAuthRateLimit(redisClient, tenantId, ip) {
  const key = `auth_rate:${tenantId}:${ip}`;
  const limit = 10; // Max 10 auth attempts in 5 minutes
  const windowSize = 300; // 5 minutes in seconds
  
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, windowSize);
  }
  
  if (count > limit) {
    throw new AuthError('Rate limit exceeded for authentication attempts', 429);
  }
}

// PROMPT: Set appropriate API key expiration based on user group
export function getExpirationTimestamp(userGroup) {
  const now = new Date();
  
  // Paid users get longer expiration
  if (userGroup === 'stripe_premium') {
    // 30 days
    now.setDate(now.getDate() + 30);
  } else if (userGroup === 'stripe_basic') {
    // 7 days
    now.setDate(now.getDate() + 7);
  } else {
    // 1 day
    now.setDate(now.getDate() + 1);
  }
  
  return now.toISOString();
}

// PROMPT: Handle Apple's private email relay service
export function handlePrivateEmail(payload) {
  // Extract email data from payload
  const email = payload.email;
  const isPrivateEmail = payload.is_private_email === true;
  
  return {
    email,
    isPrivateEmail,
    // Store additional user details if available
    profile: {
      firstName: payload.given_name,
      lastName: payload.family_name,
      email: email,
      sub: payload.sub // Apple's unique identifier
    }
  };
}