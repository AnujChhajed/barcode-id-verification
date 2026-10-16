import {
  findActiveCredentialOfKind,
  findCredentialById,
  insertCredential,
  setCredentialStatus,
  toCredentialView,
  updateCredentialValidity,
} from "../data/id-cards.js";
import { findPersonById } from "../data/persons.js";
import { siteToday } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { conflict, notFound } from "../lib/errors.js";
import {
  createCredentialSchema,
  credentialStatusSchema,
  credentialValiditySchema,
  idParamSchema,
} from "../validation/schemas.js";

const ADMINISTRATOR_ONLY = ["administrator"];

function currentView(credential, personStatus, today) {
  return toCredentialView(credential, { personStatus, today });
}

export function registerCredentialRoutes({ registrar, db }) {
  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials",
    access: ADMINISTRATOR_ONLY,
    body: createCredentialSchema,
    handler: async (req, res, next) => {
      const { personId, kind, validFrom, validTo } = req.body;

      const person = await findPersonById(db, personId);
      if (!person) return next(notFound("No such person."));
      if (person.status !== "active") {
        return next(conflict("A credential cannot be issued to a suspended or terminated person."));
      }

      const activeExisting = await findActiveCredentialOfKind(db, personId, kind);
      if (activeExisting) {
        return next(
          conflict(`This person already holds an active ${kind === "id_card" ? "ID card" : "gate pass"}.`),
        );
      }

      const inserted = await insertCredential(
        db,
        { personId, kind, validFrom, validTo },
        req.user.id,
      );

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "credential.issue",
        entityType: "credential",
        entityId: inserted.card_number || inserted.id,
        newValue: { personId, kind, validFrom, validTo },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      const today = await siteToday(db);
      res.status(201).json({
        credential: currentView(inserted, person.status, today),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials/:id/validity",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: credentialValiditySchema,
    handler: async (req, res, next) => {
      const credential = await findCredentialById(db, req.params.id);
      if (!credential) return next(notFound("No such credential."));
      if (credential.status === "terminated") {
        return next(conflict("A terminated credential cannot be renewed."));
      }

      const { validFrom, validTo, reason } = req.body;
      const updated = await updateCredentialValidity(
        db,
        credential.card_number || credential.id,
        { validFrom, validTo },
        req.user.id,
      );

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "credential.validity_change",
        entityType: "credential",
        entityId: credential.card_number || credential.id,
        oldValue: { validFrom: credential.valid_from, validTo: credential.valid_to },
        newValue: { validFrom, validTo },
        reason,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      const person = await findPersonById(db, credential.person_id);
      const today = await siteToday(db);
      res.json({
        credential: currentView(updated, person?.status, today),
      });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/credentials/:id/status",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: credentialStatusSchema,
    handler: async (req, res, next) => {
      const credential = await findCredentialById(db, req.params.id);
      if (!credential) return next(notFound("No such credential."));

      const { status, reason } = req.body;
      let updated = credential;

      if (credential.status !== status) {
        updated = await setCredentialStatus(
          db,
          credential.card_number || credential.id,
          status,
          req.user.id,
        );
        await writeAudit(db, {
          actorUserId: req.user.id,
          action: "credential.status_change",
          entityType: "credential",
          entityId: credential.card_number || credential.id,
          oldValue: { status: credential.status },
          newValue: { status },
          reason,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      }

      const person = await findPersonById(db, credential.person_id);
      const today = await siteToday(db);
      res.json({
        credential: currentView(updated, person?.status, today),
      });
    },
  });
}
