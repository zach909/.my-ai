# Privacy & Security

All data remains private through end-to-end encryption, and everything in this project runs locally — no external APIs anywhere in the pipeline. This page covers what "encrypted at rest" and "no external APIs" actually mean in the code, not just as a claim.

## Overview

**Purpose**: Persisted data (conversation memory, the reasoning ledger, the empathy state) can be encrypted at rest with a local cipher, and every network-shaped feature in the project (plugins, the web backend, the Chrome apps connector) is deliberately scoped to local-only or explicitly rejects anything else.

| Layer | File | What it is |
|---|---|---|
| TypeScript runtime backend | `interface/encryption.ts` — `EncryptionManager` | Node's own crypto primitives: AES-GCM-style encrypt/decrypt with an auth tag, PBKDF2 password hashing |

## `EncryptionManager` (TypeScript)

```typescript
const enc = new EncryptionManager();
const key = enc.generateKey();
const { encrypted, iv, tag } = enc.encrypt(plaintext, key);
const plaintext2 = enc.decrypt(encrypted, key, iv, tag);   // throws if `tag` doesn't authenticate
```

The authentication tag is load-bearing, not decorative: tampering with `encrypted` (or `iv`) invalidates `tag`'s check and `decrypt()` throws instead of silently returning corrupted plaintext — verified directly by `npm test`'s encryption section ("Encryption rejects tampered ciphertext (GCM auth)").

## `LocalCipher` (Python)

The local cipher that backed `--encrypt` / `MYAI_PASSPHRASE` went with the TinyGPT track. It was a real, working cipher with zero external dependencies (stdlib `hashlib`/`hmac` only) and explicitly not a substitute for a vetted library in a high-stakes setting. `ZipLoopMemory` reuses the salt embedded in an existing encrypted file so a passphrase-derived key matches correctly across a restart (see [[Zip-IO]]).

## What "no external APIs" actually means here

It's enforced at multiple, independent layers, not just claimed once in a README:

- **Plugins** ([[Plugins]]): each plugin either implements a *local* service for real, or honestly reports "not available on this host" — none of them make a network call.
- **Chrome Apps**: detects a locally-installed Chrome/Chromium and reports a launch command; it does not open a network connection itself.
- **The browser backend** (`interface/server.py`): binds to `127.0.0.1` by default, not `0.0.0.0`, and uses a restrictive CORS policy (no wildcard `Access-Control-Allow-Origin`) — a real, documented fix from this project's `.jules/bolt.md` security log ("Insecure Web Server Configuration (Over-exposure)"), applied to both the TypeScript service and this Python wrapper.
- **The NeuroLang `@code=` directive**: a documented RCE fix in the same log restricted `new Function()` evaluation to a strict numeric/hex-literal whitelist regex instead of arbitrary JavaScript.

## Verifying it

`python test_core.py`'s `test_local_encryption` and `test_encrypted_memory` cover round-tripping and tamper-rejection on the Python side directly. `npm test` (`test/smoke.mjs`)'s "End-to-end encryption" section covers ciphertext-not-plaintext, round-trip correctness, and GCM auth-tag rejection on the TypeScript side.

## See Also

- [[Home]] - Main wiki page
- [[Zip-IO]] - What gets encrypted (persisted memory)
- [[System-Access]] - `executeCommand()`'s shell access has no live caller yet and is not currently gated by the alignment veto
- [[Plugins]] - The local-only-or-honest-failure pattern every plugin follows

---

*"No external APIs" isn't a single claim in a README — it's enforced independently at the plugin layer, the web server's bind address and CORS policy, the NeuroLang code-evaluation whitelist, and the local-only cipher.*
