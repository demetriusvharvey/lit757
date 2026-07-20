export type BuzzSignalFamily =
  | "foot_traffic"
  | "verified_users"
  | "first_party_occupancy"
  | "commercial_demand"
  | "event_forecast";

export type BuzzSignalType =
  | "besttime_live"
  | "besttime_forecast"
  | "verified_presence"
  | "crowd_report"
  | "partner_pulse"
  | "reservation_inventory"
  | "ticket_inventory"
  | "ticket_scans"
  | "predicted_attendance";

export type BuzzConfidence = "low" | "medium" | "high";
export type BuzzScoreMode = "live" | "forecast";

export type BuzzSignal = {
  source: string;
  family: BuzzSignalFamily;
  type: BuzzSignalType;
  value: number;
  isLive: boolean;
  confidence: number;
  observedAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
};

export type BuzzScoreFactor = {
  family: BuzzSignalFamily | "prior";
  label: string;
  points: number;
  source: string;
  observedAt?: string;
};

export type BuzzScoreResult = {
  version: "buzz-v1";
  score: number;
  label: "Chill" | "Active" | "Heating Up" | "On Fire";
  mode: BuzzScoreMode;
  confidence: BuzzConfidence;
  computedAt: string;
  expiresAt: string;
  evidenceAgeMinutes: number | null;
  sourceFamilies: BuzzSignalFamily[];
  explanation: string;
  factors: BuzzScoreFactor[];
};

export type VenueForBuzz = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  type?: string | null;
  category?: string | null;
  ai_score?: number | null;
};
