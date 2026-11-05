# Sales-first upgrade - local test report

Verified November 3, 2026, using Node 24 and Playwright Chromium.
The existing T-shirt reference was rendered at **http://localhost:5050/**.
No deployment, publishing, paid API, new dependency or model download.

## What changed

- Four sales beats: hook 0-3s, product 3-7s, supplied value 7-11s,
  price/offer/buying action 11-15s. The hook is visible at frame zero;
  the CTA stays fully visible from 11s through the last frame.
- Local AIDA/PAS-inspired copy rules and three selectable hook variations.
  Up to two supplied benefits are used; absent claims are flagged, not invented.
  Exact hook/product/value overlays, price, offers and CTA remain editable.
- Automatic background music for new projects: four original CC0 instrumental
  styles, manual selection, mute, volume, preview and licensed uploads.
  Music is synthesized locally, faded in/out and included in the exported MP4.
  Old saved projects retain their previous audio setting until changed.
- More prominent proportional product framing, restrained zoom/pan,
  photo fades, contrast-aware theme text, brand accent color and safe text insets.
  New copy/music settings persist with projects; prior videos remain available.

## Actual results

| Check | Result |
|---|---|
| Lint / TypeScript / production build | Passed |
| Unit tests | 47 passed |
| Browser tests | 11 passed, approximately 1.5 minutes |
| T-shirt 720p export, built-in upbeat music | 14.7s encoding/muxing; 4,414,972 bytes (4.21 MiB) |
| T-shirt format | 720 x 1280, 24 FPS, all 360 frames decoded, 15.000s video |
| Audible exported music | Decoded RMS 0.03364; start/end RMS 0.00922 / 0.00085 confirm fades |
| Audio synchronization | Decoded audio 14.9964s; MP3 packet end 15.0215s |
| T-shirt encoder memory | 23.1 MiB peak allocated WASM; 384 MiB safety budget |
| T-shirt CPU measurement | 16.8045 CPU-seconds / 15.6939 wall-seconds, about 107% of one logical core |
| Rendering responsiveness | Maximum 50ms-heartbeat gap 65.5ms; below 750ms acceptance limit |
| 480p muted regression fixture | 5.0s; 1,820,869 bytes; 16.0 MiB allocated encoder WASM |
| Repeated render cleanup | Zero active workers; main JS heap growth 672,476 bytes after forced GC |
| Initial compressed HTML/CSS/JS | 91,040 bytes; local page ready in 265.5ms |
| Lazy render/audio bundles | 493,822 / 188,321 gzip bytes; no new model or music downloads |
| Privacy | No rendering uploads or external requests observed |
| Preservation | All 8 baseline media/database/example files remain SHA-256 identical |
| Other regressions | Uploaded music, MP4/SRT downloads, persistence, custom CTA, captions-off, cancellation, cross-tab lease, interrupted-job recovery, image validation and resource guards passed |
| Mobile / limited-device simulation | 390px layout and simulated 2-core/2GB 480p export passed |
| Hostinger / physical mobile | Not tested; deployment not approved |

The T-shirt test used its original front/back reference photo read-only, with
supplied copy: "Anime graphic tee", "Printed anime artwork; Front graphic",
USD 24.99 and "Shop now - link in bio." These are test inputs, not verified
commercial pricing or independently validated product claims. Hook, product,
value and CTA screenshots were visually inspected for readability.

CPU readings cover owned test-browser processes, not the whole device.
WASM allocation is **not total browser RAM**. Total process/worker peak memory
was not reliably measurable. The limited-device test does not reliably throttle
worker CPU and is not a physical low-end-device benchmark. Browser display
may use GPU hardware; no GPU capability is required by the encoder.

## Fixes found during verification

- Added explicit labels for music/variation selectors so controls remain
  accessible and unambiguous in browser automation.
- Confirmed music changes invalidate plan approval; the upload regression
  test now re-confirms before rendering.
- Retained older project's manually edited copy and silent/uploaded audio
  when loading it into the new editor.

## Limits

- Copy and music matching use deterministic local rules, not an LLM or image
  understanding. Supplied facts, offers, availability and destination wording
  require user review. No claims, testimonials, scarcity or discounts are invented.
- The four music styles are simple original synthesized instrumentals, not
  commercial stock songs or AI-composed recordings. Unit tests cover each;
  exported audio was decoded for built-in upbeat and an uploaded test track.
- Storyboard preview is visual-only; use **Preview music** separately.
  The generated MP4 has playback controls and the selected audio.
- MP3-in-MP4 works in tested Chromium; some browsers/social platforms require
  AAC. No AAC, generated voices, actors, new locations or cinematic footage.
- Variations render individually, not in one batch. Four timed photo beats
  remain fixed at 15 seconds. Sales/conversion improvement is not measured
  or guaranteed. Physical mobile, 1080p and Hostinger testing remain unexecuted.
- The pinned encoder's existing build-time `eval` warning remains; dynamic
  binding permission stays isolated to its worker, not the document.

## Files and repeatable commands

Changed: `src/App.tsx`, `src/model.ts`, `src/brief.ts`, `src/draw.ts`,
`src/media.ts`, `src/render.worker.ts`, `src/StoryboardPreview.tsx`,
`src/brief.test.ts`, `src/model.test.ts`, `browser-tests/studio.spec.ts`,
`README.md`, `THIRD_PARTY_NOTICES.md`, `DEPLOYMENT_READINESS.md`.
Added: `src/music.ts`, `src/sales.test.ts`, this report.

Using Node 24, from the project directory:

```powershell
npm run build
npm start
```

Builds the browser application, then serves it at localhost:5050. Leave that
terminal open. In a second terminal:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

Checks style, types, unit behavior and browser exports respectively. The
T-shirt browser test requires the existing private reference described in
the README. Browser evidence stays in ignored `test-results`; no generated
videos or private reference images were committed or deployed.

To try the upgrade, refresh localhost:5050, enter the prompt and upload photos.
For an older saved project choose **Background music > Auto** and generate
again: previously downloaded silent MP4 files are intentionally unchanged.
