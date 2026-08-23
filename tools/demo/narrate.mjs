// Build a narration track aligned to the recorded walkthrough, and mux it onto the video.
//
//   node tools/demo/narrate.mjs
//
// Reads tools/demo/out/timings.json (written by record.mjs), speaks one line per caption
// using the Windows speech synthesiser, places each clip at the caption's timestamp, and
// muxes the result onto the .webm — also producing an .mp4, which is what actually plays in
// Keynote and PowerPoint.
//
// NOTE ON VOICE QUALITY: this uses the built-in Microsoft David/Zira SAPI voices. They are
// serviceable as a scratch track so you can hear the pacing, but they sound synthetic. For
// anything going to investors, record NARRATION.md in your own voice and re-run with
// VOICE_DIR pointing at your clips.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';

const OUT = process.env.OUT_DIR ?? 'tools/demo/out';
const VIDEO = process.env.VIDEO ?? `${OUT}/amana-walkthrough.webm`;
const CLIPS = `${OUT}/vo`;
const VOICE = process.env.VOICE ?? 'Microsoft Zira Desktop';
const RATE = Number(process.env.RATE ?? -1); // SAPI rate, -10..10; slightly slow reads better

mkdirSync(CLIPS, { recursive: true });

/** Stable filename per caption, so clips are reused between the --clips pass and the mux. */
const slug = (t) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

// Narration keyed by the caption headline (or, for intro slides, the slide title), so
// re-ordering the recorder cannot desync this.
import { LINES } from './narration-lines.mjs';

// `--clips` generates and measures the speech only, writing vo-durations.json so record.mjs
// can hold each chapter until its narration finishes. Without it, long lines talk over the
// next chapter — the video has to be paced by the audio, not the other way round.
const CLIPS_ONLY = process.argv.includes('--clips');

/** Speak one line to a WAV via the Windows speech synthesiser. */
function speak(text, outPath) {
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice(${JSON.stringify(VOICE)}) } catch {}
$s.Rate = ${RATE}
$s.SetOutputToWaveFile(${JSON.stringify(outPath)})
$s.Speak(${JSON.stringify(text)})
$s.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: 'pipe',
  });
}

/** Duration of a wav, in ms, via ffmpeg's own probe output. */
function durationMs(file) {
  try {
    execFileSync(ffmpegPath, ['-i', file], { stdio: 'pipe' });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(e.stderr.toString());
    if (m) return Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000);
  }
  return 0;
}

if (CLIPS_ONLY) {
  // An existing clip is left alone — that is how a human voiceover survives this step. Once
  // split-vo.mjs has written real recordings, re-running --clips only re-measures them so the
  // video can be paced to that delivery. `--force` regenerates the synthetic voice instead.
  const force = process.argv.includes('--force');
  const durations = {};
  for (const [text, line] of Object.entries(LINES)) {
    const file = `${CLIPS}/${slug(text)}.wav`;
    const human = existsSync(file) && !force;
    if (!human) speak(line, file);
    durations[text] = durationMs(file);
    const mark = human ? 'voice' : 'synth';
    console.log(`  ✓ ${mark} ${String(durations[text]).padStart(6)}ms  ${text.slice(0, 58)}`);
  }
  writeFileSync(`${OUT}/vo-durations.json`, JSON.stringify(durations, null, 2));
  console.log(`
clip durations → ${OUT}/vo-durations.json`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(`${OUT}/timings.json`, 'utf8'));
if (!existsSync(VIDEO)) throw new Error(`no video at ${VIDEO} — run record.mjs first`);

const clips = [];
let missing = 0;
for (const t of manifest.timings) {
  const line = LINES[t.text];
  if (!line) {
    missing++;
    console.log(`  · no narration line for caption: ${JSON.stringify(t.text).slice(0, 80)}`);
    continue;
  }
  const file = `${CLIPS}/${slug(t.text)}.wav`;
  if (!existsSync(file)) speak(line, file);
  clips.push({ file, atMs: t.atMs, chapter: t.chapter });
  console.log(`  ✓ ${String(t.atMs).padStart(6)}ms  ${t.chapter}`);
}
if (clips.length === 0) throw new Error('no narration clips produced');

// Place each clip at its caption timestamp, then sum them into one track.
const inputs = clips.flatMap((c) => ['-i', c.file]);
const delays = clips.map((c, i) => `[${i}:a]adelay=${c.atMs}|${c.atMs}[a${i}]`).join(';');
const mixIn = clips.map((_, i) => `[a${i}]`).join('');
// `dropout_transition=0` and `normalize=0` stop amix from ducking each clip as others end.
const filter = `${delays};${mixIn}amix=inputs=${clips.length}:dropout_transition=0:normalize=0[out]`;

const voTrack = `${OUT}/narration.wav`;
execFileSync(ffmpegPath, [...inputs, '-filter_complex', filter, '-map', '[out]', '-y', voTrack], {
  stdio: 'pipe',
});
console.log(`\nnarration track → ${voTrack}`);

// Mux. Re-encode to H.264/AAC mp4 so it plays in Keynote/PowerPoint/QuickTime, and also
// keep a .webm with audio for the browser.
const mp4 = `${OUT}/amana-walkthrough-narrated.mp4`;
execFileSync(
  ffmpegPath,
  [
    '-i',
    VIDEO,
    '-i',
    voTrack,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-y',
    mp4,
  ],
  { stdio: 'pipe' },
);
console.log(`narrated video  → ${mp4}`);

writeFileSync(
  `${OUT}/narration-manifest.json`,
  JSON.stringify({ voice: VOICE, rate: RATE, missing, clips }, null, 2),
);
if (missing)
  console.log(`\n${missing} caption(s) had no narration line — see LINES in narrate.mjs`);
