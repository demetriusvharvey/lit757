"use client";

import { useEffect, useState } from "react";
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

export default function LegacyEnhancers() {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  if (!desktop) return null;

  return (
    <>
      <DiscoveryEnhancer />
      <EventEngagementEnhancer />
      <ActivityStatusEnhancer />
      <ActivityInsightsEnhancer />
      <VenueDecisionEnhancer />
      <LivePulseEnhancer />
      <LiveExperienceEnhancer />
      <NightPlannerEnhancer />
      <SmartAlertsEnhancer />
      <AuthChoiceEnhancer />
      <AuthLifecycle />
    </>
  );
}
