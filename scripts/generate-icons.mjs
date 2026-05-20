/**
 * Generates app icons and splash assets for Amana Agent and Amana Principal.
 *
 * Outputs per app:
 *   assets/icon.png          — 1024×1024, dark bg + coloured A mark (App Store / Play Store icon)
 *   assets/adaptive-icon.png — 1024×1024, transparent bg + coloured A mark (Android adaptive foreground)
 *   assets/splash-icon.png   — 512×512, transparent bg + white A mark (centred on splash screen)
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ─── Design constants ────────────────────────────────────────────────────────
const BG = '#1C1C1E';

// Geometric A lettermark — three line segments on a 1024×1024 canvas
// Apex (512,168), bottom-left (196,836), bottom-right (828,836)
// Crossbar at y=568: left x≈323, right x≈701
function aSvg({ size = 1024, strokeColor, bgColor = null } = {}) {
  const scale = size / 1024;
  const sw = Math.round(84 * scale);

  const pts = {
    apexX: Math.round(512 * scale),
    apexY: Math.round(168 * scale),
    blX: Math.round(196 * scale),
    blY: Math.round(836 * scale),
    brX: Math.round(828 * scale),
    brY: Math.round(836 * scale),
    cbLX: Math.round(323 * scale),
    cbRX: Math.round(701 * scale),
    cbY: Math.round(568 * scale),
  };

  const bg = bgColor ? `<rect width="${size}" height="${size}" fill="${bgColor}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <polyline
    points="${pts.blX},${pts.blY} ${pts.apexX},${pts.apexY} ${pts.brX},${pts.brY}"
    stroke="${strokeColor}" stroke-width="${sw}"
    stroke-linejoin="miter" stroke-miterlimit="10" stroke-linecap="square"
    fill="none"
  />
  <line x1="${pts.cbLX}" y1="${pts.cbY}" x2="${pts.cbRX}" y2="${pts.cbY}"
    stroke="${strokeColor}" stroke-width="${sw}" stroke-linecap="square"/>
</svg>`;
}

async function writePng(svg, outPath) {
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.info('  ✓', outPath.replace(root, '.'));
}

// ─── Apps ────────────────────────────────────────────────────────────────────
const apps = [
  { name: 'agent', accentColor: '#0EA5E9' }, // sky blue  — action / forward
  { name: 'principal', accentColor: '#F59E0B' }, // amber     — authority / wealth
];

for (const { name, accentColor } of apps) {
  console.info(`\n${name} (${accentColor})`);
  const dir = join(root, 'apps', name, 'assets');
  mkdirSync(dir, { recursive: true });

  // Full icon: dark bg + coloured A
  await writePng(aSvg({ strokeColor: accentColor, bgColor: BG }), join(dir, 'icon.png'));

  // Adaptive icon foreground: transparent bg + coloured A
  await writePng(aSvg({ strokeColor: accentColor }), join(dir, 'adaptive-icon.png'));

  // Splash logo: 512px, transparent bg + white A (overlaid on dark splash bg)
  await writePng(aSvg({ size: 512, strokeColor: '#FFFFFF' }), join(dir, 'splash-icon.png'));
}

console.info('\nDone.');
