import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";
import {
  eventbriteHasMorePages,
  eventbriteOrganizationIds,
  normalizeEventbriteEvent,
  type EventbriteEvent,
} from "../../../src/lib/events/eventbrite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const EVENTBRITE_API_BASE = "https://www.eventbriteapi.com/v3";
const MAX_ORGANIZATIONS = 20;
const MAX_PAGES_PER_ORGANIZATION = 4;

type EventbriteResponse = {
  events?: EventbriteEvent[];
  pagination?: { has_more_items?: boolean };
};

type ProviderError = {
  endpoint: string;
  status?: number;
  message: string;
};

async function eventbriteRequest<T>(path: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${EVENTBRITE_API_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as T | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String((payload as { error_description?: unknown; error?: unknown }).error_description || (payload as { error?: unknown }).error || `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;
  if (!token) {
    return NextResponse.json({
      success: false,
      configured: false,
      source: "eventbrite",
      scope: "account_organizations",
      error: "Missing EVENTBRITE_PRIVATE_TOKEN",
    }, { status: 503 });
  }

  const providerErrors: ProviderError[] = [];
  try {
    const organizationPayload = await eventbriteRequest<unknown>("/users/me/organizations/", token);
    const organizationIds = eventbriteOrganizationIds(organizationPayload).slice(0, MAX_ORGANIZATIONS);
    const providerEvents: EventbriteEvent[] = [];

    for (const organizationId of organizationIds) {
      for (let page = 1; page <= MAX_PAGES_PER_ORGANIZATION; page += 1) {
        const params = new URLSearchParams({
          status: "live",
          time_filter: "current_future",
          expand: "venue,ticket_availability",
          page_size: "50",
          page: String(page),
        });
        const path = `/organizations/${encodeURIComponent(organizationId)}/events/?${params.toString()}`;
        try {
          const payload = await eventbriteRequest<EventbriteResponse>(path, token);
          providerEvents.push(...(Array.isArray(payload.events) ? payload.events : []));
          if (!eventbriteHasMorePages(payload)) break;
        } catch (error) {
          providerErrors.push({
            endpoint: `/organizations/${organizationId}/events/`,
            status: error instanceof Error && "status" in error ? Number((error as Error & { status?: number }).status) : undefined,
            message: error instanceof Error ? error.message : "Eventbrite organization request failed",
          });
          break;
        }
      }
    }

    const createdAt = new Date().toISOString();
    const normalized = providerEvents
      .map(event => normalizeEventbriteEvent(event, createdAt))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const rows = [...new Map(normalized.map(event => [event.source_event_id, event])).values()];
    const skippedOutsideMarketOrIncomplete = providerEvents.length - normalized.length;

    if (rows.length) {
      const { error } = await supabase
        .from("events")
        .upsert(rows, { onConflict: "source_event_id" });
      if (error) {
        return NextResponse.json({
          success: false,
          configured: true,
          source: "eventbrite",
          scope: "account_organizations",
          error: "Supabase upsert failed",
          details: error.message,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      configured: true,
      source: "eventbrite",
      scope: "account_organizations",
      authenticated: true,
      organizationCount: organizationIds.length,
      providerEventsFound: providerEvents.length,
      marketEventsUpserted: rows.length,
      skippedOutsideMarketOrIncomplete,
      providerErrors,
      publicRegionalDiscovery: false,
      distributionPartnerApprovalRequired: true,
      truthNote: "Eventbrite events are scheduled forecast context only. A personal token can access events belonging to the authenticated account's organizations; broad public regional discovery requires Eventbrite distribution-partner approval.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as Error & { status?: number }).status)
      : 502;
    return NextResponse.json({
      success: false,
      configured: true,
      source: "eventbrite",
      scope: "account_organizations",
      authenticated: false,
      error: error instanceof Error ? error.message : "Eventbrite authentication failed",
      publicRegionalDiscovery: false,
      distributionPartnerApprovalRequired: true,
    }, { status: Number.isFinite(status) && status >= 400 ? status : 502 });
  }
}
