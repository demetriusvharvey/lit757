import { Activity, CalendarDays, Clock3, Radio } from "lucide-react";
import type { BuzzPulseSummary } from "../buzz-pulse-summary";

type BuzzPulseBriefProps = {
  loading: boolean;
  mapGuide: string;
  scopePhrase: string;
  summary: BuzzPulseSummary;
};

export function BuzzPulseBrief({
  loading,
  mapGuide,
  scopePhrase,
  summary,
}: BuzzPulseBriefProps) {
  const initialLoad = loading && summary.rankedCount === 0;
  const thirdMetric = summary.liveCount > 0
    ? {
        icon: Radio,
        value: summary.liveCount,
        label: `live ${summary.liveCount === 1 ? "signal" : "signals"}`,
      }
    : summary.highForecastCount > 0
      ? {
          icon: Activity,
          value: summary.highForecastCount,
          label: `high ${summary.highForecastCount === 1 ? "forecast" : "forecasts"}`,
        }
      : {
          icon: Activity,
          value: summary.rankedCount,
          label: "places ranked",
        };
  const ThirdMetricIcon = thirdMetric.icon;

  return (
    <section
      className={`buzz-pulse-brief ${summary.mode}`}
      aria-label="Current 757 pulse"
      aria-busy={initialLoad}
    >
      <div className="buzz-pulse-title">
        <span><i aria-hidden="true" /> 757 PULSE</span>
        <b role="status" aria-live="polite">{initialLoad ? "Checking signals" : summary.modeLabel}</b>
      </div>
      <h1>
        {initialLoad
          ? "Finding what’s happening across Hampton Roads"
          : `See what’s happening ${scopePhrase} right now`}
      </h1>
      {initialLoad ? (
        <div className="buzz-pulse-reading"><Activity /> Checking hours, events, and activity evidence…</div>
      ) : (
        <ul aria-label="Current discovery summary">
          <li><Clock3 /><strong>{summary.openCount}</strong> reported open</li>
          <li><CalendarDays /><strong>{summary.eventListingCount}</strong> event {summary.eventListingCount === 1 ? "listing" : "listings"}</li>
          <li><ThirdMetricIcon /><strong>{thirdMetric.value}</strong> {thirdMetric.label}</li>
        </ul>
      )}
      <p><span>{mapGuide}</span><b>Signals, not headcounts.</b></p>
    </section>
  );
}
