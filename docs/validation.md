# Observed validation

- Python 3.12 environment: dependencies installed successfully; pip check found no broken requirements.
- 19 automated unit/route/template tests passed. This includes malformed schedule payload types, a render-failure cleanup test, SQLite persistence across app recreation, CSRF/host guards, image validation, approval, and local scheduling.
- Real render smoke test passed: 9 seconds, 720 × 1280, 24 fps, H.264 MP4 with no audio. The encoder ran; frames were decoded at seconds 1, 4, and 7. Approval and local queue transitions passed. Results are in smoke-results.json.
- Synthetic sample poster was visually inspected. A playable sample-reel.mp4 is included.
- JavaScript syntax passed `node --check static/app.js`.
- Live local HTTP checks returned 200 for the studio page, JavaScript, CSS, sample PNG and video-list API.
- Source fetch helper successfully recognized all three already-pulled upstream revisions without overwriting them. A fresh-machine full-clone path was not rerun; it uses standard Git commands and requires network access.
- Browser UI automation could not run because Chromium was absent and its download returned an invalid archive. Therefore browser interactions/responsive layout have not been independently verified. Use the README's sample flow for a manual browser check.

No Shopify store was connected, no voice model was downloaded, no social account was connected, and no social post was published. Only the MoviePy runtime is active. This is the defined local first version, not a complete production automation service.

Portability: tested on Linux/Python 3.12. Windows instructions use standard Python-launcher/venv paths, but were not executed on Windows in this environment. requirements-tested.txt records this environment's exact dependency snapshot; requirements.txt is the direct dependency installation file.
