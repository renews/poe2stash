import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import packageJson from "../package.json";
import { SideMenu, SideMenuFooter } from "../src/components/SideMenu";

test("shows the current app version in the menu footer", () => {
  const markup = renderToStaticMarkup(createElement(SideMenuFooter));

  expect(markup).toContain(`Version ${packageJson.version}`);
});

function renderMenu(accountName: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      {},
      createElement(SideMenu, {
        isOpen: true,
        onClose: () => {},
        accountName,
      }),
    ),
  );
}

test("only shows sale history when an account is configured", () => {
  expect(renderMenu("")).not.toContain("Sale History");
  expect(renderMenu("BoostCoder#0407")).toContain("Sale History");
});
