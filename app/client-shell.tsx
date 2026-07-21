"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MapControllerProvider } from "./map-controller";

const MobileRenderGuard = dynamic(() => import("./mobile-render-guard"), { ssr: false });
const LocationExperience = dynamic(() => import("./location-experience"), { ssr: false });
const MobileHome = dynamic(() => import("./buzz-mobile-home"), { ssr: false });
const BuzzPinRestorer = dynamic(() => import("./buzz-pin-restorer"), { ssr: false });
const BuzzProductPositioning = dynamic(() => import("./buzz-product-positioning"), { ssr: false });
const BuzzScoreTransparency = dynamic(() => import("./buzz-score-transparency"), { ssr: false });
const BuzzCrowdReport = dynamic(() => import("./buzz-crowd-report"), { ssr: false });
const BuzzCommunityProof = dynamic(() => import("./buzz-community-proof"), { ssr: false });
const DesktopHome = dynamic(() => import("./buzz-desktop-home"), { ssr: false });
const NotificationRuntime = dynamic(() => import("./notification-runtime"), { ssr: false });
const NotificationAuth = dynamic(() => import("./notification-auth"), { ssr: false });
const NotificationTestButton = dynamic(() => import("./notification-test-button"), { ssr: false });

export default function ClientShell() {
  const pathname = usePathname();
  const isDistrictExperience = pathname.startsWith("/districts");

  return (
    <MapControllerProvider>
      {!isDistrictExperience && (
        <>
          <MobileRenderGuard />
          <LocationExperience />
          <MobileHome />
          <BuzzPinRestorer />
          <BuzzProductPositioning />
          <BuzzScoreTransparency />
          <BuzzCrowdReport />
          <BuzzCommunityProof />
          <DesktopHome />
          <NotificationRuntime />
          <NotificationAuth />
          <NotificationTestButton />
        </>
      )}
    </MapControllerProvider>
  );
}
