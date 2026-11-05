"""Original ShopReelAI template renderer using MoviePy and Pillow."""
from pathlib import Path
import os
import textwrap
import warnings

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from moviepy import (AudioFileClip, CompositeAudioClip, CompositeVideoClip, ImageClip,
                     VideoFileClip, concatenate_videoclips, vfx)

WIDTH, HEIGHT = 720, 1280
PALETTES = {
    "studio": ("#F5EFE5", "#172C24", "#DB603D"),
    "midnight": ("#111E2B", "#F7F4ED", "#9BE3CB"),
}


def font(size, bold=False):
    """Use common OS fonts; Pillow's default is a portable final fallback."""
    candidates = [
        os.getenv("SHOPREEL_FONT_BOLD" if bold else "SHOPREEL_FONT", ""),
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


def wrapped(draw, text, y, *, size, color, max_width=600, max_lines=4, bold=False):
    chosen = font(size, bold)
    words, lines, current = text.split(), [], ""
    for word in words:
        # Split long unbroken tokens too, so pasted IDs cannot run off the canvas.
        pieces = textwrap.wrap(word, width=max(1, int(max_width / size * 1.5))) or [word]
        for piece in pieces:
            candidate = f"{current} {piece}".strip()
            if draw.textlength(candidate, font=chosen) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = piece
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(".") + "…"
    for line in lines:
        while draw.textlength(line, font=chosen) > max_width and len(line) > 1:
            line = line[:-2] + "…"
        draw.text((60, y), line, font=chosen, fill=color)
        y += int(size * 1.35)
    return y


def make_frames(product_image, title, description, price, cta, theme):
    bg, ink, accent = PALETTES[theme]
    with Image.open(product_image) as original:
        product = ImageOps.exif_transpose(original).convert("RGB")
        product = ImageOps.contain(product, (560, 570))
    frames = []
    for index in range(3):
        canvas = Image.new("RGB", (WIDTH, HEIGHT), bg)
        draw = ImageDraw.Draw(canvas)
        draw.text((60, 58), "SHOPREEL / PRODUCT STORY", font=font(20, True), fill=accent)
        draw.rounded_rectangle((60, 125, 660, 735), radius=28, fill="#FFFFFF")
        canvas.paste(product, ((WIDTH - product.width) // 2, 145 + (570 - product.height) // 2))
        if index == 0:
            y = wrapped(draw, title, 780, size=53, color=ink, max_lines=3, bold=True)
            wrapped(draw, "Meet your next favorite.", max(y + 24, 1030), size=29, color=accent, max_lines=2)
        elif index == 1:
            wrapped(draw, description, 785, size=37, color=ink, max_lines=6)
        else:
            y = wrapped(draw, title, 785, size=43, color=ink, max_lines=2, bold=True)
            wrapped(draw, price, y + 24, size=60, color=accent, max_lines=1, bold=True)
            draw.rounded_rectangle((60, 1080, 660, 1165), radius=22, fill=accent)
            wrapped(draw, cta, 1100, size=30, color=bg, max_width=560, max_lines=1, bold=True)
        draw.text((60, 1215), f"PRODUCT SPOTLIGHT  /  0{index + 1}", font=font(18), fill=ink)
        frames.append(canvas)
    return frames


def render_video(folder, fields, *, seconds_per_scene=3, fps=24):
    frames = make_frames(folder / "product.png", **fields)
    frames[0].save(folder / "poster.jpg", quality=90)
    clips = [ImageClip(np.asarray(frame)).with_duration(seconds_per_scene) for frame in frames]
    final = concatenate_videoclips(clips)
    try:
        final.write_videofile(str(folder / "video.mp4"), fps=fps, codec="libx264",
                              audio=False, preset="ultrafast", threads=2, logger=None,
                              ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"])
    finally:
        final.close()
        for clip in clips:
            clip.close()
    return seconds_per_scene * 3


def verify_video(path, expected_duration=None):
    """Decode every frame before a job can be marked completed."""
    with Path(path).open("rb") as source:
        if source.read(12)[4:8] != b"ftyp":
            raise ValueError("Expected a real MP4 container, not a playlist or renamed file.")
    with VideoFileClip(str(path), audio=False) as clip:
        if not clip.duration or not clip.fps or min(clip.size) < 64 or clip.duration > 15:
            raise ValueError("Video has invalid dimensions, frame rate or duration.")
        if expected_duration is not None and abs(clip.duration - expected_duration) > 0.25:
            raise ValueError("Video duration differs from the confirmed scene plan.")
        frames = 0
        with warnings.catch_warnings():
            # MoviePy otherwise substitutes the last readable frame for truncated media.
            warnings.simplefilter("error", UserWarning)
            for frame in clip.iter_frames():
                if frame.shape[:2] != (clip.h, clip.w):
                    raise ValueError("Video frame could not be decoded.")
                frames += 1
        if frames < int(clip.duration * clip.fps) - 1:
            raise ValueError("Video is truncated.")
        return clip.duration


def srt_time(seconds):
    milliseconds = round(seconds * 1000)
    return f"{milliseconds // 3600000:02}:{milliseconds // 60000 % 60:02}:{milliseconds // 1000 % 60:02},{milliseconds % 1000:03}"


def assemble_video(folder, brief, scenes):
    """Only real cloud clips enter the timeline; price/CTA are local deterministic graphics."""
    size = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (960, 960)}[brief["aspect_ratio"]]
    width, height = size
    opened, clips, overlays, subtitles = [], [], [], []
    final = None
    elapsed = 0
    try:
        for scene in scenes:
            source = VideoFileClip(str(folder / scene["file"]))
            opened.append(source)
            clip = source.without_audio().subclipped(0, scene["seconds"]).with_effects([
                vfx.Resize(new_size=size)])
            clips.append(clip)
            if brief["captions"]:
                layer = Image.new("RGBA", size, (0, 0, 0, 0))
                draw = ImageDraw.Draw(layer)
                y = height - 160
                draw.rectangle((30, y - 10, width - 30, y + 100), fill=(15, 25, 20, 220))
                wrapped(draw, scene["caption"], y, size=28, color="white", max_width=width - 120, max_lines=2)
                overlay = ImageClip(np.asarray(layer)).with_start(elapsed).with_duration(scene["seconds"])
                overlays.append(overlay)
                subtitles.append((elapsed, elapsed + scene["seconds"], scene["caption"]))
            elapsed += scene["seconds"]
        card = Image.new("RGB", size, "#172C24")
        draw = ImageDraw.Draw(card)
        if brief["brand_name"]:
            wrapped(draw, brief["brand_name"], int(height * .18), size=34, color="#F5EFE5", max_width=width - 120, max_lines=2)
        wrapped(draw, brief["formatted_price"], int(height * .38), size=48, color="#F5EFE5", max_width=width - 120, max_lines=2, bold=True)
        wrapped(draw, brief["cta"], int(height * .57), size=32, color="#F5EFE5", max_width=width - 120, max_lines=3)
        wrapped(draw, "AI product mockup - review before sharing", height - 90, size=18, color="#DBDCCF", max_width=width - 120, max_lines=2)
        if (folder / "logo.png").exists():
            with Image.open(folder / "logo.png") as original:
                logo = ImageOps.contain(original.convert("RGBA"), (150, 100))
                card.paste(logo, (width - logo.width - 50, 30), logo)
        end = ImageClip(np.asarray(card)).with_duration(2)
        clips.append(end)
        subtitles.append((elapsed, elapsed + 2, f"{brief['formatted_price']}\n{brief['cta']}"))
        timeline = concatenate_videoclips(clips, method="compose")
        opened.append(timeline)
        final = CompositeVideoClip([timeline, *overlays], size=size)
        if brief["audio"] == "uploaded":
            audio_tracks = []
            for filename, volume in (("music.audio", .25), ("voice.audio", 1.0)):
                if (folder / filename).exists():
                    audio = AudioFileClip(str(folder / filename))
                    opened.append(audio)
                    audio_tracks.append(audio.subclipped(0, min(audio.duration, elapsed + 2)).with_volume_scaled(volume))
            if not audio_tracks:
                raise ValueError("Audio was requested but no recording/music was saved.")
            mixed = CompositeAudioClip(audio_tracks).with_duration(elapsed + 2)
            opened.append(mixed)
            final = final.with_audio(mixed)
        Image.fromarray(final.get_frame(.5)).convert("RGB").save(folder / "poster.jpg", quality=90)
        temporary = folder / "assembled.mp4"
        final.write_videofile(str(temporary), fps=24, codec="libx264", audio_codec="aac",
                              preset="ultrafast", threads=2, logger=None,
                              ffmpeg_params=["-pix_fmt", "yuv420p", "-movflags", "+faststart"])
        verify_video(temporary, expected_duration=elapsed + 2)
        temporary.replace(folder / "video.mp4")
        if brief["captions"]:
            (folder / "subtitles.srt").write_text("\n\n".join(
                f"{i}\n{srt_time(start)} --> {srt_time(stop)}\n{caption}"
                for i, (start, stop, caption) in enumerate(subtitles, 1)) + "\n", encoding="utf-8")
        return elapsed + 2
    finally:
        if final:
            final.close()
        for clip in reversed(opened + clips + overlays):
            clip.close()
