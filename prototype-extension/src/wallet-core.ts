import * as CSL from "@emurgo/cardano-serialization-lib-asmjs";
import { mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { encode } from "cbor-x";
import { blake2b } from "@noble/hashes/blake2b";

const harden = (value: number) => 0x80000000 + value;

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
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g)?.map(byte => Number.parseInt(byte, 16)) ?? []);

function coseSign(addressHex: string, payloadHex: string, key: any) {
  const protectedBytes = encode(new Map([[1, -8], ["address", hexToBytes(addressHex)]]));
  const payload = hexToBytes(payloadHex);
  const sigStructure = encode(["Signature1", protectedBytes, new Uint8Array(), payload]);
  const signature = key.sign(sigStructure).to_bytes();
  const sign1 = encode([protectedBytes, { hashed: false }, payload, signature]);
  const coseKey = encode(new Map([[1, 1], [3, -8], [-1, 6], [-2, key.to_public().as_bytes()]]));
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
  return rows.map((row: any) => {
    if (row.asset_list?.length) throw new Error("Prototype does not yet support native-asset UTxOs.");
    const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(row.tx_hash), row.tx_index);
    const output = CSL.TransactionOutput.new(wallet.address, CSL.Value.new(CSL.BigNum.from_str(row.value)));
    return CSL.TransactionUnspentOutput.new(input, output).to_hex();
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
  witnesses.set_vkeys(list);
  return witnesses.to_hex();
}

export const walletCore = {
  inspect(mnemonic: string) {
    const wallet = derive(mnemonic);
    return {
      address: wallet.address.to_bech32(),
      drepPublicKey: bytesToHex(wallet.drep.to_public().as_bytes()),
    };
  },
  async call(method: string, params: any, config: { mnemonic: string }, cip95Enabled: boolean) {
    const wallet = derive(config.mnemonic);
    if (method === "getNetworkId") return 0;
    if (method === "getChangeAddress") return wallet.address.to_hex();
    if (method === "getUsedAddresses") return [wallet.address.to_hex()];
    if (method === "getUnusedAddresses") return [];
    if (method === "getRewardAddresses") return [wallet.reward.to_hex()];
    if (method === "getUtxos") {
      const utxos = await getUtxos(wallet);
      const paginate = params?.paginate;
      const selected = paginate ? utxos.slice(paginate.page * paginate.limit, (paginate.page + 1) * paginate.limit) : utxos;
      return selected.length ? selected : null;
    }
    if (method === "getBalance") {
      const [info] = await koios("address_info", { _addresses: [wallet.address.to_bech32()] });
      return CSL.Value.new(CSL.BigNum.from_str(info?.balance ?? "0")).to_hex();
    }
    if (method === "signTx") {
      const keys = cip95Enabled ? [wallet.payment, wallet.stake, wallet.drep] : [wallet.payment, wallet.stake];
      return witnessSet(params.tx, keys);
    }
    if (method === "signData") {
      const key = params.addr === wallet.address.to_hex() ? wallet.payment : params.addr === wallet.reward.to_hex() ? wallet.stake : null;
      if (!key) throw new Error("Address does not belong to the configured wallet.");
      return coseSign(params.addr, params.payload, key);
    }
    if (method === "cip95.getPubDRepKey") return bytesToHex(wallet.drep.to_public().as_bytes());
    if (method === "cip95.getUnregisteredPubStakeKeys") {
      return await stakeRegistered(wallet) ? [] : [bytesToHex(wallet.stake.to_public().as_bytes())];
    }
    if (method === "getRegisteredPubStakeKeys") {
      return await stakeRegistered(wallet) ? [bytesToHex(wallet.stake.to_public().as_bytes())] : [];
    }
    if (method === "cip95.signData") {
      if (!cip95Enabled) throw new Error("CIP-95 is not enabled.");
      const drepId = bytesToHex(blake2b(wallet.drep.to_public().as_bytes(), { dkLen: 28 }));
      if (params.addr !== drepId) throw new Error("DRep ID does not belong to the configured wallet.");
      return coseSign(params.addr, params.payload, wallet.drep);
    }
    if (method === "submitTx") {
      const response = await fetch("https://preview.koios.rest/api/v1/submittx", {
        method: "POST",
        headers: { "content-type": "application/cbor" },
        body: hexToBytes(params.tx),
      });
      if (!response.ok) throw new Error(`Preview submission returned ${response.status}: ${await response.text()}`);
      return (await response.json()).replace(/^"|"$/g, "");
    }
    throw new Error(`Unsupported wallet method: ${method}`);
  },
};

(globalThis as any).prototypeWalletCore = walletCore;
