import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { BufferSource, EncodedPacketSink, Input, MP4 } from 'mediabunny';

const photo = resolve('static', 'demo-product.png');
async function setup(page: Page, resolution = '480p') {
  await page.goto('/');
  await page.locator('#photos').setInputFiles(photo);
  await expect(page.getByText('1 product photo selected')).toBeVisible();
  await page.getByLabel('Video prompt', { exact: true }).fill('Create a photo ad for a product called "Graphic tee", priced at USD 29.99.\nHook: Graphic tee\nDetail: Your everyday statement');
  await page.getByText('Optional editable overrides', { exact: true }).click();
  await page.getByText('Advanced settings', { exact: false }).click();
  await page.getByLabel('Output quality').selectOption(resolution);
  await page.getByLabel('Background music', { exact: true }).selectOption('mute');
  await page.getByLabel('Extra short caption').fill('Your style. Your story.');
  await page.getByLabel('I reviewed the plan').check();
}
function musicWav() {
  const rate = 44100, seconds = 15, bytes = rate * seconds * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  for (let i = 0; i < rate * seconds; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 5000), 44 + i * 2);
  return wav;
}
async function assertDecodedOutput(page: Page, path: string, audio: boolean) {
  const bytes = await readFile(path);
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
  try {
    const track = await input.getPrimaryVideoTrack();
    expect(track).not.toBeNull();
    const config = await track!.getDecoderConfig();
    if (!config) throw new Error('Missing H264 decoder configuration');
    const packets = [];
    for await (const packet of new EncodedPacketSink(track!).packets()) {
      packets.push({ type: packet.type, timestamp: packet.timestamp, duration: packet.duration, data: Buffer.from(packet.data).toString('base64') });
    }
    expect(packets).toHaveLength(360);
    for (let frame = 0; frame < packets.length; frame++) {
      expect(packets[frame].timestamp).toBeCloseTo(frame / 24, 5);
      expect(packets[frame].duration).toBeCloseTo(1 / 24, 5);
    }
    expect(packets[359].timestamp + packets[359].duration).toBeCloseTo(15, 2);
    if (!config.description) throw new Error('Missing H264 decoder description');
    const description = ArrayBuffer.isView(config.description)
      ? new Uint8Array(config.description.buffer, config.description.byteOffset, config.description.byteLength)
      : new Uint8Array(config.description);
    const decoded = await page.evaluate(async ({ config, packets }) => {
      let frames = 0; const errors: string[] = [];
      const description = Uint8Array.from(atob(config.description), c => c.charCodeAt(0));
      const decoder = new VideoDecoder({ output(frame) { frames++; frame.close(); }, error(error) { errors.push(error.message); } });
      decoder.configure({ ...config, description, hardwareAcceleration: 'prefer-software' });
      for (const packet of packets) {
        while (decoder.decodeQueueSize > 12) await new Promise(resolve => setTimeout(resolve, 1));
        decoder.decode(new EncodedVideoChunk({ type: packet.type, timestamp: packet.timestamp * 1e6, duration: packet.duration * 1e6, data: Uint8Array.from(atob(packet.data), c => c.charCodeAt(0)) }));
      }
      await decoder.flush(); decoder.close(); return { frames, errors };
    }, { config: { ...config, description: Buffer.from(description).toString('base64') }, packets });
    expect(decoded).toEqual({ frames: 360, errors: [] });
    const audioTrack = await input.getPrimaryAudioTrack();
    expect(Boolean(audioTrack)).toBe(audio);
    let audioEnd = 0;
    if (audioTrack) {
      const audioConfig = await audioTrack.getDecoderConfig();
      expect(audioConfig?.codec).toBe('mp3');
      let last;
      for await (const packet of new EncodedPacketSink(audioTrack).packets()) last = packet;
      audioEnd = last ? last.timestamp + last.duration : 0;
      expect(Math.abs(audioEnd - 15)).toBeLessThan(0.1);
    }
    return { frames: decoded.frames, videoEnd: 15, audioEnd, outputBytes: bytes.length };
  } finally { input.dispose(); }
}
test('real 15-second CPU render with no rendering uploads', async ({ page }, testInfo) => {
  const errors: string[] = [], requests: { method: string; url: string }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  await setup(page);
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
  expect(await page.getByTestId('job-state').innerText(), await page.getByRole('alert').allTextContents().then(x => x.join(' '))).toBe('Completed');
  const video = page.getByLabel('Generated advertisement');
  await expect(video).toBeVisible();
  const playback = await video.evaluate(async element => {
    const video = element as HTMLVideoElement; video.muted = true;
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 300));
    video.pause();
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, time: video.currentTime, error: video.error?.message };
  });
  expect(playback).toMatchObject({ width: 480, height: 854 });
  expect(playback.duration).toBeCloseTo(15, 1); expect(playback.time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(requests.filter(request => !request.url.startsWith('http://127.0.0.1:5050/') && !request.url.startsWith('blob:'))).toEqual([]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download MP4', exact: true }).click();
  const download = await downloadPromise;
  const path = testInfo.outputPath('render-480p.mp4');
  await download.saveAs(path);
  const decoded = await assertDecodedOutput(page, path, false);
  const report = { playback, decoded, metrics: await page.getByTestId('metrics').innerText(), requests };
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify(report, null, 2));
  await testInfo.attach('playback', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});

test('720p with software music, subtitles, responsive UI, reload and original library', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await setup(page, '720p');
  await page.getByLabel('Licensed music, optional').setInputFiles({ name: 'licensed-tone.wav', mimeType: 'audio/wav', buffer: musicWav() });
  await page.getByLabel('I reviewed the plan').check();
  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { gaps: number[]; heartbeat?: ReturnType<typeof setInterval> };
    target.gaps = []; let last = performance.now();
    target.heartbeat = setInterval(() => { const now = performance.now(); target.gaps.push(now - last); last = now; }, 50);
  });
  const browserSession = await browser.newBrowserCDPSession();
  const cpuBefore = await browserSession.send('SystemInfo.getProcessInfo');
  const cpuStart = performance.now();
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
  expect(await page.getByTestId('job-state').innerText(), (await page.getByRole('alert').allTextContents()).join(' ')).toBe('Completed');
  const heartbeat = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & { gaps: number[]; heartbeat?: ReturnType<typeof setInterval> };
    clearInterval(target.heartbeat); return { ticks: target.gaps.length, maxGapMs: Math.max(...target.gaps) };
  });
  expect(heartbeat.maxGapMs).toBeLessThan(750);
  const cpuAfter = await browserSession.send('SystemInfo.getProcessInfo');
  const cpuWallSeconds = (performance.now() - cpuStart) / 1000;
  const processCpuSeconds = cpuAfter.processInfo.reduce((sum, item) => {
    const previous = cpuBefore.processInfo.find(before => before.id === item.id);
    return sum + Math.max(0, item.cpuTime - (previous?.cpuTime ?? 0));
  }, 0);
  const cpu = { processCpuSeconds, wallSeconds: cpuWallSeconds, singleCoreEquivalentPercent: processCpuSeconds / cpuWallSeconds * 100, note: 'Cumulative CPU time of this owned Chromium test browser, including display and test overhead; not device-wide utilization.' };
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download MP4', exact: true }).click();
  const path = testInfo.outputPath('render-720p-audio.mp4');
  await (await downloadPromise).saveAs(path);
  const decoded = await assertDecodedOutput(page, path, true);
  const encoded = (await readFile(path)).toString('base64');
  const audioDecoded = await page.evaluate(async encoded => {
    const context = new OfflineAudioContext(1, 44100 * 15, 44100);
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const audio = await context.decodeAudioData(bytes.buffer);
    const samples = audio.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    return { duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels, peak };
  }, encoded);
  expect(Math.abs(audioDecoded.duration - 15)).toBeLessThan(0.1);
  expect(audioDecoded.peak).toBeGreaterThan(0.01);
  const srtPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download subtitles' }).click();
  const srtPath = testInfo.outputPath('subtitles.srt'); await (await srtPromise).saveAs(srtPath);
  expect(await readFile(srtPath, 'utf8')).toContain('Your style. Your story.');
  const metrics = await page.getByTestId('metrics').innerText();
  await page.reload();
  await page.getByRole('button', { name: /My library/ }).click();
  await expect(page.getByRole('link', { name: 'Download MP4', exact: true })).toBeVisible();
  await page.getByLabel('Reviewed and approved').check();
  await expect(page.getByLabel('Reviewed and approved')).toBeChecked();
  await page.getByLabel('Local posting reminder').fill('2026-12-01T10:00');
  await page.getByRole('button', { name: 'Open project' }).click();
  await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue(/Graphic tee/);
  await page.getByRole('button', { name: /My library/ }).click();
  await page.getByRole('button', { name: 'Read existing local library' }).click();
  await expect(page.getByText(/Read \d+ existing videos/)).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify({ decoded, audioDecoded, heartbeat, cpu, metrics, errors }, null, 2));
});

test('storage failures, missing memory headroom and high-resolution gate fail explicitly', async ({ page }) => {
  await setup(page, '1080p');
  await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { get: () => undefined }));
  await page.reload();
  await setup(page, '1080p');
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByRole('alert')).toContainText('1080p requires');
  await page.getByLabel('Output quality').selectOption('480p');
  await page.evaluate(() => Object.defineProperty(performance, 'memory', { configurable: true, get: () => ({ jsHeapSizeLimit: 128 * 1024 * 1024, usedJSHeapSize: 110 * 1024 * 1024 }) }));
  await page.getByLabel('I reviewed the plan').check();
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByRole('alert')).toContainText('Insufficient memory headroom');
  await page.evaluate(() => Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 100, quota: 101 }) }));
  await page.getByRole('button', { name: 'Save project for later' }).click();
  await expect(page.getByRole('alert')).toContainText('Insufficient browser storage');
});

test('completed videos survive rerenders; custom CTA and captions off', async ({ page, context }, testInfo) => {
  await setup(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Performance.getMetrics');
  const beforeHeap = before.metrics.find(item => item.name === 'JSHeapUsedSize')?.value ?? 0;
  await page.getByLabel('Call to action text').fill('Visit our booth');
  await page.getByLabel('Captions + separate SRT download').uncheck();
  await page.getByLabel('I reviewed the plan').check();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Generate video' }).click();
    await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
    expect(await page.getByTestId('job-state').innerText()).toBe('Completed');
    await expect(page.getByRole('link', { name: 'Download subtitles' })).toHaveCount(0);
    await expect.poll(() => page.workers().length).toBe(0);
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Performance.getMetrics');
  const afterHeap = after.metrics.find(item => item.name === 'JSHeapUsedSize')?.value ?? 0;
  expect(afterHeap - beforeHeap).toBeLessThan(32 * 1024 * 1024);
  await writeFile(testInfo.outputPath('memory.json'), JSON.stringify({ beforeMainHeapBytes: beforeHeap, afterMainHeapBytes: afterHeap, deltaBytes: afterHeap - beforeHeap, activeWorkersAfterRenders: page.workers().length, note: 'Main JS heap after forced garbage collection, not total browser memory or a long-duration leak test.' }, null, 2));
  await page.getByRole('button', { name: /My library/ }).click();
  await expect(page.getByRole('link', { name: 'Download MP4', exact: true })).toHaveCount(2);
});

test('production assets are lazy, compressed and read-only with local request protections', async ({ page, request }, testInfo) => {
  const responses: { url: string; bytes: number; encoding?: string }[] = [];
  page.on('response', response => {
    const headers = response.headers();
    responses.push({ url: response.url(), bytes: Number(headers['content-length'] || 0), encoding: headers['content-encoding'] });
  });
  const start = performance.now();
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Generate video' })).toBeEnabled();
  const pageLoadMs = performance.now() - start;
  expect(responses.some(response => response.url.includes('render.worker') || /\/assets\/audio-/.test(response.url))).toBe(false);
  const invalidPost = await request.post('/render', { data: 'no upload' });
  expect(invalidPost.status()).toBe(405);
  const invalidHost = await request.get('/', { headers: { Host: 'untrusted.invalid' } });
  expect(invalidHost.status()).toBe(403);
  expect((await request.get('/missing.js')).status()).toBe(404);
  const html = await request.get('/');
  expect(html.headers()['content-security-policy']).not.toContain("'unsafe-eval'");
  const asset = responses.find(response => response.url.endsWith('.js'));
  expect(asset?.encoding).toBe('gzip');
  const report = { pageLoadMs, transferredBytes: responses.reduce((sum, item) => sum + item.bytes, 0), responses };
  await writeFile(testInfo.outputPath('page-load.json'), JSON.stringify(report, null, 2));
});

test('validation, cancellation, duplicate prevention, cross-tab lease and refresh recovery', async ({ page, context }) => {
  await page.goto('/');
  await page.locator('#photos').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('corrupted');
  await setup(page, '720p');
  await page.getByLabel('Price', { exact: true }).fill('-2');
  await page.getByLabel('I reviewed the plan').check();
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByRole('alert')).toContainText('positive price');
  await page.getByLabel('Price', { exact: true }).fill('19.99');
  await page.getByLabel('I reviewed the plan').check();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByRole('button', { name: 'Creating your video' })).toBeDisabled();
  await expect(page.getByTestId('job-state')).toContainText(/frame|encoder/, { timeout: 15000 });
  const second = await context.newPage();
  await setup(second);
  await second.getByRole('button', { name: 'Generate video' }).click();
  await expect(second.getByRole('alert')).toContainText('another tab');
  await second.close();
  await page.getByRole('button', { name: 'Cancel rendering' }).click();
  await expect(page.getByTestId('job-state')).toHaveText('Cancelled');
  await page.reload();
  await page.getByRole('button', { name: /My library/ }).click();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open project' }).click();
  await page.getByLabel('I reviewed the plan').check();
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByTestId('job-state')).toContainText(/frame|encoder/, { timeout: 15000 });
  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: /My library/ }).click();
  await expect(page.getByText(/Rendering was interrupted/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download MP4' })).toHaveCount(0);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('simulated two-core low-memory device renders 480p without GPU APIs', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    Object.defineProperty(globalThis, 'VideoEncoder', { value: undefined });
    Object.defineProperty(navigator, 'gpu', { value: undefined });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await setup(page, '720p');
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose 480p');
  await page.getByLabel('Output quality').selectOption('480p');
  await page.getByLabel('I reviewed the plan').check();
  await page.getByRole('button', { name: 'Generate video' }).click();
  await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
  expect(await page.getByTestId('job-state').innerText(), (await page.getByRole('alert').allTextContents()).join(' ')).toBe('Completed');
  await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify({ simulation: '2 reported cores, 2 GB reported RAM, CDP 4x main-thread CPU slowdown; not a physical low-end device', metrics: await page.getByTestId('metrics').innerText() }, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'Download MP4', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('one natural-language prompt drives editable extraction, storyboard preview and export', async ({ page }, testInfo) => {
    const unexpected: string[] = [];
    page.on('pageerror', error => unexpected.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:5050/') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) unexpected.push(request.url()); });
    await page.goto('/');
    const prompt = 'Create a playful photo ad for a product called "Anime graphic tee", priced at USD 24.99. The target audience is anime fans. The problem is boring outfits. The solution is to show the artwork.\nBenefits: Printed artwork\nScene 1: Front photo\nScene 2: Artwork photo\nCaption: Your style\nHook: An outfit upgrade?\nDetail: Let the artwork do the talking.\nCall to action: Visit our store';
    await page.getByLabel('Video prompt', { exact: true }).fill(prompt);
    await page.locator('#photos').setInputFiles(photo);
    await expect(page.getByLabel('Opening overlay')).toHaveValue('An outfit upgrade?');
    await expect(page.getByLabel('Detail overlay')).toHaveValue('Printed artwork');
    await page.getByText('Extracted brief details', { exact: true }).click();
    await expect(page.locator('.extracted-details')).toContainText('anime fans');
    await expect(page.locator('.extracted-details')).toContainText('24.99');
    await expect(page.locator('.extracted-details')).toContainText('Front photo');
    await page.getByRole('button', { name: 'Play storyboard' }).click();
    const snapshot = () => page.locator('canvas').evaluate(canvas => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Storyboard canvas missing');
      return canvas.toDataURL();
    });
    const firstFrame = await snapshot();
    await expect.poll(snapshot).not.toBe(firstFrame);
    await page.getByRole('button', { name: 'Pause storyboard' }).click();
    await page.getByText('Advanced settings', { exact: false }).click();
    await page.getByLabel('Output quality').selectOption('480p');
    await page.getByLabel('I reviewed the plan').check();
    await page.getByRole('button', { name: 'Generate video' }).click();
    await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
    expect(await page.getByTestId('job-state').innerText(), (await page.getByRole('alert').allTextContents()).join(' ')).toBe('Completed');
    const srtPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download subtitles' }).click();
    const path = testInfo.outputPath('prompt-video.srt'); await (await srtPromise).saveAs(path);
    const srt = await readFile(path, 'utf8');
    expect(srt).toContain('An outfit upgrade?'); expect(srt).toContain('USD 24.99\nVisit our store');
    expect(unexpected).toEqual([]);
    await page.reload(); await page.getByRole('button', { name: /My library/ }).click();
    await page.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByLabel('Video prompt', { exact: true })).toHaveValue(prompt);
});
test('sales tee default music is audible in downloaded 720p MP4; four beats and variations persist', async ({ page, browser }, testInfo) => {
    const errors: string[] = [], unexpected: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.method() !== 'GET' || !/^(http:\/\/(?:127\.0\.0\.1|localhost):5050\/|blob:|data:)/.test(request.url())) unexpected.push(request.url()); });
    await page.goto('http://localhost:5050/');
    await page.getByLabel('Video prompt', { exact: true }).fill('Product: Anime graphic tee\nAudience: anime fans\nProblem: An outfit that feels uninspired\nBenefits: Printed anime artwork; Front graphic\nPrice: USD 24.99\nCTA: Shop now - link in bio.');
    await page.locator('#photos').setInputFiles(resolve('outputs', '5e6d24136151472c9a7d18f2ac298440', 'product.png'));
    await expect(page.getByLabel('Background music', { exact: true })).toHaveValue('auto');
    await expect(page.getByLabel('Opening overlay')).toHaveValue('An outfit that feels uninspired?');
    await expect(page.getByLabel('Product overlay')).toHaveValue('Anime graphic tee');
    await expect(page.getByLabel('Detail overlay')).toHaveValue('Printed anime artwork · Front graphic');
    await expect(page.locator('.scene-plan li')).toHaveCount(4);
    await expect(page.locator('.scene-plan li').last()).toContainText('11–15s · CTA');
    for (const style of ['upbeat', 'luxury', 'energetic', 'relaxing']) {
      await page.getByLabel('Background music', { exact: true }).selectOption(style);
      await page.getByRole('button', { name: 'Preview music', exact: true }).click();
      await expect(page.getByLabel('Music preview')).toBeVisible();
    }
    await page.getByLabel('Background music', { exact: true }).selectOption('auto');
    await page.getByLabel('Sales variation').selectOption('benefits');
    await expect(page.getByLabel('Opening overlay')).toHaveValue('Why choose Anime graphic tee?');
    await page.getByLabel('Sales variation').selectOption('lifestyle');
    await expect(page.getByLabel('Opening overlay')).toHaveValue('For anime fans');
    await page.getByLabel('Sales variation').selectOption('problem');
    await page.getByText('Advanced settings', { exact: false }).click();
    await expect(page.getByLabel('Output quality')).toHaveValue('720p');
    await page.getByLabel('I reviewed the plan').check();
    await page.evaluate(() => {
      const target = globalThis as typeof globalThis & { salesGaps: number[]; salesHeartbeat?: ReturnType<typeof setInterval> };
      target.salesGaps = []; let last = performance.now();
      target.salesHeartbeat = setInterval(() => { const now = performance.now(); target.salesGaps.push(now - last); last = now; }, 50);
    });
    const cdp = await browser.newBrowserCDPSession();
    const before = await cdp.send('SystemInfo.getProcessInfo'), start = performance.now();
    await page.getByRole('button', { name: 'Generate video' }).click();
    await expect(page.getByTestId('job-state')).toHaveText(/Completed|Failed/, { timeout: 180000 });
    expect(await page.getByTestId('job-state').innerText(), (await page.getByRole('alert').allTextContents()).join(' ')).toBe('Completed');
    const wallSeconds = (performance.now() - start) / 1000, after = await cdp.send('SystemInfo.getProcessInfo');
    const cpuSeconds = after.processInfo.reduce((sum, item) => sum + Math.max(0, item.cpuTime - (before.processInfo.find(old => old.id === item.id)?.cpuTime ?? 0)), 0);
    const maxHeartbeatGapMs = await page.evaluate(() => {
      const target = globalThis as typeof globalThis & { salesGaps: number[]; salesHeartbeat?: ReturnType<typeof setInterval> };
      clearInterval(target.salesHeartbeat); return Math.max(...target.salesGaps);
    });
    expect(maxHeartbeatGapMs).toBeLessThan(750);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download MP4', exact: true }).click();
    const path = testInfo.outputPath('sales-tee-720p.mp4'); await (await downloadPromise).saveAs(path);
    const decoded = await assertDecodedOutput(page, path, true);
    const audio = await page.evaluate(async encoded => {
      const context = new OfflineAudioContext(1, 15 * 44100, 44100);
      const buffer = await context.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
      const data = buffer.getChannelData(0);
      const rms = (start: number, end: number) => {
        const samples = data.subarray(Math.floor(start * buffer.sampleRate), Math.floor(end * buffer.sampleRate));
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      };
      return { duration: buffer.duration, rms: rms(1, 13), startRms: rms(0, 0.05), endRms: rms(14.9, 14.99) };
    }, (await readFile(path)).toString('base64'));
    expect(audio.rms).toBeGreaterThan(0.01);
    expect(audio.startRms).toBeLessThan(audio.rms / 2);
    expect(audio.endRms).toBeLessThan(audio.rms / 2);
    expect(Math.abs(audio.duration - 15)).toBeLessThan(0.1);
    const srtPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download subtitles' }).click();
    const srtPath = testInfo.outputPath('sales.srt'); await (await srtPromise).saveAs(srtPath);
    const srt = await readFile(srtPath, 'utf8');
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000\nAn outfit that feels uninspired?');
    expect(srt).toContain('00:00:03,000 --> 00:00:07,000\nAnime graphic tee');
    expect(srt).toContain('00:00:07,000 --> 00:00:11,000\nPrinted anime artwork');
    expect(srt).toContain('00:00:11,000 --> 00:00:15,000\nUSD 24.99\nShop now - link in bio.');
    const metrics = await page.getByTestId('metrics').innerText();
    const output = page.getByLabel('Generated advertisement');
    for (const [name, position] of [['hook', 0], ['product', 4], ['value', 8], ['cta', 13]] as const) {
      await output.evaluate(async (element, time) => {
        const video = element as HTMLVideoElement;
        if (video.currentTime === time) return;
        await new Promise<void>(resolve => { video.addEventListener('seeked', () => resolve(), { once: true }); video.currentTime = time; });
      }, position);
      await output.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }
    expect(errors).toEqual([]); expect(unexpected).toEqual([]);
    await writeFile(testInfo.outputPath('sales-measurements.json'), JSON.stringify({ decoded, audio, metrics, maxHeartbeatGapMs, cpuSeconds, wallSeconds, singleCoreEquivalentPercent: cpuSeconds / wallSeconds * 100, errors, unexpected, cpuNote: 'Owned Chromium processes, not device-wide CPU; hardware GPU use not measured.' }, null, 2));
    await page.reload(); await page.getByRole('button', { name: /My library/ }).click();
    await page.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByLabel('Detail overlay')).toHaveValue('Printed anime artwork · Front graphic');
    await expect(page.getByLabel('Background music', { exact: true })).toHaveValue('auto');
    await page.screenshot({ path: testInfo.outputPath('sales-studio.png'), fullPage: true });
});

test('missing uploaded audio fails explicitly and legacy saved projects keep copy and silence', async ({ page }) => {
    await setup(page);
    await page.getByLabel('Background music', { exact: true }).selectOption('upload');
    await page.getByLabel('I reviewed the plan').check();
    await page.getByRole('button', { name: 'Generate video' }).click();
    await expect(page.getByRole('alert')).toContainText('Upload your licensed music');
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('shopreel-browser-v1', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
      const all = await new Promise<{ id: string; settings: Record<string, unknown> }[]>((resolve, reject) => {
        const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const project = all[0];
      delete project.settings.salesCopy; delete project.settings.musicStyle; delete project.settings.salesOverrides;
      project.settings.storyboard = ['Old custom hook', 'Old supplied value'];
      project.settings.title = 'Original tee';
      store.put(project);
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
      db.close();
    });
    await page.reload(); await page.getByRole('button', { name: /My library/ }).click();
    await page.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByLabel('Opening overlay')).toHaveValue('Old custom hook');
    await expect(page.getByLabel('Product overlay')).toHaveValue('Original tee');
    await expect(page.getByLabel('Detail overlay')).toHaveValue('Old supplied value');
    await expect(page.getByLabel('Background music', { exact: true })).toHaveValue('mute');
    await page.getByLabel('Background music', { exact: true }).selectOption('luxury');
    await expect(page.getByLabel('Opening overlay')).toHaveValue('Old custom hook');
    await expect(page.getByLabel('Detail overlay')).toHaveValue('Old supplied value');
});
  test('prompt overrides are optional, survive edits, reset explicitly, and unsupported footage is flagged', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Generate video' }).click();
    await expect(page.getByRole('alert')).toContainText('Paste a video prompt');
    await page.getByLabel('Video prompt', { exact: true }).fill('Create a comedic 30-second ad. Characters: Jake and Mike. Jake walks in, changes shirts, and says dialogue.');
    await expect(page.getByRole('note', { name: 'Prompt adaptation limits' })).toContainText('Real filmed footage must be uploaded');
    await expect(page.getByRole('note', { name: 'Prompt adaptation limits' })).toContainText('15 seconds');
    await page.getByText('Optional editable overrides', { exact: true }).click();
    await expect(page.getByLabel('Price', { exact: true })).toHaveValue('');
    await page.getByLabel('Price', { exact: true }).fill('17.50');
    await page.getByLabel('Currency', { exact: true }).selectOption('GBP');
    await page.getByLabel('Video prompt', { exact: true }).fill('Product: Desk lamp\nPrice: EUR 35.99\nHook: A brighter desk\nDetail: See the detail');
    await expect(page.getByLabel('Price', { exact: true })).toHaveValue('17.50');
    await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('GBP');
    await page.getByRole('button', { name: 'Reset overrides from prompt' }).click();
    await expect(page.getByLabel('Price', { exact: true })).toHaveValue('35.99');
    await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('EUR');
    await page.getByLabel('Opening overlay').fill('Your own headline');
    await page.getByRole('button', { name: 'Save project for later' }).click();
    await expect(page.getByText('Project saved on this browser.')).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: /My library/ }).click();
    await page.getByRole('button', { name: 'Open project' }).click();
    await expect(page.getByLabel('Opening overlay')).toHaveValue('Your own headline');
  });
