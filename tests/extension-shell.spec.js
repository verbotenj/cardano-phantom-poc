const http = require("http");
const path = require("path");
const { chromium, expect, test } = require("@playwright/test");

test("installed extension injects an origin-approved base bridge", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      "content-type": "text/html",
      "content-security-policy": "default-src 'none'; style-src 'none'; script-src 'none'",
    });
    response.end("<!doctype html><title>Extension proof</title><h1>Extension proof</h1>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const extensionPath = path.resolve("dist/prototype-extension");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.cardano?.phantomPrototype);
    const metadata = await page.evaluate(() => {
      const provider = window.cardano.phantomPrototype;
      return {
        name: provider.name,
        apiVersion: provider.apiVersion,
        supportedExtensions: provider.supportedExtensions,
      };
    });
    expect(metadata).toEqual({ name: "Cardano Prototype (Unofficial)", apiVersion: "1", supportedExtensions: [{ cip: 95 }] });
    await expect(page.evaluate(() => window.cardano.phantomPrototype.isEnabled())).resolves.toBe(false);

    const approvalPromise = context.waitForEvent("page");
    const enablePromise = page.evaluate(() =>
      window.cardano.phantomPrototype.enable({ extensions: [{ cip: 95 }] }).then(api => ({
        extensions: api.getExtensions(),
        cip95: Boolean(api.cip95),
      })).then(async value => ({ ...value, extensions: await value.extensions })),
    );
    const approval = await approvalPromise;
    await approval.waitForLoadState();
    await expect(approval.locator("h1")).toHaveText("Connect Cardano wallet?");
    await expect(approval.locator("#origin")).toHaveText(`http://127.0.0.1:${port}`);
    await expect(approval.locator("#extensions")).toHaveText("CIP-95");
    await approval.locator("#approve").click();
    await expect(enablePromise).resolves.toEqual({ extensions: [{ cip: 95 }], cip95: true });
    await expect(page.evaluate(() => window.cardano.phantomPrototype.isEnabled())).resolves.toBe(true);
    await expect(page.evaluate(() => window.cardano.phantomPrototype.enable().then(api => Boolean(api.cip95)))).resolves.toBe(false);

    await page.goto(`http://localhost:${port}`);
    await page.waitForFunction(() => window.cardano?.phantomPrototype);

    const rejectionPopupPromise = context.waitForEvent("page");
    const rejectedEnable = page.evaluate(() => window.cardano.phantomPrototype.enable().then(() => null, error => error));
    const rejectionPopup = await rejectionPopupPromise;
    await rejectionPopup.waitForLoadState();
    await rejectionPopup.locator("#reject").click();
    await expect(rejectedEnable).resolves.toEqual({ code: -3, info: "User declined enablement." });

    const closedPopupPromise = context.waitForEvent("page");
    const closedEnable = page.evaluate(() => window.cardano.phantomPrototype.enable().then(() => null, error => error));
    const closedPopup = await closedPopupPromise;
    await closedPopup.waitForLoadState();
    await closedPopup.close();
    await expect(closedEnable).resolves.toEqual({ code: -3, info: "User declined enablement." });

    const baseApprovalPromise = context.waitForEvent("page");
    const baseEnablePromise = page.evaluate(() =>
      window.cardano.phantomPrototype.enable().then(api => ({
        extensions: api.getExtensions(),
        cip95: Boolean(api.cip95),
      })).then(async value => ({ ...value, extensions: await value.extensions })),
    );
    const baseApproval = await baseApprovalPromise;
    await baseApproval.waitForLoadState();
    await expect(baseApproval.locator("#extensions")).toHaveText("None");
    await baseApproval.locator("#approve").click();
    await expect(baseEnablePromise).resolves.toEqual({ extensions: [], cip95: false });
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});
