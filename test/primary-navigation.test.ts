import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import packageJson from "../package.json";
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
  expect(markup).toContain("divine-orb-logo.svg");
  expect(markup).toContain('data-brand-mark="official-divine-orb"');
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

test("keeps live price checking available without an account", () => {
  const markup = renderMenu("", "/price-check");

  expect(markup).toContain('href="/price-check"');
  expect(markup).toContain("Price Check");
  expect(markup).toContain('aria-current="page"');
});

test("shows the current app version at the far right of the header", () => {
  const markup = renderMenu("BoostCoder#0407");
  const versionLabel = `Poe Dash version ${packageJson.version}`;

  expect(markup).toContain(`aria-label="${versionLabel}"`);
  expect(markup).toContain(`>v${packageJson.version}<`);
  expect(markup.indexOf(versionLabel)).toBeGreaterThan(markup.lastIndexOf("</nav>"));
});
