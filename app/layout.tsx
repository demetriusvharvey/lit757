import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import DiscoveryEnhancer from "./discovery-enhancer";
import AuthLifecycle from "./auth-lifecycle";
import EventEngagementEnhancer from "./event-engagement-enhancer";
import AuthChoiceEnhancer from "./auth-choice-enhancer";
import ActivityStatusEnhancer from "./activity-status-enhancer";
import ActivityInsightsEnhancer from "./activity-insights-enhancer";
import VenueDecisionEnhancer from "./venue-decision-enhancer";
import LivePulseEnhancer from "./live-pulse-enhancer";
import LiveExperienceEnhancer from "./live-experience-enhancer";
import NightPlannerEnhancer from "./night-planner-enhancer";
import SmartAlertsEnhancer from "./smart-alerts-enhancer";
import MobileAppShellEnhancer from "./mobile-app-shell-enhancer";

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

const socialTitle = "The Fastest Way to Know What’s Happening Around You";
const socialDescription =
  "Real-time activity, events, restaurants and things to do across Hampton Roads.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${socialTitle} | Things To Do 757`,
  description: socialDescription,
  applicationName: "Things To Do 757",
  openGraph: {
    title: socialTitle,
    description: socialDescription,
    type: "website",
    siteName: "Things To Do 757",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "The fastest way to know what is happening around you in real time",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: socialTitle,
    description: socialDescription,
    images: ["/opengraph-image"],
  },
};

const rankedFeedBootstrap = `
(() => {
  if (window.__activity757RankedFeedInstalled) return;
  window.__activity757RankedFeedInstalled = true;

  const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
  const activityForVenue = (venue) => {
    const base = clamp(Number(venue.score || 0));
    const heatBoost = venue.heat?.level === "hot" ? 24 : venue.heat?.level === "active" ? 14 : 0;
    const eventBoost = venue.event ? 8 : 0;
    const openAdjustment = venue.openNow === false ? -26 : venue.openNow === true ? 4 : 0;
    const score = Math.round(clamp(base * 0.72 + heatBoost + eventBoost + openAdjustment));
    const label = score >= 85 ? "Very Busy" : score >= 70 ? "Busy" : score >= 52 ? "Getting Busier" : score >= 30 ? "Moderate" : "Quiet";
    const trendLabel = venue.heat ? "Getting Busier" : venue.openNow === false ? "Slowing Down" : "Steady";
    const confidence = venue.heat ? "high" : venue.event ? "medium" : "limited";
    return { score, label, trendLabel, confidence };
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const target = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    if (!target.includes("/api/discover") || !response.ok) return response;
    try {
      const payload = await response.clone().json();
      if (!payload?.success || !Array.isArray(payload.venues)) return response;
      payload.venues = payload.venues
        .map((venue) => ({ ...venue, activity: activityForVenue(venue) }))
        .sort((a, b) => b.activity.score - a.activity.score || Number(b.score || 0) - Number(a.score || 0));
      payload.picks = payload.venues.slice(0, 40);
      window.dispatchEvent(new CustomEvent("activity757:discovery", { detail: payload }));
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };
})();
`;

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
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: rankedFeedBootstrap }} />
        {children}
        <DiscoveryEnhancer />
        <EventEngagementEnhancer />
        <ActivityStatusEnhancer />
        <ActivityInsightsEnhancer />
        <VenueDecisionEnhancer />
        <LivePulseEnhancer />
        <LiveExperienceEnhancer />
        <NightPlannerEnhancer />
        <SmartAlertsEnhancer />
        <MobileAppShellEnhancer />
        <AuthChoiceEnhancer />
        <AuthLifecycle />
      </body>
    </html>
  );
}
