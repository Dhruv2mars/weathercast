type AssetSpec = {
  path: string;
  width: number;
  height: number;
  colorType?: number;
};

const root = process.cwd();
const assets: AssetSpec[] = [
  { path: 'assets/images/icon.png', width: 1024, height: 1024 },
  { path: 'assets/images/ui-mark.png', width: 192, height: 192 },
  { path: 'assets/images/android-icon-background.png', width: 512, height: 512, colorType: 2 },
  { path: 'assets/images/android-icon-foreground.png', width: 512, height: 512 },
  { path: 'assets/images/android-icon-monochrome.png', width: 512, height: 512 },
  { path: 'assets/images/favicon.png', width: 64, height: 64 },
  { path: 'assets/images/splash-icon.png', width: 228, height: 228 },
  { path: 'store-assets/google-play/icon.png', width: 512, height: 512 },
  { path: 'store-assets/google-play/feature-graphic.png', width: 1024, height: 500, colorType: 2 },
];

function absolute(path: string) {
  return `${root}/${path}`;
}

async function readPng(path: string) {
  const bytes = new Uint8Array(await Bun.file(absolute(path)).arrayBuffer());
  if (bytes.length < 26 || String.fromCharCode(...bytes.slice(1, 4)) !== 'PNG') {
    throw new Error(`${path}: not a PNG`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    bytes,
    width: view.getUint32(16),
    height: view.getUint32(20),
    colorType: bytes[25],
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

const failures: string[] = [];
const pngs = new Map<string, Awaited<ReturnType<typeof readPng>>>();

for (const spec of assets) {
  try {
    const png = await readPng(spec.path);
    pngs.set(spec.path, png);
    if (png.width !== spec.width || png.height !== spec.height) {
      failures.push(`${spec.path}: expected ${spec.width}x${spec.height}, found ${png.width}x${png.height}`);
    }
    if (spec.colorType !== undefined && png.colorType !== spec.colorType) {
      failures.push(`${spec.path}: expected PNG color type ${spec.colorType}, found ${png.colorType}`);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : `${spec.path}: unreadable asset`);
  }
}

const adaptiveBackground = pngs.get('assets/images/android-icon-background.png');
const playIcon = pngs.get('store-assets/google-play/icon.png');
if (adaptiveBackground && playIcon && sameBytes(adaptiveBackground.bytes, playIcon.bytes)) {
  failures.push('Android adaptive background must not be the complete Google Play icon');
}

const appConfig = await Bun.file(absolute('app.config.ts')).text();
const onboarding = await Bun.file(absolute('src/app/onboarding.tsx')).text();
const webTabs = await Bun.file(absolute('src/components/app-tabs.web.tsx')).text();

const iconPath = "icon: './assets/images/icon.png'";
if (appConfig.split(iconPath).length - 1 !== 2) {
  failures.push('app.config.ts: expected top-level and iOS icons to use icon.png');
}

for (const expected of [
  "foregroundImage: './assets/images/android-icon-foreground.png'",
  "backgroundImage: './assets/images/android-icon-background.png'",
  "monochromeImage: './assets/images/android-icon-monochrome.png'",
  "favicon: './assets/images/favicon.png'",
  "image: './assets/images/splash-icon.png'",
]) {
  if (!appConfig.includes(expected)) failures.push(`app.config.ts: missing ${expected}`);
}

if (!onboarding.includes("require('../../assets/images/ui-mark.png')")) {
  failures.push('onboarding.tsx: dedicated ui-mark.png is not used');
}
if (!webTabs.includes("require('../../assets/images/ui-mark.png')")) {
  failures.push('app-tabs.web.tsx: dedicated ui-mark.png is not used');
}
if (onboarding.includes('☂') || webTabs.includes('☂')) {
  failures.push('UI branding still contains the retired umbrella glyph');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Brand asset checks passed (${assets.length} PNGs, adaptive-layer contract, and UI references).`);
