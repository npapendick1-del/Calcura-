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

// ---- PDF Export (legt Datei öffentlich in /public/generated ab)
function exportOfferToPDF(offer) {
  const outDir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `angebot-${Date.now()}.pdf`;
  const filePath = path.join(outDir, filename);

  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text("Angebot", { align: "center" });
  doc.moveDown();

  // Tabellenkopf
  doc.font("Helvetica-Bold");
  doc.text("Beschreibung", 50, doc.y);
  doc.text("Menge", 200, doc.y);
  doc.text("Einheit", 260, doc.y);
  doc.text("Preis", 340, doc.y);
  doc.text("Total", 420, doc.y);
  doc.moveDown();

  // Tabellenzeilen
  doc.font("Helvetica");
  for (const it of offer.items || []) {
    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const lineTotal = (qty * unitPrice).toFixed(2);

    doc.text(it.desc || "", 50, doc.y, { width: 140 });
    doc.text(String(qty), 200, doc.y);
    doc.text(it.unit || "", 260, doc.y);
    doc.text(unitPrice.toFixed(2) + " €", 340, doc.y);
    doc.text(lineTotal + " €", 420, doc.y);
    doc.moveDown();
  }

  doc.moveDown();
  const s = (n) => (Number(n || 0).toFixed(2) + " €");
  doc.text(`Zwischensumme: ${s(offer.subtotal)}`, { align: "right" });
  doc.text(`Aufschlag: ${s(offer.margin)}`, { align: "right" });
  doc.text(`Netto: ${s(offer.totalBeforeTax)}`, { align: "right" });
  doc.text(`MwSt: ${s(offer.tax)}`, { align: "right" });
  doc.font("Helvetica-Bold").text(`Gesamtsumme: ${s(offer.total)}`, { align: "right" });

  doc.end();

  // öffentlich erreichbarer Pfad relativ zu /public
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
    const publicPath = exportOfferToPDF(offer); // z.B. /generated/angebot-123.pdf
    res.json({ ok: true, path: publicPath });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Landing Page (mit Link zur App-Seite)
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
        </ul>
        <a class="button" href="/app.html">Zur Angebots-App</a>
        <h3>Antwort</h3>
        <pre id="out">Verwende die App-Seite, um zu testen.</pre>
      </body>
    </html>`);
});

// ---- Start (Render nutzt $PORT)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MeisterKI server listening on port ${PORT}`));
