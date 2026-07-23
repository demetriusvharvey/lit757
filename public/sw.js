const CACHE_NAME = "buzz-shell-v1";
const SHELL = ["/live", "/icon.svg", "/favicon.ico"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
  ]));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/live")));
  }
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Buzz activity update", body: event.data ? event.data.text() : "A watched place has meaningfully changed." };
  }

  const title = payload.title || "Buzz activity update";
  const venueId = payload.venueId || null;
  const venueUrl = payload.url || (venueId ? `/live?venue=${encodeURIComponent(venueId)}&source=buzz-watch` : "/live");
  const transition = payload.transition || "activity-change";
  const options = {
    body: payload.body || "A watched place has meaningfully changed.",
    icon: payload.icon || "/icon.svg",
    badge: payload.badge || "/icon.svg",
    tag: payload.tag || `buzz:${venueId || "area"}:${transition}`,
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.essential),
    timestamp: payload.timestamp || Date.now(),
    actions: venueId ? [
      { action: "directions", title: "Directions" },
      { action: "invite-crew", title: "Invite Crew" },
      { action: "mute", title: "Mute" },
    ] : [
      { action: "open-buzz", title: "Open Buzz" },
      { action: "mute", title: "Mute" },
    ],
    data: {
      url: venueUrl,
      venueId,
      directionsUrl: payload.directionsUrl || null,
      shareUrl: payload.shareUrl || null,
      watchId: payload.watchId || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === "mute") {
    event.waitUntil(fetch("/api/watches/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchId: data.watchId }),
    }).catch(() => undefined));
    return;
  }
  if (event.action === "directions" && data.directionsUrl) {
    event.waitUntil(self.clients.openWindow(data.directionsUrl));
    return;
  }

  const target = new URL(data.url || "/live", self.location.origin);
  if (data.venueId && !target.searchParams.get("venue")) target.searchParams.set("venue", data.venueId);
  if (event.action === "invite-crew") {
    target.searchParams.set("invite", "1");
    target.searchParams.set("source", "push-invite-crew");
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
