const fs = require("fs");
const crypto = require("crypto");
const bip39 = require("bip39");
const { decode, encode } = require("cbor-x");
const dotenv = require("dotenv");
const { blake2b } = require("@noble/hashes/blake2b");
const { bytesToHex } = require("@noble/hashes/utils");
const { CML } = require("@lucid-evolution/lucid");
const { signData, verifyData } = require("@lucid-evolution/sign_data");

const TX_HASH = "e8f2950e46ad4f4521453abcc37ad77bdfacfaccdd6cb1603dca06a77d6aae88";
const BLOCK_HEIGHT = 4616153;
const DREP_CREDENTIAL = "7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2";
const DREP_PUBLIC_KEY = "0cb54c87799984002c09cec6f5f2d04add16bca87911db86c7332462562348b4";
const KOIOS = "https://preview.koios.rest/api/v1";

function fail(message) {
  throw new Error(`Verification failed: ${message}`);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

async function query(path, body) {
  const response = await fetch(`${KOIOS}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(`${path} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

function loadEnvironment() {
  const path = process.env.CARDANO_ENV_FILE || ".env.development";
  expect(fs.existsSync(path), `${path} is missing`);
  const env = dotenv.parse(fs.readFileSync(path));
  for (const name of ["CARDANO_MNEMONIC", "CARDANO_ADDRESS_1", "CARDANO_ADDRESS_2"]) {
    expect(env[name], `${name} is missing from ${path}`);
  }
  return env;
}

function deriveProof(env) {
  const harden = number => 0x80000000 + number;
  const entropy = Buffer.from(bip39.mnemonicToEntropy(env.CARDANO_MNEMONIC), "hex");
  const root = CML.Bip32PrivateKey.from_bip39_entropy(entropy, Buffer.from(""));
  const account = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payment = account.derive(0).derive(0);
  const stake = account.derive(2).derive(0);
  const drep = account.derive(3).derive(0).to_raw_key();
  const address = CML.BaseAddress.new(
    0,
    CML.Credential.new_pub_key(payment.to_public().to_raw_key().hash()),
    CML.Credential.new_pub_key(stake.to_public().to_raw_key().hash()),
  ).to_address().to_bech32();
  const publicKey = Buffer.from(drep.to_public().to_raw_bytes());
  const independentHash = bytesToHex(blake2b(publicKey, { dkLen: 28 }));

  expect(address === env.CARDANO_ADDRESS_1, "derived payment address does not match CARDANO_ADDRESS_1");
  expect(CML.Address.from_bech32(env.CARDANO_ADDRESS_2).network_id() === 0, "CARDANO_ADDRESS_2 is not a testnet address");
  expect(publicKey.toString("hex") === DREP_PUBLIC_KEY, "CIP-105 DRep public key mismatch");
  expect(independentHash === DREP_CREDENTIAL, "independent Blake2b-224 credential mismatch");
  return { drep, independentHash };
}

async function verifyLedger(env) {
  const [transaction] = await query("tx_info", {
    _tx_hashes: [TX_HASH],
    _inputs: true,
    _assets: true,
    _withdrawals: true,
    _certs: true,
  });
  expect(transaction?.tx_hash === TX_HASH, "transaction was not found");
  expect(transaction.block_height === BLOCK_HEIGHT, "unexpected confirmation block");
  expect(transaction.inputs.some(input => input.payment_addr?.bech32 === env.CARDANO_ADDRESS_1), "sender input missing");
  expect(transaction.outputs.some(output =>
    output.payment_addr?.bech32 === env.CARDANO_ADDRESS_2 && output.value === "2000000"), "2 tADA receiver output missing");
  const certificate = transaction.certificates.find(item => item.type === "drep_registration");
  expect(certificate?.info?.drep_hex === DREP_CREDENTIAL, "DRep registration certificate mismatch");
  expect(certificate.info.deposit === "500000000", "DRep deposit mismatch");

  const drepVkh = CML.Ed25519KeyHash.from_hex(DREP_CREDENTIAL).to_bech32("drep_vkh");
  const [drep] = await query("drep_info", { _drep_ids: [drepVkh] });
  expect(drep?.hex === DREP_CREDENTIAL, "DRep state credential mismatch");
  return {
    fee: transaction.fee,
    deposit: certificate.info.deposit,
    drepId: drep.drep_id,
    currentState: `${drep.drep_status}, active=${drep.active}`,
  };
}

function verifyCose(drep) {
  const payload = Buffer.from(`Phantom CIP-95 Preview proof ${TX_HASH}`).toString("hex");
  const signed = signData(DREP_CREDENTIAL, payload, drep.to_bech32());
  const verified = verifyData(DREP_CREDENTIAL, DREP_CREDENTIAL, payload, signed);
  expect(verified, "CIP-95 COSE signature did not verify");

  const [protectedBytes, unprotected, decodedPayload, signature] = decode(Buffer.from(signed.signature, "hex"));
  const protectedHeaders = decode(protectedBytes);
  const coseKey = decode(Buffer.from(signed.key, "hex"));
  const field = (value, key) => value instanceof Map ? value.get(key) : value[key];
  expect(field(protectedHeaders, 1) === -8, "COSE protected algorithm is not EdDSA");
  expect(Buffer.from(field(protectedHeaders, "address")).toString("hex") === DREP_CREDENTIAL, "COSE DRep ID mismatch");
  expect(unprotected.hashed === false, "COSE payload unexpectedly marked as hashed");
  expect(Buffer.from(decodedPayload).toString("hex") === payload, "COSE payload mismatch");
  expect(field(coseKey, 1) === 1 && field(coseKey, 3) === -8 && field(coseKey, -1) === 6, "COSE key parameters mismatch");
  expect(Buffer.from(field(coseKey, -2)).toString("hex") === DREP_PUBLIC_KEY, "COSE public key mismatch");

  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(DREP_PUBLIC_KEY, "hex")]);
  const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  const sigStructure = encode(["Signature1", protectedBytes, Buffer.alloc(0), decodedPayload]);
  expect(crypto.verify(null, sigStructure, publicKey, signature), "independent Ed25519 verification failed");
  const tampered = Buffer.from(signature);
  tampered[0] ^= 1;
  expect(!crypto.verify(null, sigStructure, publicKey, tampered), "tampered signature unexpectedly verified");
  return { payloadBytes: payload.length / 2, signatureBytes: signed.signature.length / 2 };
}

async function main() {
  const env = loadEnvironment();
  console.log("CIP-95 / CIP-105 CARDANO PREVIEW VERIFICATION");
  console.log("------------------------------------------------------------");
  const derivation = deriveProof(env);
  console.log("[PASS] CIP-105 path: m/1852'/1815'/0'/3/0");
  console.log(`[PASS] Raw DRep public key: ${DREP_PUBLIC_KEY}`);
  console.log(`[PASS] Independent Blake2b-224: ${derivation.independentHash}`);

  const ledger = await verifyLedger(env);
  console.log(`[PASS] Preview transaction confirmed in block ${BLOCK_HEIGHT}`);
  console.log("[PASS] Transaction contains a 2.000000 tADA receiver output");
  console.log(`[PASS] Transaction fee: ${Number(ledger.fee) / 1_000_000} tADA`);
  console.log(`[PASS] DRep deposit: ${Number(ledger.deposit) / 1_000_000} tADA`);
  console.log(`[PASS] Registered DRep ID: ${ledger.drepId}`);
  console.log(`[INFO] Current DRep state: ${ledger.currentState}`);

  const cose = verifyCose(derivation.drep);
  console.log(`[PASS] CIP-95 COSE fields and Ed25519 signature independently verified (${cose.payloadBytes}-byte payload)`);
  console.log(`[PASS] Explorer: https://preview.cardanoscan.io/transaction/${TX_HASH}`);
  console.log("------------------------------------------------------------");
  console.log("CIP-95 CRYPTOGRAPHY / CIP-105 DERIVATION / PREVIEW LEDGER CHECKS PASSED");
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
