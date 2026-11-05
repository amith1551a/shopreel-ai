import { SCENES, TEMPLATES, sceneAt, sceneText, formatPrice, type Settings } from './model';

type Context = Pick<CanvasRenderingContext2D, 'font' | 'fillStyle' | 'globalAlpha' | 'fillText' | 'resetTransform' | 'fillRect' | 'scale' | 'drawImage'>
  & { measureText(text: string): Pick<TextMetrics, 'width'> };
function lines(ctx: Context, text: string, x: number, y: number, width: number, size: number, maxLines: number, color: string) {
  const words = text.split(/\s+/);
  let result: string[] = [];
  for (;;) {
    result = [];
    let line = '';
    ctx.font = `600 ${size}px Arial, sans-serif`;
    for (const word of words) {
    // Break unspaced product IDs too, without losing the supplied price or CTA.
    for (const piece of word.match(/.{1,24}/gu) ?? []) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (ctx.measureText(candidate).width > width && line) { result.push(line); line = piece; } else line = candidate;
    }
    }
    if (line) result.push(line);
    if (result.length <= maxLines || size <= 14) break;
    size -= 2;
  }
  ctx.fillStyle = color;
  result.forEach((value, i) => ctx.fillText(value, x, y + i * size * 1.3, width));
  return result.length * size * 1.3;
}
export function drawFrame(ctx: Context, images: ImageBitmap[], logo: ImageBitmap | undefined, settings: Settings, frame: number, width: number, height: number) {
  const colors = TEMPLATES[settings.template], scale = width / 720;
  const t = frame / 24, scene = sceneAt(t), timing = SCENES[scene], phase = (t - timing.start) / (timing.end - timing.start);
  ctx.resetTransform(); ctx.globalAlpha = 1;
  ctx.fillStyle = colors.background; ctx.fillRect(0, 0, width, height);
  ctx.scale(scale, height / 1280);
  ctx.fillStyle = settings.accent || colors.accent; ctx.fillRect(52, 94, 44, 5);
  ctx.font = '500 20px Arial, sans-serif'; ctx.fillStyle = colors.ink;
  ctx.fillText(settings.brand || SCENES[scene].name, 112, 102, logo ? 400 : 460);
  const image = images[scene === 3 ? 0 : Math.min(images.length - 1, Math.floor(t / 11 * images.length))];
  const area = { x: 48, y: 142, w: 624, h: scene === 3 ? 580 : 650 };
  ctx.fillStyle = colors.pale; ctx.fillRect(area.x, area.y, area.w, area.h);
  const zoom = 0.93 + 0.04 * Math.sin(phase * Math.PI);
  const factor = Math.min(area.w / image.width, area.h / image.height) * zoom;
  const w = image.width * factor, h = image.height * factor;
  const slide = Math.sin(phase * Math.PI * 2) * 8;
  ctx.globalAlpha = scene === 0 ? 1 : Math.min(1, (t - timing.start) / 0.16);
  ctx.drawImage(image, area.x + (area.w - w) / 2 + slide, area.y + (area.h - h) / 2, w, h);
  const entrance = scene === 0 || scene === 3 ? 1 : Math.min(1, (t - timing.start) / 0.18);
  const y = 870 + (1 - entrance) * 14;
  ctx.globalAlpha = entrance;
  const text = sceneText(settings)[scene];
  // The final price and CTA each have their own complete text block, never model-generated.
  if (scene === 3) {
    if (settings.price.trim()) lines(ctx, formatPrice(settings.price, settings.currency), 52, 795, 594, 48, 1, colors.ink);
    if (settings.offer?.trim()) lines(ctx, settings.offer, 52, 856, 594, 30, 2, colors.ink);
    ctx.fillStyle = colors.ink; ctx.fillRect(40, 939, 620, 210);
    lines(ctx, settings.cta.trim(), 60, 989, 580, 40, 3, colors.background);
  } else {
    lines(ctx, text, 52, y, 594, scene < 2 ? 48 : 36, scene < 2 ? 3 : 4, colors.ink);
  }
  if (settings.captions) {
    const caption = scene === 2 ? settings.caption.trim() : '';
    if (caption) {
      ctx.fillStyle = colors.ink; ctx.fillRect(40, 1068, 620, 90);
      lines(ctx, caption, 57, 1100, 586, 25, 2, colors.background);
    }
    ctx.globalAlpha = 1;
  }
  if (logo) {
    const size = Math.min(110 / logo.width, 60 / logo.height);
    ctx.drawImage(logo, 650 - logo.width * size, 62, logo.width * size, logo.height * size);
  }
  ctx.font = '18px Arial, sans-serif'; ctx.fillStyle = colors.ink;
  ctx.fillText(`PHOTO AD / 0${scene + 1}`, 52, 1200);
  ctx.resetTransform();
}
