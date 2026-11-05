const token = document.querySelector('meta[name="studio-token"]').content;
const $ = (selector) => document.querySelector(selector);
let current = null, project = null, productUrl = null, configured = false, polling = false;
let jobsSnapshot = null;
let planKey = sessionStorage.getItem('shopreel-plan-key');

function notice(message, error = false) {
  $('#notice').hidden = false;
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Studio-Token': token, ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error('Unexpected response. Check the studio terminal and refresh saved jobs before resubmitting.'); }
  if (!response.ok) throw new Error(data.error || 'Request failed. Check saved jobs before trying again.');
  return data;
}
const jsonPost = (url, body, key) => api(url, { method: 'POST', headers: {
  'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}),
}, body: JSON.stringify(body) });
function paragraph(parent, value) {
  const p = document.createElement('p'); p.textContent = value; parent.append(p); return p;
}
function button(parent, label, action) {
  const element = document.createElement('button'); element.type = 'button'; element.className = 'secondary';
  element.textContent = label;
  element.addEventListener('click', async () => {
    element.disabled = true;
    try { await action(); } catch (error) { notice(error.message, true); }
    finally { element.disabled = false; }
  });
  parent.append(element); return element;
}
function updateOptions() {
  const custom = $('#cta-choice').value === 'custom';
  $('#cta').hidden = $('#custom-cta-label').hidden = !custom;
  $('#cta').disabled = !custom; $('#cta').required = custom;
  $('#scene-2-settings').hidden = $('#duration').value !== '10';
  const audio = $('#audio').value === 'uploaded';
  $('#audio-settings').hidden = !audio;
  $('#music').disabled = $('#voice').disabled = !audio;
}
['#cta-choice', '#duration', '#audio'].forEach(id => $(id).addEventListener('change', updateOptions));
$('#image').addEventListener('change', () => {
  const file = $('#image').files[0];
  if (!file) return;
  if (productUrl) URL.revokeObjectURL(productUrl);
  productUrl = URL.createObjectURL(file);
  $('#upload-preview').src = productUrl; $('#upload-preview').hidden = false; $('#upload-copy').hidden = true;
});
$('#create-form').addEventListener('input', () => {
  // A changed form is a new intent; an unchanged timed-out submission keeps its original key.
  planKey = null; sessionStorage.removeItem('shopreel-plan-key');
});

function showPlan(value) {
  project = value;
  sessionStorage.setItem('shopreel-project', value.id);
  $('#scene-plan').hidden = false;
  $('#plan-settings').replaceChildren(); $('#plan-scenes').replaceChildren(); $('#plan-warnings').replaceChildren();
  const brief = value.brief, plan = value.plan;
  paragraph($('#plan-settings'), `${brief.formatted_price} / ${brief.cta} / ${brief.aspect_ratio} / ${brief.style}`);
  paragraph($('#plan-settings'), `Prompt: ${brief.prompt}`);
  paragraph($('#plan-settings'), `Brand: ${brief.brand_name || 'none'} / Logo: ${brief.has_logo ? 'uploaded' : 'none'} / URL: ${brief.product_url || 'none (not fetched)'}`);
  paragraph($('#plan-settings'), `Captions: ${brief.captions ? 'on' : 'off'} / Audio: ${brief.audio} / Recorded language: ${brief.voiceover_language}`);
  for (const scene of plan.scenes) {
    const item = document.createElement('li');
    const image = document.createElement('img'); image.className = 'scene-photo';
    image.src = `/media/${value.id}/${scene.view}.png`; image.alt = `Scene ${scene.index + 1} starting view`;
    item.append(image);
    paragraph(item, `${scene.seconds}s / ${scene.view} starting photo / USD ${plan.scene_cost_usd}`);
    paragraph(item, scene.prompt); $('#plan-scenes').append(item);
  }
  const end = document.createElement('li'); end.textContent = `2s local end card: ${brief.formatted_price} / ${brief.cta}`; $('#plan-scenes').append(end);
  plan.warnings.forEach(warning => paragraph($('#plan-warnings'), warning));
  $('#plan-cost').textContent = `Estimate: USD ${plan.estimated_cost_usd} + possible tax / ${plan.generated_seconds}s cloud + 2s local card = ${plan.final_seconds}s final. Retries cost USD ${plan.scene_cost_usd} per regenerated scene.`;
  $('#paid-consent').checked = false;
  $('#confirm-button').disabled = true;
  $('#confirm-button').textContent = `Confirm & generate - USD ${plan.estimated_cost_usd}`;
}
$('#paid-consent').addEventListener('change', () => {
  $('#confirm-button').disabled = !configured || !$('#paid-consent').checked;
});
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#generate-button'); submit.disabled = true;
  if (!planKey) { planKey = crypto.randomUUID(); sessionStorage.setItem('shopreel-plan-key', planKey); }
  try {
    const result = await api('/api/projects', { method: 'POST', headers: { 'Idempotency-Key': planKey }, body: new FormData(event.target) });
    showPlan(result.project); await refreshLibrary();
    notice('Plan saved. Review each scene and the estimate, then explicitly confirm paid generation.');
    $('#scene-plan').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { notice(`${error.message} An unchanged retry uses the same upload key.`, true); }
  finally { submit.disabled = false; }
});
$('#confirm-button').addEventListener('click', async () => {
  if (!project || !$('#paid-consent').checked) return;
  const submit = $('#confirm-button'); submit.disabled = true;
  const id = project.id;
  try {
    const { job } = await jsonPost(`/api/projects/${id}/generate`, { confirmed: true, estimated_cost_usd: project.plan.estimated_cost_usd });
    notice(`Job ${job.id} is saved (${job.state}). You can refresh this page safely.`);
    await refreshJobs();
  } catch (error) {
    notice(`${error.message} Checking the saved job; never create a new project just because confirmation timed out.`, true);
    try { await refreshJobs(); } catch (recoveryError) { notice(recoveryError.message, true); }
  } finally { submit.disabled = !configured || !$('#paid-consent').checked; }
});

function showVideo(video, captions = false) {
  current = video;
  $('#empty-preview').hidden = true; $('#video-preview').hidden = false;
  $('#video-preview').src = `/media/${video.id}/video.mp4`;
  $('#video-preview').poster = `/media/${video.id}/poster.jpg`;
  $('#video-actions').hidden = false; $('#video-title').textContent = video.title;
  $('#caption').value = video.caption;
  $('#download-link').href = `/media/${video.id}/video.mp4`;
  $('#subtitles-link').href = `/media/${video.id}/subtitles.srt`; $('#subtitles-link').hidden = !captions;
  $('#approve-button').disabled = video.status !== 'draft';
  $('#schedule-button').disabled = video.status !== 'approved';
  $('#approval-status').textContent = video.status.replaceAll('_', ' ');
}
$('#video-preview').addEventListener('error', () => notice('The preview could not be played. Do not approve it; check the saved MP4 and local FFmpeg installation.', true));

async function refreshJobs() {
  const { jobs } = await api('/api/jobs');
  const snapshot = JSON.stringify(jobs);
  if (snapshot === jobsSnapshot) return jobs;
  jobsSnapshot = snapshot;
  const parent = $('#job-list'); parent.replaceChildren();
  if (!jobs.length) paragraph(parent, 'No paid jobs submitted.');
  for (const job of jobs) {
    const card = document.createElement('article'); card.className = 'job-card';
    paragraph(card, `Job ${job.id} / ${job.state} / total authorized USD ${job.authorized_usd} + possible tax`);
    paragraph(card, job.scenes.map(s => `Scene ${s.index + 1}: ${s.state}${s.task_id ? ` / Runway task ${s.task_id}` : ''}`).join(' | '));
    if (job.error) paragraph(card, job.error).className = 'job-error';
    if (job.video && job.state === 'completed') {
      button(card, 'Preview completed video', async () => {
        const { project: saved } = await api(`/api/projects/${job.project_id}`);
        showVideo(job.video, saved.brief.captions);
        $('.preview-column').scrollIntoView({ behavior: 'smooth' });
      });
    }
    if (['queued', 'generating'].includes(job.state)) {
      button(card, job.cancel_requested ? 'Cancellation requested' : 'Request cancellation (no refund promised)', async () => {
        const result = await jsonPost(`/api/jobs/${job.id}/cancel`, {});
        notice(result.message); await refreshJobs();
      }).disabled = Boolean(job.cancel_requested);
    }
    if (['failed', 'cancelled'].includes(job.state) && job.error_kind !== 'submission_unknown') {
      if (!job.scenes.some(s => ['failed', 'cancelled'].includes(s.state))) {
        button(card, 'Resume saved task / local edit (no new generation charge)', () => retryJob(job, { mode: 'resume' }));
      }
      for (const scene of job.scenes.filter(s => ['failed', 'cancelled'].includes(s.state))) {
        button(card, `Regenerate scene ${scene.index + 1} (+USD 0.25)`, async () => {
          if (window.confirm(`Buy another generation for scene ${scene.index + 1} at an estimated USD 0.25 plus possible tax? Previous charges are not refunded.`)) {
            await retryJob(job, { mode: 'scene', scene_index: scene.index, expected_attempt: scene.attempt, confirmed: true, estimated_cost_usd: '0.25' });
          }
        });
      }
    }
    if (job.error_kind === 'submission_unknown') {
      const scene = job.scenes.find(s => s.state === 'submitting' && !s.task_id);
      paragraph(card, 'Paid resubmission is blocked. Find the original task ID in your Runway developer dashboard and attach it below. If you cannot identify it, leave this job stopped and contact Runway; do not guess.');
      const label = document.createElement('label'); label.textContent = 'Original Runway task ID';
      const input = document.createElement('input'); input.maxLength = 100; label.append(input); card.append(label);
      button(card, 'Attach original task and reconcile (no new generation)', async () => {
        if (!scene || !window.confirm('I verified this is the original task for this scene in my Runway dashboard.')) return;
        await jsonPost(`/api/jobs/${job.id}/reconcile`, { scene_index: scene.index, task_id: input.value.trim(), original_task: true });
        await refreshJobs();
      });
    }
    parent.append(card);
  }
  return jobs;
}
async function retryJob(job, body) {
  // Keep the command key after a network failure so another click cannot buy another attempt.
  const storageKey = `shopreel-retry-${job.id}`;
  let command = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (!command || JSON.stringify(command.body) !== JSON.stringify(body)) {
    command = { key: crypto.randomUUID(), body }; sessionStorage.setItem(storageKey, JSON.stringify(command));
  }
  await jsonPost(`/api/jobs/${job.id}/retry`, body, command.key);
  sessionStorage.removeItem(storageKey);
  await refreshJobs();
}
async function refreshLibrary() {
  const [library, saved] = await Promise.all([api('/api/videos'), api('/api/projects')]);
  const container = $('#video-library'); container.replaceChildren();
  const captions = new Map(saved.projects.map(p => [p.id, p.brief.captions]));
  for (const video of library.videos) {
    const card = document.createElement('article'); card.className = 'library-card';
    const image = document.createElement('img'); image.src = `/media/${video.id}/poster.jpg`; image.alt = video.title;
    const body = document.createElement('div'); body.className = 'card-body';
    paragraph(body, `${video.title} / ${video.duration}s / ${video.status.replaceAll('_', ' ')}`);
    button(body, 'Open preview', async () => showVideo(video, captions.get(video.id) || false));
    card.append(image, body); container.append(card);
  }
  if (!library.videos.length) paragraph(container, 'No completed videos yet.');
  $('#project-list').replaceChildren();
  for (const savedProject of saved.projects) {
    const row = document.createElement('div'); row.className = 'job-card';
    paragraph(row, `${savedProject.brief.formatted_price} / ${savedProject.brief.prompt.slice(0, 100)}`);
    button(row, 'Open saved settings & scene plan', async () => showPlan(savedProject));
    $('#project-list').append(row);
  }
  if (!saved.projects.length) paragraph($('#project-list'), 'No saved projects yet.');
}
$('#approve-button').addEventListener('click', async () => {
  if (!current) return;
  try { await jsonPost(`/api/videos/${current.id}/approve`, {}); showVideo({ ...current, status: 'approved' }, !$('#subtitles-link').hidden); await refreshLibrary(); }
  catch (error) { notice(error.message, true); }
});
$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!current) return;
  const date = new Date($('#schedule-time').value);
  if (Number.isNaN(date.getTime())) { notice('Choose a future date and time.', true); return; }
  try {
    const result = await jsonPost(`/api/videos/${current.id}/schedule`, { channel: $('#channel').value, scheduled_at: date.toISOString() });
    showVideo({ ...current, status: result.status }, !$('#subtitles-link').hidden);
    await refreshLibrary(); notice(result.message);
  } catch (error) { notice(error.message, true); }
});
async function refresh() { await Promise.all([refreshJobs(), refreshLibrary()]); }
$('#refresh-button').addEventListener('click', () => refresh().catch(error => notice(error.message, true)));
async function init() {
  updateOptions();
  try {
    const config = await api('/api/config'); configured = config.configured;
    $('#provider-status').textContent = configured
      ? `Runway ${config.model} configured. USD ${config.cost_per_scene_usd} per 5s scene (estimated, plus possible tax). Per-confirmation cap: USD ${config.max_generation_usd}. No automatic paid retries.`
      : `Paid generation is not configured. ${config.setup} You can still save free scene plans and preview previous videos.`;
    await refresh();
    const savedId = sessionStorage.getItem('shopreel-project');
    if (savedId) showPlan((await api(`/api/projects/${savedId}`)).project);
  } catch (error) { notice(error.message, true); }
}
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    const jobs = await refreshJobs();
    if (jobs.some(job => job.state === 'completed' && !document.querySelector(`[data-seen="${job.id}"]`))) {
      await refreshLibrary();
      for (const job of jobs.filter(j => j.state === 'completed')) {
        const marker = document.createElement('span'); marker.hidden = true; marker.dataset.seen = job.id; document.body.append(marker);
      }
    }
  } catch (error) { notice(`Progress could not be refreshed: ${error.message}`, true); }
  finally { polling = false; }
}, 4000);
init();
