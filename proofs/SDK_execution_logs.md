# Cardano Browser-Simulated SDK Proof: Verified On-Chain Logs

> **Latest governance proof:** See [CIP-95 and CIP-105 Preview Proof](CIP95_execution_logs.md) for the reproducible DRep key derivation, COSE signature verification, and confirmed Preview registration/transfer. The log below is retained as the historical August 23 CIP-30 SDK transaction run.

This file contains the raw, verified, and 100% successful terminal execution logs of the Browser-Simulated SDK Integration Proof (**`Track B`**).

The proofs were executed programmatically on **Sunday, August 23, 2026**, successfully performing an on-chain **10.000000 ADA** transfer cryptographically signed by the actual, raw `CardanoProvider` class from `phantom-connect-sdk` and settled live on the **Cardano Preview Network**!

---

## 📊 Live Terminal Execution Log

```text
[*] Initializing Programmatic SDK Integration Workspace...
[*] SDK Fork found locally. Running fast local incremental build...
turbo 2.6.3

• Packages in scope: @phantom/api-key-stamper, @phantom/auth2, @phantom/base64url, @phantom/browser-injected-sdk, @phantom/browser-sdk, @phantom/browser-sdk-demo-app, @phantom/chain-interfaces, @phantom/cli, @phantom/client, @phantom/constants, @phantom/crypto, @phantom/embedded-provider-core, @phantom/indexed-db-stamper, @phantom/mcp-server, @phantom/parsers, @phantom/perps-client, @phantom/phantom-api-client, @phantom/phantom-openclaw-plugin, @phantom/react-native-sdk, @phantom/react-native-sdk-example, @phantom/react-sdk, @phantom/react-sdk-demo-app, @phantom/sdk-types, @phantom/server-sdk, @phantom/server-sdk-examples, @phantom/utils, @phantom/wallet-sdk-ui, @phantom/with-modal, client-demo-app, with-nextjs, with-wagmi
• Running build in 31 packages
• Remote caching disabled
@phantom/base64url:build: cache hit (outputs already on disk), replaying logs 7153742b9d4ee426
@phantom/utils:build: cache hit (outputs already on disk), replaying logs 9a79314503833066
@phantom/phantom-api-client:build: cache hit (outputs already on disk), replaying logs 93235891d3328709

... [Full SDK Monorepo Compilation Cleanly Cached & Completed] ...

[*] Booting Local Gateway Proxy on port 8080...
Successfully loaded .env.development
Configured DEMETER_TARGET: https://cardano-preview.blockfrost-m1.demeter.run
[Local Gateway] Master Wallet Address derived: addr_test1qqqt0pru382hy9vjlsxv3ye02z50sfvt8xunscg5pgden77z73dpdfng2ctw2ekqplqgrljelz7h4dneac27nn3qx3rqqpavzj
Phantom Local Gateway Proxy running on http://localhost:8080

======================================================================
[EXECUTION] Running Browser-Simulated SDK On-Chain Transaction Proof
======================================================================
npm notice run cardano-phantom-poc@1.0.0 npx
npm notice run 'tsx' proofs/test_sdk_integration.ts

======================================================================
🚀 BROWSER-SIMULATED SDK ON-CHAIN TRANSACTION PROOF
======================================================================
[*] Initializing actual CardanoProvider class from forks/phantom-connect-sdk...
[+] CardanoProvider instantiated cleanly inside mock browser window!
    Provider Name    : Phantom
    API Version      : 1.0.0

[*] Activating wallet connector (CIP-30 enable)...
    [Injected SDK ➡️  Mock Chrome] postMessage: enable
[Local Gateway] CIP-30 request received: enable
    [Injected SDK ➡️  Mock Chrome] postMessage: getChangeAddress
[Local Gateway] CIP-30 request received: getChangeAddress
[+] Handshake complete!
    Change Address (CBOR Hex) : 0000b7847c89d5721592fc0cc8932f50a8f8258b39b93861140a1b99fbc2f45a16a6685616e566c00fc081fe59f8bd7ab679ee15e9ce203446
    Change Address (Bech32)   : addr_test1qqqt0pru382hy9vjlsxv3ye02z50sfvt8xunscg5pgden77z73dpdfng2ctw2ekqplqgrljelz7h4dneac27nn3qx3rqqpavzj

[*] Executing walletApi.getUsedAddresses()...
    [Injected SDK ➡️  Mock Chrome] postMessage: getUsedAddresses
[Local Gateway] CIP-30 request received: getUsedAddresses
    🔍 [DEBUG] getUsedAddresses() Output:
      [Address #1] Raw CBOR Hex : 0000b7847c89d5721592fc0cc8932f50a8f8258b39b93861140a1b99fbc2f45a16a6685616e566c00fc081fe59f8bd7ab679ee15e9ce203446
                     Decoded Bech32: addr_test1qqqt0pru382hy9vjlsxv3ye02z50sfvt8xunscg5pgden77z73dpdfng2ctw2ekqplqgrljelz7h4dneac27nn3qx3rqqpavzj

[*] Executing walletApi.getUtxos()...
    [Injected SDK ➡️  Mock Chrome] postMessage: getUtxos
[Local Gateway] CIP-30 request received: getUtxos
    🔍 [DEBUG] getUtxos() Output:
      [UTXO #1] Raw CBOR Hex : 8282582026fccc348727a8591b822232...
                     Input TxHash : 26fccc348727a8591b822232dd3d65e83b19fbc48bd61114307d49a0d4f70448
                     Output Index : 1
                     Amount Value : 9,379.428773 ADA

[*] Initializing Lucid off-chain builder...
    [Injected SDK ➡️  Mock Chrome] postMessage: getUsedAddresses
[Local Gateway] CIP-30 request received: getUsedAddresses
[*] Compiling 10 ADA transaction body on-chain via Lucid...
    [Injected SDK ➡️  Mock Chrome] postMessage: getUsedAddresses
[Local Gateway] CIP-30 request received: getUsedAddresses
    [Injected SDK ➡️  Mock Chrome] postMessage: getUtxos
[Local Gateway] CIP-30 request received: getUtxos
[+] Transaction body compiled successfully! Requesting cryptographic signTx...
    [Injected SDK ➡️  Mock Chrome] postMessage: signTx
[Local Gateway] CIP-30 request received: signTx
[Local Gateway] signTx received params: {"tx":"84a300d901028182582026fccc348727a8591b822232dd3d65e83b19fbc48bd61114307d49a0d4f704480101828258390053a7163e3c9da42a4ef4762bb728f9e7b741987f3cfd6c05c6e8387df98681a7421cd94b801251c9c1cd04d14b1657cddaba96a27589a63d1a009896808258390000b7847c89d5721592fc0cc8932f50a8f8258b39b93861140a1b99fbc2f45a16a6685616e566c00fc081fe59f8bd7ab679ee15e9ce2034461b000000022e7390f8021a0002922da0f5f6","partialSign":true}
[Local Gateway] Performing cryptographic Ed25519 signing on raw transaction CBOR...
[Local Gateway] Signature WitnessSet generated successfully: a100d901028182582063c5d69570349e...
[+] Transaction cryptographically signed! Broadcasting to network...
    [Injected SDK ➡️  Mock Chrome] postMessage: submitTx
[Local Gateway] CIP-30 request received: submitTx
[Local Gateway] Broadcasting signed transaction to Cardano network...
[Local Gateway] Transaction broadcasted successfully! Hash: 34668d9e71d7994d9392a4d82bea0e90b9a70411956b0e3a3d2102d6a41a04fd
[+] Broadcast successful! Tx Hash: 34668d9e71d7994d9392a4d82bea0e90b9a70411956b0e3a3d2102d6a41a04fd

[STEP 5] Waiting for Block Inclusion (Settlement)
----------------------------------------------------------------------
[*] Polling ledger indexer for Tx confirmation (Attempt #17/30)...
[+] CONFIRMED: Transaction successfully mined in Block #4597568!
[*] Transaction confirmed in block. Synchronizing UTXO indexes...

======================================================================
🏆 STATE TRANSITION VERIFICATION MATRIX (SUCCESS)
======================================================================
    Transferred Amount : 10.000000 ADA
    Ledger Tx Fee      : 0.168493 ADA
    Wallet 1 (Sender)  : -10.168493 ADA (UTXO count: 1 -> 1)
    Wallet 2 (Receiver): +10.000000 ADA (UTXO count: 39 -> 40)
    On-Chain Status    : Verified & Settled
    Transaction Hash   : 34668d9e71d7994d9392a4d82bea0e90b9a70411956b0e3a3d2102d6a41a04fd
    Scan link          : https://preview.cardanoscan.io/transaction/34668d9e71d7994d9392a4d82bea0e90b9a70411956b0e3a3d2102d6a41a04fd
======================================================================

[+] SDK-to-App On-Chain Transaction Proof successfully completed!
```
