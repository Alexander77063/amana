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
  'Record **one continuous take**. Read the numbered lines in order, and keep the recorder',
  'running the whole time — the silences are how the take gets cut back into clips.',
  '',
  '## Two rules. Everything depends on them',
  '',
  '**1. Count three full seconds between lines.** Silently: *one — two — three.* Longer than',
  'feels natural. This is the only thing that separates one line from the next.',
  '',
  '**2. Never pause in the middle of a sentence.** Breathe at the line breaks, not inside a line.',
  '',
  'Rule 2 is the one that bit us. On the last take the pauses inside sentences were as long as',
  'the pauses between lines, so nothing could tell them apart — sweeping every plausible setting',
  'moved the segment count from 152 to 8 without ever landing on the right answer. Three seconds',
  'between lines and none inside them puts the two far enough apart that the cut is unambiguous.',
  '',
  'If you fluff a line: stop, wait three seconds, and read **the whole line again from the top**.',
  'Never pick up from the middle, and do not say "sorry" or "again" unless you leave three',
  'seconds around it too. Re-reads are fine and easy to drop — resumed half-lines are not.',
  '',
  '**Tone:** calm and factual, unhurried. The product is about control and trust, so overselling',
  'works against it. Let the settled receipt at the end do the closing.',
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
