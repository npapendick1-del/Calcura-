import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { z } from "zod";

// --- Setup
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const UPLOADS = path.join(process.cwd(), "uploads");
const GENERATED = path.join(process.cwd(), "generated");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
if (!fs.existsSync(GENERATED)) fs.mkdirSync(GENERATED, { recursive: true });

app.use("/uploads", express.static(UPLOADS));
app.use("/generated", express.static(GENERATED));

// --- Types & simple engine (NICHTS importieren!)
type Trade = "maler" | "elektro" | "sanitär" | "boden" | "dach";
interface OfferItem { description: string; quantity: number; unit: string; unitPrice: number; total: number; }
interface OfferInput {
  trade: Trade;
  company: { name: string; address?: string; email?: string; phone?: string };
  customer: { name: string; address?: string; email?: string; phone?: string };
  project: {
    title: string; description?: string;
    rooms?: { name: string; width_m: number; length_m: number; height_m?: number }[];
    materials?: { name: string; unitPrice: number; quantity: number; unit: string }[];
    notes?: string;
  };
  laborRatePerHour: number;
  marginPercentage?: number;
  taxRatePercentage?: number;
}
interface Offer {
  id: string; createdAt: string; input: OfferInput; items: OfferItem[];
  subtotal: number; margin: number; totalBeforeTax: number; tax: number; total: number; currency: string;
}
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

function round2(n: number) { return Math.round(n * 100) / 100; }

function generateOffer(input: OfferInput): Offer {
  const items: OfferItem[] = [];
  if (input.trade === "maler" && input.project.rooms?.length) {
    for (const room of input.project.rooms) {
      const h = room.height_m ?? 2.6;
      const wallArea = 2 * (room.width_m + room.length_m) * h;
      const ceilingArea = room.width_m * room.length_m;
      const wallHours = wallArea / 20;
      const ceilingHours = ceilingArea / 25;
      const prepHours = (wallArea + ceilingArea) / 60;
      const hours = wallHours + ceilingHours + prepHours;

      items.push({
        description: `Malerarbeiten ${room.name}: Wände & Decke streichen (${round2(wallArea + ceilingArea)} m²)`,
        quantity: round2(hours),
        unit: "Std",
        unitPrice: input.laborRatePerHour,
        total: round2(hours * input.laborRatePerHour),
      });

      const paintLiters = (wallArea + ceilingArea) / 8;
      const paintPrice = 6.0;
      items.push({
        description: `Material: Qualitätsfarbe (${round2(paintLiters)} l)`,
        quantity: round2(paintLiters),
        unit: "l",
        unitPrice: paintPrice,
        total: round2(paintLiters * paintPrice),
      });
    }
  }
  if (input.project.materials) {
    for (const m of input.project.materials) {
      items.push({
        description: `Material: ${m.name}`,
        quantity: m.quantity,
        unit: m.unit,
        unitPrice: m.unitPrice,
        total: round2(m.unitPrice * m.quantity),
      });
    }
  }
  const subtotal = round2(items.reduce((s, it) => s + it.total, 0));
  const marginPct = input.marginPercentage ?? 15;
  const margin = round2((subtotal * marginPct) / 100);
  const totalBeforeTax = round2(subtotal + margin);
  const taxRate = input.taxRatePercentage ?? 19;
  const tax = round2((totalBeforeTax * taxRate) / 100);
  const total = round2(totalBeforeTax + tax);

  return {
    id: `OF-${Date.now()}`,
    createdAt: new Date().toISOString(),
    input, items, subtotal, margin, totalBeforeTax, tax, total, currency: "EUR"
  };
}

function exportOfferToPDF(offer: Offer): string {
  const filePath = path.join(GENERATED, `${offer.id}.pdf`);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(20).text("Angebot", { align: "right" });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`${offer.input.company.name}`);
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

  const colX = { desc: 40, qty: 350, unit: 400, price: 440, total: 520 };
  doc.font("Helvetica-Bold");
  doc.text("Beschreibung", colX.desc, doc.y);
  doc.text("Menge", colX.qty, doc.y);
  doc.text("Einheit", colX.unit, doc.y);
  doc.text("Preis", colX.price, doc.y);
  doc.text("Gesamt", colX.total, doc.y);
  doc.font("Helvetica");
  doc.moveDown(0.5);

  for (const it of offer.items) {
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
  doc.text(`Aufschlag (${offer.input.marginPercentage ?? 15}%): ${offer.margin.toFixed(2)} €`, { align: "right" });
  doc.text(`Summe (netto): ${offer.totalBeforeTax.toFixed(2)} €`, { align: "right" });
  doc.text(`MwSt (${offer.input.taxRatePercentage ?? 19}%): ${offer.tax.toFixed(2)} €`, { align: "right" });
  doc.font("Helvetica-Bold").text(`Gesamtsumme: ${offer.total.toFixed(2)} €`, { align: "right" });
  doc.end();

  return filePath;
}

// --- API
app.post("/api/offers/generate", (req, res) => {
  try {
    const input = OfferSchema.parse(req.body);
    const offer = generateOffer(input);
    res.json(offer);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/offers/export-pdf", (req, res) => {
  try {
    const offer = req.body as Offer;
    const file = exportOfferToPDF(offer);
    res.json({ ok: true, path: file.replace(process.cwd(), "") });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// --- Start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on port ${PORT}`);
});
