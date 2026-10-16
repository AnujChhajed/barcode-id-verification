import {
  APPROVED,
  REASON_TEXT,
  UNABLE_TO_VERIFY,
  evaluateCredential,
  gateResultFor,
} from "../domain/credential-validity.js";
import { findCredentialById, toCredentialView } from "../data/id-cards.js";
import {
  findRecentApprovedScan,
  insertGateEvent,
  listGateEvents,
  listInsidePeople,
} from "../data/gate-logs.js";
import { findPersonById, toVerificationView } from "../data/persons.js";
import {
  readIntegerSetting,
  siteToday,
} from "../data/settings.js";
import { logger } from "../lib/logger.js";
import { addSeconds, nowIso } from "../lib/time.js";
import { listGateEventsQuerySchema, verifyGateSchema } from "../validation/schemas.js";

const GATE_ROLES = ["administrator", "security_staff"];
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 5;

function isUniqueViolation(error) {
  return error?.code === "23505" || String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

async function recordScan(db, scan) {
  if (scan.result === APPROVED && scan.credentialId) {
    const windowSeconds = await readIntegerSetting(
      db,
      "scan.duplicate_window_seconds",
      DEFAULT_DUPLICATE_WINDOW_SECONDS,
      { min: 0, max: 300 },
    );
    const previous = await findRecentApprovedScan(db, {
      credentialId: scan.credentialId,
      gateId: scan.gateId,
      direction: scan.direction,
      since: addSeconds(new Date(scan.occurredAt), -windowSeconds),
    });
    if (previous) {
      return { eventId: previous.id, duplicate: true, recorded: true };
    }
  }

  try {
    const eventId = await insertGateEvent(db, scan);
    return { eventId, duplicate: false, recorded: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { eventId: null, duplicate: true, recorded: true };
    }
    throw error;
  }
}

export function registerGateRoutes({ registrar, db }) {
  // -------------------------------------------------------------------------
  // The scan. Returns a verdict and records it.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/gate/verify",
    access: GATE_ROLES,
    body: verifyGateSchema,
    handler: async (req, res) => {
      const { code, direction } = req.body;
      const now = new Date();
      const occurredAt = nowIso(now);
      const gateId = "gate-p3-main";

      let credential = null;
      let person = null;
      let today = null;
      let reason;
      let outcome;

      try {
        credential = await findCredentialById(db, code);
        person = credential ? await findPersonById(db, credential.person_id) : null;
        today = await siteToday(db);
        reason = evaluateCredential(credential, person?.status, today);
        outcome = gateResultFor(reason);
      } catch (error) {
        logger.error("gate verification could not read authoritative data", {
          error: error?.message,
        });
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      let scan = { eventId: null, duplicate: false, recorded: false };
      try {
        scan = await recordScan(db, {
          credentialId: credential ? (credential.card_number || credential.id) : null,
          personId: person?.id ?? null,
          gateId,
          direction,
          result: outcome,
          reasonCode: reason.code,
          reasonText: reason.text,
          scannedCode: code,
          occurredAt,
          operatorUserId: req.user.id,
        });
      } catch (error) {
        logger.error("gate event could not be recorded", { error: error?.message });
      }

      if (outcome === APPROVED && !scan.recorded) {
        reason = { valid: false, code: "indeterminate", text: REASON_TEXT.indeterminate };
        outcome = UNABLE_TO_VERIFY;
      }

      res.json({
        result: outcome,
        reasonCode: reason.code,
        reasonText: reason.text,
        direction,
        occurredAt,
        duplicate: scan.duplicate,
        recorded: scan.recorded,
        eventId: scan.eventId,
        person: person ? toVerificationView(person) : null,
        credential: credential ? toCredentialView(credential) : null,
      });
    },
  });

  // -------------------------------------------------------------------------
  // The scan history. Read-only; gate_logs is append-only.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/gate/events",
    access: GATE_ROLES,
    query: listGateEventsQuerySchema,
    handler: async (req, res) => {
      const filters = req.validatedQuery;
      const result = await listGateEvents(db, filters);
      res.json(result);
    },
  });

  // -------------------------------------------------------------------------
  // Who is currently on site: derived from latest gate scans.
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "GET",
    path: "/api/inside",
    access: GATE_ROLES,
    handler: async (req, res) => {
      const today = await siteToday(db);
      const inside = await listInsidePeople(db);
      res.json({
        asOf: nowIso(),
        today,
        inside,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Offline scan queue synchronization endpoint
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/gate/sync",
    access: GATE_ROLES,
    handler: async (req, res) => {
      const { items } = req.body || {};
      if (!Array.isArray(items) || items.length === 0) {
        return res.json({ synced: 0, items: [] });
      }

      const synced = [];
      for (const item of items) {
        try {
          const eventId = await insertGateEvent(db, {
            credentialId: item.scanned_code || item.scannedCode,
            personId: item.student_id || item.personId || null,
            gateId: item.gate_id || "Plant 3 - Main Gate",
            direction: item.direction || "entry",
            result: item.decision === "allowed" ? "approved" : "rejected",
            reasonCode: item.reason || null,
            reasonText: item.reason || null,
            scannedCode: item.scanned_code || item.scannedCode,
            occurredAt: item.scanned_at || nowIso(),
            operatorUserId: req.user.id,
            recordedOffline: true,
            syncedAt: nowIso(),
          });
          synced.push({ clientQueueId: item.id, serverEventId: eventId, success: true });
        } catch (err) {
          synced.push({ clientQueueId: item.id, success: false, error: err.message });
        }
      }

      res.json({ synced: synced.filter((s) => s.success).length, items: synced });
    },
  });

  // -------------------------------------------------------------------------
  // Operator override endpoint
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/gate/override",
    access: GATE_ROLES,
    handler: async (req, res) => {
      const { code, personId, reason, direction, gateId } = req.body || {};
      const eventId = await insertGateEvent(db, {
        credentialId: code || "OVERRIDE",
        personId: personId || null,
        gateId: gateId || "Plant 3 - Main Gate",
        direction: direction || "entry",
        result: "approved",
        reasonCode: "operator_override",
        reasonText: reason || "Operator manual override",
        scannedCode: code || "OVERRIDE",
        occurredAt: nowIso(),
        operatorUserId: req.user.id,
        isOverride: true,
        overrideReason: reason,
      });
      res.json({ success: true, eventId });
    },
  });

  // -------------------------------------------------------------------------
  // Gate incident / panic alert endpoint
  // -------------------------------------------------------------------------
  registrar.defineRoute({
    method: "POST",
    path: "/api/gate/incident",
    access: GATE_ROLES,
    handler: async (req, res) => {
      const { note, gateId, direction } = req.body || {};
      const eventId = await insertGateEvent(db, {
        credentialId: "INCIDENT",
        personId: null,
        gateId: gateId || "Plant 3 - Main Gate",
        direction: direction || "entry",
        result: "rejected",
        reasonCode: "incident_alert",
        reasonText: note || "Security incident at gate",
        scannedCode: "INCIDENT",
        occurredAt: nowIso(),
        operatorUserId: req.user.id,
      });
      res.json({ success: true, eventId });
    },
  });
}

