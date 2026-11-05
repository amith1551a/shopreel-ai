import HME from 'h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js';
import { drawFrame } from './draw';
import { FPS, FRAMES, SECONDS, RESOLUTIONS, validateSettings, type RenderRequest, type WorkerReply } from './model';
import type { H264MP4Encoder } from 'h264-mp4-encoder';
import { composeMusic, selectedMusic } from './music';

declare const self: DedicatedWorkerGlobalScope;
const worker = self;
function send(value: WorkerReply, transfer: Transferable[] = []) { worker.postMessage(value, transfer); }
function heap() {
  const performanceWithMemory = performance as Performance & { memory?: { usedJSHeapSize: number } };
  return performanceWithMemory.memory?.usedJSHeapSize ?? null;
}
worker.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { settings, images, logo } = event.data;
  let audio = event.data.audio;
  let encoder: (H264MP4Encoder & { readonly wasmMemoryBytes: number }) | undefined;
  const start = performance.now();
  let peakHeap: number | null = heap();
  let wasmMemoryBytes = 0;
  try {
    validateSettings(settings);
    const music = selectedMusic(settings);
    if (music === 'mute' || settings.musicVolume === 0) audio = undefined;
    else if (music === 'upload' && !audio) throw new Error('Upload your licensed music or select a built-in style.');
    else if (music !== 'upload') audio = composeMusic(music, settings.musicVolume);
    if (!images.length || images.length > 4) throw new Error('Upload one to four product images.');
    const { width, height, budgetMB, kbps } = RESOLUTIONS[settings.resolution];
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!ctx) throw new Error('CPU canvas rendering is unavailable in this browser.');
    send({ type: 'progress', progress: 0, stage: 'Loading local software encoder', heapBytes: peakHeap });
    encoder = await HME.createH264MP4Encoder();
    encoder.width = width; encoder.height = height; encoder.frameRate = FPS;
    encoder.speed = 10; encoder.kbps = kbps; encoder.groupOfPictures = 48;
    encoder.initialize();
    let poster: Blob | undefined;
    for (let frame = 0; frame < FRAMES; frame++) {
      drawFrame(ctx, images, logo, settings, frame, width, height);
      if (frame === 12) poster = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      encoder.addFrameRgba(ctx.getImageData(0, 0, width, height).data);
      wasmMemoryBytes = Math.max(wasmMemoryBytes, encoder.wasmMemoryBytes);
      const boundedSurfaceBytes = images.reduce((total, image) => total + image.width * image.height * 4, 0) + width * height * 12 + (audio?.samples.byteLength ?? 0);
      if (encoder.wasmMemoryBytes + boundedSurfaceBytes > budgetMB * 1024 * 1024) throw new Error('Encoder memory safety budget exceeded. Retry in 480p with fewer photos.');
      if (frame % 6 === 0) {
        const used = heap();
        if (used !== null) {
          peakHeap = Math.max(peakHeap ?? 0, used);
          if (used > budgetMB * 1024 * 1024) throw new Error(`Memory safety budget exceeded. Retry in 480p with fewer images.`);
        }
        send({ type: 'progress', progress: frame / FRAMES * 88, stage: `Rendering frame ${frame + 1}/${FRAMES}`, heapBytes: peakHeap });
        await new Promise(resolve => setTimeout(resolve, settings.lowImpact ? 8 : 0));
      }
    }
    encoder.finalize();
    let video: Uint8Array<ArrayBuffer> = new Uint8Array(encoder.FS.readFile(encoder.outputFilename));
    encoder.FS.unlink(encoder.outputFilename); encoder.delete(); encoder = undefined;
    if (audio) {
      send({ type: 'progress', progress: 90, stage: 'Encoding music with software MP3 and muxing MP4', heapBytes: peakHeap });
      const { muxAudio } = await import('./audio');
      video = await muxAudio(video, audio);
    }
    if (!poster || !video.byteLength || video.byteLength > 30 * 1024 * 1024) throw new Error('Output is missing or exceeds the 30 MB output safety limit.');
    const metrics = {
      renderMs: performance.now() - start, width, height, fps: FPS, duration: SECONDS, frames: FRAMES,
      outputBytes: video.byteLength, workerHeapBytes: peakHeap, wasmMemoryBytes, memoryBudgetMB: budgetMB, audio: Boolean(audio),
      encoder: 'minih264 WASM software (single rendering worker)',
    };
    send({ type: 'done', video: video.buffer, poster, metrics }, [video.buffer]);
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : 'Browser encoding failed. Try 480p.' });
  } finally {
    encoder?.delete();
    images.forEach(image => image.close()); logo?.close();
    // Terminate the entire worker so WASM memory and the optional MP3 helper cannot accumulate.
    worker.close();
  }
};
