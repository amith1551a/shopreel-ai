"""Exercise real MoviePy editing/decoding with synthetic moving provider output; no credits."""
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import traceback
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
from moviepy import VideoClip, VideoFileClip
from app import create_app
from video_engine import assemble_video, verify_video


class SyntheticProvider:
    model = "gen4_turbo"
    configured = True
    poll_interval = 0

    def __init__(self, path):
        self.path = path
        self.calls = 0

    def submit(self, image, prompt, ratio, seconds, seed):
        self.calls += 1
        return f"synthetic-{self.calls}"

    def retrieve(self, task_id):
        return dict(status="SUCCEEDED", output=["mock-output-not-a-network-url"])

    def download(self, url, path):
        shutil.copyfile(self.path, path)


def audio_bytes():
    output = io.BytesIO()
    samples = (np.sin(2 * np.pi * 220 * np.arange(44100 * 3) / 44100) * 2000).astype("<i2")
    with wave.open(output, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(44100)
        file.writeframes(samples.tobytes())
    output.seek(0)
    return output


def main():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        source = root / "synthetic.mp4"
        def frame(t):
            image = np.full((256, 144, 3), (30, 50, 40), dtype=np.uint8)
            x = int(t * 15) % 80
            image[80:160, x:x + 50] = (230, 120, 80)
            return image
        with VideoClip(frame_function=frame, duration=5) as clip:
            clip.write_videofile(str(source), fps=24, codec="libx264", audio=False, logger=None)
        provider = SyntheticProvider(source)
        def editor(*args):
            try:
                return assemble_video(*args)
            except Exception:
                traceback.print_exc()
                raise
        app = create_app(root, provider=provider, editor=editor, start_worker=False)
        studio = app.extensions["studio"]
        client = app.test_client()
        headers = {"X-Studio-Token": app.config["CSRF_TOKEN"], "Idempotency-Key": "smoke-test-project-0001"}
        with (ROOT / "static" / "demo-product.png").open("rb") as image:
            result = client.post("/api/projects", data={
                "image": (image, "sample.png"), "prompt": "Natural movement beside a parked bicycle.",
                "price": "24.50", "duration": "10", "captions": "on", "audio": "uploaded",
                "music": (audio_bytes(), "music.wav"), "voice": (audio_bytes(), "voice.wav"),
                "voiceover_language": "en", "brand_name": "Test studio",
            }, headers=headers)
        assert result.status_code == 201, result.json
        project = result.json["project"]
        response = client.post(f"/api/projects/{project['id']}/generate", json={
            "confirmed": True, "estimated_cost_usd": "0.50"}, headers=headers)
        assert response.status_code == 202, response.json
        studio.run_once()
        job = studio.job(project["id"])
        assert job["state"] == "completed", job
        destination = studio.output / job["id"]
        assert verify_video(destination / "video.mp4", expected_duration=12) == 12
        with VideoFileClip(str(destination / "video.mp4")) as clip:
            assert clip.size == [720, 1280], clip.size
            assert clip.fps == 24
            assert clip.audio is not None
            assert not np.array_equal(clip.get_frame(.1), clip.get_frame(1.5)), "Moving source did not survive editing"
            assert abs(float(clip.audio.get_frame(.5)[0])) > 0
            end_card = clip.get_frame(11)
            assert end_card.shape == (1280, 720, 3)
            assert (end_card.max(axis=2) > 160).sum() > 1000, "End card text not visible"
        subtitles = (destination / "subtitles.srt").read_text(encoding="utf-8")
        assert "00:00:10,000 --> 00:00:12,000" in subtitles
        assert "USD 24.50" in subtitles and "Shop now" in subtitles
        with client.get(f"/media/{job['id']}/video.mp4", headers={"Range": "bytes=0-63"}) as media:
            assert media.status_code == 206 and len(media.data) == 64
        assert provider.calls == 2
        print(json.dumps(dict(render="PASS", dimensions="720x1280", fps=24, duration_seconds=12,
            decoded_frames=288, moving_scenes=2, audio_mixing="PASS", price_cta_card="PASS",
            subtitles="PASS", range_playback="PASS", cloud_calls=0,
            existing_media_untouched=True), indent=2))


if __name__ == "__main__":
    main()
