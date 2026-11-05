# Preserved legacy Python / Runway studio

**Product photo + prompt + Decimal price + CTA -> free scene plan -> cost confirmation -> paid moving scenes -> local MoviePy editing -> preview -> MP4/SRT download.**

Runs at **http://localhost:5050**. Runway Gen-4 Turbo is the one connected image-to-video provider. A paid Runway developer account/key is required for new moving scenes; no GPU is needed locally. Missing credentials show setup instructions, not a slideshow fallback. Existing videos remain available without credentials.

## Decisions and sensible defaults

Essential decisions not specified in the original brief, resolved conservatively:

- **Cloud consent and rights:** review the actual per-scene prompt, selected photo, estimate and rights/privacy warning before confirming. Photos/prompts go to Runway only after confirmation; follow Runway's retention/usage policies. Use artwork, people, logos and audio you have permission to use.
- **Price versus generation currency:** the product currency defaults to USD. Generation estimates are always USD, independently of product currency. Prices must be positive plain decimals, maximum 999,999,999; supported currencies: USD/EUR/GBP/CAD/AUD/INR (2 decimal places), JPY (0), KWD (3). No rounding of an invalid price, inferred discount, or offer text.
- **Provider/cost:** Gen-4 Turbo, estimated USD 0.05/generated second (5 credits/second at USD 0.01/credit), plus possible taxes. Default 5 seconds = USD 0.25; 10 seconds = USD 0.50. Rates are a documented estimate, not a guaranteed quote or account-balance check. Verify current pricing in the Runway dashboard. Default per-confirmation cap: USD 1.00. This is not a daily/lifetime budget.
- **Duration/editing:** default one 5-second scene plus a deterministic 2-second local end card = 7 seconds. Choose 10 generated seconds for two separate 5-second scenes plus the card = 12 seconds. The provider accepts integer durations 2–10; this UI deliberately exposes only these two simple supported workflows. One scene is not guaranteed to accomplish every shot requested in a long prompt; review the plan and use 10 seconds for a separate detail scene.
- **References:** main photo required; back, side and extra detail photos optional. Select a starting photo for each scene. This model accepts only **one starting image per scene**, not simultaneous multi-image product references. Unselected references remain stored locally but are not submitted. Images are EXIF-oriented, flattened on white, and fitted without stretching into the selected aspect ratio before cloud submission; this may add borders. Unseen views are inferred, not an accurate 360-degree scan.
- **Consistency:** default faceless, vertical 9:16. Same seed and preservation instructions across scenes encourage, but do not guarantee, consistent people, garments, color or artwork. Genuine movement comes from Runway; there is no template/zoom replacement if generation fails. Cloud movement quality and product fidelity still require human review.
- **Branding:** no brand, logo or URL by default. Supplied name/logo appear on the local end card; URL is saved only, never fetched or converted into a pretend shopping link. CTA defaults to “Shop now — link in bio.” Alternatives: “Tap to shop,” “Visit our store,” or custom text up to 80 characters. CTA text does not create a functioning link.
- **Audio/captions:** silent by default. Optional uploaded music and/or recorded voiceover are mixed locally (music 25%, voice 100%, trimmed to length, not looped). Language describes the supplied recording; automatic speech generation and transcription are **not connected**. Captions default on: short mockup/review labels, plus exact price/CTA in SRT. They are not invented product claims or speech transcripts.
- **Retries:** no automatic paid retries. Known tasks resume polling/download/editing without another generation request. A definitively failed/cancelled scene can be regenerated individually for another estimated USD 0.25 after confirmation. A successful scene cannot currently be regenerated through the UI; start a new reviewed project if you want a different take.

Optional future improvements (not prerequisites): multi-reference/character-lock provider, editable storyboards, licensed music library, automatic voiceover/transcription, additional currencies, daily spending ledger, successful-scene alternate takes, and manual social publishing integrations. **Nothing automatically publishes now.**

## Exact Windows setup

Use Python **3.12** and open this existing folder in VS Code. Keep `data\`, `outputs\` and `examples\`; do not reset them. In its PowerShell terminal:

```powershell
py -3.12 -m venv .venv
```

Creates an isolated project environment. Skip if this folder already has a working `.venv`; do not recreate or remove existing project data.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Installs the tested Flask, MoviePy, Pillow and dotenv dependencies and their pinned transitive packages inside that environment. Internet access is needed for package installation. MoviePy's FFmpeg helper performs local encoding/decoding; a GPU is not required.

```powershell
Copy-Item .env.example .env
```

Creates a local configuration file **only if you do not already have `.env`**. Do not overwrite an existing configuration.

```powershell
notepad .env
```

Opens configuration for editing. Replace `replace_with_your_runway_developer_api_key` with your **Runway developer** API secret from https://dev.runway.com/ and fund the account. The placeholder is deliberately treated as unconfigured. Optionally adjust `SHOPREEL_MAX_GENERATION_USD=1.00`. Save and close Notepad. Never paste the key into the browser, source, logs, or Git; `.env` is ignored. Process environment variables override `.env`.

```powershell
.\.venv\Scripts\python.exe app.py
```

Starts the local Flask server and background worker on **127.0.0.1:5050**. Open **http://localhost:5050**. Leave this process running while generating; the browser can refresh or close. Ctrl+C stops it. Restarting resumes saved known tasks, never blindly resubmits them. Run one local server; this is a single-user local app, not an internet-hosted multi-user service.

On the first launch against a previous library, the app creates a consistent SQLite backup named `data\studio-before-generator-<unique-id>.sqlite3` before adding the new tables. Old `videos` rows and files are not rewritten. Keep `data\` and `outputs\` together for backup/restore. They contain private product assets and prompts. Storage grows; no automatic deletion policy is enabled.

## Using the studio

1. Upload the main product photo; optionally add front/detail, back or side references.
2. Describe the scene/movement; enter numeric price and currency. No product name or “What makes it special?” is required.
3. Keep defaults or expand advanced settings for duration/aspect/model style, captions, audio, brand/logo/URL and each scene's reference.
4. Click **Generate Video - show plan & estimate**. This only saves uploads/settings and a local plan.
5. Review the exact scenes, inferred-view/product-fidelity warnings, final duration and USD estimate. Check consent, then **Confirm & generate**. This is the paid boundary.
6. Follow the saved job: **queued -> generating -> editing -> completed**, or **failed/cancelled**. Task IDs and progress survive refreshes and server restarts. A completed job is added to the existing video library only after its MP4 decodes.
7. Open the preview with playback controls. Review artwork/color/proportions, people, price and CTA. Download the MP4 and, when captions are enabled, the SRT separately. Approval/local posting plans are preserved, but never dispatch social posts.

Example prompt:

> Create a trendy faceless ad for this anime graphic tee. Show someone wearing it beside a parked bike, close-ups of the artwork, and natural movement. End with the price and ‘Shop now — link in bio.’

The model is instructed not to draw text/prices/links/logos or invent product claims. MoviePy adds the supplied price and CTA deterministically; a model can nevertheless ignore instructions or hallucinate details, so the preview is a **mockup requiring review**, not a product authenticity guarantee.

## Recovery, retries and cancellation

- Upload-plan POSTs use saved idempotency keys and content fingerprints. Initial paid confirmation is unique per saved project. Retrying a timed-out confirmation returns the existing job.
- A file lock excludes other local workers. The worker persists “submitting” before the paid POST and the Runway task ID immediately afterward. It performs **no HTTP retries for paid POSTs**.
- If submission times out or the server stops in the ambiguous submission window, the job is marked `submission_unknown` and paid retry is blocked. Find the **original task ID** for that scene in your Runway developer dashboard; attach it in the job's reconciliation form. The app verifies the ID exists, but you must verify it is the correct original scene; the API does not expose a documented idempotent submission/list-by-client-key reconciliation mechanism here. If you cannot identify it, leave the job stopped and contact Runway; don't guess or create a replacement just because of a timeout.
- Known task IDs resume on restart. Temporary polling/download/decoding/edit failures stop clearly; **Resume saved task / local edit** uses the same generation, not a new paid request. Runway output URLs expire after 24–48 hours; resuming long after expiration may not recover the download.
- Resuming a job cancelled before every scene started can submit its not-yet-started scenes under the original confirmed estimate. This is not a new authorization or a promise that those unstarted scenes are free.
- A definitively failed/cancelled scene can be regenerated with fresh explicit cost confirmation; other completed scene files are reused. Command idempotency and expected-attempt checks block duplicate retry charges. Old task IDs/attempt history and scene files are retained. The displayed total is **authorized estimates**, not actual billing.
- **Request cancellation** is available while queued/generating, processed on the next poll. The adapter only requests deletion/cancellation for tasks observed in progress, not successful tasks. Runway documents race conditions: cancellation may not stop execution, and running/cancelled/failed/moderated tasks may still be charged. **No refund is promised.** Editing is not cancellable. Closing the browser does not cancel.
- Polling backs off from 5 to 15 seconds and pauses after 20 minutes; a free resume can continue the original task. One job is processed at a time; queued jobs remain responsive.

## Validation and local protections

- Photo/logo: decoded PNG/JPEG/WebP only, 8 MB each, single-frame, below 20 MP, at most 8192 pixels/side; product photos at least 128 pixels/side (logos 16).
- Audio: MP3/WAV/M4A/OGG, correct audio type, actual decode validation, 20 MB each, at most 5 minutes. Combined multipart request below 80 MB.
- Prompt: 1–600 UTF-16 units, leaving room for per-scene safety/consistency instructions within the provider's 1000-unit limit. CTA: at most 80; brand: at most 50; URL: at most 500, HTTPS and no credentials. Server-side Decimal currency/precision validation rejects NaN, exponents, symbols, zero and negative prices.
- Same localhost/port Host allowlist, random mutation token, restrictive CSP, no framing, `nosniff`, no-cache API and range-enabled media. No arbitrary URL fetching. Runway outputs are HTTPS, bounded to 200 MB, require a provider CDN host allowlist, and redirects are refused. If Runway changes its CDN host, update the adapter after checking the official contract; do not broaden it to arbitrary hosts.
- Credentials remain in the server-side environment. Provider errors are sanitized; no provider bodies, data URIs, prompts, keys, or signed output URLs are logged. This protects the application logs, not unrelated developer HTTP-debug tooling.

## Provider contract verified against official documentation

Documentation inspected November 1, 2026:

- [API reference](https://docs.dev.runwayml.com/api.md) / [OpenAPI](https://docs.dev.runwayml.com/openapi.json): `POST https://api.dev.runwayml.com/v1/image_to_video`, `model=gen4_turbo`, `promptImage` first-frame JPEG data URI, `promptText`, `duration`, `ratio`, `seed`; `X-Runway-Version: 2024-11-06` and bearer authentication.
- Accepted portrait/landscape/square resolutions used here: `720:1280`, `1280:720`, `960:960`; provider duration integer 2–10, UI uses 5-second scenes.
- [Inputs](https://docs.dev.runwayml.com/assets/inputs.md): image data URI maximum 5 MB encoded. Locally prepared JPEGs fit this limit.
- [Task lifecycle](https://docs.dev.runwayml.com/ai-context.md): `GET /v1/tasks/{id}`, pending/throttled/running, succeeded/failed/cancelled; `DELETE /v1/tasks/{id}` cancellation has billing/race caveats.
- [Outputs](https://docs.dev.runwayml.com/assets/outputs.md): success returns `output` URLs; download locally because they expire.
- [Pricing](https://docs.dev.runwayml.com/guides/pricing/): Gen-4 Turbo 5 credits/second, USD 0.01/credit. Provider prices/capabilities may change.

The REST adapter deliberately avoids SDK automatic submission retries so ambiguous paid requests cannot be silently duplicated. No image-captioning/VLM or LLM scene planner is connected: the free plan conservatively combines your prompt, starting-photo selection and fixed movement/detail directions; Runway itself interprets each image and prompt together.

## Tests (no paid provider calls)

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Runs mocked-provider tests for input validation, Decimal currencies, CTAs, missing configuration, plan/confirmation/retry idempotency, failures, recovery, cancellation, responsive background processing, local guards, approvals/scheduling, media ranges and preservation. Test data uses temporary directories, not your saved library.

```powershell
.\.venv\Scripts\python.exe scripts\smoke_render.py
```

Creates synthetic moving footage as a provider mock; runs two real MoviePy scene edits, captions, mixed test audio, deterministic price/CTA card, full-frame MP4 decoding, and range playback checks. Uses temporary storage and **does not overwrite existing examples or videos**. Synthetic motion is only test evidence, not a claim that live AI motion or human/product fidelity has been validated.

**Live Runway submission, real account billing, moderation, remote cancellation and visual product fidelity have not been tested; no credits are spent by automated tests.** Local test results and limitations are reported in the handoff; old files under `docs\` record historical starter validation, not current live-provider certification.

Observed validation for this update:

- **40 automated tests passed**, including simultaneous upload/paid-confirmation deduplication and per-scene retry recovery.
- **Real local render passed:** 720 × 1280, 24 fps, 12 seconds, all 288 frames decoded, two moving synthetic scene clips, music/voice mixing, deterministic end card, SRT and range-playback checks.
- Desktop and 390-pixel mobile browser checks passed: default/collapsed settings, custom CTA, second-scene/audio controls, no horizontal overflow, and original 9-second video playback with controls.
- Original library preservation verified separately: all five original media files have unchanged SHA-256 hashes; the original video record is unchanged; zero test projects were added to the live library. A migration backup was created.
- Python syntax checks and JavaScript `node --check` passed.

## Main files

| File | Purpose |
|---|---|
| `app.py` | Protected local routes, upload validation, project/job API, legacy library/approval/local plans |
| `product_brief.py` | Decimal prices, validated settings, deterministic scene plan/estimates |
| `provider.py` | Configurable Runway REST adapter; server-only key, polling/cancellation/download |
| `generation.py` | SQLite storage/backup, single-worker locking, durable task states and guarded retries |
| `video_engine.py` | MoviePy editing, deterministic overlays, audio mixing, subtitles and decode verification; legacy rendering helpers retained for scripts |
| `templates\index.html`, `static\app.js`, `static\generator.css` | Simple form, collapsed advanced settings, cost confirmation, saved jobs/projects and previews |
| `.env.example`, `requirements.txt`, `requirements-tested.txt` | Configuration placeholders and tested dependency pins |
| `tests\test_studio.py`, `scripts\smoke_render.py` | Mocked contract/workflow tests and real local encoding/decoding smoke test |

`static\style.css` and existing media/examples are retained. Optional upstream MoviePy/Postiz/Piper checkout metadata and licenses remain; Postiz publishing and Piper automatic voiceover are not connected. `scripts\make_demo.py` is a historical template-demo helper and is not the cloud workflow.

## Troubleshooting

- Missing credentials: configure `.env`, fund the Runway **developer** account, restart the server. Planning/old previews still work.
- Port occupied: use the existing studio or stop that specific local instance before starting another; do not change the protected port away from 5050.
- FFmpeg unavailable: set `IMAGEIO_FFMPEG_EXE` to a trusted local FFmpeg executable before starting.
- Missing glyphs: set `SHOPREEL_FONT` / `SHOPREEL_FONT_BOLD` to suitable local TrueType fonts for your text.
- Failed/expired output: inspect job state; resume a known task rather than buying again. Use per-scene paid retry only when the app explicitly offers it and you confirm the additional cost.
- Deployment, GitHub pushes, cloud provisioning and social publishing are not part of this app update.
