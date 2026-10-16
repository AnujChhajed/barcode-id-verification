import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export interface IdCardStudent {
  full_name: string;
  admission_number: string;
  barcode: string;
  programme: string;
  nta_level: string;
  year_of_study: number;
  photoDataUrl?: string | null;
  is_visitor?: boolean;
  expires_at?: string | null;
}

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format: "CODE128", width: 2, height: 50, displayValue: false, margin: 0 });
  return canvas.toDataURL("image/png");
}

const CARD_W = 85.6;
const CARD_H = 54;

// Draw a single ID card at position (ox, oy) inside any jsPDF document.
function drawCard(doc: jsPDF, s: IdCardStudent, ox: number, oy: number, collegeName: string) {
  // Header bar
  doc.setFillColor(20, 80, 50);
  doc.rect(ox, oy, CARD_W, 9, "F");
  doc.setTextColor(255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(collegeName.toUpperCase(), ox + CARD_W / 2, oy + 6, { align: "center" });

  // Photo or placeholder
  if (s.photoDataUrl) {
    try { doc.addImage(s.photoDataUrl, "JPEG", ox + 3, oy + 12, 22, 28); } catch {}
  } else {
    doc.setDrawColor(180);
    doc.rect(ox + 3, oy + 12, 22, 28);
  }

  // Text fields
  doc.setTextColor(20);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(s.full_name.slice(0, 28), ox + 27, oy + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Adm: ${s.admission_number}`, ox + 27, oy + 21);
  doc.text(`${s.programme}`.slice(0, 32), ox + 27, oy + 25);
  doc.text(`NTA ${s.nta_level} · Year ${s.year_of_study}`, ox + 27, oy + 29);
  if (s.is_visitor) {
    doc.setTextColor(200, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text("VISITOR PASS", ox + 27, oy + 33);
    if (s.expires_at) {
      doc.setFont("helvetica", "normal");
      doc.text(`Expires ${s.expires_at.slice(0, 16)}`, ox + 27, oy + 36);
    }
    doc.setTextColor(20);
  }

  // Barcode strip
  try {
    const bc = barcodeDataUrl(s.barcode);
    doc.addImage(bc, "PNG", ox + 3, oy + 42, CARD_W - 6, 9);
  } catch {}
}

// Single card: centred on A4 with a dashed cut guide so it prints and cuts cleanly.
export function generateIdCardPDF(student: IdCardStudent, collegeName = "Arusha Technical College") {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ox  = (210 - CARD_W) / 2;  // centred horizontally on A4
  const oy  = (297 - CARD_H) / 2;  // centred vertically on A4

  // Dashed cut guide
  doc.setDrawColor(160);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(ox - 3, oy - 3, CARD_W + 6, CARD_H + 6);
  doc.setLineDashPattern([], 0);

  drawCard(doc, student, ox, oy, collegeName);
  return doc;
}

export function downloadIdCard(student: IdCardStudent, collegeName?: string) {
  const doc = generateIdCardPDF(student, collegeName);
  doc.save(`id-card-${student.admission_number}.pdf`);
}

// Bulk: 8 cards per A4 page (2 cols × 4 rows) with dashed cut guides
export function downloadBulkIdCards(students: IdCardStudent[], collegeName = "Arusha Technical College") {
  const doc     = new jsPDF({ unit: "mm", format: "a4" });
  const gapX    = 5;
  const gapY    = 5;
  const marginX = (210 - CARD_W * 2 - gapX) / 2;
  const marginY = (297 - CARD_H * 4 - gapY * 3) / 2;
  let i = 0;
  for (const s of students) {
    const idx = i % 8;
    if (i > 0 && idx === 0) doc.addPage();
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x   = marginX + col * (CARD_W + gapX);
    const y   = marginY + row * (CARD_H + gapY);
    doc.setDrawColor(160);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
    doc.setLineDashPattern([], 0);
    drawCard(doc, s, x, y, collegeName);
    i++;
  }
  doc.save(`id-cards-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── QR data URL helper ────────────────────────────────────────────────────
export async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { width: 300, margin: 2, color: { dark: "#143250", light: "#ffffff" } });
}

// ── Visitor pass (A6 portrait, QR-code-first design) ─────────────────────
export interface VisitorPassData {
  full_name: string;
  code: string;          // barcode / admission_number used at gate
  host: string;          // reason / host
  valid_until: string;   // YYYY-MM-DD
  phone?: string | null;
}

export async function generateVisitorPassPDF(
  v: VisitorPassData,
  collegeName = "Arusha Technical College"
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: [105, 148] }); // A6 portrait
  const W   = 105;

  // Correct expiry check — handles both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm"
  const expiryDate = v.valid_until.length <= 10
    ? new Date(`${v.valid_until}T23:59:59`)
    : new Date(v.valid_until);
  const expired = expiryDate < new Date();

  // Formatted expiry label
  const expiryLabel = expiryDate.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ── Header bar ───────────────────────────────────────────────────────────
  doc.setFillColor(20, 80, 50);
  doc.rect(0, 0, W, 18, "F");
  doc.setTextColor(255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(collegeName.toUpperCase(), W / 2, 8, { align: "center" });
  doc.setFontSize(13);
  doc.text("VISITOR PASS", W / 2, 15, { align: "center" });

  // ── Visitor name ─────────────────────────────────────────────────────────
  doc.setTextColor(20, 80, 50);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(v.full_name.slice(0, 26), W / 2, 34, { align: "center" });

  // ── Code (monospace style) ───────────────────────────────────────────────
  doc.setTextColor(60);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Code: ${v.code}`, W / 2, 43, { align: "center" });

  // ── Divider ──────────────────────────────────────────────────────────────
  doc.setDrawColor(210);
  doc.line(8, 48, W - 8, 48);

  // ── Host / reason ────────────────────────────────────────────────────────
  doc.setTextColor(80);
  doc.setFontSize(9);
  doc.text(`Host / Reason: ${v.host || "—"}`, W / 2, 58, { align: "center" });

  // ── Valid until ──────────────────────────────────────────────────────────
  doc.setFontSize(10);
  if (expired) {
    doc.setTextColor(200, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text(`Valid until: ${expiryLabel}`, W / 2, 68, { align: "center" });
    doc.setFontSize(8);
    doc.text("(EXPIRED)", W / 2, 74, { align: "center" });
  } else {
    doc.setTextColor(20, 80, 50);
    doc.setFont("helvetica", "bold");
    doc.text(`Valid until: ${expiryLabel}`, W / 2, 68, { align: "center" });
  }

  // ── Phone ────────────────────────────────────────────────────────────────
  if (v.phone) {
    doc.setTextColor(100);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(`Phone: ${v.phone}`, W / 2, 80, { align: "center" });
  }

  // ── Divider before barcode ───────────────────────────────────────────────
  doc.setDrawColor(210);
  doc.line(8, 88, W - 8, 88);

  // ── CODE128 barcode (sole scannable element — no QR code) ────────────────
  try {
    const bc = barcodeDataUrl(v.code);
    doc.addImage(bc, "PNG", 5, 92, W - 10, 18);
  } catch {}

  // ── Barcode value text ───────────────────────────────────────────────────
  doc.setTextColor(120);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(v.code, W / 2, 114, { align: "center" });

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.setFillColor(240, 245, 240);
  doc.rect(0, 136, W, 12, "F");
  doc.setTextColor(120);
  doc.setFontSize(7);
  doc.text("Present this pass at the main gate · One person only", W / 2, 143, { align: "center" });

  return doc;
}

/** Open the visitor pass PDF in a new tab with the print dialog ready. */
export async function printVisitorPass(v: VisitorPassData, collegeName?: string) {
  const doc = await generateVisitorPassPDF(v, collegeName);
  doc.autoPrint();
  const blob = doc.output("blob");
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank");
  // Revoke the object URL after the window has loaded to free memory
  if (win) win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

export async function downloadVisitorPass(v: VisitorPassData, collegeName?: string) {
  const doc = await generateVisitorPassPDF(v, collegeName);
  doc.save(`visitor-pass-${v.code}.pdf`);
}

