// Render assets/branding/*.svg to every PNG the project needs.
// Invoked by scripts/generate-branding.sh: node scripts/render-branding.mjs <repoRoot> <stageDir>
// Uses @resvg/resvg-js installed in the stage dir (never a repo dependency).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [root, stage] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { Resvg } = require(path.join(stage, "node_modules", "@resvg", "resvg-js"));

const render = (src, dst, width) => {
  const svg = fs.readFileSync(path.join(root, src));
  const out = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  const abs = dst.startsWith("$STAGE/") ? path.join(stage, dst.slice(7)) : path.join(root, dst);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, out);
  console.log(dst, width);
};

const B = "assets/branding";
const jobs = [
  [B + "/icon.svg", "assets/icon.png", 1024],
  [B + "/icon.svg", "assets/icon-appstore.png", 1024],
  [B + "/adaptive-foreground.svg", "assets/adaptive-icon.png", 432],
  [B + "/monochrome.svg", "assets/adaptive-icon-mono.png", 432],
  [B + "/splash.svg", "assets/splash-icon.png", 512],
];

const mipSize = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const d of Object.values(mipSize))
  jobs.push([B + "/icon.svg", "$STAGE/icon-" + d + ".png", d]);

const fgSize = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [density, size] of Object.entries(fgSize)) {
  jobs.push([B + "/adaptive-foreground.svg", "android/app/src/main/res/mipmap-" + density + "/ic_launcher_foreground.png", size]);
  jobs.push([B + "/monochrome.svg", "android/app/src/main/res/mipmap-" + density + "/ic_launcher_mono.png", size]);
}

const splashSize = { mdpi: 288, hdpi: 432, xhdpi: 576, xxhdpi: 864, xxxhdpi: 1152 };
for (const [density, size] of Object.entries(splashSize))
  jobs.push([B + "/splash.svg", "android/app/src/main/res/drawable-" + density + "/splashscreen_logo.png", size]);

for (const [src, dst, w] of jobs) render(src, dst, w);
