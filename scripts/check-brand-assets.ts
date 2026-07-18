const requiredFiles = [
  'assets/brand/background.svg',
  'assets/brand/foreground.svg',
  'assets/brand/icon.svg',
  'assets/brand/monochrome.svg',
  'assets/brand/splash.svg',
  'assets/expo.icon/Assets/weathercast-mark.svg',
  'assets/expo.icon/icon.json',
  'assets/images/icon.png',
  'assets/images/favicon.png',
  'assets/images/android-icon-background.png',
  'assets/images/android-icon-foreground.png',
  'assets/images/android-icon-monochrome.png',
  'assets/images/splash-icon.png',
];

const missing: string[] = [];
for (const path of requiredFiles) {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) missing.push(path);
}

for (const path of requiredFiles.filter((value) => value.endsWith('.svg'))) {
  const content = await Bun.file(path).text();
  if (!/<svg\b/i.test(content)) missing.push(`${path} (not SVG)`);
}

if (missing.length > 0) {
  console.error(`Brand asset check failed:\n${missing.map((path) => `- ${path}`).join('\n')}`);
  process.exit(1);
}

console.log(`Brand asset check passed: ${requiredFiles.length} required assets present.`);
