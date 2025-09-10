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
  trade: z.enum(

