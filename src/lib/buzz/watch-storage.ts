import type { AlertMode, ActivityState, WatchKind, WatchRule } from "./product-intelligence";

const STORAGE_KEY = "buzz:watch-rules:v1";

export type CreateWatchInput = {
  kind: WatchKind;
  targetId: string;
  targetName: string;
  alertMode?: AlertMode;
  minState?: ActivityState;
  requireRising?: boolean;
  maxDistanceMiles?: number | null;
};

function available() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function loadWatchRules(): WatchRule[] {
  if (!available()) return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(item => item && item.id && item.targetId) : [];
  } catch {
    return [];
  }
}

export function saveWatchRules(rules: WatchRule[]) {
  if (!available()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  window.dispatchEvent(new CustomEvent("buzz:watches-changed", { detail: rules }));
}

export function createWatch(input: CreateWatchInput): WatchRule {
  return {
    id: `${input.kind}:${input.targetId}`,
    kind: input.kind,
    targetId: input.targetId,
    targetName: input.targetName,
    alertMode: input.alertMode || "balanced",
    minState: input.minState || "active",
    requireRising: input.requireRising || false,
    maxDistanceMiles: input.maxDistanceMiles ?? null,
    quietHours: { start: 23, end: 9 },
    enabled: true,
    lastNotifiedAt: null,
    lastNotifiedState: null,
  };
}

export function toggleWatch(input: CreateWatchInput) {
  const rules = loadWatchRules();
  const id = `${input.kind}:${input.targetId}`;
  const exists = rules.some(rule => rule.id === id);
  const next = exists ? rules.filter(rule => rule.id !== id) : [...rules, createWatch(input)];
  saveWatchRules(next);
  return { active: !exists, rules: next };
}

export function updateWatchRule(id: string, updates: Partial<WatchRule>) {
  const next = loadWatchRules().map(rule => rule.id === id ? { ...rule, ...updates, id: rule.id } : rule);
  saveWatchRules(next);
  return next;
}

export function isWatching(kind: WatchKind, targetId: string) {
  return loadWatchRules().some(rule => rule.id === `${kind}:${targetId}` && rule.enabled);
}
