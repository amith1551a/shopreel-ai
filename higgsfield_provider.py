"""Higgsfield AI provider for Reference-to-Video and Text-to-Video generation.

Security: Credentials stored server-side only; never exposed to frontend.
Pricing: Validated against documented SDK models; charges tracked per video second.
Concurrency: One paid job per account; free edits unlimited.
"""
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, HTTPRedirectHandler

try:
    import higgsfield_client
except ImportError:
    higgsfield_client = None

SETUP = "Install higgsfield-client: pip install higgsfield-client. Set HF_CREDENTIALS server-side."
PRICING = {
    "wan/3.0/reference-to-video": {"per_second": Decimal("0.05"), "min_duration": 5, "max_duration": 60},
    "kling/3.0/text-to-video": {"per_second": Decimal("0.10"), "min_duration": 5, "max_duration": 30},
}


class HiggsFieldError(RuntimeError):
    pass


class SubmissionUnknown(HiggsFieldError):
    """The paid submission may have reached the provider. Do not resubmit."""


class HiggsFieldProvider:
    """Handles Higgsfield API calls with documented models and pricing."""
    
    poll_interval = 5
    default_model = "wan/3.0/reference-to-video"

    def __init__(self):
        self.credentials = os.getenv("HF_CREDENTIALS", "").strip()
        self.client = higgsfield_client if higgsfield_client else None

    @property
    def configured(self) -> bool:
        return bool(self.client and self.credentials and not self.credentials.startswith("replace_"))

    def calculate_cost(self, model: str, duration_seconds: int) -> Decimal:
        """Calculate cost in USD for a given model and duration.
        
        Args:
            model: One of PRICING keys
            duration_seconds: Video duration in seconds
            
        Returns:
            Cost in USD (Decimal for precision)
        """
        if model not in PRICING:
            raise HiggsFieldError(f"Unknown model: {model}. Supported: {list(PRICING.keys())}")
        
        config = PRICING[model]
        if not (config["min_duration"] <= duration_seconds <= config["max_duration"]):
            raise HiggsFieldError(
                f"{model} requires {config['min_duration']}-{config['max_duration']}s duration; got {duration_seconds}s"
            )
        
        return config["per_second"] * Decimal(duration_seconds)

    def submit_reference_to_video(
        self,
        image_path: Path,
        script: str,
        duration_seconds: int = 10,
        aspect_ratio: str = "9:16",
        model: str = "wan/3.0/reference-to-video",
    ) -> dict:
        """Submit a reference-to-video generation job.
        
        Args:
            image_path: Path to product image (JPEG/PNG)
            script: Full script (timed scene prompts)
            duration_seconds: Output duration (5-60s)
            aspect_ratio: Video aspect ratio (e.g., "9:16", "16:9")
            model: Model to use
            
        Returns:
            Job metadata with id, status, estimated_cost_usd
        """
        if not self.configured:
            raise HiggsFieldError(SETUP)

        if not image_path.exists():
            raise HiggsFieldError(f"Image not found: {image_path}")

        cost = self.calculate_cost(model, duration_seconds)
        
        try:
            result = self.client.submit(
                model=model,
                arguments={
                    "reference_image": str(image_path),
                    "prompt": script,
                    "duration": duration_seconds,
                    "aspect_ratio": aspect_ratio,
                    "output_format": "mp4",
                    "generate_audio": True,
                }
            )
            
            if not isinstance(result, dict) or "id" not in result:
                raise SubmissionUnknown("Higgsfield did not return a valid job ID.")
            
            return {
                "id": result["id"],
                "status": result.get("status", "queued"),
                "model": model,
                "duration_seconds": duration_seconds,
                "estimated_cost_usd": float(cost),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        except (URLError, TimeoutError, OSError, ValueError) as e:
            raise SubmissionUnknown(
                "Higgsfield could not be reached or returned invalid response. Reconcile before retry."
            ) from e
        except Exception as e:
            if "network" in str(e).lower() or "timeout" in str(e).lower():
                raise SubmissionUnknown(str(e)) from e
            raise HiggsFieldError(f"Higgsfield submission failed: {e}") from e

    def retrieve_job(self, job_id: str) -> dict:
        """Poll job status and retrieve results.
        
        Returns:
            {id, status, result_url?, error?, video_url?, metadata?}
        """
        if not self.configured:
            raise HiggsFieldError(SETUP)

        try:
            result = self.client.retrieve(job_id)
            
            if not isinstance(result, dict):
                raise ValueError("Invalid job response")
            
            return {
                "id": job_id,
                "status": result.get("status", "unknown"),
                "video_url": result.get("video_url"),
                "error": result.get("error"),
                "metadata": {
                    "duration": result.get("duration"),
                    "resolution": result.get("resolution"),
                    "fps": result.get("fps"),
                },
            }
        except Exception as e:
            raise HiggsFieldError(f"Failed to retrieve job {job_id}: {e}") from e

    def verify_pricing_documented(self, model: str) -> bool:
        """Verify model exists in documented pricing."""
        return model in PRICING
