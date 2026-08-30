const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { decode, encode } = require("cbor-x");
const { blake2b } = require("@noble/hashes/blake2b");
const { entropyToMnemonic } = require("@scure/bip39");
const { wordlist } = require("@scure/bip39/wordlists/english");
const { chromium, expect, test } = require("@playwright/test");

const mnemonic = ["test", "walk", "nut", "penalty", "hip", "pave", "soap", "entry", "language", "right", "filter", "choice"].join(" ");
const vectorDRepPublicKey = "f74d7ac30513ac1825715fd0196769761fca6e7f69de33d04ef09a0c417a752b";

test("installed extension derives CIP-105 key and signs CIP-95 data", async () => {
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
    await setup.locator("#mnemonic").fill(mnemonic);
    await setup.locator("#save").click();
    await expect(setup.locator("#result")).toContainText("Configured addr_test1");
    await expect(setup.locator("#mnemonic")).toHaveValue("");

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
    expect(publicResult.drepPublicKey).toBe(vectorDRepPublicKey);
    expect(publicResult.registeredStakeKeys.length + publicResult.unregisteredStakeKeys.length).toBe(1);

    const payload = Buffer.from(`prototype-extension:${port}:cip95-proof`).toString("hex");
    const drepId = Buffer.from(blake2b(Buffer.from(publicResult.drepPublicKey, "hex"), { dkLen: 28 })).toString("hex");
    const signPopupPromise = context.waitForEvent("page");
    const signaturePromise = page.evaluate(({ drepId, payload }) => window.proofWallet.cip95.signData(drepId, payload), { drepId, payload });
    const signPopup = await signPopupPromise;
    await expect(signPopup.locator("h1")).toHaveText("Sign with DRep key?");
    await expect(signPopup.locator("#details")).toContainText(payload);
    await signPopup.locator("#approve").click();
    const signed = await signaturePromise;

    const [protectedBytes, unprotected, decodedPayload, signature] = decode(Buffer.from(signed.signature, "hex"));
    const headers = decode(protectedBytes);
    const coseKey = decode(Buffer.from(signed.key, "hex"));
    const field = (object, key) => object instanceof Map ? object.get(key) : object[key];
    expect(field(headers, 1)).toBe(-8);
    expect(Buffer.from(field(headers, "address")).toString("hex")).toBe(drepId);
    expect(Buffer.from(decodedPayload).toString("hex")).toBe(payload);
    expect(unprotected.hashed).toBe(false);
    expect(field(coseKey, 1)).toBe(1);
    expect(field(coseKey, 3)).toBe(-8);
    expect(field(coseKey, -1)).toBe(6);
    expect(Buffer.from(field(coseKey, -2)).toString("hex")).toBe(publicResult.drepPublicKey);
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicResult.drepPublicKey, "hex")]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(crypto.verify(null, encode(["Signature1", protectedBytes, Buffer.alloc(0), decodedPayload]), key, signature)).toBe(true);
    const tampered = Buffer.from(signature);
    tampered[0] ^= 1;
    expect(crypto.verify(null, encode(["Signature1", protectedBytes, Buffer.alloc(0), decodedPayload]), key, tampered)).toBe(false);

    await setup.locator("#mnemonic").fill(entropyToMnemonic(new Uint8Array(16), wordlist));
    await setup.locator("#save").click();
    await expect(setup.locator("#mnemonic")).toHaveValue("");
    const accountChange = await page.evaluate(() => window.proofWallet.getNetworkId().then(() => null, error => error));
    expect(accountChange).toEqual({ code: -4, info: "Wallet account changed; enable the connection again." });
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});
