# Production evidence

This record ties the public IRLQuest build to a real photo-proof submission finalized by independent GenLayer validators. It intentionally excludes the private image, its Storage object path, and every signed download URL.

## Production build

- Application: [irlquest.xyz](https://irlquest.xyz)
- Source commit used by the build: [`c9e3dcaaf49b543da0d017b3975592b22cab0656`](https://github.com/Leokings/IRLQuest/commit/c9e3dcaaf49b543da0d017b3975592b22cab0656)
- Vercel deployment: `dpl_9JBrQedaDPvqgFUq83YguwhdsGsp` (`READY`, production)
- Verification network: GenLayer Studionet, chain ID `61999`
- Verifier contract: [`0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4`](https://explorer-studio.genlayer.com/address/0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4)
- Policy: `irlquest.photo-proof.v2`
- Contract source: byte-for-byte matched at deployment; SHA-256 `307bae204da3769effad85d3ff387969b0510addf68f21e564ff88b1eea890ac`

## Latest independently verified proof

- Quest: **Red find** (`quest_red_find_v1`)
- Requirement: photograph one everyday object that is clearly red
- Live anti-replay challenge: include one open hand anywhere in the photo
- Submission: `2efc035a-8cb1-419f-8c69-b3575f1d39f0`
- Submitted: `2026-08-17T13:45:42.174532Z`
- Transaction: [`0x480e8fba21030425ebd125fcb2a40d9e64e86f3ce0e6508e057420fb8f3b1e95`](https://explorer-studio.genlayer.com/tx/0x480e8fba21030425ebd125fcb2a40d9e64e86f3ce0e6508e057420fb8f3b1e95)
- Transaction state: `FINALIZED`
- Consensus result: `MAJORITY_AGREE`
- Execution: `SUCCESS`, normal consensus mode, `leader_only: false`
- Validator votes: 3 `AGREE`, 0 `DISAGREE`, 2 `IDLE` out of 5 validators
- Stored contract verdict: `PASS`
- Stored checks: evidence clear, quest satisfied, challenge satisfied, and safe
- Evidence SHA-256: `56b992fafa753ce06efbdfa4532f3902afb82c738a28a6b1b037391edf5bb64a`
- XP: one XP event awarding `55 XP`
- Application record: `accepted`, source `genlayer_consensus`

The onchain result was read back from `get_result(submission_id)` after finalization and the contract result count was `2`. Supabase independently recorded one—and only one—XP event for this submission. The evidence bucket remains private and accepts only JPEG, PNG, or WebP files up to 8 MiB.

## Reproduction

With the GenLayer CLI set to Studionet:

```sh
genlayer receipt 0x480e8fba21030425ebd125fcb2a40d9e64e86f3ce0e6508e057420fb8f3b1e95 --status FINALIZED
genlayer call 0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4 get_result --args 2efc035a-8cb1-419f-8c69-b3575f1d39f0
genlayer call 0x8E91AF6B3Acdae117c3cec5f2D72D1E23D9E6bA4 get_result_count
```

Studionet is the only GenLayer network configured by the current application. Supabase remains the durable application system of record because Studionet can be reset.
