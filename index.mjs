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

// ---- PDF Export (professionelles Layout)
function exportOfferToPDF(offer) {
  const outDir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `angebot-${Date.now()}.pdf`;
  const filePath = path.join(outDir, filename);

  const companyName = offer?.company?.name || "Ihr Handwerksbetrieb";
  const customerName = offer?.customer?.name || "Kunde";
  const trade = offer?.trade || "";
  const today = new Date().toLocaleDateString("de-DE");
  const fmt = (n) =>
    Number(n || 0).toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
    });

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(fs.createWriteStream(filePath));

  // Logo einfügen, falls vorhanden
  const logoPath = path.join(__dirname, "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 400, 40, { width: 150 });
    } catch {}
  }

  // Kopf
  doc.fontSize(20).font("Helvetica-Bold").text("Angebot", 50, 50);
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(12).text(`Firma: ${companyName}`);
  doc.text(`Kunde: ${customerName}`);
  doc.text(`Gewerk: ${trade}`);
  doc.text(`Datum: ${today}`);
  doc.moveDown(1.5);

  // Tabellen-Header Funktion
  function drawTableHeader(y) {
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Beschreibung", 50, y);
    doc.text("Menge", 250, y);
    doc.text("Einheit", 310, y);
    doc.text("Einzelpreis", 380, y);
    doc.text("Gesamt", 470, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke("#000");
  }

  // Tabelleninhalt
  let y = doc.y + 20;
  drawTableHeader(y);
  y += 25;
  doc.font("Helvetica").fontSize(10);

  (offer.items || []).forEach((it, i) => {
    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const lineTotal = qty * unitPrice;

    if (y > 700) {
      // neue Seite + Header wiederholen
      doc.addPage();
      y = 50;
      drawTableHeader(y);
      y += 25;
    }

    if (i % 2 === 0) {
      doc.rect(50, y - 3, 500, 20).fill("#f3f4f6").fillColor("#000");
    }

    doc.text(it.desc || "", 55, y, { width: 180 });
    doc.text(String(qty), 250, y);
    doc.text(it.unit || "", 310, y);
    doc.text(fmt(unitPrice), 380, y);
    doc.text(fmt(lineTotal), 470, y);
    y += 22;
  });

  // Summenbox
  const boxY = y + 20;
  doc.rect(300, boxY, 250, 100).fill("#f8fafc").stroke("#e5e7eb");
  doc.fillColor("#000").font("Helvetica").fontSize(10);

  const writeLine = (label, val, bold = false) => {
    if (bold) doc.font("Helvetica-Bold");
    doc.text(label, 310, doc.y + 5, { continued: true });
    doc.text(fmt(val), 300, doc.y, { width: 240, align: "right" });
    if (bold) doc.font("Helvetica");
  };

  doc.y = boxY + 5;
  writeLine("Zwischensumme", offer.subtotal);
  writeLine("Aufschlag (10%)", offer.margin);
  writeLine("Netto", offer.totalBeforeTax);
  writeLine("MwSt (19%)", offer.tax);
  writeLine("Gesamtsumme", offer.total, true);

  // Fußnote
  doc.moveDown(3);
  doc.font("Helvetica").fontSize(8).fillColor("#6b7280").text(
    "Hinweis: Angebot freibleibend. Preise in EUR zzgl. gesetzlicher MwSt. Zahlungsziel: 14 Tage ohne Abzug.",
    { width: 500 }
  );

  // Seitenzahlen
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#6b7280").text(
      `Seite ${i + 1} von ${range.count}`,
      0,
      doc.page.height - 50,
      { align: "right", width: doc.page.width - 50 }
    );
  }

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
        </style>
      </head>
      <body>
        <h1>🚀 Willkommen bei MeisterKI</h1>
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

