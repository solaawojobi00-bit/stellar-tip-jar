import type { Metadata } from "next";
import { Caprasimo, Figtree, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The tip page's "Organic" type pairing, from the Claude Design handoff.
 * Loaded through next/font rather than the handoff's Google Fonts @import, so
 * the files are self-hosted and there is no render-blocking CDN round trip.
 */
const caprasimo = Caprasimo({
  variable: "--font-caprasimo",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const figtree = Figtree({
  variable: "--font-figtree",
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://stellar-tip-jar-phi.vercel.app";
const SITE_DESCRIPTION = "A zero-login, zero-database tip page for Stellar.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "stellar-tip-jar",
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "stellar-tip-jar",
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "stellar-tip-jar",
    images: [
      {
        url: "/tip-jar-og.png",
        width: 1200,
        height: 630,
        alt: "stellar-tip-jar",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "stellar-tip-jar",
    description: SITE_DESCRIPTION,
    images: ["/tip-jar-og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${caprasimo.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
