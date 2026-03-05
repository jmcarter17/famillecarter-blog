#!/usr/bin/env node
/**
 * Convert link-wrapped images like:
 *   [![Alt](/images/foo.jpg)](https://famillecarter.com/blog/.../foo/)
 * to plain images:
 *   ![Alt](/images/foo.jpg)
 *
 * We do this for any link target pointing at famillecarter.com/blog/... because these
 * attachment-permalink wrappers are legacy WP noise and can confuse audits.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const postsDir = path.join(repoRoot, 'content', 'posts');

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

async function main() {
  const files = await walk(postsDir);
  let touched = 0;

  // [![alt](IMG)](LINK)
  const re = /\[!\[(?<alt>[^\]]*)\]\((?<img>\/images\/[^)\s]+)\)\]\((?<link>https?:\/\/famillecarter\.com\/blog\/[^)\s]+)\)/g;

  for (const f of files) {
    const s0 = await fs.readFile(f, 'utf8');
    const s1 = s0.replace(re, (_m, ...args) => {
      const groups = args.at(-1);
      const alt = groups?.alt ?? '';
      const img = groups?.img;
      if (!img) return _m;
      return `![${alt}](${img})`;
    });

    if (s1 !== s0) {
      await fs.writeFile(f, s1, 'utf8');
      touched++;
    }
  }

  console.log(`Done. Updated ${touched} posts.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
