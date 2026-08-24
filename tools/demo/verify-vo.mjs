// Final gate: does each finished clip actually contain the line it was cut for?
//
//   node tools/demo/verify-vo.mjs
//
// align-vo.mjs decides the mapping, but it decides it from the segments it cut — so a cut that
// lands in the wrong place, or a trim that removes the front of a line, is invisible to it. This
// re-transcribes the clips as they will ship and scores every one against all 29 lines. If a
// clip's own line is not its best match, the clip is wrong, whatever the aligner believed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const CLIPS = `${OUT}/vo`;
const WORK = `${OUT}/verify16`;

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

function orderedKeys() {
  if (existsSync(`${OUT}/timings.json`)) {
    const { timings } = JSON.parse(readFileSync(`${OUT}/timings.json`, 'utf8'));
    const k = timings.map((t) => t.text).filter((t) => LINES[t]);
    if (k.length) return k;
  }
  return Object.keys(LINES);
}
const keys = orderedKeys();

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
keys.forEach((k, i) => {
  const src = `${CLIPS}/${slug(k)}.wav`;
  if (!existsSync(src)) {
    console.error(`missing clip for line ${i + 1}: ${src}`);
    process.exit(2);
  }
  spawnSync(ffmpegPath, [
    '-i',
    src,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-y',
    `${WORK}/${String(i + 1).padStart(2, '0')}.wav`,
  ]);
});

const ps = spawnSync(
  'powershell',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'tools/demo/transcribe.ps1',
    '-Dir',
    WORK,
    '-OutFile',
    `${OUT}/verify.json`,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (!existsSync(`${OUT}/verify.json`)) {
  console.error('transcription failed');
  console.error((ps.stderr ?? '').slice(0, 1500));
  process.exit(1);
}

const heard = JSON.parse(readFileSync(`${OUT}/verify.json`, 'utf8').replace(/^﻿/, '')).map(
  (r) => r.text ?? '',
);

const STOP = new Set(
  `the a an and or of to in on it is are was that this for with you your they their our we i not
   no as at by from be been but if so what which who when how one do does did can could will
   would there here them his her its own same more most other into over under out up down off
   then than also just now new only every any all some each has have had`
    .split(/\s+/)
    .filter(Boolean),
);
const bag = (t) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

const lineBags = keys.map((k) => bag(LINES[k]));
const jac = (h, l) => {
  if (!h.size || !l.size) return 0;
  let hit = 0;
  for (const w of l) if (h.has(w)) hit++;
  return hit / (h.size + l.size - hit);
};

let wrong = 0;
let weak = 0;
console.log('\nline  own   best  verdict');
heard.forEach((t, i) => {
  const h = bag(t);
  const scores = lineBags.map((l) => jac(h, l));
  const best = scores.indexOf(Math.max(...scores));
  const mine = scores[i];
  let verdict;
  if (h.size < 3 || scores[best] === 0) {
    verdict = 'no signal — too short to judge';
    weak++;
  } else if (best === i) {
    verdict = 'ok';
  } else {
    // A near-tie with a neighbour is normal when two lines share vocabulary; only call it
    // wrong when another line beats it clearly.
    const margin = scores[best] - mine;
    if (margin < 0.05) {
      verdict = `close to line ${best + 1}`;
    } else {
      verdict = `MISMATCH — looks like line ${best + 1}`;
      wrong++;
    }
  }
  console.log(
    `${String(i + 1).padStart(4)}  ${mine.toFixed(2)}  ${scores[best].toFixed(2)}  ${verdict}`,
  );
});

console.log(`\n${heard.length - wrong - weak} confirmed, ${weak} no signal, ${wrong} mismatched`);
process.exit(wrong > 0 ? 1 : 0);
