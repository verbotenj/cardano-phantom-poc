const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium, expect, test } = require("@playwright/test");
const CSL = require("@emurgo/cardano-serialization-lib-asmjs");
require("dotenv").config({ path: ".env.development", quiet: true });

test("installed extension signs and submits a CIP-95 Preview transaction", async () => {
  test.setTimeout(180_000);
  test.skip(process.env.RUN_PREVIEW_PROOF !== "1", "Set RUN_PREVIEW_PROOF=1 for the state-changing Preview proof.");

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Preview proof</title>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: false,
    args: [`--disable-extensions-except=${path.resolve("dist/prototype-extension")}`, `--load-extension=${path.resolve("dist/prototype-extension")}`],
  });

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const workerUrl = new URL(worker.url());
    const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
    const setup = await context.newPage();
    await setup.goto(`${extensionOrigin}/setup.html`);
    await setup.locator("#mnemonic").fill(process.env.CARDANO_MNEMONIC);
    await setup.locator("#save").click();
    await expect(setup.locator("#result")).toContainText(process.env.CARDANO_ADDRESS_1);

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.cardano?.phantomPrototype);
    const connectPopupPromise = context.waitForEvent("page");
    const connectPromise = page.evaluate(() => window.cardano.phantomPrototype.enable({ extensions: [{ cip: 95 }] }).then(api => { window.previewWallet = api; }));
    const connectPopup = await connectPopupPromise;
    await connectPopup.locator("#approve").click();
    await connectPromise;

    const utxos = await page.evaluate(() => window.previewWallet.getUtxos());
    const selected = utxos.map(value => CSL.TransactionUnspentOutput.from_hex(value)).find(utxo => {
      const value = utxo.output().amount();
      return !value.multiasset() && BigInt(value.coin().to_str()) > 3_000_000n;
    });
    expect(selected).toBeTruthy();

    const fee = 300_000n;
    const transfer = 2_000_000n;
    const inputs = CSL.TransactionInputs.new();
    inputs.add(selected.input());
    const outputs = CSL.TransactionOutputs.new();
    outputs.add(CSL.TransactionOutput.new(CSL.Address.from_bech32(process.env.CARDANO_ADDRESS_2), CSL.Value.new(CSL.BigNum.from_str(String(transfer)))));
    outputs.add(CSL.TransactionOutput.new(CSL.Address.from_bech32(process.env.CARDANO_ADDRESS_1), CSL.Value.new(CSL.BigNum.from_str(String(BigInt(selected.output().amount().coin().to_str()) - transfer - fee)))));
    const body = CSL.TransactionBody.new(inputs, outputs, CSL.BigNum.from_str(String(fee)));
    const certificates = CSL.Certificates.new();
    certificates.add(CSL.Certificate.new_drep_update(CSL.DRepUpdate.new(CSL.Credential.from_keyhash(CSL.Ed25519KeyHash.from_hex(process.env.CARDANO_DREP_ID_1)))));
    body.set_certs(certificates);
    const unsigned = CSL.Transaction.new(body, CSL.TransactionWitnessSet.new()).to_hex();

    const signPopupPromise = context.waitForEvent("page");
    const signPromise = page.evaluate(tx => window.previewWallet.signTx(tx, false), unsigned);
    const signPopup = await signPopupPromise;
    await expect(signPopup.locator("#details")).toContainText('"DRepUpdate"');
    await signPopup.locator("#approve").click();
    const witnessHex = await signPromise;
    const witnesses = CSL.TransactionWitnessSet.from_hex(witnessHex);
    expect(witnesses.vkeys().len()).toBe(2);

    const bodyHash = CSL.FixedTransaction.from_hex(unsigned).transaction_hash();
    const paymentCredential = CSL.BaseAddress.from_address(selected.output().address())?.payment_cred() ||
      CSL.EnterpriseAddress.from_address(selected.output().address())?.payment_cred() ||
      CSL.PointerAddress.from_address(selected.output().address())?.payment_cred();
    const paymentHash = paymentCredential?.to_keyhash()?.to_hex();
    expect(paymentHash).toBeTruthy();
    const verified = [];
    for (let index = 0; index < witnesses.vkeys().len(); index++) {
      const witness = witnesses.vkeys().get(index);
      expect(witness.vkey().public_key().verify(bodyHash.to_bytes(), witness.signature())).toBe(true);
      const keyHash = witness.vkey().public_key().hash().to_hex();
      const role = keyHash === process.env.CARDANO_DREP_ID_1 ? "drep" : keyHash === paymentHash ? "payment" : null;
      expect(role).not.toBeNull();
      verified.push({ role, keyHash });
    }
    expect(verified.map(item => item.keyHash).sort()).toEqual([paymentHash, process.env.CARDANO_DREP_ID_1].sort());

    const signed = CSL.Transaction.new(body, witnesses).to_hex();
    const txHash = await page.evaluate(tx => window.previewWallet.submitTx(tx), signed);
    expect(txHash).toBe(bodyHash.to_hex());

    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await fetch("https://preview.koios.rest/api/v1/tx_status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _tx_hashes: [txHash] }),
      });
      [status] = await response.json();
      if (status?.num_confirmations > 0) break;
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    expect(status?.num_confirmations).toBeGreaterThan(0);

    fs.writeFileSync("proofs/extension_preview_proof.json", `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      network: "Preview",
      provider: "window.cardano.phantomPrototype",
      sender: process.env.CARDANO_ADDRESS_1,
      receiver: process.env.CARDANO_ADDRESS_2,
      transactionHash: txHash,
      transactionBodyHash: bodyHash.to_hex(),
      certificate: "DRepUpdate",
      transferLovelace: String(transfer),
      feeLovelace: String(fee),
      witnessCount: witnesses.vkeys().len(),
      verifiedWitnesses: verified,
      confirmationsAtCapture: status.num_confirmations,
    }, null, 2)}\n`);
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});
