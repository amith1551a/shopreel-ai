import { describe, it, expect } from 'vitest';
import { DEFAULTS, DEFAULT_CTA, formatPrice, validateSettings, resourceCheck, sceneText, subtitles, limitFile, FRAMES } from './model';

describe('decimal-safe prices', () => {
  it.each([['0.10', 'USD', 'USD 0.10'], ['29.9', 'EUR', 'EUR 29.90'], ['1000', 'JPY', 'JPY 1,000'], ['4.123', 'KWD', 'KWD 4.123']])('%s %s', (value, currency, expected) => expect(formatPrice(value, currency)).toBe(expected));
  it.each(['-1', '0', 'NaN', 'Infinity', '1e3', '1.001', '1,000', '1000000000', '<script>'])('rejects invalid USD %s', value => expect(() => formatPrice(value, 'USD')).toThrow());
  it('rejects unsupported currency and decimal yen', () => { expect(() => formatPrice('1', 'ABC')).toThrow(); expect(() => formatPrice('1.5', 'JPY')).toThrow(); });
});
describe('story and supplied copy', () => {
  it('uses the default CTA without inventing claims', () => { expect(sceneText(DEFAULTS)[3]).toBe(DEFAULT_CTA); expect(sceneText(DEFAULTS).join(' ')).not.toMatch(/discount|limited|premium|cotton/i); });
  it('preserves custom CTA and exact price', () => expect(sceneText({ ...DEFAULTS, price: '0.10', cta: 'Visit the booth' })[3]).toBe('USD 0.10\nVisit the booth'));
  it('supports no captions and complete separate subtitles', () => {
    expect(subtitles({ ...DEFAULTS, captions: false })).toBe('');
    const srt = subtitles({ ...DEFAULTS, caption: 'Hello' });
    expect(srt).toContain('00:00:11,000 --> 00:00:15,000'); expect(srt).toContain('Hello');
    expect(FRAMES).toBe(360);
  });
  it('validates input lengths and URL without fetching', () => {
    expect(() => validateSettings({ ...DEFAULTS, cta: 'x'.repeat(81) })).toThrow();
    expect(() => validateSettings({ ...DEFAULTS, url: 'http://localhost/private' })).toThrow();
    expect(() => validateSettings({ ...DEFAULTS, url: 'https://store.example/product' })).not.toThrow();
  });
});
describe('bounded browser resource policy', () => {
  it('gates 1080p and insufficient headroom', () => {
    expect(() => resourceCheck('1080p', { cores: 2 })).toThrow();
    expect(() => resourceCheck('720p', { cores: 2, memoryGB: 2 })).toThrow();
    expect(() => resourceCheck('480p', { cores: 2, availableMB: 80 })).toThrow();
    expect(resourceCheck('480p', { cores: 2, memoryGB: 2, availableMB: 400 })).toBe(256);
  });
  it('rejects unsupported and oversized files', () => {
    expect(() => limitFile(new Blob(['bad'], { type: 'text/html' }), 'image')).toThrow();
    expect(() => limitFile(new Blob([new Uint8Array(9 * 1024 * 1024)], { type: 'image/png' }), 'image')).toThrow();
    expect(() => limitFile(new Blob([], { type: 'image/png' }), 'image')).toThrow();
  });
});
