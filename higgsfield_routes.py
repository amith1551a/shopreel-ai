"""Higgsfield AI API endpoints for ShopReel: cost preview, approval, generation, tracking.

All server-side: credentials never exposed to frontend.
Atomic budget reservations; one paid job per user.
"""
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import json
import logging
import uuid
import hashlib
import re

from flask import jsonify, request as flask_request

from higgsfield_provider import HiggsFieldError, HiggsFieldProvider, SubmissionUnknown, PRICING
from budget_guard import BudgetGuard, BudgetGuardError
from script_parser import ScriptParser, StoryboardEditor

LOG = logging.getLogger(__name__)


class HiggsFieldIntegration:
    """Higgsfield endpoints for Flask app."""
    
    def __init__(self, app, studio, budget_guard: BudgetGuard, higgsfield_provider: HiggsFieldProvider):
        self.app = app
        self.studio = studio
        self.budget = budget_guard
        self.provider = higgsfield_provider
        self.db = studio.db
        self.output = studio.output
        self._register_routes()
    
    def _register_routes(self):
        """Register Flask routes."""
        
        @self.app.post("/api/higgsfield/parse-script")
        def parse_script():
            """Parse full product brief into editable storyboard."""
            try:
                script = flask_request.json.get("script", "").strip()
                error = ScriptParser.validate_script(script)
                if error:
                    return jsonify(error=error), 400
                
                scenes = ScriptParser.extract_scenes_from_brief(script)
                editor = StoryboardEditor(scenes)
                
                return jsonify({
                    "storyboard": editor.to_dict(),
                    "original_script": script,
                    "compressed": ScriptParser.compress_script(script),
                }), 200
            except Exception as e:
                LOG.error(f"Script parsing failed: {e}")
                return jsonify(error=str(e)), 500
        
        @self.app.post("/api/higgsfield/preview-cost")
        def preview_cost():
            """Preview cost for a generation job without commitment.
            
            Request: {model, duration_seconds, user_id}
            Response: {estimated_cost_usd, budget_status, can_proceed}
            """
            try:
                data = flask_request.json or {}
                model = data.get("model", "wan/3.0/reference-to-video").strip()
                duration_s = int(data.get("duration_seconds", 10))
                user_id = data.get("user_id", "anonymous").strip()
                
                if not model or model not in PRICING:
                    return jsonify(error=f"Unknown model: {model}"), 400
                
                if not (5 <= duration_s <= 60):
                    return jsonify(error="Duration must be 5-60 seconds"), 400
                
                # Calculate cost
                config = PRICING[model]
                if not (config["min_duration"] <= duration_s <= config["max_duration"]):
                    return jsonify(
                        error=f"{model} requires {config['min_duration']}-{config['max_duration']}s"
                    ), 400
                
                estimated_cents = int(config["per_second"] * Decimal(duration_s) * 100)
                
                # Get budget status
                daily_limit = int(flask_request.environ.get("HF_DAILY_BUDGET_CENTS", 6000))
                monthly_limit = int(flask_request.environ.get("HF_MONTHLY_BUDGET_CENTS", 200000))
                
                budget_status = self.budget.get_budget_status(user_id, daily_limit, monthly_limit)
                
                can_proceed = (
                    estimated_cents <= budget_status["today_available_cents"]
                    and estimated_cents <= budget_status["month_available_cents"]
                )
                
                return jsonify({
                    "model": model,
                    "duration_seconds": duration_s,
                    "estimated_cost_usd": estimated_cents / 100.0,
                    "estimated_cost_cents": estimated_cents,
                    "budget": budget_status,
                    "can_proceed": can_proceed,
                    "blocked_reason": (
                        "Monthly limit reached" if budget_status["blocked_monthly"]
                        else "Daily limit reached" if budget_status["blocked_daily"]
                        else None
                    ),
                }), 200
            except ValueError as e:
                return jsonify(error=str(e)), 400
            except Exception as e:
                LOG.error(f"Cost preview failed: {e}")
                return jsonify(error="Cost preview failed"), 500
        
        @self.app.post("/api/higgsfield/submit-job")
        def submit_job():
            """Submit and reserve a generation job.
            
            Requires user approval (idempotent via job_id).
            Atomically reserves budget; blocks if limits exceeded or job duplicate.
            """
            try:
                data = flask_request.json or {}
                job_id = data.get("job_id", "").strip()
                user_id = data.get("user_id", "anonymous").strip()
                model = data.get("model", "wan/3.0/reference-to-video").strip()
                script = data.get("script", "").strip()
                duration_s = int(data.get("duration_seconds", 10))
                image_project_id = data.get("image_project_id", "").strip()
                
                # Validate inputs
                if not job_id or not re.match(r"^[a-zA-Z0-9\-]{8,50}$", job_id):
                    return jsonify(error="Invalid job_id"), 400
                
                if not user_id:
                    return jsonify(error="user_id required"), 400
                
                error = ScriptParser.validate_script(script)
                if error:
                    return jsonify(error=error), 400
                
                if not (5 <= duration_s <= 60):
                    return jsonify(error="Duration must be 5-60 seconds"), 400
                
                # Get image if provided
                image_path = None
                if image_project_id and re.match(r"^[a-zA-Z0-9]{32}$", image_project_id):
                    image_path = self.output / image_project_id / "front.png"
                    if not image_path.exists():
                        return jsonify(error=f"Image not found: {image_project_id}"), 404
                
                # Calculate cost
                try:
                    cost_usd = self.provider.calculate_cost(model, duration_s)
                except HiggsFieldError as e:
                    return jsonify(error=str(e)), 400
                
                cost_cents = int(cost_usd * 100)
                
                # Get limits from environment (fallback to defaults)
                daily_limit = int(flask_request.environ.get("HF_DAILY_BUDGET_CENTS", 6000))
                monthly_limit = int(flask_request.environ.get("HF_MONTHLY_BUDGET_CENTS", 200000))
                
                # Atomically reserve budget
                reserved, err_msg = self.budget.reserve_budget(
                    user_id=user_id,
                    job_id=job_id,
                    model=model,
                    estimated_cents=cost_cents,
                    daily_limit_cents=daily_limit,
                    monthly_limit_cents=monthly_limit,
                )
                
                if not reserved:
                    budget_status = self.budget.get_budget_status(user_id, daily_limit, monthly_limit)
                    return jsonify(
                        error=err_msg,
                        budget=budget_status,
                    ), 402
                
                # Submit to Higgsfield
                try:
                    if image_path:
                        result = self.provider.submit_reference_to_video(
                            image_path=image_path,
                            script=ScriptParser.compress_script(script),
                            duration_seconds=duration_s,
                            model=model,
                        )
                    else:
                        # Text-to-video fallback (not primary workflow)
                        result = {
                            "id": job_id,
                            "status": "queued",
                            "model": model,
                            "duration_seconds": duration_s,
                            "estimated_cost_usd": float(cost_usd),
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    
                    # Store in local DB for tracking
                    with self.db() as conn:
                        conn.execute(
                            """INSERT INTO higgsfield_jobs 
                            (id, user_id, model, status, script, duration_s, 
                             estimated_cost_cents, actual_cost_cents, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                job_id,
                                user_id,
                                model,
                                "submitted",
                                script,
                                duration_s,
                                cost_cents,
                                None,
                                datetime.now(timezone.utc).isoformat(),
                                datetime.now(timezone.utc).isoformat(),
                            ),
                        )
                    
                    return jsonify({
                        "job_id": job_id,
                        "status": "submitted",
                        "provider_job_id": result.get("id"),
                        "estimated_cost_usd": float(cost_usd),
                        "budget": self.budget.get_budget_status(user_id, daily_limit, monthly_limit),
                    }), 201
                
                except SubmissionUnknown as e:
                    # Budget was reserved; mark as uncertain submission
                    with self.db() as conn:
                        conn.execute(
                            "UPDATE higgsfield_jobs SET status=? WHERE id=?",
                            ("uncertain", job_id),
                        )
                    LOG.warning(f"Uncertain submission for job {job_id}: {e}")
                    return jsonify(
                        error=str(e),
                        job_id=job_id,
                        status="uncertain",
                    ), 202
                
                except HiggsFieldError as e:
                    # Release reserved budget if submission fails
                    self.budget.charge_job(job_id, 0, str(e))
                    return jsonify(error=str(e)), 503
            
            except Exception as e:
                LOG.error(f"Job submission failed: {e}", exc_info=True)
                return jsonify(error="Job submission failed"), 500
        
        @self.app.get("/api/higgsfield/job/<job_id>/status")
        def get_job_status(job_id):
            """Poll job status and results."""
            try:
                user_id = flask_request.args.get("user_id", "anonymous").strip()
                
                # Get from local DB
                with self.db() as conn:
                    row = conn.execute(
                        "SELECT * FROM higgsfield_jobs WHERE id=? AND user_id=?",
                        (job_id, user_id),
                    ).fetchone()
                
                if not row:
                    return jsonify(error="Job not found"), 404
                
                row_dict = dict(row)
                
                # Poll provider if needed
                if row_dict.get("status") in ("submitted", "queued", "processing"):
                    try:
                        provider_result = self.provider.retrieve_job(row_dict.get("provider_job_id", job_id))
                        
                        with self.db() as conn:
                            conn.execute(
                                """UPDATE higgsfield_jobs 
                                SET status=?, provider_status=?, video_url=?, updated_at=?
                                WHERE id=?""",
                                (
                                    provider_result.get("status", row_dict["status"]),
                                    provider_result.get("status"),
                                    provider_result.get("video_url"),
                                    datetime.now(timezone.utc).isoformat(),
                                    job_id,
                                ),
                            )
                        row_dict["status"] = provider_result.get("status", row_dict["status"])
                        row_dict["video_url"] = provider_result.get("video_url")
                    except HiggsFieldError as e:
                        LOG.warning(f"Failed to poll job {job_id}: {e}")
                
                return jsonify({
                    "job_id": job_id,
                    "status": row_dict.get("status"),
                    "progress": row_dict.get("progress", 0),
                    "video_url": row_dict.get("video_url"),
                    "error": row_dict.get("error"),
                    "estimated_cost_usd": (row_dict.get("estimated_cost_cents", 0) or 0) / 100.0,
                    "actual_cost_usd": (row_dict.get("actual_cost_cents", 0) or 0) / 100.0 if row_dict.get("actual_cost_cents") else None,
                    "created_at": row_dict.get("created_at"),
                    "updated_at": row_dict.get("updated_at"),
                }), 200
            except Exception as e:
                LOG.error(f"Job status check failed: {e}")
                return jsonify(error="Status check failed"), 500
        
        @self.app.get("/api/higgsfield/budget")
        def get_budget_status():
            """Get budget status for user."""
            try:
                user_id = flask_request.args.get("user_id", "anonymous").strip()
                
                daily_limit = int(flask_request.environ.get("HF_DAILY_BUDGET_CENTS", 6000))
                monthly_limit = int(flask_request.environ.get("HF_MONTHLY_BUDGET_CENTS", 200000))
                
                budget = self.budget.get_budget_status(user_id, daily_limit, monthly_limit)
                
                return jsonify({
                    "user_id": user_id,
                    "today": {
                        "used_cents": budget["today_used_cents"],
                        "pending_cents": budget["today_pending_cents"],
                        "available_cents": budget["today_available_cents"],
                        "limit_cents": budget["today_limit_cents"],
                        "percent": budget["today_percent"],
                        "blocked": budget["blocked_daily"],
                    },
                    "month": {
                        "used_cents": budget["month_used_cents"],
                        "pending_cents": budget["month_pending_cents"],
                        "available_cents": budget["month_available_cents"],
                        "limit_cents": budget["month_limit_cents"],
                        "percent": budget["month_percent"],
                        "blocked": budget["blocked_monthly"],
                    },
                    "next_daily_reset_at": budget["next_daily_reset_at"],
                    "warn": budget["warn_daily"] or budget["warn_monthly"],
                }), 200
            except Exception as e:
                LOG.error(f"Budget status check failed: {e}")
                return jsonify(error="Budget check failed"), 500


def init_higgsfield(app, studio):
    """Initialize Higgsfield integration in Flask app."""
    db_path = Path(studio.storage) / "data" / "higgsfield.sqlite3"
    
    # Initialize budget guard
    budget = BudgetGuard(db_path)
    
    # Initialize provider
    provider = HiggsFieldProvider()
    
    # Register routes
    integration = HiggsFieldIntegration(app, studio, budget, provider)
    
    # Expose for testing
    app.extensions["higgsfield"] = integration
    
    return integration
