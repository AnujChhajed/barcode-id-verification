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
}

export interface QueuedScan {
  id?: number;
  scanned_code: string;
  student_id: string | null;
  decision: "allowed" | "denied" | "unknown";
  reason: string | null;
  scanned_by: string | null;
  scanned_at: string;
  direction: "in" | "out" | null;
  gate_id: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB("atc-gate", 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("students")) {
          const s = db.createObjectStore("students", { keyPath: "id" });
          s.createIndex("barcode", "barcode", { unique: false });
          s.createIndex("admission_number", "admission_number", { unique: false });
        }
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

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
  const byBarcode = await store.index("barcode").get(code);
  if (byBarcode) return byBarcode as CachedStudent;
  const byAdm = await store.index("admission_number").get(code);
  return (byAdm as CachedStudent) ?? null;
}

export async function cachedStudentCount() {
  const db = await getDB();
  return db.count("students");
}

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
