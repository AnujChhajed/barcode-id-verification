/**
 * Client for the local ABB Plant 3 backend.
 *
 * The whole app talks to the API through this module so that the request
 * conventions live in exactly one place:
 *   - the session travels in an `HttpOnly` cookie, so every call is made with
 *     `credentials: "include"` and the frontend never sees a token;
 *   - a failure is always turned into an `ApiError` carrying the backend's
 *     stable `code`, so screens can branch on `code` instead of parsing prose;
 *   - the backend is authoritative. Nothing here re-implements a business rule
 *     (validity, duplicate scans, authorization) — it only asks.
 */

export type Role = "administrator" | "security_staff";
export type PersonCategory = "worker" | "intern" | "visitor";
export type PersonStatus = "active" | "suspended" | "terminated";
export type CredentialKind = "id_card" | "gate_pass";
export type CredentialStatus = "active" | "suspended" | "terminated";
export type GateDirection = "entry" | "exit";
export type GateResult = "approved" | "rejected" | "unable_to_verify";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  email: string | null;
}

/** The full profile. Administrator only — it carries personal data. */
export interface PersonView {
  id: string;
  category: PersonCategory;
  fullName: string;
  phone: string | null;
  hasPhoto: boolean;
  plantId: string;
  status: PersonStatus;
  workerRef: string | null;
  contractorCompany: string | null;
  institutionName: string | null;
  purposeOfVisit: string | null;
  personToMeet: string | null;
  employeeEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The gate-staff view: identification only, no contact details. */
export interface VerificationView {
  id: string;
  category: PersonCategory;
  fullName: string;
  status: PersonStatus;
  hasPhoto: boolean;
  workerRef: string | null;
  contractorCompany: string | null;
  institutionName: string | null;
}

export interface CredentialView {
  id: string;
  personId: string;
  kind: CredentialKind;
  validFrom: string;
  validTo: string;
  status: CredentialStatus;
  issuedAt: string;
  updatedAt: string;
  /** Present only when the backend was asked to compute it. */
  isValid?: boolean;
  reasonCode?: string;
  reasonText?: string;
}

export interface GateEventView {
  id: string;
  credentialId: string | null;
  personId: string | null;
  /** Null when the code was not recognised, so no holder could be named. */
  personName: string | null;
  personCategory: PersonCategory | null;
  gateId: string;
  direction: GateDirection;
  result: GateResult;
  reasonCode: string | null;
  reasonText: string | null;
  occurredAt: string;
  operatorUserId: string | null;
  recordedOffline: boolean;
  syncedAt: string | null;
  createdAt: string;
}

export interface GateVerification {
  result: GateResult;
  reasonCode: string;
  reasonText: string;
  direction: GateDirection;
  occurredAt: string;
  /** True when the scan matched one already recorded inside the duplicate window. */
  duplicate: boolean;
  /** True when this scan is on record — including rejections. */
  recorded: boolean;
  eventId: string | null;
  person: VerificationView | null;
  credential: CredentialView | null;
}

export interface InsideEntry {
  person: VerificationView;
  credentialId: string;
  gateId: string;
  since: string;
  missingExit: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Array<{ path: string; message: string }> };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ path: string; message: string }>;

  constructor(status: number, code: string, message: string, details?: ApiErrorBody["error"]["details"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The session is missing or has expired — the caller must sign in again. */
  get isUnauthenticated() {
    return this.status === 401;
  }

  /** The caller is signed in but not allowed to do this. */
  get isForbidden() {
    return this.status === 403;
  }
}

/**
 * Where the API lives. In development the frontend and API are on different
 * origins; in production the frontend is served by the same origin as the API,
 * so a relative URL is correct and no CORS is involved.
 */
function resolveBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured.replace(/\/+$/, "");
  }
  return import.meta.env.DEV ? "http://localhost:4000" : "";
}

export const API_BASE_URL = resolveBaseUrl();

type QueryValue = string | number | boolean | undefined | null;

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${url}?${suffix}` : url;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const code = body?.error?.code ?? "UNKNOWN";
  const message = body?.error?.message ?? `Request failed with status ${response.status}.`;
  return new ApiError(response.status, code, message, body?.error?.details);
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // A network failure is never a verdict — surface it as such.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "Cannot reach the verification server.");
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
  async me() {
    const { user } = await apiFetch<{ user: SessionUser }>("/api/auth/me");
    return user;
  },
  async login(username: string, password: string) {
    const { user } = await apiFetch<{ user: SessionUser; expiresAt: string }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
    return user;
  },
  logout() {
    return apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" });
  },
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonInput {
  category: PersonCategory;
  fullName: string;
  phone?: string;
  workerRef?: string;
  contractorCompany?: string;
  institutionName?: string;
  purposeOfVisit?: string;
  personToMeet?: string;
  employeeEmail?: string;
}

export interface ListPeopleFilters {
  category?: PersonCategory;
  status?: PersonStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export const peopleApi = {
  /** Gate-staff lookup: identification only. */
  async search(q: string, limit = 20) {
    const { people } = await apiFetch<{ people: VerificationView[] }>("/api/people/search", {
      query: { q, limit },
    });
    return people;
  },
  list(filters: ListPeopleFilters = {}) {
    return apiFetch<{ people: PersonView[]; total: number; limit: number; offset: number }>(
      "/api/people",
      { query: { ...filters } },
    );
  },
  async get(id: string) {
    return apiFetch<{ person: PersonView; credentials: CredentialView[] }>(
      `/api/people/${encodeURIComponent(id)}`,
    );
  },
  async create(input: PersonInput) {
    const { person } = await apiFetch<{ person: PersonView }>("/api/people", {
      method: "POST",
      body: input,
    });
    return person;
  },
  async update(id: string, patch: Partial<PersonInput>) {
    const { person } = await apiFetch<{ person: PersonView }>(
      `/api/people/${encodeURIComponent(id)}`,
      { method: "PATCH", body: patch },
    );
    return person;
  },
  async setStatus(id: string, status: PersonStatus, reason: string) {
    const { person } = await apiFetch<{ person: PersonView }>(
      `/api/people/${encodeURIComponent(id)}/status`,
      { method: "POST", body: { status, reason } },
    );
    return person;
  },
};

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const credentialsApi = {
  async issue(input: { personId: string; kind: CredentialKind; validFrom: string; validTo: string }) {
    const { credential } = await apiFetch<{ credential: CredentialView }>("/api/credentials", {
      method: "POST",
      body: input,
    });
    return credential;
  },
  async setValidity(id: string, input: { validFrom: string; validTo: string; reason: string }) {
    const { credential } = await apiFetch<{ credential: CredentialView }>(
      `/api/credentials/${encodeURIComponent(id)}/validity`,
      { method: "POST", body: input },
    );
    return credential;
  },
  async setStatus(id: string, status: CredentialStatus, reason: string) {
    const { credential } = await apiFetch<{ credential: CredentialView }>(
      `/api/credentials/${encodeURIComponent(id)}/status`,
      { method: "POST", body: { status, reason } },
    );
    return credential;
  },
};

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export interface GateEventFilters {
  personId?: string;
  result?: GateResult;
  direction?: GateDirection;
  /** Inclusive ISO instants, used by the audit log's date range. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const gateApi = {
  verify(code: string, direction: GateDirection) {
    return apiFetch<GateVerification>("/api/gate/verify", {
      method: "POST",
      body: { code, direction },
    });
  },
  events(filters: GateEventFilters = {}) {
    return apiFetch<{ events: GateEventView[]; total: number; limit: number; offset: number }>(
      "/api/gate/events",
      { query: { ...filters } },
    );
  },
  inside() {
    return apiFetch<{ asOf: string; today: string; inside: InsideEntry[] }>("/api/inside");
  },
  syncQueue(items: unknown[]) {
    return apiFetch<{ synced: number; items: unknown[] }>("/api/gate/sync", {
      method: "POST",
      body: { items },
    });
  },
  override(input: { code: string; personId?: string; reason: string; direction?: string; gateId?: string }) {
    return apiFetch<{ success: true; eventId: string }>("/api/gate/override", {
      method: "POST",
      body: input,
    });
  },
  incident(input: { note: string; gateId?: string; direction?: string }) {
    return apiFetch<{ success: true; eventId: string }>("/api/gate/incident", {
      method: "POST",
      body: input,
    });
  },
};

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

export interface WalkInVisitorInput {
  fullName: string;
  phone?: string;
  purposeOfVisit: string;
  personToMeet: string;
  validUntil?: string;
  validTime?: string;
}

export const visitsApi = {
  walkIn(input: WalkInVisitorInput) {
    return apiFetch<{ success: true; code: string; personId: string; visitId: string; logId: string }>(
      "/api/visits/walk-in",
      {
        method: "POST",
        body: input,
      },
    );
  },
  list(params?: { status?: string; limit?: number; offset?: number }) {
    return apiFetch<{ visits: unknown[]; total: number }>("/api/visits", { query: params });
  },
};

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export const photosApi = {
  urlFor(personId: string) {
    return `${API_BASE_URL}/api/photos/${encodeURIComponent(personId)}`;
  },
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserView {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export const usersApi = {
  list() {
    return apiFetch<{ users: UserView[] }>("/api/users");
  },
  async create(input: { username: string; fullName: string; role: Role; password: string; email?: string }) {
    const { user } = await apiFetch<{ user: UserView }>("/api/users", { method: "POST", body: input });
    return user;
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingView {
  key: string;
  value: string;
  updatedAt: string;
}

export const settingsApi = {
  list() {
    return apiFetch<{ settings: SettingView[] }>("/api/settings");
  },
  async update(key: string, value: string) {
    const { setting } = await apiFetch<{ setting: SettingView }>("/api/settings", {
      method: "PUT",
      body: { key, value },
    });
    return setting;
  },
};

