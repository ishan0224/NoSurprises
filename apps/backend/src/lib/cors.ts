export const CORS_ALLOW_METHODS = "POST,OPTIONS";
export const CORS_ALLOW_HEADERS = "Content-Type,Authorization,X-Request-Id";
export const CORS_MAX_AGE_SECONDS = "600";

export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes("*")) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

export function buildCorsHeaders(origin: string | null, allowedOrigins: string[]): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  headers.set("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);
  headers.set("Vary", "Origin");

  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}
