# Upstream sources

The ZIP contains the complete original ShopReelAI application. Third-party Git histories and source checkouts are not bundled. Install the runtime using requirements.txt; run `python scripts/fetch_repos.py` to obtain optional upstream source trees at the exact commits listed in repos.lock.json. Git and network access are required. The script leaves existing checkouts untouched and does not install or start Postiz/Piper.

In the build workspace all three source repositories were pulled. MoviePy was fully checked out; Postiz and Piper were sparse checkouts containing root project/license files. The fetch script obtains full trees on your machine for further development.

MoviePy's MIT license is retained in docs/upstream-licenses/moviepy.txt. Postiz's AGPL-3.0 and Piper's GPL-3.0 texts are retained alongside it. Postiz and Piper are future integrations, not dependencies imported by the current app. Keep their license obligations and any voice model's separate license in view when developing/distributing/hosting an integration. No voice model is included.
