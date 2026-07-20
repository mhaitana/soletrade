#!/usr/bin/env tsx
/**
 * Generate the PWA icon set from the SVG masters in `public/icons/`.
 *
 * Run with: pnpm tsx scripts/generate-pwa-icons.ts
 *
 * The generated PNGs are committed to the repo so the app is installable without
 * a build step. Replace `icon-source.svg` / `icon-maskable-source.svg` with final
 * brand assets when they are available.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const iconsDir = path.resolve(process.cwd(), "public/icons");

const outputs = [
  { source: "icon-source.svg", target: "icon-192x192.png", size: 192 },
  { source: "icon-source.svg", target: "icon-512x512.png", size: 512 },
  { source: "icon-maskable-source.svg", target: "icon-512x512-maskable.png", size: 512 },
  { source: "icon-source.svg", target: "apple-touch-icon.png", size: 180 },
  { source: "icon-source.svg", target: "favicon-32x32.png", size: 32 },
  { source: "icon-source.svg", target: "favicon-16x16.png", size: 16 },
] as const;

async function main() {
  await fs.mkdir(iconsDir, { recursive: true });

  for (const { source, target, size } of outputs) {
    const sourcePath = path.join(iconsDir, source);
    const targetPath = path.join(iconsDir, target);

    const svg = await fs.readFile(sourcePath);

    await sharp(svg)
      .resize(size, size, { fit: "contain", background: "#fafaf9" })
      .png()
      .toFile(targetPath);

    console.log(`Generated ${target}`);
  }
}

main().catch((error) => {
  console.error("Failed to generate PWA icons:", error);
  process.exit(1);
});
