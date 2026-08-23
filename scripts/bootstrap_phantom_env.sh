#!/usr/bin/env bash
# ==============================================================================
# PHANTOM ECOSYSTEM PORTABILITY: CARDANO POC CONFIGURATION BOOTSTRAPPER
# ==============================================================================
# This script automates configuring '.env.development' on fresh checkouts.
# It checks your mnemonics, generates brand-new secure seed phrases if missing,
# programmatically derives their standard Shelley Bech32 base addresses, and
# automatically populates '.env.development' with zero manual editing required!
# ==============================================================================

set -euo pipefail

# ANSI color codes
GREEN='\x1b[32m'
YELLOW='\x1b[33m'
RED='\x1b[31m'
CYAN='\x1b[36m'
NC='\x1b[0m' # No Color

echo -e "${GREEN}[*] Bootstrapping Cardano Phantom POC Environment Configurations...${NC}"

# 1. Create .env.development from template if missing
if [ ! -f ".env.development" ]; then
    echo -e "${YELLOW}[*] Configuration Alert: '.env.development' not found. Creating from template...${NC}"
    cp .env.example .env.development
fi

# 2. Execute programmatic mnemonic generation and address derivation via inline Node
echo -e "${GREEN}[*] Initializing cryptographic key derivations...${NC}"
node -e "
const fs = require('fs');
const bip39 = require('bip39');
const { CML } = require('@lucid-evolution/lucid');

// Utility to harden index
function harden(num) {
  return 0x80000000 + num;
}

// Derive Bech32 base address from mnemonic seed phrase
function deriveAddress(mnemonic) {
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
    0, // Testnet/Preview Network
    CML.Credential.new_pub_key(paymentKey.to_public().to_raw_key().hash()),
    CML.Credential.new_pub_key(stakeKey.to_raw_key().hash())
  );
  return baseAddr.to_address().to_bech32();
}

const envPath = '.env.development';
let envContent = fs.readFileSync(envPath, 'utf8');

// Parse current variables
const parseVar = (key) => {
  const match = envContent.match(new RegExp('^' + key + '=(.*)$', 'm'));
  return match ? match[1].replace(/\"/g, '').trim() : '';
};

let m1 = parseVar('CARDANO_MNEMONIC');
let m2 = parseVar('CARDANO_MNEMONIC_2');

// 1. Generate Wallet 1 Mnemonic if missing, placeholder, or cryptographically invalid
if (!m1 || m1.includes('your twelve') || m1.includes('placeholder') || !bip39.validateMnemonic(m1)) {
  console.log('\x1b[33m[*] Wallet 1 Seed Phrase missing or invalid. Generating secure 24-word mnemonic on-the-fly...\x1b[0m');
  m1 = bip39.generateMnemonic(256); // 24 words
}

// 2. Generate Wallet 2 Mnemonic if missing, placeholder, or cryptographically invalid
if (!m2 || m2.includes('your second') || m2.includes('placeholder') || !bip39.validateMnemonic(m2)) {
  console.log('\x1b[33m[*] Wallet 2 Seed Phrase missing or invalid. Generating secure 24-word mnemonic on-the-fly...\x1b[0m');
  m2 = bip39.generateMnemonic(256); // 24 words
}

// 3. Derive standard Shelley base addresses
const addr1 = deriveAddress(m1);
const addr2 = deriveAddress(m2);

// 4. Update the environment file content dynamically
const updateOrAdd = (key, value) => {
  const regex = new RegExp('^' + key + '=.*$', 'm');
  const newLine = key + '=\"' + value + '\"';
  if (envContent.match(regex)) {
    envContent = envContent.replace(regex, newLine);
  } else {
    envContent += '\n' + newLine;
  }
};

updateOrAdd('CARDANO_MNEMONIC', m1);
updateOrAdd('CARDANO_ADDRESS_1', addr1);
updateOrAdd('CARDANO_MNEMONIC_2', m2);
updateOrAdd('CARDANO_ADDRESS_2', addr2);

fs.writeFileSync(envPath, envContent);

console.log('\n\x1b[32m======================================================================\x1b[0m');
console.log('\x1b[32m🏆 PHANTOM POC CONFIGURATION BOOTSTRAP COMPLETED SUCCESSFULLY!\x1b[0m');
console.log('\x1b[32m======================================================================\x1b[0m');
console.log('    Derived Wallet 1 (Sender)   : \x1b[36m' + addr1 + '\x1b[0m');
console.log('    Derived Wallet 2 (Receiver) : \x1b[36m' + addr2 + '\x1b[0m');
console.log('    Local Config File Modified  : \x1b[33m' + envPath + '\x1b[0m');
console.log('\x1b[32m======================================================================\x1b[0m');
console.log('\x1b[33m[*] ACTION REQUIRED: STEP 1 - GET DEMETER BLOCKFROST API ACCESS\x1b[0m');
console.log('    Demeter is run jointly by TxPipe and Blink Labs, two independent');
console.log('    engineering teams you already know from the Cardano ecosystem.');
console.log('    1. Go to: \x1b[36mhttps://demeter.run/\x1b[0m and register a free account.');
console.log('    2. Create a project targeting the \x1b[33mCardano Preview Network\x1b[0m.');
console.log('    3. Enable the \x1b[33mBlockfrost RYO\x1b[0m extension under Extensions.');
console.log('    4. Copy your Blockfrost URL and API Key and paste them into your');
console.log('       local \x1b[33m.env.development\x1b[0m file as:');
console.log('       - \x1b[36mDEMETER_BLOCKFROST_URL\x1b[0m');
console.log('       - \x1b[36mDEMETER_API_KEY\x1b[0m');
console.log('\x1b[32m======================================================================\x1b[0m');
console.log('\x1b[33m[*] ACTION REQUIRED: STEP 2 - REQUEST FAUCET tADA FOR WALLET 1\x1b[0m');
console.log('    To execute transactions, Wallet 1 (Sender) must be funded with testnet ADA.');
console.log('    Please request free tADA from the official Cardano Preview Faucet:');
console.log('    👉 \x1b[36mhttps://docs.cardano.org/cardano-testnets/tools/faucet\x1b[0m');
console.log('    (Paste Wallet 1: \x1b[36m' + addr1 + '\x1b[0m)');
console.log('\x1b[32m======================================================================\n\x1b[0m');
"
