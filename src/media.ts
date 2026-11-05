import { limitFile } from './model';
import { fadeGain } from './music';

function jpegOrientation(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset] !== 255) break;
    const marker = bytes[offset + 1], size = view.getUint16(offset + 2), end = offset + size + 2;
    if (size < 2 || end > bytes.length) break;
    if (marker === 0xe1 && size >= 16 && String.fromCharCode(...bytes.slice(offset + 4, offset + 10)) === 'Exif\0\0') {
      const start = offset + 10, little = view.getUint16(start) === 0x4949;
      if (![0x4949, 0x4d4d].includes(view.getUint16(start)) || view.getUint16(start + 2, little) !== 42) throw new Error('Invalid JPEG orientation metadata.');
      const directory = start + view.getUint32(start + 4, little);
      if (directory < start || directory + 2 > end) throw new Error('Invalid JPEG orientation directory.');
      const count = view.getUint16(directory, little);
      if (directory + 2 + count * 12 > end) throw new Error('Truncated JPEG orientation metadata.');
      for (let i = 0; i < count; i++) {
        const entry = directory + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    offset = end;
  }
  return 1;
}
function dimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) throw new Error('Invalid JPEG structure.');
      const marker = bytes[offset + 1], size = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const width = view.getUint16(offset + 7), height = view.getUint16(offset + 5);
        const orientation = jpegOrientation(bytes);
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
      }
      if (size < 2) throw new Error('Invalid JPEG segment.');
      offset += size + 2;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const type = String.fromCharCode(...bytes.slice(12, 16));
    if (type === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (type === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (type === 'VP8L') return { width: 1 + ((bytes[21] | bytes[22] << 8) & 0x3fff), height: 1 + ((bytes[22] >> 6 | bytes[23] << 2 | bytes[24] << 10) & 0x3fff) };
  }
  throw new Error('Image is corrupted or unsupported. Use a real JPEG, PNG or WebP photo.');
}
export async function inspectImage(file: Blob) {
  limitFile(file, 'image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = dimensions(bytes);
  if (size.width < 32 || size.height < 32 || size.width > 8192 || size.height > 8192 || size.width * size.height > 20_000_000) {
    throw new Error('Image dimensions must be at least 32 px, at most 8192 px per side and at most 20 megapixels.');
  }
  const factor = Math.min(1, 1440 / Math.max(size.width, size.height));
  const bitmap = await createImageBitmap(file, { resizeWidth: Math.max(1, Math.round(size.width * factor)), resizeHeight: Math.max(1, Math.round(size.height * factor)), resizeQuality: 'high' });
  if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error('Image could not be decoded.'); }
  return bitmap;
}
export async function prepareAudio(file: Blob, volume: number) {
  limitFile(file, 'music');
  const url = URL.createObjectURL(file), element = document.createElement('audio');
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cannot read music metadata. Use a short WAV or MP3.')), 10000);
      element.onloadedmetadata = () => { clearTimeout(timer); resolve(element.duration); };
      element.onerror = () => { clearTimeout(timer); reject(new Error('Music cannot be decoded by this browser.')); };
      element.preload = 'metadata'; element.src = url;
    });
    if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw new Error('Music must be at most 30 seconds; trim it locally before importing.');
    const context = new AudioContext({ sampleRate: 44100 });
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (buffer.duration > 30 || buffer.numberOfChannels > 2) throw new Error('Use mono or stereo music no longer than 30 seconds.');
      const samples = new Float32Array(44100 * 15);
      // Copy at most 15 seconds, downmix to mono, fade out; shorter audio is explicitly padded with silence.
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel);
        for (let i = 0; i < Math.min(source.length, samples.length); i++) {
          samples[i] += source[i] * volume / buffer.numberOfChannels * fadeGain(i, Math.min(source.length, samples.length), 44100);
        }
      }
      return { samples, sampleRate: 44100 };
    } finally { await context.close(); }
  } finally { element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); }
}
export async function verifyVideo(blob: Blob, width: number, height: number) {
  const url = URL.createObjectURL(blob), video = document.createElement('video');
  video.muted = true; video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Output playback verification timed out. No completed video was saved.')), 15000);
      const fail = () => { clearTimeout(timer); reject(new Error('This browser cannot play the generated MP4. Try Chrome or Edge.')); };
      video.onerror = fail;
      video.onloadeddata = () => {
        if (video.videoWidth !== width || video.videoHeight !== height || Math.abs(video.duration - 15) > 0.15) { fail(); return; }
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = 14.8;
      };
      video.src = url;
    });
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
