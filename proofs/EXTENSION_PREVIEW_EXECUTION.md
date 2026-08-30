# Installed extension Preview execution proof

Captured on 2026-08-30 against Cardano Preview with the repository's unpacked Manifest V3 prototype installed in Chromium by Playwright.

- Provider: `window.cardano.phantomPrototype`
- Transaction: [`51a248639c074e4f567aad647a2635ce4feeaff10515187065013e4f5f333c9c`](https://preview.cardanoscan.io/transaction/51a248639c074e4f567aad647a2635ce4feeaff10515187065013e4f5f333c9c)
- Block: `4616412` (`09c8e85be2ed43a938ec666610ec99ae3aaf35ebe508d0707ba0138958ab9b02`)
- Transfer: 2,000,000 lovelace from address 1 to address 2
- Fee: 300,000 lovelace
- Governance certificate: `DRepUpdate`, key hash `7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2`
- Witnesses: two; the test independently verified the payment and DRep Ed25519 signatures over the transaction-body hash before submission
- Submission: performed through the injected provider's CIP-30 `submitTx`
- Confirmation: observed through Koios Preview before the test completed

The machine-readable capture is in [`extension_preview_proof.json`](extension_preview_proof.json). Reproduce the state-changing proof with `npm run proof:extension-preview` after configuring the ignored `.env.development` file.

This proves the repository's unofficial installed-extension prototype can carry a dApp-originated injected-provider request through extension IPC, approval, key-backed CIP-30/CIP-95 signing, submission, and Preview confirmation. The separately pinned SDK provider supplies that injected-provider implementation, but this runner calls the injected provider directly and does not prove a higher-level SDK invocation. It does not prove that Phantom's released browser extension supports Cardano or that Phantom produced these witnesses.
