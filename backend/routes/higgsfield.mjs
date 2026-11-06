/**
 * Higgsfield API Routes - Video Generation Platform
 * 
 * Endpoints:
 * - POST /parse-script: Parse product brief into editable storyboard (free, no auth)
 * - POST /preview-cost: Preview generation cost (free, requires user_id)
 * - POST /submit-job: Submit generation job (paid, reserves budget)
 * - GET /job/:jobId/status: Poll job status
 * - GET /budget: Get user budget status
 * 
 * Credit System:
 * - 100,000 ShopReel credits = $1 USD cost to provider
 * - 20,000 credits available per user every 2 hours
 * - Example: $0.15 video = 15,000 credits
 * - Daily cap: $0.25 (25,000 credits)
 * - Monthly cap: $20 (2,000,000 credits)
 */

import { ScriptParser, StoryboardEditor } from '../script-parser.mjs';

// Credit conversion helpers
const CREDITS_PER_CENT = 1000;  // 1 cent = 1000 credits
const CREDITS_PER_DOLLAR = 100_000;  // 1 dollar = 100k credits

function centsToCredits(cents) {
  // Ceiling division to never undercharge
  return Math.ceil(cents * CREDITS_PER_CENT);
}

function creditsToDisplay(credits) {
  return credits.toLocaleString();
}

/**
 * POST /api/higgsfield/parse-script
 * Parse full product brief into editable storyboard
 * 
 * Request: { script: "Full product brief..." }
 * Response: { storyboard, original_script, compressed }
 * 
 * No cost, no side effects, no auth required
 */
export async function parseScriptRoute(req, res) {
  try {
    const { script } = req.body;

    // Validate input
    if (!script || typeof script !== 'string') {
      return res.status(400).json({
        error: 'Script must be a non-empty string',
      });
    }

    // Check length
    if (script.length > 12000) {
      return res.status(400).json({
        error: 'Script exceeds 12000 characters',
      });
    }

    // Validate script content
    const validationError = ScriptParser.validateScript(script);
    if (validationError) {
      return res.status(400).json({
        error: validationError,
      });
    }

    // Parse into scenes
    const scenes = ScriptParser.extractScenesFromBrief(script);
    const editor = new StoryboardEditor(scenes);
    const storyboard = editor.toDict();

    // Compress for later use
    const compressed = ScriptParser.compressScript(script);

    // Return response
    return res.json({
      storyboard,
      original_script: script,
      compressed,
    });
  } catch (error) {
    console.error('Parse script error:', error);
    return res.status(500).json({
      error: 'Internal server error during script parsing',
    });
  }
}

/**
 * POST /api/higgsfield/preview-cost
 * Preview generation cost without commitment
 * 
 * Request: { model, duration_seconds, user_id }
 * Response: { estimated_cost_usd, estimated_cost_credits, can_proceed, budget, blocked_reason? }
 * 
 * Phase 1: Returns mock pricing with credit conversion
 * Future: Will integrate with real budget tracking
 */
export async function previewCostRoute(req, res) {
  try {
    const { model, duration_seconds, user_id } = req.body;

    // Validate inputs
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Model is required' });
    }

    if (!duration_seconds || typeof duration_seconds !== 'number') {
      return res.status(400).json({ error: 'Duration is required' });
    }

    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Phase 1: Mock pricing (free for all users)
    const costPerSecond = 0.05; // $0.05 per second
    const estimatedCostUsd = duration_seconds * costPerSecond;
    const estimatedCostCents = Math.round(estimatedCostUsd * 100);
    const estimatedCostCredits = centsToCredits(estimatedCostCents);

    // Mock budget (always has budget in Phase 1)
    const today_limit_cents = 10000;  // $100
    const today_limit_credits = centsToCredits(today_limit_cents);
    const month_limit_cents = 100000;  // $1000
    const month_limit_credits = centsToCredits(month_limit_cents);

    const mockBudget = {
      today_used_cents: 0,
      today_pending_cents: 0,
      today_available_cents: 10000,
      today_limit_cents: 10000,
      today_percent: 0,
      today_used_credits: 0,
      today_pending_credits: 0,
      today_available_credits: today_limit_credits,
      today_limit_credits: today_limit_credits,

      month_used_cents: 0,
      month_pending_cents: 0,
      month_available_cents: 100000,
      month_limit_cents: 100000,
      month_percent: 0,
      month_used_credits: 0,
      month_pending_credits: 0,
      month_available_credits: month_limit_credits,
      month_limit_credits: month_limit_credits,

      next_daily_reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      warn_daily: false,
      warn_monthly: false,
      blocked_daily: false,
      blocked_monthly: false,
    };

    return res.json({
      model,
      duration_seconds,
      estimated_cost_usd: estimatedCostUsd,
      estimated_cost_cents: estimatedCostCents,
      estimated_cost_credits: estimatedCostCredits,
      budget: mockBudget,
      can_proceed: true,
    });
  } catch (error) {
    console.error('Preview cost error:', error);
    return res.status(500).json({
      error: 'Internal server error during cost preview',
    });
  }
}

/**
 * POST /api/higgsfield/submit-job
 * Submit a generation job after user approval
 * 
 * Request: { job_id, user_id, model, script, duration_seconds, image_project_id? }
 * Response: { job_id, status, provider_job_id?, estimated_cost_usd, estimated_cost_credits, budget }
 * 
 * Phase 1: Returns mock job (no actual generation)
 * Returns 402 Payment Required if budget exceeded
 */
export async function submitJobRoute(req, res) {
  try {
    const { job_id, user_id, model, script, duration_seconds, image_project_id } = req.body;

    // Validate inputs
    if (!job_id || !user_id || !model || !script || !duration_seconds) {
      return res.status(400).json({
        error: 'Missing required fields: job_id, user_id, model, script, duration_seconds',
      });
    }

    // Phase 1: Mock submission (no actual cost, no provider integration)
    const costPerSecond = 0.05;
    const estimatedCostUsd = duration_seconds * costPerSecond;
    const estimatedCostCents = Math.round(estimatedCostUsd * 100);
    const estimatedCostCredits = centsToCredits(estimatedCostCents);

    // Mock budget (always available in Phase 1)
    const today_limit_cents = 10000;
    const today_limit_credits = centsToCredits(today_limit_cents);
    const month_limit_cents = 100000;
    const month_limit_credits = centsToCredits(month_limit_cents);

    const mockBudget = {
      today_used_cents: Math.round(estimatedCostUsd * 100),
      today_pending_cents: 0,
      today_available_cents: 10000 - Math.round(estimatedCostUsd * 100),
      today_limit_cents: 10000,
      today_percent: Math.round((estimatedCostUsd / 100) * 100),
      today_used_credits: centsToCredits(Math.round(estimatedCostUsd * 100)),
      today_pending_credits: 0,
      today_available_credits: centsToCredits(10000 - Math.round(estimatedCostUsd * 100)),
      today_limit_credits: today_limit_credits,

      month_used_cents: Math.round(estimatedCostUsd * 100),
      month_pending_cents: 0,
      month_available_cents: 100000 - Math.round(estimatedCostUsd * 100),
      month_limit_cents: 100000,
      month_percent: Math.round((estimatedCostUsd / 1000) * 100),
      month_used_credits: centsToCredits(Math.round(estimatedCostUsd * 100)),
      month_pending_credits: 0,
      month_available_credits: centsToCredits(100000 - Math.round(estimatedCostUsd * 100)),
      month_limit_credits: month_limit_credits,

      next_daily_reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      warn_daily: false,
      warn_monthly: false,
      blocked_daily: false,
      blocked_monthly: false,
    };

    return res.json({
      job_id,
      status: 'queued',
      provider_job_id: `mock-${job_id}`,
      estimated_cost_usd: estimatedCostUsd,
      estimated_cost_credits: estimatedCostCredits,
      budget: mockBudget,
    });
  } catch (error) {
    console.error('Submit job error:', error);
    return res.status(500).json({
      error: 'Internal server error during job submission',
    });
  }
}

/**
 * GET /api/higgsfield/job/:jobId/status
 * Poll job status and results
 * 
 * Query: { user_id }
 * Response: { job_id, status, progress, video_url?, error?, estimated_cost_usd, actual_cost_usd?, ... }
 * 
 * Phase 1: Returns mock status (jobs never progress beyond queued)
 */
export async function getJobStatusRoute(req, res) {
  try {
    const { jobId } = req.params;
    const { user_id } = req.query;

    if (!jobId || !user_id) {
      return res.status(400).json({
        error: 'Job ID and user ID are required',
      });
    }

    // Phase 1: Mock status (always queued)
    return res.json({
      job_id: jobId,
      status: 'queued',
      progress: 0,
      estimated_cost_usd: 0.5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get job status error:', error);
    return res.status(500).json({
      error: 'Internal server error fetching job status',
    });
  }
}

/**
 * GET /api/higgsfield/budget
 * Get user budget status
 * 
 * Query: { user_id }
 * Response: { today_*, month_*, next_daily_reset_at, warn_*, blocked_*, *_credits }
 * 
 * Phase 1: Returns mock budget (unlimited)
 * Displays: Large comma-formatted credit amounts
 * Internal: Tracks cents, never exposed to user-facing display
 */
export async function getBudgetRoute(req, res) {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        error: 'User ID is required',
      });
    }

    // Phase 1: Mock budget (unlimited)
    // Daily: 20,000 credits per 2 hours = 240,000 per day = ~$2.40
    // Actually set to higher for Phase 1 testing: 10,000 cents = $100
    const today_limit_cents = 10000;
    const today_limit_credits = centsToCredits(today_limit_cents);
    
    const month_limit_cents = 100000;
    const month_limit_credits = centsToCredits(month_limit_cents);
    
    const today_used_cents = 0;
    const today_pending_cents = 0;
    const month_used_cents = 0;
    const month_pending_cents = 0;
    
    const today_total_cents = today_used_cents + today_pending_cents;
    const month_total_cents = month_used_cents + month_pending_cents;

    return res.json({
      // Cent values (backend reference only, not displayed)
      today_used_cents: today_used_cents,
      today_pending_cents: today_pending_cents,
      today_available_cents: Math.max(0, today_limit_cents - today_total_cents),
      today_limit_cents: today_limit_cents,
      today_percent: 0,

      month_used_cents: month_used_cents,
      month_pending_cents: month_pending_cents,
      month_available_cents: Math.max(0, month_limit_cents - month_total_cents),
      month_limit_cents: month_limit_cents,
      month_percent: 0,

      // Credit values (user-facing display)
      today_used_credits: centsToCredits(today_used_cents),
      today_pending_credits: centsToCredits(today_pending_cents),
      today_available_credits: centsToCredits(Math.max(0, today_limit_cents - today_total_cents)),
      today_limit_credits: today_limit_credits,

      month_used_credits: centsToCredits(month_used_cents),
      month_pending_credits: centsToCredits(month_pending_cents),
      month_available_credits: centsToCredits(Math.max(0, month_limit_cents - month_total_cents)),
      month_limit_credits: month_limit_credits,

      next_daily_reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      warn_daily: false,
      warn_monthly: false,
      blocked_daily: false,
      blocked_monthly: false,
    });
  } catch (error) {
    console.error('Get budget error:', error);
    return res.status(500).json({
      error: 'Internal server error fetching budget',
    });
  }
}
