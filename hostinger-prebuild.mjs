#!/usr/bin/env node
/**
 * Hostinger Pre-Build Setup
 * 
 * Hostinger's deployment environment sometimes skips devDependencies.
 * This script ensures all build-time tools are available before build.
 * 
 * Run before: npm run build
 * Triggered by: package.json postinstall hook (if npm is configured correctly)
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

// Check if this is a Hostinger-like environment
const isHostinger = () => {
  // Hostinger environments typically have minimal or cached node_modules
  const tscPath = resolve(ROOT, 'node_modules', '.bin', 'tsc');
  const vitePath = resolve(ROOT, 'node_modules', '.bin', 'vite');
  return !existsSync(tscPath) || !existsSync(vitePath);
};

// Install with explicit devDependencies if needed
if (isHostinger()) {
  console.log('ℹ️  Hostinger environment detected: ensuring devDependencies...');
  
  const result = spawnSync('npm', ['install', '--include=dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  
  if (result.status !== 0) {
    console.error('❌ Failed to install devDependencies');
    process.exit(1);
  }
  
  console.log('✅ DevDependencies installed successfully');
} else {
  console.log('✅ All build tools already available');
}
