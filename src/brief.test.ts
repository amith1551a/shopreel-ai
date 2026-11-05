import { describe, expect, it } from 'vitest';
import { applyBrief, EXAMPLE_BRIEF, planBrief } from './brief';
import { DEFAULTS, DEFAULT_CTA, sceneText, subtitles, validateSettings } from './model';

describe('local explicit brief extraction', () => {
  it('extracts natural prose without an API or invented details', () => {
    const plan = planBrief('Create an ad for my Anime Graphic Tee at USD 24.99. The target audience is anime fans. The problem is boring outfits. The solution is to highlight the artwork. Benefits include a printed design; matching front and back artwork. End with "Visit our store".');
    expect(plan.extracted).toMatchObject({
      product: 'Anime Graphic Tee', price: '24.99', currency: 'USD', audience: 'anime fans',
      problem: 'boring outfits', solution: 'to highlight the artwork',
      benefits: ['a printed design', 'matching front and back artwork'], cta: 'Visit our store',
    });
    expect(plan.extracted.scenes).toEqual([]);
    expect(plan.text).toEqual(['Anime Graphic Tee', 'a printed design']);
  });
  it('extracts labelled scenes and captions from ChatGPT briefs', () => {
    const plan = planBrief('Product: Desk lamp\nPrice: EUR 35.50\nAudience: Students\nProblem: Dark desk\nSolution: Light the desk\nBenefits: Adjustable arm\nScene 1: Product photo\nScene 2: Detail photo\nCaption 1: Your desk, in focus\nCaption 2: See the detail\nCTA: Tap to shop');
    expect(plan.extracted.scenes).toEqual(['Product photo', 'Detail photo']);
    expect(plan.extracted.captions).toEqual(['Your desk, in focus', 'See the detail']);
    expect(plan.text).toEqual(['Your desk, in focus', 'See the detail']);
    expect(plan.extracted).toMatchObject({ price: '35.50', currency: 'EUR', cta: 'Tap to shop' });
  });
  it('reads explicitly supplied multiline bullet benefits and caption lists', () => {
    const plan = planBrief('Product: Desk lamp\nBenefits:\n- Adjustable arm\n- Printed shade\nCaptions: A desk refresh | See the detail\nCTA: Visit our store');
    expect(plan.extracted.benefits).toEqual(['Adjustable arm', 'Printed shade']);
    expect(plan.extracted.captions).toEqual(['A desk refresh', 'See the detail']);
  });
  it('uses the tee example and keeps arbitrary directions out of overlay copy', () => {
    const plan = planBrief(EXAMPLE_BRIEF);
    expect(plan.text).toEqual(['Outfit having an off day?', 'Let the artwork do the talking.']);
    expect(plan.extracted).toMatchObject({ product: 'Anime graphic tee', price: '24.99', currency: 'USD' });
    expect(plan.text.join(' ')).not.toContain('Scene 1');
  });
  it('reports actors, cinematic scenes and duration adaptation explicitly', () => {
    const plan = planBrief('Concept: A comedic 30-second spot.\nCharacters: Jake and Mike.\nScene 1: Jake walks into school wearing a tee.\nDialogue: "Where did you get that?"');
    expect(plan.notices.join(' ')).toContain('Real filmed footage must be uploaded');
    expect(plan.notices.join(' ')).toContain('15 seconds');
    expect(plan.text).toEqual(['Ready for your next find?', 'Take a closer look at the details']);
  });
  it('never invents absent audience, price or benefits', () => {
    const { extracted } = planBrief('Make a cheerful video using this product photo.');
    expect(extracted.price).toBe(''); expect(extracted.audience).toBe(''); expect(extracted.benefits).toEqual([]);
  });
  it('reports ambiguous currencies and multiple offers without silently choosing', () => {
    expect(planBrief('Price: $29.99').notices.join(' ')).toContain('ambiguous');
    expect(planBrief('Price: $29.99').extracted.currency).toBe('');
    expect(planBrief('Was USD 39.99, now USD 29.99.').extracted.price).toBe('');
    expect(planBrief('Was USD 39.99, now USD 29.99.').notices.join(' ')).toContain('Multiple prices');
    expect(planBrief('Price: EUR 29,99').extracted.price).toBe('');
    expect(planBrief('Price: USD 1,299.99').extracted.price).toBe('1299.99');
  });
  it('does not silently round invalid currency precision', () => {
    const settings = applyBrief(DEFAULTS, 'Product: Tee\nPrice: USD 1.234');
    expect(() => validateSettings(settings)).toThrow('decimal places');
  });
  it('does not misread exponents or negative numbers as a cheaper valid price', () => {
    for (const value of ['USD 1e3', '-5 USD', 'USD 12.34.56']) {
      expect(planBrief(`Price: ${value}`).extracted.price).toBe('');
      expect(planBrief(`Price: ${value}`).notices.join(' ')).toContain('price');
    }
    expect(planBrief('The item costs 24.99 US dollars.').extracted).toMatchObject({ price: '24.99', currency: 'USD' });
  });
  it('rejects overlong prompts and overlays rather than truncating', () => {
    expect(() => validateSettings(applyBrief(DEFAULTS, 'Hook: ' + 'x'.repeat(81)))).toThrow();
    expect(() => validateSettings({ ...DEFAULTS, prompt: 'x'.repeat(12001) })).toThrow();
  });
});
describe('overrides, saved projects and output copy', () => {
  it('keeps edits on prompt changes and resets explicitly', () => {
    const prompt = 'Product: Tee\nPrice: EUR 25.99\nCTA: Visit our store';
    const settings = applyBrief({ ...DEFAULTS, price: '12.30', currency: 'GBP', cta: '', overrideFields: ['price', 'currency', 'cta'] }, prompt);
    expect(settings).toMatchObject({ price: '12.30', currency: 'GBP', cta: '' });
    expect(applyBrief(settings, prompt, true)).toMatchObject({ price: '25.99', currency: 'EUR', cta: 'Visit our store', overrideFields: [] });
  });
  it('passes extracted or edited copy consistently to cards and subtitles', () => {
    const settings = applyBrief(DEFAULTS, 'Product: Tee\nPrice: USD 24.99\nHook: Your next tee\nDetail: See the artwork\nCaption: Your style\nCTA: Tap to shop');
    expect(sceneText(settings)).toEqual(['Your next tee', 'Tee', 'See the artwork', 'USD 24.99\nTap to shop']);
    expect(subtitles(settings)).toContain('Your style');
    expect(subtitles(settings)).toContain('USD 24.99\nTap to shop');
    expect(sceneText({ ...settings, salesCopy: ['Custom intro', 'Tee', 'Custom detail'] })[2]).toBe('Custom detail');
  });
  it('keeps defaults when absent and reads existing pre-prompt settings unchanged', () => {
    expect(applyBrief(DEFAULTS, 'Product: Tee').cta).toBe(DEFAULT_CTA);
    expect(sceneText({ ...DEFAULTS, prompt: undefined, storyboard: undefined, title: 'Old tee', promo: 'Old copy' }).slice(0, 3)).toEqual(['Old tee', 'Old tee', 'Old copy']);
  });
});
