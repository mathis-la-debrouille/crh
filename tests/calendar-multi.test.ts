// Plain assertion script — run with: npx tsx tests/calendar-multi.test.ts
// Mocks global.fetch to verify getCalendarIds + listCalendarEvents fan out across
// calendars and correctly tag non-primary events (the "missed Kiné de Sarah" bug).
import assert from "node:assert/strict";
import { getCalendarIds, listCalendarEvents } from "../src/lib/calendar-tools";

let passed = 0;
let failed = 0;
function check(label: string, fn: () => Promise<void> | void) {
  return (async () => {
    try { await fn(); console.log(`  ✓ ${label}`); passed++; }
    catch (err) {
      console.error(`  ✗ ${label}`);
      console.error(`    ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  })();
}

const originalFetch = global.fetch;

function mockCalendarList() {
  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/users/me/calendarList")) {
      return new Response(JSON.stringify({
        items: [
          { id: "primary", summary: "mathis@example.com", primary: true, selected: true, accessRole: "owner" },
          { id: "family123", summary: "Famille", selected: true, accessRole: "writer" },
          { id: "readonly456", summary: "Vacances FR", selected: true, accessRole: "freeBusyReader" },
          { id: "unselected789", summary: "Old calendar", selected: false, accessRole: "owner" },
        ],
      }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
}

function mockEventsPerCalendar(byCalendarId: Record<string, unknown[]>) {
  global.fetch = (async (url: string | URL) => {
    const u = String(url);
    const m = /\/calendars\/([^/]+)\/events/.exec(u);
    if (m) {
      const calId = decodeURIComponent(m[1]);
      return new Response(JSON.stringify({ items: byCalendarId[calId] ?? [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;
}

async function run() {
  await check("getCalendarIds filters out freeBusyReader and unselected calendars", async () => {
    mockCalendarList();
    const cals = await getCalendarIds("tok", "user1");
    const ids = cals.map((c) => c.id).sort();
    assert.deepEqual(ids, ["family123", "primary"]);
  });

  await check("getCalendarIds falls back to [primary] on fetch error", async () => {
    global.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    const cals = await getCalendarIds("tok", "user-err");
    assert.deepEqual(cals, [{ id: "primary", summary: "primary", primary: true }]);
  });

  await check("listCalendarEvents merges events from all calendars and tags non-primary with calendar name", async () => {
    mockEventsPerCalendar({
      primary: [
        { id: "e1", summary: "Client call", start: { dateTime: "2026-07-21T10:00:00+02:00" }, end: { dateTime: "2026-07-21T10:30:00+02:00" } },
      ],
      family123: [
        { id: "e2", summary: "Kiné de Sarah", start: { dateTime: "2026-07-21T14:00:00+02:00" }, end: { dateTime: "2026-07-21T15:00:00+02:00" } },
      ],
    });
    const events = await listCalendarEvents("tok", {
      calendars: [
        { id: "primary", summary: "mathis@example.com", primary: true },
        { id: "family123", summary: "Famille", primary: false },
      ],
    });
    assert.equal(events.length, 2);
    const kine = events.find((e) => e.summary === "Kiné de Sarah");
    assert.ok(kine, "secondary-calendar event must be present, not dropped");
    assert.equal(kine!.calendar, "Famille");
    const call = events.find((e) => e.summary === "Client call");
    assert.equal(call!.calendar, undefined, "primary-calendar events carry no calendar label");
    // sorted by start time
    assert.deepEqual(events.map((e) => e.summary), ["Client call", "Kiné de Sarah"]);
  });

  await check("a failed calendar is skipped silently, others still return", async () => {
    global.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("family123")) return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({
        items: [{ id: "e1", summary: "ok", start: { dateTime: "2026-07-21T10:00:00+02:00" }, end: { dateTime: "2026-07-21T10:30:00+02:00" } }],
      }), { status: 200 });
    }) as typeof fetch;
    const events = await listCalendarEvents("tok", {
      calendars: [
        { id: "primary", summary: "p", primary: true },
        { id: "family123", summary: "Famille", primary: false },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, "ok");
  });

  global.fetch = originalFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
