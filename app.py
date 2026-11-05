"""Local product-video studio. Run with python app.py, then open localhost:5050."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import secrets
import shutil
import uuid

from flask import Flask, jsonify, render_template, request, send_from_directory
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
from dotenv import load_dotenv
from moviepy import AudioFileClip
from moviepy.video.io.ffmpeg_reader import ffmpeg_parse_infos

from generation import Studio, now
from product_brief import CURRENCIES, CTA_OPTIONS, DEFAULT_CTA, DURATIONS, RATIOS, plan_for, validate_brief
from provider import ProviderError, RunwayProvider, SETUP
from video_engine import assemble_video

BASE = Path(__file__).resolve().parent
Image.MAX_IMAGE_PIXELS = 20_000_000
LOG = logging.getLogger(__name__)


def create_app(storage=None, *, provider=None, editor=assemble_video, start_worker=True):
    load_dotenv(BASE / ".env", override=False)
    app = Flask(__name__)
    storage = Path(storage) if storage else BASE
    studio = Studio(storage, provider if provider is not None else RunwayProvider(), editor)
    app.extensions["studio"] = studio
    output, db = studio.output, studio.db
    app.config.update(MAX_CONTENT_LENGTH=80 * 1024 * 1024, CSRF_TOKEN=secrets.token_hex(32))
    try:
        cap = Decimal(os.getenv("SHOPREEL_MAX_GENERATION_USD", "1.00"))
        if not cap.is_finite() or cap <= 0:
            raise InvalidOperation
    except InvalidOperation as error:
        raise ValueError("SHOPREEL_MAX_GENERATION_USD must be a positive USD amount.") from error

    def key():
        value = request.headers.get("Idempotency-Key", "")
        if not re.fullmatch(r"[a-zA-Z0-9-]{16,100}", value):
            raise ValueError("Send a saved Idempotency-Key (16–100 letters, digits or hyphens).")
        return value

    def payload():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ValueError("Send a JSON object.")
        return value

    @app.errorhandler(ValueError)
    def validation_error(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(ProviderError)
    def provider_error(error):
        return jsonify(error=str(error)), 502

    @app.before_request
    def local_guard():
        # Bind loopback and reject DNS-rebinding hostnames and cross-site mutations.
        if request.host not in {"127.0.0.1:5050", "localhost:5050", "localhost", "127.0.0.1"}:
            return jsonify(error="Use localhost:5050 to open this local studio."), 403
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            supplied = request.headers.get("X-Studio-Token", "")
            if not secrets.compare_digest(supplied, app.config["CSRF_TOKEN"]):
                return jsonify(error="Refresh the studio before making changes."), 403

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
        if request.path.startswith("/api/") or request.path == "/":
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        message = "Uploads together must be below 80 MB. Each photo/logo: 8 MB; each audio file: 20 MB." if error.code == 413 else error.description
        return jsonify(error=message), error.code

    @app.get("/")
    def index():
        return render_template("index.html", csrf=app.config["CSRF_TOKEN"], currencies=CURRENCIES,
                               cta_options=CTA_OPTIONS, default_cta=DEFAULT_CTA)

    @app.get("/api/config")
    def config():
        return jsonify(provider="Runway", model=studio.provider.model, configured=studio.provider.configured,
                       setup=SETUP, durations=DURATIONS, ratios=list(RATIOS),
                       max_generation_usd=f"{cap:.2f}", cost_per_scene_usd="0.25",
                       audio="Optional uploaded music/recorded voiceover only; no automatic speech generation.")

    @app.get("/api/videos")
    def videos():
        with db() as conn:
            rows = [dict(r) for r in conn.execute("SELECT * FROM videos ORDER BY created_at DESC")]
        return jsonify(videos=rows)

    @app.get("/media/<video_id>/<filename>")
    def media(video_id, filename):
        if not re.fullmatch(r"[0-9a-f]{32}", video_id) or filename not in {"video.mp4", "poster.jpg", "product.png", "subtitles.srt", "front.png", "back.png", "side.png", "extra.png", "logo.png"}:
            return jsonify(error="Media not found."), 404
        response = send_from_directory(output / video_id, filename, conditional=True,
                                       as_attachment=filename == "subtitles.srt")
        if filename == "subtitles.srt":
            response.headers["Content-Type"] = "application/x-subrip; charset=utf-8"
        return response

    @app.post("/api/videos")
    def retired_generate():
        return jsonify(error="Create a scene plan with /api/projects, then explicitly confirm its cost. Template generation has been retired."), 400

    @app.post("/api/projects")
    def create_project():
        request_key = key()
        brief = validate_brief(request.form)
        images, audio_files = {}, {}
        fingerprint = hashlib.sha256(json.dumps(request.form.to_dict(flat=False), sort_keys=True).encode())
        for field in request.files:
            if field not in {"image", "back", "side", "extra", "logo", "music", "voice"} or len(request.files.getlist(field)) != 1:
                raise ValueError("Upload only one file per supported photo/audio field.")
            upload = request.files[field]
            if not upload.filename:
                continue
            limit = (20 if field in {"music", "voice"} else 8) * 1024 * 1024
            data = upload.read(limit + 1)
            if not data or len(data) > limit:
                raise ValueError(f"{field.capitalize()} exceeds its size limit or is empty.")
            fingerprint.update(field.encode())
            fingerprint.update(data)
            if field in {"music", "voice"}:
                extension = Path(upload.filename).suffix.lower()
                audio_types = {".mp3": {"audio/mpeg"}, ".wav": {"audio/wav", "audio/x-wav"},
                               ".m4a": {"audio/mp4", "audio/x-m4a"}, ".ogg": {"audio/ogg"}}
                if extension not in audio_types or upload.mimetype not in audio_types[extension]:
                    raise ValueError("Audio must be MP3, WAV, M4A or OGG with an audio content type.")
                signatures = {
                    ".wav": data[:4] == b"RIFF" and data[8:12] == b"WAVE",
                    ".ogg": data[:4] == b"OggS",
                    ".m4a": data[4:8] == b"ftyp",
                    ".mp3": data[:3] == b"ID3" or (len(data) >= 2 and data[0] == 255 and data[1] & 224 == 224),
                }
                if not signatures[extension]:
                    raise ValueError("Audio contents do not match the selected file format. Playlists and external audio URLs are not accepted.")
                audio_files[field] = data
                continue
            try:
                with Image.open(io.BytesIO(data)) as original:
                    formats = {"PNG": ("image/png", {".png"}), "JPEG": ("image/jpeg", {".jpg", ".jpeg"}),
                               "WEBP": ("image/webp", {".webp"})}
                    if (original.format not in formats or upload.mimetype != formats[original.format][0]
                            or Path(upload.filename).suffix.lower() not in formats[original.format][1]):
                        raise ValueError("Choose PNG, JPEG or WebP images.")
                    if (original.width * original.height > 20_000_000 or min(original.size) < (16 if field == "logo" else 128)
                            or max(original.size) > 8192 or getattr(original, "n_frames", 1) != 1):
                        raise ValueError("Photos must be single-frame, 128–8192 pixels per side and below 20 megapixels (logos may be 16 pixels).")
                    image = ImageOps.exif_transpose(original).convert("RGBA")
                    image.load()
                    images["front" if field == "image" else field] = image
            except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
                raise ValueError("Upload valid, decodable PNG, JPEG or WebP images below 20 megapixels.") from error
        if "front" not in images:
            raise ValueError("A product photo is required.")
        if (brief["audio"] == "uploaded") != bool(audio_files):
            raise ValueError("Choose uploaded audio and supply a recording/music file, or choose silent and remove audio uploads.")
        if brief["voiceover_language"] != "none" and "voice" not in audio_files:
            raise ValueError("Upload a voice recording for the selected voiceover language.")
        for index in range(brief["duration"] // 5):
            brief[f"scene_{index}_view"] = request.form.get(f"scene_{index}_view", "front")
        plan = plan_for(brief, set(images) - {"logo"})
        if Decimal(plan["estimated_cost_usd"]) > cap:
            raise ValueError(f"Estimate exceeds the configured per-confirmation cap of USD {cap:.2f}. Choose a shorter video.")
        digest = fingerprint.hexdigest()
        with db() as conn:
            previous = conn.execute("SELECT id,fingerprint FROM projects WHERE request_key=?", (request_key,)).fetchone()
        if previous:
            if previous["fingerprint"] != digest:
                return jsonify(error="This request key belongs to a different project. Start a new plan."), 409
            return jsonify(project=studio.project(previous["id"])), 200
        project_id = uuid.uuid4().hex
        brief.update(seed=secrets.randbelow(4294967296), views=[name for name in images if name != "logo"],
                     has_logo="logo" in images, has_music="music" in audio_files, has_voice="voice" in audio_files)
        folder = output / project_id
        folder.mkdir()
        try:
            # Keep expensive image/audio processing outside the database's writer lock.
            for name, image in images.items():
                image.save(folder / f"{name}.png")
                if name != "logo":
                    size = tuple(int(n) for n in RATIOS[brief["aspect_ratio"]].split(":"))
                    prepared = Image.new("RGB", size, "white")
                    flattened = Image.new("RGBA", image.size, "white")
                    flattened.alpha_composite(image)
                    contained = ImageOps.contain(flattened.convert("RGB"), size)
                    prepared.paste(contained, ((size[0] - contained.width) // 2, (size[1] - contained.height) // 2))
                    prepared.save(folder / f"{name}.jpg", quality=95)
            shutil.copyfile(folder / "front.png", folder / "product.png")
            for name, data in audio_files.items():
                path = folder / f"{name}.audio"
                path.write_bytes(data)
                try:
                    info = ffmpeg_parse_infos(str(path))
                    if not info.get("audio_found") or not 0 < info["duration"] <= 300:
                        raise ValueError("Audio must contain a recording between 0 and 300 seconds.")
                    with AudioFileClip(str(path)) as clip:
                        if clip.duration <= 0 or clip.duration > 300:
                            raise ValueError("Audio must be between 0 and 300 seconds.")
                        clip.get_frame(min(.1, clip.duration / 2))
                except Exception as error:
                    raise ValueError("Audio could not be decoded or exceeds 5 minutes. Use a valid MP3/WAV/M4A/OGG file.") from error
        except Exception:
            # Only this newly allocated, never-confirmed upload directory is removed.
            shutil.rmtree(folder)
            raise
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            previous = conn.execute("SELECT id,fingerprint FROM projects WHERE request_key=?", (request_key,)).fetchone()
            if previous is None:
                conn.execute("INSERT INTO projects VALUES (?,?,?,?,?,?)",
                             (project_id, request_key, digest, json.dumps(brief), json.dumps(plan), now()))
        if previous:
            shutil.rmtree(folder)
            if previous["fingerprint"] != digest:
                return jsonify(error="This request key belongs to a different project. Start a new plan."), 409
            return jsonify(project=studio.project(previous["id"])), 200
        return jsonify(project=studio.project(project_id)), 201

    @app.get("/api/projects")
    def projects():
        with db() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM projects ORDER BY created_at DESC")]
        return jsonify(projects=[studio.project(i) for i in ids])

    @app.get("/api/projects/<project_id>")
    def project(project_id):
        value = studio.project(project_id)
        return (jsonify(project=value), 200) if value else (jsonify(error="Project not found."), 404)

    @app.post("/api/projects/<project_id>/generate")
    def confirm(project_id):
        data = payload()
        if not studio.provider.configured:
            return jsonify(error=SETUP), 503
        saved = studio.project(project_id)
        if saved and Decimal(saved["plan"]["estimated_cost_usd"]) > cap:
            raise ValueError("This project's cost exceeds the current configured cap.")
        job = studio.confirm(project_id, data.get("confirmed"), data.get("estimated_cost_usd"))
        return jsonify(job=job), 202

    @app.get("/api/jobs")
    def jobs():
        with db() as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM generation_jobs ORDER BY created_at DESC")]
        return jsonify(jobs=[studio.job(i) for i in ids])

    @app.get("/api/jobs/<job_id>")
    def job(job_id):
        value = studio.job(job_id)
        return (jsonify(job=value), 200) if value else (jsonify(error="Job not found."), 404)

    @app.post("/api/jobs/<job_id>/cancel")
    def cancel(job_id):
        with db() as conn:
            changed = conn.execute("UPDATE generation_jobs SET cancel_requested=1,updated_at=? WHERE id=? AND state IN ('queued','generating')",
                                   (now(), job_id)).rowcount
        if not changed:
            return jsonify(error="This job is stopped or editing; cancellation is not available."), 409
        return jsonify(message="Cancellation requested. It may not stop provider work or refund credits.")

    @app.post("/api/jobs/<job_id>/retry")
    def retry(job_id):
        data, request_key = payload(), key()
        if not studio.provider.configured:
            return jsonify(error=SETUP), 503
        if data.get("mode") == "scene" and Decimal("0.25") > cap:
            raise ValueError("Scene retry exceeds the configured cost cap.")
        studio.retry(job_id, data, request_key)
        return jsonify(job=studio.job(job_id)), 202

    @app.post("/api/jobs/<job_id>/reconcile")
    def reconcile(job_id):
        data = payload()
        current = studio.job(job_id)
        if current is None or current["state"] != "failed" or current["error_kind"] != "submission_unknown":
            return jsonify(error="Only an uncertain submission needs manual reconciliation."), 409
        index, task_id = data.get("scene_index"), data.get("task_id")
        if type(index) is not int or index < 0 or index >= len(current["scenes"]) or not isinstance(task_id, str) or data.get("original_task") is not True:
            raise ValueError("Confirm the scene index and original task ID from your Runway dashboard.")
        scene = current["scenes"][index]
        if scene["state"] != "submitting" or scene.get("task_id"):
            raise ValueError("This scene already has a task ID or was not submitted.")
        studio.provider.retrieve(task_id)
        with db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            latest = conn.execute("SELECT state,error_kind,scenes FROM generation_jobs WHERE id=?", (job_id,)).fetchone()
            if latest["state"] != "failed" or latest["error_kind"] != "submission_unknown" or latest["scenes"] != json.dumps(current["scenes"]):
                return jsonify(error="Job changed during reconciliation. Refresh its state."), 409
            other_scenes = [json.loads(r["scenes"]) for r in conn.execute("SELECT scenes FROM generation_jobs")]
            if any(s.get("task_id") == task_id for scenes in other_scenes for s in scenes):
                raise ValueError("That task ID is already attached to a scene.")
            scene.update(task_id=task_id, state="generating")
            conn.execute("UPDATE generation_jobs SET state='queued',scenes=?,error=NULL,error_kind=NULL,updated_at=? WHERE id=?",
                         (json.dumps(current["scenes"]), now(), job_id))
        return jsonify(job=studio.job(job_id)), 202

    @app.post("/api/videos/<video_id>/approve")
    def approve(video_id):
        with db() as conn:
            changed = conn.execute("UPDATE videos SET status='approved' WHERE id=? AND status='draft'", (video_id,)).rowcount
            if not changed:
                row = conn.execute("SELECT status FROM videos WHERE id=?", (video_id,)).fetchone()
                return jsonify(error="Video not found." if row is None else "Only draft videos can be approved."), 404 if row is None else 409
        return jsonify(status="approved")

    @app.post("/api/videos/<video_id>/schedule")
    def schedule(video_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(error="Provide a channel and scheduled_at timestamp."), 400
        channel = payload.get("channel")
        value = payload.get("scheduled_at")
        if not isinstance(channel, str) or channel not in {"instagram", "facebook", "pinterest"} or not isinstance(value, str):
            return jsonify(error="Choose a supported channel and a future date/time."), 400
        try:
            when = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if when.tzinfo is None or when <= datetime.now(timezone.utc):
                raise ValueError
        except (ValueError, OverflowError):
            return jsonify(error="Schedule must be a future timestamp including its time zone."), 400
        with db() as conn:
            changed = conn.execute("UPDATE videos SET status='scheduled_local',channel=?,scheduled_at=? WHERE id=? AND status='approved'",
                                   (channel, when.astimezone(timezone.utc).isoformat(), video_id)).rowcount
            if not changed:
                return jsonify(error="Approve this draft first. Scheduled videos cannot be scheduled again."), 409
        return jsonify(status="scheduled_local", message="Saved locally. No social account is connected; nothing will publish automatically.")

    # Higgsfield AI integration for paid AI video generation
    try:
        from higgsfield_routes import HiggsFieldIntegration
        from budget_guard import BudgetGuard
        from higgsfield_provider import HiggsFieldProvider
        
        budget = BudgetGuard(studio.database)
        provider = HiggsFieldProvider()
        integration = HiggsFieldIntegration(app, studio, budget, provider)
        LOG.info("Higgsfield AI integration initialized")
    except ImportError as e:
        LOG.warning(f"Higgsfield modules not available: {e}")
    except Exception as e:
        LOG.error(f"Failed to initialize Higgsfield integration: {e}")
    
    if start_worker:
        studio.start()
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    application = create_app()
    try:
        application.run(host="127.0.0.1", port=5050, debug=False)
    finally:
        application.extensions["studio"].close()
