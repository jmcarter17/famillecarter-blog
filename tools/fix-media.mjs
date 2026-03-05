#!/usr/bin/env node
/**
 * Fix WordPress-export-to-markdown media layout for Hugo.
 *
 * - Collect referenced images/<filename> from markdown in content/**
 * - Copy those images from content/(posts|pages)/images into static/images
 * - Rewrite markdown:
 *    - image embeds: ![](images/foo.jpg) -> ![](/images/foo.jpg)
 *    - linked images to old WP host:
 *         [![](images/thumb.jpg)](http(s)://.../wp-content/uploads/.../orig.jpg)
 *      becomes
 *         ![](/images/thumb.jpg)
 * - Leaves the rest unchanged.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'content');
const STATIC_IMAGES_DIR = path.join(ROOT, 'static', 'images');

const WP_UPLOAD_RE = /^https?:\/\/famillecarter\.com\/blog\/wp-content\/uploads\//i;

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function uniq(arr) {
  return [...new Set(arr)];
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function main() {
  await fs.mkdir(STATIC_IMAGES_DIR, { recursive: true });

  const mdFiles = [];
  for await (const f of walk(CONTENT_DIR)) {
    if (f.endsWith('.md')) mdFiles.push(f);
  }

  const referenced = new Set();

  for (const file of mdFiles) {
    let text = await fs.readFile(file, 'utf8');

    // Capture images/<filename> occurrences
    const re = /\bimages\/([^\s\)\]\"']+)/g;
    let m;
    while ((m = re.exec(text))) {
      referenced.add(m[1]);
    }

    // Rewrite links that wrap one or more images and point to WP uploads -> remove link, keep inner images
    // Handles cases like: [![](... )![](...)](http...wp-content/uploads/...)
    text = text.replace(
      /\[(.*?)\]\((https?:\/\/[^\)]+)\)/gs,
      (full, inner, link) => {
        if (!WP_UPLOAD_RE.test(link)) return full;
        if (!inner.includes('![')) return full;
        return inner.replace(/\(images\//g, '(/images/');
      },
    );

    // Rewrite remaining embeds from images/... to /images/...
    text = text.replace(/\(!\[[^\]]*\]\)\(images\//g, '$1(/images/');

    await fs.writeFile(file, text);
  }

  // Copy referenced images into static/images
  const candidates = [
    path.join(CONTENT_DIR, 'posts', 'images'),
    path.join(CONTENT_DIR, 'pages', 'images'),
  ];

  const missing = [];
  const normalizeNames = (n) => {
    const variants = [n];
    // Try decodeURIComponent, and also + => space
    try {
      const dec = decodeURIComponent(n);
      variants.push(dec);
      variants.push(dec.replace(/\+/g, ' '));
    } catch {
      variants.push(n.replace(/\+/g, ' '));
    }
    // Sometimes percent signs were double-encoded in the XML (e.g. %25C3)
    try {
      const dec2 = decodeURIComponent(variants[variants.length - 1]);
      variants.push(dec2);
      variants.push(dec2.replace(/\+/g, ' '));
    } catch {}

    return [...new Set(variants)];
  };

  for (const name of referenced) {
    const outName = normalizeNames(name)[0];
    const out = path.join(STATIC_IMAGES_DIR, outName);
    if (await exists(out)) continue;

    let found = null;
    let srcName = null;
    for (const candidateName of normalizeNames(name)) {
      for (const c of candidates) {
        const p = path.join(c, candidateName);
        if (await exists(p)) { found = p; srcName = candidateName; break; }
      }
      if (found) break;
    }

    if (!found) {
      missing.push(name);
      continue;
    }

    const finalOut = path.join(STATIC_IMAGES_DIR, srcName);
    await fs.copyFile(found, finalOut);
  }

  console.log(`Referenced images: ${referenced.size}`);
  console.log(`Copied to static/images: ${referenced.size - missing.length}`);
  if (missing.length) {
    console.log(`Missing (${missing.length}):`);
    console.log(missing.slice(0, 50).join('\n'));
    if (missing.length > 50) console.log('...');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
