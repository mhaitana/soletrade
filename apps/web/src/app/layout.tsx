import { AppProviders } from "@/application/providers/app-providers";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { brand } from "@/config/brand";
import { urls } from "@/config/urls";
import { getAppleWebAppMetadata, pwaBrand } from "@/config/pwa";

// Fonts are bundled locally (SIL OFL 1.1, see ./fonts) so builds work without network access.
const fontSans = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

const fontMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(urls.app),
  title: {
    default: brand.productName,
    template: `%s · ${brand.productName}`,
  },
  description: brand.description,
  applicationName: brand.productName,
  creator: brand.companyName,
  publisher: brand.companyName,
  manifest: "/api/manifest",
  appleWebApp: getAppleWebAppMetadata(),
  icons: {
    icon: [
      { url: pwaBrand.icons.favicon16, sizes: "16x16", type: "image/png" },
      { url: pwaBrand.icons.favicon32, sizes: "32x32", type: "image/png" },
    ],
    apple: { url: pwaBrand.icons.appleTouch, sizes: "180x180" },
    shortcut: { url: pwaBrand.icons.standard192 },
  },
  openGraph: {
    type: "website",
    siteName: brand.productName,
    title: brand.productName,
    description: brand.description,
    url: urls.app,
  },
  twitter: {
    card: "summary_large_image",
    title: brand.productName,
    description: brand.description,
  },
};

// Tint the mobile browser chrome to match the app background per theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: pwaBrand.background },
    { media: "(prefers-color-scheme: dark)", color: pwaBrand.darkBackground },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
