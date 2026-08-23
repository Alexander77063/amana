// Resolve a voiceover take that will not split automatically, by ear, in one pass.
//
//   node tools/demo/audition.mjs "path/to/take.m4a"
//   → tools/demo/out/audition.html   (self-contained; open it in a browser)
//
// WHY THIS EXISTS
// ---------------
// split-vo.mjs assumes the gaps between spoken lines are longer than the pauses inside them.
// When a reader pauses mid-sentence as long as they pause between lines that assumption breaks,
// and NO silence threshold can separate the two — sweeping -30..-40dB over 0.6..1.6s on the
// first take moved the segment count 152 → 8 without ever settling near the script length.
// Duration matching does not rescue it either: scoring every re-read hypothesis against both
// synthetic clip lengths and per-line word counts left the best guess ~5% ahead of the runner
// up, which is noise, not a signal.
//
// So this stops guessing and asks the one party who can actually tell: the person who read it.
// It cuts the take at a threshold that deliberately over-segments, then builds a page that plays
// each segment beside the line it is expected to be. Marking them takes a couple of minutes and
// produces a plan string that split-vo.mjs applies exactly.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { LINES } from './narration-lines.mjs';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const WORK = `${OUT}/audition`;
const SILENCE_DB = Number(process.env.SILENCE_DB ?? -35);
const SILENCE_SEC = Number(process.env.SILENCE_SEC ?? 1.2);
// Deliberately lower than split-vo's floor: a fluffed restart or a stray "sorry" is exactly what
// needs to be visible here so it can be marked and dropped.
const MIN_SEG_SEC = Number(process.env.MIN_SEG_SEC ?? 0.7);

const take = process.argv[2];
if (!take || !existsSync(take)) {
  console.error('usage: node tools/demo/audition.mjs <recording>');
  process.exit(2);
}

function ffmpegStderr(args) {
  return String(spawnSync(ffmpegPath, args, { encoding: 'utf8' }).stderr ?? '');
}

const duration = (() => {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(ffmpegStderr(['-i', take]));
  if (!m) throw new Error('could not read the recording — is it audio?');
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
})();

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
  const s = /silence_start: ([\d.]+)/.exec(line);
  const e = /silence_end: ([\d.]+)/.exec(line);
  if (s) silences.push({ start: +s[1], end: null });
  if (e && silences.length) silences[silences.length - 1].end = +e[1];
}

const segments = [];
let cursor = 0;
for (const s of silences) {
  if (s.start > cursor + 0.2) segments.push({ start: cursor, end: s.start });
  cursor = s.end ?? s.start;
}
if (duration > cursor + 0.2) segments.push({ start: cursor, end: duration });

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

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

console.log(`take     : ${take} (${duration.toFixed(1)}s)`);
console.log(`segments : ${spoken.length} at ${SILENCE_DB}dB / ${SILENCE_SEC}s`);
console.log(`script   : ${keys.length} lines`);
console.log('\nencoding clips…');

// A touch of padding either side so nothing starts or ends clipped when auditioned.
const PAD = 0.15;
const clips = spoken.map((seg, i) => {
  const file = `${WORK}/seg-${String(i + 1).padStart(2, '0')}.mp3`;
  ffmpegStderr([
    '-ss',
    String(Math.max(0, seg.start - PAD)),
    '-t',
    String(seg.end - seg.start + PAD * 2),
    '-i',
    take,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '48k',
    '-y',
    file,
  ]);
  return {
    n: i + 1,
    start: +seg.start.toFixed(2),
    dur: +(seg.end - seg.start).toFixed(1),
    b64: readFileSync(file).toString('base64'),
  };
});

const totalMb = (clips.reduce((a, c) => a + c.b64.length, 0) / 1e6).toFixed(1);
console.log(`  ${clips.length} clips embedded (${totalMb} MB)`);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Amana voiceover — audition</title>
<style>
  :root { --bg:#0f1115; --fg:#e8eaf0; --dim:#8b93a7; --line:#232838;
          --keep:#2f9e5e; --drop:#c04b4b; --join:#3d7ac4; --split:#b6892b; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif }
  header { position:sticky; top:0; background:var(--bg); padding:20px 24px 14px;
           border-bottom:1px solid var(--line); z-index:5 }
  h1 { margin:0 0 4px; font-size:19px; letter-spacing:-.01em }
  .sub { color:var(--dim); font-size:13px }
  .wrap { padding:0 24px 140px; max-width:1120px }
  .row { display:grid; grid-template-columns:44px 96px 1fr 280px; gap:14px; align-items:center;
         padding:10px 12px; border-top:1px solid var(--line); border-radius:8px }
  .row.cur { background:#182031; box-shadow:inset 0 0 0 1px #2b3a58 }
  .n { color:var(--dim); font-variant-numeric:tabular-nums; font-size:13px }
  .play { background:#1b2130; border:1px solid var(--line); color:var(--fg); border-radius:7px;
          padding:7px 10px; cursor:pointer; font-size:12px; width:100%;
          font-variant-numeric:tabular-nums }
  .play:hover { background:#232c40 }
  .play.on { background:#2b3a58; border-color:#4d6799 }
  .assign { font-size:13px; color:var(--dim) }
  .assign b { color:var(--fg); font-weight:500 }
  .marks { display:flex; gap:5px; justify-content:flex-end }
  .marks button { border:1px solid var(--line); background:#161b26; color:var(--dim);
                  cursor:pointer; border-radius:6px; padding:6px 9px; font-size:12px }
  .marks button:hover { color:var(--fg) }
  .marks button.sel[data-m=k] { background:var(--keep); border-color:var(--keep); color:#fff }
  .marks button.sel[data-m=j] { background:var(--join); border-color:var(--join); color:#fff }
  .marks button.sel[data-m=d] { background:var(--drop); border-color:var(--drop); color:#fff }
  .marks button.sel[data-m=s] { background:var(--split); border-color:var(--split); color:#111 }
  footer { position:fixed; left:0; right:0; bottom:0; background:#141926;
           border-top:1px solid var(--line); padding:14px 24px; display:flex; gap:14px;
           align-items:center }
  code { background:#0b0e14; border:1px solid var(--line); border-radius:6px; padding:8px 11px;
         flex:1; overflow:auto; white-space:nowrap; font-size:13px }
  .cp { background:var(--keep); border:0; color:#fff; border-radius:7px; padding:10px 16px;
        cursor:pointer; font-size:14px }
  .warn { color:#f0b849 }
  kbd { background:#20263a; border:1px solid var(--line); border-radius:4px; padding:1px 6px;
        font-size:11px }
</style>
<header>
  <h1>Amana voiceover — audition</h1>
  <div class="sub">
    ${clips.length} segments · ${keys.length} lines in the script.
    Play each one, then mark it: <kbd>1</kbd> it's the next line ·
    <kbd>2</kbd> it continues the one above ·
    <kbd>3</kbd> drop it (fluff / false start) · <kbd>4</kbd> it contains two lines.
    <kbd>space</kbd> replays. Marking auto-plays the next.
    When the counter reads ${keys.length} / ${keys.length}, hit Copy and paste it back to Claude.
  </div>
</header>
<div class="wrap" id="rows"></div>
<footer>
  <code id="plan">—</code>
  <span id="status" class="sub"></span>
  <button class="cp" onclick="copyPlan()">Copy plan</button>
</footer>
<script>
const CLIPS = ${JSON.stringify(clips.map((c) => ({ n: c.n, start: c.start, dur: c.dur })))};
const AUDIO = ${JSON.stringify(clips.map((c) => c.b64))};
const LINES = ${JSON.stringify(keys)};
const marks = new Array(CLIPS.length).fill('k');
let cur = 0;

const rows = document.getElementById('rows');
CLIPS.forEach((c, i) => {
  const d = document.createElement('div');
  d.className = 'row'; d.id = 'r' + i;
  d.innerHTML =
    '<div class="n">' + c.n + '</div>' +
    '<button class="play" id="p' + i + '">&#9654; ' + c.dur.toFixed(1) + 's</button>' +
    '<div class="assign" id="a' + i + '"></div>' +
    '<div class="marks">' +
      ['k','j','d','s'].map((m, k) =>
        '<button data-m="' + m + '" data-i="' + i + '">' +
        ['next line','joins &#8593;','drop','2 lines'][k] + '</button>').join('') +
    '</div>';
  rows.appendChild(d);
});

let audio = null;
function play(i) {
  if (audio) audio.pause();
  document.querySelectorAll('.play').forEach(b => b.classList.remove('on'));
  audio = new Audio('data:audio/mpeg;base64,' + AUDIO[i]);
  document.getElementById('p' + i).classList.add('on');
  audio.onended = () => document.getElementById('p' + i).classList.remove('on');
  // Marking a row auto-plays the next one, so a fast clicker interrupts the previous play()
  // before it resolves. That rejection is expected and means nothing — swallow it rather than
  // filling the console with AbortErrors.
  audio.play().catch(() => {});
  focusRow(i);
}
function focusRow(i) {
  cur = i;
  document.querySelectorAll('.row').forEach(r => r.classList.remove('cur'));
  const r = document.getElementById('r' + i);
  r.classList.add('cur');
  r.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function setMark(i, m) {
  marks[i] = m;
  render();
  if (i + 1 < CLIPS.length) play(i + 1); else focusRow(i);
}
rows.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('play')) return play(+b.id.slice(1));
  setMark(+b.dataset.i, b.dataset.m);
});
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); return play(cur); }
  const m = { '1':'k', '2':'j', '3':'d', '4':'s' }[e.key];
  if (m) { e.preventDefault(); setMark(cur, m); }
  if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(Math.min(cur + 1, CLIPS.length - 1)); }
  if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(Math.max(cur - 1, 0)); }
});

function render() {
  let li = 0, splits = 0;
  marks.forEach((m, i) => {
    const a = document.getElementById('a' + i);
    document.querySelectorAll('#r' + i + ' .marks button')
      .forEach(b => b.classList.toggle('sel', b.dataset.m === m));
    if (m === 'd') { a.innerHTML = '<span style="color:var(--drop)">dropped</span>'; return; }
    if (m === 'j') {
      a.innerHTML = '<span style="color:var(--join)">&hellip;continues line ' + li + '</span>';
      return;
    }
    if (m === 's') splits++;
    li++;
    if (li > LINES.length) {
      a.innerHTML = '<span class="warn">no line ' + li + ' &mdash; too many kept</span>';
      return;
    }
    // The line text goes in as a text node, not markup, so punctuation in the script cannot
    // break the row.
    a.innerHTML = '<b>' + li + '.</b> ';
    a.append(document.createTextNode(LINES[li - 1].slice(0, 104)));
  });
  document.getElementById('plan').textContent = marks.join('');
  const st = document.getElementById('status');
  const ok = li === LINES.length && !splits;
  st.className = ok ? 'sub' : 'sub warn';
  st.textContent = li + ' / ' + LINES.length + ' lines' +
    (splits ? ' &middot; ' + splits + ' need splitting' : '');
}
function copyPlan() {
  navigator.clipboard.writeText(document.getElementById('plan').textContent);
  document.querySelector('.cp').textContent = 'Copied \\u2713';
  setTimeout(() => { document.querySelector('.cp').textContent = 'Copy plan'; }, 1400);
}
render(); focusRow(0);
</script>
`;

writeFileSync(`${OUT}/audition.html`, html);
console.log(`
✓ ${OUT}/audition.html

Open it, play each segment, mark it, then paste the plan string back.
`);
