import { type MusicStyle, type Settings } from './model';

export function selectedMusic(settings: Settings): MusicStyle | 'mute' | 'upload' {
  const choice = settings.musicStyle ?? 'mute';
  if (choice !== 'auto') return choice;
  const text = `${settings.prompt ?? ''} ${settings.title}`;
  if (/\b(luxury|elegant|jewel\w*|watch|perfume)\b/i.test(text)) return 'luxury';
  if (/\b(relax\w*|calm|spa|sleep|candle|tea)\b/i.test(text)) return 'relaxing';
  if (/\b(energetic|sport\w*|fitness|gym|running)\b/i.test(text)) return 'energetic';
  return 'upbeat';
}

export function fadeGain(index: number, length: number, rate: number) {
  return Math.max(0, Math.min(1, index / (rate * 0.3), (length - 1 - index) / rate));
}

// Original deterministic instrumental motifs, dedicated to CC0; no recordings or AI models.
export function composeMusic(style: MusicStyle, volume: number) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Music volume must be between zero and one.');
  const sampleRate = 44100, samples = new Float32Array(sampleRate * 15);
  const bpm = { upbeat: 112, luxury: 80, energetic: 132, relaxing: 68 }[style];
  const beat = 60 / bpm;
  const roots = [48, 53, 57, 55], melody = [12, 16, 19, 16, 14, 19, 21, 19];
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate, tick = Math.floor(time / beat), within = time % beat;
    const root = roots[Math.floor(tick / 4) % roots.length];
    let value = 0;
    for (const interval of [0, 4, 7]) value += Math.sin(time * Math.PI * 2 * frequency(root + interval)) * 0.06;
    const note = frequency(root + melody[tick % melody.length]);
    value += Math.sin(within * Math.PI * 2 * note) * Math.exp(-within * (style === 'relaxing' ? 3 : 8)) * 0.28;
    value += Math.sin(within * Math.PI * 2 * frequency(root - 12)) * Math.exp(-within * 5) * 0.16;
    if (style === 'upbeat' || style === 'energetic') {
      value += Math.sin(2 * Math.PI * (48 * within + 7 * (1 - Math.exp(-within * 35)))) * Math.exp(-within * 25) * 0.28;
      const hatTime = time % (beat / 2);
      value += (Math.sin(time * 18691) + Math.sin(time * 23917)) * Math.exp(-hatTime * 90) * 0.035;
    }
    samples[i] = value * volume * fadeGain(i, samples.length, sampleRate);
  }
  return { samples, sampleRate };
}

export function musicWav(audio: { samples: Float32Array; sampleRate: number }) {
  const bytes = new ArrayBuffer(44 + audio.samples.length * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, audio.samples.length * 2, true);
  audio.samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true));
  return new Blob([bytes], { type: 'audio/wav' });
}
