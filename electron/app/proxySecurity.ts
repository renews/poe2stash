import { IncomingHttpHeaders } from "node:http";

export const LOCAL_SERVER_HOST = "127.0.0.1";
export const ALLOWED_PROXY_HOSTS = [
  "www.pathofexile.com",
  "poe.ninja",
  "poe2base.com",
  "poe2scout.com",
] as const;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
]);
const BLOCKED_PROXY_REQUEST_HEADERS = new Set([
  ...SENSITIVE_HEADER_NAMES,
  "connection",
  "content-length",
  "host",
  "origin",
  "transfer-encoding",
  "upgrade",
]);

export function isAllowedProxyHost(host: string) {
  return ALLOWED_PROXY_HOSTS.some((allowedHost) => allowedHost === host);
}

export function isPathOfExileHost(host: string) {
  return host === "www.pathofexile.com";
}

export function redactHeaders(headers: IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ]),
  );
}

export function sanitizeProxyRequestHeaders(headers: IncomingHttpHeaders) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const normalizedName = name.toLowerCase();
      return (
        !normalizedName.startsWith("sec-") &&
        !BLOCKED_PROXY_REQUEST_HEADERS.has(normalizedName)
      );
    }),
  );
}

export function sanitizeProxyResponseHeaders(
  headers: Record<string, string | string[]>,
) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        name.toLowerCase() !== "content-encoding" &&
        name.toLowerCase() !== "set-cookie",
    ),
  );
}

export function isAllowedRendererOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
) {
  return !origin || allowedOrigins.includes(origin);
}

export function getAllowedRendererOrigins(
  port: string | number,
  developmentUrl?: string,
) {
  const origins = new Set([
    `http://localhost:${port}`,
    `http://${LOCAL_SERVER_HOST}:${port}`,
  ]);

  if (developmentUrl) {
    origins.add(new URL(developmentUrl).origin);
  }

  return [...origins];
}

export function isTrustedRendererUrl(
  url: string | undefined,
  allowedOrigins: string[],
) {
  if (!url) {
    return false;
  }

  try {
    return allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
