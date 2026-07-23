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
  expect(builder).toContain('"icon": "assets/icon.png"');
  expect(main).toContain('"poe-dash-icon.png"');
  expect(readme).toContain("# Poe Dash");
});

test("uses Poe Dash for package and repository identity", async () => {
  const identityFiles = await Promise.all([
    Bun.file(`${import.meta.dir}/../package.json`).text(),
    Bun.file(`${import.meta.dir}/../package-lock.json`).text(),
    Bun.file(`${import.meta.dir}/../bun.lock`).text(),
    Bun.file(`${import.meta.dir}/../electron-builder.json5`).text(),
    Bun.file(`${import.meta.dir}/../electron/app/config.ts`).text(),
    Bun.file(`${import.meta.dir}/proxy.test.ts`).text(),
    Bun.file(`${import.meta.dir}/../README.md`).text(),
  ]);
  const identity = identityFiles.join("\n");

  expect(identity).toContain('"name": "poe-dash"');
  expect(identity).toContain('"appId": "PoeDash"');
  expect(identity).toContain('"poe-dash", "config.json"');
  expect(identity).toContain("POE_DASH_LIVE_TESTS");
  expect(identity).toContain("https://github.com/renews/poe-dash/releases");
  expect(identity).not.toMatch(new RegExp(["poe2", "stash"].join(""), "i"));
});

test("starts the Linux package through XWayland for app-owned shortcuts", async () => {
  const builder = await Bun.file(
    `${import.meta.dir}/../electron-builder.json5`,
  ).text();

  expect(builder).toContain('"executableArgs": ["--ozone-platform=x11"]');
});

test("publishes every desktop artifact for version tags", async () => {
  const [packageJson, workflow, readme] = await Promise.all([
    Bun.file(`${import.meta.dir}/../package.json`).json(),
    Bun.file(`${import.meta.dir}/../.github/workflows/release.yml`).text(),
    Bun.file(`${import.meta.dir}/../README.md`).text(),
  ]);

  expect(packageJson.version).toBe("1.0.0");
  expect(workflow).toContain('tags: ["v*"]');
  expect(workflow).toContain("ubuntu-latest");
  expect(workflow).toContain("windows-latest");
  expect(workflow).toContain("macos-15-intel");
  expect(workflow).toContain("release/*/*.AppImage");
  expect(workflow).toContain("release/*/*.exe");
  expect(workflow).toContain("release/*/*.dmg");
  expect(workflow).toContain("gh release create");
  expect(readme).toContain("Linux AppImage");
  expect(readme).toContain("Windows installer and portable app");
  expect(readme).toContain("macOS DMG");
});

test("builds artifacts without electron-builder publishing implicitly in CI", async () => {
  const packageJson = await Bun.file(
    `${import.meta.dir}/../package.json`,
  ).json();

  expect(packageJson.scripts.build).toEndWith("electron-builder --publish never");
});

test("uses the official Divine Orb artwork for the application icon", async () => {
  const [runtimeIcon, bundleIcon] = await Promise.all([
    Bun.file(`${import.meta.dir}/../public/poe-dash-icon.png`).arrayBuffer(),
    Bun.file(`${import.meta.dir}/../assets/icon.png`).arrayBuffer(),
  ]);
  const hash = (icon: ArrayBuffer) =>
    new Bun.CryptoHasher("sha256")
      .update(new Uint8Array(icon))
      .digest("hex");
  const officialDivineOrbIconHash =
    "009b7d72230c62517a98493dd4a76c550c025e27b8fa33acd06298227a788439";

  expect(hash(runtimeIcon)).toBe(officialDivineOrbIconHash);
  expect(hash(bundleIcon)).toBe(officialDivineOrbIconHash);
});
