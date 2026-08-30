# CIP-95 and CIP-105 Preview Proof

This proof was reverified on **August 30, 2026** with `npm run test:cip95`. It checks public Cardano Preview ledger data, independently derives the wallet-specific CIP-105 DRep credential, and validates the fields and Ed25519 signature of a CIP-95 COSE object.

The verifier is read-only. It does not spend funds or register another DRep. The transaction evidence is immutable; the separately labelled current DRep state can change later.

## Verification result

```text
CIP-95 / CIP-105 CARDANO PREVIEW VERIFICATION
------------------------------------------------------------
[PASS] CIP-105 path: m/1852'/1815'/0'/3/0
[PASS] Raw DRep public key: 0cb54c87799984002c09cec6f5f2d04add16bca87911db86c7332462562348b4
[PASS] Independent Blake2b-224: 7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2
[PASS] Preview transaction confirmed in block 4616153
[PASS] Transaction contains a 2.000000 tADA receiver output
[PASS] Transaction fee: 0.174917 tADA
[PASS] DRep deposit: 500 tADA
[PASS] Registered DRep ID: drep1yflar5s2sd0efxp2rhwmetvxn99j6c23jhc4n2kz3tvqdvskf9aqt
[INFO] Current DRep state: registered, active=true
[PASS] CIP-95 COSE fields and Ed25519 signature independently verified (93-byte payload)
[PASS] Explorer: https://preview.cardanoscan.io/transaction/e8f2950e46ad4f4521453abcc37ad77bdfacfaccdd6cb1603dca06a77d6aae88
------------------------------------------------------------
CIP-95 CRYPTOGRAPHY / CIP-105 DERIVATION / PREVIEW LEDGER CHECKS PASSED
```

## Public evidence

| Check | Expected result |
| --- | --- |
| Preview transaction | [`e8f2950e…d6aae88`](https://preview.cardanoscan.io/transaction/e8f2950e46ad4f4521453abcc37ad77bdfacfaccdd6cb1603dca06a77d6aae88) |
| Confirmation | Block `4616153` |
| Transaction output | Receiver output is `2,000,000` lovelace |
| Fee | `174,917` lovelace |
| DRep certificate | Registration with `500,000,000` lovelace deposit |
| Current DRep state | Registered and active when the proof was run; this is mutable |
| CIP-105 derivation | `m/1852'/1815'/0'/3/0` |
| DRep key hash | `7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2` |
| CIP-95 signing | COSE_Sign1 verifies against the derived raw DRep public key |

## Reproduce

Install and audit dependencies before making any seed available to the process:

```bash
npm ci --ignore-scripts
```

Then place a **disposable Preview-only** mnemonic and its addresses in a mode-`600` file outside the repository and run:

```bash
CARDANO_ENV_FILE=/absolute/path/to/preview-wallet.env npm run test:cip95
```

The external file needs:

```text
CARDANO_MNEMONIC=...
CARDANO_ADDRESS_1=addr_test1...
CARDANO_ADDRESS_2=addr_test1...
```

For an already trusted local checkout, the verifier also supports the gitignored `.env.development` convention:

```bash
npm run test:cip95
```

`CARDANO_MNEMONIC` is used locally to reproduce the derivation and signature. It is never printed or committed.

## Scope

This proves wallet-specific CIP-105 derivation, the structure and signature of a locally produced CIP-95/CIP-8 COSE object, and correlation of that credential with a real Preview DRep registration transaction. It does **not** traverse the injected provider IPC, prove which implementation produced the on-chain witness, cover every CIP-95 endpoint/error case, or prove that a released Phantom browser extension exposes Cardano governance APIs. Provider contract behavior is tested in the SDK repository; this artifact is the independent cryptographic and ledger cross-check.
