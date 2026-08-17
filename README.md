# IRLQuest

IRLQuest turns ordinary life into short, proof-backed daily missions. This is intentionally separate from the landmark exploration concept: the core loop is daily creativity, movement, observation, and streaks.

## What works now

- Responsive daily-quest dashboard with rotating daily and weekly quests
- Google social login through Supabase Auth (production)
- Live-camera proof flow with a randomized three-minute anti-replay challenge
- Private Supabase Storage evidence with short-lived signed validator links
- Supabase Postgres persistence with row-level security, immutable quest versions, transactional submissions, exactly-once XP, and replay-resistant proof sessions
- Authenticated Supabase Edge Function for privileged database and storage operations
- SQLite/local-file fallback for zero-setup development
- Background verification with an honest local-demo mode
- GenLayer adapter and a pinned-runner `IRLQuestVerifier` Intelligent Contract
- Vercel production deployment at [irlquest.xyz](https://irlquest.xyz)
- Desktop and mobile layouts, verified down to a 390 px viewport

Production requires a Google-authenticated explorer. Local development still starts with a demo explorer so the full vertical slice can be tested without cloud credentials. IRLQuest uses Studionet as its sole GenLayer network. The verifier is deployed at [`0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4`](https://explorer-studio.genlayer.com/address/0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4), and its byte-for-byte verified deployment details are in [`deployments/studionet.json`](./deployments/studionet.json).

The latest production build and independently finalized proof are documented in [`docs/PRODUCTION_EVIDENCE.md`](./docs/PRODUCTION_EVIDENCE.md). The record includes the public transaction, consensus votes, content hash, XP result, and deployed build identifiers without exposing the private photo or a signed Storage URL.

Supabase is the permanent application system of record for accounts, quests, submissions, and XP. Studionet itself has temporary persistence and can be reset by GenLayer, so its contract and result state must not be treated as permanent storage.

## Run it

Requirements: Node.js 22+ and Python 3.12+ with `genvm-linter` and `genlayer-test` for contract checks.

```powershell
npm install
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). The API runs on port `8787`.

When no camera is available in development, the capture sheet exposes **Demo shot**. It creates a real JPEG and exercises upload, persistence, verification, XP, and streak logic. That control is removed from production builds.

To run against Supabase locally, put the three public `VITE_SUPABASE_*` values from `.env.example` in `.env.local`. Without them, Vite intentionally uses the local Express/SQLite API.

## Production services

- **Frontend:** Vercel static Vite deployment
- **Authentication:** Supabase Auth with Google OAuth
- **Database:** Supabase Postgres with RLS on every browser-exposed app table; operational tables live in a non-exposed `private` schema
- **Evidence:** private `quest-evidence` Supabase Storage bucket (JPEG/PNG/WebP, 8 MB maximum)
- **Backend:** authenticated `irlquest-api` Supabase Edge Function
- **Verdict:** GenLayer intelligent-contract verification on Studionet in production, with an explicitly labelled local demo verifier for development

Google OAuth client credentials are free and are stored only in Supabase. The app does not need a paid Google API key. Supabase Free and Vercel Hobby are sufficient for the MVP, subject to their normal quotas.

## Verification modes

Local mode is the default:

```text
IRLQUEST_VERIFIER_MODE=local
```

It is explicitly labeled **Demo verifier** in the interface and must not be represented as decentralized verification.

For GenLayer mode:

1. Configure the Studionet verifier owner as the relayer account held in backend secrets.
2. Host the app at a validator-reachable HTTPS URL.
3. Copy `.env.example` to `.env`, set the public URL, and use the recorded Studionet contract address.
4. Start with `IRLQUEST_VERIFIER_MODE=genlayer`.

Studionet is gasless, so the relayer does not need testnet GEN. If Studionet is reset, redeploy the contract, verify it byte-for-byte, update the deployment record and Edge Function address, and redeploy the function before accepting new proofs.

Local startup also discovers the existing workspace-level `../.env.local` RPC and relayer credentials. Project-specific environment values take precedence, and the private key is never copied into this project or its deployment record.

The contract fetches a short-lived evidence URL, checks the SHA-256 digest, sends the photo and bounded quest rules to vision-capable validators, and stores only the hash, fixed verdict fields, quest version, and deterministic summary. The evidence URL itself is not stored in contract state.

GenLayer currently supports raw image bytes through `gl.nondet.exec_prompt(images=[...])`; see the official [Image Processing documentation](https://docs.genlayer.com/developers/intelligent-contracts/features/image-processing).

## Commands

```powershell
npm run build          # TypeScript + production Vite build
npm test               # API, persistence, signed-link, and XP tests
npm run lint:contract  # GenVM AST + SDK semantic validation
npm run test:contract  # GenLayer direct-mode contract tests
npm run deploy:studionet # Deploy and byte-verify once; refuses duplicate deployment records
npm run check          # Build + API tests + contract lint
npm start              # Serve the production build and API on :8787
```

## Data and privacy

Development evidence is written under `.data/evidence/` and ignored by Git. Production evidence is stored in a private Supabase bucket and is not readable through the browser client. A photo must become temporarily visible through an expiring signed URL to the selected GenLayer validators in order for them to judge it; the product must say this plainly during consent rather than promising that nobody sees the evidence.

Gallery fallback is development-only by default. `VITE_ALLOW_GALLERY_FALLBACK=true` exists for internal QA, not production.

## Production configuration

The live deployment uses Google OAuth through Supabase, `https://irlquest.xyz` as its site URL, and the Supabase callback at `https://auovgyyatbxdfynbbfth.supabase.co/auth/v1/callback`. The Studionet relayer key is stored only as a Supabase Edge Function secret and is never exposed to the browser or committed to this repository.

Production submits every proof with `leaderOnly: false`. XP is awarded only after GenLayer reports `ACCEPTED` or `FINALIZED`, the receipt records a majority `AGREE` vote from at least three validators, execution succeeds, and the onchain result is readable. Validator timeout, disagreement, leader-only, local-demo, and unverifiable legacy results remain retryable and cannot create XP; Postgres enforces the same rule as a second boundary.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for boundaries and the production hardening list.
