/**
 * Higgsfield AI integration types and utilities.
 * Frontend only: credentials never exposed, all cost validation server-side.
 */

export interface Scene {
  id: string;
  start_s: number;
  end_s: number;
  name: string;
  prompt: string;
  duration_s: number;
}

export interface Storyboard {
  scenes: Scene[];
}

export interface ParseScriptResponse {
  storyboard: Storyboard;
  original_script: string;
  compressed: string;
}

export interface CostPreview {
  model: string;
  duration_seconds: number;
  estimated_cost_usd: number;
  estimated_cost_cents: number;
  budget: BudgetStatus;
  can_proceed: boolean;
  blocked_reason?: string;
}

export interface BudgetStatus {
  today_used_cents: number;
  today_pending_cents: number;
  today_available_cents: number;
  today_limit_cents: number;
  today_percent: number;
  
  month_used_cents: number;
  month_pending_cents: number;
  month_available_cents: number;
  month_limit_cents: number;
  month_percent: number;
  
  next_daily_reset_at: string;
  warn_daily: boolean;
  warn_monthly: boolean;
  blocked_daily: boolean;
  blocked_monthly: boolean;
}

export interface JobSubmissionRequest {
  job_id: string;
  user_id: string;
  model: string;
  script: string;
  duration_seconds: number;
  image_project_id?: string;
}

export interface JobSubmissionResponse {
  job_id: string;
  status: string;
  provider_job_id?: string;
  estimated_cost_usd: number;
  budget: BudgetStatus;
}

export interface JobStatusResponse {
  job_id: string;
  status: string;
  progress: number;
  video_url?: string;
  error?: string;
  estimated_cost_usd: number;
  actual_cost_usd?: number;
  created_at: string;
  updated_at: string;
}

export interface HiggsFieldJob {
  id: string;
  status: "draft" | "parsing" | "cost-preview" | "submitted" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  script: string;
  storyboard?: Storyboard;
  model: "wan/3.0/reference-to-video" | "kling/3.0/text-to-video";
  duration_seconds: number;
  estimated_cost_usd?: number;
  actual_cost_usd?: number;
  video_url?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export class HiggsFieldClient {
  private baseUrl = "/api/higgsfield";
  private userId: string;

  constructor(userId: string = "anonymous") {
    this.userId = userId;
  }

  /**
   * Parse full product brief into editable storyboard.
   * No cost, no side effects.
   */
  async parseScript(script: string): Promise<ParseScriptResponse> {
    const res = await fetch(`${this.baseUrl}/parse-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to parse script");
    }

    return res.json();
  }

  /**
   * Preview cost for a generation without commitment.
   * No budget reserved, no side effects.
   */
  async previewCost(
    model: string,
    duration_seconds: number
  ): Promise<CostPreview> {
    const res = await fetch(`${this.baseUrl}/preview-cost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        duration_seconds,
        user_id: this.userId,
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to preview cost");
    }

    return res.json();
  }

  /**
   * Submit a generation job after user approval.
   * Atomically reserves budget; blocks if limits exceeded or duplicate.
   */
  async submitJob(
    job_id: string,
    model: string,
    script: string,
    duration_seconds: number,
    imageProjectId?: string
  ): Promise<JobSubmissionResponse> {
    const res = await fetch(`${this.baseUrl}/submit-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id,
        user_id: this.userId,
        model,
        script,
        duration_seconds,
        image_project_id: imageProjectId,
      }),
    });

    if (res.status === 402) {
      // Payment required: budget limit hit
      const error = await res.json();
      throw new BudgetExceededError(error.error, error.budget);
    }

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to submit job");
    }

    return res.json();
  }

  /**
   * Poll job status and results.
   * Safe to call repeatedly; no cost.
   */
  async getJobStatus(job_id: string): Promise<JobStatusResponse> {
    const params = new URLSearchParams({ user_id: this.userId });
    const res = await fetch(`${this.baseUrl}/job/${job_id}/status?${params}`, {
      method: "GET",
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to get job status");
    }

    return res.json();
  }

  /**
   * Get current budget status.
   * Safe to call repeatedly; no cost.
   */
  async getBudgetStatus(): Promise<BudgetStatus> {
    const params = new URLSearchParams({ user_id: this.userId });
    const res = await fetch(`${this.baseUrl}/budget?${params}`, {
      method: "GET",
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to get budget status");
    }

    const data = await res.json();
    return data; // API returns full nested structure
  }
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public budget: BudgetStatus
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * Format cents as USD string.
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Get remaining time until next daily reset (Chicago timezone).
 * Returns formatted string like "5h 30m".
 */
export function timeUntilReset(nextResetISO: string): string {
  const next = new Date(nextResetISO);
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();

  if (diffMs <= 0) return "resetting soon";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
