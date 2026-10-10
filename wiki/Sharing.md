# Sharing: Apps, Compute and the Data Donor

Three features, one page to control them: **`/sharing`** on your own server. All three are off or empty until you act, and none of them adds a third-party package (everything is Node built-ins and this repo's own modules).

| | Code | State (this device only, never committed) |
|---|---|---|
| Apps that call Corona's API | `models && skills/core/corona-apps.ts`, `interface/corona-routes.ts` | `~/.neuroclaw/apps.json` |
| Compute sharing | `models && skills/core/compute-share.ts` | `~/.neuroclaw/compute.json` |
| Data donor | `models && skills/core/data-donor.ts` | `~/.neuroclaw/donor/` |

Each path can be moved with `CORONA_APPS_FILE`, `CORONA_COMPUTE_FILE`, `CORONA_DONOR_DIR`.

## Apps

An app is a store item (the new **Apps** store section) or any program running on your machine that wants to use Corona. It calls `/api/corona/v1/*` with `Authorization: Bearer <token>`.

- **Nothing is granted by default.** Installing a store app gives it no token. You register it on `/sharing` and tick what it may do.
- **Scopes:** `status`, `chat`, `store.read`, `store.publish`, `compute.borrow`, `donor.status`. A store app's `app.json` lists the scopes it asks for (`{"scopes": ["chat"]}`), and it can never be granted more than it asked for.
- The token is shown **once**; only its SHA-256 is stored. Revoking is immediate. Requests are rate limited per app.

| Route | Scope |
|---|---|
| `GET /api/corona/v1/status` | `status` |
| `POST /api/corona/v1/chat` `{message}` | `chat` |
| `GET /api/corona/v1/store`, `POST /api/corona/v1/store` | `store.read`, `store.publish` |
| `POST /api/corona/v1/compute/borrow` `{peerId, prompt}` | `compute.borrow` |
| `GET /api/corona/v1/donor` (state only, never the data) | `donor.status` |

Owner routes (`/api/corona-apps`, `/api/compute`, `/api/donor`) go through the normal password gate. On a machine with no password set and bound to localhost, any local program can reach them, the same as the rest of this server: set a remote-access password if other people use the machine.

## Compute sharing

Lend your computer for a while; the time earns **credit**; spend the credit on someone else's computer. The scenario it exists for: you are in a car with no power, and a computer you trust does the thinking for you.

- **The unit is work, not clock time.** Each machine times a short integer loop on itself (`benchmarkMops`). A job costs `busy seconds x (this machine's Mops / 1000)` Compute Units (CU), so 1 CU is one busy second on a 1000 Mops machine, and a faster computer earns more per hour. Only time the job actually ran counts; idle time inside a lease is free.
- **A lease** is what you hand a guest: a token, an hour limit (up to 24), and a CU cap. It stops at whichever comes first, or when you end it, or when you switch lending off. Lending is **off by default**.
- **Guests can only ask it to think.** The only job is `chat`. No code, no shell, no files, no screen.
- **Borrowing:** add a peer (its address and the lease token its owner gave you) and ask. You pay what the lender measured. A job that is cut off is still billed, and the lender reports the charge so both ledgers match.
- **Credit limit:** a balance may dip below zero down to a limit (default 60 CU), because two people who start at zero could otherwise never borrow first. Lending pays it back. Set it to 0 to turn this off.
- **Honest limits:** the two ledgers are kept by two machines and nothing forces a dishonest borrower to pay. The hard protection is the lease cap, which bounds what one lease can ever cost the lender. Treat it like lending to a friend, not a market. And the machine that runs a job can read the question, so do not send a lender anything secret.

## Data donor

Lets this computer's **screen** and **microphone** become training data for this computer's own network.

- **Off by default, per source.** Turning a source on needs an explicit acknowledgement of what it captures (the page shows it first), and the time you agreed is recorded.
- **It stays on this device.** There is no upload code in the module. What other installs can ever receive is the numeric learning from training (see `NEUROCLAW_SHARED_LEARNING` in [[Privacy-Policy]]), never the capture. Sharing raw screen and audio would record people who agreed to nothing.
- **Raw bits, no tokenizer, no speech-to-text.** Chunks are saved as the bytes they are, in arrival order, for the Zip Loop.
- **Controls:** an always-accurate "Recording now" indicator, pause for 30 minutes or 8 hours, quiet hours, a spool size cap (the oldest chunks go first, so it can never fill a disk), and **Erase** at any time. Switching a source off takes effect on the very next chunk.
- **Screen** is sampled by the server through the desktop layer, so the existing `screen.observe` access gate still applies. **Audio** has no first-party microphone API in Node, so a client that has one (the phone app, a browser) posts chunks to `POST /api/donor/ingest`.

**Status:** capture, controls and the spool are built and tested. The step that feeds spooled bytes into the mesh (`drainDonations`) takes a sink, and no sink is attached yet, because the live runner has no raw-byte input path today. Until one exists the spool simply waits, capped.

## See Also

- [[Privacy-Policy]]: exactly what leaves your machine
- [[Zip-IO]]: how raw bits enter the mesh
- [[Plugins]]: the store
