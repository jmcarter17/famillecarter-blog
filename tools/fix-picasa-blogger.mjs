#!/usr/bin/env node
/**
 * Fix old Picasa/Blogger image embeds:
 * - Downloads external images (bp.blogspot.com, photos*.blogger.com, etc.) into static/images
 * - Rewrites Markdown to use /images/<filename>
 * - Removes link-wrapping around images that point to the external host
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = process.cwd();
const contentDir = path.join(repoRoot, 'content', 'posts');
const staticImagesDir = path.join(repoRoot, 'static', 'images');

const interestingHosts = [
  'bp.blogspot.com',
  'blogger.googleusercontent.com',
  'googleusercontent.com',
  'ggpht.com',
  'photos1.blogger.com',
  'photos2.blogger.com',
  'photos3.blogger.com',
  'photos4.blogger.com',
];

function isInterestingUrl(u) {
  try {
    const url = new URL(u);
    return interestingHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function safeFilename(name) {
  return name.replace(/[\x00-\x1F\x7F]/g, '').replace(/[\\/]/g, '_');
}

function decodePathBasename(p) {
  let b = path.posix.basename(p);
  try { b = decodeURIComponent(b); } catch {}
  return safeFilename(b);
}

function filenameFromUrl(u) {
  const url = new URL(u);
  const base = decodePathBasename(url.pathname);
  if (base && base !== '/' && base !== '.') return base;
  const h = crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
  return `external-${h}`;
}

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

async function download(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn('curl', ['-L', '--fail', '--silent', '--show-error', url, '-o', destPath]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`curl failed (${code}): ${url}\n${err}`))));
  });
}

async function ensureDownloaded(url, preferredFilename) {
  const filename = preferredFilename || filenameFromUrl(url);
  const dest = path.join(staticImagesDir, filename);
  try {
    await fs.access(dest);
    return filename;
  } catch {
    await download(url, dest);
    return filename;
  }
}

function replaceAllAsync(str, regex, asyncReplacer) {
  const matches = [];
  str.replace(regex, (...args) => {
    matches.push(args);
    return '';
  });
  return (async () => {
    let out = str;
    for (const m of matches) {
      const full = m[0];
      const replacement = await asyncReplacer(...m);
      out = out.replace(full, replacement);
    }
    return out;
  })();
}

async function main() {
  await fs.mkdir(staticImagesDir, { recursive: true });

  const files = await walk(contentDir);
  let touched = 0;
  let downloaded = 0;

  for (const file of files) {
    let s = await fs.readFile(file, 'utf8');
    let changed = false;

    // [![](images/foo.jpg)](https://external/...)
    const reLinkedThumb = /\[!\[(?<alt>[^\]]*)\]\((?<thumb>images\/[^)]+)\)\]\((?<url>https?:\/\/[^)\s]+)\)/g;
    s = await replaceAllAsync(s, reLinkedThumb, async (full, ...args) => {
      const groups = args.at(-1);
      const alt = groups?.alt ?? '';
      const url = groups?.url;
      const thumb = groups?.thumb;
      if (!url || !thumb || !isInterestingUrl(url)) return full;

      const preferred = decodePathBasename(thumb);
      const before = await fs.readdir(staticImagesDir).catch(() => []);
      const beforeSet = new Set(before);

      const fname = await ensureDownloaded(url, preferred);
      if (!beforeSet.has(fname)) downloaded++;

      changed = true;
      return `![${alt}](/images/${fname})`;
    });

    // direct embed ![](https://external/...)
    const reDirect = /!\[(?<alt>[^\]]*)\]\((?<url>https?:\/\/[^)\s]+)\)/g;
    s = await replaceAllAsync(s, reDirect, async (full, ...args) => {
      const groups = args.at(-1);
      const alt = groups?.alt ?? '';
      const url = groups?.url;
      if (!url || !isInterestingUrl(url)) return full;

      const before = await fs.readdir(staticImagesDir).catch(() => []);
      const beforeSet = new Set(before);

      const fname = await ensureDownloaded(url);
      if (!beforeSet.has(fname)) downloaded++;

      changed = true;
      return `![${alt}](/images/${fname})`;
    });

    // unwrap: [![](/images/foo)](https://external/...) -> ![](/images/foo)
    const reWrapLocalToExternal = /\[(!\[[^\]]*\]\(\/images\/[^)]+\))\]\((?<url>https?:\/\/[^)\s]+)\)/g;
    s = s.replace(reWrapLocalToExternal, (m, inner, url) => {
      if (!isInterestingUrl(url)) return m;
      changed = true;
      return inner;
    });

    // normalize images/foo -> /images/foo (if that file exists)
    const reRelLocal = /!\[(?<alt>[^\]]*)\]\((?<p>images\/[^)\s]+)\)/g;
    s = await replaceAllAsync(s, reRelLocal, async (full, ...args) => {
      const groups = args.at(-1);
      const alt = groups?.alt ?? '';
      const rel = groups?.p;
      if (!rel) return full;
      const fname = decodePathBasename(rel);
      try {
        await fs.access(path.join(staticImagesDir, fname));
      } catch {
        return full;
      }
      changed = true;
      return `![${alt}](/images/${fname})`;
    });

    if (changed) {
      await fs.writeFile(file, s, 'utf8');
      touched++;
    }
  }

  console.log(`Done. Updated ${touched} posts. Downloaded ${downloaded} new images.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
