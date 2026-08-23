/**
 * @file poll_balance.js
 * @description Programmatic automated polling engine to verify on-chain ADA funding on the Cardano Preview Network.
 */

const axios = require('axios');

const path = require('path');
// Load environment variables securely from .env.development
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });

const DEMETER_API_URL = process.env.DEMETER_BLOCKFROST_URL || "https://cardano-preview.blockfrost-m1.demeter.run";
const DEMETER_API_KEY = process.env.DEMETER_API_KEY;
const TARGET_ADDRESS = "addr_test1qqqt0pru382hy9vjlsxv3ye02z50sfvt8xunscg5pgden77z73dpdfng2ctw2ekqplqgrljelz7h4dneac27nn3qx3rqqpavzj";

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const NC = '\x1b[0m'; // No Color

async function poll() {
  console.log(CYAN + "\n======================================================================" + NC);
  console.log(GREEN + "[*] Cardano Preview Network Automated Balance Verification Engine" + NC);
  console.log("    Target Address: " + YELLOW + TARGET_ADDRESS + NC);
  console.log("    Data Provider : " + DEMETER_API_URL);
  console.log(CYAN + "======================================================================\n" + NC);

  let attempt = 0;
  const intervalMs = 5000; // Poll every 5 seconds

  while (true) {
    attempt++;
    try {
      // Query address ledger state
      const res = await axios.get(`${DEMETER_API_URL}/addresses/${TARGET_ADDRESS}`, {
        headers: { "dmtr-api-key": DEMETER_API_KEY },
        timeout: 5000
      });

      const amountObj = res.data.amount.find(a => a.unit === "lovelace");
      const lovelace = BigInt(amountObj ? amountObj.quantity : "0");
      const ada = Number(lovelace) / 1000000;

      if (lovelace > 0n) {
        console.log("\n" + GREEN + "======================================================================" + NC);
        console.log(GREEN + "[+] SUCCESS: ADA DETECTED IN YOUR WALLET!" + NC);
        console.log(GREEN + "======================================================================" + NC);
        console.log("    Final Balance : " + YELLOW + ada.toLocaleString('en-US', { minimumFractionDigits: 6 }) + " ADA" + NC);
        console.log("    Network Target: Cardano Preview Network (ID: 0)");
        console.log("    On-Chain Address: " + TARGET_ADDRESS);
        console.log(GREEN + "======================================================================\n" + NC);
        break; // Exit successfully!
      } else {
        process.stdout.write(
          YELLOW + `[*] Attempt #${attempt}: Balance is 0.000000 ADA. Waiting for faucet transfer...\r` + NC
        );
      }
    } catch (err) {
      process.stdout.write(
        RED + `[!] Attempt #${attempt} failed: Node connection degraded. Retrying...\r` + NC
      );
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

poll();
