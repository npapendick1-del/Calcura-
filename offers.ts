import { Router } from 'express';
import { z } from 'zod';
import { generateOfferFromInput } from '../services/offerEngine.js';
import { exportOfferToPDF } from '../services/pdf.js';
import { OfferInput } from '../types.js';

const router = Router();

const OfferSchema = z.object({
  trade: z.enum(['maler', 'elektro', 'sanitär', 'boden', 'dach']),
  company: z.object({
    name: z.string(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional()
  }),
  customer: z.object({
    name: z.string(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional()
  }),
  project: z.object({
    title: z.string(),
    description: z.string().optional(),
    rooms: z.array(z.object({
      name: z.string(),
      width_m: z.number(),
      length_m: z.number(),
      height_m: z.number().optional()
    })).optional(),
    materials: z.array(z.object({
      name: z.string(),
      unitPrice: z.number(),
      quantity: z.number(),
      unit: z.string()
    })).optional(),
    notes: z.string().optional()
  }),
  laborRatePerHour: z.number(),
  marginPercentage: z.number().optional(),
  taxRatePercentage: z.number().optional()
});

router.post('/generate', (req, res) => {
  try {
    const parsed: OfferInput = OfferSchema.parse(req.body);
    const offer = generateOfferFromInput(parsed);
    res.json(offer);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/export-pdf', (req, res) => {
  try {
    const offer = req.body;
    const file = exportOfferToPDF(offer);
    const publicPath = file.replace(process.cwd(), '');
    res.json({ ok: true, path: publicPath });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
