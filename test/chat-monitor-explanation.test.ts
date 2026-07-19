import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMonitorExplanation } from "../src/components/MessagesPage";

test("explains what Chat Monitor watches and what it does not track", () => {
  const markup = renderToStaticMarkup(
    createElement(ChatMonitorExplanation),
  );

  expect(markup).toContain("Client.txt");
  expect(markup).toContain("incoming buyer whispers");
  expect(markup).toContain("Active Only");
  expect(markup).toContain("does not confirm completed sales");
  expect(markup).toContain("Sale History");
});
