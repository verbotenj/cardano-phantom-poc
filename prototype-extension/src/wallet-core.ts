import * as CSL from "@emurgo/cardano-serialization-lib-asmjs";
import { mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Decoder, Encoder } from "cbor-x";
import { blake2b } from "@noble/hashes/blake2b";

const harden = (value: number) => 0x80000000 + value;
const cborDecoder = new Decoder({ mapsAsObjects: false });
const cborEncoder = new Encoder({ useRecords: false, tagUint8Array: false, useTag259ForMaps: false });

function derive(mnemonic: string) {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("Invalid Preview wallet mnemonic.");
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(
    mnemonicToEntropy(mnemonic, wordlist),
    new Uint8Array(),
  );
  const account = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payment = account.derive(0).derive(0).to_raw_key();
  const stake = account.derive(2).derive(0).to_raw_key();
  const drep = account.derive(3).derive(0).to_raw_key();
  const address = CSL.BaseAddress.new(
    0,
    CSL.Credential.from_keyhash(payment.to_public().hash()),
    CSL.Credential.from_keyhash(stake.to_public().hash()),
  ).to_address();
  const reward = CSL.RewardAddress.new(0, CSL.Credential.from_keyhash(stake.to_public().hash())).to_address();
  return { payment, stake, drep, address, reward };
}

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex: string) => {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) throw { code: -1, info: "Expected even-length hexadecimal bytes." };
  return Uint8Array.from(hex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);
};

function coseSign(addressHex: string, payloadHex: string, key: any) {
  const protectedBytes = cborEncoder.encode(new Map([[1, -8], ["address", hexToBytes(addressHex)]]));
  const payload = hexToBytes(payloadHex);
  const sigStructure = cborEncoder.encode(["Signature1", protectedBytes, new Uint8Array(), payload]);
  const signature = key.sign(sigStructure).to_bytes();
  const sign1 = cborEncoder.encode([protectedBytes, { hashed: false }, payload, signature]);
  const coseKey = cborEncoder.encode(new Map([[1, 1], [3, -8], [-1, 6], [-2, key.to_public().as_bytes()]]));
  return { signature: bytesToHex(sign1), key: bytesToHex(coseKey) };
}

async function koios(path: string, body: object) {
  const response = await fetch(`https://preview.koios.rest/api/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Preview API ${path} returned ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getUtxos(wallet: ReturnType<typeof derive>) {
  const rows = await koios("address_utxos", { _addresses: [wallet.address.to_bech32()], _extended: true });
  const hashes = [...new Set((rows ?? []).map((row: any) => row.tx_hash))];
  const transactions = hashes.length ? await koios("tx_cbor", { _tx_hashes: hashes }) : [];
  const outputsByHash = new Map(transactions.map((row: any) => {
    const transaction = cborDecoder.decode(hexToBytes(row.cbor));
    const body = transaction[0];
    return [row.tx_hash, body instanceof Map ? body.get(1) : body[1]];
  }));
  return (rows ?? []).map((row: any) => {
    const outputs = outputsByHash.get(row.tx_hash);
    if (!outputs || row.tx_index >= outputs.length) throw new Error(`Preview API omitted transaction output ${row.tx_hash}#${row.tx_index}.`);
    return bytesToHex(cborEncoder.encode([[hexToBytes(row.tx_hash), row.tx_index], outputs[row.tx_index]]));
  });
}

async function stakeRegistered(wallet: ReturnType<typeof derive>) {
  const [account] = await koios("account_info", { _stake_addresses: [wallet.reward.to_bech32()] });
  return account?.status === "registered";
}

function witnessSet(txHex: string, keys: any[]) {
  const transaction = CSL.FixedTransaction.from_hex(txHex);
  const hash = transaction.transaction_hash();
  const list = CSL.Vkeywitnesses.new();
  for (const key of keys) list.add(CSL.make_vkey_witness(hash, key));
  const witnesses = CSL.TransactionWitnessSet.new();
  if (keys.length) witnesses.set_vkeys(list);
  return witnesses.to_hex();
}

const credentialHash = (credential: any) => credential?.to_keyhash()?.to_hex();

async function transactionWitnesses(txHex: string, partialSign: boolean, wallet: ReturnType<typeof derive>) {
  const walletUtxos = await getUtxos(wallet);
  let transaction;
  try {
    transaction = CSL.FixedTransaction.from_hex(txHex);
  } catch {
    throw { code: -1, info: "Invalid transaction CBOR." };
  }
  const body = transaction.body();
  const paymentHash = wallet.payment.to_public().hash().to_hex();
  const stakeHash = wallet.stake.to_public().hash().to_hex();
  const drepHash = bytesToHex(blake2b(wallet.drep.to_public().as_bytes(), { dkLen: 28 }));
  const keys = new Map([[paymentHash, wallet.payment], [stakeHash, wallet.stake], [drepHash, wallet.drep]]);
  const required = new Set<string>();
  let missing = false;
  const existing = new Set<string>();
  const existingVkeys = transaction.witness_set()?.vkeys?.();
  if (existingVkeys) for (let index = 0; index < existingVkeys.len(); index++) {
    existing.add(existingVkeys.get(index).vkey().public_key().hash().to_hex());
  }

  const knownInputs = new Set(walletUtxos.map(hex => {
    const input = CSL.TransactionUnspentOutput.from_hex(hex).input();
    return `${input.transaction_id().to_hex()}#${input.index()}`;
  }));
  const inputs = body.inputs();
  for (let index = 0; index < inputs.len(); index++) {
    const input = inputs.get(index);
    if (knownInputs.has(`${input.transaction_id().to_hex()}#${input.index()}`)) required.add(paymentHash);
    else missing = true;
  }
  const collateral = body.collateral();
  if (collateral) for (let index = 0; index < collateral.len(); index++) {
    const input = collateral.get(index);
    if (knownInputs.has(`${input.transaction_id().to_hex()}#${input.index()}`)) required.add(paymentHash);
    else missing = true;
  }

  const certs = body.certs();
  if (certs) for (let index = 0; index < certs.len(); index++) {
    const cert = certs.get(index);
    const kind = cert.kind();
    if (kind === CSL.CertificateKind.GenesisKeyDelegation || kind === CSL.CertificateKind.MoveInstantaneousRewardsCert) {
      throw { code: 3, info: "Deprecated certificate is not supported in Conway transactions." };
    }
    let hash;
    if (kind === CSL.CertificateKind.DRepRegistration) hash = credentialHash(cert.as_drep_registration().voting_credential());
    else if (kind === CSL.CertificateKind.DRepDeregistration) hash = credentialHash(cert.as_drep_deregistration().voting_credential());
    else if (kind === CSL.CertificateKind.DRepUpdate) hash = credentialHash(cert.as_drep_update().voting_credential());
    else {
      const stakeCert = cert.as_stake_registration() || cert.as_stake_deregistration() || cert.as_stake_delegation() ||
        cert.as_vote_delegation() || cert.as_stake_and_vote_delegation() || cert.as_stake_registration_and_delegation() ||
        cert.as_vote_registration_and_delegation() || cert.as_stake_vote_registration_and_delegation();
      hash = stakeCert && credentialHash(stakeCert.stake_credential());
    }
    if (hash && keys.has(hash)) required.add(hash);
    else if (hash && !existing.has(hash)) missing = true;
    else if (!hash || [CSL.CertificateKind.PoolRegistration, CSL.CertificateKind.PoolRetirement, CSL.CertificateKind.CommitteeHotAuth, CSL.CertificateKind.CommitteeColdResign].includes(kind)) missing = true;
  }

  const explicit = body.required_signers();
  if (explicit) for (let index = 0; index < explicit.len(); index++) {
    const hash = explicit.get(index).to_hex();
    if (keys.has(hash)) required.add(hash);
    else if (!existing.has(hash)) missing = true;
  }
  const withdrawals = body.withdrawals();
  if (withdrawals) {
    const rewards = withdrawals.keys();
    for (let index = 0; index < rewards.len(); index++) {
      const hash = credentialHash(rewards.get(index).payment_cred());
      if (hash === stakeHash) required.add(stakeHash);
      else missing = true;
    }
  }
  const voting = body.voting_procedures();
  if (voting) {
    const voters = voting.get_voters();
    for (let index = 0; index < voters.len(); index++) {
      const voter = voters.get(index);
      if (voter.kind() === CSL.VoterKind.DRepKeyHash) {
        const hash = credentialHash(voter.to_drep_credential());
        if (hash === drepHash) required.add(drepHash);
        else missing = true;
      } else {
        missing = true;
      }
    }
  }
  if (!partialSign && missing) throw { code: 1, info: "Wallet cannot produce every required transaction witness." };
  return witnessSet(txHex, [...required].map(hash => keys.get(hash)));
}

export const walletCore = {
  inspect(mnemonic: string) {
    const wallet = derive(mnemonic);
    return {
      address: wallet.address.to_bech32(),
      drepPublicKey: bytesToHex(wallet.drep.to_public().as_bytes()),
    };
  },
  inspectRequest(method: string, params: any, config: { mnemonic: string }) {
    const wallet = derive(config.mnemonic);
    if (method === "signTx") {
      if (typeof params?.partialSign !== "undefined" && typeof params.partialSign !== "boolean") throw { code: -1, info: "partialSign must be a boolean." };
      let transaction;
      try { transaction = CSL.FixedTransaction.from_hex(params?.tx); } catch { throw { code: -1, info: "Invalid transaction CBOR." }; }
      const certs = transaction.body().certs();
      if (certs) for (let index = 0; index < certs.len(); index++) {
        const kind = certs.get(index).kind();
        if (kind === CSL.CertificateKind.GenesisKeyDelegation || kind === CSL.CertificateKind.MoveInstantaneousRewardsCert) {
          throw { code: 3, info: "Deprecated certificate is not supported in Conway transactions." };
        }
      }
      return JSON.stringify({
        purpose: "Sign Cardano Preview transaction",
        transactionBodyHash: transaction.transaction_hash().to_hex(),
        partialSign: params?.partialSign === true,
        body: JSON.parse(transaction.body().to_json()),
      }, null, 2);
    }
    const address = params?.addr;
    const payload = params?.payload;
    hexToBytes(payload);
    if (method === "cip95.signData") {
      const expected = bytesToHex(blake2b(wallet.drep.to_public().as_bytes(), { dkLen: 28 }));
      if (address !== expected) throw { code: 1, info: "DRep ID does not belong to the configured wallet." };
    } else {
      let decoded;
      try { decoded = CSL.Address.from_bech32(address); } catch {
        try { decoded = CSL.Address.from_hex(address); } catch { throw { code: -1, info: "Invalid Cardano address." }; }
      }
      const credential = CSL.RewardAddress.from_address(decoded)?.payment_cred() || CSL.BaseAddress.from_address(decoded)?.payment_cred() ||
        CSL.EnterpriseAddress.from_address(decoded)?.payment_cred() || CSL.PointerAddress.from_address(decoded)?.payment_cred();
      if (credential && !credential.to_keyhash()) throw { code: 2, info: "Address is controlled by a script, not a public key." };
      const accepted = [wallet.address.to_hex(), wallet.address.to_bech32(), wallet.reward.to_hex(), wallet.reward.to_bech32()];
      if (!accepted.includes(address)) throw { code: 1, info: "Address does not belong to the configured wallet." };
    }
    return JSON.stringify({ purpose: method, address, payloadHex: payload }, null, 2);
  },
  async call(method: string, params: any, config: { mnemonic: string }, cip95Enabled: boolean) {
    const wallet = derive(config.mnemonic);
    if (method === "getNetworkId") return 0;
    if (method === "getChangeAddress") return wallet.address.to_hex();
    if (method === "getUsedAddresses" || method === "getUnusedAddresses") {
      const [info] = await koios("address_info", { _addresses: [wallet.address.to_bech32()] });
      const used = Boolean(info);
      return method === "getUsedAddresses" ? (used ? [wallet.address.to_hex()] : []) : (used ? [] : [wallet.address.to_hex()]);
    }
    if (method === "getRewardAddresses") return [wallet.reward.to_hex()];
    if (method === "getUtxos") {
      const utxos = await getUtxos(wallet);
      const paginate = params?.paginate;
      if (paginate && (!Number.isSafeInteger(paginate.page) || paginate.page < 0 || !Number.isSafeInteger(paginate.limit) || paginate.limit < 1 || paginate.limit > 50)) {
        throw { maxSize: 50 };
      }
      let selected = utxos;
      if (params?.amount) {
        let target;
        try { target = CSL.Value.from_hex(params.amount); } catch { throw { code: -1, info: "Invalid amount Value CBOR." }; }
        let total = CSL.Value.zero();
        const sufficient = [];
        for (const hex of selected) {
          sufficient.push(hex);
          total = total.checked_add(CSL.TransactionUnspentOutput.from_hex(hex).output().amount());
          try { total.checked_sub(target); selected = sufficient; break; } catch {}
        }
        try { total.checked_sub(target); } catch { return null; }
      }
      if (paginate) {
        const start = paginate.page * paginate.limit;
        if (start >= selected.length && selected.length > 0) throw { maxSize: Math.ceil(selected.length / paginate.limit) };
        selected = selected.slice(start, start + paginate.limit);
      }
      return selected;
    }
    if (method === "getBalance") {
      let total = CSL.Value.zero();
      for (const hex of await getUtxos(wallet)) total = total.checked_add(CSL.TransactionUnspentOutput.from_hex(hex).output().amount());
      return total.to_hex();
    }
    if (method === "signTx") {
      if (typeof params?.partialSign !== "undefined" && typeof params.partialSign !== "boolean") throw { code: -1, info: "partialSign must be a boolean." };
      return transactionWitnesses(params.tx, params.partialSign === true, wallet);
    }
    if (method === "signData") {
      let address = params.addr;
      try { address = CSL.Address.from_bech32(address).to_hex(); } catch {}
      const key = address === wallet.address.to_hex() ? wallet.payment : address === wallet.reward.to_hex() ? wallet.stake : null;
      if (!key) throw { code: 1, info: "Wallet cannot produce a signature for this address." };
      hexToBytes(params.payload);
      return coseSign(address, params.payload, key);
    }
    if (["cip95.getPubDRepKey", "cip95.getUnregisteredPubStakeKeys", "getRegisteredPubStakeKeys"].includes(method) && params !== undefined) {
      throw { code: -1, info: `${method} does not accept arguments.` };
    }
    if (method === "cip95.getPubDRepKey") return bytesToHex(wallet.drep.to_public().as_bytes());
    if (method === "cip95.getUnregisteredPubStakeKeys") {
      return await stakeRegistered(wallet) ? [] : [bytesToHex(wallet.stake.to_public().as_bytes())];
    }
    if (method === "getRegisteredPubStakeKeys") {
      return await stakeRegistered(wallet) ? [bytesToHex(wallet.stake.to_public().as_bytes())] : [];
    }
    if (method === "cip95.signData") {
      if (!cip95Enabled) throw { code: -3, info: "CIP-95 is not enabled." };
      const drepId = bytesToHex(blake2b(wallet.drep.to_public().as_bytes(), { dkLen: 28 }));
      if (params.addr !== drepId) throw { code: 1, info: "Wallet cannot produce a signature for this DRep ID." };
      return coseSign(params.addr, params.payload, wallet.drep);
    }
    if (method === "submitTx") {
      const response = await fetch("https://preview.koios.rest/api/v1/submittx", {
        method: "POST",
        headers: { "content-type": "application/cbor" },
        body: hexToBytes(params.tx),
      });
      if (!response.ok) throw { code: 2, info: `Preview submission returned ${response.status}: ${await response.text()}` };
      return (await response.json()).replace(/^"|"$/g, "");
    }
    throw new Error(`Unsupported wallet method: ${method}`);
  },
};

(globalThis as any).prototypeWalletCore = walletCore;
