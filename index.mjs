// index.mjs
import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import bcrypt from "bcrypt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ====== Login / Session Setup ======
app.use(
  session({
    secret: process.env.SESSION_SECRET || "supergeheim",
    resave: false,
    saveUninitialized: false,
  })
);

// Geschützte HTML-Seiten
const PROTECTED_SET = new Set([
  "/dashboard.html",
  "/app.html",
  "/assistant.html",
  "/pdfs.html",
  "/customers.html",
  "/projects.html",
  "/settings.html",
  "/users.html",
]);

// Schutz-Middleware
app.use((req, res, next) => {
  const p = req.path;
  if (
    p === "/login.html" ||
    p.startsWith("/api/auth/") ||
    p.startsWith("/generated/") ||
    p === "/logo.png"
  ) {
    return next();
  }
  if (PROTECTED_SET.has(p)) {
    if (req.session?.user) return next();
    return res.redirect("/login.html");
  }
  next();
});

// Statische Dateien (inkl. PDFs)
app.use(express.static(path.join(__dirname, "public")));

// ---------------------- Angebotslogik ----------------------
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

// ---------------------- PDF-Export ----------------------
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

  const logoPath = path.join(__dirname, "public", "logo.png");
  if (fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 430, 40, { width: 140 });
    } catch {}
  }

  doc.fontSize(20).font("Helvetica-Bold").text("Angebot", 50, 50);
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(12).text(`Firma: ${companyName}`);
  doc.text(`Kunde: ${customerName}`);
  doc.text(`Gewerk: ${trade}`);
  doc.text(`Datum: ${today}`);
  doc.moveDown(1.5);

  const drawHeader = (y) => {
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text("Beschreibung", 50, y);
    doc.text("Menge", 250, y);
    doc.text("Einheit", 310, y);
    doc.text("Einzelpreis", 380, y);
    doc.text("Gesamt", 470, y);
    doc.moveTo(50, y + 15).lineTo(550, y + 15).stroke("#000");
  };

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
  line("MwSt", offer.tax);
  line("Gesamtsumme", offer.total, true);

  doc.end();
  return { url: `/generated/${filename}`, filename };
}

// ---------------------- PDF-API ----------------------
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

// ======= Mini JSON Store =======
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
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

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
  res.json({ items: readJson("customers.json", []) });
});
app.post("/api/customers", (req, res) => {
  const list = readJson("customers.json", []);
  const c = req.body || {};
  const item = { id: uid(), ...c, createdAt: Date.now() };
  list.push(item);
  writeJson("customers.json", list);
  res.json(item);
});

// ======= Projekte =======
app.get("/api/projects", (req, res) => {
  res.json({ items: readJson("projects.json", []) });
});
app.post("/api/projects", (req, res) => {
  const list = readJson("projects.json", []);
  const p = req.body || {};
  const item = { id: uid(), ...p, createdAt: Date.now() };
  list.push(item);
  writeJson("projects.json", list);
  res.json(item);
});

// ======= Auth: Nutzerverwaltung =======
function authRead(fname, fallback) {
  const p = path.join(DATA_DIR, fname);
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : fallback;
  } catch {
    return fallback;
  }
}
function authWrite(fname, data) {
  const p = path.join(DATA_DIR, fname);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

// Fallback-Admin
(function ensureAdminFallback() {
  const usersFile = path.join(DATA_DIR, "users.json");
  let users = [];
  try {
    if (fs.existsSync(usersFile)) {
      users = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
    }
  } catch {
    users = [];
  }
  if (users.length === 0) {
    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPass = process.env.ADMIN_PASS || "admin";
    const hash = bcrypt.hashSync(adminPass, 10);
    users.push({ id: uid(), username: adminUser, passhash: hash, role: "admin", createdAt: Date.now() });
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), "utf-8");
    console.log(`[auth] Fallback-Admin '${adminUser}' angelegt (Passwort: '${adminPass}')`);
  }
})();

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const users = authRead("users.json", []);
  const u = users.find((x) => x.username === String(username || ""));
  if (!u) return res.status(401).json({ error: "Unauthorized" });
  const ok = await bcrypt.compare(String(password || ""), u.passhash);
  if (!ok) return res.status(401).json({ error: "Unauthorized" });
  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.json({ ok: true, user: req.session.user });
});

// ---------------------- KI-Assistent ----------------------
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
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input:
          "Extrahiere strukturierte Angebotspositionen aus folgendem Rechnungstext. " +
          'Gib ein JSON-Objekt im Format {"items":[{"desc","qty","unit","unitPrice"}]} zurück.\n\n' +
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

// ---------------------- Landing Page ----------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ---------------------- Start ----------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
