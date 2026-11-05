# ShopReel AI - browser CPU video studio

Enter one advertising prompt, upload product photos, review a sales storyboard,
then generate a 15-second MP4 with local background music **in your browser**.

**No API keys, paid services, AI models, GPU capabilities, Python or server-side
video encoding are needed by this mode.** The Node server only serves assets
and optionally reads the original library on localhost. No media upload route
exists. Browsers can still use GPUs internally for display and decoding; strict
GPU-free hardware usage has not been independently measured.

This is deliberately an **animated-photo template editor**, not image-to-video
AI. It does not create people, garment motion, new product views, voiceovers,
360-degree scans or invented promotional claims. The old Python/Runway studio
and its files are preserved separately; see [legacy documentation](LEGACY_README.md).
Do not run both servers on port 5050 at the same time.

## Start locally on Windows

Install **Node.js 24 LTS** (Node 22.13+ also supported; Node 20 is not supported
because the read-only local library uses built-in SQLite). Open this folder in
VS Code, then use its PowerShell terminal:

```powershell
node --version
npm --version
```

These print the installed runtime and package-manager versions. Use Node 24,
not the machine's previously installed Node 26, for Hostinger parity.

```powershell
npm ci
```

Installs the exact JavaScript dependencies from the lockfile. Internet is needed
for this initial installation, not for rendering calls. No AI model is downloaded.

```powershell
npm run dev
```

Starts the local Vite development server at **http://localhost:5050**. Leave the
terminal open; Ctrl+C stops it. It binds only to this computer. If port 5050
is busy, stop the other ShopReel server first; do not kill unrelated applications.

For the production-style local server:

```powershell
npm run build
npm start
```

The first command type-checks, bundles the app, prepares gzip assets and copies
license notices. The second serves the build at **http://localhost:5050**.
No video encoder runs on the Node server. No `.env` is required. Environment
variables in `.env.example` belong only to the preserved legacy Python mode.

## Workflow and sensible defaults

1. **Enter one video prompt** describing the complete ad, in natural language or
   pasted from ChatGPT. The app extracts explicitly stated product name, price,
   currency, target audience, problem, solution, benefits, scenes, captions and
   CTA with local rules, not an LLM or API. Review the extracted details; it does
   not infer missing facts or fully understand every sentence. Optional editable
   overrides retain the previous title, promotional text, price/currency and CTA
   controls, plus editable story context. Manual overrides survive prompt edits;
   "Reset overrides from prompt" explicitly clears them.
2. Select one to four real JPEG, PNG or WebP product photos. Each must be below
   8 MB, 32-8192 pixels per side, and at most 20 megapixels. Source headers are
   checked before decoding; decoded render images are reduced to 1440 pixels
   on the longest side. All selected references cycle through the first three
   scenes without redrawing or stretching the product.
   USD is the default when currency is absent. Bare `$` and `yen` symbols can be
   ambiguous; review warnings. Multiple distinct prices are not auto-selected.
   Prices use exact string/BigInt decimal arithmetic, not binary floating-point
   rounding. Supported currencies: USD/EUR/GBP/CAD/AUD/INR, JPY and KWD.
   The former Python `Decimal` validation remains in legacy mode.
3. Default CTA: "Shop now - link in bio" (the UI uses the original em dash).
   Presets, custom text and blank CTA are supported. A CTA does not create a
   functioning shopping link.
4. Choose Warm studio, After hours or Graphic pop. Review the four-scene plan:
   **HOOK 0-3s, PRODUCT 3-7s, VALUE 7-11s, CTA 11-15s**. AIDA/PAS-inspired
   rules use an explicit hook or problem/question, product name, up to two
   supplied benefits (or supplied promotional text/solution), and a buying action.
   Missing facts are flagged, never invented. Benefits and offers are supplied
   by you, not independently verified. Confirm their accuracy before posting.
   Choose Problem/Solution, Product Benefits or Lifestyle/Emotional variation;
   this changes the hook without fabricating facts. Render versions individually.
   Play the silent visual storyboard or scrub through it; hook, product and
   value overlays are editable and survive prompt edits until reset.
   Captions animate in, photos fade at cuts, and the final CTA stays fully
   visible for all four final seconds without a fade-out. Photos retain their
   proportions with restrained zoom/pan. Text uses high-contrast theme colors,
   with key copy inside a vertical mobile-safe inset (platform overlays vary).
   Requested scene descriptions are
   saved for reference, not converted into generated footage or arbitrary
   camera action. Actors, dialogue or cinematic action need real filmed footage
   in a footage-capable editor; this photo editor does not accept filmed clips.
5. Default output: **720 x 1280, 24 FPS, 15 seconds / 360 frames**. Advanced
   settings start collapsed. 480p uses 480 x 854, the standard even-pixel
   approximation of vertical 9:16. 1080 x 1920 is gated behind at least 8 GB
   reported RAM and 4 logical cores; devices with unknown RAM cannot select it.
6. **Background music defaults to Auto for new projects.** Four original CC0
   instrumental motifs are synthesized locally: upbeat, luxury, energetic and
   relaxing. Auto uses explicit mood/product keywords, falling back to upbeat.
   These are simple synthesized instrumentals, not AI-composed or commercial
   stock recordings; no audio downloads, service or attribution are required.
   Select a style manually, mute, set volume (zero omits the track), or use
   your own licensed mono/stereo audio: at most 10 MB and 30 seconds.
   Imported tracks are downmixed to mono, volume-adjusted, faded in for 0.3s
   and out for 1s, with silence padding for shorter tracks. Built-ins use the
   same fades. Music preview has separate playback controls; the storyboard
   preview remains visual-only. The finished MP4 contains the selected audio.
   Older saved projects retain their previous uploaded music or silence until
   you change it. Software LAME encodes MP3 into
   MP4. This works in the tested Chromium browser but some social services or
   other browsers may require AAC instead. Unsupported music fails explicitly;
   music is never silently removed.
7. Captions default on. Optional short caption, readable supplied copy and
   deterministic price/CTA overlays; separate SRT download. No transcription.
   Optional brand name, accent color and uploaded logo; product URL is saved, never
   fetched. The editor never invents logos or destination links.
8. Generate, watch progress, cancel if necessary, preview with controls and
   download MP4/SRT. Completed is shown only after metadata, first-frame decode
   and near-end seek/playback verification. Tests additionally decode all 360
   video frames and inspect audio/video durations.

### Example prompt for the tee (adapted to free photo mode)

Paste this into Video prompt; there is no separate required title/copy form:

```text
Create a playful 15-second vertical photo ad for a product called
"Anime graphic tee", priced at USD 24.99. The target audience is anime fans.
The problem is an outfit that feels uninspired.
The solution is to make the tee the focus of the outfit.
Hook: Outfit having an off day?
Detail: Let the artwork do the talking.
Scene 1: Show the front product photo.
Scene 2: Show the back or artwork reference if supplied.
Scene 3: Show the artwork and supplied value copy.
Scene 4: End on the original product photo with the price and buying action.
Benefits: Anime graphic artwork
Call to action: Shop now - link in bio.
Use upbeat instrumental music.
Do not invent fabric claims, reviews, discounts, brand logos or unseen views.
```

For any product, replace the name, actual price/currency, audience and verified
facts. Natural phrasing such as `product called "Desk lamp"`, `priced at EUR 35`,
`the target audience is students`, `the problem is ...`, `the solution is ...`,
`benefits include ...`, and `end with "Visit our store"` is recognized.
Labelled `Product:`, `Price:`, `Audience:`, `Problem:`, `Solution:`, `Benefits:`, `Offer:`,
`Scene 1:` and `CTA:` lines also work. `Hook:` / `Detail:` specify exact short
overlay copy; `Caption:` adds a short caption. `Offer:` is copied exactly, not
validated as a real promotion; include conditions and only offers you can honor.
Multiple prices still require an explicit price override rather than an invented
discount calculation. Without supplied value details the plan flags missing
information and uses a neutral invitation to inspect the product, never a
paragraph of production notes. The form includes a reusable ChatGPT instruction
template; ChatGPT is optional and is not connected to this app.

The original Jake/Mike 30-second comedy requests actors, wardrobe changes,
dialogue and cinematic shots. Those cannot be generated by browser photo
templates. Such a script is saved and flagged; it is adapted only into the
reviewed four-scene photo storyboard, always 15 seconds. The app never claims
that a human performance or new footage was generated.

Rendering uses one Web Worker with software minih264 WASM and OffscreenCanvas
2D, plus one optional software-audio helper. No WebGPU, WebGL, VideoEncoder,
CUDA or FFmpeg rendering path is used. Frames are encoded sequentially; 360 raw
frames are not kept in memory. Rendering yields every six frames and lower-impact
mode adds a small pause. Memory budgets are 256/384/640 MB for 480p/720p/1080p,
checked against WASM allocations plus bounded image/frame/audio working memory.
Input/output caps and browser heap-headroom checks provide further guards; they
cannot reserve OS memory or guarantee a tab will never be killed by the browser.
Encoder WASM allocation is measured; total browser/process peak memory and OS
CPU utilization are not reliably exposed and are not represented as measured.

Each generation has a persisted project ID. The button locks synchronously,
and Web Locks prevent simultaneous renders across tabs. Refresh/closing stops
the render; reopening retains settings and labels it interrupted, with an
explicit free restart rather than a false success. Browser rendering does not
continue after the tab is closed. Cancellation terminates the worker and retains
the project. Re-rendering a completed project preserves the previous output.
Individual-scene replacement is not implemented; re-render the complete local
15-second template at no API cost.

## Storage, privacy and existing features

- New photos, settings, music, videos, approvals and local posting reminders
  live in **IndexedDB on this browser/origin**. Storage errors are displayed.
  No automatic deletion or social publishing. Download backups before clearing
  site data, switching browser/profile, or moving from localhost to a domain.
  A local posting reminder is saved information, not an unattended scheduler.
- Original `data`, `outputs` and `examples` files and database rows are untouched.
  My library > Read existing local library exposes read-only playback/download
  on this computer only. Original project settings remain in SQLite and can be
  reopened through the legacy studio. Browser templates do not convert old
  paid-generation projects.
- The production environment disables legacy-library access entirely. Do not
  upload the old private database/media or `.env` to a web host.
- No analytics, CDN fonts, rendering APIs or arbitrary URL fetches. Browser
  tests check for external calls and rendering uploads. Local HTTP Host checks,
  CSP, MIME protection, no framing and no mutation routes are retained.
- The pinned Emscripten encoder requires JavaScript binding generation.
  `unsafe-eval` is allowed only on the dedicated renderer worker response, not
  in the document. Dev-only fixed nonce supports Vite refresh scripts/styles.
  Serve with this Node server to retain these policies; do not deploy just the
  static files behind an unverified blanket CSP.
- Preserve [third-party notices](THIRD_PARTY_NOTICES.md) with redistributed builds.

## Repeatable checks

With the production-style local server running in one terminal, use another:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

These respectively check code quality, TypeScript, unit tests and real Playwright
browser rendering. If Playwright reports its Chromium binary is missing, run:

```powershell
npm exec -- playwright install chromium
```

This downloads a test browser, not an AI model, then rerun the browser tests.
The tests use local fixtures, original synthesized music and a test tone; they never spend API
credits. Generated test videos and reports stay in ignored `test-results` and
`playwright-report`, not application storage or Git. Legacy Python dependencies
in `requirements.txt` are unchanged except clarification; their optional test
commands are in the legacy documentation.

The sales acceptance test uses the existing local T-shirt reference in
`outputs/5e6d24136151472c9a7d18f2ac298440/product.png` read-only. Retain that
private fixture for this test; do not publish it as a bundled application asset.
See [sales upgrade test report](SALES_TEST_REPORT.md) for the latest results.

See [deployment readiness and measurements](DEPLOYMENT_READINESS.md) for actual
results and limitations. Hostinger deployment, Git branch/commit/PR and live
checks remain blocked: this folder has no Git repository and no verified
ShopReel domain or hosting environment. The user explicitly selected local-only
work and has not approved production deployment. No unrelated deployment was
modified.
