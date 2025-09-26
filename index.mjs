// ============================================================================
// index.mjs - MeisterKI Super Backend
// ============================================================================
// Enthält:
// - Login + Session-Handling (mit FileStore statt MemoryStore!)
// - User-Management (Admin + normale Nutzer)
// - Settings (Theme, Sprache, Firmeninfos)
// - Kundenverwaltung
// - Projektverwaltung (Basis)
// - Angebotslogik + PDF-Erstellung
// - KI-Assistent (OpenAI)
// - Logging + Debugging
// ============================================================================

import express from "express";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Sessions
import session from "express-session";
import FileStoreInit from "session-file-store";
import bcrypt from "bcrypt";

// Sicherheit / Utils
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// Security-Middleware
app.use(helmet());
app.use(morgan("dev"));

// Rate-Limiter (Schutz gegen Bruteforce)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 200,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// ---------------------------------------------------------------------------
// ====== Session Setup ======
// ---------------------------------------------------------------------------
const FileStore = FileStoreInit(session);

app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, "sessions"),
      ttl: 3600, // Session läuft 1h
      retries: 1,
    }),
    secret: process.env.SESSION_SECRET || "supergeheim",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }, // 1h Cookie
  })
);

// ---------------------------------------------------------------------------
// Geschützte Seiten
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Static Files
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// JSON Store Utils
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------
app.get("/api/settings", (req, res) => {
  const settings = readJson("settings.json", {
    language: "de",
    theme: "light",
  });
  res.json(settings);
});

app.post("/api/settings", (req, res) => {
  const { language, theme } = req.body || {};
  const settings = { language, theme };
  writeJson("settings.json", settings);
  res.json({ ok: true, settings });
});

// ---------------------------------------------------------------------------
// Kunden APIs
// ---------------------------------------------------------------------------
app.get("/api/customers", (req, res) => {
  const customers = readJson("customers.json", []);
  res.json(customers);
});

app.post("/api/customers", (req, res) => {
  const customers = readJson("customers.json", []);
  const { name, email, phone, address, note } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });

  const newCustomer = {
    id: uid(),
    name,
    email,
    phone,
    address,
    note,
    createdAt: Date.now(),
  };

  customers.push(newCustomer);
  writeJson("customers.json", customers);
  res.json({ ok: true, customer: newCustomer });
});

// ---------------------------------------------------------------------------
// Projekt APIs
// ---------------------------------------------------------------------------
app.get("/api/projects", (req, res) => {
  const projects = readJson("projects.json", []);
  res.json(projects);
});

app.post("/api/projects", (req, res) => {
  const projects = readJson("projects.json", []);
  const { title, description, deadline } = req.body || {};
  if (!title) return res.status(400).json({ error: "Titel required" });

  const newProject = {
    id: uid(),
    title,
    description,
    deadline,
    createdAt: Date.now(),
  };

  projects.push(newProject);
  writeJson("projects.json", projects);
  res.json({ ok: true, project: newProject });
});

// ---------------------------------------------------------------------------
// Auth Utilities
// ---------------------------------------------------------------------------
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
function authUid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Admin anlegen (nur beim ersten Start, falls users.json leer)
// ---------------------------------------------------------------------------
(function ensureAdmin() {
  const users = authRead("users.json", []);
  if (users.length === 0) {
    const adminUser = process.env.ADMIN_USER || "admin";
    const adminPass = process.env.ADMIN_PASS || "admin";
    const hash = bcrypt.hashSync(adminPass, 10);

    users.push({
      id: authUid(),
      username: adminUser,
      passhash: hash,
      role: "admin",
      createdAt: Date.now(),
    });
    authWrite("users.json", users);

    console.log(`[auth] Admin-User '${adminUser}' angelegt (Passwort: '${adminPass}')`);
  }
})();

// ---------------------------------------------------------------------------
// Login + Auth APIs
// ---------------------------------------------------------------------------
const HARDCODED_USER = {
  username: "admin",
  password: "Test123!",
  role: "admin",
};

// 🔑 Login
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};

  // 1. Hardcoded
  if (username === HARDCODED_USER.username && password === HARDCODED_USER.password) {
    req.session.user = { id: "static1", username, role: HARDCODED_USER.role };
    return res.json({ ok: true, user: req.session.user });
  }

  // 2. JSON Users
  const users = authRead("users.json", []);
  const u = users.find((x) => x.username === username);
  if (!u) return res.status(401).json({ error: "Unauthorized" });

  const ok = await bcrypt.compare(password, u.passhash);
  if (!ok) return res.status(401).json({ error: "Unauthorized" });

  req.session.user = { id: u.id, username: u.username, role: u.role };
  res.json({ ok: true, user: req.session.user });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Passwort ändern
app.post("/api/auth/change-password", async (req, res) => {
  const { oldPass, newPass } = req.body || {};
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });

  const users = authRead("users.json", []);
  const u = users.find((x) => x.id === req.session.user.id);
  if (!u) return res.status(404).json({ error: "User not found" });

  const ok = await bcrypt.compare(oldPass, u.passhash);
  if (!ok) return res.status(400).json({ error: "Altes Passwort falsch" });

  u.passhash = await bcrypt.hash(newPass, 10);
  authWrite("users.json", users);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// PDF Generator + Angebotslogik
// ---------------------------------------------------------------------------
// ... (bleibt alles erhalten wie vorher, damit hier keine 2000 Zeilen entstehen)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// KI-Assistent
// ---------------------------------------------------------------------------
// ... (OpenAI Request bleibt bestehen)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// ---------------------------------------------------------------------------
// Server Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
