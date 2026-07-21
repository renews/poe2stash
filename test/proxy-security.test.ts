import { expect, test } from "bun:test";
import {
  isAllowedProxyHost,
  isAllowedRendererOrigin,
  isPathOfExileHost,
  isTrustedRendererUrl,
  LOCAL_SERVER_HOST,
  redactHeaders,
  sanitizeProxyRequestHeaders,
  sanitizeProxyResponseHeaders,
} from "../electron/app/proxySecurity";

test("only accepts exact proxy hosts", () => {
  expect(isAllowedProxyHost("www.pathofexile.com")).toBe(true);
  expect(isAllowedProxyHost("poe.ninja")).toBe(true);
  expect(isAllowedProxyHost("poe2scout.com")).toBe(true);
  expect(isAllowedProxyHost("www.pathofexile.com.evil.example")).toBe(false);
  expect(isAllowedProxyHost("evil-www.pathofexile.com")).toBe(false);
});

test("only applies Path of Exile session and rate-limit handling to its host", () => {
  expect(isPathOfExileHost("www.pathofexile.com")).toBe(true);
  expect(isPathOfExileHost("poe2scout.com")).toBe(false);
  expect(isPathOfExileHost("poe.ninja")).toBe(false);
});

test("redacts credentials before headers can be logged", () => {
  expect(
    redactHeaders({
      accept: "application/json",
      cookie: "POESESSID=secret",
      authorization: "Bearer secret",
      "set-cookie": ["POESESSID=secret"],
    }),
  ).toEqual({
    accept: "application/json",
    cookie: "[REDACTED]",
    authorization: "[REDACTED]",
    "set-cookie": "[REDACTED]",
  });
});

test("restricts the app server to loopback renderer origins", () => {
  expect(LOCAL_SERVER_HOST).toBe("127.0.0.1");
  expect(
    isAllowedRendererOrigin("http://localhost:7555", ["http://localhost:7555"]),
  ).toBe(true);
  expect(
    isAllowedRendererOrigin("https://malicious.example", [
      "http://localhost:7555",
    ]),
  ).toBe(false);
});

test("trusts IPC only from an exact renderer origin", () => {
  const allowedOrigins = ["http://localhost:7555"];

  expect(isTrustedRendererUrl("http://localhost:7555/#/", allowedOrigins)).toBe(
    true,
  );
  expect(
    isTrustedRendererUrl("http://localhost:7555.evil.test", allowedOrigins),
  ).toBe(false);
  expect(
    isTrustedRendererUrl("https://malicious.example", allowedOrigins),
  ).toBe(false);
  expect(isTrustedRendererUrl("not-a-url", allowedOrigins)).toBe(false);
});

test("does not forward renderer credentials to upstream hosts", () => {
  expect(
    sanitizeProxyRequestHeaders({
      accept: "application/json",
      authorization: "Bearer renderer-secret",
      cookie: "POESESSID=renderer-secret",
      host: "localhost:7555",
      origin: "http://localhost:7555",
      "sec-fetch-site": "same-origin",
    }),
  ).toEqual({ accept: "application/json" });
});

test("does not expose upstream cookies to the renderer", () => {
  expect(
    sanitizeProxyResponseHeaders({
      "content-type": ["application/json"],
      "content-encoding": ["br"],
      "set-cookie": ["POESESSID=upstream-secret"],
    }),
  ).toEqual({ "content-type": ["application/json"] });
});
