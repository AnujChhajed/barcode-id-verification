import { z } from "zod";

/**
 * Request schemas, re-validated on the server on every write.
 *
 * Kept as plain zod object definitions (no Express or database imports) so the
 * frontend can import the same shapes instead of duplicating them.
 */

export const ROLES = ["administrator", "security_staff"];

const usernameField = z
  .string()
  .trim()
  .min(3, "Use at least 3 characters.")
  .max(64, "Use at most 64 characters.")
  .regex(/^[A-Za-z0-9._-]+$/, "Use letters, digits, dot, underscore or hyphen.");

const newPasswordField = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(256, "Use at most 256 characters.");

export const loginSchema = z
  .object({
    username: z.string().trim().min(1, "Username is required.").max(64),
    password: z.string().min(1, "Password is required.").max(256),
  })
  .strict();

export const createUserSchema = z
  .object({
    username: usernameField,
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    role: z.enum(ROLES),
    password: newPasswordField,
    email: z.string().trim().email("Enter a valid email address.").max(160).optional(),
  })
  .strict();

export const updateSettingSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9_.]+$/, "Setting keys use lowercase letters, digits, dot or underscore."),
    value: z.string().max(500, "Setting values are limited to 500 characters."),
  })
  .strict();

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const PERSON_CATEGORIES = ["worker", "intern", "visitor"];
export const PERSON_STATUSES = ["active", "suspended", "terminated"];

const PHONE_PATTERN = /^[0-9+() -]{6,20}$/;

const optionalText = (max) => z.string().trim().min(1).max(max).optional();

export const createPersonSchema = z
  .object({
    category: z.enum(PERSON_CATEGORIES),
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    phone: z.string().trim().regex(PHONE_PATTERN, "Enter a valid phone number.").optional(),
    // worker
    workerRef: optionalText(64),
    contractorCompany: optionalText(160),
    // intern
    institutionName: optionalText(160),
    // visitor
    purposeOfVisit: optionalText(240),
    personToMeet: optionalText(120),
    employeeEmail: z.string().trim().email("Enter a valid email address.").max(160).optional(),
  })
  .strict();

export const updatePersonSchema = createPersonSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to change.");

/**
 * The per-category required fields, exactly as the database CHECK constraints
 * express them. Called after merging a PATCH onto the stored record, because a
 * category change can invalidate a record that was previously complete.
 * Returns the API field names that are missing.
 */
export function missingCategoryFields(category, person) {
  const present = (value) => typeof value === "string" && value.trim().length > 0;
  const missing = [];
  if (category === "worker" && !present(person.workerRef)) missing.push("workerRef");
  if (category === "intern" && !present(person.institutionName)) missing.push("institutionName");
  if (category === "visitor") {
    if (!present(person.purposeOfVisit)) missing.push("purposeOfVisit");
    if (!present(person.personToMeet)) missing.push("personToMeet");
  }
  return missing;
}

export const personStatusSchema = z
  .object({
    status: z.enum(PERSON_STATUSES),
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const CREDENTIAL_KINDS = ["id_card", "gate_pass"];
export const CREDENTIAL_STATUSES = ["active", "suspended", "terminated"];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const dateKeyField = z
  .string()
  .regex(DATE_KEY_PATTERN, "Use the format YYYY-MM-DD.")
  .refine(isRealDateKey, "That is not a real calendar date.");

const credentialWindow = (value) => value.validTo >= value.validFrom;

export const createCredentialSchema = z
  .object({
    personId: z.string().trim().min(1, "Choose a person.").max(64),
    kind: z.enum(CREDENTIAL_KINDS),
    validFrom: dateKeyField,
    validTo: dateKeyField,
  })
  .strict()
  .refine(credentialWindow, { message: "The end date cannot be before the start date.", path: ["validTo"] });

export const credentialValiditySchema = z
  .object({
    validFrom: dateKeyField,
    validTo: dateKeyField,
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict()
  .refine(credentialWindow, { message: "The end date cannot be before the start date.", path: ["validTo"] });

export const credentialStatusSchema = z
  .object({
    status: z.enum(CREDENTIAL_STATUSES),
    reason: z.string().trim().min(3, "Provide a reason.").max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shared query and path parameters
// ---------------------------------------------------------------------------

/**
 * `req.query` values arrive as strings and can repeat. Collapse to a single
 * value and treat an empty string the same as "not supplied", so `?category=`
 * does not become a validation error.
 */
function singleValue(schema) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === "") return undefined;
    return raw;
  }, schema);
}

const queryText = (max) => singleValue(z.string().trim().min(1).max(max).optional());
const queryEnum = (values) => singleValue(z.enum(values).optional());
const queryInt = (min, max, fallback) =>
  singleValue(z.coerce.number().int().min(min).max(max).default(fallback));
/**
 * An inclusive instant, always with an offset. Timestamps are stored as
 * fixed-width ISO strings so they can be compared directly in SQL, which is why
 * an unparseable value is refused here rather than silently matching nothing.
 */
const queryDateTime = () => singleValue(z.string().trim().datetime({ offset: true }).optional());

export const searchPeopleQuerySchema = z
  .object({
    q: singleValue(z.string().trim().min(1, "Enter a search term.").max(80)),
    limit: queryInt(1, 50, 20),
  })
  .strict();

export const listPeopleQuerySchema = z
  .object({
    category: queryEnum(PERSON_CATEGORIES),
    status: queryEnum(PERSON_STATUSES),
    q: queryText(80),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(64) }).strict();

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export const GATE_DIRECTIONS = ["entry", "exit"];
export const GATE_RESULTS = ["approved", "rejected", "unable_to_verify"];

/**
 * A scan. `code` is the opaque barcode/QR payload, which is the credential id —
 * it never encodes personal data. The direction is stated by the operator or
 * the kiosk; it is never inferred here, because guessing it would invent a
 * business rule that has not been agreed.
 */
export const verifyGateSchema = z
  .object({
    code: z.string().trim().min(1, "Scan or enter a credential code.").max(128),
    direction: z.enum(GATE_DIRECTIONS),
  })
  .strict();

export const listGateEventsQuerySchema = z
  .object({
    personId: queryText(64),
    result: queryEnum(GATE_RESULTS),
    direction: queryEnum(GATE_DIRECTIONS),
    /** Inclusive bounds on `occurred_at`, for the audit-log date range. */
    from: queryDateTime(),
    to: queryDateTime(),
    limit: queryInt(1, 200, 50),
    offset: queryInt(0, 1_000_000, 0),
  })
  .strict();
