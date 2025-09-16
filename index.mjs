// index.mjs
import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public"))); // /public: app.html, dashboard.html, generated PDFs

// ---------------------- Angebotslogik (unverändert) ----------------------
function offerschemaParse(input) {
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

// ---------------------- 2.1 Export-Funktion mit schönem Dateinamen ----------------------
function exportOfferToPDF(offer) {
  const outDir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const safe = (s) =>
    String(s || "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

  const company = safe(offer?.company?.name || "Firma");
  const customer = safe(offer?.customer?.name || "Kunde");
  const date = new Date().toISOString().slice(0, 10);
  const filename = `Angebot_${company}_${customer}_${date}.pdf`;
  const filePath = path.join(outDir, filename);

  const companyName = offer?.company?.name || "Ihr Handwerksbetrieb";
  const customerName = offer?.customer?.name || "Kunde";
  const trade = offer?.trade || "-";
  const today = new Date().toLocaleDateString("de-DE");
  const fmt = (n) =>
    Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.pipe(fs.createWriteStream(filePath));

  // Optionales Logo
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
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#333")
    .text(
      "• Dieses Angebot ist 30 Tage gültig. Alle Preise verstehen sich in EUR zzgl. gesetzlicher MwSt.\n" +
        "• Abweichungen oder Zusatzleistungen werden gesondert berechnet.\n" +
        "• Zahlungsziel: 14 Tage netto ohne Abzug.\n" +
        "• Es gelten unsere allgemeinen Geschäftsbedingungen.",
      { width: 500 }
    );

  // Footer & Seitenzahlen
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor("#6b7280")
      .text(`${companyName} • kontakt@example.com • 01234 / 567890`, 50, doc.page.height - 60, {
        width: 500,
        align: "center",
      });
    doc.text(`Seite ${i + 1} von ${range.count}`, 50, doc.page.height - 45, {
      width: 500,
      align: "right",
    });
  }

  doc.end();

  // Rückgabe für API-Use
  return { url: `/generated/${filename}`, filename };
}

// ---------------------- Angebots-APIs ----------------------
app.post("/api/offers/generate", (req, res) => {
  try {
    const input = offerschemaParse(req.body);
    const offer = generateOffer(input);
    res.json(offer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------- 2.2 Export-Endpoints aktualisiert ----------------------
app.post("/api/offers/export-pdf", (req, res) => {
  try {
    const offer = req.body;
    const { url, filename } = exportOfferToPDF(offer);
    res.json({ ok: true, path: url, filename });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/offers/export-pdf/download", (req, res) => {
  try {
    const offer = req.body;
    const { url, filename } = exportOfferToPDF(offer);
    const absPath = path.join(__dirname, "public", url.replace(/^\//, ""));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------- 2.3 PDF-API: Liste & Löschen ----------------------
app.get("/api/pdfs/list", (req, res) => {
  const dir = path.join(__dirname, "public", "generated");
  if (!fs.existsSync(dir)) return res.json({ items: [] });

  try {
    const items = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((name) => {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        return {
          name,
          url: `/generated/${name}`,
          size: st.size,
          mtime: st.mtimeMs,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/pdfs", (req, res) => {
  const name = String(req.query.name || "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return res.status(400).json({ error: "Ungültiger Dateiname" });
  }
  const p = path.join(__dirname, "public", "generated", name);
  fs.unlink(p, (err) => {
    if (err) return res.status(404).json({ error: "Datei nicht gefunden" });
    res.json({ ok: true });
  });
});

// ======= Mini JSON Store (./data/*.json) =======
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(fname, fallback) {
  const p = path.join(DATA_DIR, fname);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJson(fname, data) {
  const p = path.join(DATA_DIR, fname);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ======= Einstellungen =======
app.get("/api/settings", (req, res) => {
  const s = readJson("settings.json", {
    companyName: "",
    email: "",
    phone: "",
    address: "",
    taxRate: 19,
    marginRate: 10,
  });
  res.json(s);
});
app.put("/api/settings", (req, res) => {
  const s = req.body || {};
  const merged = {
    companyName: String(s.companyName || ""),
    email: String(s.email || ""),
    phone: String(s.phone || ""),
    address: String(s.address || ""),
    taxRate: Number(s.taxRate ?? 19),
    marginRate: Number(s.marginRate ?? 10),
  };
  writeJson("settings.json", merged);
  res.json({ ok: true });
});

// ======= Kunden =======
app.get("/api/customers", (req, res) => {
  const list = readJson("customers.json", []);
  res.json({ items: list });
});
app.post("/api/customers", (req, res) => {
  const list = readJson("customers.json", []);
  const c = req.body || {};
  const item = {
    id: uid(),
    name: String(c.name || ""),
    email: String(c.email || ""),
    phone: String(c.phone || ""),
    street: String(c.street || ""),
    city: String(c.city || ""),
    note: String(c.note || ""),
    createdAt: Date.now(),
  };
  list.push(item);
  writeJson("customers.json", list);
  res.json(item);
});
app.put("/api/customers/:id", (req, res) => {
  const id = req.params.id;
  const list = readJson("customers.json", []);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });
  const c = req.body || {};
  list[idx] = { ...list[idx],
    name: String(c.name ?? list[idx].name),
    email: String(c.email ?? list[idx].email),
    phone: String(c.phone ?? list[idx].phone),
    street: String(c.street ?? list[idx].street),
    city: String(c.city ?? list[idx].city),
    note: String(c.note ?? list[idx].note),
  };
  writeJson("customers.json", list);
  res.json({ ok: true });
});
app.delete("/api/customers/:id", (req, res) => {
  const id = req.params.id;
  const list = readJson("customers.json", []);
  const next = list.filter(x => x.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Not found" });
  writeJson("customers.json", next);
  res.json({ ok: true });
});

// ======= Projekte =======
app.get("/api/projects", (req, res) => {
  const list = readJson("projects.json", []);
  res.json({ items: list });
});
app.post("/api/projects", (req, res) => {
  const list = readJson("projects.json", []);
  const p = req.body || {};
  const item = {
    id: uid(),
    title: String(p.title || ""),
    customerId: String(p.customerId || ""),
    status: String(p.status || "offen"), // offen | laufend | abgeschlossen
    budget: Number(p.budget || 0),
    note: String(p.note || ""),
    createdAt: Date.now(),
  };
  list.push(item);
  writeJson("projects.json", list);
  res.json(item);
});
app.put("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const list = readJson("projects.json", []);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });
  const p = req.body || {};
  list[idx] = { ...list[idx],
    title: String(p.title ?? list[idx].title),
    customerId: String(p.customerId ?? list[idx].customerId),
    status: String(p.status ?? list[idx].status),
    budget: Number(p.budget ?? list[idx].budget),
    note: String(p.note ?? list[idx].note),
  };
  writeJson("projects.json", list);
  res.json({ ok: true });
});
app.delete("/api/projects/:id", (req, res) => {
  const id = req.params.id;
  const list = readJson("projects.json", []);
  const next = list.filter(x => x.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Not found" });
  writeJson("projects.json", next);
  res.json({ ok: true });
});


// ---------------------- KI-Assistent (unverändert) ----------------------
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
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input:
          "Extrahiere strukturierte Angebotspositionen aus folgendem Rechnungstext. " +
          'Gib ein JSON-Objekt im Format {"items":[{"desc","qty","unit","unitPrice"}]} zurück. ' +
          "Zahlen als number; wenn unsicher, vorsichtig schätzen.\n\n" +
          text,
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: errText });
    }

    const data = await resp.json();
    const raw = data.output_text || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { items: [] };
    }
    if (!parsed || !Array.isArray(parsed.items)) parsed = { items: [] };
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------------------- Landing Page -> Dashboard ----------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ---------------------- Start ----------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
