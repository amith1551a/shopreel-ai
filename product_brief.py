"""Validated, saved product briefs and deterministic cost/scene plans."""
from decimal import Decimal, InvalidOperation
import re
from urllib.parse import urlsplit

DEFAULT_CTA = "Shop now — link in bio."
CTA_OPTIONS = (DEFAULT_CTA, "Tap to shop", "Visit our store")
CURRENCIES = {"USD": 2, "EUR": 2, "GBP": 2, "CAD": 2, "AUD": 2, "INR": 2, "JPY": 0, "KWD": 3}
RATIOS = {"9:16": "720:1280", "16:9": "1280:720", "1:1": "960:960"}
RATE = Decimal("0.05")
DURATIONS = (5, 10)


def text(form, key, limit, default="", required=False):
    value = form.get(key, default).strip()
    if (required and not value) or len(value) > limit or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise ValueError(f"{key.replace('_', ' ').capitalize()} must be {'1–' if required else 'at most '}{limit} characters.")
    return value


def money(value, currency):
    if currency not in CURRENCIES:
        raise ValueError("Choose a supported currency.")
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,9}(?:\.\d{1,3})?", value):
        raise ValueError("Enter a positive price using digits and a decimal point, without currency symbols.")
    try:
        amount = Decimal(value)
        quantum = Decimal(1).scaleb(-CURRENCIES[currency])
        if amount <= 0 or amount > Decimal("999999999") or amount != amount.quantize(quantum):
            raise ValueError("Price has too many decimal places or is outside the allowed range.")
    except InvalidOperation as error:
        raise ValueError("Enter a valid price.") from error
    return f"{amount:.{CURRENCIES[currency]}f}", f"{currency} {amount:,.{CURRENCIES[currency]}f}"


def validate_brief(form):
    currency = form.get("currency", "USD")
    amount, formatted = money(form.get("price", ""), currency)
    prompt = text(form, "prompt", 600, required=True)
    # Leave room for non-negotiable generation constraints within Runway's 1000 UTF-16 units.
    if len(prompt.encode("utf-16-le")) // 2 > 600:
        raise ValueError("Prompt must be at most 600 UTF-16 characters.")
    choice = form.get("cta_choice", DEFAULT_CTA)
    if choice not in (*CTA_OPTIONS, "custom"):
        raise ValueError("Choose a supported call to action.")
    cta = text(form, "cta", 80, required=True) if choice == "custom" else choice
    duration = form.get("duration", "5")
    if duration not in {str(n) for n in DURATIONS}:
        raise ValueError("Choose 5 or 10 generated seconds.")
    ratio = form.get("aspect_ratio", "9:16")
    style = form.get("style", "faceless")
    if ratio not in RATIOS or style not in {"faceless", "visible-model"}:
        raise ValueError("Choose a supported aspect ratio and model style.")
    captions = form.get("captions", "on")
    audio = form.get("audio", "silent")
    language = form.get("voiceover_language", "none")
    if captions not in {"on", "off"} or audio not in {"silent", "uploaded"} or language not in {"none", "en", "es", "fr", "hi", "ja", "other"}:
        raise ValueError("Choose supported captions, audio and voiceover language settings.")
    if audio == "silent" and language != "none":
        raise ValueError("Voiceover language applies to an uploaded recording. Automatic speech is not connected.")
    url = text(form, "product_url", 500)
    if url:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or any(c.isspace() for c in url):
            raise ValueError("Product URL must be an HTTPS address without credentials. It is saved, never fetched.")
    return dict(prompt=prompt, price=amount, formatted_price=formatted, currency=currency,
                cta_choice=choice, cta=cta, duration=int(duration), aspect_ratio=ratio, style=style,
                captions=captions == "on", audio=audio, voiceover_language=language,
                brand_name=text(form, "brand_name", 50), product_url=url)


def plan_for(brief, available_views):
    count = brief["duration"] // 5
    scenes = []
    for index in range(count):
        view = brief.get(f"scene_{index}_view", "front")
        if view not in available_views:
            raise ValueError(f"Scene {index + 1} needs an uploaded {view} photo.")
        direction = "Natural movement in the requested setting." if index == 0 else "A closer moving detail view in the same setting, same person and garment."
        style = "Keep all faces out of frame." if brief["style"] == "faceless" else "Use one consistent adult model."
        instruction = (
            f"{brief['prompt']}\n{direction} {style} "
            "Preserve the supplied product's color, artwork and proportions. "
            "Do not add product claims, logos, text, prices or links. Genuine subject motion, not a slideshow."
        )
        if len(instruction.encode("utf-16-le")) // 2 > 1000:
            raise ValueError("Prompt plus scene instructions exceeds the provider limit; shorten your prompt.")
        scenes.append(dict(index=index, seconds=5, view=view, prompt=instruction,
                           caption="AI product mockup" if index == 0 else "Review product details"))
    return dict(
        scenes=scenes, generated_seconds=brief["duration"], final_seconds=brief["duration"] + 2,
        estimated_cost_usd=f"{RATE * brief['duration']:.2f}",
        scene_cost_usd=f"{RATE * 5:.2f}", model="gen4_turbo",
        warnings=[
            "AI-generated product mockups require review; color, artwork, proportions and people may drift.",
            "Unseen views are inferred, not an accurate 360° product scan.",
            "Each scene uses only its selected starting photo. Extra photos are stored but are not simultaneous model references.",
            "The same seed and instructions encourage consistency, but this model does not lock characters or garments across scenes.",
            "Photos and prompt are sent to Runway only after confirmation. Use images, artwork, logos, people and audio you have permission to use.",
            "Cloud generation is paid; local MoviePy editing adds no cloud charge. Moderation/failures and cancellation may still cost credits. No refund is promised.",
            "No social posts are sent. The CTA is text, not a functioning shopping link.",
        ],
    )
