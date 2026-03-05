#!/usr/bin/env node
/**
 * Generate monthly archive pages under content/months/YYYY-MM/_index.md
 *
 * Each month page includes params.monthKey = "YYYY-MM".
 * Template will list posts in that month.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, 'content', 'posts');
const monthsDir = path.join(repoRoot, 'content', 'months');

function monthKeyFromFrontMatter(md) {
  const m = md.match(/^date:\s*([0-9]{4})-([0-9]{2})-[0-9]{2}/m);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

async function main() {
  const posts = await fs.readdir(postsDir);
  const keys = new Set();

  for (const file of posts) {
    if (!file.endsWith('.md')) continue;
    const p = path.join(postsDir, file);
    const md = await fs.readFile(p, 'utf8');
    const key = monthKeyFromFrontMatter(md);
    if (key) keys.add(key);
  }

  await fs.mkdir(monthsDir, { recursive: true });

  const sorted = Array.from(keys).sort();
  let created = 0;
  let existing = 0;

  for (const key of sorted) {
    const dir = path.join(monthsDir, key);
    const idx = path.join(dir, '_index.md');
    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.access(idx);
      existing++;
      continue;
    } catch {
      // create
    }

    const content = `---\ntitle: "${key}"\ndate: ${key}-01\nmonthKey: "${key}"\n---\n\n`;
    await fs.writeFile(idx, content, 'utf8');
    created++;
  }

  console.log(`Done. Month pages created: ${created}. Already existed: ${existing}. Total months: ${sorted.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
