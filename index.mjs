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
  // PDF in /public/generated ablegen, damit es öffentlich abrufbar ist
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
    doc.text(it.desc || "", 50, doc.y, { width: 140 });
    doc.text(String(it.qty ?? ""), 200, doc.y);
    doc.text(it.unit || "", 260, doc.y);
    doc.text(((it.unitPrice ?? 0).toFixed(2)) + " €", 340, doc.y);
    const lineTotal = (Number(it.qty || 0) * Number(it.unitPrice || 0)).toFixed(2);
    doc.text(lineTotal + " €", 420, doc.y);
    doc.moveDown();
  }

  doc.moveDown();
  const s = n => (Number(n||0).toFixed(2) + " €");
  doc.text(`Zwischensumme: ${s(offer.subtotal)}`, { align: "right" });
  doc.text(`Aufschlag: ${s(offer.margin)}`, { align: "right" });
  doc.text(`Netto: ${s(offer.totalBeforeTax)}`, { align: "right" });
  doc.text(`MwSt: ${s(offer.tax)}`, { align: "right" });
  doc.font("Helvetica-Bold").text(`Gesamtsumme: ${s(offer.total)}`, { align: "right" });

  doc.end();

  // Öffentlich erreichbarer Pfad (weil /public statisch serviert wird)
  return `/generated/${filename}`;
}

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
// ---- Landing Page (mit Buttons zum Testen)
app.get("/", (req, res) => {
  res.send(`<!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>MeisterKI</title>
        <style>
          body { font-family: system-ui, -apple-system, Roboto, Arial, sans-serif; padding: 20px; line-height: 1.4 }
          button { padding: .6rem 1rem; border: 0; border-radius: 8px; background:#2563eb; color:#fff; cursor:pointer; margin-right:.5rem }
          pre { background:#f8f9fb; padding:1rem; border-radius:10px; }
        </style>
      </head>
      <body>
        <h1>🚀 Willkommen bei MeisterKI</h1>
        <p>Dein Server läuft! API-Endpunkte:</p>
        <ul>
          <li><code>POST /api/offers/generate</code></li>
          <li><code>POST /api/offers/export-pdf</code></li>
        </ul>

        <h2>🔍 API testen</h2>
        <button onclick="testGenerate()">📄 Angebot generieren</button>
        <button onclick="testExport()">📑 PDF exportieren</button>

        <h3>Antwort</h3>
        <pre id="out">Noch nichts berechnet…</pre>

        <script>
          async function testGenerate() {
            const res = await fetch('/api/offers/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [
                  { desc: "Malerarbeiten Wohnzimmer", qty: 20, unit: "h", unitPrice: 45 },
                  { desc: "Materialfarbe", qty: 5, unit: "L", unitPrice: 12 }
                ]
              })
            });
            const data = await res.json();
            document.getElementById('out').textContent = JSON.stringify(data, null, 2);
          }

          async function testExport() {
            const res = await fetch('/api/offers/export-pdf', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [
                  { desc: "Fliesenarbeiten Bad", qty: 10, unit: "h", unitPrice: 50 },
                  { desc: "Fliesenpaket", qty: 20, unit: "m²", unitPrice: 25 }
                ]
              })
            });
            const data = await res.json();
            document.getElementById('out').textContent = JSON.stringify(data, null, 2);
          }
        </script>
      </body>
    </html>`);
});

// ---- Start (Render nutzt $PORT)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MeisterKI server listening on port ${PORT}`));
