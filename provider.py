"""Runway Gen-4 Turbo REST adapter. Never automatically retry a paid POST."""
import base64
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from product_brief import RATIOS

API = "https://api.dev.runwayml.com/v1"
VERSION = "2024-11-06"
SETUP = "Set RUNWAYML_API_SECRET server-side and add credits at dev.runway.com. See README and .env.example; then restart."


class ProviderError(RuntimeError):
    pass


class SubmissionUnknown(ProviderError):
    """The paid submission may have reached the provider. Do not resubmit."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class RunwayProvider:
    model = "gen4_turbo"
    poll_interval = 5

    def __init__(self):
        self.secret = os.getenv("RUNWAYML_API_SECRET", "")
        self.opener = build_opener(NoRedirect)

    @property
    def configured(self):
        return bool(self.secret and not self.secret.startswith("replace_"))

    def _request(self, method, path, body=None):
        if not self.configured:
            raise ProviderError(SETUP)
        encoded = json.dumps(body).encode() if body is not None else None
        req = Request(API + path, data=encoded, method=method, headers={
            "Authorization": f"Bearer {self.secret}", "X-Runway-Version": VERSION,
            "Content-Type": "application/json",
        })
        try:
            with self.opener.open(req, timeout=45) as response:
                data = response.read(2 * 1024 * 1024)
                result = json.loads(data) if data else {}
                if not isinstance(result, dict):
                    raise ValueError("Expected a Runway response object.")
                return result
        except HTTPError as error:
            # Never include response bodies, signed URLs, request bodies or secrets in errors.
            if method == "POST" and (error.code >= 500 or error.code == 408):
                raise SubmissionUnknown("Submission response was uncertain. Reconcile in the Runway dashboard; do not resubmit.") from None
            raise ProviderError(f"Runway returned HTTP {error.code}. Check account credits, permissions and model availability.") from None
        except (URLError, TimeoutError, OSError, ValueError):
            error_type = SubmissionUnknown if method == "POST" else ProviderError
            raise error_type("Runway could not be reached or returned an invalid response. Reconcile the original task before retrying.") from None

    def submit(self, image: Path, prompt: str, ratio: str, seconds: int, seed: int):
        data_uri = "data:image/jpeg;base64," + base64.b64encode(image.read_bytes()).decode("ascii")
        if len(data_uri) > 5 * 1024 * 1024:
            raise ProviderError("Prepared image exceeds Runway's 5 MB encoded input limit.")
        data = self._request("POST", "/image_to_video", dict(
            model=self.model, promptImage=data_uri, promptText=prompt,
            ratio=RATIOS[ratio], duration=seconds, seed=seed,
        ))
        task_id = data.get("id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,100}", task_id):
            raise SubmissionUnknown("Runway did not return a usable task ID. Check the dashboard before any resubmission.")
        return task_id

    def retrieve(self, task_id):
        if not re.fullmatch(r"[a-zA-Z0-9-]{1,100}", task_id):
            raise ProviderError("Invalid Runway task ID.")
        return self._request("GET", f"/tasks/{task_id}")

    def cancel(self, task_id):
        task = self.retrieve(task_id)
        status = task.get("status")
        if status not in {"PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"}:
            raise ProviderError("Runway returned an unrecognized task state; cancellation could not be verified.")
        if status in {"PENDING", "THROTTLED", "RUNNING"}:
            self._request("DELETE", f"/tasks/{task_id}")
        return status

    def download(self, url, destination):
        # Only provider output locations, never arbitrary user URLs; do not follow redirects.
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in {None, 443}
                or not (host.endswith(".cloudfront.net") or host.endswith(".runwayml.com") or host.endswith(".runway.com"))):
            raise ProviderError("Unrecognized Runway output host. Review the adapter's allowlist against official output documentation.")
        partial = destination.with_suffix(".partial")
        try:
            with self.opener.open(Request(url), timeout=90) as response, partial.open("wb") as target:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 200 * 1024 * 1024:
                        raise ProviderError("Provider output exceeds the 200 MB download limit.")
                    target.write(chunk)
            partial.replace(destination)
        except (URLError, TimeoutError, OSError, ValueError):
            raise ProviderError("Could not download Runway output. Resume this task without buying another generation.") from None
        finally:
            partial.unlink(missing_ok=True)
