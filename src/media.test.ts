import { afterEach, expect, it, vi } from 'vitest';
import { inspectImage } from './media';

afterEach(() => vi.unstubAllGlobals());
it('rejects excessive dimensions before allocating a decoded image', async () => {
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71]); const view = new DataView(bytes.buffer);
  view.setUint32(16, 8000); view.setUint32(20, 8000);
  await expect(inspectImage(new Blob([bytes], { type: 'image/png' }))).rejects.toThrow('20 megapixels');
  expect(decode).not.toHaveBeenCalled();
});
it('rejects corrupted image headers before decoding', async () => {
  await expect(inspectImage(new Blob(['bad photo'], { type: 'image/png' }))).rejects.toThrow('corrupted');
});
it('resizes using EXIF-oriented proportions rather than stretching rotated phone photos', async () => {
  const bytes = new Uint8Array(60), view = new DataView(bytes.buffer);
  bytes.set([255, 216, 255, 225]); view.setUint16(4, 34);
  bytes.set([69, 120, 105, 102, 0, 0], 6);
  view.setUint16(12, 0x4949); view.setUint16(14, 42, true); view.setUint32(16, 8, true);
  view.setUint16(20, 1, true); view.setUint16(22, 0x0112, true); view.setUint16(24, 3, true);
  view.setUint32(26, 1, true); view.setUint16(30, 6, true);
  bytes.set([255, 192, 0, 17, 8], 38); view.setUint16(43, 800); view.setUint16(45, 600);
  const decode = vi.fn(async () => ({ width: 800, height: 600, close() {} }));
  vi.stubGlobal('createImageBitmap', decode);
  const image = new Blob([bytes], { type: 'image/jpeg' });
  await inspectImage(image);
  expect(decode).toHaveBeenCalledWith(image, { resizeWidth: 800, resizeHeight: 600, resizeQuality: 'high' });
});
