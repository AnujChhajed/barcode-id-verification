import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export interface IdCardStudent {
  full_name: string;
  admission_number: string;
  barcode: string;
  programme: string;
  category?: "worker" | "intern" | "visitor" | string;
  company_name?: string | null;
  institution?: string | null;
  valid_from?: string | null;
  nta_level?: string;
  year_of_study?: number;
  photoDataUrl?: string | null;
  is_visitor?: boolean;
  expires_at?: string | null;
}

function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    width: 2,
    height: 50,
    displayValue: false,
    margin: 0,
  });
  return canvas.toDataURL("image/png");
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "ID";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Standard CR80 Portrait Badge Dimensions (mm) ─────────────────────────
const CARD_W = 54;    // CR80 width in portrait
const CARD_H = 85.6;  // CR80 height in portrait

/** Draw a single ABB Plant 3 Portrait ID Card at position (ox, oy). */
function drawCard(doc: jsPDF, s: IdCardStudent, ox: number, oy: number, siteTitle: string) {
  // 1. ABB Header Bar (Corporate Red #FF000F)
  doc.setFillColor(255, 0, 15);
  doc.rect(ox, oy, CARD_W, 13, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("ABB", ox + CARD_W / 2, oy + 6.5, { align: "center" });

  doc.setFontSize(5.5);
  doc.text("PLANT 3 SECURITY CREDENTIAL", ox + CARD_W / 2, oy + 10.5, { align: "center" });

  // 2. Classification Banner
  let bannerBg = [30, 41, 59]; // Slate (Worker default)
  let bannerText = "CONTRACT WORKER";

  const cat = (s.category || (s.is_visitor ? "visitor" : "worker")).toLowerCase();
  if (cat.includes("intern") || cat.includes("student")) {
    bannerBg = [30, 58, 138]; // Deep Blue
    bannerText = "INTERNSHIP STUDENT";
  } else if (cat.includes("visitor") || s.is_visitor) {
    bannerBg = [180, 83, 9];  // Amber
    bannerText = "TEMPORARY VISITOR";
  }

  doc.setFillColor(bannerBg[0], bannerBg[1], bannerBg[2]);
  doc.rect(ox, oy + 13, CARD_W, 5, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.text(bannerText, ox + CARD_W / 2, oy + 16.5, { align: "center" });

  // 3. Photograph or Initials Avatar Fallback
  const pw = 24;
  const ph = 28;
  const px = ox + (CARD_W - pw) / 2;
  const py = oy + 20;

  if (s.photoDataUrl) {
    try {
      doc.addImage(s.photoDataUrl, "JPEG", px, py, pw, ph);
      doc.setDrawColor(203, 213, 225);
      doc.rect(px, py, pw, ph);
    } catch {
      // Fallback if image fails to render
      renderInitialsAvatar(doc, s.full_name, px, py, pw, ph);
    }
  } else {
    renderInitialsAvatar(doc, s.full_name, px, py, pw, ph);
  }

  // 4. Personnel Details
  // Full Name
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(s.full_name.slice(0, 24), ox + CARD_W / 2, oy + 51.5, { align: "center" });

  // Organization / Contractor / College
  const org = s.company_name || s.institution || s.programme || "Plant 3 Operations";
  doc.setTextColor(71, 85, 105);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(String(org).slice(0, 28), ox + CARD_W / 2, oy + 55.5, { align: "center" });

  // ID Number & Role
  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  const role = s.programme && s.programme !== org ? ` · ${s.programme.slice(0, 14)}` : "";
  doc.text(`ID: ${s.admission_number}${role}`, ox + CARD_W / 2, oy + 59.2, { align: "center" });

  // Validity Period
  const vStart = s.valid_from ? s.valid_from.slice(0, 10) : "Authorized";
  const vEnd = s.expires_at ? s.expires_at.slice(0, 10) : "Permanent";
  doc.setFontSize(5.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Valid: ${vStart} → ${vEnd}`, ox + CARD_W / 2, oy + 62.5, { align: "center" });

  // 5. Code 128 Barcode Strip
  try {
    const bc = barcodeDataUrl(s.barcode);
    doc.addImage(bc, "PNG", ox + 3, oy + 65, CARD_W - 6, 10.5);
  } catch {}

  // Barcode string
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(30, 41, 59);
  doc.text(s.barcode, ox + CARD_W / 2, oy + 78.5, { align: "center" });

  // 6. Bottom Brand Accent
  doc.setFillColor(255, 0, 15);
  doc.rect(ox, oy + CARD_H - 2.5, CARD_W, 2.5, "F");

  // 7. Outer Badge Border
  doc.setDrawColor(226, 232, 240);
  doc.rect(ox, oy, CARD_W, CARD_H);
}

function renderInitialsAvatar(doc: jsPDF, name: string, px: number, py: number, pw: number, ph: number) {
  doc.setFillColor(241, 245, 249);
  doc.rect(px, py, pw, ph, "F");
  doc.setDrawColor(203, 213, 225);
  doc.rect(px, py, pw, ph);

  doc.setTextColor(100, 116, 139);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(getInitials(name), px + pw / 2, py + 16, { align: "center" });

  doc.setFontSize(5);
  doc.setFont("helvetica", "normal");
  doc.text("ABB PLANT 3", px + pw / 2, py + 22, { align: "center" });
}

/** Single card: Centered on A4 with cut guide for clean printing and badge fitting. */
export function generateIdCardPDF(student: IdCardStudent, siteTitle = "ABB Plant 3") {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const ox  = (210 - CARD_W) / 2;   // Centered horizontally on A4
  const oy  = (297 - CARD_H) / 2;   // Centered vertically on A4

  // Dashed cut guide
  doc.setDrawColor(180, 190, 200);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(ox - 2, oy - 2, CARD_W + 4, CARD_H + 4);
  doc.setLineDashPattern([], 0);

  drawCard(doc, student, ox, oy, siteTitle);
  return doc;
}

export function downloadIdCard(student: IdCardStudent, siteTitle?: string) {
  const doc = generateIdCardPDF(student, siteTitle);
  doc.save(`abb-id-card-${student.admission_number}.pdf`);
}

/**
 * Bulk: 9 portrait cards per A4 page (3 columns × 3 rows) with dashed cut guides.
 * Optimizes standard A4 industrial printing.
 */
export function downloadBulkIdCards(students: IdCardStudent[], siteTitle = "ABB Plant 3") {
  const doc     = new jsPDF({ unit: "mm", format: "a4" });
  const gapX    = 8;
  const gapY    = 6;
  const marginX = (210 - CARD_W * 3 - gapX * 2) / 2;
  const marginY = (297 - CARD_H * 3 - gapY * 2) / 2;

  let i = 0;
  for (const s of students) {
    const idx = i % 9;
    if (i > 0 && idx === 0) doc.addPage();
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x   = marginX + col * (CARD_W + gapX);
    const y   = marginY + row * (CARD_H + gapY);

    // Dashed cut lines
    doc.setDrawColor(180, 190, 200);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x - 1, y - 1, CARD_W + 2, CARD_H + 2);
    doc.setLineDashPattern([], 0);

    drawCard(doc, s, x, y, siteTitle);
    i++;
  }
  doc.save(`abb-plant3-id-cards-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ── QR data URL helper ────────────────────────────────────────────────────
export async function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, { width: 300, margin: 2, color: { dark: "#0f172a", light: "#ffffff" } });
}

// ── Visitor pass (A6 portrait, ABB branded with Code 128 barcode) ───────────
export interface VisitorPassData {
  full_name: string;
  code: string;          // barcode / admission_number used at gate
  host: string;          // reason / host
  valid_until: string;   // ISO string or YYYY-MM-DD
  phone?: string | null;
}

export async function generateVisitorPassPDF(
  v: VisitorPassData,
  siteTitle = "ABB Plant 3"
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: [105, 148] }); // A6 portrait
  const W   = 105;

  const expiryDate = v.valid_until.length <= 10
    ? new Date(`${v.valid_until}T23:59:59`)
    : new Date(v.valid_until);
  const expired = expiryDate < new Date();

  const expiryLabel = expiryDate.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 1. ABB Corporate Red Header Bar
  doc.setFillColor(255, 0, 15);
  doc.rect(0, 0, W, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(siteTitle.toUpperCase(), W / 2, 8, { align: "center" });
  doc.setFontSize(13);
  doc.text("VISITOR SECURITY PASS", W / 2, 15, { align: "center" });

  // 2. Visitor Name
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(v.full_name.slice(0, 26), W / 2, 33, { align: "center" });

  // 3. Pass Code
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Pass Code: ${v.code}`, W / 2, 42, { align: "center" });

  // 4. Divider
  doc.setDrawColor(226, 232, 240);
  doc.line(10, 47, W - 10, 47);

  // 5. Host / Purpose
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(9);
  doc.text(`Host / Department: ${v.host || "Plant 3"}`, W / 2, 56, { align: "center" });

  // 6. Validity
  doc.setFontSize(10);
  if (expired) {
    doc.setTextColor(220, 38, 38);
    doc.setFont("helvetica", "bold");
    doc.text(`Valid until: ${expiryLabel}`, W / 2, 66, { align: "center" });
    doc.setFontSize(8);
    doc.text("(EXPIRED - ACCESS DENIED)", W / 2, 72, { align: "center" });
  } else {
    doc.setTextColor(22, 101, 52);
    doc.setFont("helvetica", "bold");
    doc.text(`Valid until: ${expiryLabel}`, W / 2, 66, { align: "center" });
  }

  // 7. Phone
  if (v.phone) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(`Contact: ${v.phone}`, W / 2, 78, { align: "center" });
  }

  // 8. Divider before barcode
  doc.setDrawColor(226, 232, 240);
  doc.line(10, 85, W - 10, 85);

  // 9. Code 128 Barcode Strip
  try {
    const bc = barcodeDataUrl(v.code);
    doc.addImage(bc, "PNG", 8, 89, W - 16, 20);
  } catch {}

  // Barcode text
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(v.code, W / 2, 114, { align: "center" });

  // 10. Footer instructions
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 134, W, 14, "F");
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text("Present barcode at Plant 3 Main Gate for optical scan", W / 2, 140, { align: "center" });
  doc.text("Authorized for Plant 3 only · Temporary credential", W / 2, 144, { align: "center" });

  return doc;
}

export async function printVisitorPass(v: VisitorPassData, siteTitle?: string) {
  const doc = await generateVisitorPassPDF(v, siteTitle);
  doc.autoPrint();
  const blob = doc.output("blob");
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, "_blank");
  if (win) win.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

export async function downloadVisitorPass(v: VisitorPassData, siteTitle?: string) {
  const doc = await generateVisitorPassPDF(v, siteTitle);
  doc.save(`visitor-pass-${v.code}.pdf`);
}
