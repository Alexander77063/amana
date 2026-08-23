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
const DRY = process.argv.includes('--dry');

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

const keys = orderedKeys();
console.log(`take       : ${take} (${duration.toFixed(1)}s)`);
console.log(`silences   : ${silences.length} at ${SILENCE_DB}dB / ${SILENCE_SEC}s`);
console.log(`segments   : ${segments.length}`);
console.log(`lines      : ${keys.length}\n`);

segments.forEach((seg, i) => {
  const key = keys[i];
  const len = (seg.end - seg.start).toFixed(1);
  console.log(
    `${String(i + 1).padStart(2)}. ${seg.start.toFixed(1).padStart(6)}s +${len.padStart(5)}s  ${
      key ? key.slice(0, 62) : '— NO LINE FOR THIS SEGMENT —'
    }`,
  );
});

if (segments.length !== keys.length) {
  const hint =
    segments.length > keys.length
      ? '  Likely a re-read, or a pause inside a line. Re-run with SILENCE_SEC=1.8 to ignore shorter gaps.'
      : '  Likely two lines ran together. Re-run with SILENCE_SEC=0.8, or re-record with longer pauses.';
  console.log(
    `\n✗ ${segments.length} spoken segments but ${keys.length} lines.
  Nothing written — mapping the wrong audio to the wrong caption is worse than not splitting.
${hint}\n`,
  );
  process.exit(1);
}

if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

// Trim a touch of the silence back in at each end so lines do not start clipped.
const PAD = 0.15;
segments.forEach((seg, i) => {
  const key = keys[i];
  const file = `${CLIPS}/${slug(key)}.wav`;
  const start = Math.max(0, seg.start - PAD);
  const len = seg.end - seg.start + PAD * 2;
  ffmpegStderr([
    '-ss',
    String(start),
    '-t',
    String(len),
    '-i',
    take,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-y',
    file,
  ]);
  console.log(`  ✓ ${file}`);
});

console.log(`
Next:
  node tools/demo/record.mjs     # re-paces the video to your delivery
  node tools/demo/narrate.mjs    # muxes your voice onto it
`);
