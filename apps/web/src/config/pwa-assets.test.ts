import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { getManifest } from "./manifest";
import { getAppleSplashScreens, getAppleWebAppMetadata, pwaBrand } from "./pwa";

function publicAsset(url: string) {
  return path.join(process.cwd(), "public", url.replace(/^\//, ""));
}

describe("installed app branding assets", () => {
  it("ships every manifest icon at its declared pixel dimensions", async () => {
    for (const icon of getManifest().icons ?? []) {
      const metadata = await sharp(publicAsset(icon.src)).metadata();
      expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
      expect(metadata.format).toBe("png");
    }
  });

  it("keeps the maskable mark inside the safe circle on an opaque background", async () => {
    const { data, info } = await sharp(publicAsset(pwaBrand.icons.maskable512))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const radius = info.width * 0.4;
    let markPixels = 0;
    let unsafePixels = 0;
    let transparentPixels = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 3] !== 255) transparentPixels++;
        // Match background pixel: legacy #1c1917 (28, 25, 23) or obsidian #141413 (20, 20, 19).
        if (
          (data[i] === 28 && data[i + 1] === 25 && data[i + 2] === 23) ||
          (data[i] === 20 && data[i + 1] === 20 && data[i + 2] === 19)
        )
          continue;
        markPixels++;
        if (Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) > radius) {
          unsafePixels++;
        }
      }
    }
    expect(markPixels).toBeGreaterThan(0);
    expect(transparentPixels).toBe(0);
    expect(unsafePixels).toBe(0);
  });

  it("ships an exact-size image for every advertised Apple startup screen", async () => {
    const screens = getAppleSplashScreens();
    const appleMetadata = getAppleWebAppMetadata();
    expect(appleMetadata.capable).toBe(true);
    expect(appleMetadata.title).toBe("Soletrade");
    expect(appleMetadata.startupImage).toEqual(screens.map(({ url, media }) => ({ url, media })));
    for (const screen of screens) {
      const image = await sharp(publicAsset(screen.url)).metadata();
      expect([image.width, image.height]).toEqual([screen.width, screen.height]);
      expect(image.hasAlpha).toBe(false);
    }
  });

  it("ships favicon frames with valid offsets and matching pixel sizes", async () => {
    const ico = await readFile(path.join(process.cwd(), "src/app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const width = ico[entry] || 256;
      const height = ico[entry + 1] || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const image = await sharp(ico.subarray(offset, offset + length)).metadata();
      expect([image.width, image.height]).toEqual([width, height]);
      expect(image.format).toBe("png");
    }
  });
});
