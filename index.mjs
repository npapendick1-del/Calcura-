import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());

// statische Dateien aus /public ausliefern (z.B. app.html und generierte PDFs)
app.use(express.static(path.join(__dirname, "public")));

// ---- Angebotsschema (für Validierung)
function offerschemaParse(input) {
  if (!input || !Array.isArray(input.items)) {
    throw new Error("Ungültiges Eingabeformat: items[] fehlt");
  }
  return input;
}

// ---- Angebot generieren
function generateOffer(input) {
  let subtotal = 0;
  input.items.forEach((it) => {
    subtotal += Number(it.qty || 0) * Number(it.unitPrice || 0);
  });

  const margin = subtotal * 0.1;
  const totalBeforeTax = subtotal + margin;
  const tax = totalBeforeTax * 0.19;
  const total = totalBeforeTax + tax;

  return {
    items: input.items,
    subtotal,
    margin,
    totalBeforeTax,
    tax,
    total,
  };
}

// ---- PDF Export (schönes Layout)
function exportOfferToPDF(offer) {
  const outDir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `angebot-${Date.now()}.pdf`;
  const filePath = path.join(outDir, filename);

  const companyName = offer?.company?.name || "Ihr Handwerksbetrieb";
  const customerName = offer?.customer?.name || "Kunde";
  const trade = offer?.trade || "";
  const today = new Date().toLocaleDateString("de-DE");
  const fmt = (n) => (Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" }));

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(fs.createWriteStream(filePath));

  // Kopf
  doc.fontSize(18).font("Helvetica-Bold").text("Angebot", { align: "center" });
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(12).text(`Firma: ${companyName}`);
  doc.text(`Kunde: ${customerName}`);
  doc.text(`Gewerk: ${trade}`);
  doc.text(`Datum: ${today}`);
  doc.moveDown(1);

  // Tabellenkopf
  const startY = doc.y;
  doc.font("Helvetica-Bold").fontSize(11);
  doc.text("Beschreibung", 50, startY);
  doc.text("Menge", 250, startY);
  doc.text("Einheit", 310, startY);
  doc.text("Einzelpreis", 380, startY);
  doc.text("Gesamt", 470, startY);
  doc.moveDown(0.8);
  doc.font("Helvetica").fontSize(10);

  // Positionen (mit einfachem Zebra-Look)
  (offer.items || []).forEach((it, i) => {
    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const lineTotal = qty * unitPrice;

    const y = doc.y;
    if (i % 2 === 0) {
      doc.rect(45, y - 2, 500, 18).fill("#f3f4f6").fillColor("#000");
    }

    doc.text(it.desc || "", 50, y, { width: 180 });
    doc.text(String(qty), 250, y);
    doc.text(it.unit || "", 310, y);
    doc.text(fmt(unitPrice), 380, y);
    doc.text(fmt(lineTotal), 470, y);
    doc.moveDown(1);
  });

  // Summenbox
  doc.moveDown(1);
  const boxX = 300;
  const boxY = doc.y;
  doc.rect(boxX, boxY, 240, 90).fill("#f8fafc").stroke("#e5e7eb");
  doc.fillColor("#000").fontSize(10);

  doc.text(`Zwischensumme: ${fmt(offer.subtotal)}`, boxX + 10, boxY + 10, { width: 220, align: "right" });
  doc.text(`Aufschlag (10%): ${fmt(offer.margin)}`, boxX + 10, doc.y + 5, { width: 220, align: "right" });
  doc.text(`Netto: ${fmt(offer.totalBeforeTax)}`, boxX + 10, doc.y + 5, { width: 220, align: "right" });
  doc.text(`MwSt (19%): ${fmt(offer.tax)}`, boxX + 10, doc.y + 5, { width: 220, align: "right" });
  doc.font("Helvetica-Bold").text(`Gesamtsumme: ${fmt(offer.total)}`, boxX + 10, doc.y + 5, { width: 220, align: "right" });

  // Fußnote
  doc.moveDown(3);
  doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(
    "Hinweis: Angebot freibleibend. Preise in EUR zzgl. gesetzlicher MwSt., sofern nicht anders ausgewiesen. Zahlungsziel 14 Tage.",
    { width: 500 }
  );

  doc.end();
  return `/generated/${filename}`;
}

// ---- API
app.post("/api/offers/generate", (req, res) => {
  try {
    const input = offerschemaParse(req.body);
    const offer = generateOffer(input);
    res.json(offer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/offers/export-pdf", (req, res) => {
  try {
    const offer = req.body;
    const publicPath = exportOfferToPDF(offer);
    res.json({ ok: true, path: publicPath });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Direkt-Download der PDF
app.post("/api/offers/export-pdf/download", (req, res) => {
  try {
    const offer = req.body;
    const publicPath = exportOfferToPDF(offer);
    const absPath = path.join(__dirname, "public", publicPath.replace(/^\//, ""));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Angebot.pdf"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Landing Page
app.get("/", (req, res) => {
  res.send(`<!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>MeisterKI</title>
        <style>
          body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:20px}
          code{background:#f3f4f6;padding:2px 6px;border-radius:6px}
          a.button{display:inline-block;margin-top:10px;padding:10px 14px;background:#2563eb;color:#fff;border-radius:10px;text-decoration:none}
          pre{background:#f8fafc;border:1px solid #e5e7eb;padding:12px;border-radius:10px;max-width:800px}
        </style>
      </head>
      <body>
        <h1>🚀 Willkommen bei MeisterKI</h1>
        <p>Dein Server läuft! API-Endpunkte:</p>
        <ul>
          <li><code>POST /api/offers/generate</code></li>
          <li><code>POST /api/offers/export-pdf</code></li>
          <li><code>POST /api/offers/export-pdf/download</code></li>
        </ul>
        <a class="button" href="/app.html">Zur Angebots-App</a>
      </body>
    </html>`);
});

// ---- Start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MeisterKI server listening on port ${PORT}`));

