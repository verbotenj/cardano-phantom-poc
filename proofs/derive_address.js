const { CML } = require('@lucid-evolution/lucid');
const bip39 = require('bip39');

const path = require('path');
// Load environment variables securely from .env.development
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

// BIP-39 Mnemonic Seed Phrase from env
const MNEMONIC = process.env.CARDANO_MNEMONIC;

function harden(num) {
  return 0x80000000 + num;
}

async function main() {
  try {
    // 1. Get entropy from mnemonic
    const entropy = bip39.mnemonicToEntropy(MNEMONIC);
    console.log("Mnemonic Entropy:", entropy);

    // 2. Generate Master root key
    const rootKey = CML.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(entropy, 'hex'),
      Buffer.from('')
    );

    // 3. Derive Account Key: m/1852'/1815'/0'
    const accountKey = rootKey
      .derive(harden(1852)) // purpose
      .derive(harden(1815)) // coin type
      .derive(harden(0));   // account index

    // 4. Derive Payment Key: m/1852'/1815'/0'/0/0
    const paymentKey = accountKey
      .derive(0) // External chain
      .derive(0) // Index 0
      .to_public();

    // 5. Derive Stake Key: m/1852'/1815'/0'/2/0
    const stakeKey = accountKey
      .derive(2) // Staking role
      .derive(0) // Index 0
      .to_public();

    // 6. Build Shelley Base Address (Testnet/Preview Network ID: 0)
    const baseAddr = CML.BaseAddress.new(
      0, // Network ID: 0 (Testnet/Preview)
      CML.Credential.new_pub_key(paymentKey.to_public().to_raw_key().hash()),
      CML.Credential.new_pub_key(stakeKey.to_raw_key().hash())
    );

    const addressBech32 = baseAddr.to_address().to_bech32();
    console.log("\n=======================================================");
    console.log("VERIFIED DERIVED CARDANO PREVIEW ADDRESS:");
    console.log(addressBech32);
    console.log("=======================================================");
  } catch (err) {
    console.error("Derivation Error:", err);
  }
}

main();
