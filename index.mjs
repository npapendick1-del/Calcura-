import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const UPLOADS = path.join(__dirname, "uploads");
const GENERATED = path.join(__dirname, "generated");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(GENERATED)) fs.mkdirSync(GENERATED, { recursive: true });

app.use("/uploads", express.static(UPLOADS));
app.use("/generated", express.static(GENERATED));

// ---- Validierung & Kalkulation (einfach gehalten)
const OfferSchema = z.object({
  trade: z.enum(["maler","elektro","sanitär","boden","dach"]),
  company: z.object({ name: z.string(), address: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
  customer: z.object({ name: z.string(), address: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }),
  project: z.object({
    title: z.string(),
    description: z.string().optional(),
    rooms: z.array(z.object({ name: z.string(), width_m: z.number(), length_m: z.number(), height_m: z.number().optional() })).optional(),
    materials: z.array(z.object({ name: z.string(), unitPrice: z.number(), quantity: z.number(), unit: z.string() })).optional(),
    notes: z.string().optional()
  }),
  laborRatePerHour: z.number(),
  marginPercentage: z.number().optional(),
  taxRatePercentage: z.number().optional()
});

const r2 = n => Math.round(n*100)/100;

function generateOffer(input){
  const items = [];
  if (input.trade === "maler" && input.project.rooms?.length){
    for (const room of input.project.rooms){
      const h = room.height_m ?? 2.6;
      const wallArea = 2 * (room.width_m + room.length_m) * h;
      const ceilingArea = room.width_m * room.length_m;
      const wallHours = wallArea / 20;
      const ceilingHours = ceilingArea / 25;
      const prepHours = (wallArea + ceilingArea) / 60;
      const hours = wallHours + ceilingHours + prepHours;

      items.push({ description:`Malerarbeiten ${room.name}: Wände & Decke (${r2(wallArea+ceilingArea)} m²)`, quantity:r2(hours), unit:"Std", unitPrice:input.laborRatePerHour, total:r2(hours*input.laborRatePerHour) });
      const paintLiters = (wallArea + ceilingArea) / 8;
      const paintPrice = 6.0;
      items.push({ description:`Material: Qualitätsfarbe (${r2(paintLiters)} l)`, quantity:r2(paintLiters), unit:"l", unitPrice:paintPrice, total:r2(paintLiters*paintPrice) });
    }
  }
  if (input.project.materials){
    for (const m of input.project.materials){
      items.push({ description:`Material: ${m.name}`, quantity:m.quantity, unit:m.unit, unitPrice:m.unitPrice, total:r2(m.unitPrice*m.quantity) });
    }
  }
  const subtotal = r2(items.reduce((s,it)=>s+it.total,0));
  const margin = r2(subtotal * (input.marginPercentage ?? 15) / 100);
  const totalBeforeTax = r2(subtotal + margin);
  const tax = r2(totalBeforeTax * (input.taxRatePercentage ?? 19) / 100);
  const total = r2(totalBeforeTax + tax);
  return { id:`OF-${Date.now()}`, createdAt:new Date().toISOString(), input, items, subtotal, margin, totalBeforeTax, tax, total, currency:"EUR" };
}

function exportOfferToPDF(offer){
  const filePath = path.join(GENERATED, `${offer.id}.pdf`);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text("Angebot", { align: "right" }).moveDown(0.5);
  doc.fontSize(12).text(offer.input.company.name);
  if (offer.input.company.address) doc.text(offer.input.company.address);
  if (offer.input.company.email) doc.text(offer.input.company.email);
  if (offer.input.company.phone) doc.text(offer.input.company.phone);
  doc.moveDown();
  doc.text(`Kunde: ${offer.input.customer.name}`);
  if (offer.input.customer.address) doc.text(offer.input.customer.address);
  doc.moveDown();
  doc.text(`Projekt: ${offer.input.project.title}`);
  if (offer.input.project.description) doc.text(offer.input.project.description);
  doc.moveDown();

  const colX = { desc: 40, qty: 350, unit: 400, price: 460, total: 530 };
  doc.font("Helvetica-Bold");
  doc.text("Beschreibung", colX.desc, doc.y);
  doc.text("Menge", colX.qty, doc.y);
  doc.text("Einheit", colX.unit, doc.y);
  doc.text("Preis", colX.price, doc.y);
  doc.text("Gesamt", colX.total, doc.y);
  doc.font("Helvetica").moveDown(0.5);

  for (const it of offer.items){
    const y = doc.y;
    doc.text(it.description, colX.desc, y, { width: 300 });
    doc.text(String(it.quantity), colX.qty, y);
    doc.text(it.unit, colX.unit, y);
    doc.text(it.unitPrice.toFixed(2) + " €", colX.price, y);
    doc.text(it.total.toFixed(2) + " €", colX.total, y);
    doc.moveDown(0.4);
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
    const input = OfferSchema.parse(req.body);
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
    res.json({ ok: true, path: file.replace(process.cwd(), "") });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Start (Render nutzt $PORT)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`MeisterKI server listening on port ${PORT}`));
