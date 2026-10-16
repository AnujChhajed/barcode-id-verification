import { insertPerson, searchPeople } from "../data/persons.js";
import { insertVisit, listVisits } from "../data/visits.js";
import { insertCredential } from "../data/id-cards.js";
import { insertGateEvent } from "../data/gate-logs.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";

const GATE_ROLES = ["administrator", "security_staff"];

export function registerVisitRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "GET",
    path: "/api/visits",
    access: GATE_ROLES,
    handler: async (req, res) => {
      const { status, limit, offset } = req.query || {};
      const result = await listVisits(db, {
        status: status ? String(status) : undefined,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      res.json(result);
    },
  });

  // Walk-in visitor registration at the gate
  registrar.defineRoute({
    method: "POST",
    path: "/api/visits/walk-in",
    access: GATE_ROLES,
    handler: async (req, res, next) => {
      const {
        fullName,
        phone,
        purposeOfVisit,
        personToMeet,
        validUntil, // 'YYYY-MM-DD'
        validTime,
      } = req.body || {};

      if (!fullName || !fullName.trim()) {
        return next(badRequest("Visitor full name is required."));
      }
      if (!purposeOfVisit || !purposeOfVisit.trim()) {
        return next(badRequest("Purpose of visit is required."));
      }
      if (!personToMeet || !personToMeet.trim()) {
        return next(badRequest("Person to meet is required."));
      }

      const now = new Date();
      const year = now.getFullYear();
      const seq = String(now.getTime()).slice(-5);
      const code = `VIS/${year}/${seq}`;

      const dateStr = validUntil || now.toISOString().slice(0, 10);
      const person = await insertPerson(
        db,
        {
          category: "visitor",
          fullName: fullName.trim(),
          phone: phone ? phone.trim() : null,
          purposeOfVisit: purposeOfVisit.trim(),
          personToMeet: personToMeet.trim(),
          status: "active",
        },
        req.user.id,
      );

      const credential = await insertCredential(
        db,
        {
          cardNumber: code,
          personId: person.id,
          kind: "gate_pass",
          validFrom: now.toISOString().slice(0, 10),
          validTo: dateStr,
          status: "active",
        },
        req.user.id,
      );

      const visit = await insertVisit(
        db,
        {
          personId: person.id,
          hostName: personToMeet.trim(),
          purposeOfVisit: purposeOfVisit.trim(),
          expectedArrival: now.toISOString(),
          expectedDeparture: `${dateStr}T${validTime || "18:00"}:00Z`,
          approvalStatus: "approved",
          badgeId: credential.id,
        },
        req.user.id,
      );

      // Log direct walk-in gate entry
      const logId = await insertGateEvent(db, {
        credentialId: code,
        personId: person.id,
        gateId: "Plant 3 - Main Gate",
        direction: "entry",
        result: "approved",
        reasonCode: "visitor_walk_in",
        reasonText: `Visitor walk-in: Meeting ${personToMeet}`,
        scannedCode: code,
        occurredAt: now.toISOString(),
        operatorUserId: req.user.id,
      });

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "visitor.walk_in",
        entityType: "visit",
        entityId: visit.id,
        newValue: { visitorName: fullName, code, host: personToMeet },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.status(201).json({
        success: true,
        code,
        personId: person.id,
        visitId: visit.id,
        logId,
      });
    },
  });
}
