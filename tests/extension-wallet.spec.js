const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { decode, encode } = require("cbor-x");
const dotenv = require("dotenv");
const { chromium, expect, test } = require("@playwright/test");

const envPath = process.env.CARDANO_ENV_FILE || ".env.development";
const env = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

test("installed extension derives CIP-105 key and signs CIP-95 data", async () => {
  test.skip(!env.CARDANO_MNEMONIC, `Missing wallet configuration in ${envPath}`);
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Wallet proof</title>");
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
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const workerUrl = new URL(worker.url());
    const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
    const setup = await context.newPage();
    await setup.goto(`${extensionOrigin}/setup.html`);
    await setup.locator("#mnemonic").fill(env.CARDANO_MNEMONIC);
    await setup.locator("#save").click();
    await expect(setup.locator("#result")).toContainText(env.CARDANO_ADDRESS_1);

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.cardano?.phantomPrototype);
    const connectPopupPromise = context.waitForEvent("page");
    const connectPromise = page.evaluate(() => window.cardano.phantomPrototype.enable({ extensions: [{ cip: 95 }] }).then(api => {
      window.proofWallet = api;
      return true;
    }));
    const connectPopup = await connectPopupPromise;
    await connectPopup.locator("#approve").click();
    await connectPromise;

    const publicResult = await page.evaluate(async () => ({
      network: await window.proofWallet.getNetworkId(),
      changeAddress: await window.proofWallet.getChangeAddress(),
      drepPublicKey: await window.proofWallet.cip95.getPubDRepKey(),
      registeredStakeKeys: await window.proofWallet.getRegisteredPubStakeKeys(),
      unregisteredStakeKeys: await window.proofWallet.cip95.getUnregisteredPubStakeKeys(),
    }));
    expect(publicResult.network).toBe(0);
    expect(publicResult.drepPublicKey).toHaveLength(64);
    expect(publicResult.registeredStakeKeys).toEqual([]);
    expect(publicResult.unregisteredStakeKeys).toHaveLength(1);

    const payload = Buffer.from(`prototype-extension:${port}:cip95-proof`).toString("hex");
    const drepId = "7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2";
    const signPopupPromise = context.waitForEvent("page");
    const signaturePromise = page.evaluate(({ drepId, payload }) => window.proofWallet.cip95.signData(drepId, payload), { drepId, payload });
    const signPopup = await signPopupPromise;
    await expect(signPopup.locator("h1")).toHaveText("Sign with DRep key?");
    await signPopup.locator("#approve").click();
    const signed = await signaturePromise;

    const [protectedBytes, , decodedPayload, signature] = decode(Buffer.from(signed.signature, "hex"));
    const headers = decode(protectedBytes);
    const field = (object, key) => object instanceof Map ? object.get(key) : object[key];
    expect(field(headers, 1)).toBe(-8);
    expect(Buffer.from(field(headers, "address")).toString("hex")).toBe(drepId);
    expect(Buffer.from(decodedPayload).toString("hex")).toBe(payload);
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicResult.drepPublicKey, "hex")]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(crypto.verify(null, encode(["Signature1", protectedBytes, Buffer.alloc(0), decodedPayload]), key, signature)).toBe(true);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});
