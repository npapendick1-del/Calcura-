import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Offer } from '../types.js';

export function exportOfferToPDF(offer: Offer): string {
  const dir = path.join(process.cwd(), 'generated');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${offer.id}.pdf`);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(20).text('Angebot', { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`${offer.input.company.name}`);
  if (offer.input.company.address) doc.text(offer.input.company.address);
  if (offer.input.company.email) doc.text(offer.input.company.email);
  if (offer.input.company.phone) doc.text(offer.input.company.phone);
  doc.moveDown();

  doc.fontSize(12).text(`Kunde: ${offer.input.customer.name}`);
  if (offer.input.customer.address) doc.text(offer.input.customer.address);
  doc.moveDown();
  doc.text(`Projekt: ${offer.input.project.title}`);
  if (offer.input.project.description) doc.text(offer.input.project.description);
  doc.moveDown();

  doc.fontSize(12).text('Positionen', { underline: true });
  doc.moveDown(0.3);

  const colX = { desc: 40, qty: 350, unit: 400, price: 440, total: 520 };
  doc.font('Helvetica-Bold');
  doc.text('Beschreibung', colX.desc, doc.y);
  doc.text('Menge', colX.qty, doc.y);
  doc.text('Einheit', colX.unit, doc.y);
  doc.text('Preis', colX.price, doc.y);
  doc.text('Gesamt', colX.total, doc.y);
  doc.font('Helvetica');
  doc.moveDown(0.5);

  for (const it of offer.items) {
    const y = doc.y;
    doc.text(it.description, colX.desc, y, { width: 300 });
    doc.text(it.quantity.toString(), colX.qty, y);
    doc.text(it.unit, colX.unit, y);
    doc.text(it.unitPrice.toFixed(2) + ' €', colX.price, y);
    doc.text(it.total.toFixed(2) + ' €', colX.total, y);
    doc.moveDown(0.4);
  }

  doc.moveDown();
  doc.text(`Zwischensumme: ${offer.subtotal.toFixed(2)} €`, { align: 'right' });
  doc.text(`Aufschlag (${offer.input.marginPercentage ?? 15}%): ${offer.margin.toFixed(2)} €`, { align: 'right' });
  doc.text(`Summe (netto): ${offer.totalBeforeTax.toFixed(2)} €`, { align: 'right' });
  doc.text(`MwSt (${offer.input.taxRatePercentage ?? 19}%): ${offer.tax.toFixed(2)} €`, { align: 'right' });
  doc.font('Helvetica-Bold').text(`Gesamtsumme: ${offer.total.toFixed(2)} €`, { align: 'right' });
  doc.font('Helvetica');

  doc.moveDown();
  doc.text('Hinweis: Dieses Angebot wurde automatisch mit MeisterKI generiert.', { align: 'left', oblique: true });

  doc.end();
  return filePath;
}
