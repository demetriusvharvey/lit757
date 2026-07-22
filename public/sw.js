self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Things To Do 757", body: event.data ? event.data.text() : "A saved place is heating up." };
  }

  const title = payload.title || "Things To Do 757";
  const venueId = payload.venueId || null;
  const venueUrl = payload.url || (venueId ? `/?venue=${encodeURIComponent(venueId)}&source=heating-up-alert` : "/");
  const options = {
    body: payload.body || "A saved place is heating up.",
    icon: payload.icon || "/icon.svg",
    badge: payload.badge || "/icon.svg",
    tag: payload.tag || "lit757-buzz-alert",
    renotify: true,
    actions: venueId ? [
      { action: "invite-crew", title: "Invite the Crew" },
      { action: "open-buzz", title: "Open Buzz" },
    ] : [],
    data: {
      url: venueUrl,
      venueId,
      shareUrl: payload.shareUrl || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL(data.url || "/", self.location.origin);

  if (data.venueId && !target.searchParams.get("venue")) {
    target.searchParams.set("venue", data.venueId);
  }
  if (event.action === "invite-crew") {
    target.searchParams.set("invite", "1");
    target.searchParams.set("source", "push-invite-the-crew");
  }

  const targetUrl = target.href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});
