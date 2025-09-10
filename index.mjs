import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";

const app = express();
app.use(bodyParser.json());
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  input.items.forEach(it => {
    subtotal += it.qty * it.unitPrice;
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
    total
  };
}

// ---- PDF Export (deine längere Version)
function exportOfferToPDF(offer) {
  const filePath = "./offer.pdf";
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
  for (const it of offer.items) {
    doc.text(it.desc, 50, doc.y, { width: 140 });
    doc.text(String(it.qty), 200, doc.y);
    doc.text(it.unit, 260, doc.y);
    doc.text(it.unitPrice.toFixed(2) + " €", 340, doc.y);
    doc.text((it.qty * it.unitPrice).toFixed(2) + " €", 420, doc.y);
    doc.moveDown();
  }

  doc.moveDown();
  doc.text(`Zwischensumme: ${offer.subtotal.toFixed(2)} €`, { align: "right" });
  doc.text(`Aufschlag: ${offer.margin.toFixed(2)} €`, { align: "right" });
  doc.text(`Netto: ${offer.totalBeforeTax.toFixed(2)} €`, { align: "right" });
  doc.text(`MwSt: ${offer.tax.toFixed(2)} €`, { align: "right" });
  doc.font("Helvetica-Bold").text(`Gesamtsumme: ${offer.total.toFixed(2)} €`, { align: "right" });

  doc.end();
  return filePath;
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
    const file = exportOfferToPDF(offer);
    res.json({ ok: true, path: file });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Landing Page
app.get("/", (req, res) => {
  res.send(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>MeisterKI</title>
      </head>
      <body>
        <h1>🚀 Willkommen bei MeisterKI</h1>
        <p>Dein Server läuft! API-Endpoints:</p>
        <ul>
          <li><code>POST /api/offers/generate</code></li>
          <li><code>POST /api/offers/export-pdf</code></li>
        </ul>
      </body>
    </html>`);
});

// ---- Start (Render nutzt $PORT)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MeisterKI server listening on port ${PORT}`));
