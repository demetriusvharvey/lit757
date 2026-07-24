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
      score: 68,
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
      body: JSON.stringify({
        success: true,
        generatedAt: "2026-07-24T12:00:00.000Z",
        context: {
          key: "afternoon",
          eyebrow: "Your afternoon in the 757",
          headline: "Make the most of right now",
          timing: "This afternoon",
          description: "Deterministic discovery results for the browser suite.",
          city: "All 757",
          mode: "all",
          resultCount: venues.length,
        },
        freshness: {
          label: "Updated now",
          timestamp: "2026-07-24T12:00:00.000Z",
          automatic: true,
        },
        venues,
        picks: venues,
      }),
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
  await page.route("**/api/venue-logo**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#171c24"/></svg>',
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockBuzzData(page);
  await page.goto("/");
  await expect(page.locator(".buzz-map-app")).toBeVisible();
});

test("responsive Buzz discovery supports filtering and venue details", async (
  { page },
  testInfo,
) => {
  const isMobile = testInfo.project.name === "mobile-chromium";

  await expect(page.getByRole("button", { name: /BUZZ/ })).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole("button", { name: "Top Buzz" })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Places buzzing now" })).toBeVisible();
  }
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(2);

  const buzzingFilter = page.getByRole("button", { name: "Buzzing", exact: true });
  await buzzingFilter.click();
  await expect(buzzingFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(1);
  await expect(page.getByText("Neon Sound", { exact: true })).toBeVisible();
  await buzzingFilter.click();
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(2);

  const foodFilter = page.getByRole("button", { name: "Food", exact: true });
  await foodFilter.click();
  await expect(foodFilter).toHaveAttribute("aria-pressed", "true");
  if (!isMobile) {
    await expect(page.getByRole("heading", { name: "Food", exact: true })).toBeVisible();
  }
  await expect(page.locator(".buzz-map-list-scroll article")).toHaveCount(1);

  const venueButton = page.getByRole("button", {
    name: /Open Harbor Kitchen details/,
  });
  await venueButton.focus();
  await expect(venueButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Harbor Kitchen" })).toBeVisible();
  const closeButton = page.getByRole("button", { name: "Close venue" });
  await expect(closeButton).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Harbor Kitchen" })).toHaveCount(0);
  await expect(venueButton).toBeFocused();
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
