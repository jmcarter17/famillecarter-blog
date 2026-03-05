#!/usr/bin/env node
/**
 * Fix posts where WP has image files that don't appear in Hugo output.
 *
 * Input: blog_compare_report_v2.json (created by audit)
 * Strategy:
 * - For each problem with issue type "missing_image_files":
 *   - Extract the WP uploads URL basenames (filenames)
 *   - Ensure each file exists in static/images (download from WP if missing)
 *   - Ensure the post markdown references the image filename; if not, append a small
 *     "Photos" section with embeds for the missing filenames.
 *
 * This doesn't guarantee perfect placement vs the original WP layout, but it ensures
 * no images silently disappear.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const reportPath = path.join(repoRoot, '..', 'blog_compare_report_v2.json');
const postsDir = path.join(repoRoot, 'content', 'posts');
const staticImagesDir = path.join(repoRoot, 'static', 'images');

function decodeMaybe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function basenameFromUrl(u) {
  const url = new URL(u);
  return decodeMaybe(path.posix.basename(url.pathname));
}

function urlEncodeSpaces(name) {
  // only spaces; keep accents and other chars as-is (Hugo will encode in HTML as needed)
  return name.replace(/ /g, '%20');
}

async function download(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn('curl', ['-L', '--fail', '--silent', '--show-error', url, '-o', destPath]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl failed (${code}): ${url}\n${err}`));
    });
  });
}

function normalizeForSearch(s) {
  return s.toLowerCase();
}

async function main() {
  const reportRaw = await fs.readFile(reportPath, 'utf8');
  const report = JSON.parse(reportRaw);

  await fs.mkdir(staticImagesDir, { recursive: true });

  // Build a case-insensitive lookup of existing static images.
  const existing = await fs.readdir(staticImagesDir).catch(() => []);
  const existingMap = new Map();
  for (const f of existing) existingMap.set(f.toLowerCase(), f);

  const problems = report.problems || [];

  let postsTouched = 0;
  let imagesAdded = 0;
  let imagesDownloaded = 0;
  let imagesSkipped = 0;

  for (const p of problems) {
    const slug = p.slug;
    const issues = p.issues || [];
    const missingIssue = issues.find((i) => i.type === 'missing_image_files');
    if (!missingIssue) continue;

    const postPath = path.join(postsDir, `${slug}.md`);
    let md;
    try {
      md = await fs.readFile(postPath, 'utf8');
    } catch {
      // some posts may have different filenames; skip for now
      continue;
    }

    const mdNorm = normalizeForSearch(md);

    // Unique missing URLs (audit includes http+https duplicates)
    const urls = Array.from(new Set((missingIssue.examples || []).map(String)));

    const filenames = [];
    for (const u of urls) {
      let fname;
      try {
        fname = basenameFromUrl(u);
      } catch {
        continue;
      }
      if (!fname) continue;
      if (!fname.includes('.')) continue;

      // Prefer existing file in static/images (case-insensitive) if present.
      const existingActual = existingMap.get(fname.toLowerCase());
      if (existingActual) fname = existingActual;

      if (!filenames.includes(fname)) filenames.push(fname);

      const dest = path.join(staticImagesDir, fname);
      try {
        await fs.access(dest);
      } catch {
        // Try to download; if it fails (404 etc.), skip rather than aborting.
        const candidates = urls
          .filter((x) => {
            try {
              return basenameFromUrl(x).toLowerCase() === fname.toLowerCase();
            } catch {
              return false;
            }
          })
          .sort((a, b) => (b.startsWith('https://') ? 1 : 0) - (a.startsWith('https://') ? 1 : 0));

        const srcUrl = candidates[0] || u;
        try {
          await download(srcUrl, dest);
          existingMap.set(fname.toLowerCase(), fname);
          imagesDownloaded++;
        } catch {
          imagesSkipped++;
          // don't add a reference if we couldn't fetch and it's not present
          const idx = filenames.indexOf(fname);
          if (idx >= 0) filenames.splice(idx, 1);
        }
      }
    }

    // Determine which of these filenames are actually missing from markdown
    const trulyMissing = [];
    for (const fname of filenames) {
      const needle1 = normalizeForSearch(fname);
      const needle2 = normalizeForSearch(urlEncodeSpaces(fname));
      if (mdNorm.includes(needle1) || mdNorm.includes(needle2)) continue;
      trulyMissing.push(fname);
    }

    if (!trulyMissing.length) continue;

    // Append a small section
    let append = '\n\n---\n\n### Photos (restored from the original blog)\n';
    for (const fname of trulyMissing) {
      const ref = `/images/${urlEncodeSpaces(fname)}`;
      append += `\n\n![](${ref})`;
      imagesAdded++;
    }

    await fs.writeFile(postPath, md + append + '\n', 'utf8');
    postsTouched++;
  }

  console.log(
    `Done. Posts touched: ${postsTouched}. Images referenced/added: ${imagesAdded}. Images downloaded: ${imagesDownloaded}. Images skipped (unfetchable): ${imagesSkipped}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
