# Project handoff rules

Read `docs/CURRENT_GOAL.md`, `docs/MAC_HANDOFF.md`, and `docs/LOCAL_SYNC_PROTOCOL.md` before continuing development. This file travels with the source; chat history is not required for the first handoff.

## Product decisions (do not reverse without asking)

- Current handoff decision (2026-10-03): user resumes upload of filtered source and handoff documents to the existing PRIVATE repository `Jiezheshui369/nioh2-save-visualization`, and prioritizes iPhone development on Mac. Use their own Windows PC as the initial server host; no cloud purchase or public deployment is authorized. Read `docs/MAC_START_HERE.md` first for the human handoff. The earlier GitHub pause, Android-first priority and October 2 deadline below are historical and superseded; no replacement deadline has been agreed. Preserve Android compatibility and the multi-game/manual-download requirements. The account/server backend and Nioh 3 placeholder are NOT implemented by this documentation handoff. Do not expose the LAN pairing listener to the Internet or silently widen its RFC1918 host allowlist for VPN addresses.

- Research update (2026-09-29): domain `jiezheshuizz.com` was purchased at Alibaba Cloud; no server yet. User requested market/competitor/community research before choosing budget and first-market positioning. Internal report and evidence ledger are in `.local/market-research-20260929/` and must not enter default source/public handoff. Nioh 2 owned-gear/build viewing, cross-region invite testing, and USD20–30/month infrastructure are recommendations awaiting review, not approved spending or international launch. English UI is not yet approved; preserve the existing Chinese design until scope is confirmed.

- Retained product scope from 2026-09-29: Nioh 2 first parser, extensible multi-game framework. Per-game PC automatic upload is opt-in/default off, with manual upload available; phones only explicitly download server snapshots for one/all supported managed games, never silently replace offline snapshots or remotely force PC collection. Upload parsed results only, not original saves. Nioh 3 is an unsupported UI placeholder, not a parser or fake character dataset; exclude it from upload/sync tasks. Read docs/MULTI_GAME_SYNC_V1.md and the historical docs/V1_REBUILD_REVIEW_20260929.md. No purchases, DNS changes or external deployment without specific authorization.
- Windows desktop: drag a personal Nioh 2 Steam save into an app window; analyse only an independently verified copy.
- Existing mobile implementation: LAN scan/pair, pinned TLS receipt, persistence and offline viewing. This is not the newly requested account/server flow. Manual JSON import is optional recovery, NOT the main workflow. Do not expose the current LAN listener publicly to imitate a server backend.
- Android and iOS share the existing React/Capacitor interface. Do not rewrite it as a different SwiftUI design just because the new host is a Mac.
- Chinese UI for now, brand `Nioh`, four destinations: 角色 / 配装 / 仓库 / 更多. Preserve approved Figma layout. Do not redraw the 仁 seal, invent game icons or add repeated equipment-slot text.
- Base 体力 / 精力 / 妖力 show maximum only; preserve weight pairs and special-effect bonuses. Raw screenshot evidence stays unchanged.
- Accept modded saves. Validate structure and safety, not gameplay legitimacy or stat caps.
- User wants direct save parsing, not an inferred stats calculator. Unknown final fields stay 未解析. Screenshot observations are not parser output.

## Safety

- NEVER modify, encrypt, resign, replace or write into original game/save directories. Only existing independent copies belong to parser research scope.
- Never commit original/decrypted saves, player archives, tokens, local paths/logs, signing keys, screenshots or private research reports. `.local/` is private. Do not copy the entire Windows research directory into git.
- Never weaken TLS, allow arbitrary public pairing hosts, log QR tokens, or use generic web fetch to bypass certificate pinning.
- Never mark generated Swift code as compiled/tested without a Mac build. Never mark a device workflow tested based only on mocks.
- Do not automatically publish a public GitHub repository or store release. Game image/data redistribution permissions remain unresolved.
- Preserve user edits. New milestone packages get new names; never delete old test packages to make room.
- Explicit exception (2026-09-29): user authorized removing application versions strictly before 0.7. The 0.5.0/0.6.0 release ZIPs and their two checksum files were sent to the Windows Recycle Bin; retain 0.7+ artifacts, code, historical documentation and private evidence. See docs/V1_REBUILD_REVIEW_20260929.md for the cleanup audit, approved V1 scope and proposed schedule. Scope approval permits local implementation; it does not authorize purchases or external deployment.

## Verification / status

- Parsing priority retained from 2026-09-25: complete the remaining character status parsing. The 2026-09-29 multi-game/manual-cloud requirements expand the V1 scope, but do not complete the 37 final panel rows or 116 aggregate effects. Candidate matches or screenshot transcriptions are not completion. If direct-save evidence is insufficient, report the limitation and request the smallest necessary comparison, rather than inventing fields or silently implementing a stats calculator.
- Source handoff 0.7.16-dev / parser 0.9.9: three core Anima IDs, six core percentage IDs and three sparse ID/raw grade pairs have screenshot-correlated encodings. Grade metadata is kind=grade, encoding=verified-id; unknown neighboring raw values remain unresolved. Shared displays require the exact verified pair and matching label. Exact integer tenths preserve uint32 precision. Remaining IDs and final totals are not inferred. Read EFFECT_VALUE_CONTRACT.md and RELEASE_0716.md.
- The 21 private screenshot observations are under .local/character-evidence-20260925; never export them. Skill circles mean learned, upward markers mean not maxed, and absent markers mean unlearned. Retain displayed rank text; learned mysteries need not be active, and next-upgrade previews are not current bonuses. scan_skill_markers is research only, never a production skill decoder; see SKILL_MARKER_RESEARCH.md.

- `npm ci`, `npm test`, `npm run build`, `npm run build:android` (shared native web assets).
- Python: install `packaging/requirements-runtime.txt` in a local virtual environment, then `python -m unittest discover -s agent/tests -v`.
- Parser/consumer boundary: `node scripts/check-effect-contract.mjs --python python` runs actual Python parsing through TypeScript validation/display/export using in-memory synthetic records only. On Windows supply an explicit interpreter path if needed.
- Java protocol/certificate cases: `python scripts/check-android-core.py` with JDK 21 on PATH and the runtime Python requirements installed. Uses ephemeral synthetic DER certificates, not a physical-phone TLS test.
- Mac: `sh scripts/check-ios-core.sh`, `npm run ios:sync`, then Xcode simulator build; run the physical-device checklist in `docs/MAC_HANDOFF.md`.
- `python scripts/prepare_handoff.py --check` is a source allowlist check, not a full security audit or proof of asset licensing.
- Update CURRENT_GOAL and handoff notes after material requirement changes. Installed 0.7.4 Windows is separate from 0.7.16-dev source / parser 0.9.9. Existing 0.7.5 through 0.7.15 packages are preserved. This milestone delivers source, not newly built Windows/APK installers; do not claim old installers include these changes. Prefer normal privileges; do not routinely launch administrator prompts for development or handoff checks.
- Capture independent character and provenance copies before asynchronous storage or publication. Validate receipt identity/date/count before writes. Same snapshot ID does not imply unchanged content; prompt explicit republish when the shared character changes, without auto-publishing.
- Equipment detail retains selection identity only and resolves it from the current snapshot. Removed records and character switches invalidate the selection. Image sharing must not open a delayed sheet after leaving its record, duplicate concurrent generation, or attach a previous record's result to a new one.
- Desktop/mobile sharing uses shareSummary and effectValues, never invents equipped scrolls or final totals. Image cards use Nioh branding and label their abbreviated content. Native share cancellation is neutral, not a successful send or a fallback download.
- Build imports reject duplicate IDs and invalid update times before writes. Compare actual instants, not lexicographic timestamp strings; detach incoming records before asynchronous storage access.
- Health/source metadata is validated before use. A failed current health request clears connected state; late older requests cannot restore it. Steam local metadata is diagnostic only, never proof of a real-time cloud query or phone persistence.
- A publish resets the previous revision's read time. A network read is not a phone persistence receipt. Unknown status hides old pairing information; local archive replacement invalidates mobile revision deduplication.
- Share/archive projections use explicit known fields and independent copies. Preserve intentional notes and raw effect evidence; do not claim arbitrary user-authored text has been anonymized.
- Desktop import, refresh, history selection and archive restore share one in-flight lock; do not release before persistence completes. A transport timeout does not imply server cancellation. Never publish when either independently copied parse input changed during parsing.
- Explicit history downloads use saveHistorySnapshot: fail on persistence error and never change the selected offline character. Mandatory native reads must distinguish missing data from failed storage. Cache deletion must not claim success after failure.
- Build-library mutations must read and write in one IndexedDB transaction. Never silently fall back after a failed write, evict older builds at capacity, or call a partial character/build save fully successful. See BUILD_STORAGE_078.md.
- Guardian linkage tools are research only. Never promote candidate table IDs, duplicate soul-core bodies, or scroll matching into production active slots without independent verification.
