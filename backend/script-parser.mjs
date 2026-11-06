/**
 * Script Parser: Extract timed scenes from product brief
 * 
 * Port of Python script_parser.py to Node.js
 * Used by the "Parse & Edit Storyboard" feature
 */

class SceneSegment {
  constructor(startS, endS, name, prompt) {
    this.startS = startS;
    this.endS = endS;
    this.name = name;
    this.prompt = prompt.trim();
  }

  durationS() {
    return this.endS - this.startS;
  }

  toString() {
    const preview = this.prompt.substring(0, 50);
    return `${this.name} (${this.startS}-${this.endS}s): ${preview}...`;
  }
}

class ScriptParser {
  // Standard ShopReel timing: Hook, Product, Value, CTA
  static DEFAULT_SCENES = [
    [0, 3, 'HOOK'],
    [3, 7, 'PRODUCT'],
    [7, 11, 'VALUE'],
    [11, 15, 'CTA'],
  ];

  /**
   * Extract scene descriptions from structured brief.
   * Handles:
   * - "Scene 1: ...", "Scene 2: ..." format
   * - "Hook:", "Product:", "Value:", "CTA:" labels
   * - "0-3s", "3-7s" time markers
   */
  static extractScenesFromBrief(briefText) {
    const scenes = [];
    const lines = briefText.split('\n');

    // Try Scene N: format first
    const scenePattern = /^\s*(?:Scene\s+)?(\d+)[\):\.]?\s*(.+)/i;
    const sceneMatches = lines
      .map((line, i) => ({ line, i, match: scenePattern.exec(line) }))
      .filter(x => x.match);

    if (sceneMatches.length >= 3) {
      // We have enough Scene N entries
      for (let idx = 0; idx < Math.min(sceneMatches.length, 4); idx++) {
        const match = sceneMatches[idx].match;
        const prompt = match[2].trim();
        const [start, end, name] = ScriptParser.DEFAULT_SCENES[idx];
        scenes.push(new SceneSegment(start, end, name, prompt));
      }
      return scenes;
    }

    // Try labeled format: Hook, Product, Value, CTA
    const labels = {
      hook: 'HOOK',
      product: 'PRODUCT',
      value: 'VALUE',
      cta: 'CTA',
    };

    const found = {};

    Object.entries(labels).forEach(([labelKey, sceneName]) => {
      const pattern = new RegExp(`^\\s*${labelKey}\\s*:?\\s*(.+)$`, 'im');
      const match = pattern.exec(briefText);
      if (match) {
        found[labelKey] = match[1].trim();
      }
    });

    if (Object.keys(found).length >= 3) {
      Object.entries(labels).forEach(([labelKey, sceneName]) => {
        const [start, end, name] = ScriptParser.DEFAULT_SCENES[Object.keys(labels).indexOf(labelKey)];
        const prompt = found[labelKey] || '';
        if (prompt) {
          scenes.push(new SceneSegment(start, end, name, prompt));
        }
      });
      return scenes;
    }

    // Fallback: return empty scenes with defaults
    ScriptParser.DEFAULT_SCENES.forEach(([start, end, name]) => {
      scenes.push(new SceneSegment(start, end, name, ''));
    });

    return scenes;
  }

  /**
   * Compress full script into concise scene prompts without losing meaning.
   * No API calls - purely deterministic parsing.
   */
  static compressScript(fullScript, maxChars = 1000) {
    const scenes = ScriptParser.extractScenesFromBrief(fullScript);

    // Remove common redundant phrases
    const redundant = [
      /\b(?:shop now|link in bio|available at|buy now)\b/gi,
      /(?:www\.|https?:\/\/)\S+/g,
      /\$\d+(?:\.\d{2})?/g,
      /\b(?:USD|EUR|GBP|CAD|AUD|INR|JPY)\b/gi,
      /\(.*?\)/g,
    ];

    const compressedScenes = scenes.map(scene => {
      let text = scene.prompt;
      // Remove URLs, prices, currencies, and parentheticals
      redundant.forEach(pattern => {
        text = text.replace(pattern, '');
      });
      // Clean up extra whitespace
      text = text.replace(/\s+/g, ' ').trim();
      // Truncate scene prompt if needed
      if (text.length > 300) {
        text = text.substring(0, 297) + '...';
      }
      return { scene, text };
    });

    const result = compressedScenes
      .filter(x => x.text.length > 0)
      .map(x => `${x.scene.name}: ${x.text}`)
      .join(' | ');

    if (result.length > maxChars) {
      return result.substring(0, maxChars - 3) + '...';
    }

    return result || 'Product video with scenes at 0-3s (hook), 3-7s (product), 7-11s (value), 11-15s (CTA).';
  }

  /**
   * Validate script for generation.
   * Returns error message if invalid, null if valid
   */
  static validateScript(script, maxChars = 12000) {
    if (!script || typeof script !== 'string') {
      return 'Script must be a non-empty string.';
    }

    if (script.length > maxChars) {
      return `Script exceeds ${maxChars} characters.`;
    }

    // Check for control characters except newlines/tabs
    for (let i = 0; i < script.length; i++) {
      const code = script.charCodeAt(i);
      if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
        return 'Script contains invalid control characters.';
      }
    }

    return null;
  }
}

class StoryboardEditor {
  constructor(scenes) {
    this.scenes = scenes;
  }

  toDict() {
    return {
      scenes: this.scenes.map((s, i) => ({
        id: `scene-${i}`,
        start_s: s.startS,
        end_s: s.endS,
        name: s.name,
        prompt: s.prompt,
        duration_s: s.durationS(),
      })),
    };
  }

  updateScene(sceneIndex, newPrompt) {
    if (sceneIndex < 0 || sceneIndex >= this.scenes.length) {
      return `Invalid scene index: ${sceneIndex}`;
    }

    if (newPrompt.length > 500) {
      return 'Scene prompt must be ≤500 characters.';
    }

    // Check for control characters except newlines/tabs
    for (let i = 0; i < newPrompt.length; i++) {
      const code = newPrompt.charCodeAt(i);
      if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
        return 'Scene prompt contains invalid control characters.';
      }
    }

    this.scenes[sceneIndex].prompt = newPrompt.trim();
    return null;
  }

  toCompressedScript() {
    const result = this.scenes
      .filter(s => s.prompt.trim().length > 0)
      .map(s => `${s.name}: ${s.prompt}`)
      .join(' | ');

    return result || 'Product video';
  }
}

export { ScriptParser, StoryboardEditor, SceneSegment };
