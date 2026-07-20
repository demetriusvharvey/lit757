import type { BuzzSignal } from "../types";

const INVENTORY_URL = "https://app.ticketmaster.com/inventory-status/v1/availability";

type InventoryRow = {
  eventId?: string;
  eventid?: string;
  status?: string;
  resaleStatus?: string;
  statusDetail?: string;
  priceRanges?: Array<{ type?: string; minPrice?: number; maxPrice?: number }>;
};

export function isTicketmasterInventoryConfigured() {
  return Boolean(process.env.TICKETMASTER_INVENTORY_API_KEY);
}

export async function fetchTicketmasterInventory(eventIds: string[]) {
  const apiKey = process.env.TICKETMASTER_INVENTORY_API_KEY;
  if (!apiKey) throw new Error("TICKETMASTER_INVENTORY_API_KEY is not configured");
  const unique = [...new Set(eventIds.filter(Boolean))];
  if (!unique.length) return [] as InventoryRow[];

  const output: InventoryRow[] = [];
  for (let index = 0; index < unique.length; index += 300) {
    const batch = unique.slice(index, index + 300);
    const params = new URLSearchParams({ events: batch.join(","), apikey: apiKey });
    const response = await fetch(`${INVENTORY_URL}?${params.toString()}`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Ticketmaster inventory failed (${response.status})`);
    const payload = await response.json() as InventoryRow[];
    output.push(...payload);
  }
  return output;
}

export function ticketmasterInventorySignal(row: InventoryRow, observedAt = new Date()): BuzzSignal {
  const status = String(row.status || "UNKNOWN").toUpperCase();
  const value = status === "TICKETS_NOT_AVAILABLE" ? 100 : status === "FEW_TICKETS_LEFT" ? 72 : status === "TICKETS_AVAILABLE" ? 18 : 0;
  return {
    source: "ticketmaster",
    family: "commercial_demand",
    type: "ticket_inventory",
    value,
    isLive: false,
    confidence: status === "UNKNOWN" ? 0.2 : 0.72,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 60 * 60 * 1000).toISOString(),
    metadata: {
      eventId: row.eventId || row.eventid || null,
      status,
      resaleStatus: row.resaleStatus || null,
      statusDetail: row.statusDetail || null,
      priceRanges: row.priceRanges || [],
    },
  };
}
