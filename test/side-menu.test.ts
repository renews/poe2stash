import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import packageJson from "../package.json";
import { SideMenuFooter } from "../src/components/SideMenu";

test("shows the current app version in the menu footer", () => {
  const markup = renderToStaticMarkup(createElement(SideMenuFooter));

  expect(markup).toContain(`Version ${packageJson.version}`);
});
