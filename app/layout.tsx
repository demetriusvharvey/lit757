import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const configuredHost =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  "http://localhost:3000";
const siteUrl = configuredHost.startsWith("http")
  ? configuredHost
  : `https://${configuredHost}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Things To Do 757 — Find something worth doing now",
  description: "Instant, interest-aware recommendations for things to do across Hampton Roads—updated automatically.",
  applicationName: "Things To Do 757",
  appleWebApp: {
    capable: true,
    title: "Things To Do 757",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Things To Do 757",
    description: "Find something worth doing in the 757—in under 10 seconds.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Things To Do 757" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Things To Do 757",
    description: "Find something worth doing in the 757—in under 10 seconds.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
