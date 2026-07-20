"use client";

import dynamic from "next/dynamic";
import { MapControllerProvider } from "./map-controller";

const MapLayerGuard = dynamic(() => import("./map-layer-guard"), { ssr: false });
const MobileRenderGuard = dynamic(() => import("./mobile-render-guard"), { ssr: false });
const LocationExperience = dynamic(() => import("./location-experience"), { ssr: false });
const MobileHome = dynamic(() => import("./mobile-home"), { ssr: false });
const NotificationRuntime = dynamic(() => import("./notification-runtime"), { ssr: false });
const NotificationAuth = dynamic(() => import("./notification-auth"), { ssr: false });
const NotificationTestButton = dynamic(() => import("./notification-test-button"), { ssr: false });
const DesktopHome = dynamic(() => import("./desktop-home"), { ssr: false });
const VenueBrowserExperience = dynamic(() => import("./venue-browser-experience"), { ssr: false });
const BuzzExperience = dynamic(() => import("./buzz-experience"), { ssr: false });
const BuzzBrandEnhancer = dynamic(() => import("./buzz-brand-enhancer"), { ssr: false });
const HomeMapResizer = dynamic(() => import("./home-map-resizer"), { ssr: false });
const VenueDetailEnhancer = dynamic(() => import("./venue-detail-enhancer"), { ssr: false });
const VenueVotingEnhancer = dynamic(() => import("./venue-voting-enhancer"), { ssr: false });
const LegacyEnhancers = dynamic(() => import("./legacy-enhancers"), { ssr: false });

export default function ClientShell() {
  return (
    <MapControllerProvider>
      <MapLayerGuard />
      <MobileRenderGuard />
      <LocationExperience />
      <MobileHome />
      <NotificationRuntime />
      <NotificationAuth />
      <NotificationTestButton />
      <DesktopHome />
      <VenueBrowserExperience />
      <BuzzExperience />
      <BuzzBrandEnhancer />
      <HomeMapResizer />
      <VenueDetailEnhancer />
      <VenueVotingEnhancer />
      <LegacyEnhancers />
    </MapControllerProvider>
  );
}
