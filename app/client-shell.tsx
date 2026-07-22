"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MapControllerProvider } from "./map-controller";
import "./mapbox-load-image-adapter";
import "./buzz-logo-overrides.css";

// The unified map is the primary production discovery experience.
const BuzzMapApp = dynamic(() => import("./buzz-map-app"), { ssr: false });
const BuzzStatusRuntime = dynamic(() => import("./buzz-status-runtime"), { ssr: false });
const VenuePhotoRuntime = dynamic(() => import("./venue-photo-runtime"), { ssr: false });
const PassivePresenceRuntime = dynamic(() => import("./passive-presence-runtime"), { ssr: false });
const NotificationRuntime = dynamic(() => import("./notification-runtime"), { ssr: false });
const NotificationAuth = dynamic(() => import("./notification-auth"), { ssr: false });

export default function ClientShell() {
  const pathname = usePathname();
  const isDistrictExperience = pathname.startsWith("/districts");

  return (
    <MapControllerProvider>
      {!isDistrictExperience && (
        <>
          <BuzzMapApp />
          <BuzzStatusRuntime />
          <VenuePhotoRuntime />
          <PassivePresenceRuntime />
          <NotificationRuntime />
          <NotificationAuth />
        </>
      )}
    </MapControllerProvider>
  );
}
