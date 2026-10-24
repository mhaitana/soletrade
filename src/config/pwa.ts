import type { Metadata } from "next";
import { brand } from "./brand";

const assetBase = "/icons/soletrade-v1";

export const pwaBrand = {
  assetBase,
  background: "#fafaf9",
  darkBackground: "#0c0a09",
  ink: "#1c1917",
  accent: "#60a5fa",
  icons: {
    standard192: `${assetBase}/icon-192x192.png`,
    standard512: `${assetBase}/icon-512x512.png`,
    maskable512: `${assetBase}/icon-512x512-maskable.png`,
    appleTouch: `${assetBase}/apple-touch-icon.png`,
    favicon16: `${assetBase}/favicon-16x16.png`,
    favicon32: `${assetBase}/favicon-32x32.png`,
  },
} as const;

// Portrait CSS width, height and device-pixel ratio for Apple startup images.
// Device data: elegantapp/pwa-asset-generator, apple-fallback-data.json at a24d8fb.
// Landscape media queries retain portrait device dimensions; only the raster rotates.
export const appleStartupDevices = [
  [320, 568, 2],
  [375, 667, 2],
  [414, 736, 3],
  [375, 812, 3],
  [414, 896, 2],
  [414, 896, 3],
  [360, 780, 3],
  [390, 844, 3],
  [428, 926, 3],
  [393, 852, 3],
  [430, 932, 3],
  [402, 874, 3],
  [420, 912, 3],
  [440, 956, 3],
  [768, 1024, 2],
  [810, 1080, 2],
  [820, 1180, 2],
  [834, 1112, 2],
  [834, 1194, 2],
  [834, 1210, 2],
  [744, 1133, 2],
  [1024, 1366, 2],
  [1032, 1376, 2],
] as const;

export function getAppleSplashScreens() {
  return appleStartupDevices.flatMap(([deviceWidth, deviceHeight, scale]) =>
    (["portrait", "landscape"] as const).map((orientation) => {
      const width = (orientation === "portrait" ? deviceWidth : deviceHeight) * scale;
      const height = (orientation === "portrait" ? deviceHeight : deviceWidth) * scale;
      return {
        url: `${assetBase}/splash-${width}x${height}.png`,
        width,
        height,
        scale,
        media: `(device-width: ${deviceWidth}px) and (device-height: ${deviceHeight}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation})`,
      };
    }),
  );
}

export function getAppleWebAppMetadata() {
  return {
    capable: true,
    title: brand.productName,
    statusBarStyle: "default",
    startupImage: getAppleSplashScreens().map(({ url, media }) => ({ url, media })),
  } satisfies NonNullable<Metadata["appleWebApp"]>;
}
