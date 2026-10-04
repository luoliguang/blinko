// Minimal in-memory rate limiter for authentication endpoints (login / 2FA).
// Keyed by client IP. Enough for a small self-hosted instance — state is per
// process and resets on restart; no external store needed. It only throttles
// FAILED attempts, so legitimate users logging in correctly are never blocked.

type Record = { count: number; firstAt: number; blockedUntil: number };

const WINDOW_MS = 15 * 60 * 1000; // rolling window for counting failures
const MAX_FAILURES = 8;           // failures allowed per window before blocking
const BLOCK_MS = 15 * 60 * 1000;  // how long a client stays blocked

const attempts = new Map<string, Record>();
let lastSweep = Date.now();

// Behind a reverse proxy (TRUST_PROXY=1), the real client IP is the first entry
// of X-Forwarded-For; fall back to the socket address otherwise.
const clientKey = (req: any): string => {
  const xff = req.headers?.['x-forwarded-for'];
  if (xff) return xff.toString().split(',')[0]!.trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

// Drop stale entries occasionally so the map can't grow unbounded.
const sweep = (now: number) => {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, rec] of attempts) {
    if (rec.blockedUntil < now && now - rec.firstAt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
};

export const checkAuthRateLimit = (req: any): { ok: boolean; retryAfterSec?: number } => {
  const now = Date.now();
  sweep(now);
  const rec = attempts.get(clientKey(req));
  if (rec && rec.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.ceil((rec.blockedUntil - now) / 1000) };
  }
  return { ok: true };
};

export const recordAuthFailure = (req: any): void => {
  const now = Date.now();
  const key = clientKey(req);
  let rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    rec = { count: 0, firstAt: now, blockedUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.blockedUntil = now + BLOCK_MS;
  }
  attempts.set(key, rec);
};

export const recordAuthSuccess = (req: any): void => {
  attempts.delete(clientKey(req));
};
