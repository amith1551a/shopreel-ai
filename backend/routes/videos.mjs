/**
 * GET /api/videos - List all videos
 * GET /media/:videoId/:filename - Serve video/image files
 * Mirrors Flask's video listing and media serving routes
 */

import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../..');

export async function getVideosRoute(req, res, next) {
  try {
    // Phase 1: Return empty list (no database yet)
    // Will be replaced in Phase 2 with database queries
    const videos = [];
    
    res.json({
      videos,
      count: videos.length,
      message: 'Phase 1: Database integration coming in Phase 2',
    });
  } catch (err) {
    next(err);
  }
}

export async function getMediaRoute(req, res, next) {
  try {
    const { videoId, filename } = req.params;

    // Validate parameters
    if (!videoId || !filename) {
      return res.status(400).json({ error: 'Missing videoId or filename' });
    }

    // Prevent directory traversal attacks
    if (videoId.includes('..') || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Construct safe file path
    const filePath = resolve(ROOT, 'outputs', videoId, filename);
    const outputBase = resolve(ROOT, 'outputs');

    // Verify file is within outputs directory
    if (!filePath.startsWith(outputBase)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get file stats
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }

    // Set MIME type based on extension
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      mp4: 'video/mp4',
      webm: 'video/webm',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aac: 'audio/aac',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Support range requests for video streaming
    if (req.headers.range) {
      const range = req.headers.range;
      const positions = range.replace(/bytes=/, '').split('-');
      const start = parseInt(positions[0], 10);
      const end = positions[1] ? parseInt(positions[1], 10) : stats.size - 1;

      if (isNaN(start) || isNaN(end)) {
        return res.status(416).json({ error: 'Invalid range' });
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', chunkSize);
      res.sendFile(filePath, { start, end });
    } else {
      res.setHeader('Content-Length', stats.size);
      res.sendFile(filePath);
    }
  } catch (err) {
    next(err);
  }
}
