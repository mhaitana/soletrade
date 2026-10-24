#!/usr/bin/env tsx
/**
 * Generate the PWA icons, favicon and Apple startup images from the SVG masters.
 *
 * Run with: pnpm icons:generate
 *
 * Generated assets are committed so installation does not depend on a build step.
 * Asset URLs and supported startup-image dimensions live in `src/config/pwa.ts`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { brand } from "../src/config/brand";
import { getAppleSplashScreens, pwaBrand } from "../src/config/pwa";

const publicDir = path.resolve(process.cwd(), "public");
const iconsDir = path.join(publicDir, "icons");

const outputs = [
  { source: "standard", target: pwaBrand.icons.standard192, legacy: "icon-192x192.png", size: 192 },
  { source: "standard", target: pwaBrand.icons.standard512, legacy: "icon-512x512.png", size: 512 },
  {
    source: "maskable",
    target: pwaBrand.icons.maskable512,
    legacy: "icon-512x512-maskable.png",
    size: 512,
  },
  {
    source: "maskable",
    target: pwaBrand.icons.appleTouch,
    legacy: "apple-touch-icon.png",
    size: 180,
  },
  { source: "standard", target: pwaBrand.icons.favicon32, legacy: "favicon-32x32.png", size: 32 },
  { source: "standard", target: pwaBrand.icons.favicon16, legacy: "favicon-16x16.png", size: 16 },
] as const;

async function writePublicAsset(url: string, content: Buffer) {
  const target = path.join(publicDir, url.replace(/^\//, ""));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  console.log(`Generated ${url}`);
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? character;
  });
}

async function createFavicon(svg: Buffer) {
  const sizes = [16, 32, 48, 256];
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      png: await sharp(svg).resize(size, size).png().toBuffer(),
    })),
  );
  // ICO supports PNG payloads; each directory entry points at one full PNG.
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2); // Resource type: icon.
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;

  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt16LE(1, entry + 4); // Color planes.
    directory.writeUInt16LE(32, entry + 6); // Bits per pixel.
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  await fs.writeFile(
    path.resolve(process.cwd(), "src/app/favicon.ico"),
    Buffer.concat([directory, ...images.map(({ png }) => png)]),
  );
  console.log("Generated src/app/favicon.ico");
}

async function createSplashScreens(svg: Buffer) {
  // Keep the same visual size in CSS pixels across device pixel ratios.
  const icon = svg
    .toString("utf8")
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  for (const { url, width, height, scale } of getAppleSplashScreens()) {
    const cssWidth = width / scale;
    const cssHeight = height / scale;
    const centerX = cssWidth / 2;
    const top = (cssHeight - 196) / 2;
    const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${cssWidth} ${cssHeight}">
      <rect width="${cssWidth}" height="${cssHeight}" fill="${pwaBrand.background}"/>
      <g transform="translate(${centerX - 56} ${top}) scale(${112 / 512})">${icon}</g>
      <text x="${centerX}" y="${top + 164}" text-anchor="middle" font-family="Inter,Arial,Helvetica,sans-serif" font-size="24" font-weight="600" letter-spacing="-0.45" fill="${pwaBrand.ink}">${escapeXml(brand.productName)}</text>
      <text x="${centerX}" y="${top + 190}" text-anchor="middle" font-family="Inter,Arial,Helvetica,sans-serif" font-size="12" fill="#78716c">${escapeXml(brand.tagline)}</text>
    </svg>`;
    await writePublicAsset(url, await sharp(Buffer.from(splash)).removeAlpha().png().toBuffer());
  }
}

async function main() {
  const sources = {
    standard: await fs.readFile(path.join(iconsDir, "icon-source.svg")),
    maskable: await fs.readFile(path.join(iconsDir, "icon-maskable-source.svg")),
  };

  for (const { source, target, legacy, size } of outputs) {
    const image = sharp(sources[source]).resize(size, size);
    if (source === "maskable") image.removeAlpha();
    const png = await image.png().toBuffer();
    await writePublicAsset(target, png);
    // Keep old direct URLs current for clients that have not refreshed metadata.
    await fs.writeFile(path.join(iconsDir, legacy), png);
  }

  await createFavicon(sources.standard);
  await createSplashScreens(sources.standard);

  // Render unified mobile app icon (1024x1024)
  const mobileIconPath = path.resolve(process.cwd(), "apps/mobile/assets/icon.png");
  try {
    const mobileIcon = await sharp(sources.standard).resize(1024, 1024).png().toBuffer();
    await fs.mkdir(path.dirname(mobileIconPath), { recursive: true });
    await fs.writeFile(mobileIconPath, mobileIcon);
    console.log("Generated apps/mobile/assets/icon.png");
  } catch (err) {
    console.warn("Could not write mobile icon:", err);
  }
}

main().catch((error) => {
  console.error("Failed to generate PWA branding assets:", error);
  process.exit(1);
});
