import { buildCorsHeaders, isOriginAllowed } from "./lib/cors";
import { getEnv } from "./lib/env";

function buildErrorResponse(
  status: number,
  code: "NOT_ALLOWED_ORIGIN",
  message: string,
  requestId: string,
  origin: string | null
): Response {
  const env = getEnv();
  const response = Response.json(
    {
      error: {
        code,
        message,
        requestId
      }
    },
    { status }
  );

  const headers = buildCorsHeaders(origin, env.allowedOrigins);
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export function middleware(request: Request): Response | undefined {
  const env = getEnv();
  const origin = request.headers.get("origin");
  const requestId = crypto.randomUUID();
  const { pathname } = new URL(request.url);

  if (!pathname.startsWith("/api/")) {
    return undefined;
  }

  if (!isOriginAllowed(origin, env.allowedOrigins)) {
    return buildErrorResponse(403, "NOT_ALLOWED_ORIGIN", "Origin is not allowed.", requestId, origin);
  }

  if (request.method === "OPTIONS") {
    const response = new Response(null, { status: 200 });
    const headers = buildCorsHeaders(origin, env.allowedOrigins);
    headers.forEach((value, key) => response.headers.set(key, value));
    return response;
  }

  return undefined;
}

export const config = {
  matcher: ["/api/:path*"]
};
