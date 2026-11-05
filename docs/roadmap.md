# Next integrations

1. Read-only Shopify catalog import: use an official Shopify app/library and scoped authorization when this phase is requested. Import product IDs, photos, titles and descriptions; no store mutation needed. No guessed API integration is included in this starter.
2. Local narration: run Piper as an optional component with a compatible voice model. Record engine/model licenses, align voice duration with scenes, and test audio/video sync.
3. Publishing: deploy/configure Postiz separately, connect authorized social accounts, then add a server-side adapter. Test with a selected test account and explicit publication authorization. Keep API keys out of browser code.
4. Real queue: add job states, retries, unique publication keys, cancellation, durable workers, and a clear published-versus-scheduled distinction. The current local planning queue has none of these dispatch functions.
5. Generative captions/video: make this opt-in, expose any usage costs, and preserve human review for product claims.

The current code is a working local starting point for this roadmap. It is not an embedded Shopify app or a production scheduler.
