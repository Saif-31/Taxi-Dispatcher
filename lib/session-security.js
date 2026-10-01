import { createHash, timingSafeEqual } from 'node:crypto';
import { isLocalDevelopment } from './session-limiter.js';

const hash = value => createHash('sha256').update(value).digest();
const localOrigin = origin => {
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
};
function originsFrom(env) {
  const origins = (env.SESSION_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) ||
        (url.protocol === 'http:' && !localOrigin(origin))) throw new Error('Invalid origin');
  }
  if (!origins.length && !isLocalDevelopment(env)) throw new Error('Missing origins');
  return origins;
}
export async function authorizeSession(req, res, env, getLimiter) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  const reject = (status, error) => { res.status(status).json({ error }); return false; };
  if (!['POST', 'OPTIONS'].includes(req.method)) {
    res.setHeader('Allow', 'POST, OPTIONS');
    return reject(405, 'Method not allowed');
  }
  let origins;
  try { origins = originsFrom(env); }
  catch { return reject(503, 'Session service is not configured'); }
  const origin = req.headers.origin;
  const local = isLocalDevelopment(env) && typeof origin === 'string' && localOrigin(origin);
  if (typeof origin !== 'string' || !(origins.includes(origin) || local)) {
    return reject(403, 'Origin not allowed');
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    if (req.headers['access-control-request-method'] !== 'POST') return reject(405, 'Method not allowed');
    const headers = req.headers['access-control-request-headers'] || '';
    if (typeof headers !== 'string' || headers.split(',').some(h => h.trim() &&
      !['content-type', 'authorization'].includes(h.trim().toLowerCase()))) return reject(403, 'Headers not allowed');
    res.status(204).end();
    return false;
  }
  const token = env.SESSION_ACCESS_TOKEN;
  // Only explicit development + a loopback origin permits token-free access.
  if (token || !local) {
    if (typeof token !== 'string' || token.length < 32) return reject(503, 'Session service is not configured');
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || auth.length > 4096 ||
        !timingSafeEqual(hash(auth), hash(`Bearer ${token}`))) return reject(401, 'Dispatcher access token required');
  }
  if (!env.OPENAI_API_KEY) return reject(503, 'Session service is not configured');
  try {
    const limiter = await getLimiter(env);
    if (!limiter || typeof limiter.consume !== 'function' || (!local && limiter.durable !== true)) {
      return reject(503, 'Session service is not configured');
    }
    // Global budget across callers, origins and instances. Never key on untrusted IP headers.
    const result = await limiter.consume({ key: 'taxi-dispatcher:session:global', limit: 10, windowMs: 3600000 });
    if (!result || typeof result.allowed !== 'boolean' || !Number.isSafeInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 1) {
      throw new Error('Invalid limiter response');
    }
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return reject(429, 'Too many requests. Please try again later.');
    }
  } catch { return reject(503, 'Session service temporarily unavailable'); }
  return true;
}
