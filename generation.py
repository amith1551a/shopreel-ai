"""Single-machine durable jobs; persisted task IDs are always polled, never resubmitted."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
import sqlite3
import threading
import time
import uuid

from provider import ProviderError, SubmissionUnknown
from video_engine import assemble_video, verify_video

LOG = logging.getLogger(__name__)
ACTIVE = ("queued", "generating", "editing")


def now():
    return datetime.now(timezone.utc).isoformat()


class Studio:
    def __init__(self, storage, provider, editor=assemble_video):
        self.storage = Path(storage)
        self.database = self.storage / "data" / "studio.sqlite3"
        self.output = self.storage / "outputs"
        self.output.mkdir(parents=True, exist_ok=True)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.provider, self.editor = provider, editor
        self.stop_event = threading.Event()
        self.thread = None
        self.lock = threading.Lock()
        with self.db() as conn:
            existing = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").fetchone()
            if not existing and self.database.stat().st_size:
                backup = self.database.with_name(f"studio-before-generator-{uuid.uuid4().hex}.sqlite3")
                with closing(sqlite3.connect(backup)) as target:
                    conn.backup(target)
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS videos (
                    id TEXT PRIMARY KEY, title TEXT, caption TEXT, status TEXT,
                    duration REAL, created_at TEXT, channel TEXT, scheduled_at TEXT);
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL,
                    brief TEXT NOT NULL, plan TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS generation_jobs (
                    id TEXT PRIMARY KEY, project_id TEXT UNIQUE NOT NULL, state TEXT NOT NULL,
                    scenes TEXT NOT NULL, error TEXT, error_kind TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
                    authorized_usd TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS job_commands (
                    request_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, fingerprint TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS higgsfield_jobs (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    model TEXT NOT NULL, status TEXT NOT NULL,
                    provider_job_id TEXT, provider_status TEXT,
                    script TEXT NOT NULL, duration_s INTEGER NOT NULL,
                    estimated_cost_cents INTEGER, actual_cost_cents INTEGER,
                    video_url TEXT, error TEXT, progress REAL DEFAULT 0,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS idx_higgsfield_user_created ON higgsfield_jobs(user_id, created_at);
            """)

    @contextmanager
    def db(self):
        conn = sqlite3.connect(self.database, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def project(self, project_id):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        for field in ("brief", "plan"):
            result[field] = json.loads(result[field])
        return result

    def job(self, job_id):
        with self.db() as conn:
            row = conn.execute("SELECT * FROM generation_jobs WHERE id=?", (job_id,)).fetchone()
            video = conn.execute("SELECT * FROM videos WHERE id=?", (job_id,)).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["scenes"] = json.loads(result["scenes"])
        result["video"] = dict(video) if video else None
        return result

    def save(self, job):
        with self.db() as conn:
            conn.execute("""UPDATE generation_jobs SET state=?,scenes=?,error=?,error_kind=?,
                updated_at=? WHERE id=?""", (job["state"], json.dumps(job["scenes"]),
                job.get("error"), job.get("error_kind"), now(), job["id"]))

    @contextmanager
    def worker_lock(self):
        # A file lock excludes other app instances; a crash releases it automatically.
        with self.lock:
            with (self.database.parent / "generation-worker.lock").open("a+b") as handle:
                handle.seek(0, 2)
                if handle.tell() == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                try:
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    yield False
                    return
                try:
                    yield True
                finally:
                    handle.seek(0)
                    if os.name == "nt":
                        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        fcntl.flock(handle, fcntl.LOCK_UN)

    def start(self):
        def loop():
            while not self.stop_event.is_set():
                try:
                    self.run_once()
                except Exception as error:
                    LOG.error("Background worker error (%s); saved jobs remain recoverable.", type(error).__name__)
                self.stop_event.wait(1)
        self.thread = threading.Thread(target=loop, name="shopreel-generator", daemon=True)
        self.thread.start()

    def close(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)

    def run_once(self):
        with self.worker_lock() as acquired:
            if not acquired:
                return
            with self.db() as conn:
                row = conn.execute("SELECT id FROM generation_jobs WHERE state IN ('queued','generating','editing') ORDER BY created_at LIMIT 1").fetchone()
            if row:
                self.run_job(row["id"])

    def cancel_job(self, job):
        for scene in job["scenes"]:
            if scene.get("task_id") and scene["state"] not in {"completed", "failed", "cancelled"}:
                status = self.provider.cancel(scene["task_id"])
                if status != "SUCCEEDED":
                    scene["state"] = "failed" if status == "FAILED" else "cancelled"
        job.update(state="cancelled", error="Stopped locally; cloud work may still run or be charged. No refund is promised.",
                   error_kind="cancelled")
        self.save(job)

    def run_job(self, job_id):
        job = self.job(job_id)
        project = self.project(job["project_id"])
        brief = project["brief"]
        folder = self.output / job_id
        try:
            job["state"] = "generating"
            self.save(job)
            for scene in job["scenes"]:
                if self.stop_event.is_set():
                    return
                if self.job(job_id)["cancel_requested"]:
                    self.cancel_job(job)
                    return
                if scene["state"] == "completed":
                    continue
                if scene["state"] == "submitting" and not scene.get("task_id"):
                    raise SubmissionUnknown("Interrupted during submission. Reconcile this scene in Runway before resubmitting.")
                if not scene.get("task_id"):
                    scene["state"] = "submitting"
                    self.save(job)
                    try:
                        scene["task_id"] = self.provider.submit(
                            folder / f"{scene['view']}.jpg", scene["prompt"], brief["aspect_ratio"],
                            scene["seconds"], brief["seed"])
                    except SubmissionUnknown:
                        raise
                    except ProviderError as error:
                        scene["state"] = "failed"
                        job.update(state="failed", error=str(error), error_kind="paid_retry")
                        self.save(job)
                        return
                    scene["state"] = "generating"
                    self.save(job)
                deadline = time.monotonic() + 20 * 60
                poll_delay = self.provider.poll_interval
                while True:
                    if self.stop_event.is_set():
                        return
                    if self.job(job_id)["cancel_requested"]:
                        self.cancel_job(job)
                        return
                    task = self.provider.retrieve(scene["task_id"])
                    state = task.get("status")
                    if state == "SUCCEEDED":
                        urls = task.get("output")
                        if not isinstance(urls, list) or not urls or not isinstance(urls[0], str):
                            raise ProviderError("Runway reported success without video output. Resume to reconcile this task, not a new paid generation.")
                        destination = folder / f"scene-{scene['index']}-{scene['attempt']}.mp4"
                        self.provider.download(urls[0], destination)
                        verify_video(destination, expected_duration=scene["seconds"])
                        scene.update(state="completed", file=destination.name)
                        self.save(job)
                        break
                    if state in {"FAILED", "CANCELLED"}:
                        scene["state"] = "failed" if state == "FAILED" else "cancelled"
                        job.update(state="failed", error=f"Runway scene {scene['index'] + 1} {state.lower()}. Check moderation/account details in the dashboard. A new generation costs extra.",
                                   error_kind="paid_retry")
                        self.save(job)
                        return
                    if state not in {"PENDING", "THROTTLED", "RUNNING"}:
                        raise ProviderError("Runway returned an unrecognized task state. Resume polling this same task.")
                    if time.monotonic() >= deadline:
                        raise ProviderError("Polling paused after 20 minutes. Resume this existing task without an additional generation charge.")
                    self.stop_event.wait(poll_delay)
                    poll_delay = min(15, poll_delay * 1.5)
            if self.job(job_id)["cancel_requested"]:
                job.update(state="cancelled", error="Stopped before local editing. Cloud scenes may already be charged.", error_kind="cancelled")
                self.save(job)
                return
            job["state"] = "editing"
            self.save(job)
            duration = self.editor(folder, brief, job["scenes"])
            verify_video(folder / "video.mp4", expected_duration=project["plan"]["final_seconds"])
            row = dict(id=job_id, title=brief["brand_name"] or "AI product mockup",
                       caption=f"{brief['formatted_price']}\n{brief['cta']}\nAI-generated product mockup — review before sharing.",
                       status="draft", duration=duration, created_at=now(), channel=None, scheduled_at=None)
            with self.db() as conn:
                conn.execute("""INSERT OR IGNORE INTO videos
                    (id,title,caption,status,duration,created_at,channel,scheduled_at)
                    VALUES (:id,:title,:caption,:status,:duration,:created_at,:channel,:scheduled_at)""", row)
                job["state"] = "completed"
                conn.execute("UPDATE generation_jobs SET state='completed',error=NULL,error_kind=NULL,updated_at=? WHERE id=?", (now(), job_id))
        except SubmissionUnknown as error:
            job.update(state="failed", error=str(error), error_kind="submission_unknown")
            self.save(job)
            LOG.warning("Job %s requires manual submission reconciliation.", job_id)
        except Exception as error:
            # Do not log provider exception bodies, images, prompts, keys, or signed output URLs.
            LOG.error("Job %s failed (%s).", job_id, type(error).__name__)
            job.update(state="failed", error=str(error) if isinstance(error, ProviderError) else
                       "Local editing or decoding failed. Check FFmpeg and your audio. Resume reuses existing cloud tasks without new generation charges.",
                       error_kind="resume")
            self.save(job)

    def confirm(self, project_id, confirmed, cost):
        project = self.project(project_id)
        if project is None:
            raise ValueError("Project not found.")
        if confirmed is not True or cost != project["plan"]["estimated_cost_usd"]:
            raise ValueError("Confirm the displayed USD estimate before paid generation.")
        scenes = [dict(s, state="pending", task_id=None, attempt=1) for s in project["plan"]["scenes"]]
        with self.db() as conn:
            conn.execute("""INSERT OR IGNORE INTO generation_jobs
                (id,project_id,state,scenes,authorized_usd,created_at,updated_at) VALUES (?,?,'queued',?,?,?,?)""",
                (project_id, project_id, json.dumps(scenes), cost, now(), now()))
        return self.job(project_id)

    def retry(self, job_id, payload, request_key):
        fingerprint = json.dumps(payload, sort_keys=True)
        with self.db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            previous = conn.execute("SELECT * FROM job_commands WHERE request_key=?", (request_key,)).fetchone()
            if previous:
                if previous["job_id"] != job_id or previous["fingerprint"] != fingerprint:
                    raise ValueError("Retry key was already used for a different request.")
                return
            row = conn.execute("SELECT * FROM generation_jobs WHERE id=?", (job_id,)).fetchone()
            if row is None or row["state"] not in {"failed", "cancelled"}:
                raise ValueError("Only a stopped job can be resumed or retried.")
            if row["error_kind"] == "submission_unknown":
                raise ValueError("Reconcile the uncertain submission with its Runway task ID first. Automatic resubmission is blocked.")
            scenes = json.loads(row["scenes"])
            cost = Decimal("0.00")
            if payload.get("mode") == "scene":
                index = payload.get("scene_index")
                if type(index) is not int or index < 0 or index >= len(scenes):
                    raise ValueError("Choose a valid failed scene.")
                scene = scenes[index]
                if scene["state"] not in {"failed", "cancelled"}:
                    raise ValueError("Only a definitively failed/cancelled scene can be regenerated. Resume existing tasks for download/edit failures.")
                if payload.get("expected_attempt") != scene["attempt"]:
                    raise ValueError("This scene already changed. Refresh before confirming another paid attempt.")
                cost = Decimal("0.25")
                if payload.get("confirmed") is not True or payload.get("estimated_cost_usd") != f"{cost:.2f}":
                    raise ValueError("Confirm the additional USD 0.25 scene cost before retrying.")
                scene.setdefault("history", []).append(dict(task_id=scene.get("task_id"), attempt=scene["attempt"], file=scene.get("file")))
                scene.update(state="pending", task_id=None, attempt=scene["attempt"] + 1)
            elif payload.get("mode") == "resume":
                if any(s["state"] in {"failed", "cancelled"} for s in scenes):
                    raise ValueError("A failed/cancelled scene needs an explicitly confirmed paid retry.")
            else:
                raise ValueError("Choose resume or scene retry.")
            conn.execute("INSERT INTO job_commands VALUES (?,?,?)", (request_key, job_id, fingerprint))
            conn.execute("""UPDATE generation_jobs SET state='queued',scenes=?,cancel_requested=0,error=NULL,
                error_kind=NULL,authorized_usd=?,updated_at=? WHERE id=?""",
                (json.dumps(scenes), f"{Decimal(row['authorized_usd']) + cost:.2f}", now(), job_id))
