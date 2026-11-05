export const FPS = 24;
export const SECONDS = 15;
export const FRAMES = FPS * SECONDS;
export const RESOLUTIONS = {
  '480p': { width: 480, height: 854, budgetMB: 256, kbps: 1400 },
  '720p': { width: 720, height: 1280, budgetMB: 384, kbps: 2400 },
  '1080p': { width: 1080, height: 1920, budgetMB: 640, kbps: 4200 },
} as const;
export type Resolution = keyof typeof RESOLUTIONS;
export const TEMPLATES = {
  studio: { name: 'Warm studio', background: '#f5eee2', ink: '#163d33', accent: '#c24f35', pale: '#e7dcc9' },
  midnight: { name: 'After hours', background: '#15263b', ink: '#f6f1e7', accent: '#abe0b5', pale: '#263d55' },
  pop: { name: 'Graphic pop', background: '#f7d95d', ink: '#252136', accent: '#8437ac', pale: '#eed4ee' },
} as const;
export type Template = keyof typeof TEMPLATES;
export const DEFAULT_CTA = 'Shop now — link in bio.';
export const CURRENCIES: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, INR: 2, JPY: 0, KWD: 3 };
export const VARIATIONS = { problem: 'Problem → Solution → Buy', benefits: 'Product Benefits → Buy', lifestyle: 'Lifestyle / Emotional → Buy' } as const;
export const SCENES = [
  { start: 0, end: 3, name: 'HOOK' }, { start: 3, end: 7, name: 'PRODUCT' },
  { start: 7, end: 11, name: 'VALUE' }, { start: 11, end: 15, name: 'CTA' },
] as const;
export const MUSIC_STYLES = ['upbeat', 'luxury', 'energetic', 'relaxing'] as const;
export type MusicStyle = typeof MUSIC_STYLES[number];
export interface Settings {
  prompt?: string; storyboard?: [string, string];
  salesCopy?: [string, string, string]; salesOverrides?: number[];
  variation?: keyof typeof VARIATIONS; musicStyle?: 'auto' | 'mute' | 'upload' | MusicStyle;
  accent?: string; offer?: string;
  overrideFields?: ('title' | 'promo' | 'price' | 'currency' | 'cta' | 'caption' | 'audience' | 'problem' | 'solution' | 'benefits' | 'scenes' | 'offer')[];
  audience?: string; problem?: string; solution?: string; benefits?: string; scenes?: string;
  title: string; promo: string; caption: string; price: string; currency: string;
  cta: string; brand: string; url: string; template: Template; resolution: Resolution;
  captions: boolean; musicVolume: number; lowImpact: boolean;
}
export const DEFAULTS: Settings = {
  prompt: '',
  variation: 'problem', musicStyle: 'auto', offer: '',
  title: '', promo: '', caption: '', price: '', currency: 'USD', cta: DEFAULT_CTA,
  brand: '', url: '', template: 'studio', resolution: '720p', captions: true, musicVolume: 0.3, lowImpact: true,
};
export interface StoredProject {
  id: string; updatedAt: string; settings: Settings; images: Blob[]; logo?: Blob;
  music?: Blob; video?: Blob; poster?: Blob; subtitles?: string;
  state: 'draft' | 'rendering' | 'completed' | 'cancelled' | 'failed';
  error?: string; metrics?: RenderMetrics; approved?: boolean;
  postPlan?: { channel: string; time: string };
}
export interface RenderMetrics {
  renderMs: number; width: number; height: number; fps: number; duration: number;
  frames: number; outputBytes: number; workerHeapBytes: number | null; wasmMemoryBytes: number;
  memoryBudgetMB: number; audio: boolean; encoder: string;
}
export interface RenderRequest {
  settings: Settings; images: ImageBitmap[]; logo?: ImageBitmap;
  audio?: { samples: Float32Array; sampleRate: number };
}
export type WorkerReply =
  | { type: 'progress'; progress: number; stage: string; heapBytes: number | null }
  | { type: 'done'; video: ArrayBuffer; poster: Blob; metrics: RenderMetrics }
  | { type: 'error'; error: string };
export interface Device { memoryGB?: number; cores: number; availableMB?: number }

export function formatPrice(value: string, currency: string) {
  const places = CURRENCIES[currency];
  if (places === undefined || !/^\d{1,9}(?:\.\d{1,3})?$/.test(value)) throw new Error('Enter a plain positive price without symbols or exponents.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) throw new Error(`${currency} allows at most ${places} decimal places.`);
  const minor = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
  if (minor <= 0n || minor > 999999999n * 10n ** BigInt(places)) throw new Error('Price must be positive and no greater than 999,999,999.');
  return `${currency} ${BigInt(whole).toLocaleString('en-US')}${places ? '.' + fraction.padEnd(places, '0') : ''}`;
}
export function validateSettings(settings: Settings) {
  if (settings.prompt !== undefined && (settings.prompt.length > 12000 || Array.from(settings.prompt).some(char => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char)))) throw new Error('Video prompt is invalid or longer than 12,000 characters.');
  if (settings.storyboard !== undefined && (settings.storyboard.length !== 2 || settings.storyboard.some((text, index) => typeof text !== 'string' || !text.trim() || text.length > (index === 0 ? 80 : 140)))) throw new Error('Storyboard needs opening text (1-80 characters) and detail text (1-140 characters).');
  if (settings.salesCopy && (settings.salesCopy.length !== 3 || settings.salesCopy.some((text, i) => !text.trim() || text.length > (i < 2 ? 80 : 140) || Array.from(text).some(char => char.charCodeAt(0) < 32)))) throw new Error('Sales storyboard needs a hook and product (1-80 characters each), and value copy (1-140 characters). Shorten supplied copy before rendering.');
  if (settings.variation && !(settings.variation in VARIATIONS)) throw new Error('Choose a supported sales variation.');
  if (settings.musicStyle && !['auto', 'mute', 'upload', ...MUSIC_STYLES].includes(settings.musicStyle)) throw new Error('Choose a supported music style.');
  if (settings.accent && !/^#[0-9a-f]{6}$/i.test(settings.accent)) throw new Error('Choose a valid brand color.');
  if (settings.offer && (settings.offer.length > 80 || Array.from(settings.offer).some(char => char.charCodeAt(0) < 32))) throw new Error('Offer must be at most 80 characters without control characters.');
  if (!(settings.currency in CURRENCIES)) throw new Error('Choose a supported currency.');
  const limits = { title: 80, promo: 140, caption: 90, cta: 80, brand: 50, url: 500 } as const;
  for (const [key, limit] of Object.entries(limits)) {
    const text = settings[key as keyof typeof limits];
    if (text.length > limit || Array.from(text).some(char => char.charCodeAt(0) < 32 && !['\n', '\t'].includes(char))) throw new Error(`${key} is invalid or longer than ${limit} characters.`);
  }
  for (const key of ['audience', 'problem', 'solution', 'benefits', 'scenes'] as const) {
    if ((settings[key]?.length ?? 0) > 4000) throw new Error(`${key} is longer than 4,000 characters.`);
  }
  if (!(settings.template in TEMPLATES) || !(settings.resolution in RESOLUTIONS)) throw new Error('Choose a supported template and resolution.');
  if (!Number.isFinite(settings.musicVolume) || settings.musicVolume < 0 || settings.musicVolume > 1) throw new Error('Music volume must be between zero and one.');
  if (settings.price.trim()) formatPrice(settings.price, settings.currency);
  if (settings.url) {
    const url = new URL(settings.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Product URL must be HTTPS without credentials; it is saved, never fetched.');
  }
}
export function resourceCheck(resolution: Resolution, device: Device) {
  const budget = RESOLUTIONS[resolution].budgetMB;
  if (device.availableMB !== undefined && device.availableMB < budget) throw new Error(`Insufficient memory headroom for ${resolution}. Close tabs or choose 480p.`);
  if (device.memoryGB !== undefined && device.memoryGB < 2) throw new Error('At least 2 GB device memory is recommended. Close other apps and use a more capable device.');
  if (resolution === '720p' && device.memoryGB !== undefined && device.memoryGB < 4) throw new Error('Choose 480p on a device with less than 4 GB reported memory.');
  if (resolution === '1080p' && (!(device.memoryGB && device.memoryGB >= 8) || device.cores < 4)) throw new Error('1080p requires at least 8 GB reported device memory and 4 logical cores. Use 720p or 480p.');
  return budget;
}
export function sceneText(settings: Settings) {
  return [
    settings.salesCopy?.[0] ?? (settings.storyboard?.[0].trim() || settings.title.trim() || 'Ready for your next find?'),
    settings.salesCopy?.[1] ?? (settings.title.trim() || 'See the product'),
    settings.salesCopy?.[2] ?? (settings.storyboard?.[1].trim() || settings.promo.trim() || 'Take a closer look'),
    [settings.price.trim() ? formatPrice(settings.price, settings.currency) : '', settings.offer?.trim(), settings.cta.trim()].filter(Boolean).join('\n') || 'Choose your buying action',
  ];
}
export function sceneAt(seconds: number) { return seconds < 3 ? 0 : seconds < 7 ? 1 : seconds < 11 ? 2 : 3; }
function stamp(seconds: number) { return `00:00:${seconds.toString().padStart(2, '0')},000`; }
export function subtitles(settings: Settings) {
  if (!settings.captions) return '';
  return sceneText(settings).map((text, i) => `${i + 1}\n${stamp(SCENES[i].start)} --> ${stamp(SCENES[i].end)}\n${text}${i === 2 && settings.caption.trim() ? '\n' + settings.caption.trim() : ''}`).join('\n\n') + '\n';
}
export function limitFile(file: Blob, kind: 'image' | 'music') {
  const limit = (kind === 'image' ? 8 : 10) * 1024 * 1024;
  if (!file.size || file.size > limit) throw new Error(`${kind} must be nonempty and below ${kind === 'image' ? 8 : 10} MB.`);
  const accepted = kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg'];
  if (!accepted.includes(file.type)) throw new Error(`Unsupported ${kind} file type.`);
}
