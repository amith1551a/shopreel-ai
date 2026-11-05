# ShopReel AI - local verification and deployment boundary

The later [sales upgrade report](SALES_TEST_REPORT.md) supersedes the
three-scene/silent-default behavior and measurements below. Deployment remains
unapproved; no hosting changes were made.

## Status

Local browser-CPU studio and single-prompt upgrade verified on November 3, 2026.
Available at http://localhost:5050/. No production deployment, push, commit or
pull request has been performed. This directory is not a Git repository.
GitHub browser sign-in alone does not establish a ShopReel repository or a
Hostinger deployment target.

## What changed

- One required natural-language prompt; title, copy, price/currency, CTA and
  story-context fields retained as optional editable overrides.
- Local rule-based extraction of explicitly supplied details. Ambiguous money,
  unsupported footage requests and non-15-second durations produce review
  notices. No LLM, external parsing API or invented product facts.
- Example tee brief and reusable instructions for obtaining a brief from
  ChatGPT manually. ChatGPT is optional and not connected to the application.
- Editable opening/detail copy, animated photo-storyboard preview, caption
  entrance animation and photo-scene fades, matching the CPU export path.
- Prompt, overrides, storyboard, original media and completed outputs persist.
  Existing pre-prompt browser projects remain readable; opening them adapts
  their prior copy without rewriting the saved record.

Key implementation files: [application](src/App.tsx),
[local brief extraction](src/brief.ts), [preview](src/StoryboardPreview.tsx),
[project model](src/model.ts), [frame composition](src/draw.ts),
[worker](src/render.worker.ts), [audio](src/audio.ts),
[storage](src/storage.ts), [server](server.mjs),
[unit tests](src/brief.test.ts), [browser tests](browser-tests/studio.spec.ts).
Setup, examples and limitations: [README](README.md).

## Actual local results

| Check | Local | Hostinger |
|---|---|---|
| Website loads | HTTP 200; about 305 ms to ready in the last local browser test | Not deployed/tested |
| Product upload | Valid PNG/JPEG/WebP; corrupt files rejected | Not tested |
| Prompt and optional overrides | Extraction, manual edits, reset and refresh persistence passed | Not tested |
| CPU rendering | Software H.264 in dedicated worker; no required video GPU API | Not tested |
| 15-second video | 360 decoded frames; every timestamp/duration checked at 24 FPS | Not tested |
| MP4 export/download | 480 x 854 and 720 x 1280 decoded and downloaded | Not tested |
| Music + subtitles | MP3-in-MP4 audio decoded; SRT downloaded; supplied text preserved | Not tested |
| Storyboard preview | Play/pause, changing image frames, editable copy passed | Not tested |
| Mobile layout | Chromium at 390 x 844; no horizontal overflow | Physical mobile/Hostinger not tested |
| Cancellation/recovery | Worker termination, cross-tab lease, duplicate prevention, interrupted refresh passed | Not tested |
| Memory errors | Low headroom, storage quota and 1080p gate tested explicitly | Not tested |
| No paid APIs/uploads | No external rendering requests or media-upload requests observed | Not tested |
| Original library | All 8 baseline files, including SQLite and media, byte-identical | Not transferred |

Final measured production-style local renders, using the existing product
fixture and synthesized licensed-for-testing tone:

| Output | Encoding time | File bytes | Encoder peak WASM allocation |
|---|---:|---:|---:|
| 480 x 854, silent | 5.5 s | 1,901,321 | 16.0 MiB |
| 720 x 1280, software music | 10.6 s | 3,642,707 | 19.3 MiB |
| Simulated low-resource 480p | 5.7 s | Approximately 1.81 MiB | 16.0 MiB |

The simulation reports 2 cores/2 GB RAM and CDP 4x main-thread slowdown. It is
not a physical low-end device test and does not reliably throttle worker CPU.
Times are observations on this workstation, not promised visitor performance.

- Initial compressed HTML/CSS/JavaScript: **88,656 bytes**, about 305 ms local
  load-to-ready. Encoder and audio modules are lazy, absent from initial load.
- Software video worker: about **1.70 MB raw**, approximately 0.49 MB gzip;
  software audio/mux module: about **0.75 MB raw**, approximately 0.19 MB gzip.
  WASM is embedded in these local assets; no AI model downloads.
- Maximum 50 ms main-thread heartbeat interval observed during the 720p render:
  **181.4 ms**, below the tested 750 ms threshold.
- Owned Chromium test-browser CPU time: **12.71 CPU seconds / 11.32 wall seconds**,
  roughly 112% of one logical core, including browser/display/test overhead.
  Not whole-device CPU utilization or a claim that display never uses a GPU.
- Audio packet end: **15.0215 s**; decoded audio: **14.9964 s**; video: **15 s**.
  Container audio/video end difference is about **21.5 ms**.
- After two renders and forced garbage collection, main JS heap increased by
  **730,660 bytes**; **zero active rendering workers** remained. This is a
  short cleanup check, not a long-duration leak test or total process peak RAM.
- Browser worker JS heap/total process peak memory were not exposed reliably.
  Resource budgets are guards, not reserved OS memory.

## Executed commands and outcomes

- `npm run lint`: passed.
- TypeScript and Vite production build under Node 24: passed.
- Unit tests under Node 24: **36 passed**.
- `npm run test:e2e -- --timeout=90000`: **9 passed**, about 1.1 minutes.
- Earlier in this implementation, unchanged legacy Python suite: **40 passed**;
  no live paid provider invoked. Not required to run the browser studio.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Full dependency audit: **11 moderate development-tool advisories**, no high
  or critical advisories at last check. These remain unresolved; do not describe
  the entire dependency tree as vulnerability-free.
- Existing encoder emits an upstream `eval` build warning. Its binding
  generation is isolated to the dedicated worker CSP, not the document.

Fixes found by actual testing included Vite worker query-string wrapping,
worker-only CSP, first-use audio dependency reloads, persistent field labels,
controlled approval checkbox persistence and ambiguous/malformed price parsing.

## Limitations

This is photo animation, never generated actors or cinematic footage. Human
action/dialogue requires actual filmed footage and a footage-capable editor;
this editor currently only accepts photos. Prompt scene descriptions are saved
as reference, not interpreted into arbitrary new shots. Local rules cannot
understand every natural-language expression; review extracted data and overlays.
Output remains fixed at 15 seconds. Music is optional uploaded music, not generated.
MP3-in-MP4 may need conversion to AAC for some social services. No live social
publishing, physical mobile-browser certification, live Hostinger testing,
1080p render benchmarking or independent strict GPU-free hardware audit occurred.

## Exact remaining deployment steps

1. Confirm the actual ShopReel GitHub repository, target domain, branch and
   existing GitHub-to-Hostinger deployment mechanism. Do not initialize a new
   repository or touch AI Bench Recruiter without explicit instructions.
2. With the correct repository connected, create `feature/browser-cpu-rendering`,
   review the diff, exclude private media/database/secrets/generated tests,
   commit tested changes and open a PR containing the evidence above.
3. Use Hostinger Node 24 (or compatible Node 22.13+). Proposed existing-app
   commands are `npm ci`, `npm run build`, `npm start`; verify them against
   that environment rather than creating a new hosting configuration.
4. Configure `NODE_ENV=production`, Hostinger's provided `PORT`, and
   `SHOPREEL_ALLOWED_HOSTS` as the exact confirmed domain(s), comma-separated
   hostnames without schemes. No API credentials or browser-visible secrets.
   The production server disables read-only private legacy-library access.
5. Obtain explicit production approval. Only then deploy through the verified
   mechanism and check public upload, browser encoding, MP4/SRT/audio, mobile
   layout, HTTP errors, CSP/MIME/CORS, unexpected paid calls and runtime logs.
6. Preserve license/source notices with the build. Verify backups and rollback
   for that specific app. Never overwrite another website.

**GitHub commit/PR:** none. **Deployed URL:** none. **Local URL:** http://localhost:5050/.
