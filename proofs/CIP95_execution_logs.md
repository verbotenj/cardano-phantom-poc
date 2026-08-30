# CIP-95 and CIP-105 Preview Proof

This proof was reverified on **August 30, 2026** with `npm run test:cip95`. It checks public Cardano Preview ledger data, independently derives the CIP-105 DRep credential, and verifies a CIP-95 COSE signature.

The verifier is read-only. It does not spend funds or register another DRep, so the same confirmed transaction can be audited repeatedly without faucet funds.

## Verification result

```text
CIP-95 / CIP-105 CARDANO PREVIEW VERIFICATION
------------------------------------------------------------
[PASS] CIP-105 path: m/1852'/1815'/0'/3/0
[PASS] Raw DRep public key: 0cb54c87799984002c09cec6f5f2d04add16bca87911db86c7332462562348b4
[PASS] Independent Blake2b-224: 7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2
[PASS] Preview transaction confirmed in block 4616153
[PASS] Receiver gained 2.000000 tADA
[PASS] Transaction fee: 0.174917 tADA
[PASS] DRep deposit: 500 tADA
[PASS] Active DRep ID: drep1yflar5s2sd0efxp2rhwmetvxn99j6c23jhc4n2kz3tvqdvskf9aqt
[PASS] CIP-95 COSE signature verified (93-byte payload, 214-byte COSE_Sign1)
[PASS] Explorer: https://preview.cardanoscan.io/transaction/e8f2950e46ad4f4521453abcc37ad77bdfacfaccdd6cb1603dca06a77d6aae88
------------------------------------------------------------
ALL CIP-95 / CIP-105 PREVIEW PROOFS PASSED
```

## Public evidence

| Check | Expected result |
| --- | --- |
| Preview transaction | [`e8f2950e…d6aae88`](https://preview.cardanoscan.io/transaction/e8f2950e46ad4f4521453abcc37ad77bdfacfaccdd6cb1603dca06a77d6aae88) |
| Confirmation | Block `4616153` |
| Transfer | Receiver output is `2,000,000` lovelace |
| Fee | `174,917` lovelace |
| DRep certificate | Registration with `500,000,000` lovelace deposit |
| DRep state | Registered and active |
| CIP-105 derivation | `m/1852'/1815'/0'/3/0` |
| DRep key hash | `7fd1d20a835f94982a1dddbcad86994b2d615195f159aac28ad806b2` |
| CIP-95 signing | COSE_Sign1 verifies against the derived raw DRep public key |

## Reproduce

Create `.env.development` with `CARDANO_MNEMONIC`, `CARDANO_ADDRESS_1`, and `CARDANO_ADDRESS_2`, then run:

```bash
npm install
npm run test:cip95
```

`CARDANO_MNEMONIC` is used locally to reproduce the CIP-105 derivation and CIP-95 signature. It is never printed or committed. Set `CARDANO_ENV_FILE` to use a configuration file elsewhere.

## Scope

This proves the POC responder/harness can derive a CIP-105 DRep key, expose its public key through the CIP-95 contract, sign arbitrary data with it, and correlate the credential with a real Preview DRep registration transaction. It does not prove that a released Phantom browser extension currently exposes Cardano governance APIs.
