import { expect, test, type Page } from "@playwright/test";

const athlete = {
  id: "athlete-e2e-1",
  name: "Jordan Test",
  sport: "MMA",
  instagram_handle: "jordan_test",
  follower_count: 125_000,
  pipeline_stage: "enrichment",
  enrichment_status: "pending",
};

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("e2e");
  await page.getByLabel("Password").fill("prime-champs-e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("unauthenticated pages and APIs fail closed", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  const response = await request.get("/api/pipeline/athletes", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
});

test("research, enrichment, approval, and outreach stay connected", async ({ page }) => {
  await signIn(page);

  const calls: string[] = [];
  let approved = false;
  let sent = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/research/run") {
      calls.push("research");
      return route.fulfill({
        json: {
          runId: "run-e2e-1",
          run: { id: "run-e2e-1" },
          results: [
            {
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              follower_count: athlete.follower_count,
              score: 88,
              reasoning: "Strong audience fit",
              concerns: [],
              similar_to: [],
            },
          ],
          stats: { added: 1 },
        },
      });
    }

    if (path === "/api/research/approve") {
      calls.push("research-approval");
      return route.fulfill({ json: { athlete } });
    }

    if (path === `/api/athletes/${athlete.id}/enrich`) {
      calls.push("enrichment");
      return route.fulfill({ json: { success: true, data: { message: "Enriched" } } });
    }

    if (path === "/api/outreach/approve") {
      approved = true;
      calls.push("outreach-approval");
      return route.fulfill({ json: { success: true } });
    }

    if (path === "/api/outreach/send") {
      expect(approved).toBe(true);
      sent = true;
      calls.push("outreach-send");
      return route.fulfill({ json: { success: true } });
    }

    if (path === "/api/outreach/queue") {
      return route.fulfill({
        json: {
          items: sent
            ? []
            : [
                {
                  id: "queue-e2e-1",
                  athlete_id: athlete.id,
                  queue_type: "dm",
                  content_preview: "Hi Jordan — would you be open to talking?",
                  approval_status: approved ? "approved" : "pending",
                  auto_approved: false,
                  created_at: "2026-08-05T12:00:00Z",
                  athlete,
                },
              ],
          stats: { pendingDms: sent ? 0 : 1, pendingComments: 0, sentToday: sent ? 1 : 0, responseRate: 0 },
        },
      });
    }

    if (path === "/api/outreach/settings") {
      return route.fulfill({ json: { settings: { approval_mode: "manual" } } });
    }

    if (path === `/api/athletes/${athlete.id}`) {
      return route.fulfill({ json: { athlete } });
    }

    if (path === "/api/instagram/photos") {
      return route.fulfill({ json: { photos: [] } });
    }

    if (path === "/api/outreach/touchpoints") {
      return route.fulfill({ json: { touchpoints: [] } });
    }

    if (path === "/api/pipeline/athletes") {
      return route.fulfill({ json: { athletes: [] } });
    }

    if (path.startsWith("/api/research/logs")) {
      return route.fulfill({ json: { logs: [] } });
    }

    if (path === "/api/historical") {
      return route.fulfill({ json: { athletes: [] } });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/pipeline/research");
  await page.getByRole("button", { name: /Run Research Agent/ }).click();
  await page.getByRole("button", { name: "🔬 Start Research" }).click();
  await expect(page.getByRole("heading", { name: /Research Results/ })).toBeVisible();
  await expect(page.getByText(athlete.name)).toBeVisible();
  await page.getByRole("button", { name: /Approve/ }).click();

  const enrichment = await page.evaluate(async (athleteId) => {
    const response = await fetch(`/api/athletes/${athleteId}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "instagram" }),
    });
    return response.json();
  }, athlete.id);
  expect(enrichment.success).toBe(true);

  await page.goto("/outreach");
  const queueItem = page.getByRole("button", { name: /Jordan Test Hi Jordan/ });
  await queueItem.click();
  await page.getByRole("button", { name: "Approve" }).click();
  await queueItem.click();
  await page.getByRole("button", { name: "Mark Sent" }).click();

  expect(calls).toEqual([
    "research",
    "research-approval",
    "enrichment",
    "outreach-approval",
    "outreach-send",
  ]);
});
