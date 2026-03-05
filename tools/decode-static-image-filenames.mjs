#!/usr/bin/env node
/**
 * Rename percent-encoded filenames under static/images to their decoded form.
 *
 * Why: If the filesystem contains a file literally named "Gen%C3%A8ve003.jpg",
 * a browser request to /images/Gen%C3%A8ve003.jpg will be URL-decoded by the server
 * path mapping, and the server will look for "Genève003.jpg" instead.
 *
 * So we store decoded filenames on disk, and keep percent-encoded URLs in Markdown.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const imagesDir = path.join(root, 'static', 'images');

function tryDecode(name) {
  if (!name.includes('%')) return null;
  try {
    const decoded = decodeURIComponent(name);
    if (decoded !== name) return decoded;
  } catch {
    return null;
  }
  return null;
}

async function main() {
  const entries = await fs.readdir(imagesDir);
  let renamed = 0;
  let skipped = 0;

  for (const name of entries) {
    const decoded = tryDecode(name);
    if (!decoded) continue;

    const from = path.join(imagesDir, name);
    const to = path.join(imagesDir, decoded);

    try {
      await fs.access(to);
      // target already exists; don't overwrite
      skipped++;
      continue;
    } catch {
      // ok
    }

    await fs.rename(from, to);
    renamed++;
  }

  console.log(`Done. Renamed: ${renamed}. Skipped (target exists): ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
