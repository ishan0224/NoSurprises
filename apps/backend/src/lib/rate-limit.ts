export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowBucket {
  startMs: number;
  count: number;
}

const buckets = new Map<string, WindowBucket>();

export function checkFixedWindowLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
): RateLimitResult {
  const bucket = buckets.get(key);

  if (!bucket || nowMs - bucket.startMs >= windowMs) {
    buckets.set(key, { startMs: nowMs, count: 1 });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: 0
    };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.startMs + windowMs - nowMs) / 1000)
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: 0
  };
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
}
