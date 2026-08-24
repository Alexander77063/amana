// Recover the caption order from the recorder itself, without recording.
//
//   node tools/demo/caption-order.mjs            # print the order
//   node tools/demo/caption-order.mjs --timings  # write out/timings.json for align-vo
//
// WHY THIS EXISTS
// ---------------
// align-vo.mjs maps the Nth spoken segment to the Nth line, and takes its line order from
// out/timings.json — the captions of the last recording. With no recording yet it falls back to
// the DECLARATION order in narration-lines.mjs, and those two are not the same: aligning against
// the declaration order silently mis-assigned seven lines, which verify-vo.mjs caught as a block
// permutation of 18..24.
//
// The true order is not a mystery, though. It is the sequence of `cap()` and `slide()` calls in
// record.mjs, which can simply be read. That removes the chicken-and-egg — you no longer have to
// record once to find out how to cut the audio you want the recording paced to.
//
// `--only-scripted` writes only the captions that have a line in narration-lines.mjs AND were in
// the take, which is how a script that has grown new lines can still be aligned against an older
// recording: pass the new ones as `--skip`.

import { readFileSync, writeFileSync } from 'node:fs';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const src = readFileSync('tools/demo/record.mjs', 'utf8');

const skip = new Set(
  (process.argv.find((a) => a.startsWith('--skip='))?.split('=')[1] ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Pull the headline out of each `cap(chapter, headline, sub)` and `slide(kicker, title, body)`
 * call, in source order. Both take their caption as the SECOND argument.
 */
const order = [];
const call = /\b(cap|slide)\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*,\s*(['"`])((?:\\.|(?!\4).)*)\4/g;
for (const m of src.matchAll(call)) {
  const headline = m[5].replace(/\\'/g, "'").replace(/\\"/g, '"');
  order.push(headline);
}

const scripted = order.filter((t) => LINES[t] !== undefined && !skip.has(t));

if (process.argv.includes('--timings')) {
  // `atMs` is irrelevant to align-vo, which reads only the order — but it is written as a real
  // increasing sequence so the file is not mistaken for a recording's timings.
  writeFileSync(
    `${OUT}/timings.json`,
    JSON.stringify(
      {
        totalMs: 0,
        synthetic: 'caption order recovered from record.mjs — not a real recording',
        timings: scripted.map((text, i) => ({ chapter: '', text, atMs: i * 1000 })),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${OUT}/timings.json with ${scripted.length} captions`);
} else {
  scripted.forEach((t, i) => console.log(`${String(i + 1).padStart(3)}. ${t.slice(0, 76)}`));
  console.log(`\n${order.length} captions in record.mjs, ${scripted.length} with narration lines`);
}
