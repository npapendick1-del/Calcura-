// index.mjs
import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// --- Pfade/Setup ----------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: "10mb" })); // für größere Uploads/Prompts
app.use(express.static(path.join(__dirname, "public"))); // /public für app.html, dashboard.html, generierte PDFs

// --- Hilfsfunktionen -------------------------------------------------------------
function assertOfferInput(input) {
  if (!input || !Array.isArray(input.items)) {
    throw new Error("Ungültiges Eingabeformat: items[] fehlt");
  }
  return input;
}

function generateOffer(input) {
  let subtotal = 0;
  for (const it of input.items) {
    subtotal += Number(it.qty || 0) * Number(it.unitPrice || 0);
  }
  const margin = subtotal * 0.1;
  const totalBeforeTax = subtotal + margin;
  const tax = totalBeforeTax * 0.19;
  const total = totalBeforeTax + tax;
  return { items: input.items, subtotal, margin, totalBeforeTax, tax, total };
}

// --- PDF-Export (sauberes Layout) -----------------------------------------------
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
    Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.pipe(fs.createWriteStream(filePath));

  // Logo (optional)
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

  // Hinweise / AGB
  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(11).text("Hinweise / AGB (Kurzfassung)");
  doc.font("Helvetica").fontSize(9).fillColor("#333").text(
    "• Dieses Angebot ist 30 Tage gültig. Alle Preise in EUR zzgl. gesetzlicher MwSt.\n" +
      "• Abweichungen/Zusatzleistungen werden gesondert berechnet.\n" +
      "• Zahlungsziel: 14 Tage netto ohne Abzug.\n" +
      "• Es gelten unsere allgemeinen Geschäftsbedingungen.",
    { width: 500 }
  );

  // Footer auf jeder Seite
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#6b7280").text(
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
  return `/generated/${filename}`; // öffentlich über /public erreichbar
}

// --- API: Angebot berechnen ------------------------------------------------------
app.post("/api/offers/generate", (req, res) => {
  try {
    const input = assertOfferInput(req.body);
    const offer = generateOffer(input);
    res.json(offer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- API: PDF erzeugen (Pfad zurückgeben) ---------------------------------------
app.post("/api/offers/export-pdf", (req, res) => {
  try {
    const offer = req.body;
    const publicPath = exportOfferToPDF(offer);
    res.json({ ok: true, path: publicPath }); // z.B. /generated/angebot-xxx.pdf
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- API: PDF direkt downloaden (POST -> Blob) ----------------------------------
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

// --- API: KI-Assistent (Rechnungstext -> Positionen) ----------------------------
// Nutzt OpenAI (moderne responses-API). Stelle sicher, dass OPENAI_API_KEY als Env gesetzt ist.
app.post("/api/invoice/parse", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY fehlt (in Render → Environment hinzufügen)." });
  }
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text (String) wird benötigt." });
  }

  try {
    // Node 18+/22+ hat global fetch
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input:
          "Extrahiere strukturierte Angebotspositionen aus folgendem Rechnungstext. " +
          "Gib ein JSON-Objekt im Format {items:[{desc,qty,unit,unitPrice},...]} zurück. " +
          "Zahlen als number. Wenn etwas unsicher ist, schätze vorsichtig und erwähne es nicht extra.\n\n" +
          text,
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: errText });
    }

    const data = await resp.json();
    // Das „responses“-API liefert das Modell-Output unter data.output_text
    const raw = data.output_text || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Falls das Modell z. B. mit Text drumherum antwortet, mit Regex den JSON-Block ziehen
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { items: [] };
    }

    // rücksichern auf erwartete Struktur
    if (!parsed || !Array.isArray(parsed.items)) parsed = { items: [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}); 

// ---- PDF-Liste für das PDF-Center
app.get("/api/pdfs", (req, res) => {
  try {
    const dir = path.join(__dirname, "public", "generated");
    if (!fs.existsSync(dir)) return res.json([]);

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".pdf"));
    const out = files.map(name => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return {
        name,
        url: `/generated/${name}`,
        size: st.size,
        mtime: st.mtime,
      };
    }).sort((a, b) => b.mtime - a.mtime);

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Landing Page -> Dashboard ---------------------------------------------------
// Root lädt das neue Dashboard (Kacheln für „Angebot“ & „KI-Assistent“)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// --- Serverstart -----------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
