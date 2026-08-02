import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { loadActiveSignals, recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import { calculateBuzzScore } from "../../../../src/lib/buzz/score-v1";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";
import {
  summarizeVerifiedCrowdReports,
  verifiesVenueProximity,
} from "../../../../src/lib/buzz/verified-reports";
import {
  exceedsRequestRate,
  guardErrorResponse,
  readBoundedJson,
  requestClientKey,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

const allowedLevels = new Set(["quiet", "steady", "busy", "packed"]);

type ScoreBeforeVote = {
  score: number;
  label: string;
  mode: string;
  confidence: string;
  version: string;
  computedAt: string;
};

type ReportRow = {
  user_id?: string | null;
  crowd_level: string;
  observed_at: string;
  expires_at: string;
  metadata?: Record<string, unknown> | null;
};

function occupancyBand(value: number) {
  if (value >= 85) return "packed";
  if (value >= 60) return "busy";
  if (value >= 30) return "steady";
  return "quiet";
}

function meters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function scoreBeforeVote(venue: VenueForBuzz, now: Date): Promise<ScoreBeforeVote> {
  const { data: snapshot } = await db
    .from("buzz_score_snapshots")
    .select("score,label,score_mode,confidence,version,computed_at")
    .eq("venue_id", venue.id)
    .maybeSingle();

  if (snapshot) {
    return {
      score: Number(snapshot.score),
      label: String(snapshot.label),
      mode: String(snapshot.score_mode),
      confidence: String(snapshot.confidence),
      version: String(snapshot.version),
      computedAt: String(snapshot.computed_at),
    };
  }

  try {
    const signals = await loadActiveSignals(db, venue.id, now);
    const calculated = calculateBuzzScore(venue, signals, now);
    return {
      score: calculated.score,
      label: calculated.label,
      mode: calculated.mode,
      confidence: calculated.confidence,
      version: calculated.version,
      computedAt: calculated.computedAt,
    };
  } catch {
    const baseline = calculateBuzzScore(venue, [], now);
    return {
      score: baseline.score,
      label: baseline.label,
      mode: baseline.mode,
      confidence: baseline.confidence,
      version: baseline.version,
      computedAt: baseline.computedAt,
    };
  }
}

async function awardBuzzPoints(userId: string, venueId: string, reportId: string, firstVerifiedReport: boolean) {
  const rows = [{
    user_id: userId,
    action: "verified_crowd_vote",
    points: 10,
    reference_key: reportId,
    metadata: { venueId },
  }];
  if (firstVerifiedReport) rows.push({
    user_id: userId,
    action: "first_verified_crowd_vote",
    points: 15,
    reference_key: reportId,
    metadata: { venueId },
  });

  const { error } = await db.from("points_ledger").insert(rows);
  if (error) {
    console.error("Could not award Buzz Points", error.message);
    return { pointsAwarded: 0, totalPoints: null as number | null };
  }

  const { error: refreshError } = await db.rpc("refresh_member_points", { target_user: userId });
  if (refreshError) console.error("Could not refresh member points", refreshError.message);
  const { data: profile } = await db.from("member_profiles").select("points").eq("user_id", userId).maybeSingle();
  return {
    pointsAwarded: firstVerifiedReport ? 25 : 10,
    totalPoints: profile?.points == null ? null : Number(profile.points),
  };
}

async function recordConsensusGroundTruth(args: {
  venueId: string;
  reports: ReportRow[];
  average: number;
  consensus: number;
  uniqueUsers: number;
  observedAt: Date;
}) {
  if (args.uniqueUsers < 2 || args.reports.length < 2 || args.consensus < 0.65) return false;

  const duplicateWindow = new Date(args.observedAt.getTime() - 20 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from("buzz_ground_truth")
    .select("id")
    .eq("venue_id", args.venueId)
    .eq("observer_type", "verified_user_consensus")
    .gte("observed_at", duplicateWindow)
    .limit(1)
    .maybeSingle();
  if (recent) return false;

  const predictionReport = [...args.reports]
    .reverse()
    .find(report => Number.isFinite(Number(report.metadata?.predictedScoreBefore)));
  const metadata = predictionReport?.metadata || {};
  const predictedScore = Number(metadata.predictedScoreBefore);

  const { error } = await db.from("buzz_ground_truth").insert({
    venue_id: args.venueId,
    observed_at: args.observedAt.toISOString(),
    occupancy_band: occupancyBand(args.average),
    occupancy_pct: Math.round(args.average),
    observer_type: "verified_user_consensus",
    notes: `${args.uniqueUsers} verified nearby users with ${Math.round(args.consensus * 100)}% consensus`,
    metadata: {
      reportCount: args.reports.length,
      uniqueUsers: args.uniqueUsers,
      consensus: Number(args.consensus.toFixed(3)),
      averageCrowdValue: Number(args.average.toFixed(1)),
      predictedScore: Number.isFinite(predictedScore) ? predictedScore : null,
      predictedLabel: metadata.predictedLabelBefore || null,
      predictedMode: metadata.predictedModeBefore || null,
      predictedConfidence: metadata.predictedConfidenceBefore || null,
      predictedVersion: metadata.predictedVersionBefore || null,
      predictedAt: metadata.predictedAtBefore || null,
    },
  });

  if (error) {
    console.error("Could not record Buzz ground truth", error.message);
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  const member = await getRequestUser(request);
  if (!member) return NextResponse.json({ success: false, error: "Sign in to verify live activity" }, { status: 401 });
  if (exceedsRequestRate(`buzz-report:${member.id}:${requestClientKey(request)}`, 12, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many crowd reports" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4_096);
  } catch (error) {
    return guardErrorResponse(error);
  }
  const venueId = String(body?.venueId || "");
  const crowdLevel = String(body?.crowdLevel || "").toLowerCase();
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracy = Number(body?.gpsAccuracyMeters);

  if (!venueId || !allowedLevels.has(crowdLevel) || ![latitude, longitude, accuracy].every(Number.isFinite) || accuracy <= 0) {
    return NextResponse.json({ success: false, error: "Venue, crowd level, and location are required" }, { status: 400 });
  }

  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score,lat,lng")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError || !venue) return NextResponse.json({ success: false, error: "Venue not found" }, { status: 404 });

  const observedAt = new Date();
  const previous = await scoreBeforeVote(venue as VenueForBuzz, observedAt);
  const distance = meters(latitude, longitude, Number(venue.lat), Number(venue.lng));
  const verifiedNearby = verifiesVenueProximity(distance, accuracy);
  const tenMinutesAgo = new Date(observedAt.getTime() - 10 * 60 * 1000).toISOString();
  const { data: duplicate } = await db
    .from("buzz_user_reports")
    .select("id")
    .eq("venue_id", venueId)
    .eq("user_id", member.id)
    .gte("observed_at", tenMinutesAgo)
    .limit(1)
    .maybeSingle();
  if (duplicate) return NextResponse.json({ success: false, error: "You already voted on this place recently" }, { status: 429 });

  const expiresAt = new Date(observedAt.getTime() + 45 * 60 * 1000);
  const { data: insertedReport, error: insertError } = await db.from("buzz_user_reports").insert({
    venue_id: venueId,
    user_id: member.id,
    crowd_level: crowdLevel,
    reported_lat: latitude,
    reported_lng: longitude,
    distance_meters: Number(distance.toFixed(1)),
    gps_accuracy_meters: accuracy,
    verified_nearby: verifiedNearby,
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    metadata: {
      predictedScoreBefore: previous.score,
      predictedLabelBefore: previous.label,
      predictedModeBefore: previous.mode,
      predictedConfidenceBefore: previous.confidence,
      predictedVersionBefore: previous.version,
      predictedAtBefore: previous.computedAt,
    },
  }).select("id").single();
  if (insertError) return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });

  if (!verifiedNearby) {
    return NextResponse.json({ success: true, accepted: true, verifiedNearby: false, distanceMeters: Math.round(distance), message: "Vote saved, but it was not close enough to affect Buzz or earn points." });
  }

  const since = new Date(observedAt.getTime() - 45 * 60 * 1000).toISOString();
  const { data: reportData, error: reportError } = await db
    .from("buzz_user_reports")
    .select("user_id,crowd_level,observed_at,expires_at,metadata")
    .eq("venue_id", venueId)
    .eq("verified_nearby", true)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(100);
  if (reportError) return NextResponse.json({ success: false, error: reportError.message }, { status: 500 });

  const summary = summarizeVerifiedCrowdReports((reportData || []) as ReportRow[]);
  if (!summary) return NextResponse.json({ success: false, error: "No trustworthy crowd reports were available" }, { status: 500 });
  const reports = summary.reports;
  const uniqueUsers = summary.uniqueReporterCount;
  const signals: BuzzSignal[] = [{
    source: "lit757_users",
    family: "verified_users",
    type: "verified_presence",
    value: uniqueUsers,
    isLive: true,
    confidence: Math.min(0.9, 0.45 + uniqueUsers * 0.1),
    observedAt: summary.latestObservedAt,
    expiresAt: summary.expiresAt,
    metadata: { uniqueDevices: uniqueUsers, reportCount: reports.length },
  }];
  if (uniqueUsers >= 2) signals.push({
    source: "lit757_users",
    family: "verified_users",
    type: "crowd_report",
    value: summary.average,
    isLive: true,
    confidence: Math.min(0.9, summary.consensus * (0.55 + Math.min(0.35, uniqueUsers * 0.05))),
    observedAt: summary.latestObservedAt,
    expiresAt: summary.expiresAt,
    metadata: { consensus: summary.consensus, reportCount: reports.length, uniqueUsers },
  });

  await saveBuzzSignals(db, venueId, signals);
  const groundTruthRecorded = await recordConsensusGroundTruth({
    venueId,
    reports,
    average: summary.average,
    consensus: summary.consensus,
    uniqueUsers,
    observedAt,
  });
  const buzz = await recomputeBuzzScore(db, venue as VenueForBuzz);
  const points = await awardBuzzPoints(member.id, venueId, String(insertedReport.id), uniqueUsers === 1);

  return NextResponse.json({
    success: true,
    accepted: true,
    verifiedNearby: true,
    distanceMeters: Math.round(distance),
    reportCount: uniqueUsers,
    groundTruthRecorded,
    buzz,
    ...points,
  });
}
