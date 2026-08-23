// Print the narration in the order the video actually plays it, numbered, for a human to read
// aloud in one take.
//
//   node tools/demo/read-script.mjs            # to the terminal
//   node tools/demo/read-script.mjs --write    # also writes out/read-script.md
//
// Order comes from out/timings.json — the captions of the last recording — rather than from the
// order the lines happen to be declared in, so the script can never drift from the cut.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
mkdirSync(OUT, { recursive: true });

const ordered = [];
if (existsSync(`${OUT}/timings.json`)) {
  const { timings } = JSON.parse(readFileSync(`${OUT}/timings.json`, 'utf8'));
  for (const t of timings) {
    const line = LINES[t.text];
    if (line) ordered.push({ chapter: t.chapter, key: t.text, line });
  }
} else {
  for (const [key, line] of Object.entries(LINES)) ordered.push({ chapter: '', key, line });
}

const md = [
  '# Amana walkthrough — read this aloud',
  '',
  'Record **one continuous take**. Read the numbered lines in order and leave a clear pause —',
  'about two seconds of silence — between each one. Do not stop the recording between lines;',
  'the pauses are how the take gets cut back into clips.',
  '',
  '**Tone:** calm and factual, unhurried. The product is about control and trust, so overselling',
  'works against it. Let the settled receipt at the end do the closing.',
  '',
  'If you fluff a line, pause, then read that whole line again from the start — and tell me which',
  'number you doubled, so the extra take can be dropped.',
  '',
  `Save the file (m4a, wav or mp3) and tell me where it is. ${ordered.length} lines.`,
  '',
  '---',
  '',
];

let chapter = null;
ordered.forEach((o, i) => {
  if (o.chapter && o.chapter !== chapter) {
    chapter = o.chapter;
    md.push(`### ${chapter}`, '');
  }
  md.push(`**${i + 1}.** ${o.line}`, '');
  md.push(`*(on screen: “${o.key}”)*`, '');
});

const text = md.join('\n');
console.log(text);
if (process.argv.includes('--write')) {
  writeFileSync(`${OUT}/read-script.md`, text);
  console.log(`\n→ ${OUT}/read-script.md`);
}
