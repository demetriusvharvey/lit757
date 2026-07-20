"use client";

import dynamic from "next/dynamic";
import { MapControllerProvider } from "./map-controller";

const MobileRenderGuard = dynamic(() => import("./mobile-render-guard"), { ssr: false });
const LocationExperience = dynamic(() => import("./location-experience"), { ssr: false });
const MobileHome = dynamic(() => import("./buzz-mobile-home"), { ssr: false });
const DesktopHome = dynamic(() => import("./buzz-desktop-home"), { ssr: false });
const NotificationRuntime = dynamic(() => import("./notification-runtime"), { ssr: false });
const NotificationAuth = dynamic(() => import("./notification-auth"), { ssr: false });
const NotificationTestButton = dynamic(() => import("./notification-test-button"), { ssr: false });

export default function ClientShell() {
  return (
    <MapControllerProvider>
      <MobileRenderGuard />
      <LocationExperience />
      <MobileHome />
      <DesktopHome />
      <NotificationRuntime />
      <NotificationAuth />
      <NotificationTestButton />
    </MapControllerProvider>
  );
}
