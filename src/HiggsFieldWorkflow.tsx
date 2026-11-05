import { useState, useEffect } from 'react';
import {
  HiggsFieldClient,
  BudgetStatus,
  Storyboard,
  formatCents,
  timeUntilReset,
  BudgetExceededError,
} from './higgsfield';

interface HiggsFieldWorkflowProps {
  projectId?: string;
  onVideoGenerated?: (videoUrl: string) => void;
}

export function HiggsFieldWorkflow({ projectId, onVideoGenerated }: HiggsFieldWorkflowProps) {
  const [client] = useState(() => new HiggsFieldClient(projectId || 'user-' + Date.now()));
  const [step, setStep] = useState<'input' | 'storyboard' | 'cost-preview' | 'submitting' | 'polling' | 'complete' | 'error'>('input');
  const [script, setScript] = useState('');
  const [storyboard, setStoryboard] = useState<Storyboard>();
  const [model, setModel] = useState<'wan/3.0/reference-to-video' | 'kling/3.0/text-to-video'>('wan/3.0/reference-to-video');
  const [duration, setDuration] = useState(10);
  const [budget, setBudget] = useState<BudgetStatus>();
  const [costUsd, setCostUsd] = useState<number>();
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [progress, setProgress] = useState(0);

  // Load budget status on mount
  useEffect(() => {
    client.getBudgetStatus().then(setBudget).catch(e => console.error('Budget fetch failed:', e));
  }, [client]);

  const handleParseScript = async () => {
    setError('');
    try {
      const result = await client.parseScript(script);
      setStoryboard(result.storyboard);
      setStep('storyboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed');
    }
  };

  const handlePreviewCost = async () => {
    setError('');
    try {
      const preview = await client.previewCost(model, duration);
      setCostUsd(preview.estimated_cost_usd);
      setBudget(preview.budget);

      if (!preview.can_proceed) {
        setError(preview.blocked_reason || 'Cannot proceed');
        return;
      }

      setStep('cost-preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cost preview failed');
    }
  };

  const handleApproveAndGenerate = async () => {
    setError('');
    setStep('submitting');

    try {
      const newJobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setJobId(newJobId);

      const submission = await client.submitJob(
        newJobId,
        model,
        script,
        duration,
        projectId
      );

      setBudget(submission.budget);
      setStep('polling');

      // Start polling
      pollJobStatus(newJobId);
    } catch (e) {
      if (e instanceof BudgetExceededError) {
        setError(`Budget limit: ${e.message}`);
        setBudget(e.budget);
      } else {
        setError(e instanceof Error ? e.message : 'Submission failed');
      }
      setStep('error');
    }
  };

  const pollJobStatus = async (jId: string) => {
    let attempts = 0;
    const maxAttempts = 300; // 5 min polling at 1s intervals

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setError('Job timeout (5 minutes)');
        setStep('error');
        return;
      }

      try {
        const status = await client.getJobStatus(jId);
        setProgress(status.progress);

        if (status.status === 'completed' && status.video_url) {
          setVideoUrl(status.video_url);
          setStep('complete');
          onVideoGenerated?.(status.video_url);
        } else if (status.status === 'failed') {
          setError(status.error || 'Generation failed');
          setStep('error');
        } else {
          attempts++;
          setTimeout(poll, 1000);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Status poll failed');
        setStep('error');
      }
    };

    poll();
  };

  return (
    <div className="higgsfield-workflow">
      <style>{`
        .higgsfield-workflow {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          padding: 2rem;
          background: #fafafa;
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        
        .workflow-section {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .workflow-label {
          font-weight: 600;
          color: #333;
        }
        
        .workflow-textarea, .workflow-select, .workflow-input {
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .workflow-textarea {
          min-height: 120px;
          font-family: 'Monaco', monospace;
        }
        
        .workflow-button {
          padding: 0.75rem 1.5rem;
          background: #0066cc;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background 0.2s;
        }
        
        .workflow-button:hover:not(:disabled) {
          background: #0052a3;
        }
        
        .workflow-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .storyboard-preview {
          border: 1px solid #ddd;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .scene-editor {
          padding: 1rem;
          border-bottom: 1px solid #eee;
          background: white;
        }
        
        .scene-editor:last-child {
          border-bottom: none;
        }
        
        .scene-title {
          font-weight: 600;
          color: #666;
          margin-bottom: 0.5rem;
        }
        
        .budget-bar {
          background: #eee;
          border-radius: 4px;
          height: 24px;
          position: relative;
          overflow: hidden;
        }
        
        .budget-fill-daily {
          background: linear-gradient(90deg, #4CAF50 0%, #FFC107 80%, #F44336 100%);
        }
        
        .budget-fill-monthly {
          background: linear-gradient(90deg, #2196F3 0%, #FF9800 80%, #F44336 100%);
        }
        
        .budget-label {
          position: absolute;
          top: 50%;
          left: 0.5rem;
          transform: translateY(-50%);
          font-size: 12px;
          font-weight: 600;
          color: white;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
          pointer-events: none;
        }
        
        .cost-preview-box {
          background: #f5f5f5;
          border: 2px solid #ddd;
          border-radius: 4px;
          padding: 1.5rem;
          text-align: center;
        }
        
        .cost-amount {
          font-size: 32px;
          font-weight: 700;
          color: #0066cc;
          margin: 0.5rem 0;
        }
        
        .cost-label {
          font-size: 14px;
          color: #666;
        }
        
        .progress-bar {
          width: 100%;
          height: 8px;
          background: #eee;
          border-radius: 4px;
          overflow: hidden;
        }
        
        .progress-fill {
          height: 100%;
          background: #4CAF50;
          transition: width 0.3s;
        }
        
        .status-message {
          padding: 1rem;
          border-radius: 4px;
          text-align: center;
        }
        
        .status-error {
          background: #ffebee;
          color: #c62828;
        }
        
        .status-success {
          background: #e8f5e9;
          color: #2e7d32;
        }
        
        .status-info {
          background: #e3f2fd;
          color: #1565c0;
        }
        
        .video-preview {
          border-radius: 4px;
          overflow: hidden;
          background: #000;
        }
        
        .video-preview video {
          width: 100%;
          height: auto;
          display: block;
        }
        
        .download-button {
          display: inline-block;
          margin-top: 1rem;
          padding: 0.75rem 1.5rem;
          background: #4CAF50;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }
        
        .download-button:hover {
          background: #45a049;
        }
      `}</style>

      <h2>Higgsfield AI Video Generation</h2>

      {/* Input Step: Full Script */}
      {step === 'input' && (
        <div className="workflow-section">
          <label className="workflow-label">Product Brief (Full Script)</label>
          <textarea
            className="workflow-textarea"
            placeholder="Enter full product brief. Example:&#10;Hook: Tired outfit?&#10;Product: Check this tee!&#10;Value: Anime artwork that stands out&#10;CTA: Shop now - link in bio"
            value={script}
            onChange={e => setScript(e.target.value)}
          />
          <button className="workflow-button" onClick={handleParseScript} disabled={!script.trim()}>
            Parse & Edit Storyboard
          </button>
        </div>
      )}

      {/* Storyboard Step: Edit Scenes */}
      {step === 'storyboard' && storyboard && (
        <div className="workflow-section">
          <label className="workflow-label">Edit Storyboard (Optional)</label>
          <div className="storyboard-preview">
            {storyboard.scenes.map((scene, i) => (
              <div key={scene.id} className="scene-editor">
                <div className="scene-title">
                  {scene.name} ({scene.start_s}-{scene.end_s}s)
                </div>
                <textarea
                  className="workflow-textarea"
                  style={{ minHeight: '80px' }}
                  value={scene.prompt}
                  readOnly
                  title="Scene is read-only in preview. Full edit available in extended UI."
                />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div className="workflow-section" style={{ flex: 1 }}>
              <label className="workflow-label">Model</label>
              <select
                className="workflow-select"
                value={model}
                onChange={e => setModel(e.target.value as typeof model)}
              >
                <option value="wan/3.0/reference-to-video">Wan 3.0 (Reference-to-Video, $0.05/s)</option>
                <option value="kling/3.0/text-to-video">Kling 3.0 (Text-to-Video, $0.10/s)</option>
              </select>
            </div>

            <div className="workflow-section" style={{ flex: 1 }}>
              <label className="workflow-label">Duration (seconds)</label>
              <input
                type="number"
                className="workflow-input"
                min={5}
                max={60}
                value={duration}
                onChange={e => setDuration(Math.max(5, Math.min(60, parseInt(e.target.value))))}
              />
            </div>
          </div>

          <button className="workflow-button" onClick={handlePreviewCost}>
            Preview Cost & Budget
          </button>
        </div>
      )}

      {/* Cost Preview Step */}
      {step === 'cost-preview' && budget && costUsd !== undefined && (
        <div className="workflow-section">
          <div className="cost-preview-box">
            <div className="cost-label">Estimated Cost</div>
            <div className="cost-amount">{formatCents(costUsd * 100)}</div>
          </div>

          {/* Budget Display */}
          <div style={{ marginTop: '1.5rem' }}>
            <div className="workflow-label">Daily Budget ({formatCents(budget.today_limit_cents)})</div>
            <div className="budget-bar">
              <div
                className="budget-fill-daily"
                style={{
                  width: `${Math.min(budget.today_percent, 100)}%`,
                }}
              >
                <span className="budget-label">
                  {formatCents(budget.today_used_cents + budget.today_pending_cents)} / {formatCents(budget.today_limit_cents)}
                </span>
              </div>
            </div>
            {budget.warn_daily && (
              <p style={{ color: '#f57c00', fontSize: '13px', marginTop: '0.5rem' }}>
                ⚠️ 80% of daily budget used. Resets {timeUntilReset(budget.next_daily_reset_at)}.
              </p>
            )}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <div className="workflow-label">Monthly Budget ({formatCents(budget.month_limit_cents)})</div>
            <div className="budget-bar">
              <div
                className="budget-fill-monthly"
                style={{
                  width: `${Math.min(budget.month_percent, 100)}%`,
                }}
              >
                <span className="budget-label">
                  {formatCents(budget.month_used_cents + budget.month_pending_cents)} / {formatCents(budget.month_limit_cents)}
                </span>
              </div>
            </div>
            {budget.warn_monthly && (
              <p style={{ color: '#f57c00', fontSize: '13px', marginTop: '0.5rem' }}>
                ⚠️ 80% of monthly budget used.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <button className="workflow-button" onClick={handleApproveAndGenerate}>
              Approve & Generate
            </button>
            <button
              className="workflow-button"
              style={{ background: '#999' }}
              onClick={() => setStep('storyboard')}
            >
              Back to Edit
            </button>
          </div>
        </div>
      )}

      {/* Submitting Step */}
      {step === 'submitting' && (
        <div className="status-message status-info">
          Submitting job {jobId.slice(0, 8)}... Please wait.
        </div>
      )}

      {/* Polling Step: Progress */}
      {step === 'polling' && (
        <div className="workflow-section">
          <div className="status-message status-info">Generating video...</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p style={{ textAlign: 'center', color: '#666', fontSize: '13px' }}>
            {progress}% complete. Do not close this tab.
          </p>
        </div>
      )}

      {/* Complete Step: Results */}
      {step === 'complete' && videoUrl && (
        <div className="workflow-section">
          <div className="status-message status-success">✓ Video generated successfully!</div>
          <div className="video-preview">
            <video controls preload="metadata">
              <source src={videoUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
          <a href={videoUrl} download className="download-button">
            Download MP4
          </a>
          <button
            className="workflow-button"
            onClick={() => {
              setStep('input');
              setScript('');
              setStoryboard(undefined);
              setJobId('');
              setProgress(0);
              setVideoUrl('');
              setError('');
            }}
          >
            Create Another Video
          </button>
        </div>
      )}

      {/* Error Step */}
      {step === 'error' && error && (
        <div className="workflow-section">
          <div className="status-message status-error">{error}</div>
          <button className="workflow-button" onClick={() => setStep('input')}>
            Start Over
          </button>
        </div>
      )}
    </div>
  );
}

export default HiggsFieldWorkflow;
