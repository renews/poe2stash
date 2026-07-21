import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PrimaryNavigation } from "../src/components/PrimaryNavigation";

function renderMenu(accountName: string, pathname = "/") {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      createElement(PrimaryNavigation, {
        accountName,
      }),
    ),
  );
}

test("only shows sale history when an account is configured", () => {
  expect(renderMenu("")).not.toContain("Sale History");
  expect(renderMenu("BoostCoder#0407")).toContain("Sale History");
});

test("names the primary navigation and identifies the current view", () => {
  const markup = renderMenu("BoostCoder#0407", "/messages");

  expect(markup).toContain('aria-label="Poe Dash home"');
  expect(markup).toContain(">POE DASH<");
  expect(markup).toContain("Unofficial free community tool");
  expect(markup).toContain('aria-label="Primary navigation"');
  expect(markup).toContain('aria-current="page"');
  expect(markup).toContain("Your Sales");
  expect(markup).toContain("Sale History");
  expect(markup).toContain("Chat Monitor");
});

test("removes duplicate live-watch and stash navigation controls", () => {
  const markup = renderMenu("BoostCoder#0407");

  expect(markup).not.toContain(">Public Listings<");
  expect(markup).not.toContain(">Live Watch<");
  expect(markup).not.toContain(">Stash<");
  expect(markup).not.toContain('aria-pressed="false"');
});
