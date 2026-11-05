import { useEffect, useMemo, useRef, useState } from 'react';
import { CURRENCIES, DEFAULTS, DEFAULT_CTA, MUSIC_STYLES, SCENES, VARIATIONS, TEMPLATES, resourceCheck, sceneText, subtitles, validateSettings, type RenderMetrics, type Settings, type StoredProject, type WorkerReply } from './model';
import { listProjects, saveProject } from './storage';
import { inspectImage, prepareAudio, verifyVideo } from './media';
import { acquireRenderLease } from './lease';
import { CHATGPT_INSTRUCTIONS, EXAMPLE_BRIEF, applyBrief, isOverrideField, planBrief, refreshSales } from './brief';
import StoryboardPreview from './StoryboardPreview';
import { HiggsFieldWorkflow } from './HiggsFieldWorkflow';
import { composeMusic, musicWav, selectedMusic } from './music';

type DeviceNavigator = Navigator & { deviceMemory?: number };
type LegacyVideo = { id: string; title: string; caption: string; status: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Unexpected browser error.';
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const value = URL.createObjectURL(blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}
function Preview({ project }: { project: StoredProject }) {
  const video = useBlobUrl(project.video), poster = useBlobUrl(project.poster);
  const subtitleBlob = useMemo(() => project.subtitles ? new Blob([project.subtitles], { type: 'application/x-subrip' }) : undefined, [project.subtitles]);
  const srt = useBlobUrl(subtitleBlob);
  return <div className="preview-result">
    {video && <video controls playsInline preload="metadata" src={video} poster={poster || undefined} aria-label="Generated advertisement" />}
    <div className="download-row">
      {video && <a className="button" download={`shopreel-${project.id}.mp4`} href={video}>Download MP4</a>}
      {srt && <a className="secondary button" download={`shopreel-${project.id}.srt`} href={srt}>Download subtitles</a>}
    </div>
    <p className="muted">Animated photo template. Review artwork, wording and music rights before posting. No automatic publishing.</p>
    {project.metrics && <Metrics value={project.metrics} />}
  </div>;
}
function Metrics({ value }: { value: RenderMetrics }) {
  return <dl className="metrics" data-testid="metrics">
    <div><dt>Render time</dt><dd>{(value.renderMs / 1000).toFixed(1)} s</dd></div>
    <div><dt>Output</dt><dd>{value.width} × {value.height} / {value.fps} FPS</dd></div>
    <div><dt>File size</dt><dd>{(value.outputBytes / 1024 / 1024).toFixed(2)} MB</dd></div>
    <div><dt>Memory guard</dt><dd>{value.memoryBudgetMB} MB budget</dd></div>
    <div><dt>Worker JS heap</dt><dd>{value.workerHeapBytes ? `${(value.workerHeapBytes / 1024 / 1024).toFixed(1)} MB observed` : 'Not exposed by this browser'}</dd></div>
    <div><dt>Encoder WASM memory</dt><dd>{(value.wasmMemoryBytes / 1024 / 1024).toFixed(1)} MB peak allocated</dd></div>
    <div><dt>Audio</dt><dd>{value.audio ? 'Software MP3 in MP4' : 'Silent by choice'}</dd></div>
  </dl>;
}
function Photo({ image, index }: { image: Blob; index: number }) {
  const url = useBlobUrl(image);
  return <img src={url || undefined} alt={`Product reference ${index + 1}`} />;
}
function MusicPreview({ settings, upload }: { settings: Settings; upload?: Blob }) {
  const [sample, setSample] = useState<Blob>();
  const [error, setError] = useState('');
  const style = selectedMusic(settings), url = useBlobUrl(style === 'upload' ? upload : sample);
  return <div>
    {style !== 'mute' && style !== 'upload' && <button className="text-button" onClick={() => {
      try { setSample(musicWav(composeMusic(style, settings.musicVolume))); setError(''); }
      catch (e) { setError(errorText(e)); }
    }}>Preview music</button>}
    {url && <audio controls src={url} aria-label="Music preview" />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
export default function App() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS });
  const [images, setImages] = useState<Blob[]>([]);
  const [logo, setLogo] = useState<Blob>();
  const [music, setMusic] = useState<Blob>();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [current, setCurrent] = useState<StoredProject>();
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [state, setState] = useState('Ready to create');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [legacy, setLegacy] = useState<LegacyVideo[]>([]);
  const [legacyError, setLegacyError] = useState('');
  const [librarySaving, setLibrarySaving] = useState(false);
  const [tab, setTab] = useState<'create' | 'library' | 'higgsfield'>('create');
  const [acknowledged, setAcknowledged] = useState(false);
  const worker = useRef<Worker | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const active = useRef<StoredProject | null>(null);
  const releaseLease = useRef<(() => void) | null>(null);
  const rejectRender = useRef<((error: Error) => void) | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(previous => {
      const next = { ...previous, [key]: value };
      if (isOverrideField(key)) {
        next.overrideFields = [...new Set([...(previous.overrideFields ?? []), key])];
        if (key === 'title') next.salesOverrides = previous.salesOverrides?.filter(i => i !== 1);
        if (key === 'promo' || key === 'benefits' || key === 'solution') next.salesOverrides = previous.salesOverrides?.filter(i => i !== 2);
      }
      if (key === 'variation') next.salesOverrides = previous.salesOverrides?.filter(i => i !== 0);
      return refreshSales(next);
    }); setAcknowledged(false);
  };
  function changePrompt(prompt: string) {
    setSettings(previous => applyBrief(previous, prompt));
    setAcknowledged(false);
  }
  function editScene(index: number, text: string) {
    setSettings(previous => {
      const current = sceneText(previous);
      const salesCopy: [string, string, string] = [current[0], current[1], current[2]];
      salesCopy[index] = text;
      return { ...previous, salesCopy, salesOverrides: [...new Set([...(previous.salesOverrides ?? []), index])] };
    });
    setAcknowledged(false);
  }
  const refresh = async () => setProjects(await listProjects());
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await listProjects();
        const lease = await new Promise<(() => void) | null>((resolve, reject) => {
          if (!navigator.locks) { resolve(null); return; }
          void navigator.locks.request('shopreel-cpu-render', { ifAvailable: true }, lock => {
            if (!lock) { resolve(null); return; }
            return new Promise<void>(release => resolve(release));
          }).catch(reject);
        });
        if (lease) {
          try {
            for (const project of saved.filter(p => p.state === 'rendering')) {
              project.state = 'failed'; project.error = 'Rendering was interrupted by a refresh or closed tab. Restart explicitly; no charges apply.';
              await saveProject(project);
            }
          } finally { lease(); }
        }
        if (alive) { setProjects(saved); setReady(true); }
      } catch (e) { if (alive) setError(errorText(e)); }
    })();
    const workerRef = worker, leaseRef = releaseLease;
    return () => { alive = false; workerRef.current?.terminate(); leaseRef.current?.(); };
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (locked.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  function snapshot(): StoredProject {
    return { id: projects.some(p => p.id === id && p.video) ? crypto.randomUUID() : id, updatedAt: new Date().toISOString(), settings: { ...settings }, images, logo, music, state: 'draft' };
  }
  async function saveDraft() {
    setError(''); setNotice('');
    try { validateSettings(settings); const project = snapshot(); await saveProject(project); setId(project.id); await refresh(); setNotice('Project saved on this browser.'); }
    catch (e) { setError(errorText(e)); }
  }
  async function upload(files: FileList | null, kind: 'product' | 'logo') {
    setError(''); setNotice('');
    if (!files?.length) return;
    if (kind === 'product' && files.length > 4) { setError('Choose at most four photos.'); return; }
    try {
      const chosen = Array.from(files);
      for (const file of chosen) { const image = await inspectImage(file); image.close(); }
      if (kind === 'product') { setImages(chosen); setAcknowledged(false); }
      else setLogo(chosen[0]);
    } catch (e) { setError(errorText(e)); }
  }
  async function render() {
    if (locked.current) return;
    locked.current = true; const token = ++generation.current;
    setBusy(true); setError(''); setNotice(''); setProgress(0); setState('Queued');
    let project: StoredProject | undefined;
    const bitmaps: ImageBitmap[] = [];
    let logoBitmap: ImageBitmap | undefined;
    try {
      validateSettings(settings);
      if (!settings.prompt?.trim()) throw new Error('Paste a video prompt before generating. Use the example if you need a starting point.');
      if (!ready) throw new Error('Browser storage is not ready.');
      if (!images.length) throw new Error('Upload a product photo first.');
      if (!acknowledged) throw new Error('Review the four-scene plan and confirm local rendering.');
      if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap || !window.WebAssembly) throw new Error('This browser lacks required worker, canvas or WASM support. Use current Chrome or Edge.');
      const memory = (performance as Performance & { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory;
      resourceCheck(settings.resolution, {
        cores: navigator.hardwareConcurrency || 2, memoryGB: (navigator as DeviceNavigator).deviceMemory,
        availableMB: memory ? (memory.jsHeapSizeLimit - memory.usedJSHeapSize) / 1024 / 1024 : undefined,
      });
      const release = await acquireRenderLease();
      if (token !== generation.current) { release(); return; }
      releaseLease.current = release;
      project = { ...snapshot(), state: 'rendering' }; active.current = project;
      setId(project.id);
      await saveProject(project); await refresh();
      if (token !== generation.current) return;
      for (const image of images) {
        bitmaps.push(await inspectImage(image));
        if (token !== generation.current) return;
      }
      if (logo) logoBitmap = await inspectImage(logo);
      const musicChoice = selectedMusic(settings);
      if (musicChoice === 'upload' && !music) throw new Error('Upload your licensed music or select a built-in style.');
      setState(musicChoice === 'upload' ? 'Preparing local music' : 'Loading software encoder');
      const audio = musicChoice === 'upload' && music && settings.musicVolume > 0 ? await prepareAudio(music, settings.musicVolume) : undefined;
      if (token !== generation.current) return;
      const renderer = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
      worker.current = renderer;
      await new Promise<void>((resolve, reject) => {
        rejectRender.current = reject;
        renderer.onerror = event => reject(new Error(event.message || 'The rendering worker failed to load.'));
        renderer.onmessage = (event: MessageEvent<WorkerReply>) => {
          const message = event.data;
          if (message.type === 'error') { reject(new Error(message.error)); return; }
          if (message.type === 'progress') { setProgress(message.progress); setState(message.stage); return; }
          void (async () => {
            try {
              renderer.terminate(); worker.current = null;
              if (token !== generation.current || !project) { resolve(); return; }
              setProgress(98); setState('Verifying playback and saving');
              const video = new Blob([message.video], { type: 'video/mp4' });
              await verifyVideo(video, message.metrics.width, message.metrics.height);
              if (token !== generation.current) { resolve(); return; }
              const completed: StoredProject = { ...project, video, poster: message.poster, metrics: message.metrics, subtitles: subtitles(settings), state: 'completed', updatedAt: new Date().toISOString() };
              setCurrent(completed); active.current = completed;
              await saveProject(completed); await refresh();
              setProgress(100); setState('Completed'); resolve();
            } catch (e) { reject(e); }
          })();
        };
        const transfer: Transferable[] = [...bitmaps];
        if (logoBitmap) transfer.push(logoBitmap);
        if (audio) transfer.push(audio.samples.buffer);
        renderer.postMessage({ settings, images: bitmaps, logo: logoBitmap, audio }, transfer);
      });
    } catch (e) {
      if (token === generation.current) {
        setError(errorText(e)); setState('Failed');
        if (project) {
          try { await saveProject({ ...project, state: 'failed', error: errorText(e) }); await refresh(); }
          catch (storageError) { setError(`${errorText(e)} ${errorText(storageError)}`); }
        }
      }
    } finally {
      bitmaps.forEach(image => image.close()); logoBitmap?.close();
      if (token === generation.current) { worker.current?.terminate(); worker.current = null; releaseLease.current?.(); releaseLease.current = null; rejectRender.current = null; locked.current = false; setBusy(false); }
    }
  }
  async function cancel() {
    generation.current++; worker.current?.terminate(); worker.current = null;
    rejectRender.current?.(new Error('Rendering cancelled.')); rejectRender.current = null;
    setState('Cancelled'); setProgress(0);
    if (active.current?.state === 'rendering') {
      try { await saveProject({ ...active.current, state: 'cancelled' }); await refresh(); }
      catch (e) { setError(errorText(e)); }
    }
    releaseLease.current?.(); releaseLease.current = null;
    locked.current = false; setBusy(false);
  }
  async function openLibrary() {
    setTab('library');
    try { await refresh(); } catch (e) { setError(errorText(e)); }
  }
  async function readLegacy() {
    setLegacyError('');
    try {
      const response = await fetch('/api/legacy');
      const result = await response.json() as { error?: string; videos?: LegacyVideo[] };
      if (!response.ok || !result.videos) throw new Error(result.error || 'Existing local library is unavailable.');
      setLegacy(result.videos);
      setNotice(`Read ${result.videos.length} existing videos without modifying server files. Existing project settings remain in the original database.`);
    } catch (e) { setLegacyError(errorText(e)); }
  }
  async function updateProject(project: StoredProject, changes: Partial<StoredProject>) {
    const updated = { ...project, ...changes };
    setProjects(previous => previous.map(item => item.id === project.id ? updated : item));
    setLibrarySaving(true);
    try { await saveProject(updated); }
    catch (e) { setProjects(previous => previous.map(item => item.id === project.id ? project : item)); setError(errorText(e)); }
    finally { setLibrarySaving(false); }
  }
  function loadProject(project: StoredProject) {
    const saved = project.settings;
    const oldText = sceneText(saved);
    const compatible: Settings = {
      ...saved, musicStyle: saved.musicStyle ?? (project.music ? 'upload' : 'mute'),
      salesCopy: saved.salesCopy ?? [oldText[0], oldText[1], oldText[2]],
      salesOverrides: saved.salesOverrides ?? (saved.salesCopy ? [] : [0, 2]),
    };
    setId(project.id); setSettings(saved.prompt === undefined ? { ...compatible, prompt: `Hook: ${saved.title || 'Ready for your next find?'}\nDetail: ${saved.promo || saved.title || 'Take a closer look'}` } : compatible); setImages(project.images); setMusic(project.music); setLogo(project.logo);
    setCurrent(project.video ? project : undefined); setState(project.error || project.state); setTab('create'); setAcknowledged(false);
  }
  const plan = (() => { try { return sceneText(settings); } catch { return ['Review your hook', 'Review your product', 'Review your value copy', 'Correct the price in overrides']; } })();
  const brief = useMemo(() => planBrief(settings.prompt ?? ''), [settings.prompt]);
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="wordmark" href="/" aria-label="ShopReel home"><span className="brand-icon">S</span> ShopReel<span className="wordmark-ai">AI</span></a>
      <p className="nav-caption">YOUR CREATIVE WORKSPACE</p>
      <button className={`nav-item ${tab === 'create' ? 'selected' : ''}`} onClick={() => setTab('create')}>✦ <span>Create a video</span></button>
      <button className={`nav-item ${tab === 'higgsfield' ? 'selected' : ''}`} onClick={() => setTab('higgsfield')}>★ <span>AI-Powered Video</span></button>
      <button className={`nav-item ${tab === 'library' ? 'selected' : ''}`} onClick={() => void openLibrary()}>▤ <span>My library</span><span className="count">{projects.length}</span></button>
      <div className="sidebar-bottom"><span className="local-dot" /> Local-first studio<p>Your photos stay on this device.<br />No accounts. No credits. No API keys.</p><span className="edition">BROWSER CPU EDITION</span></div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace <span className="slash">/</span> {tab === 'create' ? 'Create a video' : tab === 'higgsfield' ? 'AI-Powered Video' : 'My library'}</span><span className="device-pill"><span className="local-dot" /> On-device rendering</span></header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">FROM PHOTO TO PRODUCT STORY</p><h1>{tab === 'create' ? 'Make your product the main character.' : tab === 'higgsfield' ? 'AI-Generated Video Scenes' : 'Your creative library.'}</h1><p className="subtitle">{tab === 'create' ? 'Beautiful photo-based ads, made in your browser. You bring the product. We bring the motion.' : tab === 'higgsfield' ? 'Generate AI video scenes using Higgsfield AI. Pay only for what you use.' : 'Beautiful photo-based ads, made in your browser. You bring the product. We bring the motion.'}</p></div><span className="free-badge">{tab === 'higgsfield' ? 'AI-Powered · Pay Per Use' : '100% local · $0 API cost'}</span></div>
        {error && <div role="alert" className="alert">{error}</div>}
        {notice && <div role="status" className="notice">{notice}</div>}
        {tab === 'create' ? <div className="studio-grid">
          <section className="editor">
            <fieldset disabled={busy} className="editor-fields">
              <div className="panel prompt-panel"><div className="section-heading"><span className="step">01</span><h2>Describe your advertisement</h2><span className="required-label">One primary prompt</span></div>
                <label htmlFor="video-prompt">Video prompt</label><textarea id="video-prompt" value={settings.prompt ?? ''} maxLength={12000} rows={10} onChange={e => changePrompt(e.target.value)} placeholder={'e.g. Create a playful photo ad for a product called "Anime graphic tee", priced at USD 24.99. The target audience is anime fans. End with "Tap to shop".'} />
                <p className="help">Describe the complete ad in your own words, or paste a ChatGPT brief. Explicit product, price, audience, problem, solution, benefits, scenes, captions and CTA are extracted locally. Review the results; this is a rule-based parser, not AI language understanding.</p>
                <details><summary>Example: an outfit-upgrade tee ad</summary><pre className="brief-example">{EXAMPLE_BRIEF}</pre><button className="secondary button" onClick={() => changePrompt(EXAMPLE_BRIEF)}>Use this example</button></details>
                <details><summary>Ask ChatGPT for a brief for any product</summary><p className="help">Replace the bracketed parts, paste this into ChatGPT, then paste its answer in Video prompt. ChatGPT is optional and is not connected to this app.</p><textarea aria-label="Reusable ChatGPT instructions" readOnly rows={12} value={CHATGPT_INSTRUCTIONS} onFocus={e => e.currentTarget.select()} /></details>
                <details><summary>Optional editable overrides</summary>
                <p className="help">Values below are filled from your brief when recognized. Editing a field makes it an override that survives prompt changes. Hook, product and value overlays can also be edited in the storyboard.</p>
                <button className="text-button" onClick={() => { setSettings(previous => applyBrief(previous, previous.prompt ?? '', true)); setAcknowledged(false); }}>Reset overrides from prompt</button>
                <label>Product title<input value={settings.title} maxLength={80} onChange={e => change('title', e.target.value)} /></label>
                <label htmlFor="promo-override">Promotional text</label><textarea id="promo-override" value={settings.promo} maxLength={140} rows={2} onChange={e => change('promo', e.target.value)} />
                <p className="help">Only supplied benefits, promotional text or solution are used for value copy. These are not independently verified: confirm every claim. No actors or footage are generated.</p>
                {(['audience', 'problem', 'solution', 'benefits', 'scenes'] as const).map(key => <div key={key}><label htmlFor={`override-${key}`}>{({ audience: 'Target audience', problem: 'Problem', solution: 'Solution', benefits: 'Benefits', scenes: 'Requested scenes' })[key]}</label><textarea id={`override-${key}`} rows={2} maxLength={4000} value={settings[key] ?? ''} onChange={e => change(key, e.target.value)} /></div>)}
                <div className="field-row"><label>Price<input inputMode="decimal" value={settings.price} maxLength={13} onChange={e => change('price', e.target.value)} placeholder="29.00" /></label><div><label htmlFor="currency-override">Currency</label><select id="currency-override" value={settings.currency} onChange={e => change('currency', e.target.value)}>{Object.keys(CURRENCIES).map(currency => <option key={currency}>{currency}</option>)}</select></div></div>
                <label>Verified offer (optional)<input value={settings.offer ?? ''} maxLength={80} onChange={e => change('offer', e.target.value)} placeholder="Only an offer you can honor, including conditions" /></label>
                <label>Call to action<select aria-label="Call to action preset" value={[DEFAULT_CTA, 'Tap to shop', 'Visit our store'].includes(settings.cta) ? settings.cta : 'custom'} onChange={e => change('cta', e.target.value === 'custom' ? '' : e.target.value)}>
                  <option>{DEFAULT_CTA}</option><option>Tap to shop</option><option>Visit our store</option><option value="custom">Custom text</option>
                </select></label>
                <input aria-label="Call to action text" value={settings.cta} maxLength={80} onChange={e => change('cta', e.target.value)} placeholder="Your custom call to action" />
                <p className="help">Tell viewers what to do after watching. Choose wording that matches where you will post.</p>
                </details>
              </div>
              <div className="panel product-panel"><div className="section-heading"><span className="step">02</span><h2>Your product</h2><span className="required-label">Photo required</span></div>
                <input ref={photoInput} id="photos" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => void upload(event.target.files, 'product')} />
                <label htmlFor="photos" className="upload-zone">
                  <span className="upload-symbol">↑</span><strong>{images.length ? `${images.length} product photo${images.length > 1 ? 's' : ''} selected` : 'Give your product the spotlight'}</strong>
                  <span>Choose up to 4 photos · front, back or detail</span><small>JPG, PNG or WebP · 8 MB each · max 20 megapixels</small>
                  <span className="browse-button">Browse photos</span>
                </label>
                {!!images.length && <div className="photo-strip">{images.map((image, index) => <Photo key={index} image={image} index={index} />)}<button className="text-button" onClick={() => { setImages([]); if (photoInput.current) photoInput.current.value = ''; }}>Clear photos</button></div>}
                <p className="privacy-note"><span className="local-dot" /> Private by design. Your media is never uploaded for rendering.</p>
              </div>
              <div className="panel"><div className="section-heading"><span className="step">03</span><h2>Set the mood</h2><span className="required-label">15 seconds · vertical</span></div>
                <div className="templates">{Object.entries(TEMPLATES).map(([key, theme]) => <button key={key} className={`template ${settings.template === key ? 'active' : ''} theme-${key}`} aria-pressed={settings.template === key} onClick={() => change('template', key as Settings['template'])}><span className="template-art"><span>YOUR<br />PRODUCT.</span><i /></span><strong>{theme.name}</strong><small>{key === 'studio' ? 'Clean & timeless' : key === 'midnight' ? 'Bold & cinematic' : 'Bright & playful'}</small></button>)}</div>
                <label htmlFor="sales-variation">Sales variation</label><select id="sales-variation" value={settings.variation ?? 'problem'} onChange={e => change('variation', e.target.value as Settings['variation'])}>{Object.entries(VARIATIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                <p className="help">AIDA/PAS-inspired: attention or problem → product/solution → supplied value → buying action. Variations change the hook, not the facts. Render one version at a time; previous videos stay in your library.</p>
                <label htmlFor="background-music">Background music</label><select id="background-music" value={settings.musicStyle ?? 'mute'} onChange={e => change('musicStyle', e.target.value as Settings['musicStyle'])}>
                  <option value="auto">Auto · {selectedMusic({ ...settings, musicStyle: 'auto' })}</option>
                  {MUSIC_STYLES.map(style => <option key={style} value={style}>{style}</option>)}
                  <option value="upload">My licensed audio</option><option value="mute">Mute / no audio</option>
                </select>
                <p className="help">Original CC0 instrumental motifs made locally, no downloads or paid service. Auto uses explicit mood/product keywords (fallback: upbeat). Music is included in the exported MP4; the visual storyboard is silent.</p>
                <MusicPreview key={`${settings.musicStyle}-${settings.musicVolume}`} settings={settings} upload={music} />
                <details><summary>Advanced settings <span>Resolution, captions, audio & branding</span></summary>
                  <div className="advanced">
                    <label>Output quality<select value={settings.resolution} onChange={e => change('resolution', e.target.value as Settings['resolution'])}><option value="480p">480p · 480 × 854 · lower memory</option><option value="720p">720p · 720 × 1280 · recommended</option><option value="1080p">1080p · capable devices only</option></select></label>
                    <label className="check"><input type="checkbox" checked={settings.lowImpact} onChange={e => change('lowImpact', e.target.checked)} /> Lower-impact rendering (more breathing room between frames)</label>
                    <label className="check"><input type="checkbox" checked={settings.captions} onChange={e => change('captions', e.target.checked)} /> Captions + separate SRT download</label>
                    {settings.captions && <label>Extra short caption<input value={settings.caption} maxLength={90} onChange={e => change('caption', e.target.value)} placeholder="Keep it short and readable" /></label>}
                    <label>Licensed music, optional<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg" onChange={e => { setMusic(e.target.files?.[0]); if (e.target.files?.length) change('musicStyle', 'upload'); setError(''); }} /></label>
                    <p className="help">Upload music you own or have permission to use. First 15 seconds, mono MP3, faded in/out; shorter clips fade to silence. Max 10 MB / 30 seconds. MP3-in-MP4 playback is browser-dependent.</p>
                    {music && <button className="text-button" onClick={() => { setMusic(undefined); change('musicStyle', 'auto'); }}>Remove music</button>}
                    <label>Music volume<input type="range" min="0" max="1" step="0.05" value={settings.musicVolume} onChange={e => change('musicVolume', Number(e.target.value))} /></label>
                    <label>Brand name<input value={settings.brand} maxLength={50} onChange={e => change('brand', e.target.value)} /></label>
                    <label>Brand accent color<input type="color" value={settings.accent || TEMPLATES[settings.template].accent} onChange={e => change('accent', e.target.value)} /></label>
                    <label>Brand logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void upload(e.target.files, 'logo')} /></label>
                    {logo && <button className="text-button" onClick={() => setLogo(undefined)}>Remove logo</button>}
                    <label>Product URL (saved only, never fetched)<input type="url" value={settings.url} maxLength={500} onChange={e => change('url', e.target.value)} placeholder="https://your-store.example/product" /></label>
                    <p className="help">Fixed 15 seconds / 24 FPS. 720p is exact 9:16; 480 × 854 is the standard even-pixel approximation. No generated people, voiceover or unseen product views.</p>
                  </div>
                </details>
              </div>
            </fieldset>
          </section>
          <aside className="preview-column">
            <div className="panel plan-panel"><div className="preview-heading"><h2>Your video, mapped out</h2><span className="tiny-pill">15 SEC</span></div>
              <p className="help">Four sales beats. Review why to care, what it is, supplied value and how to buy. Confirm claims and offers before sharing.</p>
              {!!settings.prompt?.trim() && <>
                <div className="brief-notices" role="note" aria-label="Prompt adaptation limits">{brief.notices.map(message => <p key={message}>{message}</p>)}</div>
                <details><summary>Extracted brief details</summary><dl className="extracted-details">{Object.entries({
                  Product: settings.title, Price: settings.price, Currency: settings.currency, Audience: settings.audience,
                  Problem: settings.problem, Solution: settings.solution, Benefits: settings.benefits,
                  'Requested scenes (reference only)': settings.scenes, 'Requested captions': brief.extracted.captions.join('\n'), CTA: settings.cta,
                }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not specified / not recognized'}</dd></div>)}</dl></details>
              </>}
              <StoryboardPreview settings={settings} images={images} logo={logo} busy={busy} />
              <ol className="scene-plan">{plan.map((text, index) => <li key={index}><span className="scene-number">0{index + 1}</span><div><small>{SCENES[index].start}–{SCENES[index].end}s · {SCENES[index].name}</small>{index < 3 ? <><label htmlFor={`scene-overlay-${index}`}>{['Opening overlay', 'Product overlay', 'Detail overlay'][index]}</label><textarea id={`scene-overlay-${index}`} disabled={busy} rows={3} maxLength={index < 2 ? 80 : 140} value={text} onChange={e => editScene(index, e.target.value)} /></> : <p>{text}</p>}</div></li>)}</ol>
              <div className="render-summary"><div><span>Encoding</span><strong>On your device</strong></div><div><span>Cloud / API cost</span><strong>$0.00</strong></div><div><span>Format</span><strong>MP4 · H.264</strong></div></div>
              <p className="help">Photos gently animate; no AI movement is generated. Re-renders cost no credits, but use your device’s time, power and memory. Keep this tab open.</p>
              <label className="check confirmation"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} /> I reviewed the plan and want to render locally.</label>
              <button className="generate" disabled={busy || !ready} onClick={() => void render()}>{busy ? 'Creating your video…' : '✦ Generate video'}<span>{busy ? `${Math.round(progress)}%` : '→'}</span></button>
              <button className="save-button" disabled={busy || !ready} onClick={() => void saveDraft()}>Save project for later</button>
              {busy && <button className="cancel-button" onClick={() => void cancel()}>Cancel rendering</button>}
              <div className="job-state" role="status" data-testid="job-state">{state}</div>
              {busy && <progress aria-label="Rendering progress" value={progress} max="100" />}
            </div>
            {current?.video && <div className="panel"><h2>Your finished reel</h2><Preview project={current} /></div>}
            <div className="tip-card"><span>✧</span><div><strong>A little photo magic.</strong><p>Clear photos, good light and a few close-ups make a great starting point. Your product’s shape and artwork are never redrawn.</p></div></div>
            <p className="footnote">No GPU capability required. Browsers may use GPU acceleration internally for display. One rendering worker, bounded inputs, one optional software audio helper. Total browser memory and OS CPU usage are not exposed reliably.</p>
          </aside>
        </div> : tab === 'higgsfield' ? <HiggsFieldWorkflow projectId={id} /> : <section className="library">
          <div className="library-toolbar"><p>Saved in this browser’s IndexedDB. Download copies before clearing browser data or changing domains.</p><button className="secondary button" onClick={() => { setId(crypto.randomUUID()); setSettings({ ...DEFAULTS }); setImages([]); setLogo(undefined); setMusic(undefined); setCurrent(undefined); setState('Ready to create'); setTab('create'); }}>New project</button></div>
          {!projects.length && <div className="panel empty">Your first product story starts here. Create a video to fill your library.</div>}
          <div className="library-grid">{projects.map(project => <article className="panel" key={project.id}><div className="preview-heading"><h2>{project.settings.title || project.settings.storyboard?.[0] || 'Untitled product'}</h2><span className="tiny-pill">{project.state}</span></div>
            {project.video && <Preview project={project} />}
            {project.error && <p className="alert">{project.error}</p>}
            <button className="secondary button" disabled={busy} onClick={() => loadProject(project)}>Open project</button>
            {project.video && <><label className="check"><input type="checkbox" disabled={librarySaving} checked={Boolean(project.approved)} onChange={e => void updateProject(project, { approved: e.target.checked })} /> Reviewed and approved for manual posting</label>
              <label>Local posting reminder (does not publish)<input type="datetime-local" disabled={librarySaving} value={project.postPlan?.time || ''} onChange={e => void updateProject(project, { postPlan: { channel: project.postPlan?.channel || 'Instagram', time: e.target.value } })} /></label>
              <label>Channel<select disabled={librarySaving} value={project.postPlan?.channel || 'Instagram'} onChange={e => void updateProject(project, { postPlan: { channel: e.target.value, time: project.postPlan?.time || '' } })}><option>Instagram</option><option>TikTok</option><option>YouTube Shorts</option><option>Other</option></select></label></>}
          </article>)}</div>
          <div className="panel legacy"><h2>Existing local studio library</h2><p>The original videos, uploads and SQLite records are preserved. This computer can read old videos without changing their files or settings. Not exposed in production.</p><button className="secondary button" onClick={() => void readLegacy()}>Read existing local library</button>
            {legacyError && <p role="alert" className="alert">{legacyError}</p>}
            {legacy.map(video => <article key={video.id}><h3>{video.title}</h3><video controls preload="none" src={`/legacy-media/${video.id}/video.mp4`} /><p>{video.caption}</p><a download href={`/legacy-media/${video.id}/video.mp4`}>Download original MP4</a></article>)}
          </div>
        </section>}
        <footer>Made for your products. Powered by your browser.<span>ShopReel AI · Browser Studio · <a href="/licenses/README.txt" target="_blank" rel="noreferrer">Licenses</a></span></footer>
      </div>
    </main>
  </div>;
}
