#!/usr/bin/env node
/**
 * Scan markdown files under content/ for /images/<file> references and report which are missing from static/images.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const contentDir = path.join(repoRoot, 'content');
const staticImagesDir = path.join(repoRoot, 'static', 'images');

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && p.endsWith('.md')) out.push(p);
  }
  return out;
}

function decodeUrlPath(p) {
  // p may contain %20 etc
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

async function main() {
  const existing = new Set((await fs.readdir(staticImagesDir).catch(() => [])).map((f) => f));
  const existingLower = new Map();
  for (const f of existing) existingLower.set(f.toLowerCase(), f);

  const mdFiles = await walk(contentDir);
  const missingByFile = new Map();

  const re = /\]\((\/images\/[^)\s]+)\)/g;

  for (const f of mdFiles) {
    const s = await fs.readFile(f, 'utf8');
    const misses = [];
    for (const m of s.matchAll(re)) {
      const ref = m[1];
      const rawName = ref.replace(/^\/images\//, '');
      const decodedName = decodeUrlPath(rawName);

      // Accept either raw (percent-encoded) filenames or decoded filenames.
      if (existing.has(rawName) || existing.has(decodedName)) continue;
      const altRaw = existingLower.get(rawName.toLowerCase());
      const altDecoded = existingLower.get(decodedName.toLowerCase());
      if (altRaw || altDecoded) continue; // case mismatch only

      // Prefer reporting the decoded version for readability.
      misses.push(decodedName);
    }
    if (misses.length) missingByFile.set(path.relative(repoRoot, f), Array.from(new Set(misses)));
  }

  const files = Array.from(missingByFile.keys()).sort();
  let total = 0;
  for (const f of files) total += missingByFile.get(f).length;

  console.log(`Files with missing images: ${files.length}`);
  console.log(`Total missing image references: ${total}`);

  for (const f of files) {
    console.log(`\n- ${f}`);
    for (const img of missingByFile.get(f)) {
      console.log(`  - ${img}`);
    }
  }

  if (files.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
