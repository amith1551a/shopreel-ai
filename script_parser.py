"""Script parser: Extract timed scenes from full product brief for deterministic compression."""
import re
from typing import Optional, List
from decimal import Decimal


class SceneSegment:
    """A timed scene within a script (e.g., 0-3s, 3-7s)."""
    
    def __init__(self, start_s: int, end_s: int, name: str, prompt: str):
        self.start_s = start_s
        self.end_s = end_s
        self.name = name
        self.prompt = prompt.strip()
    
    def duration_s(self) -> int:
        return self.end_s - self.start_s
    
    def __repr__(self) -> str:
        return f"{self.name} ({self.start_s}-{self.end_s}s): {self.prompt[:50]}..."


class ScriptParser:
    """Parse and compress full product scripts into timed scene prompts."""
    
    # Standard ShopReel timing: Hook, Product, Value, CTA
    DEFAULT_SCENES = [
        (0, 3, "HOOK"),
        (3, 7, "PRODUCT"),
        (7, 11, "VALUE"),
        (11, 15, "CTA"),
    ]
    
    @staticmethod
    def extract_scenes_from_brief(brief_text: str) -> List[SceneSegment]:
        """Extract scene descriptions from structured brief.
        
        Handles:
        - "Scene 1: ...", "Scene 2: ..." format
        - "Hook:", "Product:", "Value:", "CTA:" labels
        - "0-3s", "3-7s" time markers
        """
        scenes = []
        lines = brief_text.split("\n")
        
        # Try Scene N: format first
        scene_pattern = re.compile(r"^\s*(?:Scene\s+)?(\d+)[\):\.]?\s*(.+)", re.IGNORECASE)
        scene_matches = [
            (i, scene_pattern.match(line))
            for i, line in enumerate(lines)
            if scene_pattern.match(line)
        ]
        
        if len(scene_matches) >= 3:
            # We have enough Scene N entries
            for idx, (line_no, match) in enumerate(scene_matches[:4]):
                scene_num = int(match.group(1))
                prompt = match.group(2).strip()
                if idx < len(ScriptParser.DEFAULT_SCENES):
                    start, end, name = ScriptParser.DEFAULT_SCENES[idx]
                    scenes.append(SceneSegment(start, end, name, prompt))
            return scenes
        
        # Try labeled format: Hook, Product, Value, CTA
        labels = {"hook": "HOOK", "product": "PRODUCT", "value": "VALUE", "cta": "CTA"}
        found = {}
        
        for label_key, scene_name in labels.items():
            pattern = re.compile(rf"^\s*{label_key}\s*:?\s*(.+)$", re.IGNORECASE | re.MULTILINE)
            match = pattern.search(brief_text)
            if match:
                found[label_key] = match.group(1).strip()
        
        if len(found) >= 3:
            for (start, end, name), label_key in zip(ScriptParser.DEFAULT_SCENES, labels.keys()):
                prompt = found.get(label_key, "")
                if prompt:
                    scenes.append(SceneSegment(start, end, name, prompt))
            return scenes
        
        # Fallback: return empty scenes with defaults
        for start, end, name in ScriptParser.DEFAULT_SCENES:
            scenes.append(SceneSegment(start, end, name, ""))
        
        return scenes
    
    @staticmethod
    def compress_script(full_script: str, max_chars: int = 1000) -> str:
        """Compress full script into concise scene prompts without losing meaning.
        
        Does NOT use an LLM. Instead:
        1. Extract timed scenes
        2. Remove redundant phrases (product name, currency, URLs)
        3. Keep key product details, dialogue, and CTA
        4. Deterministically merge if needed to fit max_chars
        
        Args:
            full_script: Full product brief
            max_chars: Maximum output characters
            
        Returns:
            Compressed script ready for video generation
        """
        scenes = ScriptParser.extract_scenes_from_brief(full_script)
        
        # Remove common redundant phrases
        redundant = [
            r"\b(?:shop now|link in bio|available at|buy now)\b",
            r"(?:www\.|https?://)\S+",
            r"\$\d+(?:\.\d{2})?",
            r"\b(?:USD|EUR|GBP|CAD|AUD|INR|JPY)\b",
            r"\(.*?\)",
        ]
        
        compressed_scenes = []
        for scene in scenes:
            text = scene.prompt
            # Remove URLs, prices, currencies, and parentheticals
            for pattern in redundant:
                text = re.sub(pattern, "", text, flags=re.IGNORECASE)
            # Clean up extra whitespace
            text = re.sub(r"\s+", " ", text).strip()
            # Truncate scene prompt if needed
            if len(text) > 300:
                text = text[:297] + "..."
            compressed_scenes.append(f"{scene.name}: {text}")
        
        result = " | ".join(s for s in compressed_scenes if s.split(": ")[1])
        
        if len(result) > max_chars:
            # Truncate intelligently, preserving scene structure
            result = result[:max_chars - 3] + "..."
        
        return result or "Product video with scenes at 0-3s (hook), 3-7s (product), 7-11s (value), 11-15s (CTA)."
    
    @staticmethod
    def validate_script(script: str, max_chars: int = 12000) -> Optional[str]:
        """Validate script for generation.
        
        Returns:
            Error message if invalid, None if valid
        """
        if not script or not isinstance(script, str):
            return "Script must be a non-empty string."
        
        if len(script) > max_chars:
            return f"Script exceeds {max_chars} characters."
        
        # Check for control characters except newlines/tabs
        if any(ord(c) < 32 and c not in "\n\r\t" for c in script):
            return "Script contains invalid control characters."
        
        return None


class StoryboardEditor:
    """In-browser editable storyboard: user edits timed scene prompts."""
    
    def __init__(self, scenes: List[SceneSegment]):
        self.scenes = scenes
    
    def to_dict(self) -> dict:
        """Serialize for UI preview."""
        return {
            "scenes": [
                {
                    "id": f"scene-{i}",
                    "start_s": s.start_s,
                    "end_s": s.end_s,
                    "name": s.name,
                    "prompt": s.prompt,
                    "duration_s": s.duration_s(),
                }
                for i, s in enumerate(self.scenes)
            ]
        }
    
    def update_scene(self, scene_index: int, new_prompt: str) -> Optional[str]:
        """User edits a scene prompt in-browser.
        
        Returns:
            Error if scene_index invalid or prompt too long
        """
        if not (0 <= scene_index < len(self.scenes)):
            return f"Invalid scene index: {scene_index}"
        
        if len(new_prompt) > 500:
            return "Scene prompt must be ≤500 characters."
        
        if any(ord(c) < 32 and c not in "\n\r\t" for c in new_prompt):
            return "Scene prompt contains invalid control characters."
        
        self.scenes[scene_index].prompt = new_prompt.strip()
        return None
    
    def to_compressed_script(self) -> str:
        """Serialize edited storyboard into compressed script."""
        result = " | ".join(f"{s.name}: {s.prompt}" for s in self.scenes if s.prompt.strip())
        return result or "Product video"
