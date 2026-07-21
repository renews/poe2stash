import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LiveMonitorAlert,
  LiveMonitorButton,
} from "../src/components/LiveMonitorButton";

function renderButton(
  status: "unavailable" | "starting" | "watching" | "paused" | "disconnected",
) {
  return renderToStaticMarkup(
    createElement(LiveMonitorButton, {
      status,
      onToggle: () => {},
    }),
  );
}

test("exposes monitor state to assistive technology", () => {
  expect(renderButton("paused")).toContain('aria-pressed="false"');
  expect(renderButton("watching")).toContain('aria-pressed="true"');

  const startingMarkup = renderButton("starting");
  expect(startingMarkup).toContain('aria-busy="true"');
  expect(startingMarkup).toContain("disabled");
});

test("keeps monitor errors out of the toolbar status control", () => {
  expect(renderButton("disconnected")).not.toContain('role="alert"');
});

test("renders a prominent reconnect alert when monitoring stops", () => {
  const markup = renderToStaticMarkup(
    createElement(LiveMonitorAlert, {
      error: "Connection was lost. Reconnect to resume automatic sales updates.",
      canReconnect: true,
      isReconnecting: false,
      onReconnect: () => {},
    }),
  );

  expect(markup).toContain('role="alert"');
  expect(markup).toContain('aria-labelledby="live-monitor-alert-title"');
  expect(markup).toContain("Live monitor disconnected");
  expect(markup).toContain(
    "Connection was lost. Reconnect to resume automatic sales updates.",
  );
  expect(markup).toContain("Reconnect");
});

test("only offers reconnect when monitoring is stopped", () => {
  const markup = renderToStaticMarkup(
    createElement(LiveMonitorAlert, {
      error: "A new item was detected but could not be fetched.",
      canReconnect: false,
      isReconnecting: false,
      onReconnect: () => {},
    }),
  );

  expect(markup).toContain("Live monitor needs attention");
  expect(markup).not.toContain(">Reconnect</button>");
});
