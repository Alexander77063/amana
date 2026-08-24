// Cut one continuous human voiceover take into the per-caption clips the pipeline expects.
//
//   node tools/demo/split-vo.mjs path/to/take.m4a
//   node tools/demo/split-vo.mjs take.m4a --dry     # report the split without writing
//
// Reads the take, finds the silences between spoken lines, and writes one wav per caption into
// out/vo/, named by the same slug narrate.mjs looks for. narrate.mjs already prefers an existing
// clip over speaking one, so once these exist the mux picks up the human voice with no flags.
//
// Tuning, if the split comes out wrong:
//   SILENCE_DB=-35    quieter room / softer voice → try -40; noisy room → -28
//   SILENCE_SEC=1.2   how long a gap must be to count as a line break

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const CLIPS = `${OUT}/vo`;
const SILENCE_DB = Number(process.env.SILENCE_DB ?? -35);
const SILENCE_SEC = Number(process.env.SILENCE_SEC ?? 1.2);
// No narration line is under five seconds, so in automatic mode anything this short is a breath,
// a throat clear, or a false split inside a pause — never a line. Dropping them keeps the segment
// count honest.
//
// A plan, though, is written against audition.mjs's segmentation, which deliberately keeps
// anything over 0.7s so that coughs and false starts stay visible and can be marked `d`. Raising
// the floor in that mode would silently delete segments the plan still counts, shifting every
// line after them onto the wrong audio — so the floor has to match.
const MIN_SEG_SEC = Number(
  process.env.MIN_SEG_SEC ?? (process.argv.some((a) => a.startsWith('--plan=')) ? 0.7 : 1.5),
);
const DRY = process.argv.includes('--dry');

/**
 * Patch mode: `--only=7,12,15` splits a short second take containing just those lines, in that
 * order, and overwrites only their clips. Everything else is left as it is.
 *
 * This is the escape hatch for a re-read that did not separate cleanly in the main take — when
 * a reader restarts a line without a full pause, the fluff and the keeper fuse into one
 * segment, and no amount of silence tuning can pull them apart.
 */
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? '')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

/**
 * Lines the reader fluffed and read again, 1-based, as `--doubled=7,12,15`.
 *
 * A re-read leaves two segments where the script expects one. The SECOND is the good take —
 * the reader stopped, paused, and started that line over — so the first is dropped.
 */
const DOUBLED = new Set(
  (process.argv.find((a) => a.startsWith('--doubled='))?.split('=')[1] ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n > 0),
);

/**
 * `--plan=kkdkj…` — one character per detected segment, produced by audition.mjs.
 *
 *   k  this segment is the next script line
 *   j  this segment continues the line above (a pause mid-sentence split it in two)
 *   d  drop it — fluff, false start, cough, room noise
 *   s  it contains two script lines and needs a finer cut
 *
 * This is the authoritative path when a take cannot be separated by silence alone, because the
 * mapping comes from someone who listened rather than from a heuristic. It must be produced at
 * the SAME detection settings audition.mjs used, so those defaults are matched above.
 */
const PLAN =
  process.argv
    .find((a) => a.startsWith('--plan='))
    ?.split('=')[1]
    ?.trim() ?? '';
if (PLAN && !/^[kjds]+$/.test(PLAN)) {
  console.error(`--plan may only contain k, j, d, s — got ${JSON.stringify(PLAN)}`);
  process.exit(2);
}

const take = process.argv[2];
if (!take || take.startsWith('--')) {
  console.error('usage: node tools/demo/split-vo.mjs <recording> [--dry]');
  process.exit(2);
}
if (!existsSync(take)) {
  console.error(`no such file: ${take}`);
  process.exit(2);
}
mkdirSync(CLIPS, { recursive: true });

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

/** Caption order, taken from the last recording so the script cannot drift from the cut. */
function orderedKeys() {
  if (existsSync(`${OUT}/timings.json`)) {
    const { timings } = JSON.parse(readFileSync(`${OUT}/timings.json`, 'utf8'));
    const keys = timings.map((t) => t.text).filter((t) => LINES[t]);
    if (keys.length) return keys;
  }
  return Object.keys(LINES);
}

/**
 * ffmpeg writes everything interesting — duration, silencedetect results — to stderr, and it
 * does so on success as well as failure. `execFileSync` only surfaces stderr when the process
 * throws, so this uses spawnSync to capture it either way.
 */
function ffmpegStderr(args) {
  const r = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  return String(r.stderr ?? '');
}

const duration = (() => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(ffmpegStderr(['-i', take]));
  if (!m) throw new Error('could not read the recording — is it audio?');
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
})();

// Find the silent gaps. Everything between them is a spoken line.
const detect = ffmpegStderr([
  '-i',
  take,
  '-af',
  `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_SEC}`,
  '-f',
  'null',
  '-',
]);

const silences = [];
for (const line of detect.split('\n')) {
  const start = /silence_start: ([\d.]+)/.exec(line);
  const end = /silence_end: ([\d.]+)/.exec(line);
  if (start) silences.push({ start: Number(start[1]), end: null });
  if (end && silences.length) silences[silences.length - 1].end = Number(end[1]);
}

const segments = [];
let cursor = 0;
for (const s of silences) {
  if (s.start > cursor + 0.25) segments.push({ start: cursor, end: s.start });
  cursor = s.end ?? s.start;
}
if (duration > cursor + 0.25) segments.push({ start: cursor, end: duration });

const dropped = segments.filter((s) => s.end - s.start < MIN_SEG_SEC);
const spoken = segments.filter((s) => s.end - s.start >= MIN_SEG_SEC);

const keys = orderedKeys();

const slugFile = (key) => `${CLIPS}/${slug(key)}.wav`;

/**
 * Cut one span of the take into a clip. A touch of the surrounding silence is kept at each end
 * so lines do not start or finish clipped.
 */
const PAD = 0.15;
function writeClip(key, start, end) {
  const file = slugFile(key);
  ffmpegStderr([
    '-ss',
    String(Math.max(0, start - PAD)),
    '-t',
    String(end - start + PAD * 2),
    '-i',
    take,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-y',
    file,
  ]);
  return file;
}

if (PLAN) {
  if (PLAN.length !== spoken.length) {
    console.log(`take       : ${take} (${duration.toFixed(1)}s)`);
    console.log(
      `segments   : ${spoken.length} at ${SILENCE_DB}dB / ${SILENCE_SEC}s / ${MIN_SEG_SEC}s floor`,
    );
    console.log(`plan       : ${PLAN.length} marks

✗ The plan has ${PLAN.length} marks but this take splits into ${spoken.length} segments.
  Nothing written. Re-run audition.mjs and mark that page — a plan only applies to the
  segmentation it was built against.
`);
    process.exit(1);
  }

  const needSplit = [...PLAN].map((m, i) => (m === 's' ? i + 1 : 0)).filter(Boolean);
  if (needSplit.length) {
    console.log(`
✗ Segments ${needSplit.join(', ')} are marked as containing two lines, which this cut cannot
  separate. Nothing written. Re-run audition.mjs with a shorter gap, e.g.

    SILENCE_SEC=0.9 node tools/demo/audition.mjs ${JSON.stringify(take)}
`);
    process.exit(1);
  }

  // Walk the marks, growing one clip per script line. `j` extends the line in progress across
  // the pause that split it; `d` throws the segment away.
  const built = [];
  [...PLAN].forEach((m, i) => {
    const seg = spoken[i];
    if (m === 'd') return;
    if (m === 'j') {
      if (!built.length)
        throw new Error(`segment ${i + 1} is marked "joins ↑" but nothing precedes it`);
      built[built.length - 1].end = seg.end;
      built[built.length - 1].parts++;
      return;
    }
    built.push({ start: seg.start, end: seg.end, parts: 1 });
  });

  console.log(`take       : ${take} (${duration.toFixed(1)}s)`);
  console.log(
    `segments   : ${spoken.length} → ${built.length} lines (script has ${keys.length})\n`,
  );

  if (built.length !== keys.length) {
    console.log(`✗ The plan yields ${built.length} lines but the script has ${keys.length}.
  Nothing written — a mapping that is off by even one puts every later line on the wrong caption.
`);
    process.exit(1);
  }

  built.forEach((b, i) => {
    const key = keys[i];
    console.log(
      `${String(i + 1).padStart(2)}. ${b.start.toFixed(1).padStart(6)}s +${(b.end - b.start).toFixed(1).padStart(5)}s` +
        `${b.parts > 1 ? ` (${b.parts} parts)` : '        '}  ${key.slice(0, 58)}`,
    );
  });

  if (DRY) {
    console.log('\n--dry: nothing written.');
    process.exit(0);
  }
  built.forEach((b, i) => console.log(`  ✓ ${writeClip(keys[i], b.start, b.end)}`));
  console.log(`
Next:
  node tools/demo/record.mjs     # re-paces the video to your delivery
  node tools/demo/narrate.mjs    # muxes your voice onto it
`);
  process.exit(0);
}

// One entry per segment the take should contain. In patch mode that is just the requested
// lines; otherwise every line, with a doubled one appearing twice.
const expected = [];
if (ONLY.length > 0) {
  for (const n of ONLY) {
    const key = keys[n - 1];
    if (!key) throw new Error(`--only=${n}: there is no line ${n} (${keys.length} lines)`);
    expected.push(key);
  }
} else {
  keys.forEach((key, i) => {
    expected.push(key);
    if (DOUBLED.has(i + 1)) expected.push(key);
  });
}
console.log(`take       : ${take} (${duration.toFixed(1)}s)`);
console.log(`silences   : ${silences.length} at ${SILENCE_DB}dB / ${SILENCE_SEC}s`);
console.log(`segments   : ${segments.length} (${dropped.length} under ${MIN_SEG_SEC}s dropped)`);
console.log(`spoken     : ${spoken.length}`);
console.log(
  ONLY.length > 0
    ? `expected   : ${expected.length} (patching lines ${ONLY.join(', ')})\n`
    : `expected   : ${expected.length} (${keys.length} lines + ${DOUBLED.size} re-reads)\n`,
);

spoken.forEach((seg, i) => {
  const key = expected[i];
  const len = (seg.end - seg.start).toFixed(1);
  console.log(
    `${String(i + 1).padStart(2)}. ${seg.start.toFixed(1).padStart(6)}s +${len.padStart(5)}s  ${
      key ? key.slice(0, 62) : '— NO LINE FOR THIS SEGMENT —'
    }`,
  );
});

if (spoken.length !== expected.length) {
  const hint =
    spoken.length > expected.length
      ? '  Likely a re-read, or a pause inside a line. Re-run with SILENCE_SEC=1.8 to ignore shorter gaps.'
      : '  Likely two lines ran together. Re-run with SILENCE_SEC=0.8, or re-record with longer pauses.';
  console.log(
    `\n✗ ${spoken.length} spoken segments but ${expected.length} expected.
  Nothing written — mapping the wrong audio to the wrong caption is worse than not splitting.
${hint}\n`,
  );
  process.exit(1);
}

if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

// A doubled line writes twice; the later write wins, which is the keeper take.
spoken.forEach((seg, i) => {
  console.log(`  ✓ ${writeClip(expected[i], seg.start, seg.end)}`);
});

console.log(`
Next:
  node tools/demo/record.mjs     # re-paces the video to your delivery
  node tools/demo/narrate.mjs    # muxes your voice onto it
`);
