import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const venues = [
  {
    id: "venue-food",
    name: "Harbor Kitchen",
    city: "Norfolk",
    kind: "restaurant",
    type: "food",
    lat: 36.8508,
    lng: -76.2859,
    reason: "Dinner service is building",
    distanceMiles: 1.2,
    activity: {
      score: 84,
      label: "Busy",
      trendLabel: "Getting Busier",
      scoreMode: "forecast",
    },
  },
  {
    id: "venue-music",
    name: "Neon Sound",
    city: "Virginia Beach",
    kind: "nightlife",
    type: "music",
    lat: 36.8529,
    lng: -75.978,
    reason: "Live music tonight",
    distanceMiles: 8.4,
    activity: {
      score: 91,
      label: "Very Busy",
      trendLabel: "Getting Busier",
      scoreMode: "live",
    },
  },
];

async function mockBuzzData(page: Page) {
  await page.route("https://api.mapbox.com/**", (route) => route.abort());
  await page.route("https://events.mapbox.com/**", (route) => route.abort());
  await page.route("**/api/nearby**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        venues,
        picks: venues,
        scope: { label: "in Hampton Roads" },
      }),
    }),
  );
  await page.route("**/api/discover**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, venues, picks: venues }),
    }),
  );
  await page.route("**/api/venue-detail**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        venue: {
          address: "100 Granby Street, Norfolk, VA",
          hours: "Open until 11 PM",
        },
      }),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockBuzzData(page);
  await page.goto("/");
  await expect(page.locator(".buzz-map-app")).toBeVisible();
});

test("responsive Buzz discovery supports filtering and venue details", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: /BUZZ/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Places buzzing now" })).toBeVisible();
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(2);

  await page.getByRole("button", { name: "Food", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Food", exact: true })).toBeVisible();
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(1);

  await page.locator(".buzz-map-list-scroll article").first().click();
  await expect(page.getByRole("heading", { name: "Harbor Kitchen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close venue" })).toBeVisible();
});

test("responsive shell has no serious or critical accessibility violations", async ({
  page,
}) => {
  const results = await new AxeBuilder({ page })
    // Color contrast is validated separately with the production theme; browser
    // antialiasing makes it noisy in deterministic CI screenshots.
    .disableRules(["color-contrast"])
    .analyze();
  const blocking = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical"
  );
  expect(blocking).toEqual([]);
});
