import durableLimiter from './durable-session-limiter.js';

// Development only. A single shared bucket avoids trusting spoofable proxy IP headers.
export function createMemoryLimiter({ now = Date.now } = {}) {
  let count = 0;
  let resetAt = 0;
  return {
    durable: false,
    async consume({ limit, windowMs }) {
      const time = now();
      if (time >= resetAt) { count = 0; resetAt = time + windowMs; }
      const allowed = count < limit;
      if (allowed) count++;
      return { allowed, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - time) / 1000)) };
    },
  };
}
const developmentLimiter = createMemoryLimiter();
export function isLocalDevelopment(env) {
  return env.NODE_ENV === 'development' && (!env.VERCEL_ENV || env.VERCEL_ENV === 'development');
}
export function getSessionLimiter(env) {
  if (env.SESSION_LIMITER_MODE === 'memory' && isLocalDevelopment(env)) return developmentLimiter;
  return durableLimiter;
}
