import { describe, expect, it } from 'vitest';
import { applyBrief, refreshSales } from './brief';
import { DEFAULTS, SCENES, sceneAt, sceneText, subtitles, validateSettings } from './model';
import { composeMusic, fadeGain, musicWav, selectedMusic } from './music';
import { drawFrame } from './draw';

const prompt = 'Product: Anime graphic tee\nProblem: Boring outfits\nBenefits: Printed anime artwork; Front graphic\nPrice: USD 24.99\nCTA: Visit our store';
describe('sales storytelling without invented facts', () => {
  it('uses four timed beats, two supplied benefits, exact money and a buying action', () => {
    const settings = applyBrief(DEFAULTS, prompt);
    expect(sceneText(settings)).toEqual(['Boring outfits?', 'Anime graphic tee', 'Printed anime artwork · Front graphic', 'USD 24.99\nVisit our store']);
    expect(SCENES.map(scene => [scene.start, scene.end])).toEqual([[0, 3], [3, 7], [7, 11], [11, 15]]);
    expect([0, 2.99, 3, 6.99, 7, 10.99, 11, 14.99].map(sceneAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(subtitles(settings)).toContain('00:00:11,000 --> 00:00:15,000\nUSD 24.99\nVisit our store');
    expect(sceneText(settings).join(' ')).not.toMatch(/cotton|discount|limited|review|premium/i);
  });
  it('offers three distinct hooks while keeping product, value and CTA truthful', () => {
    const settings = applyBrief(DEFAULTS, prompt + '\nAudience: anime fans');
    const versions = (['problem', 'benefits', 'lifestyle'] as const).map(variation => sceneText(refreshSales({ ...settings, variation })));
    expect(new Set(versions.map(copy => copy[0])).size).toBe(3);
    expect(versions[1].slice(1)).toEqual(versions[0].slice(1));
    expect(versions[2].slice(1)).toEqual(versions[0].slice(1));
  });
  it('does not invent a benefit or discount when absent and keeps explicit offers exact', () => {
    const empty = sceneText(applyBrief(DEFAULTS, 'Product: Tee'));
    expect(empty[2]).toBe('Take a closer look at the details');
    expect(empty[3]).not.toMatch(/off|sale|limited|free/i);
    expect(sceneText(applyBrief(DEFAULTS, prompt + '\nOffer: 10% off with TEE10 until Friday'))[3]).toContain('10% off with TEE10 until Friday');
  });
  it('retains explicit storyboard edits until reset, and rejects unreadable copy', () => {
    const edited = { ...applyBrief(DEFAULTS, prompt), salesCopy: ['My hook', 'Tee', 'Exact detail'] as [string, string, string], salesOverrides: [0, 2] };
    expect(sceneText(applyBrief(edited, prompt + '\nHook: A new hook'))[0]).toBe('My hook');
    expect(sceneText(applyBrief(edited, prompt + '\nHook: A new hook', true))[0]).toBe('A new hook');
    expect(() => validateSettings({ ...edited, salesCopy: ['x'.repeat(81), 'Tee', 'Detail'] })).toThrow('Sales storyboard');
  });
  it('draws the hook at frame zero and the complete CTA through the final frame', () => {
    const texts: { text: string; alpha: number; y: number }[] = [];
    const ctx = {
      globalAlpha: 1, font: '', fillStyle: '', resetTransform() {}, fillRect() {}, scale() {}, drawImage() {},
      measureText(text: string) { return { width: text.length * 22 }; },
      fillText(text: string, _x: number, y: number) { texts.push({ text, alpha: this.globalAlpha, y }); },
    };
    const settings = applyBrief(DEFAULTS, prompt);
    const image = { width: 720, height: 900 } as ImageBitmap;
    drawFrame(ctx, [image], undefined, settings, 0, 720, 1280);
    expect(texts).toContainEqual({ text: 'Boring outfits?', alpha: 1, y: 870 });
    for (const frame of [264, 312, 359]) {
      texts.length = 0;
      drawFrame(ctx, [image], undefined, settings, frame, 720, 1280);
      expect(texts.find(item => item.text === 'Visit our store')).toMatchObject({ alpha: 1, y: 989 });
      expect(texts.find(item => item.text === 'USD 24.99')).toBeDefined();
      expect(texts.every(item => item.y <= 1200)).toBe(true);
    }
  });
});

describe('original local background music', () => {
  it('chooses by explicit mood and product keywords and preserves manual selection', () => {
    expect(selectedMusic(DEFAULTS)).toBe('upbeat');
    expect(selectedMusic({ ...DEFAULTS, title: 'Luxury watch' })).toBe('luxury');
    expect(selectedMusic({ ...DEFAULTS, title: 'Spa candle' })).toBe('relaxing');
    expect(selectedMusic({ ...DEFAULTS, title: 'Fitness shoes' })).toBe('energetic');
    expect(selectedMusic({ ...DEFAULTS, musicStyle: 'mute' })).toBe('mute');
    expect(selectedMusic({ ...DEFAULTS, musicStyle: undefined })).toBe('mute');
  });
  it.each(['upbeat', 'luxury', 'energetic', 'relaxing'] as const)('creates audible bounded 15-second %s music with smooth fades', style => {
    const audio = composeMusic(style, 0.3);
    expect(audio.samples.length).toBe(15 * 44100);
    expect(audio.samples[0]).toBe(0);
    expect(Math.abs(audio.samples.at(-1)!)).toBe(0);
    let peak = 0, power = 0;
    for (const sample of audio.samples) { peak = Math.max(peak, Math.abs(sample)); power += sample * sample; }
    expect(peak).toBeGreaterThan(0.01); expect(peak).toBeLessThan(1);
    expect(Math.sqrt(power / audio.samples.length)).toBeGreaterThan(0.01);
    expect(musicWav(audio).size).toBe(44 + 15 * 44100 * 2);
  });
  it('uses the same fade envelope for imported audio and honors zero volume', () => {
    expect(fadeGain(0, 44100, 44100)).toBe(0);
    expect(fadeGain(44099, 44100, 44100)).toBe(0);
    expect(composeMusic('upbeat', 0).samples.every(value => value === 0)).toBe(true);
    expect(() => composeMusic('upbeat', -1)).toThrow('volume');
  });
});
