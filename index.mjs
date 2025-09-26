// ==============================
// MeisterKI – Backend (index.mjs)
// Super-Backend mit Auth, RBAC, PDF, AI, Kunden/Projekte, Uploads, Audit, Backups, E-Mail
// ==============================

// ------- Core & Utils -------
import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

// ------- Security / Hardening -------
import session from "express-session";
import bcrypt from "bcrypt";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

// ------- Uploads & E-Mail -------
import multer from "multer";
import nodemailer from "nodemailer";

// ------- Validation -------
import { z } from "zod";

// ===== Path helpers =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== App =====
const app = express();

// ------------ CONFIG -------------
const IS_DEV = process.env.NODE_ENV !== "production";
const PORT = process.env.PORT || 4000;

// Session store (MemoryStore ist für Produktion nicht ideal; für Render ok als Start)
const SESSION_SECRET = process.env.SESSION_SECRET || "supergeheim";

// E-Mail (optional – wenn nicht gesetzt, wird Mailversand übersprungen)
const SMTP = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || "no-reply@meisterki.local",
};

// ====== MIDDLEWARES ======
app.set("trust proxy", 1); // wichtig hinter Proxy/Render

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(morgan(IS_DEV ? "dev" : "combined"));

app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: !IS_DEV,       // im Prod: true (https)
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// ====== RATE LIMITS ======
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// ====== STATIC ======
const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_DIR = path.join(PUBLIC_DIR, "generated");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_DIR = path.join(__dirname, "data");

for (const dir of [PUBLIC_DIR, GENERATED_DIR, UPLOADS_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(express.static(PUBLIC_DIR)); // /public: html/css/js + generated/uploads

// ====== SIMPLE CSRF TOKEN ======
function genCsrf() {
  return crypto.randomBytes(24).toString("hex");
}
function attachCsrf(req, _res, next) {
  if (!req.session.csrf) req.session.csrf = genCsrf();
  next();
}
app.use(attachCsrf);

// Client kann CSRF via GET holen (falls gewünscht)
app.get("/api/auth/csrf", (req, res) => {
  res.json({ csrf: req.session.csrf });
});

// Prüfer für POST/PUT/DELETE (optional: nur bei sensiblen Routen)
function requireCsrf(req, res, next) {
  const token = req.get("x-csrf-token");
  if (!token || token !== req.session.csrf) {
    return res.status(403).json({ error: "CSRF invalid" });
  }
  next();
}

// ====== HELPER: JSON-DB ======
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

// ====== AUDIT LOG ======
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");
// JSON Lines: {ts, user?, ip, action, meta}
function audit(req, action, meta = {}) {
  const line = JSON.stringify({
    ts: Date.now(),
    ip: req.ip,
    user: req.session?.user || null,
    action,
    meta,
  });
  fs.appendFile(AUDIT_FILE, line + "\n", () => {});
}
app.get("/api/audit", (req, res) => {
  if (req.session?.user?.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });
  try {
    if (!fs.existsSync(AUDIT_FILE)) return res.json({ items: [] });
    const lines = fs.readFileSync(AUDIT_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .reverse()
      .slice(0, 1000);
    res.json({ items: lines });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ====== GUARDs ======
const PROTECTED_HTML = new Set([
  "/dashboard.html",
  "/app.html",
  "/assistant.html",
  "/pdfs.html",
  "/customers.html",
  "/projects.html",
  "/settings.html",
  "/users.html",
]);

// Whitelist ohne Login
const PUBLIC_PATHS = new Set([
  "/login.html",
  "/style.css",
  "/logo.png",
]);

app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith("/generated/") || p.startsWith("/uploads/")) {
    // PDFs/Uploads sind öffentlich lesbar (Download aus dem PDF-Center)
    return next();
  }
  if (p.startsWith("/api/auth/") || p === "/api/auth/csrf") return next();
  if (PUBLIC_PATHS.has(p)) return next();
  if (PROTECTED_HTML.has(p)) {
    if (req.session?.user) return next();
    return res.redirect("/login.html");
  }
  next();
});

// ============= AUTH / USERS =============
const USERS_FILE = "users.json";

// limit für login route
app.use("/api/auth/login", authLimiter);

// Ersten Admin anlegen
(function ensureAdmin() {
  const users = readJson(USERS_FILE, []);
  if (users.length === 0) {
    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPass = process.env.ADMIN_PASS || "admin";

    const hash = bcrypt.hashSync(adminPass, 10);
    users.push({
      id: uid(),
      username: adminUser,
      passhash: hash,
      role: "admin",
      createdAt: Date.now(),
      active: true,
    });
    writeJson(USERS_FILE, users);
    console.log(`[auth] Admin '${adminUser}' angelegt (ENV/Default).`);
  }
})();

// Fehlversuch-Tracking (in-Memory, pro IP+User)
const FAILS = new Map(); // key: ip|username -> { count, until }
function isLocked(ip, username) {
  const key = `${ip}|${username}`;
  const e = FAILS.get(key);
  if (!e) return false;
  if (Date.now() < e.until) return true;
  FAILS.delete(key);
  return false;
}
function registerFail(ip, username) {
  const key = `${ip}|${username}`;
  const prev = FAILS.get(key) || { count: 0, until: 0 };
  const count = prev.count + 1;
  // 3, 5, 7... steigende Sperre
  const lockSec = Math.min(60 * count, 10 * 60);
  FAILS.set(key, { count, until: Date.now() + lockSec * 1000 });
  return { count, lockSec };
}
function clearFails(ip, username) {
  const key = `${ip}|${username}`;
  FAILS.delete(key);
}

// Login
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "username/password erforderlich" });

  if (isLocked(req.ip, username)) {
    return res.status(429).json({ error: "Account temporär gesperrt. Bitte kurz warten." });
  }

  const users = readJson(USERS_FILE, []);
  const u = users.find((x) => x.username === String(username));
  if (!u || !u.active) {
    const { count, lockSec } = registerFail(req.ip, username);
    audit(req, "login.fail", { username, count, lockSec });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ok = bcrypt.compareSync(String(password), u.passhash);
  if (!ok) {
    const { count, lockSec } = registerFail(req.ip, username);
    audit(req, "login.fail", { username, count, lockSec });
    return res.status(401).json({ error: "Unauthorized" });
  }

  clearFails(req.ip, username);

  req.session.user = { id: u.id, username: u.username, role: u.role };
  audit(req, "login.ok", { userId: u.id, username: u.username });
  res.json({ ok: true, user: req.session.user, csrf: req.session.csrf });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  const user = req.session?.user;
  req.session.destroy(() => {
    audit({ ip: "n/a", session: { user } }, "logout", { user });
    res.json({ ok: true });
  });
});

// Eigener Account: Passwort ändern
app.post("/api/auth/change-password", requireCsrf, (req, res) => {
  const { oldPass, newPass } = req.body || {};
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });

  const users = readJson(USERS_FILE, []);
  const idx = users.findIndex((x) => x.id === req.session.user.id);
  if (idx < 0) return res.status(404).json({ error: "User not found" });

  if (!bcrypt.compareSync(String(oldPass || ""), users[idx].passhash))
    return res.status(400).json({ error: "Altes Passwort falsch" });

  users[idx].passhash = bcrypt.hashSync(String(newPass || ""), 10);
  writeJson(USERS_FILE, users);
  audit(req, "password.change", { userId: users[idx].id });
  res.json({ ok: true });
});

// Admin: Users CRUD (Minimal)
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}
app.get("/api/users", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  requireAdmin(req, res, () => {
    const users = readJson(USERS_FILE, []).map((u) => ({
      id: u.id, username: u.username, role: u.role, active: u.active, createdAt: u.createdAt,
    }));
    res.json({ items: users });
  });
});
app.post("/api/users", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  requireAdmin(req, res, () => {
    const { username, password, role } = req.body || {};
    const users = readJson(USERS_FILE, []);
    if (!username || !password) return res.status(400).json({ error: "username/password erforderlich" });
    if (users.some((u) => u.username === username)) return res.status(409).json({ error: "Benutzer existiert" });
    const item = {
      id: uid(),
      username,
      passhash: bcrypt.hashSync(password, 10),
      role: role === "admin" ? "admin" : "user",
      active: true,
      createdAt: Date.now(),
    };
    users.push(item);
    writeJson(USERS_FILE, users);
    audit(req, "user.create", { id: item.id, username: item.username, role: item.role });
    res.json({ id: item.id, username: item.username, role: item.role });
  });
});
app.put("/api/users/:id/toggle", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  requireAdmin(req, res, () => {
    const { id } = req.params;
    const users = readJson(USERS_FILE, []);
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return res.status(404).json({ error: "Not found" });
    users[idx].active = !users[idx].active;
    writeJson(USERS_FILE, users);
    audit(req, "user.toggle", { id, active: users[idx].active });
    res.json({ ok: true, active: users[idx].active });
  });
});
app.delete("/api/users/:id", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  requireAdmin(req, res, () => {
    const { id } = req.params;
    const users = readJson(USERS_FILE, []);
    const next = users.filter((u) => u.id !== id);
    if (next.length === users.length) return res.status(404).json({ error: "Not found" });
    writeJson(USERS_FILE, next);
    audit(req, "user.delete", { id });
    res.json({ ok: true });
  });
});

// ============= SETTINGS =============
const SETTINGS_FILE = "settings.json";
app.get("/api/settings", (req, res) => {
  const s = readJson(SETTINGS_FILE, {
    language: "de",
    theme: "light",
    companyName: "",
    email: "",
    phone: "",
    address: "",
    taxRate: 19,
    marginRate: 10,
  });
  res.json(s);
});
app.post("/api/settings", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const s = req.body || {};
  const merged = {
    language: String(s.language || "de"),
    theme: String(s.theme || "light"),
    companyName: String(s.companyName || ""),
    email: String(s.email || ""),
    phone: String(s.phone || ""),
    address: String(s.address || ""),
    taxRate: Number(s.taxRate ?? 19),
    marginRate: Number(s.marginRate ?? 10),
  };
  writeJson(SETTINGS_FILE, merged);
  audit(req, "settings.save", { keys: Object.keys(merged) });
  res.json({ ok: true });
});

// ===== Logo Upload (ersetzt /public/logo.png) =====
const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PUBLIC_DIR),
  filename: (_req, file, cb) => cb(null, "logo.png"),
});
const uploadLogo = multer({ storage: logoStorage });
app.post("/api/settings/logo", requireCsrf, uploadLogo.single("logo"), (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  audit(req, "logo.upload", { file: "logo.png" });
  res.json({ ok: true, url: "/logo.png" });
});

// ============= KUNDEN =============
const CUSTOMERS_FILE = "customers.json";
const CustomerSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  note: z.string().optional(),
});

app.get("/api/customers", (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(100, Math.max(1, Number(req.query.size || 20)));
  let list = readJson(CUSTOMERS_FILE, []);
  if (q) {
    list = list.filter((c) =>
      [c.name, c.email, c.phone, c.city].some((f) => String(f || "").toLowerCase().includes(q))
    );
  }
  const total = list.length;
  const items = list.slice((page - 1) * size, page * size);
  res.json({ items, total, page, size });
});

app.post("/api/customers", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const list = readJson(CUSTOMERS_FILE, []);
  const parsed = CustomerSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const item = {
    id: uid(),
    ...parsed.data,
    createdAt: Date.now(),
  };
  list.push(item);
  writeJson(CUSTOMERS_FILE, list);
  audit(req, "customer.create", { id: item.id, name: item.name });
  res.json(item);
});

app.put("/api/customers/:id", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const list = readJson(CUSTOMERS_FILE, []);
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });

  const next = { ...list[idx], ...(req.body || {}) };
  const parsed = CustomerSchema.partial().safeParse(next);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  list[idx] = { ...list[idx], ...parsed.data };
  writeJson(CUSTOMERS_FILE, list);
  audit(req, "customer.update", { id });
  res.json({ ok: true });
});

app.delete("/api/customers/:id", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const list = readJson(CUSTOMERS_FILE, []);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Not found" });
  writeJson(CUSTOMERS_FILE, next);
  audit(req, "customer.delete", { id });
  res.json({ ok: true });
});

// CSV-Export
app.get("/api/customers/export.csv", (req, res) => {
  const list = readJson(CUSTOMERS_FILE, []);
  const head = "id;name;email;phone;street;city;note;createdAt\n";
  const rows = list.map((c) => [
    c.id, c.name, c.email || "", c.phone || "", c.street || "", c.city || "", (c.note || "").replace(/\n/g, " "),
    new Date(c.createdAt).toISOString()
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
  const csv = head + rows + "\n";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=customers.csv");
  res.send(csv);
});

// ============= PROJEKTE =============
const PROJECTS_FILE = "projects.json";
const ProjectSchema = z.object({
  title: z.string().min(1),
  customerId: z.string().optional(),
  status: z.enum(["offen", "laufend", "abgeschlossen"]).default("offen"),
  budget: z.number().optional(),
  note: z.string().optional(),
});

app.get("/api/projects", (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const page = Math.max(1, Number(req.query.page || 1));
  const size = Math.min(100, Math.max(1, Number(req.query.size || 20)));
  let list = readJson(PROJECTS_FILE, []);
  if (q) {
    list = list.filter((p) =>
      [p.title, p.status, p.note].some((f) => String(f || "").toLowerCase().includes(q))
    );
  }
  const total = list.length;
  const items = list.slice((page - 1) * size, page * size);
  res.json({ items, total, page, size });
});

app.post("/api/projects", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const list = readJson(PROJECTS_FILE, []);
  const parsed = ProjectSchema.safeParse({
    ...req.body,
    budget: Number(req.body?.budget || 0),
  });
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const item = { id: uid(), ...parsed.data, createdAt: Date.now() };
  list.push(item);
  writeJson(PROJECTS_FILE, list);
  audit(req, "project.create", { id: item.id, title: item.title });
  res.json(item);
});

app.put("/api/projects/:id", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const list = readJson(PROJECTS_FILE, []);
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Not found" });

  const merged = {
    ...list[idx],
    ...req.body,
    budget: Number(req.body?.budget ?? list[idx].budget),
  };
  const parsed = ProjectSchema.partial().safeParse(merged);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  list[idx] = { ...list[idx], ...parsed.data };
  writeJson(PROJECTS_FILE, list);
  audit(req, "project.update", { id });
  res.json({ ok: true });
});

app.delete("/api/projects/:id", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { id } = req.params;
  const list = readJson(PROJECTS_FILE, []);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Not found" });
  writeJson(PROJECTS_FILE, next);
  audit(req, "project.delete", { id });
  res.json({ ok: true });
});

// Projekt-Datei-Uploads
const projectStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(UPLOADS_DIR, "projects")),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\p{L}\p{N}_.\-]+/gu, "-");
    cb(null, Date.now() + "_" + safe);
  },
});
const uploadProjectFile = multer({ storage: projectStorage });
app.post("/api/projects/:id/files", requireCsrf, uploadProjectFile.single("file"), (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  if (!req.file) return res.status(400).json({ error: "No file" });
  const url = "/uploads/projects/" + req.file.filename;
  audit(req, "project.file.upload", { projectId: req.params.id, file: url });
  res.json({ ok: true, url });
});

// ============= ANGEBOT / PDF =============
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

function exportOfferToPDF(offer) {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const safe = (s) =>
    String(s || "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);

  const company = safe(offer?.company?.name || "Firma");
  const customer = safe(offer?.customer?.name || "Kunde");
  const date = new Date().toISOString().slice(0, 10);
  const filename = `Angebot_${company}_${customer}_${date}_${Date.now()}.pdf`; // einzigartig
  const filePath = path.join(GENERATED_DIR, filename);

  const companyName = offer?.company?.name || "Ihr Handwerksbetrieb";
  const customerName = offer?.customer?.name || "Kunde";
  const trade = offer?.trade || "-";
  const today = new Date().toLocaleDateString("de-DE");
  const fmt = (n) => Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  doc.pipe(fs.createWriteStream(filePath));

  // Logo (falls vorhanden)
  const logoPath = path.join(PUBLIC_DIR, "logo.png");
  if (fs.existsSync(logoPath)) {
    try { doc.image(logoPath, 430, 40, { width: 140 }); } catch {}
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

  // Hinweise
  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(11).text("Hinweise / AGB (Kurzfassung)");
  doc.font("Helvetica").fontSize(9).fillColor("#333").text(
    "• Dieses Angebot ist 30 Tage gültig. Alle Preise verstehen sich in EUR zzgl. gesetzlicher MwSt.\n" +
    "• Abweichungen oder Zusatzleistungen werden gesondert berechnet.\n" +
    "• Zahlungsziel: 14 Tage netto ohne Abzug.\n" +
    "• Es gelten unsere allgemeinen Geschäftsbedingungen.",
    { width: 500 }
  );

  // Footer/Seitenzahlen
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor("#6b7280")
      .text(`${companyName} • kontakt@example.com • 01234 / 567890`,
            50, doc.page.height - 60, { width: 500, align: "center" });
    doc.text(`Seite ${i+1} von ${range.count}`,
            50, doc.page.height - 45, { width: 500, align: "right" });
  }

  doc.end();
  audit({ ip: "n/a", session: {} }, "pdf.create", { file: filename });
  return { url: `/generated/${filename}`, filename, absPath: filePath };
}

// PDF: Angebot berechnen
app.post("/api/offers/generate", (req, res) => {
  try {
    const input = offerschemaParse(req.body);
    const offer = generateOffer(input);
    res.json(offer);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PDF: Erzeugen & gespeicherten Pfad zurückgeben
app.post("/api/offers/export-pdf", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { url, filename } = exportOfferToPDF(req.body || {});
    res.json({ ok: true, path: url, filename });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PDF-Center: Liste & Delete & Rename
app.get("/api/pdfs/list", (req, res) => {
  if (!fs.existsSync(GENERATED_DIR)) return res.json({ items: [] });
  try {
    const items = fs.readdirSync(GENERATED_DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((name) => {
        const full = path.join(GENERATED_DIR, name);
        const st = fs.statSync(full);
        return { name, url: `/generated/${name}`, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
app.delete("/api/pdfs", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const name = String(req.query.name || "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return res.status(400).json({ error: "Ungültiger Dateiname" });
  }
  const p = path.join(GENERATED_DIR, name);
  fs.unlink(p, (err) => {
    if (err) return res.status(404).json({ error: "Datei nicht gefunden" });
    audit(req, "pdf.delete", { name });
    res.json({ ok: true });
  });
});
app.post("/api/pdfs/rename", requireCsrf, (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { oldName, newName } = req.body || {};
  const isBad = (n) => !n || /[\/\\]/.test(n) || /\.\./.test(n) || !n.toLowerCase().endsWith(".pdf");
  if (isBad(oldName) || isBad(newName)) return res.status(400).json({ error: "Bad name" });

  const oldP = path.join(GENERATED_DIR, oldName);
  const newP = path.join(GENERATED_DIR, newName);
  if (!fs.existsSync(oldP)) return res.status(404).json({ error: "Not found" });
  fs.renameSync(oldP, newP);
  audit(req, "pdf.rename", { oldName, newName });
  res.json({ ok: true });
});

// PDF per E-Mail senden (Anhang) – optional, nur falls SMTP konfiguriert
app.post("/api/pdfs/send", requireCsrf, async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  const { name, to, subject, text } = req.body || {};
  if (!SMTP.host || !SMTP.user || !SMTP.pass)
    return res.status(501).json({ error: "E-Mail nicht konfiguriert" });

  const absPath = path.join(GENERATED_DIR, String(name || ""));
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "Datei nicht gefunden" });

  const transporter = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });

  try {
    const info = await transporter.sendMail({
      from: SMTP.from,
      to: String(to || ""),
      subject: String(subject || "Angebot"),
      text: String(text || "Guten Tag,\nanbei das Angebot."),
      attachments: [{ filename: String(name), path: absPath }],
    });
    audit(req, "pdf.mail", { to, name });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ============= KI-Parsing (OpenAI) =============
app.post("/api/invoice/parse", async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY fehlt." });

  const { text } = req.body || {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "text (String) wird benötigt." });

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input:
          "Extrahiere strukturierte Angebotspositionen aus folgendem Rechnungstext. " +
          'Gib ein JSON-Objekt im Format {"items":[{"desc","qty","unit","unitPrice"}]} zurück. ' +
          "Zahlen als number; wenn unsicher, vorsichtig schätzen.\n\n" + text,
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

    audit(req, "ai.parse", { items: parsed.items.length });
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ============= BACKUPS (JSON) =============
// Exportiert settings, users, customers, projects als ein JSON-Paket
app.get("/api/backups/export", (req, res) => {
  if (req.session?.user?.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const payload = {
    ts: Date.now(),
    settings: readJson(SETTINGS_FILE, {}),
    users: readJson(USERS_FILE, []),
    customers: readJson(CUSTOMERS_FILE, []),
    projects: readJson(PROJECTS_FILE, []),
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="backup_${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

// Import (überschreibt!)
app.post("/api/backups/import", requireCsrf, (req, res) => {
  if (req.session?.user?.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const b = req.body || {};
  if (!b || typeof b !== "object") return res.status(400).json({ error: "Bad payload" });

  if (b.settings) writeJson(SETTINGS_FILE, b.settings);
  if (Array.isArray(b.users)) writeJson(USERS_FILE, b.users);
  if (Array.isArray(b.customers)) writeJson(CUSTOMERS_FILE, b.customers);
  if (Array.isArray(b.projects)) writeJson(PROJECTS_FILE, b.projects);

  audit(req, "backup.import", { keys: Object.keys(b) });
  res.json({ ok: true });
});

// ============= HEALTH / METRICS =============
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  const ok = fs.existsSync(PUBLIC_DIR) && fs.existsSync(DATA_DIR);
  res.status(ok ? 200 : 500).json({ ok });
});
app.get("/metrics", (_req, res) => {
  const users = readJson(USERS_FILE, []).length;
  const customers = readJson(CUSTOMERS_FILE, []).length;
  const projects = readJson(PROJECTS_FILE, []).length;
  const pdfs = fs.existsSync(GENERATED_DIR)
    ? fs.readdirSync(GENERATED_DIR).filter((f) => f.endsWith(".pdf")).length
    : 0;
  res.json({ users, customers, projects, pdfs, ts: Date.now() });
});

// ============= START & LANDING ============
app.get("/", (req, res) => {
  // Start immer über Login (geschützte Seiten sind via Middleware geschützt)
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
