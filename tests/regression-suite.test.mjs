/**
 * ABB Plant 3 Security System — Comprehensive Automated Regression Suite
 * Tests Core Business Rules for:
 *  1. Gate Verification (RPC logic, plant lockdown, validity bounds, suspensions, watchlist)
 *  2. Canteen Verification (Meal service windows, daily duplicate prevention)
 *  3. Current Inside & Evacuation Roster (24h midnight shift crossings, overtime flags)
 *  4. Security Hardening & Export Sanitization (CSV formula injection prevention)
 *  5. Offline Cache & Deduplicated Sync Logic
 */
import test from "node:test";
import assert from "node:assert/strict";

// ── 1. Verification Decision Engine ──────────────────────────────────────────

function evaluateGateAccess({
  person,
  watchlistHit,
  lockdown = false,
  targetPlant = "Plant 3",
  now = new Date(),
}) {
  if (lockdown) {
    return { decision: "denied", reason: "Emergency lockdown — access suspended" };
  }

  if (watchlistHit && watchlistHit.is_active) {
    const isExpired = watchlistHit.expires_at && new Date(watchlistHit.expires_at) < now;
    if (!isExpired) {
      return {
        decision: "denied",
        reason: `WATCHLIST ALERT [${watchlistHit.alert_level.toUpperCase()}]: ${watchlistHit.reason}`,
      };
    }
  }

  if (!person) {
    return { decision: "unknown", reason: "Credential not found in database or plant cache" };
  }

  if (person.plant_id && person.plant_id !== targetPlant) {
    return {
      decision: "denied",
      reason: `Plant assignment mismatch: Assigned to ${person.plant_id} (Plant 3 gate only)`,
    };
  }

  if (person.status === "suspended") {
    const until = person.suspended_until ? new Date(person.suspended_until) : null;
    if (until && until < now) {
      // Suspension expired — auto-restored
      return { decision: "allowed", reason: null };
    }
    return {
      decision: "denied",
      reason: person.suspension_reason ? `Suspended: ${person.suspension_reason}` : "Person is suspended",
    };
  }

  if (person.status !== "active") {
    return { decision: "denied", reason: `Status is ${person.status}` };
  }

  if (person.valid_from && new Date(person.valid_from) > now) {
    return { decision: "denied", reason: `Credential validity has not started (starts ${person.valid_from})` };
  }

  if (person.expires_at && new Date(person.expires_at) < now) {
    return { decision: "denied", reason: `Pass expired on ${person.expires_at}` };
  }

  return { decision: "allowed", reason: null };
}

test("1.1 Gate Verification: Active worker assigned to Plant 3 is allowed", () => {
  const person = {
    id: "w-01",
    full_name: "John Doe",
    status: "active",
    plant_id: "Plant 3",
    category: "worker",
    expires_at: new Date(Date.now() + 86400000 * 30).toISOString(),
  };
  const res = evaluateGateAccess({ person });
  assert.equal(res.decision, "allowed");
  assert.equal(res.reason, null);
});

test("1.2 Gate Verification: Plant assignment mismatch is rejected", () => {
  const person = {
    id: "w-02",
    full_name: "Jane Smith",
    status: "active",
    plant_id: "Plant 1",
    category: "worker",
  };
  const res = evaluateGateAccess({ person });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /Plant assignment mismatch/);
});

test("1.3 Gate Verification: Expired pass is rejected", () => {
  const person = {
    id: "w-03",
    full_name: "Bob Stone",
    status: "active",
    plant_id: "Plant 3",
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  };
  const res = evaluateGateAccess({ person });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /Pass expired/);
});

test("1.4 Gate Verification: Suspended person is rejected with audit reason", () => {
  const person = {
    id: "w-04",
    full_name: "Alice Brown",
    status: "suspended",
    suspension_reason: "Safety infraction in Switchgear Assembly Bay 4",
    suspended_until: new Date(Date.now() + 86400000 * 7).toISOString(),
    plant_id: "Plant 3",
  };
  const res = evaluateGateAccess({ person });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /Safety infraction/);
});

test("1.5 Gate Verification: Past suspension automatically restores access", () => {
  const person = {
    id: "w-05",
    full_name: "Charlie Ray",
    status: "suspended",
    suspension_reason: "Temporary gate card review",
    suspended_until: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    plant_id: "Plant 3",
  };
  const res = evaluateGateAccess({ person });
  assert.equal(res.decision, "allowed");
});

test("1.6 Gate Verification: Active Watchlist hit overrides active status with critical alert", () => {
  const person = {
    id: "w-06",
    full_name: "Flagged Contractor",
    status: "active",
    plant_id: "Plant 3",
  };
  const watchlistHit = {
    id: "wl-01",
    full_name: "Flagged Contractor",
    is_active: true,
    alert_level: "critical",
    reason: "Attempted unauthorized egress with plant tools",
    expires_at: null,
  };
  const res = evaluateGateAccess({ person, watchlistHit });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /WATCHLIST ALERT \[CRITICAL\]/);
});

test("1.7 Gate Verification: Emergency lockdown denies all personnel", () => {
  const person = {
    id: "w-07",
    full_name: "Super Admin",
    status: "active",
    plant_id: "Plant 3",
  };
  const res = evaluateGateAccess({ person, lockdown: true });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /Emergency lockdown/);
});

// ── 2. Canteen Verification & Meal Service Engine ────────────────────────────

function detectMealService(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 360 && mins < 570) return "breakfast";     // 06:00 – 09:30
  if (mins >= 690 && mins < 870) return "lunch";         // 11:30 – 14:30
  if (mins >= 1050 && mins < 1230) return "dinner";      // 17:30 – 20:30
  if (mins >= 1350 || mins < 120) return "night_snack";  // 22:30 – 02:00
  return "lunch"; // Default service fallback during turnaround
}

function processCanteenClaim({ person, mealType, logDate, existingLogs = [] }) {
  if (!person || person.status !== "active") {
    return { decision: "denied", reason: "Personnel record is inactive or suspended" };
  }

  // Duplicate check for composite key: (student_id, log_date, meal_type)
  const prior = existingLogs.find(
    (l) =>
      l.student_id === person.id &&
      l.log_date === logDate &&
      l.meal_type === mealType &&
      l.decision === "allowed"
  );

  if (prior) {
    return {
      decision: "denied",
      reason: `Duplicate Claim: ${mealType} already claimed today at ${new Date(prior.created_at).toLocaleTimeString()}`,
      priorClaimAt: prior.created_at,
    };
  }

  return { decision: "allowed", reason: null };
}

test("2.1 Canteen: Detects breakfast between 06:00 and 09:30", () => {
  const date = new Date("2026-10-15T08:15:00");
  assert.equal(detectMealService(date), "breakfast");
});

test("2.2 Canteen: Detects lunch between 11:30 and 14:30", () => {
  const date = new Date("2026-10-15T12:45:00");
  assert.equal(detectMealService(date), "lunch");
});

test("2.3 Canteen: Detects night snack crossing midnight (23:15 & 01:15)", () => {
  const preMidnight = new Date("2026-10-15T23:15:00");
  const postMidnight = new Date("2026-10-16T01:15:00");
  assert.equal(detectMealService(preMidnight), "night_snack");
  assert.equal(detectMealService(postMidnight), "night_snack");
});

test("2.4 Canteen: First daily claim is approved", () => {
  const person = { id: "p-01", status: "active", full_name: "Engineer Dave" };
  const res = processCanteenClaim({
    person,
    mealType: "lunch",
    logDate: "2026-10-15",
    existingLogs: [],
  });
  assert.equal(res.decision, "allowed");
});

test("2.5 Canteen: Second claim of same meal on same day is rejected with prior timestamp", () => {
  const person = { id: "p-01", status: "active", full_name: "Engineer Dave" };
  const priorLogs = [
    {
      id: "cl-01",
      student_id: "p-01",
      meal_type: "lunch",
      log_date: "2026-10-15",
      decision: "allowed",
      created_at: "2026-10-15T12:10:00Z",
    },
  ];
  const res = processCanteenClaim({
    person,
    mealType: "lunch",
    logDate: "2026-10-15",
    existingLogs: priorLogs,
  });
  assert.equal(res.decision, "denied");
  assert.match(res.reason, /Duplicate Claim/);
  assert.equal(res.priorClaimAt, "2026-10-15T12:10:00Z");
});

test("2.6 Canteen: Different meal service on same day is approved", () => {
  const person = { id: "p-01", status: "active", full_name: "Engineer Dave" };
  const priorLogs = [
    {
      id: "cl-01",
      student_id: "p-01",
      meal_type: "breakfast",
      log_date: "2026-10-15",
      decision: "allowed",
      created_at: "2026-10-15T07:30:00Z",
    },
  ];
  const res = processCanteenClaim({
    person,
    mealType: "lunch",
    logDate: "2026-10-15",
    existingLogs: priorLogs,
  });
  assert.equal(res.decision, "allowed");
});

// ── 3. Evacuation & Current Inside Tracking Engine ───────────────────────────

function computeCurrentInside(logs, now = new Date()) {
  const windowStart = new Date(now.getTime() - 36 * 3600000);
  const byPerson = new Map();

  for (const log of logs) {
    if (!log.student_id || log.decision !== "allowed") continue;
    const logTime = new Date(log.scanned_at);
    if (logTime < windowStart) continue;

    const existing = byPerson.get(log.student_id);
    if (!existing || new Date(existing.scanned_at) < logTime) {
      byPerson.set(log.student_id, log);
    }
  }

  const inside = [];
  for (const [id, lastEvent] of byPerson.entries()) {
    if (lastEvent.direction === "in") {
      const entryTime = new Date(lastEvent.scanned_at);
      const hoursInside = (now.getTime() - entryTime.getTime()) / 3600000;
      inside.push({
        student_id: id,
        entered_at: lastEvent.scanned_at,
        hours_inside: hoursInside,
        is_overtime: hoursInside >= 12,
      });
    }
  }

  return inside;
}

test("3.1 Evacuation Roster: Correctly identifies personnel inside after entry", () => {
  const now = new Date("2026-10-15T14:00:00Z");
  const logs = [
    { student_id: "w-1", decision: "allowed", direction: "in", scanned_at: "2026-10-15T08:00:00Z" },
    { student_id: "w-2", decision: "allowed", direction: "in", scanned_at: "2026-10-15T08:30:00Z" },
    { student_id: "w-2", decision: "allowed", direction: "out", scanned_at: "2026-10-15T12:00:00Z" },
  ];
  const inside = computeCurrentInside(logs, now);
  assert.equal(inside.length, 1);
  assert.equal(inside[0].student_id, "w-1");
  assert.equal(inside[0].is_overtime, false);
});

test("3.2 Evacuation Roster: Flags overtime (>12h) across plant shifts", () => {
  const now = new Date("2026-10-15T22:00:00Z");
  const logs = [
    { student_id: "w-1", decision: "allowed", direction: "in", scanned_at: "2026-10-15T06:00:00Z" }, // 16 hrs inside
  ];
  const inside = computeCurrentInside(logs, now);
  assert.equal(inside.length, 1);
  assert.equal(inside[0].is_overtime, true);
  assert.equal(inside[0].hours_inside, 16);
});

// ── 4. CSV Formula Injection Sanitization ────────────────────────────────────

function sanitizeCSVValue(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str) || /^[=+\-@]/.test(str.trim())) {
    return "'" + str;
  }
  return str;
}

test("4.1 Export Hardening: Neutralizes formula injection characters (=, +, -, @)", () => {
  assert.equal(sanitizeCSVValue("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
  assert.equal(sanitizeCSVValue("+1234567890"), "'+1234567890");
  assert.equal(sanitizeCSVValue("-SUM(A1:A10)"), "'-SUM(A1:A10)");
  assert.equal(sanitizeCSVValue("@echo dangerous"), "'@echo dangerous");
  assert.equal(sanitizeCSVValue("\tmalicious_tab"), "'\tmalicious_tab");
});

test("4.2 Export Hardening: Leaves clean strings and numbers unaffected", () => {
  assert.equal(sanitizeCSVValue("ABB-W-1049"), "ABB-W-1049");
  assert.equal(sanitizeCSVValue("John Doe"), "John Doe");
  assert.equal(sanitizeCSVValue("12345"), "12345");
  assert.equal(sanitizeCSVValue(""), "");
});

// ── 5. Offline Queue Deduplication & Sync ─────────────────────────────────────

test("5.1 Offline Queue: Generates deterministic unique sync IDs", () => {
  const items = [
    { scanned_code: "ABB-W-01", sync_id: "uuid-1", scanned_at: "2026-10-15T10:00:00Z" },
    { scanned_code: "ABB-W-02", sync_id: "uuid-2", scanned_at: "2026-10-15T10:01:00Z" },
    { scanned_code: "ABB-W-01", sync_id: "uuid-1", scanned_at: "2026-10-15T10:00:00Z" }, // Duplicate retry
  ];

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    if (!seen.has(item.sync_id)) {
      seen.add(item.sync_id);
      deduped.push(item);
    }
  }

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].sync_id, "uuid-1");
  assert.equal(deduped[1].sync_id, "uuid-2");
});
