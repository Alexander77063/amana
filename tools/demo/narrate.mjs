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
const LINES = {
  // ── Intro ────────────────────────────────────────────────────────────────
  'Every Nigerian household has this conversation.':
    'Every Nigerian middle class household has had this conversation. What did you do with the fifteen thousand naira I gave you yesterday? Parents and business owners hand cash, or an open bank transfer, to the people who spend on their behalf.',
  'Every existing option gives the money away completely.':
    'And every existing option gives the money away completely. Cash leaves no record. A debit card P I N is not a rule. A bank transfer is instant, and instantly out of your hands.',
  'The big wallets all sell the same wallet to everyone.':
    'So why has nobody fixed it? The big wallets all sell the same wallet to everyone, built on a single user thesis. The banks are locked to one customer, one account. Nobody has segmented around delegated control.',
  'The infrastructure that made this impossible is now standard.':
    'What changed is the plumbing. Instant transfer now reaches almost every bank account in Nigeria. Identity enrolment covers most of the adult population. And banking as a service turned a two year build into a few months. The infrastructure tax that killed earlier attempts is gone.',
  'Delegated authority, not delegated access.':
    'Amana is built on one idea: delegated authority, not delegated access. One funded master wallet. A sub-wallet for each person, which is a spending envelope rather than another bank account. Limits, category locks and time windows, enforced on every spend.',
  'Control without the conversation.':
    'What that buys you is control without the conversation. The parent stops policing and starts setting rules. The agent stops justifying every naira. Every spend is auditable the moment it happens.',

  // ── Walkthrough ──────────────────────────────────────────────────────────
  'A parent funds one wallet. Every agent spends under their own limits.':
    'Amana is a controlled-spend wallet for Nigeria. A parent funds one wallet, and every person who spends from it gets their own limits. Everything you are about to see is the real app, running against a live A P I.',
  'The principal signs in with a phone number.':
    'Onboarding is a phone number and a one-time code. There are no passwords anywhere in the product.',
  'First-time signup also captures NIN and BVN.':
    'A first-time signup also captures N I N and B V N: the Nigerian identity numbers a wallet needs before it can hold money.',
  'Creating the household provisions a real bank account.':
    'Creating a household provisions a real bank account. A customer record, and a fundable account number at our banking partner. That account number is the wallet.',
  'Money arrives by bank transfer into that account.':
    'Money arrives the ordinary way, by bank transfer. The credit lands as a signed webhook and posts to a double entry ledger.',
  'The principal issues a one-time pairing code.':
    'To add someone who spends, the parent issues a one-time pairing code. On a phone that code travels by Q R, by N F C tap, or by an S M S link.',
  'The agent signs in on their own phone.':
    'The agent has their own phone and their own login. They never see the master wallet. Only what they have been given.',
  'The agent types the code showing on the parent’s phone.':
    'The code is what binds this device to that household. Nothing else will.',
  'The principal issues a sub-wallet to that agent.':
    'The parent issues a sub-wallet. It is not a bank account. It is a spending envelope drawn against the master wallet, so there is no float to top up, and nothing stranded.',
  'The parent caps what can be spent in a day…':
    'And this is the point of the product. The parent sets the rules. A daily cap, enforced on the server, on every spend. The agent app cannot talk its way past it.',
  '…and locks it to the categories they choose.':
    'Then they lock it down further. Transport, school, market. Anything outside that list is not the agent’s call to make.',
  'Now the agent tries something the rules do not allow.':
    'So watch what happens when the agent tries something outside the rules. Airtime was never on the list.',
  'It is not refused — it is held, and the parent is asked.':
    'It is not refused. It is held, and the parent is asked. That distinction is the whole product: nobody gets stranded at the counter, and nobody has to hand over blanket access to avoid it.',
  'One tap from the parent, and the payment goes through.':
    'One tap from the parent, and the payment goes through. The rule held. The parent decided. And there is nothing to argue about afterwards.',
  'The agent’s phone now shows the sub-wallet it was given.':
    'The agent now sees the sub-wallet they were given. Until the parent issues one, there is nothing to spend from.',
  'Paying a vendor is a normal bank transfer out.':
    'Paying a vendor is a normal bank transfer out. The vendor needs no app and no account with us. Just an account number.',
  'The bank confirms who owns that account before anything moves.':
    'Before anything moves, the bank confirms who owns that account, and the agent sees the real name.',
  'The bank confirms the transfer and the ledger settles.':
    'The bank confirms, and the ledger settles. Double entry postings, both sides accounted for. The agent gets a receipt carrying the N I B S S session I D, the same reference their own bank would show.',
  'The same wallet buys airtime, data, electricity and cable.':
    'The same wallet also buys airtime, data, electricity and cable, paid straight to the biller. No cash, no top up card, no middleman.',
  'And the parent’s category lock reaches this too.':
    'And this is the part that matters. The parent’s category lock reaches these too. Airtime was never on the allowed list, so it is refused, rather than quietly permitted because it happens to be digital.',
  'The parent decides to allow it.':
    'If the parent wants to allow it, that is one tap in the same editor.',
  'And now it goes through.':
    'And now it goes through. Same purchase, same wallet. The only thing that changed is the parent’s rule.',
  'One wallet. Many agents. Every naira under control.':
    'One wallet. Many people spending from it. Every naira under control.',
};

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
  const durations = {};
  for (const [text, line] of Object.entries(LINES)) {
    const file = `${CLIPS}/${slug(text)}.wav`;
    speak(line, file);
    durations[text] = durationMs(file);
    console.log(`  ✓ ${String(durations[text]).padStart(6)}ms  ${text.slice(0, 64)}`);
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
const delays = clips
  .map((c, i) => `[${i}:a]adelay=${c.atMs}|${c.atMs}[a${i}]`)
  .join(';');
const mixIn = clips.map((_, i) => `[a${i}]`).join('');
// `dropout_transition=0` and `normalize=0` stop amix from ducking each clip as others end.
const filter = `${delays};${mixIn}amix=inputs=${clips.length}:dropout_transition=0:normalize=0[out]`;

const voTrack = `${OUT}/narration.wav`;
execFileSync(
  ffmpegPath,
  [...inputs, '-filter_complex', filter, '-map', '[out]', '-y', voTrack],
  { stdio: 'pipe' },
);
console.log(`\nnarration track → ${voTrack}`);

// Mux. Re-encode to H.264/AAC mp4 so it plays in Keynote/PowerPoint/QuickTime, and also
// keep a .webm with audio for the browser.
const mp4 = `${OUT}/amana-walkthrough-narrated.mp4`;
execFileSync(
  ffmpegPath,
  [
    '-i', VIDEO,
    '-i', voTrack,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-y', mp4,
  ],
  { stdio: 'pipe' },
);
console.log(`narrated video  → ${mp4}`);

writeFileSync(
  `${OUT}/narration-manifest.json`,
  JSON.stringify({ voice: VOICE, rate: RATE, missing, clips }, null, 2),
);
if (missing) console.log(`\n${missing} caption(s) had no narration line — see LINES in narrate.mjs`);
