/**
 * @file local-gateway-proxy.js
 * @description Local Gateway Proxy to bridge standard SDK requests, strip /api/v0,
 * and implement actual on-chain CIP-30 cryptographic signing, transaction building, and data-fetching.
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');
const { Lucid, Blockfrost, CML } = require('@lucid-evolution/lucid');
const bip39 = require('bip39');
const path = require('path');

// Load environment variables securely from .env.development
require('dotenv').config({ path: '.env.development' });

const app = express();
const PORT = 8080;

app.use(express.json());

// Serve the mock dApp statically on http://localhost:8080/dapp/index.html
app.use('/dapp', express.static(path.join(__dirname, '../apps/mock-dapp')));

const DEMETER_TARGET = process.env.DEMETER_BLOCKFROST_URL || "https://cardano-preview.blockfrost-m1.demeter.run";
const DEMETER_API_KEY = process.env.DEMETER_API_KEY;

if (!DEMETER_API_KEY) {
  console.error("[!] Error: DEMETER_API_KEY environment variable is not defined inside .env.development");
  process.exit(1);
}

function harden(num) {
  return 0x80000000 + num;
}

// -----------------------------------------------------------------------------
// DERIVE SENDER WALLET SECURELY ON STARTUP (NO HARDCODING)
// -----------------------------------------------------------------------------
console.log("Successfully loaded .env.development");
console.log(`Configured DEMETER_TARGET: ${DEMETER_TARGET}`);

const entropy = bip39.mnemonicToEntropy(process.env.CARDANO_MNEMONIC);
const rootKey = CML.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
const accountKey = rootKey.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
const paymentKey = accountKey.derive(0).derive(0);
const stakeKey = accountKey.derive(2).derive(0).to_public();

const baseAddr = CML.BaseAddress.new(
  0, // Preview Network ID
  CML.Credential.new_pub_key(paymentKey.to_public().to_raw_key().hash()),
  CML.Credential.new_pub_key(stakeKey.to_raw_key().hash())
);

const SENDER_ADDRESS = baseAddr.to_address().to_bech32();
const SENDER_PRIVATE_KEY = paymentKey.to_raw_key();

console.log(`[Local Gateway] Master Wallet Address derived: ${SENDER_ADDRESS}`);

// -----------------------------------------------------------------------------
// ON-CHAIN TRANSACTION COMPILER & SUBMITTER ENDPOINTS
// -----------------------------------------------------------------------------
app.get('/wallet/create-transfer-tx', async (req, res) => {
  console.log("[Local Gateway] Compiling real 2 ADA transaction on-chain via Lucid...");
  try {
    const lucid = await Lucid(
      new Blockfrost("http://localhost:8080/api/v0", "proxy-injects-keys"),
      "Preview"
    );
    lucid.selectWallet.fromAddress(SENDER_ADDRESS);
    
    const RECEIVER_ADDRESS = "addr_test1qpf6w9378jw6g2jw73mzhdegl8nmwsvc0u706mq9cm5rsl0es6q6wssum99cqyj3e8qu6px3fvt90nw6h2t2yavf5c7snddx07";
    const tx = await lucid
      .newTx()
      .pay.ToAddress(RECEIVER_ADDRESS, { lovelace: 2000000n }) // 2 ADA
      .complete();
      
    console.log("[Local Gateway] 2 ADA Transaction body compiled successfully!");
    return res.json({ txCbor: tx.toCBOR() });
  } catch (err) {
    console.error("[Local Gateway] Failed to compile transaction body:", err.message || err);
    return res.status(500).json({ error: err.message || err });
  }
});

app.post('/wallet/submit-assembled-tx', async (req, res) => {
  const { txCbor, witnessSetCbor } = req.body;
  console.log("[Local Gateway] Assembling raw transaction body and cryptographic witness set...");
  try {
    const tx = CML.Transaction.from_cbor_hex(txCbor);
    const witnesses = CML.TransactionWitnessSet.from_cbor_hex(witnessSetCbor);
    
    // Assemble the complete transaction package
    const completedTx = CML.Transaction.new(tx.body(), witnesses, true, tx.auxiliary_data());
    const completedTxHex = completedTx.to_cbor_hex();
    
    console.log("[Local Gateway] Transaction assembled successfully. Broadcasting to network...");
    const response = await axios.post(`${DEMETER_TARGET}/tx/submit`, Buffer.from(completedTxHex, 'hex'), {
      headers: {
        "dmtr-api-key": DEMETER_API_KEY,
        "Content-Type": "application/cbor"
      }
    });
    
    const txHash = response.data;
    console.log(`[Local Gateway] Broadcast successful! Hash: ${txHash}`);
    return res.json({ txHash });
  } catch (err) {
    const errorDetails = err.response ? err.response.data : err.message || err;
    console.error("[Local Gateway] Broadcast failed:", JSON.stringify(errorDetails));
    return res.status(500).json({ error: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails });
  }
});

// -----------------------------------------------------------------------------
// SECURE CIP-30 WEB EXTENSION API ROUTER
// -----------------------------------------------------------------------------
app.post('/wallet/api', async (req, res) => {
  const { method, params } = req.body;
  console.log(`[Local Gateway] CIP-30 request received: ${method}`);

  try {
    if (method === "isEnabled" || method === "enable") {
      return res.json({ result: true });
    }

    if (method === "getNetworkId") {
      return res.json({ result: 0 }); // Preview Network
    }

    if (method === "getChangeAddress") {
      const addrHex = CML.Address.from_bech32(SENDER_ADDRESS).to_hex();
      return res.json({ result: addrHex });
    }

    if (method === "getUsedAddresses") {
      const addrHex = CML.Address.from_bech32(SENDER_ADDRESS).to_hex();
      return res.json({ result: [addrHex] });
    }

    if (method === "getUnusedAddresses") {
      return res.json({ result: [] });
    }

    if (method === "getRewardAddresses") {
      const rewardAddr = CML.RewardAddress.new(
        0, // Preview
        CML.Credential.new_pub_key(stakeKey.to_raw_key().hash())
      );
      return res.json({ result: [rewardAddr.to_address().to_hex()] });
    }

    if (method === "getBalance") {
      // Fetch actual Lovelace balance from Demeter Preview
      const balanceRes = await axios.get(`${DEMETER_TARGET}/addresses/${SENDER_ADDRESS}`, {
        headers: { "dmtr-api-key": DEMETER_API_KEY }
      });
      const lovelaceAmount = balanceRes.data.amount.find(a => a.unit === "lovelace");
      const lovelaces = lovelaceAmount ? lovelaceAmount.quantity : "0";

      // Serialize to CIP-30 CBOR Value representation
      const val = CML.Value.from_coin(BigInt(lovelaces));
      const balanceCborHex = val.to_cbor_hex();
      return res.json({ result: balanceCborHex });
    }

    if (method === "getUtxos") {
      // Fetch actual unspent outputs from Demeter Preview
      const utxoRes = await axios.get(`${DEMETER_TARGET}/addresses/${SENDER_ADDRESS}/utxos`, {
        headers: { "dmtr-api-key": DEMETER_API_KEY }
      });
      
      const utxos = utxoRes.data || [];
      const utxosCborList = [];

      for (const u of utxos) {
        const txInput = CML.TransactionInput.new(
          CML.TransactionHash.from_hex(u.tx_hash),
          BigInt(u.output_index)
        );

        const amountVal = CML.Value.from_coin(BigInt(u.amount[0].quantity));
        const txOutput = CML.TransactionOutput.new(
          CML.Address.from_bech32(SENDER_ADDRESS),
          amountVal
        );

        const unspentOutput = CML.TransactionUnspentOutput.new(txInput, txOutput);
        utxosCborList.push(unspentOutput.to_cbor_hex());
      }

      return res.json({ result: utxosCborList.length > 0 ? utxosCborList : null });
    }

    if (method === "signTx") {
      console.log("[Local Gateway] signTx received params:", JSON.stringify(params));
      const { tx: txCborHex } = params;
      console.log("[Local Gateway] Performing cryptographic Ed25519 signing on raw transaction CBOR...");
      
      // Decode transaction CBOR
      const tx = CML.Transaction.from_cbor_hex(txCborHex);
      const txHash = CML.hash_transaction(tx.body());

      // Create cryptographically valid witness signature
      const vkeyWitness = CML.make_vkey_witness(txHash, SENDER_PRIVATE_KEY);
      
      const witnesses = CML.TransactionWitnessSet.new();
      const vkeyWitnessesList = CML.VkeywitnessList.new();
      vkeyWitnessesList.add(vkeyWitness);
      witnesses.set_vkeywitnesses(vkeyWitnessesList);

      const witnessSetCborHex = witnesses.to_cbor_hex();
      console.log(`[Local Gateway] Signature WitnessSet generated successfully: ${witnessSetCborHex.slice(0, 32)}...`);
      return res.json({ result: witnessSetCborHex });
    }

    if (method === "submitTx") {
      const { tx: txCborHex } = params;
      console.log("[Local Gateway] Broadcasting signed transaction to Cardano network...");

      const response = await axios.post(`${DEMETER_TARGET}/tx/submit`, Buffer.from(txCborHex, 'hex'), {
        headers: {
          "dmtr-api-key": DEMETER_API_KEY,
          "Content-Type": "application/cbor"
        }
      });

      const txHash = response.data;
      console.log(`[Local Gateway] Transaction broadcasted successfully! Hash: ${txHash}`);
      return res.json({ result: txHash });
    }

    throw new Error(`Unsupported CIP-30 method: ${method}`);

  } catch (err) {
    console.error(`[Local Gateway] Error in method '${method}':`, err.message || err);
    return res.status(500).json({ error: err.message || err });
  }
});

// -----------------------------------------------------------------------------
// STANDARD REVERSE PROXY FOR GENERAL BLOCKFROST API ENDPOINTS
// -----------------------------------------------------------------------------
app.use('/api/v0', createProxyMiddleware({
  target: DEMETER_TARGET,
  changeOrigin: true,
  pathRewrite: {
    '^/api/v0': '', // Strips the legacy /api/v0 prefix to prevent Cloudflare 404s
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('dmtr-api-key', DEMETER_API_KEY);
    },
    proxyRes: (proxyRes, req, res) => {
      proxyRes.headers['Access-Control-Allow-Origin'] = '*';
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Phantom Local Gateway Proxy running on http://localhost:${PORT}`);
});
