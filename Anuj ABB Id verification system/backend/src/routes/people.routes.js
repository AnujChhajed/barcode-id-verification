import {
  countPeople,
  findLikelyDuplicate,
  findPersonById,
  insertPerson,
  listPeople,
  searchPeople,
  setPersonStatus,
  toPersonView,
  toVerificationView,
  updatePerson,
} from "../data/persons.js";
import { listCredentialsForPerson, toCredentialView } from "../data/id-cards.js";
import { siteToday } from "../data/settings.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  createPersonSchema,
  idParamSchema,
  listPeopleQuerySchema,
  missingCategoryFields,
  personStatusSchema,
  searchPeopleQuerySchema,
  updatePersonSchema,
} from "../validation/schemas.js";

const ADMINISTRATOR_ONLY = ["administrator"];
const GATE_ROLES = ["administrator", "security_staff"];

function isUniqueViolation(error) {
  return error?.code === "23505" || String(error?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

function missingDetails(missing) {
  return badRequest(
    "Required details are missing for this category.",
    missing.map((field) => ({ path: field, message: "Required." })),
  );
}

export function registerPeopleRoutes({ registrar, db }) {
  // Gate search: identification only, for a scan or a manual lookup.
  registrar.defineRoute({
    method: "GET",
    path: "/api/people/search",
    access: GATE_ROLES,
    query: searchPeopleQuerySchema,
    handler: async (req, res) => {
      const { q, limit } = req.validatedQuery;
      const people = await searchPeople(db, q, limit);
      res.json({ people });
    },
  });

  // Full register: administrator only.
  registrar.defineRoute({
    method: "GET",
    path: "/api/people",
    access: ADMINISTRATOR_ONLY,
    query: listPeopleQuerySchema,
    handler: async (req, res) => {
      const filters = req.validatedQuery;
      const result = await listPeople(db, filters);
      res.json(result);
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/people",
    access: ADMINISTRATOR_ONLY,
    body: createPersonSchema,
    handler: async (req, res, next) => {
      const input = req.body;

      const missing = missingCategoryFields(input.category, input);
      if (missing.length) return next(missingDetails(missing));

      const duplicate = await findLikelyDuplicate(db, input);
      if (duplicate) {
        return next(conflict("A person with the same name, category and phone already exists."));
      }

      let createdPerson;
      try {
        createdPerson = await insertPerson(db, input, req.user.id);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return next(conflict("That worker reference is already registered."));
        }
        throw error;
      }

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "person.create",
        entityType: "person",
        entityId: createdPerson.id,
        newValue: { category: input.category, fullName: input.fullName },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.status(201).json({ person: createdPerson });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/people/:id",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: async (req, res, next) => {
      const person = await findPersonById(db, req.params.id);
      if (!person) return next(notFound("No such person."));

      const today = await siteToday(db);
      const rawCredentials = await listCredentialsForPerson(db, person.id);
      const credentials = rawCredentials.map((row) =>
        toCredentialView(row, { personStatus: person.status, today }),
      );

      res.json({ person: toPersonView(person), credentials });
    },
  });

  registrar.defineRoute({
    method: "PATCH",
    path: "/api/people/:id",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: updatePersonSchema,
    handler: async (req, res, next) => {
      const stored = await findPersonById(db, req.params.id);
      if (!stored) return next(notFound("No such person."));

      const merged = { ...toPersonView(stored), ...req.body };
      const missing = missingCategoryFields(merged.category, merged);
      if (missing.length) return next(missingDetails(missing));

      const updated = await updatePerson(db, stored.id, req.body);

      await writeAudit(db, {
        actorUserId: req.user.id,
        action: "person.update",
        entityType: "person",
        entityId: stored.id,
        oldValue: toPersonView(stored),
        newValue: req.body,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.json({ person: updated });
    },
  });

  registrar.defineRoute({
    method: "POST",
    path: "/api/people/:id/status",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    body: personStatusSchema,
    handler: async (req, res, next) => {
      const stored = await findPersonById(db, req.params.id);
      if (!stored) return next(notFound("No such person."));

      const { status, reason } = req.body;
      let updated = toPersonView(stored);

      if (stored.status !== status) {
        updated = await setPersonStatus(db, stored.id, status);
        await writeAudit(db, {
          actorUserId: req.user.id,
          action: "person.status_change",
          entityType: "person",
          entityId: stored.id,
          oldValue: { status: stored.status },
          newValue: { status },
          reason,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
      }

      res.json({ person: updated });
    },
  });

  registrar.defineRoute({
    method: "GET",
    path: "/api/people/:id/credentials",
    access: ADMINISTRATOR_ONLY,
    params: idParamSchema,
    handler: async (req, res, next) => {
      const person = await findPersonById(db, req.params.id);
      if (!person) return next(notFound("No such person."));

      const today = await siteToday(db);
      const rawCredentials = await listCredentialsForPerson(db, person.id);
      res.json({
        credentials: rawCredentials.map((row) =>
          toCredentialView(row, { personStatus: person.status, today }),
        ),
      });
    },
  });
}
