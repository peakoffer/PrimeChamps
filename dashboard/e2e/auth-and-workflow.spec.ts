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
  await page.context().addCookies([
    {
      name: "primechamps-e2e-auth",
      value: "prime-champs-playwright-only-session",
      url: "http://127.0.0.1:3100",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
}

test("unauthenticated pages and APIs fail closed", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);

  await expect(
    page.getByRole("link", { name: /Continue with Microsoft/ })
  ).toBeVisible();
  await page.getByText("Use email and password").click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();

  const response = await request.get("/api/pipeline/athletes", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
});

test("durable research and draft-only outreach stay connected", async ({ page }) => {
  await signIn(page);

  const calls: string[] = [];
  let researchQueued = false;
  let approved = false;
  let manuallyRecorded = false;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/research/run") {
      researchQueued = true;
      calls.push("research");
      return route.fulfill({
        status: 202,
        json: {
          runId: "run-e2e-1",
          status: "queued",
          message: "Research queued",
        },
      });
    }

    if (path === "/api/research/evaluations") {
      return route.fulfill({
        json: {
          cases: [],
          results: [],
          summary: { total: 4, active: 4, evaluated: 4, passed: 4, passRate: 100 },
        },
      });
    }

    if (path === "/api/ai/models") {
      return route.fulfill({
        json: { models: [{ id: "claude-sonnet-latest", displayName: "Latest Sonnet" }] },
      });
    }

    if (path.startsWith("/api/research/logs")) {
      return route.fulfill({
        json: {
          logs: researchQueued ? [
            {
              id: "run-e2e-1",
              created_at: "2026-08-05T12:00:00Z",
              completed_at: null,
              status: "queued",
              phase: "queued",
              prompt_version: "research-v3",
              scoring_model: "claude-sonnet-latest",
              config_used: { sportFocus: "MMA", followerMin: 0, followerMax: 500000, resultCount: 5 },
              context_summary: {},
              raw_results: [],
              scoring_details: [],
              final_results: [],
              stats: { discovered: 0, returned: 0, added: 0, held: 0, blocked: 0 },
            },
          ] : [],
        },
      });
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
      manuallyRecorded = true;
      calls.push("manual-send-record");
      return route.fulfill({ json: { success: true, sent: false, recordedOnly: true } });
    }

    if (path === "/api/outreach/queue") {
      if (url.searchParams.get("type") === "sent") return route.fulfill({ json: { items: [] } });
      return route.fulfill({
        json: {
          items: manuallyRecorded
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
          stats: { pendingDms: manuallyRecorded ? 0 : 1, pendingComments: 0, sentToday: manuallyRecorded ? 1 : 0, responseRate: 0 },
        },
      });
    }

    if (path === "/api/outreach/auto-send") {
      return route.fulfill({
        json: {
          settings: { autoSend: false, paused: false, dailyLimit: 15, windowStart: 9, windowEnd: 20, timezone: "America/New_York" },
          sender: null,
          queuedCount: 1,
          canManage: true,
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

    if (path === "/api/historical") {
      return route.fulfill({ json: { athletes: [] } });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/pipeline/research");
  await expect(page.getByRole("heading", { name: "Find athletes", exact: true })).toBeVisible();
  await expect(page.getByText("Nothing is sent to athletes")).toBeVisible();
  await page.getByRole("button", { name: "Find athletes", exact: true }).click();
  await expect(page.getByText("Search started")).toBeVisible();
  await expect(page.getByText("Starting…")).toBeVisible();
  expect(researchQueued).toBe(true);

  const enrichment = await page.evaluate(async (athleteId) => {
    const response = await fetch(`/api/athletes/${athleteId}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "instagram" }),
    });
    return response.json();
  }, athlete.id);
  expect(enrichment.success).toBe(true);

  approved = true;
  await page.goto("/instagram");
  await expect(page.getByText("Automatic first messages")).toBeVisible();
  await expect(page.getByText("The sending service isn't connected yet")).toBeVisible();
  await expect(page.getByText("Hi Jordan — would you be open to talking?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on" })).toBeVisible();

  // Nothing sends while the sending service is unavailable, even with an approved draft.
  expect(calls).toEqual(["research", "enrichment"]);
});

test("completed research notifications open the exact run audit", async ({ page }) => {
  await signIn(page);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/notifications" && request.method() === "GET") {
      return route.fulfill({
        json: {
          unreadCount: 1,
          notifications: [
            {
              id: "notification-e2e-1",
              created_at: "2026-08-05T12:00:00Z",
              type: "research_completed",
              title: "Research Complete",
              message: "Gymnastics research finished",
              metadata: { runId: "run-e2e-1" },
              link: null,
              read: false,
            },
          ],
        },
      });
    }

    if (path === "/api/notifications/mark-read") {
      return route.fulfill({ json: { success: true } });
    }

    if (path === "/api/pipeline/athletes") {
      return route.fulfill({ json: { athletes: [] } });
    }

    if (path === "/api/research/logs") {
      return route.fulfill({
        json: {
          logs: [
            {
              id: "run-e2e-1",
              created_at: "2026-08-05T12:00:00Z",
              completed_at: "2026-08-05T12:01:00Z",
              status: "completed",
              config_used: { sportFocus: "gymnastics", followerMin: 0, followerMax: 500000, resultCount: 5 },
              context_summary: {},
              raw_results: [],
              scoring_details: [],
              final_results: [],
              stats: { discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0 },
            },
          ],
        },
      });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/notifications");
  await page.getByRole("button", { name: /Research Complete.*Gymnastics research finished/ }).click();
  await expect(page).toHaveURL("/pipeline/research?session=run-e2e-1");
  await expect(page.getByRole("heading", { name: "Find athletes", exact: true })).toBeVisible();
  await expect(page.getByText("0 found · 0 sent to Approval")).toBeVisible();
});

test("research run expansion only makes safe candidates movable", async ({ page }) => {
  await signIn(page);

  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path === "/api/research/sessions") {
      return route.fulfill({
        json: {
          sessions: [
            {
              id: "run-e2e-1",
              status: "completed",
              created_at: "2026-08-05T12:00:00Z",
              config_used: { sportFocus: "gymnastics" },
              stats: { discovered: 5, returned: 2, added: 0, held: 1, blocked: 1 },
            },
          ],
        },
      });
    }

    if (path === "/api/research/sessions/run-e2e-1/athletes") {
      return route.fulfill({
        json: {
          athletes: [
            {
              id: "legacy_candidate",
              candidate_key: "legacy_candidate",
              research_session_id: "run-e2e-1",
              persisted: false,
              can_move: true,
              name: "Legacy Candidate",
              sport: "gymnastics",
              instagram_handle: "legacy_candidate",
              pipeline_stage: "research",
              disposition: "held",
              research_score: 58,
            },
            {
              id: "blocked_candidate",
              candidate_key: "blocked_candidate",
              research_session_id: "run-e2e-1",
              persisted: false,
              can_move: false,
              name: "Blocked Candidate",
              sport: "gymnastics",
              instagram_handle: "blocked_candidate",
              pipeline_stage: "research",
              disposition: "blocked",
              research_score: 0,
            },
          ],
        },
      });
    }

    if (path === "/api/pipeline/athletes") {
      return route.fulfill({ json: { athletes: [] } });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/pipeline");
  await page.getByRole("button", { name: /gymnastics 2 found/ }).click();

  const legacyCandidate = page.getByTestId("research-candidate-legacy_candidate");
  const blockedCandidate = page.getByTestId("research-candidate-blocked_candidate");
  await expect(legacyCandidate).toHaveAttribute("draggable", "true");
  await expect(legacyCandidate).toContainText("Needs review");
  await expect(legacyCandidate).toContainText("Drag to Approval");
  await expect(blockedCandidate).toHaveAttribute("draggable", "false");
  await expect(blockedCandidate).toContainText("Safety blocked");
});
