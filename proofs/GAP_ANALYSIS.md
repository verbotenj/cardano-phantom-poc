# Architectural Gap Analysis & CIP-30 Integration Details

This document provides a detailed technical analysis of the **architectural gap** resolved by this Proof of Concept, mapping exactly how we introduced native **Cardano (ADA) wallet support** into the Phantom ecosystem inside your custom SDK fork.

---

## 🔍 1. The Product Gap (Before vs. After)

### 🔴 Before this POC (The Gap)

The official **`phantom-connect-sdk`** was originally designed as a multi-chain wallet bridge, but it only compiled and injected providers for **Solana** and **Ethereum (EVM)**. It had **absolutely zero support for Cardano**.

If a Cardano decentralized application (dApp) or browser library opened inside a webpage and queried the standard entrance:

```javascript
const phantomCardano = window.cardano.phantom;
```

It returned **`undefined`**, making Phantom completely invisible to the Cardano dApp ecosystem.

### 🟢 After this POC (The Solution)

We designed and integrated a complete, compliant **CIP-30 client-side provider layer** directly inside the SDK. Phantom is now fully capable of injecting a native, standard-compliant `window.cardano.phantom` provider, allowing any Cardano dApp to seamlessly connect, query UTXOs, and request cryptographic transaction signatures!

This integration utilizes a custom fork of `phantom-connect-sdk` because the official upstream repository lacks native Cardano/CIP-30 support. Please note that **this fork is unmaintained** and exists **strictly and exclusively as a Proof of Concept (POC)**. It has been aligned with standard CIP-30 specifications, compiles warning-free, and is hosted on GitHub:
👉 **[https://github.com/verbotenj/phantom-connect-sdk](https://github.com/verbotenj/phantom-connect-sdk)**

---

## 🏗️ 2. Detailed SDK File Modifications

To bridge this architectural gap, we introduced several modular changes inside your **`verbotenj/phantom-connect-sdk`** fork:

### A. Created packages/browser-injected-sdk/src/cardano/ (The Cardano Layer)

We created a brand-new subdirectory to isolate Cardano-specific logic under clean architectural boundaries:

* 📄 **`provider.ts`**: Implements the standard **`CardanoProvider`** class, metadata descriptors (`name: "Phantom"`, `apiVersion: "1.0.0"`), and standard CIP-30 returned objects under `.enable()`.
* 📄 **`index.ts`**: Exports the provider class and declares the typescript module extensions so `cardano` is recognized as a native property of the global `Phantom` interface.

### B. Configured Workspace & Package Compilations

Wired the new Cardano packages into the monorepo's compilation path maps:

* Added build targets, DTS declaration bundling rules, and dependency linkages.
* Hardened the DTS declarations using inline import type paths (`cardano: import("./provider").CardanoProvider`) and global `chrome` scope definitions, ensuring the entire monorepo compiles warning-free under modern TypeScript versions.

---

## 🔄 3. How the Injected SDK Communicates (IPC Bridge)

The injected SDK code (`CardanoProvider`) is entirely stateless and does not contain private mnemonic keys or direct blockchain connections. Instead, it acts as a **secure browser IPC broker** between the webpage dApp and the Chrome Extension background sandbox:

```text
  dApp Webpage (Lucid)           Injected SDK (CardanoProvider)          Chrome Extension (Content/Background)
  ┌──────────────────┐           ┌────────────────────────────┐          ┌───────────────────────────────────┐
  │                  │           │                            │          │                                   │
  │ calls:           │           │                            │          │                                   │
  │ .getUtxos() ────>│  calls:   │                            │          │                                   │
  │                  │  _sendIPC("getUtxos")                  │          │                                   │
  │                  │  - generates requestId                 │          │                                   │
  │                  │  - registers message listener          │          │                                   │
  │                  │  - executes:                           │          │                                   │
  │                  │    window.postMessage(payload) ───────>│  intercepts window message                 │
  │                  │                                        │  relays to background service worker      │
  │                  │                                        │  - Prompts User for Approval              │
  │                  │                                        │  - Queries active UTXOs (Blockfrost/Node) │
  │                  │                                        │  - Serializes to standard CBOR Hex        │
  │                  │                                        │  - Executes:                              │
  │                  │                                 <──────│    window.postMessage(response_cbor)      │
  │                  │  - handleMessage catches event         │          │                                   │
  │                  │  - resolves promise                    │          │                                   │
  │ <────────────────│  - returns CBOR hex array              │          │                                   │
  │                  │                                        │          │                                   │
  └──────────────────┘           └────────────────────────────┘          └───────────────────────────────────┘
```

This guarantees:

1. **Security First:** Your private seed phrase and raw spending private keys remain completely offline/secure inside the isolated background extension sandbox. The dApp webpage can *never* access them.
2. **100% Standard Compliance:** Because the returned payloads are official binary **CBOR hex-encoded bytes** as specified by **CIP-30**, any standard Cardano off-chain builder (like Lucid, Mesh, or MeshJS) can consume them seamlessly with zero custom overrides!
