#!/usr/bin/env node
/**
 * Tidy cases where an image embed directly follows punctuation/text without spacing,
 * e.g. "word.![](/images/x.jpg)" -> "word.\n\n![](/images/x.jpg)".
 *
 * This is a heuristic used after unwrapping link-wrapped images.
 */

import fs from 'node:fs/promises';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node tools/tidy-inline-images.mjs <file> [file...]');
  process.exit(1);
}

async function main() {
  let touched = 0;
  for (const f of files) {
    const s0 = await fs.readFile(f, 'utf8');
    let s = s0;

    // Add spacing before an image if immediately preceded by a non-space.
    s = s.replace(/(\S)(!\[[^\]]*\]\(\/images\/[^)]+\))/g, (_m, a, img) => {
      // If already separated by a newline, leave it.
      if (a === '\n') return _m;
      return `${a}\n\n${img}`;
    });

    // Reduce accidental double exclamation marks like "couleurs!![IMG]" -> "couleurs!\n\n![IMG]"
    s = s.replace(/!!\[/g, '!\n\n![');

    if (s !== s0) {
      await fs.writeFile(f, s, 'utf8');
      touched++;
    }
  }
  console.log(`Done. Touched ${touched} files.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
