import { useEffect, useRef, useState } from 'react';
import { drawFrame } from './draw';
import { inspectImage } from './media';
import type { Settings } from './model';

export default function StoryboardPreview({ settings, images, logo, busy }: { settings: Settings; images: Blob[]; logo?: Blob; busy: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = canvas.current, ctx = element?.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!element || !ctx || !images.length || busy) return;
    let disposed = false, animation = 0;
    const bitmaps: ImageBitmap[] = [];
    let brand: ImageBitmap | undefined;
    setError('');
    void (async () => {
      try {
        for (const image of images) {
          const bitmap = await inspectImage(image);
          if (disposed) { bitmap.close(); return; }
          bitmaps.push(bitmap);
        }
        if (logo) {
          const bitmap = await inspectImage(logo);
          if (disposed) { bitmap.close(); return; }
          brand = bitmap;
        }
        const start = performance.now();
        const paint = (now: number) => {
          if (disposed) return;
          const time = playing ? (seconds + (now - start) / 1000) % 15 : seconds;
          drawFrame(ctx, bitmaps, brand, settings, Math.floor(time * 24), 216, 384);
          if (playing) animation = requestAnimationFrame(paint);
        };
        paint(start);
      } catch (e) { if (!disposed) { setPlaying(false); setError(e instanceof Error ? e.message : 'Storyboard preview failed.'); } }
    })();
    return () => { disposed = true; cancelAnimationFrame(animation); bitmaps.forEach(image => image.close()); brand?.close(); };
  }, [settings, images, logo, busy, playing, seconds]);
  return <section className="storyboard-preview" aria-label="Storyboard preview">
    <p className="help">Photo storyboard preview · not AI footage · silent preview</p>
    {!images.length ? <p className="help">Upload photos to preview the four sales scenes.</p> : <>
      <canvas ref={canvas} width="216" height="384" aria-label="Animated photo storyboard" />
      <button className="secondary button" disabled={busy} onClick={() => setPlaying(previous => !previous)}>{playing ? 'Pause storyboard' : 'Play storyboard'}</button>
      <label>Preview position<input type="range" min="0.5" max="14.5" step="0.1" value={seconds} disabled={busy} onChange={e => { setPlaying(false); setSeconds(Number(e.target.value)); }} /></label>
    </>}
    {error && <p role="status" className="alert">Preview unavailable: {error}</p>}
  </section>;
}
