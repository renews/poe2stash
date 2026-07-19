import { expect, test } from "bun:test";

test("keeps the public-listing notice block out of app pages", async () => {
  const pageSources = await Promise.all(
    ["MainPage.tsx", "ConfigurationPage.tsx"].map((fileName) =>
      Bun.file(`${import.meta.dir}/../src/components/${fileName}`).text(),
    ),
  );
  const source = pageSources.join("\n");

  expect(source).not.toContain("Public listing sync");
  expect(source).not.toContain("PUBLIC_LISTING_SCOPE_NOTICE");
});
