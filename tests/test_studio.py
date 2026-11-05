import io
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from urllib.error import URLError, HTTPError

import numpy as np
from PIL import Image
from moviepy import VideoClip, VideoFileClip

from app import create_app
from product_brief import DEFAULT_CTA, money
from provider import ProviderError, RunwayProvider, SubmissionUnknown
from video_engine import assemble_video, make_frames, verify_video


class FakeProvider:
    model = "gen4_turbo"
    configured = True
    poll_interval = 0

    def __init__(self, source):
        self.source = source
        self.submissions = []
        self.states = []
        self.failure = None
        self.cancelled = []
        self.download_error = False

    def submit(self, image, prompt, ratio, seconds, seed):
        self.submissions.append((image, prompt, ratio, seconds, seed))
        if self.failure:
            raise self.failure
        return f"task-{len(self.submissions)}"

    def retrieve(self, task_id):
        state = self.states.pop(0) if self.states else "SUCCEEDED"
        if isinstance(state, Exception):
            raise state
        return dict(id=task_id, status=state, output=["https://example.cloudfront.net/output.mp4"])

    def download(self, url, destination):
        if self.download_error:
            raise ProviderError("Synthetic download failure; resume original task.")
        shutil.copyfile(self.source, destination)

    def cancel(self, task_id):
        self.cancelled.append(task_id)
        return "RUNNING"


class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.assets = tempfile.TemporaryDirectory()
        cls.source = Path(cls.assets.name) / "moving.mp4"
        cls.final = Path(cls.assets.name) / "final.mp4"
        cls.long_final = Path(cls.assets.name) / "long-final.mp4"

        def frame(t):
            image = np.zeros((128, 160, 3), dtype=np.uint8)
            x = int(t * 20) % 120
            image[30:90, x:x + 40] = (220, 100, 60)
            return image
        for path, duration in [(cls.source, 5), (cls.final, 7), (cls.long_final, 12)]:
            with VideoClip(frame_function=frame, duration=duration) as clip:
                clip.write_videofile(str(path), fps=8, codec="libx264", audio=False, logger=None,
                                     ffmpeg_params=["-pix_fmt", "yuv420p"])

    @classmethod
    def tearDownClass(cls):
        cls.assets.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.provider = FakeProvider(self.source)
        self.app = create_app(self.root, provider=self.provider, editor=self.fake_editor, start_worker=False)
        self.app.config["TESTING"] = True
        self.studio = self.app.extensions["studio"]
        self.client = self.app.test_client()
        self.headers = {"X-Studio-Token": self.app.config["CSRF_TOKEN"], "Idempotency-Key": "test-project-key-0001"}

    def tearDown(self):
        self.studio.close()
        self.temp.cleanup()

    def fake_editor(self, folder, brief, scenes):
        shutil.copyfile(self.long_final if brief["duration"] == 10 else self.final, folder / "video.mp4")
        Image.new("RGB", (160, 128), "tan").save(folder / "poster.jpg")
        if brief["captions"]:
            (folder / "subtitles.srt").write_text("1\n00:00:00,000 --> 00:00:05,000\nAI product mockup\n")
        return brief["duration"] + 2

    def image(self, size=(160, 160), content="PNG"):
        image = io.BytesIO()
        Image.new("RGB", size, "coral").save(image, format=content)
        image.seek(0)
        return image, "product." + content.lower()

    def form(self, **changes):
        values = dict(image=self.image(), prompt="An adult wearing this tee beside a parked bike. Natural movement.",
                      price="24.00", captions="on")
        values.update(changes)
        return values

    def project(self, **changes):
        response = self.client.post("/api/projects", data=self.form(**changes), headers=self.headers)
        self.assertIn(response.status_code, (200, 201), response.json)
        return response.json["project"]

    def confirm(self, project=None):
        project = project or self.project()
        response = self.client.post(f"/api/projects/{project['id']}/generate", json={
            "confirmed": True, "estimated_cost_usd": project["plan"]["estimated_cost_usd"]}, headers=self.headers)
        self.assertEqual(response.status_code, 202, response.json)
        return response.json["job"]

    def generate(self, **changes):
        job = self.confirm(self.project(**changes))
        self.studio.run_once()
        return self.studio.job(job["id"])

    def retry(self, job, **body):
        return self.client.post(f"/api/jobs/{job['id']}/retry", json=body,
                                headers={**self.headers, "Idempotency-Key": "test-retry-key-0001"})

    def test_home_default_form_and_security(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        for phrase in (b"Video prompt (required)", b"Advanced settings", b"Product photo (required)", b"Tell viewers what to do"):
            self.assertIn(phrase, response.data)
        self.assertNotIn(b"What makes it special?", response.data)
        self.assertIn("default-src", response.headers["Content-Security-Policy"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_host_token_and_retired_route_guards(self):
        self.assertEqual(self.client.post("/api/projects", data=self.form()).status_code, 403)
        self.assertEqual(self.client.get("/", headers={"Host": "evil.example:5050"}).status_code, 403)
        self.assertEqual(self.client.post("/api/videos", data=self.form(), headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get("/", headers={"Host": "localhost:5050"}).status_code, 200)

    def test_defaults_plan_is_free_and_keeps_settings(self):
        project = self.project()
        self.assertEqual(self.provider.submissions, [])
        self.assertEqual(project["brief"]["cta"], DEFAULT_CTA)
        self.assertEqual(project["brief"]["currency"], "USD")
        self.assertEqual(project["brief"]["style"], "faceless")
        self.assertEqual(project["brief"]["aspect_ratio"], "9:16")
        self.assertEqual(project["plan"]["estimated_cost_usd"], "0.25")
        self.assertEqual(project["plan"]["final_seconds"], 7)
        self.assertEqual(self.client.get("/api/projects/" + project["id"]).json["project"], project)

    def test_default_and_custom_cta(self):
        self.assertEqual(self.project(cta_choice="custom", cta="See the artwork")["brief"]["cta"], "See the artwork")
        for choice in ("Tap to shop", "Visit our store"):
            with self.subTest(choice=choice):
                result = self.client.post("/api/projects", data=self.form(cta_choice=choice),
                    headers={**self.headers, "Idempotency-Key": "unique-" + choice.replace(" ", "-") + "-000000"})
                self.assertEqual(result.status_code, 201)
                self.assertEqual(result.json["project"]["brief"]["cta"], choice)

    def test_decimal_currency_formatting(self):
        self.assertEqual(money("1234.5", "USD"), ("1234.50", "USD 1,234.50"))
        self.assertEqual(money("2000", "JPY"), ("2000", "JPY 2,000"))
        self.assertEqual(money("1.234", "KWD"), ("1.234", "KWD 1.234"))
        self.assertEqual(money("0.10", "EUR"), ("0.10", "EUR 0.10"))
        for value, currency in [("NaN", "USD"), ("Infinity", "USD"), ("0", "USD"), ("-1", "USD"),
                                ("2.001", "USD"), ("12.5", "JPY"), ("1", "XYZ"), ("$24", "USD"),
                                ("1e3", "USD"), ("1,234", "USD")]:
            with self.subTest(value=value, currency=currency), self.assertRaises(ValueError):
                money(value, currency)

    def test_invalid_inputs(self):
        cases = [dict(prompt=""), dict(prompt="x" * 601), dict(price=""), dict(currency="bad"),
                 dict(cta_choice="custom", cta=""), dict(cta_choice="custom", cta="x" * 81),
                 dict(duration="6"), dict(style="unknown"), dict(aspect_ratio="4:3"),
                 dict(brand_name="x" * 51), dict(product_url="file:///private"),
                 dict(product_url="https://user:pass@example.com"), dict(audio="invalid"),
                 dict(voiceover_language="en"), dict(prompt="hello\0world"), dict(cta_choice="bad")]
        for changes in cases:
            with self.subTest(changes=changes):
                result = self.client.post("/api/projects", data=self.form(**changes), headers=self.headers)
                self.assertEqual(result.status_code, 400, result.json)
        self.assertEqual(list(self.studio.output.iterdir()), [])

    def test_invalid_images_and_dimensions(self):
        for upload in [(io.BytesIO(b"bad"), "photo.png"), self.image((50, 50)),
                       self.image(content="GIF"), (*self.image(), "image/jpeg"),
                       (io.BytesIO(b"x" * (8 * 1024 * 1024 + 1)), "photo.png")]:
            result = self.client.post("/api/projects", data=self.form(image=upload), headers=self.headers)
            self.assertEqual(result.status_code, 400)
        values = self.form(); del values["image"]
        self.assertEqual(self.client.post("/api/projects", data=values, headers=self.headers).status_code, 400)
        self.assertEqual(list(self.studio.output.iterdir()), [])

    def test_audio_validation_requires_decodable_recording(self):
        for changes in (dict(audio="uploaded"), dict(music=(io.BytesIO(b"audio"), "music.wav")),
                        dict(audio="uploaded", music=(io.BytesIO(b"bad"), "music.wav")),
                        dict(audio="uploaded", voiceover_language="en", music=(io.BytesIO(b"bad"), "music.wav"))):
            with self.subTest(changes=list(changes)):
                response = self.client.post("/api/projects", data=self.form(**changes), headers=self.headers)
                self.assertEqual(response.status_code, 400, response.json)
        self.assertEqual(list(self.studio.output.iterdir()), [])

    def test_reference_views_and_multiscene_plan(self):
        project = self.project(duration="10", back=self.image(), scene_1_view="back")
        self.assertEqual(project["plan"]["estimated_cost_usd"], "0.50")
        self.assertEqual(project["plan"]["scenes"][1]["view"], "back")
        self.assertTrue((self.studio.output / project["id"] / "back.png").exists())
        self.assertEqual(len(project["plan"]["scenes"]), 2)

    def test_missing_reference_rejected(self):
        result = self.client.post("/api/projects", data=self.form(scene_0_view="back"), headers=self.headers)
        self.assertEqual(result.status_code, 400)

    def test_plan_upload_idempotency_and_conflict(self):
        first = self.project()
        self.assertEqual(self.project()["id"], first["id"])
        self.assertEqual(len(list(self.studio.output.iterdir())), 1)
        response = self.client.post("/api/projects", data=self.form(price="25"), headers=self.headers)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.client.post("/api/projects", data=self.form(), headers={"X-Studio-Token": self.headers["X-Studio-Token"]}).status_code, 400)

    def test_simultaneous_uploads_create_only_one_saved_project(self):
        def upload():
            return self.app.test_client().post("/api/projects", data=self.form(), headers=self.headers)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: upload(), range(2)))
        self.assertEqual(sorted(r.status_code for r in responses), [200, 201])
        self.assertEqual(responses[0].json["project"]["id"], responses[1].json["project"]["id"])
        self.assertEqual(len(list(self.studio.output.iterdir())), 1)

    def test_simultaneous_paid_confirmations_submit_only_one_cloud_task(self):
        project = self.project()
        def confirm():
            return self.app.test_client().post(f"/api/projects/{project['id']}/generate", json={
                "confirmed": True, "estimated_cost_usd": "0.25"}, headers=self.headers)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda _: confirm(), range(2)))
        self.assertTrue(all(r.status_code == 202 for r in responses))
        self.studio.run_once()
        self.assertEqual(len(self.provider.submissions), 1)

    def test_missing_credentials_and_placeholders(self):
        self.provider.configured = False
        project = self.project()
        response = self.client.post(f"/api/projects/{project['id']}/generate", json={"confirmed": True, "estimated_cost_usd": "0.25"}, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertIn("RUNWAYML_API_SECRET", response.json["error"])
        self.assertEqual(self.provider.submissions, [])
        with patch.dict(os.environ, {"RUNWAYML_API_SECRET": "replace_with_your_runway_developer_api_key"}):
            self.assertFalse(RunwayProvider().configured)

    def test_explicit_cost_confirmation_required(self):
        project = self.project()
        for body in ({}, {"confirmed": False, "estimated_cost_usd": "0.25"}, {"confirmed": True, "estimated_cost_usd": ".25"}):
            result = self.client.post(f"/api/projects/{project['id']}/generate", json=body, headers=self.headers)
            self.assertEqual(result.status_code, 400)
        self.assertEqual(self.provider.submissions, [])

    def test_cost_cap(self):
        with patch.dict(os.environ, {"SHOPREEL_MAX_GENERATION_USD": "0.10"}):
            app = create_app(self.root, provider=self.provider, start_worker=False)
        result = app.test_client().post("/api/projects", data=self.form(), headers={
            "X-Studio-Token": app.config["CSRF_TOKEN"], "Idempotency-Key": "cap-test-key-0001"})
        self.assertEqual(result.status_code, 400)

    def test_queued_generate_and_duplicate_confirmation(self):
        project = self.project()
        first, second = self.confirm(project), self.confirm(project)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["state"], "queued")
        self.assertEqual(self.provider.submissions, [])
        self.studio.run_once(); self.studio.run_once()
        job = self.studio.job(first["id"])
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(len(self.provider.submissions), 1)
        self.assertEqual(job["video"]["status"], "draft")
        self.assertEqual(verify_video(self.studio.output / job["id"] / "video.mp4"), 7)
        self.assertEqual(self.confirm(project)["state"], "completed")

    def test_provider_failure_has_no_success_and_paid_retry_requires_consent(self):
        self.provider.states = ["FAILED"]
        job = self.generate()
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error_kind"], "paid_retry")
        self.assertIsNone(job["video"])
        self.assertEqual(self.retry(job, mode="scene", scene_index=0).status_code, 400)
        self.assertEqual(self.retry(job, mode="resume").status_code, 400)
        body = dict(mode="scene", scene_index=0, expected_attempt=1, confirmed=True, estimated_cost_usd="0.25")
        self.assertEqual(self.retry(job, **body).status_code, 202)
        self.assertEqual(self.retry(job, **body).status_code, 202)
        self.studio.run_once()
        retried = self.studio.job(job["id"])
        self.assertEqual(retried["state"], "completed")
        self.assertEqual(retried["authorized_usd"], "0.50")
        self.assertEqual(len(self.provider.submissions), 2)
        self.assertEqual(retried["scenes"][0]["history"][0]["task_id"], "task-1")

    def test_individual_retry_reuses_other_completed_scenes_and_blocks_stale_retry(self):
        self.provider.states = ["SUCCEEDED", "FAILED"]
        job = self.generate(duration="10")
        self.assertEqual(job["scenes"][0]["state"], "completed")
        first_scene = self.studio.output / job["id"] / job["scenes"][0]["file"]
        original_bytes = first_scene.read_bytes()
        body = dict(mode="scene", scene_index=1, expected_attempt=1, confirmed=True, estimated_cost_usd="0.25")
        self.assertEqual(self.retry(job, **body).status_code, 202)
        self.provider.states = ["FAILED"]
        self.studio.run_once()
        stale = self.client.post(f"/api/jobs/{job['id']}/retry", json=body,
            headers={**self.headers, "Idempotency-Key": "different-retry-key-0002"})
        self.assertEqual(stale.status_code, 400)
        body["expected_attempt"] = 2
        response = self.client.post(f"/api/jobs/{job['id']}/retry", json=body,
            headers={**self.headers, "Idempotency-Key": "different-retry-key-0003"})
        self.assertEqual(response.status_code, 202, response.json)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")
        self.assertEqual(len(self.provider.submissions), 4)
        self.assertEqual(first_scene.read_bytes(), original_bytes)

    def test_definite_submission_rejection_allows_only_confirmed_retry(self):
        self.provider.failure = ProviderError("Runway HTTP 401: check credentials.")
        job = self.generate()
        self.assertEqual(job["error_kind"], "paid_retry")
        self.assertEqual(job["scenes"][0]["state"], "failed")
        self.assertEqual(self.retry(job, mode="resume").status_code, 400)

    def test_success_without_output_is_recoverable_not_success(self):
        self.provider.retrieve = lambda task_id: {"status": "SUCCEEDED", "output": []}
        job = self.generate()
        self.assertEqual(job["state"], "failed")
        self.assertEqual(job["error_kind"], "resume")
        self.assertIsNone(job["video"])

    def test_cancel_known_running_task(self):
        job = self.confirm()
        job["scenes"][0].update(state="generating", task_id="known-running-task")
        self.studio.save(job)
        self.client.post(f"/api/jobs/{job['id']}/cancel", headers=self.headers)
        self.studio.run_once()
        self.assertEqual(self.provider.cancelled, ["known-running-task"])
        self.assertEqual(self.studio.job(job["id"])["state"], "cancelled")
        self.assertEqual(self.studio.job(job["id"])["scenes"][0]["state"], "cancelled")

    def test_submission_timeout_blocks_duplicate_paid_submission(self):
        self.provider.failure = SubmissionUnknown("Uncertain submission")
        job = self.generate()
        self.assertEqual(job["error_kind"], "submission_unknown")
        self.studio.run_once()
        self.confirm(self.studio.project(job["id"]))
        self.assertEqual(self.retry(job, mode="resume").status_code, 400)
        self.assertEqual(len(self.provider.submissions), 1)
        result = self.client.post(f"/api/jobs/{job['id']}/reconcile", json={
            "scene_index": 0, "task_id": "original-task", "original_task": True}, headers=self.headers)
        self.assertEqual(result.status_code, 202, result.json)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")
        self.assertEqual(len(self.provider.submissions), 1)

    def test_recover_known_task_after_restart_without_resubmitting(self):
        job = self.confirm()
        job["state"] = "generating"
        job["scenes"][0].update(state="generating", task_id="previous-task")
        self.studio.save(job)
        second = create_app(self.root, provider=self.provider, editor=self.fake_editor, start_worker=False)
        second.extensions["studio"].run_once()
        self.assertEqual(second.extensions["studio"].job(job["id"])["state"], "completed")
        self.assertEqual(self.provider.submissions, [])

    def test_crash_in_submission_window_is_not_retried(self):
        job = self.confirm()
        job["scenes"][0]["state"] = "submitting"
        self.studio.save(job)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["error_kind"], "submission_unknown")
        self.assertEqual(self.provider.submissions, [])

    def test_download_failure_resumes_existing_task_without_charge(self):
        self.provider.download_error = True
        job = self.generate()
        self.assertEqual(job["error_kind"], "resume")
        self.provider.download_error = False
        self.assertEqual(self.retry(job, mode="resume").status_code, 202)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")
        self.assertEqual(len(self.provider.submissions), 1)

    def test_polling_network_failure_resumes_same_task(self):
        self.provider.states = [ProviderError("Temporary polling outage")]
        job = self.generate()
        self.assertEqual(job["error_kind"], "resume")
        self.assertEqual(self.retry(job, mode="resume").status_code, 202)
        self.studio.run_once()
        self.assertEqual(len(self.provider.submissions), 1)
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")

    def test_invalid_output_never_marks_success(self):
        self.provider.source = Path(self.assets.name) / "corrupt.mp4"
        self.provider.source.write_bytes(b"not-a-video")
        job = self.generate()
        self.assertEqual(job["state"], "failed")
        self.assertIsNone(job["video"])

    def test_edit_failure_can_resume_free(self):
        def broken(*args):
            raise RuntimeError("Synthetic local editing failure")
        self.studio.editor = broken
        job = self.generate()
        self.assertEqual(job["error_kind"], "resume")
        self.studio.editor = self.fake_editor
        self.assertEqual(self.retry(job, mode="resume").status_code, 202)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")
        self.assertEqual(len(self.provider.submissions), 1)

    def test_cancel_before_submission_costs_no_new_request(self):
        job = self.confirm()
        self.assertEqual(self.client.post(f"/api/jobs/{job['id']}/cancel", headers=self.headers).status_code, 200)
        self.studio.run_once()
        self.assertEqual(self.studio.job(job["id"])["state"], "cancelled")
        self.assertEqual(self.provider.submissions, [])

    def test_background_worker_keeps_page_responsive_and_persists_id(self):
        entered, release = threading.Event(), threading.Event()
        original = self.provider.retrieve
        def waiting(task_id):
            entered.set()
            release.wait(5)
            return original(task_id)
        self.provider.retrieve = waiting
        job = self.confirm()
        self.studio.start()
        try:
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.client.get("/").status_code, 200)
            self.assertEqual(self.client.get(f"/api/jobs/{job['id']}").json["job"]["state"], "generating")
        finally:
            release.set()
        deadline = time.monotonic() + 10
        while self.studio.job(job["id"])["state"] != "completed" and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertEqual(self.studio.job(job["id"])["state"], "completed")

    def test_existing_videos_uploads_and_records_preserved(self):
        video_id = "a" * 32
        folder = self.studio.output / video_id
        folder.mkdir()
        for filename, data in [("product.png", b"existing-upload"), ("video.mp4", b"existing-video")]:
            (folder / filename).write_bytes(data)
        row = (video_id, "Existing title", "Original caption", "scheduled_local", 9.0, "2024-01-01", "instagram", "2099-01-01")
        with self.studio.db() as conn:
            conn.execute("INSERT INTO videos VALUES (?,?,?,?,?,?,?,?)", row)
        self.generate()
        second = create_app(self.root, provider=self.provider, start_worker=False)
        with second.extensions["studio"].db() as conn:
            self.assertEqual(tuple(conn.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()), row)
        self.assertEqual((folder / "video.mp4").read_bytes(), b"existing-video")
        self.assertEqual((folder / "product.png").read_bytes(), b"existing-upload")

    def test_additive_migration_backs_up_original_database(self):
        other = self.root / "old-app"
        (other / "data").mkdir(parents=True)
        with closing(sqlite3.connect(other / "data" / "studio.sqlite3")) as conn:
            with conn:
                conn.execute("CREATE TABLE videos (id TEXT PRIMARY KEY, title TEXT, caption TEXT, status TEXT, duration REAL, created_at TEXT, channel TEXT, scheduled_at TEXT)")
                conn.execute("INSERT INTO videos VALUES ('legacy','original','caption','draft',9,'date',NULL,NULL)")
        migrated = create_app(other, provider=self.provider, start_worker=False)
        self.assertEqual(migrated.test_client().get("/api/videos").json["videos"][0]["title"], "original")
        self.assertEqual(len(list((other / "data").glob("studio-before-generator-*.sqlite3"))), 1)

    def test_media_allowlist_range_subtitles_and_approval(self):
        job = self.generate()
        self.assertEqual(self.client.get("/media/not-an-id/video.mp4").status_code, 404)
        self.assertEqual(self.client.get(f"/media/{job['id']}/private.txt").status_code, 404)
        with self.client.get(f"/media/{job['id']}/video.mp4", headers={"Range": "bytes=0-3"}) as response:
            self.assertEqual(response.status_code, 206)
            self.assertEqual(len(response.data), 4)
        with self.client.get(f"/media/{job['id']}/subtitles.srt") as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn(b"00:00:05,000", response.data)
        path = f"/api/videos/{job['id']}"
        future = dict(channel="instagram", scheduled_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
        self.assertEqual(self.client.post(path + "/schedule", json=future, headers=self.headers).status_code, 409)
        self.assertEqual(self.client.post(path + "/approve", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post(path + "/approve", headers=self.headers).status_code, 409)
        scheduled = self.client.post(path + "/schedule", json=future, headers=self.headers)
        self.assertEqual(scheduled.json["status"], "scheduled_local")
        self.assertIn("nothing will publish", scheduled.json["message"])

    def test_schedule_validation(self):
        for body in [[], {"channel": ["instagram"], "scheduled_at": 1}, {"channel": "tiktok", "scheduled_at": "2099-01-01T00:00:00Z"},
                     {"channel": "instagram", "scheduled_at": "2099-01-01T00:00:00"},
                     {"channel": "instagram", "scheduled_at": "2000-01-01T00:00:00Z"}]:
            self.assertEqual(self.client.post("/api/videos/any/schedule", json=body, headers=self.headers).status_code, 400)

    def test_legacy_template_helpers_still_available(self):
        image = self.root / "input.png"
        Image.new("RGB", (100, 100), "tan").save(image)
        for theme in ["studio", "midnight"]:
            frames = make_frames(image, "Existing product", "Original description", "$24", "Shop now", theme)
            self.assertTrue(all(frame.size == (720, 1280) for frame in frames))


class ProviderContractTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, {"RUNWAYML_API_SECRET": "test-key-not-real"}):
            self.provider = RunwayProvider()

    def response(self, value):
        return io.BytesIO(json.dumps(value).encode())

    def test_exact_documented_request_and_no_post_retries(self):
        with tempfile.TemporaryDirectory() as temporary:
            image = Path(temporary) / "image.jpg"
            image.write_bytes(b"synthetic-image")
            with patch.object(self.provider.opener, "open", return_value=self.response({"id": "task-123"})) as opened:
                self.assertEqual(self.provider.submit(image, "Natural movement", "9:16", 5, 123), "task-123")
            req = opened.call_args.args[0]
            body = json.loads(req.data)
            self.assertEqual(req.full_url, "https://api.dev.runwayml.com/v1/image_to_video")
            self.assertEqual(req.get_header("X-runway-version"), "2024-11-06")
            self.assertEqual(body["model"], "gen4_turbo")
            self.assertEqual(body["ratio"], "720:1280")
            self.assertEqual(body["duration"], 5)
            self.assertTrue(body["promptImage"].startswith("data:image/jpeg;base64,"))
            for error in (URLError("timeout"), HTTPError(req.full_url, 500, "server error", {}, None)):
                with patch.object(self.provider.opener, "open", side_effect=error) as opened, self.assertRaises(SubmissionUnknown):
                    self.provider.submit(image, "Natural movement", "9:16", 5, 123)
                self.assertEqual(opened.call_count, 1)

    def test_missing_id_is_uncertain_not_success(self):
        with patch.object(self.provider.opener, "open", return_value=self.response({})):
            with tempfile.TemporaryDirectory() as temporary:
                image = Path(temporary) / "image.jpg"; image.write_bytes(b"image")
                with self.assertRaises(SubmissionUnknown):
                    self.provider.submit(image, "Motion", "9:16", 5, 0)

    def test_cancel_only_in_progress_task(self):
        with patch.object(self.provider, "_request", side_effect=[{"status": "RUNNING"}, {}]) as call:
            self.provider.cancel("task-1")
            self.assertEqual(call.call_args.args, ("DELETE", "/tasks/task-1"))
        with patch.object(self.provider, "_request", return_value={"status": "SUCCEEDED"}) as call:
            self.provider.cancel("task-1")
            self.assertEqual(call.call_count, 1)

    def test_output_url_validation_blocks_arbitrary_fetches(self):
        for url in ["http://example.cloudfront.net/a", "https://127.0.0.1/a", "https://evil.example/a",
                    "https://example.cloudfront.net.evil.example/a", "https://user:pass@example.cloudfront.net/a"]:
            with self.subTest(url=url), patch.object(self.provider.opener, "open") as opened:
                with self.assertRaises(ProviderError):
                    self.provider.download(url, Path("unused.mp4"))
                opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
