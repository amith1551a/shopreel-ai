# Browser rendering components

These are software codecs and a muxer, not AI models. All production assets are
served locally; the links below are documentation/source references, not runtime
downloads.

- h264-mp4-encoder 1.0.12: MIT wrapper, copyright Trevor Sundberg.
  https://github.com/TrevorSundberg/h264-mp4-encoder
  It embeds public-domain minih264 and MPL 1.1 libmp4v2, including the upstream
  Emscripten adaptations. The whole WASM binary is NOT solely MIT.
  Source and submodules/build instructions:
  https://github.com/TrevorSundberg/h264-mp4-encoder#how-does-it-work
  https://github.com/TrevorSundberg/h264-mp4-encoder#building-on-ubuntu
  https://github.com/lieff/minih264
  https://github.com/sergiomb2/libmp4v2
  MPL 1.1: https://www.mozilla.org/MPL/1.1/
- Mediabunny and @mediabunny/mp3-encoder 1.65.1: MPL 2.0.
  https://github.com/Vanilagy/mediabunny
  https://www.npmjs.com/package/mediabunny/v/1.65.1
  https://www.npmjs.com/package/@mediabunny/mp3-encoder/v/1.65.1
  The extension embeds LAME, under LGPL; its complete bundled license and
  notice are copied into the production licenses directory.
  https://lame.sourceforge.io/
- React/React DOM: MIT, https://github.com/facebook/react

The local Vite adapter appends an ESM export to the pinned upstream encoder
and exposes its WASM allocation size via a read-only getter; it does not change
the codec. The exact adapter source and installed codec/muxer/audio notices
are copied into the production licenses directory by the build. Keep these
notices and source references with distributed builds. Review codec patent
and license requirements for your distribution and jurisdiction.

## Original local music

The four instrumental motifs in `src/music.ts` are original deterministic
compositions and synthesis code created for this application, not sampled
recordings or copies of third-party songs. To the extent copyright applies,
these motifs and their synthesized audio are dedicated to the public domain
under CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/
No attribution is required for this built-in audio. The software MP3 codec's
separate licensing above still applies to distributing the encoder.

No product images or commercial stock recordings are bundled as an asset
library. Users must have permission to publish uploaded photos and audio.
