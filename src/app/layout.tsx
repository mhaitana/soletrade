import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { Toaster } from "@/shared/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { brand } from "@/config/brand";
import { urls } from "@/config/urls";

const fontSans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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
  icons: {
    icon: [
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
    shortcut: { url: "/icons/icon-192x192.png" },
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
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
