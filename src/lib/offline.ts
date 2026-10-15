import { openDB, type IDBPDatabase } from "idb";

export interface CachedStudent {
  id: string;
  full_name: string;
  admission_number: string;
  barcode: string;
  programme: string;
  nta_level: string;
  year_of_study: number;
  status: string;
  photo_url: string | null;
  expires_at: string | null;
  is_visitor: boolean;
  parent_email: string | null;
  parent_phone: string | null;
  suspension_reason: string | null;
  suspended_until: string | null;
  category?: string | null;
  company_name?: string | null;
  institution?: string | null;
  plant_id?: string | null;
  valid_from?: string | null;
}

export interface CachedWatchlistItem {
  id: string;
  full_name: string;
  id_number: string | null;
  barcode: string | null;
  reason: string;
  alert_level: string;
  description: string | null;
  is_active: boolean;
  expires_at: string | null;
  photo_url: string | null;
}

export interface QueuedScan {
  id?: number;
  sync_id: string;
  scanned_code: string;
  student_id: string | null;
  decision: "allowed" | "denied" | "unknown";
  reason: string | null;
  scanned_by: string | null;
  scanned_at: string;
  direction: "in" | "out" | null;
  gate_id: string | null;
  is_offline: boolean;
  operator_note?: string | null;
  sync_status?: "pending" | "synced" | "failed";
  sync_error?: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB("atc-gate", 2, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains("students")) {
          const s = db.createObjectStore("students", { keyPath: "id" });
          s.createIndex("barcode", "barcode", { unique: false });
          s.createIndex("admission_number", "admission_number", { unique: false });
        }
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("watchlist")) {
          const w = db.createObjectStore("watchlist", { keyPath: "id" });
          w.createIndex("barcode", "barcode", { unique: false });
          w.createIndex("id_number", "id_number", { unique: false });
          w.createIndex("is_active", "is_active", { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

// ── Personnel Cache ──────────────────────────────────────────────────────────

export async function cacheStudents(students: CachedStudent[]) {
  const db = await getDB();
  const tx = db.transaction("students", "readwrite");
  await tx.objectStore("students").clear();
  for (const s of students) await tx.objectStore("students").put(s);
  await tx.done;
}

export async function findCachedStudent(code: string): Promise<CachedStudent | null> {
  const db = await getDB();
  const tx = db.transaction("students", "readonly");
  const store = tx.objectStore("students");
  const clean = code.trim().toLowerCase();

  const byBarcode = await store.index("barcode").get(code);
  if (byBarcode) return byBarcode as CachedStudent;

  const byAdm = await store.index("admission_number").get(code);
  if (byAdm) return byAdm as CachedStudent;

  // Fallback scan for case-insensitive match
  const all = (await store.getAll()) as CachedStudent[];
  return (
    all.find(
      (s) =>
        (s.barcode && s.barcode.toLowerCase() === clean) ||
        (s.admission_number && s.admission_number.toLowerCase() === clean)
    ) ?? null
  );
}

export async function cachedStudentCount() {
  const db = await getDB();
  return db.count("students");
}

// ── Active Watchlist Cache ───────────────────────────────────────────────────

export async function cacheWatchlist(items: CachedWatchlistItem[]) {
  const db = await getDB();
  const tx = db.transaction("watchlist", "readwrite");
  await tx.objectStore("watchlist").clear();
  for (const item of items) {
    await tx.objectStore("watchlist").put(item);
  }
  await tx.done;
}

export async function findCachedWatchlistHit(code: string): Promise<CachedWatchlistItem | null> {
  const db = await getDB();
  const tx = db.transaction("watchlist", "readonly");
  const store = tx.objectStore("watchlist");
  const clean = code.trim().toLowerCase();

  // Try direct index lookups
  const byBarcode = (await store.index("barcode").get(code)) as CachedWatchlistItem | undefined;
  if (byBarcode && byBarcode.is_active) {
    if (!byBarcode.expires_at || new Date(byBarcode.expires_at) >= new Date()) {
      return byBarcode;
    }
  }

  const byId = (await store.index("id_number").get(code)) as CachedWatchlistItem | undefined;
  if (byId && byId.is_active) {
    if (!byId.expires_at || new Date(byId.expires_at) >= new Date()) {
      return byId;
    }
  }

  // Fallback case-insensitive scan across active records
  const all = (await store.getAll()) as CachedWatchlistItem[];
  const match = all.find(
    (w) =>
      w.is_active &&
      (!w.expires_at || new Date(w.expires_at) >= new Date()) &&
      ((w.barcode && w.barcode.trim().toLowerCase() === clean) ||
       (w.id_number && w.id_number.trim().toLowerCase() === clean))
  );

  return match ?? null;
}

export async function cachedWatchlistCount(): Promise<number> {
  const db = await getDB();
  return db.count("watchlist");
}

// ── Offline Scan Queue ───────────────────────────────────────────────────────

export async function enqueueScan(scan: QueuedScan) {
  const db = await getDB();
  await db.add("queue", scan);
}

export async function pendingQueue(): Promise<QueuedScan[]> {
  const db = await getDB();
  return (await db.getAll("queue")) as QueuedScan[];
}

export async function clearQueueItem(id: number) {
  const db = await getDB();
  await db.delete("queue", id);
}

export async function markQueueItemFailed(id: number, errorMsg: string) {
  const db = await getDB();
  const item = (await db.get("queue", id)) as QueuedScan | undefined;
  if (item) {
    item.sync_status = "failed";
    item.sync_error = errorMsg;
    await db.put("queue", item);
  }
}
