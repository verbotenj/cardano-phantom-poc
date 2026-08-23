/**
 * @file e2e_wallet_proof.js
 * @description Standard Node.js programmatic E2E script simulating the complete wallet API calls
 * (Onboarding -> Balance Check -> UTXO Selection -> Tx Build -> Sign -> Broadcast) in a single workflow.
 */

const axios = require('axios');
const { Lucid, Blockfrost, CML } = require('@lucid-evolution/lucid');
const bip39 = require('bip39');

const path = require('path');
// Load environment variables securely from .env.development
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

// Load configurations securely from env
const DEMETER_API_URL = process.env.DEMETER_BLOCKFROST_URL || "https://cardano-preview.blockfrost-m1.demeter.run";
const DEMETER_API_KEY = process.env.DEMETER_API_KEY;

// Load BIP-39 Seed Phrases securely from env
const MNEMONIC_1 = process.env.CARDANO_MNEMONIC;
const MNEMONIC_2 = process.env.CARDANO_MNEMONIC_2;

// ANSI colors for professional reporting
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m'; // No Color

function harden(num) {
  return 0x80000000 + num;
}

// Derive Address & Keys using BIP32-Ed25519 & CIP-1852
function deriveWallet(mnemonic, walletIndex) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const rootKey = CML.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from('')
  );

  const accountKey = rootKey
    .derive(harden(1852))
    .derive(harden(1815))
    .derive(harden(0));

  const paymentKey = accountKey.derive(0).derive(0);
  const stakeKey = accountKey.derive(2).derive(0).to_public();

  const baseAddr = CML.BaseAddress.new(
    0, // Testnet/Preview Network ID
    CML.Credential.new_pub_key(paymentKey.to_public().to_raw_key().hash()),
    CML.Credential.new_pub_key(stakeKey.to_raw_key().hash())
  );

  return {
    address: baseAddr.to_address().to_bech32(),
    paymentPrivateKey: paymentKey.to_raw_key(),
    paymentPublicKey: paymentKey.to_public()
  };
}

async function main() {
  console.log(CYAN + "\n======================================================================" + NC);
  console.log(GREEN + "🚀 CARDANO PHANTOM E2E WALLET LifeCycle PROOF SCRIPT" + NC);
  console.log(CYAN + "======================================================================" + NC);

  try {
    // -------------------------------------------------------------------------
    // STEP 1: WALLET INITIALIZATION & ONBOARDING (DERIVATION)
    // -------------------------------------------------------------------------
    console.log(CYAN + "\n[STEP 1] Wallet Onboarding & HD Key Derivation (CIP-1852)" + NC);
    console.log("----------------------------------------------------------------------");
    console.log("[*] Restoring Wallet 1 (Sender) from mnemonic...");
    const sender = deriveWallet(MNEMONIC_1, 1);
    console.log(GREEN + "[+] Derived Sender Address   : " + YELLOW + sender.address + NC);

    console.log("[*] Restoring Wallet 2 (Receiver) from mnemonic...");
    const receiver = deriveWallet(MNEMONIC_2, 2);
    console.log(GREEN + "[+] Derived Receiver Address : " + YELLOW + receiver.address + NC);

    // -------------------------------------------------------------------------
    // STEP 2: SEE ADA (QUERY LEDGER BALANCE & UTXOS)
    // -------------------------------------------------------------------------
    console.log(CYAN + "\n[STEP 2] Querying Blockchain Balance & UTXOs (See ADA)" + NC);
    console.log("----------------------------------------------------------------------");
    console.log("[*] Querying address details from Demeter Preview Node...");
    
    const balanceRes = await axios.get(`${DEMETER_API_URL}/addresses/${sender.address}`, {
      headers: { "dmtr-api-key": DEMETER_API_KEY }
    });

    const lovelaceAmount = balanceRes.data.amount.find(a => a.unit === "lovelace");
    const lovelaces = BigInt(lovelaceAmount ? lovelaceAmount.quantity : "0");
    const ada = Number(lovelaces) / 1000000;

    console.log(GREEN + "[+] On-Chain Balance Detected: " + YELLOW + ada.toLocaleString('en-US', { minimumFractionDigits: 6 }) + " ADA" + NC);

    console.log("[*] Fetching available UTXO list...");
    const utxoResponse = await axios.get(`${DEMETER_API_URL}/addresses/${sender.address}/utxos`, {
      headers: { "dmtr-api-key": DEMETER_API_KEY }
    });

    const rawUtxos = utxoResponse.data;
    console.log(GREEN + `[+] Found ${rawUtxos.length} active UTXO(s) for Sender:` + NC);
    rawUtxos.forEach((u, i) => {
      console.log(`    UTXO #${i+1}: TxHash [${u.tx_hash.slice(0, 16)}...] | Index [${u.output_index}] | Amount [${Number(u.amount[0].quantity)/1000000} ADA]`);
    });

    // -------------------------------------------------------------------------
    // STEP 3: TRANSACTION ASSEMBLY & SIGNING (SEND ADA)
    // -------------------------------------------------------------------------
    console.log(CYAN + "\n[STEP 3] Transaction Assembly & BIP32-Ed25519 Signing (Send ADA)" + NC);
    console.log("----------------------------------------------------------------------");
    console.log("[*] Instantiating Lucid off-chain builder...");
    
    // We instantiate Lucid using our active proxy to strip /api/v0 and inject tokens
    const lucid = await Lucid(
      new Blockfrost("http://localhost:8080/api/v0", "proxy-injects-keys"),
      "Preview"
    );
    lucid.selectWallet.fromSeed(MNEMONIC_1);

    console.log("[*] Assembling 2 tADA transaction body (selecting inputs, calculating change)...");
    const tx = await lucid
      .newTx()
      .pay.ToAddress(receiver.address, { lovelace: 2000000n }) // 2 ADA
      .complete();

    console.log(GREEN + "[+] Transaction Balanced! Inputs, outputs, and minimum fees matched on-chain." + NC);

    console.log("[*] Signing transaction body using Wallet 1 private key...");
    const signedTx = await tx.sign.withWallet().complete();
    console.log(GREEN + "[+] Transaction successfully signed!" + NC);

    // -------------------------------------------------------------------------
    // STEP 4: ON-CHAIN BROADCAST & BLOCK POLLLING
    // -------------------------------------------------------------------------
    console.log(CYAN + "\n[STEP 4] Broadcasting Signed Transaction to Cardano Network" + NC);
    console.log("----------------------------------------------------------------------");
    console.log("[*] Submitting signed CBOR bytes to Demeter Preview Node...");
    let txHash;
    try {
      txHash = await signedTx.submit();
    } catch (submitErr) {
      throw new Error(`Your Demeter Preview node returned a gateway error. This usually indicates an API rate-limit (HTTP 429) or temporary node synchronization lag. Details: ${submitErr.message || submitErr}`);
    }

    console.log(GREEN + `[+] Broadcast successful! Tx Hash: ${txHash}` + NC);

    // Wait for on-chain block inclusion dynamically
    console.log(CYAN + "\n[STEP 5] Waiting for Block Inclusion (Settlement)" + NC);
    console.log("----------------------------------------------------------------------");
    let confirmed = false;
    let attempt = 0;
    const maxAttempts = 30;
    
    while (!confirmed) {
      attempt++;
      if (attempt > maxAttempts) {
        throw new Error(`State Transition Verification Timeout: Transaction was not confirmed within ${maxAttempts} attempts (${maxAttempts * 5}s).`);
      }
      process.stdout.write(YELLOW + `[*] Polling ledger indexer for Tx confirmation (Attempt #${attempt}/${maxAttempts})...\r` + NC);
      try {
        const res = await axios.get(`${DEMETER_API_URL}/txs/${txHash}`, {
          headers: { "dmtr-api-key": DEMETER_API_KEY },
          timeout: 4000
        });
        if (res.data && res.data.hash) {
          confirmed = true;
          console.log("\n" + GREEN + `[+] CONFIRMED: Transaction successfully mined in Block #${res.data.block_height}!` + NC);
        }
      } catch (err) {
        if (err.response && (err.response.status === 404 || err.response.status === 400)) {
          // Silent poll
        } else {
          console.log(RED + `\n[!] Indexer query error (Attempt #${attempt}): ${err.message || err}` + NC);
        }
      }
      if (!confirmed) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log(GREEN + "\n======================================================================" + NC);
    console.log(GREEN + "🏆 E2E LifeCycle WALLET PROOF SUCCESSFUL!" + NC);
    console.log(GREEN + "======================================================================" + NC);
    console.log("    Broadcasted Tx Hash : " + YELLOW + txHash + NC);
    console.log("    Transferred Amount  : " + YELLOW + "2.000000 ADA" + NC);
    console.log("    Sender Address      : " + sender.address);
    console.log("    Receiver Address    : " + receiver.address);
    console.log(GREEN + "======================================================================\n" + NC);

  } catch (err) {
    console.error(RED + "\n[!] E2E Proof Failed:" + NC, err.message || err);
  }
}

main();
