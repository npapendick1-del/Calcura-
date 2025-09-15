import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai"; // <- NEU

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());

// statische Dateien aus /public ausliefern (z.B. app.html und generierte PDFs)
app.use(express.static(path.join(__dirname, "public")));

// ---- Angebotsschema (Validierung)
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

// ---- PDF Export (professionelles Layout, nur 1x vorhanden!)
function exportOfferToPDF(offer) {
  const outDir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `angebot-${Date.now()}.pdf`;
  const filePath = path.join(outDir, filename);

  const companyName = offer?.company?.name || "Ihr Handwerksbetrieb";
  const customerName = offer?.customer?.name || "Kunde";
  const trade = offer?.trade || "-";
  const today = new Date().toLocaleDateString("de-DE");
  const fmt = (n) =>
    Number(n || 0).toLocaleString("de-DE", {
      style: "currency",
      currency: "EUR",
    });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.pipe(fs.createWriteStream(filePath));

  // Logo
  const logoPath = path.join(__dirname, "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 430, 40, { width: 140 });
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

  // Tabellenkopf
  const drawHeader = (y) => {
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Beschreibung", 50, y);
    doc.text("Menge", 250, y);
    doc.text("Einheit", 310, y);
    doc.text("Einzelpreis", 380, y);
    doc.text("Gesamt", 470, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke("#000");
  };

  // Positionen
  let y = doc.y + 20;
  drawHeader(y);
  y += 25;
  doc.font("Helvetica").fontSize(10);

  (offer.items || []).forEach((it, i) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
      drawHeader(y);
      y += 25;
    }

    const qty = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    const lineTotal = qty * unitPrice;

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

  const line = (label, val, bold = false) => {
    if (bold) doc.font("Helvetica-Bold");
    doc.text(label, 310, doc.y + 5, { continued: true });
    doc.text(fmt(val), 300, doc.y, { width: 240, align: "right" });
    if (bold) doc.font("Helvetica");
  };

  doc.y = boxY + 5;
  line("Zwischensumme", offer.subtotal);
  line("Aufschlag (10%)", offer.margin);
  line("Netto", offer.totalBeforeTax);
  line("MwSt (19%)", offer.tax);
  line("Gesamtsumme", offer.total, true);

  // AGB / Hinweise
  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(11).text("Hinweise / AGB (Kurzfassung)");
  doc.font("Helvetica").fontSize(9).fillColor("#333").text(
    "• Dieses Angebot ist 30 Tage gültig. Alle Preise verstehen sich in EUR zzgl. gesetzlicher MwSt.\n" +
      "• Abweichungen oder Zusatzleistungen werden gesondert berechnet.\n" +
      "• Zahlungsziel: 14 Tage netto ohne Abzug.\n" +
      "• Es gelten unsere allgemeinen Geschäftsbedingungen.",
    { width: 500 }
  );

  // Footer (jede Seite)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8)
      .fillColor("#6b7280")
      .text(
        `${companyName} • kontakt@example.com • 01234 / 567890`,
        50,
        doc.page.height - 60,
        { width: 500, align: "center" }
      );
    doc.text(`Seite ${i + 1} von ${range.count}`, 50, doc.page.height - 45, {
      width: 500,
      align: "right",
    });
  }

  doc.end();
  return `/generated/${filename}`;
}

// =======================
// KI: Rechnungstext -> Positionen
// =======================
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/invoice/parse", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Rechnungstext fehlt." });
    }

    const prompt = `
Du bist ein Parser für Handwerker-Rechnungen/Notizen.
Extrahiere Angebots-Positionen und gib *ausschließlich* valides JSON zurück:

{
  "items": [
    { "desc": "Beschreibung", "qty": Zahl, "unit": "Einheit", "unitPrice": Zahl }
  ]
}

Regeln:
- Dezimaltrennzeichen kann Komma sein; intern als Zahl mit Punkt interpretieren.
- unit: z.B. "h", "Stk", "qm", "m", "L"; wenn unklar -> "".
- Wenn nur Gesamtpreis existiert und qty vorhanden: unitPrice = Gesamt / qty.
- Keine Erklärungen, nur JSON.

Text:
"""${text}"""
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    let raw = completion.choices?.[0]?.message?.content ?? "{}";

    // Falls das Modell doch Text drumherum liefert -> JSON extrahieren
    const m = raw.match(/\{[\s\S]*\}$/);
    if (m) raw = m[0];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res
        .status(500)
        .json({ error: "KI-Antwort konnte nicht als JSON geparst werden.", raw });
    }

    // Normalisieren
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const normalized = items
      .map((it) => ({
        desc: String(it?.desc ?? "").trim(),
        qty: Number(String(it?.qty ?? "0").replace(",", ".")) || 0,
        unit: String(it?.unit ?? "").trim(),
        unitPrice: Number(String(it?.unitPrice ?? "0").replace(",", ".")) || 0,
      }))
      .filter((it) => it.desc);

    return res.json({ items: normalized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.post("/api/offers/export-pdf/download", (req, res) => {
  try {
    const offer = req.body;
    const publicPath = exportOfferToPDF(offer);
    const absPath = path.join(
      __dirname,
      "public",
      publicPath.replace(/^\//, "")
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Angebot.pdf"`
    );
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
        <ul>
          <li><code>POST /api/offers/generate</code></li>
          <li><code>POST /api/offers/export-pdf</code></li>
          <li><code>POST /api/offers/export-pdf/download</code></li>
          <li><code>POST /api/invoice/parse</code> <small>(KI: Rechnungstext → Positionen)</small></li>
        </ul>
        <a class="button" href="/app.html">Zur Angebots-App</a>
      </body>
    </html>`);
});

// ---- Start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`MeisterKI server listening on port ${PORT}`)
);

