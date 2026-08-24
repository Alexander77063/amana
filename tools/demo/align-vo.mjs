// Align a voiceover take to the script by what is actually said, and cut it into per-line clips.
//
//   node tools/demo/align-vo.mjs "path/to/take.m4a"
//   node tools/demo/align-vo.mjs take.m4a --dry     # report the alignment without writing
//
// WHY NOT JUST COUNT SEGMENTS
// ---------------------------
// split-vo.mjs maps the Nth spoken segment to the Nth line. That is right only when every line
// is exactly one segment. One long pause inside a line, plus one short gap between two others,
// leaves the COUNT correct while the mapping is silently wrong in the middle — the worst failure
// available, because it looks like success.
//
// WHY NOT JUST COUNT WORDS
// ------------------------
// A reader's pace is steady enough that words-per-second catches a grossly wrong mapping, and an
// earlier version of this file aligned on exactly that. It is not enough. It cannot tell two
// adjacent lines of similar length apart, and it reads a fluffed line that was read twice as
// "one very slow line", which is precisely the case that shifts everything after it.
//
// SO: ALIGN ON THE WORDS THEMSELVES
// ---------------------------------
// Every segment is transcribed with the offline Windows recogniser and matched against the known
// script by content-word overlap. The recogniser is poor — it hears "on Monday's build 11 idea"
// for "Amana is built on one idea" — but it only has to be right often enough to tell one line
// from another, and content words like wallet, transfer, pairing and airtime survive. A dynamic
// program then finds the best monotonic mapping, allowing a line to span several segments, a
// segment to hold several lines, and a segment to be DROPPED as a fluffed re-read.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const CLIPS = `${OUT}/vo`;
const SEG16 = `${OUT}/seg16`;
const SILENCE_DB = Number(process.env.SILENCE_DB ?? -35);
// Deliberately coarse: find whole blocks first, then cut inside them where needed.
const SILENCE_SEC = Number(process.env.SILENCE_SEC ?? 2.0);
const MIN_SEG_SEC = Number(process.env.MIN_SEG_SEC ?? 1.5);
const MAX_SPAN = 3;
// What it costs to throw a segment away. A transcript this rough scores a correct pairing around
// 0.2-0.35 Jaccard, so a real match costs about 0.65-0.8 and a hopeless one about 1.0. Sitting
// between them means a genuine fluff is dropped while nothing real ever is.
const DROP_COST = Number(process.env.DROP_COST ?? 1.25);
const DRY = process.argv.includes('--dry');
const REUSE = process.argv.includes('--reuse'); // skip re-transcribing while iterating

const take = process.argv[2];
if (!take || take.startsWith('--')) {
  console.error('usage: node tools/demo/align-vo.mjs <recording> [--dry] [--reuse]');
  process.exit(2);
}
if (!existsSync(take)) {
  console.error(`no such file: ${take}`);
  process.exit(2);
}
mkdirSync(CLIPS, { recursive: true });

function ffmpegStderr(args) {
  return String(spawnSync(ffmpegPath, args, { encoding: 'utf8' }).stderr ?? '');
}

const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const duration = (() => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(ffmpegStderr(['-i', take]));
  if (!m) throw new Error('could not read the recording — is it audio?');
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
})();

/** Silent gaps of at least `gap` seconds, optionally within a window of the take. */
function silencesIn(gap, from = 0, to = null) {
  const pre = from ? ['-ss', String(from)] : [];
  const post = to !== null ? ['-t', String(to - from)] : [];
  const out = ffmpegStderr([
    ...pre,
    '-i',
    take,
    ...post,
    '-af',
    `silencedetect=noise=${SILENCE_DB}dB:d=${gap}`,
    '-f',
    'null',
    '-',
  ]);
  const sil = [];
  for (const line of out.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    const e = /silence_end: (-?[\d.]+)/.exec(line);
    if (s) sil.push({ start: Number(s[1]) + from, end: null });
    if (e && sil.length) sil[sil.length - 1].end = Number(e[1]) + from;
  }
  return sil;
}

const segments = [];
let cursor = 0;
for (const s of silencesIn(SILENCE_SEC)) {
  if (s.start > cursor + 0.25) segments.push({ start: cursor, end: s.start });
  cursor = s.end ?? s.start;
}
if (duration > cursor + 0.25) segments.push({ start: cursor, end: duration });
const spoken = segments.filter((s) => s.end - s.start >= MIN_SEG_SEC);

function orderedKeys() {
  if (existsSync(`${OUT}/timings.json`)) {
    const { timings } = JSON.parse(readFileSync(`${OUT}/timings.json`, 'utf8'));
    const keys = timings.map((t) => t.text).filter((t) => LINES[t]);
    if (keys.length) return keys;
  }
  return Object.keys(LINES);
}
const keys = orderedKeys();
const wordsOfKey = (k) => LINES[k].split(/\s+/).filter(Boolean).length;
const words = keys.map(wordsOfKey);

// Running totals so any block's duration and word count are one subtraction away.
const segDur = spoken.map((s) => s.end - s.start);
const prefixDur = [0];
for (const d of segDur) prefixDur.push(prefixDur[prefixDur.length - 1] + d);
const prefixWords = [0];
for (const w of words) prefixWords.push(prefixWords[prefixWords.length - 1] + w);
// The take's own pace, in words per second — the yardstick for whether a block's words fit.
const RATE = prefixWords[words.length] / prefixDur[spoken.length];

console.log(`take       : ${take} (${duration.toFixed(1)}s)`);
console.log(`rate       : ${(RATE * 60).toFixed(0)} wpm`);
console.log(`segments   : ${spoken.length} at ${SILENCE_DB}dB / ${SILENCE_SEC}s`);
console.log(`script     : ${keys.length} lines\n`);

// ── Transcribe every segment ─────────────────────────────────────────────────────────────────
if (!REUSE || !existsSync(`${OUT}/transcript.json`)) {
  rmSync(SEG16, { recursive: true, force: true });
  mkdirSync(SEG16, { recursive: true });
  spoken.forEach((s, i) => {
    ffmpegStderr([
      '-ss',
      String(s.start),
      '-t',
      String(s.end - s.start),
      '-i',
      take,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-y',
      `${SEG16}/${String(i + 1).padStart(2, '0')}.wav`,
    ]);
  });
  console.log('transcribing segments (offline, this takes a minute)…');
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'tools/demo/transcribe.ps1',
      '-Dir',
      SEG16,
      '-OutFile',
      `${OUT}/transcript.json`,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(ps.stdout ?? '');
  if (!existsSync(`${OUT}/transcript.json`)) {
    console.error('transcription failed');
    console.error((ps.stderr ?? '').slice(0, 1500));
    process.exit(1);
  }
}

// PowerShell's Out-File -Encoding utf8 writes a byte-order mark, which JSON.parse rejects.
const heardRaw = JSON.parse(readFileSync(`${OUT}/transcript.json`, 'utf8').replace(/^﻿/, ''));
const heard = (Array.isArray(heardRaw) ? heardRaw : [heardRaw]).map((r) => r.text ?? '');
if (heard.length !== spoken.length) {
  console.error(`transcript has ${heard.length} entries for ${spoken.length} segments`);
  process.exit(1);
}

// ── Score ────────────────────────────────────────────────────────────────────────────────────
// Words too common to distinguish one line from another; counting them would make every line
// look like every other.
const STOP = new Set(
  `the a an and or of to in on it is are was that this for with you your they their our we i not
   no as at by from be been but if so what which who when how one do does did can could will
   would there here them his her its own same more most other into over under out up down off
   then than also just now new only every any all some each has have had`
    .split(/\s+/)
    .filter(Boolean),
);
const bag = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

const heardBags = heard.map((t) => new Set(bag(t)));
const lineBags = keys.map((k) => new Set(bag(LINES[k])));

/**
 * Similarity of what was heard across these segments to what these lines say, 0..1.
 *
 * This has to be Jaccard — shared words over TOTAL distinct words — and not the share of the
 * line's words that were heard. Recall can only rise as more segments are swept in, so scoring
 * it makes merging free and the alignment collapses into a few giant blocks. Counting the
 * unmatched words on both sides is what makes an honest one-to-one match win.
 */
function overlap(segIdx, segCount, lineIdx, lineCount) {
  const h = new Set();
  for (let a = 0; a < segCount; a++) for (const w of heardBags[segIdx + a]) h.add(w);
  if (!h.size) return 0;

  const jac = (l) => {
    if (!l.size) return 0;
    let hit = 0;
    for (const w of l) if (h.has(w)) hit++;
    return hit / (h.size + l.size - hit);
  };

  // Claiming a segment holds several lines is only as credible as the LEAST supported of them.
  // Pooling their words instead would let one well-heard line drag a neighbour along, which is
  // how a merge wins a contest it should lose: a bigger combined vocabulary has more chances to
  // intersect a noisy transcript.
  if (lineCount > 1) {
    let worst = 1;
    for (let b = 0; b < lineCount; b++) worst = Math.min(worst, jac(lineBags[lineIdx + b]));
    return worst;
  }
  return jac(lineBags[lineIdx]);
}

// ── Align ────────────────────────────────────────────────────────────────────────────────────
const S = spoken.length;
const L = keys.length;
const INF = Number.POSITIVE_INFINITY;
const dp = Array.from({ length: S + 1 }, () => new Array(L + 1).fill(INF));
const back = Array.from({ length: S + 1 }, () => new Array(L + 1).fill(null));
dp[0][0] = 0;

for (let i = 0; i <= S; i++) {
  for (let j = 0; j <= L; j++) {
    if (dp[i][j] === INF) continue;
    // Throw this segment away — a fluffed line that was read again, or a stray noise.
    if (i < S && dp[i][j] + DROP_COST < dp[i + 1][j]) {
      dp[i + 1][j] = dp[i][j] + DROP_COST;
      back[i + 1][j] = { i, j, a: 1, b: 0 };
    }
    for (let a = 1; a <= MAX_SPAN && i + a <= S; a++) {
      for (let b = 1; b <= MAX_SPAN && j + b <= L; b++) {
        if (a > 1 && b > 1) continue;
        // Content and clock, together. The transcript says WHICH lines these are; the duration
        // says whether that many words can physically fit in that much audio. Content alone will
        // cheerfully put three lines in an eight-second segment because a few words happen to
        // match; duration alone cannot tell two lines of similar length apart. Neither signal is
        // sufficient and both are cheap.
        const d = prefixDur[i + a] - prefixDur[i];
        const w = prefixWords[j + b] - prefixWords[j];
        // Pace is a hard bound, not a nudge. Nobody delivers 117 words in 18.7 seconds, and
        // treating that as merely expensive let the search oscillate between "three segments are
        // one line" and "one segment is three lines" — each individually implausible, but jointly
        // cheaper than the truth once a few stray words happened to match. A reader does not vary
        // more than about twofold either side of their own average, so anything outside that is
        // not a worse explanation, it is not an explanation at all.
        // Only the fast side is a real limit. Nobody delivers words at twice their own average,
        // so that block is not a worse explanation, it is not an explanation at all. Slow is a
        // different matter: a deliberate pause, or a fluffed line read twice, makes a segment
        // legitimately far longer than its word count implies — an earlier bound on the slow side
        // rejected exactly that case and forced the search to contort around the one segment it
        // most needed to accept. Slowness is merely costed, below.
        const implied = w / d;
        if (implied > 1.9 * RATE) continue;
        const fit = Math.abs(w - RATE * d) / Math.max(w, RATE * d);
        // One line per segment is what a careful read produces, and on this take it is right for
        // 25 of 29 blocks. Deviating from it needs real evidence, not a rounding error: with a
        // small penalty the search happily paired a bogus merge with a bogus split, each covering
        // for the other, and landed a whole stretch on the wrong lines while the totals still
        // balanced.
        const cost = 1 - overlap(i, a, j, b) + 0.25 * fit + (a - 1) * 0.5 + (b - 1) * 0.5;
        if (dp[i][j] + cost < dp[i + a][j + b]) {
          dp[i + a][j + b] = dp[i][j] + cost;
          back[i + a][j + b] = { i, j, a, b };
        }
      }
    }
  }
}

if (dp[S][L] === INF) {
  console.log(`✗ No alignment of ${S} segments onto ${L} lines exists. Nothing written.`);
  process.exit(1);
}

const blocks = [];
for (let node = back[S][L]; node; node = back[node.i][node.j]) blocks.unshift(node);
if (process.env.DEBUG_BLOCKS)
  console.log(blocks.map((b) => `seg${b.i + 1}+${b.a}->line${b.j + 1}+${b.b}`).join('  '));

// ── Resolve blocks into one span per line ────────────────────────────────────────────────────
/** Cut a segment holding `n` lines at the n-1 best silences actually inside it. */
function splitSegment(seg, lineWords) {
  const n = lineWords.length;
  const total = lineWords.reduce((x, y) => x + y, 0);
  const span = seg.end - seg.start;
  for (const gap of [1.2, 0.9, 0.7, 0.5, 0.35]) {
    const sil = silencesIn(gap, seg.start, seg.end)
      .filter((s) => s.end !== null)
      .map((s) => (s.start + s.end) / 2);
    if (sil.length < n - 1) continue;
    const wanted = [];
    let acc = 0;
    for (let k = 0; k < n - 1; k++) {
      acc += lineWords[k];
      wanted.push(seg.start + span * (acc / total));
    }
    const used = new Set();
    const cuts = [];
    for (const w of wanted) {
      let best = -1;
      let bestD = INF;
      sil.forEach((at, idx) => {
        if (used.has(idx)) return;
        const d = Math.abs(at - w);
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      });
      if (best < 0) break;
      used.add(best);
      cuts.push(sil[best]);
    }
    if (cuts.length < n - 1) continue;
    cuts.sort((x, y) => x - y);
    const out = [];
    let from = seg.start;
    for (const c of cuts) {
      out.push({ start: from, end: c });
      from = c;
    }
    out.push({ start: from, end: seg.end });
    return { spans: out, gap };
  }
  return null;
}

const placed = new Array(L).fill(null);
const dropped = [];
let failed = null;
let si = 0;
let li = 0;
for (const b of blocks) {
  if (b.b === 0) {
    dropped.push(si + 1);
    si += 1;
    continue;
  }
  // Every line in a block is only as trustworthy as the block that produced it, so the block's
  // own similarity is what gets reported — not a score recomputed from the finished clip, which
  // would flatter a cut that landed in the wrong place.
  const score = overlap(si, b.a, li, b.b);
  if (b.b === 1) {
    placed[li] = { start: spoken[si].start, end: spoken[si + b.a - 1].end, parts: b.a, score };
    si += b.a;
    li += 1;
    continue;
  }
  const seg = spoken[si];
  const lw = keys.slice(li, li + b.b).map(wordsOfKey);
  const r = splitSegment(seg, lw);
  if (!r) {
    failed = { at: li + 1, n: b.b, seg: si + 1 };
    break;
  }
  r.spans.forEach((s, k) => {
    placed[li + k] = { ...s, parts: 1, cutFrom: si + 1, score };
  });
  si += 1;
  li += b.b;
}

if (failed) {
  console.log(`✗ Segment ${failed.seg} holds lines ${failed.at}..${failed.at + failed.n - 1} but has no silence
  inside to cut on. Nothing written — cutting mid-word would be audible.
`);
  process.exit(1);
}

// ── Trim a fluffed re-read ───────────────────────────────────────────────────────────────────
// A line the reader stumbled over and began again lives in ONE segment, because the retry follows
// too closely to open a gap wide enough to split on. Left alone the clip ships the stumble, the
// restart and the good take, and the video sits on that caption for twice as long as it should.
// Where a block runs far longer than its own words can account for, keep only the last attempt:
// cut at the latest internal silence that leaves a tail of about the right length.
const retried = [];
placed.forEach((p, i) => {
  if (!p || p.cutFrom || p.parts > 1) return;
  const expect = words[i] / RATE;
  if (p.end - p.start < expect * 1.45) return;
  for (const gap of [1.2, 0.9, 0.7]) {
    const starts = silencesIn(gap, p.start, p.end)
      .filter((x) => x.end !== null)
      .map((x) => x.end)
      .filter((t) => p.end - t >= expect * 0.7 && p.end - t <= expect * 1.4);
    if (!starts.length) continue;
    const from = Math.max(...starts);
    retried.push({ line: i + 1, dropped: from - p.start });
    p.start = from;
    return;
  }
});

// ── Report ───────────────────────────────────────────────────────────────────────────────────
let weak = 0;
console.log('\nline   start    len   match  source                 caption');
placed.forEach((p, i) => {
  const m = p.score ?? 0;
  const src = p.cutFrom ? `cut from seg ${p.cutFrom}` : p.parts > 1 ? `${p.parts} segs` : '';
  if (m < 0.12) weak++;
  console.log(
    `${String(i + 1).padStart(4)} ${p.start.toFixed(1).padStart(7)}s ${(p.end - p.start).toFixed(1).padStart(6)}s` +
      `  ${m.toFixed(2)}${m < 0.12 ? ' <-' : '  '}  ${src.padEnd(20)} ${keys[i].slice(0, 40)}`,
  );
});

if (retried.length) {
  for (const r of retried) {
    console.log(
      `line ${r.line}: dropped ${r.dropped.toFixed(1)}s of false start — kept the last attempt`,
    );
  }
}
if (dropped.length) {
  console.log(`\ndropped segments (heard as re-reads or noise): ${dropped.join(', ')}`);
}
console.log(`\n${L - weak} of ${L} lines confirmed by transcript${weak ? `, ${weak} weak` : ''}`);

if (DRY) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

const PAD = 0.15;
console.log('');
placed.forEach((p, i) => {
  const file = `${CLIPS}/${slug(keys[i])}.wav`;
  ffmpegStderr([
    '-ss',
    String(Math.max(0, p.start - PAD)),
    '-t',
    String(p.end - p.start + PAD * 2),
    '-i',
    take,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-y',
    file,
  ]);
});
console.log(`wrote ${L} clips to ${CLIPS}

Next:
  node tools/demo/record.mjs     # re-paces the video to your delivery
  node tools/demo/narrate.mjs    # muxes your voice onto it
`);
