import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Coin Seal SVG — viewBox 0 0 100 100 scaled to target size
function coinSealSvg(size, rimColor = '#C9A227', bodyColor = '#0D1B2A') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <polygon points="50,3 90.7,26.5 90.7,73.5 50,97 9.3,73.5 9.3,26.5" fill="${rimColor}"/>
    <polygon points="50,10 84.6,30 84.6,70 50,90 15.4,70 15.4,30" fill="${bodyColor}"/>
    <polygon points="50,17 78.6,33.5 78.6,66.5 50,83 21.4,66.5 21.4,33.5" fill="none" stroke="${rimColor}" stroke-width="1.5"/>
    <polygon points="50,38 51.91,45.38 58.49,41.51 54.62,48.09 62,50 54.62,51.91 58.49,58.49 51.91,54.62 50,62 48.09,54.62 41.51,58.49 45.38,51.91 38,50 45.38,48.09 41.51,41.51 48.09,45.38" fill="${rimColor}"/>
  </svg>`;
}

async function generateIcon(outputPath, canvasSize, markSize) {
  const navy = { r: 13, g: 27, b: 42, alpha: 1 };
  const offset = Math.round((canvasSize - markSize) / 2);

  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: navy },
  })
    .composite([{
      input: Buffer.from(coinSealSvg(markSize)),
      top: offset,
      left: offset,
    }])
    .png()
    .toFile(outputPath);

  console.log(`✓ ${outputPath}`);
}

async function generateSplash(outputPath, canvasSize, markSize) {
  // Splash uses transparent background + white mark
  const offset = Math.round((canvasSize - markSize) / 2);

  await sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: Buffer.from(coinSealSvg(markSize, '#FFFFFF', 'transparent')),
      top: offset,
      left: offset,
    }])
    .png()
    .toFile(outputPath);

  console.log(`✓ ${outputPath}`);
}

const apps = ['agent', 'principal'];

for (const app of apps) {
  const assets = path.join(root, 'apps', app, 'assets');

  // 1024×1024 app icon — mark at 60% (614px)
  await generateIcon(path.join(assets, 'icon.png'), 1024, 614);

  // 1024×1024 adaptive icon (Android)
  await generateIcon(path.join(assets, 'adaptive-icon.png'), 1024, 614);

  // 512×512 splash icon — transparent bg, white mark at 60% (307px)
  await generateSplash(path.join(assets, 'splash-icon.png'), 512, 307);
}

console.log('All icons generated.');
