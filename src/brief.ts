import { DEFAULT_CTA, type Settings } from './model';

export const EXAMPLE_BRIEF = `Create a playful 15-second vertical photo ad for a product called "Anime graphic tee", priced at USD 24.99. The target audience is anime fans.
The problem is an outfit that feels uninspired. The solution is to make the tee the focus of the outfit.
Concept: A light, self-aware outfit-upgrade story inspired by a friend's great find.
Hook: Outfit having an off day?
Detail: Let the artwork do the talking.
Scene 1: Show the front product photo.
Scene 2: Show the back or artwork reference if supplied.
Scene 3: Show the artwork and supplied value copy.
Scene 4: End on the original product photo with the price and buying action.
Benefits: Anime graphic artwork
Call to action: Shop now - link in bio.
Use quick photo transitions and upbeat instrumental music.
Do not invent fabric claims, reviews, discounts, brand logos or unseen product views.`;

export const CHATGPT_INSTRUCTIONS = `Write one copy-and-paste creative brief for a 15-second vertical photo advertisement.
My product: [describe product]
Price and currency: [actual price and currency, or leave out]
Audience: [intended audience]
Concept: [story or mood]
Available photos: [front, back, side, detail]
Verified benefits: [only facts I can support, or none]
Call to action: [what viewers should do]

Include those explicit details in natural language. For precise short on-screen copy, include Hook: (max 80 characters), Detail: (max 140 characters), and optionally Caption: (max 90 characters). Use four beats: hook 0-3s, product 3-7s, value 7-11s, price/CTA 11-15s. You can include Scene 1: through Scene 4: to describe photo choices. Include an Offer: only if genuinely available.
The app uses local rules, not an LLM: do not rely on it inferring missing details. Price, currency and CTA can be corrected in optional overrides.
Adapt my idea to supplied product photos with animated captions and transitions. Do not invent actors, dialogue, new locations, human movement, claims, logos or functioning links. Real actors or cinematic action would need uploaded filmed footage; the current editor only accepts photos. Built-in original instrumental music is available, but no voiceover.`;

export interface ExtractedBrief {
  product: string; price: string; currency: string; audience: string;
  problem: string; solution: string; benefits: string[];
  scenes: string[]; captions: string[]; cta: string; hook: string; detail: string; offer: string;
}
export interface BriefPlan {
  text: [string, string]; notices: string[]; extracted: ExtractedBrief;
}
function clean(value: string) { return value.trim().replace(/^["“']|["”']$/g, '').trim(); }
function sentence(value: string) { return clean(value.replace(/[.!]\s*$/, '')); }
export function planBrief(prompt: string): BriefPlan {
  const notices: string[] = [];
  const labeled = (labels: string) => {
    const values: string[] = [];
    const lines = prompt.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const match = new RegExp(`^\\s*(?:[-*•]\\s*)?(?:${labels})\\s*:\\s*(.*)$`, 'i').exec(lines[index]);
      if (!match) continue;
      const parts = [match[1].trim()].filter(Boolean);
      if (!parts.length) {
        while (index + 1 < lines.length && lines[index + 1].trim() && !/^\s*(?:[-*•]\s*)?[\w -]+\s*:/.test(lines[index + 1])) {
          parts.push(lines[++index].trim().replace(/^[-*•]\s*/, ''));
        }
      }
      if (parts.length) values.push(clean(parts.join('; ')));
    }
    return values;
  };
  const first = (labels: string) => {
    const values = labeled(labels);
    if (new Set(values).size > 1) notices.push(`Conflicting ${labels.split('|')[0]} entries: the first is shown. Correct it in optional overrides.`);
    return values[0] ?? '';
  };
  const prose = (pattern: RegExp) => sentence(pattern.exec(prompt)?.[1] ?? '');
  const product = first('Product(?: name)?|Product title') || prose(/\b(?:product|tee|shirt|item)\s+(?:called|named)\s+["“]([^"”\n]+)["”]/i)
    || prose(/\b(?:product name is|product is)\s+([^.!?\n]+)/i)
    || prose(/\b(?:ad|advertisement|video|reel)\s+for\s+(?:my|our|the|a|an)\s+(.+?)(?=,\s*(?:priced|target)|\s+(?:priced at|at\s+(?:[A-Z]{3}\s*\d|[$€£₹¥]\s*\d))|[.!?\n]|$)/i);
  const audience = first('Target audience|Audience') || prose(/\b(?:target audience|target customer)s?\s+(?:is|are)\s+([^.!?\n]+)/i)
    || prose(/\b(?:targeting|aimed at|intended for)\s+([^.!?\n]+)/i);
  const problem = first('Problem') || prose(/\b(?:the\s+)?problem\s+is\s+([^.!?\n]+)/i);
  const solution = first('Solution') || prose(/\b(?:the\s+)?solution\s+is\s+([^.!?\n]+)/i);
  const benefitText = first('Benefits?|Verified benefits?') || prose(/\b(?:the\s+)?benefits?\s+(?:is|are|include)\s+([^.!?\n]+)/i);
  const benefits = benefitText ? benefitText.split(/\s*;\s*/).filter(Boolean) : [];
  const scenes = labeled('Scene\\s*\\d+(?:\\s*\\([^)]*\\))?');
  if (!scenes.length) {
    for (const line of prompt.split(/\r?\n/)) {
      if (/^\s*\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(line)) scenes.push(line.trim());
    }
  }
  const captions = labeled('Caption(?:\\s*\\d+)?|On-screen text(?:\\s*\\d+)?');
  const captionList = first('Captions');
  if (captionList) captions.push(...captionList.split(/\s*\|\s*|\s*;\s*/).map(clean).filter(Boolean));
  for (const match of prompt.matchAll(/\b(?:caption|on-screen text)\s+(?:reads?|says?|is)\s*["“]([^"”\n]+)["”]/gi)) captions.push(clean(match[1]));
  if (captions.length > 3) notices.push('Only the first three short caption texts can fit this 15-second photo template. Extra captions are retained in the prompt, not rendered.');
  const hook = first('Hook|Opening overlay');
  const detail = first('Detail|Detail overlay');
  const offer = first('Offer|Verified offer|Verified discount');
  const cta = first('Call to action|CTA') || prose(/\b(?:call to action|CTA)\s+(?:is|should be)\s*["“]([^"”\n]+)["”]/i)
    || prose(/\b(?:end|finish|close)\s+with\s*["“]([^"”\n]+)["”]/i)
    || prose(/\b(?:call to action|CTA)\s+(?:is|should be)\s+([^.!?\n]+)/i);
  const currencyAliases: Record<string, string> = { 'US DOLLARS': 'USD', 'US DOLLAR': 'USD', EUROS: 'EUR', EURO: 'EUR', 'BRITISH POUNDS': 'GBP', 'INDIAN RUPEES': 'INR', 'JAPANESE YEN': 'JPY', 'CANADIAN DOLLARS': 'CAD', 'AUSTRALIAN DOLLARS': 'AUD', 'KUWAITI DINARS': 'KWD' };
  const rawCurrency = first('Currency').toUpperCase();
  const currencyLabel = currencyAliases[rawCurrency] || rawCurrency;
  const priceLabel = first('Price');
  const candidates: { price: string; currency: string }[] = [];
  const money = /(?:\b(USD|EUR|GBP|CAD|AUD|INR|JPY|KWD)\s*([$€£₹¥])?\s*(\d[\d,]*(?:\.\d+)?)|([$€£₹¥])\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(USD|EUR|GBP|CAD|AUD|INR|JPY|KWD)\b)/gi;
  const symbolCurrency: Record<string, string> = { '€': 'EUR', '£': 'GBP', '₹': 'INR' };
  // Currency symbols $ and ¥ alone do not identify a country; preserve that ambiguity.
  const moneySource = priceLabel || prompt;
  for (const match of moneySource.matchAll(money)) {
    const tail = moneySource.slice((match.index ?? 0) + match[0].length);
    if (/^\w|^[,.]\d/.test(tail) || moneySource[(match.index ?? 0) - 1] === '-') {
      notices.push('Malformed monetary amount in the brief. Enter a plain positive decimal price in overrides.');
      continue;
    }
    const symbol = match[2] || match[4] || '';
    const currency = (match[1] || match[7] || currencyLabel || symbolCurrency[symbol] || '').toUpperCase();
    candidates.push({ price: match[3] || match[5] || match[6], currency });
    if (!currency) notices.push(`Currency symbol ${symbol} is ambiguous. Select the intended currency in overrides; the current default is USD.`);
  }
  for (const [words, currency] of Object.entries(currencyAliases)) {
    const match = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s+${words}\\b`, 'i').exec(moneySource);
    if (match) candidates.push({ price: match[1], currency });
  }
  const plainPrice = priceLabel || prose(/\b(?:price is|priced at|costs)\s+(\d+(?:\.\d+)?)(?=[\s,.!?]|$)/i);
  let price = candidates[0]?.price ?? (/^\d+(?:\.\d+)?$/.test(plainPrice) ? plainPrice : '');
  let currency = currencyLabel || candidates[0]?.currency || '';
  if (new Set(candidates.map(value => `${value.currency}:${value.price}`)).size > 1) {
    notices.push('Multiple prices or currencies found. No price was selected; enter the intended price and currency in overrides.');
    price = ''; currency = currencyLabel;
  }
  if (price.includes(',')) {
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(price)) price = price.replace(/,/g, '');
    else { price = ''; notices.push('Ambiguous decimal/comma price. Enter a plain decimal price in overrides.'); }
  }
  if (priceLabel && !price) notices.push('The supplied price could not be read unambiguously. Correct it in optional overrides.');
  if (!price && /(?:priced at|price is|costs)\s*-|(?:USD|EUR|GBP)\s*-/i.test(prompt)) notices.push('Invalid negative price in the brief. Enter a valid positive price in overrides.');
  const text: [string, string] = [hook || captions[0] || product || 'Ready for your next find?', detail || captions[1] || benefits[0] || solution || 'Take a closer look at the details'];
  if (text[0].length > 80 || text[1].length > 140 || captions.some(caption => caption.length > 90)) notices.push('Extracted copy is too long for readable overlays. Shorten it before generating.');
  if (!product && !hook && !captions.length) notices.push('No explicit product name or opening caption recognized. Edit the neutral opening placeholder or provide a product name.');
  const duration = /\b(\d+)\s*[- ]?\s*seconds?\b/i.exec(prompt);
  if ((duration && Number(duration[1]) !== 15) || /0:30|00:30/.test(prompt)) notices.push('The requested duration differs from this renderer: the output is fixed at 15 seconds. Review the shortened storyboard.');
  const actionRequest = prompt.split(/[\n.!?]+/).filter(part => !/^\s*(?:constraints?:|do not|never|no\b|without\b|avoid\b)/i.test(part.trim())).join(' ');
  if (/\bactors?|characters?|dialogue|voiceover|cinematic|walks?|walking|wearing|changes?\s+shirts?|Jake|Mike\b/i.test(actionRequest)) notices.push('This script requests actors, dialogue or cinematic action. Real filmed footage must be uploaded to a footage-capable editor for those shots. This editor currently accepts photos only and will NOT create those scenes or voices.');
  if (scenes.length > 4) notices.push('More than four scenes requested. Four sales beats (3/4/4/4 seconds) are rendered; the full scene list is retained for review.');
  if (!benefits.length && !detail && !solution) notices.push('No supplied benefit or value detail found. Add one you can support; the app will not invent a reason to buy.');
  if (offer) notices.push('Offer copied from your brief, not independently verified. Confirm its accuracy and any conditions before posting.');
  notices.push('Rule-based local extraction, not an LLM. Only explicit supported wording is recognized; verify every extracted detail. Unrecognized directions stay in your saved prompt.');
  notices.push('Photo-based rendering only: no AI-generated footage, actors, speech or inferred views. Built-in original instrumental music is selected locally; template animations do not execute arbitrary cinematic directions.');
  return { text, notices, extracted: { product, price, currency, audience, problem, solution, benefits, scenes, captions, cta, hook, detail, offer } };
}
export type OverrideField = NonNullable<Settings['overrideFields']>[number];
export function isOverrideField(key: keyof Settings): key is OverrideField {
  return ['title', 'promo', 'price', 'currency', 'cta', 'caption', 'audience', 'problem', 'solution', 'benefits', 'scenes', 'offer'].includes(key);
}
export function refreshSales(settings: Settings): Settings {
  const extracted = planBrief(settings.prompt ?? '').extracted;
  const value = settings.benefits?.split(/\s*;\s*/).filter(Boolean).slice(0, 2).join(' · ')
    || settings.promo || settings.solution || 'Take a closer look at the details';
  const problem = settings.problem?.replace(/[.!?]+$/, '');
  const hooks = {
    problem: problem ? `${problem.charAt(0).toUpperCase()}${problem.slice(1)}?` : 'Ready for your next find?',
    benefits: settings.title ? `Why choose ${settings.title}?` : 'What matters in your next find?',
    lifestyle: settings.audience ? `For ${settings.audience}` : 'Find what feels like you.',
  };
  const salesCopy: [string, string, string] = [
    extracted.hook || extracted.captions[0] || hooks[settings.variation ?? 'problem'],
    settings.title || 'See the product',
    settings.overrideFields?.includes('promo') ? settings.promo || 'Take a closer look at the details' : value,
  ];
  // Explicit hooks remain authoritative in the default version; variations change only the hook.
  if (settings.variation && settings.variation !== 'problem') salesCopy[0] = hooks[settings.variation];
  for (const index of settings.salesOverrides ?? []) if (index >= 0 && index < 3 && settings.salesCopy) salesCopy[index] = settings.salesCopy[index];
  return { ...settings, salesCopy };
}
export function applyBrief(settings: Settings, prompt: string, resetOverrides = false): Settings {
  const plan = planBrief(prompt), extracted = plan.extracted;
  const next = {
    ...settings, prompt, storyboard: plan.text,
    title: extracted.product, promo: extracted.detail || extracted.benefits[0] || extracted.solution,
    price: extracted.price, currency: extracted.currency || 'USD', cta: extracted.cta || DEFAULT_CTA, offer: extracted.offer,
    caption: (extracted.hook || extracted.detail ? extracted.captions[0] : extracted.captions[2]) || '',
    audience: extracted.audience, problem: extracted.problem, solution: extracted.solution,
    benefits: extracted.benefits.join('; '), scenes: extracted.scenes.join('\n'),
    overrideFields: resetOverrides ? [] : settings.overrideFields ?? [],
    salesOverrides: resetOverrides ? [] : settings.salesOverrides ?? [],
  };
  for (const key of next.overrideFields) next[key] = settings[key] ?? '';
  if (next.overrideFields.includes('title')) next.storyboard[0] = next.title || 'Ready for your next find?';
  if (next.overrideFields.includes('promo')) next.storyboard[1] = next.promo || 'Take a closer look';
  return refreshSales(next);
}
