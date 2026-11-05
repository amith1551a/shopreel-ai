import { AudioSample, AudioSampleSource, BufferSource, BufferTarget, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';

export async function muxAudio(video: Uint8Array<ArrayBuffer>, audio: { samples: Float32Array; sampleRate: number }) {
  // Explicit WASM registration avoids depending on platform audio encoders.
  registerMp3Encoder();
  const input = new Input({ source: new BufferSource(video), formats: [MP4] });
  const output = new Output({ target: new BufferTarget(), format: new Mp4OutputFormat({ fastStart: 'in-memory' }) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Encoded video has no video track.');
    const videoSource = new EncodedVideoPacketSource('avc');
    const audioSource = new AudioSampleSource({ codec: 'mp3', bitrate: 128000 });
    output.addVideoTrack(videoSource, { frameRate: 24 });
    output.addAudioTrack(audioSource);
    await output.start();
    const config = await track.getDecoderConfig();
    for await (const packet of new EncodedPacketSink(track).packets()) {
      await videoSource.add(packet, config ? { decoderConfig: config } : undefined);
    }
    videoSource.close();
    for (let offset = 0; offset < audio.samples.length; offset += 4096) {
      const data = audio.samples.subarray(offset, Math.min(offset + 4096, audio.samples.length));
      const sample = new AudioSample({
        data, format: 'f32', numberOfChannels: 1, sampleRate: audio.sampleRate, timestamp: offset / audio.sampleRate,
      });
      try { await audioSource.add(sample); } finally { sample.close(); }
    }
    audioSource.close();
    await output.finalize();
    if (!output.target.buffer) throw new Error('Audio muxing produced no output.');
    return new Uint8Array(output.target.buffer);
  } finally { input.dispose(); }
}
