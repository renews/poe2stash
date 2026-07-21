import { expect, test } from "bun:test";

test("uses Poe Dash for user-visible product identity", async () => {
  const [html, builder, main, readme] = await Promise.all([
    Bun.file(`${import.meta.dir}/../index.html`).text(),
    Bun.file(`${import.meta.dir}/../electron-builder.json5`).text(),
    Bun.file(`${import.meta.dir}/../electron/main.ts`).text(),
    Bun.file(`${import.meta.dir}/../README.md`).text(),
  ]);

  expect(html).toContain("<title>Poe Dash</title>");
  expect(html).toContain('href="/poe-dash-icon.png"');
  expect(builder).toContain('"productName": "Poe Dash"');
  expect(main).toContain('"poe-dash-icon.png"');
  expect(readme).toContain("# Poe Dash");
});
