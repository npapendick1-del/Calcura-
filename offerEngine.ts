import { Offer, OfferInput, OfferItem } from '../types.js';

function round2(n: number) { return Math.round(n * 100) / 100; }

export function generateOfferFromInput(input: OfferInput): Offer {
  const items: OfferItem[] = [];
  const currency = 'EUR';

  if (input.trade === 'maler' && input.project.rooms && input.project.rooms.length > 0) {
    for (const room of input.project.rooms) {
      const h = room.height_m ?? 2.6;
      const wallArea = 2 * (room.width_m + room.length_m) * h;
      const ceilingArea = room.width_m * room.length_m;
      const wallHours = wallArea / 20;
      const ceilingHours = ceilingArea / 25;
      const prepHours = (wallArea + ceilingArea) / 60;
      const hours = wallHours + ceilingHours + prepHours;

      items.push({
        description: `Malerarbeiten ${room.name}: Wände & Decke streichen (${round2(wallArea+ceilingArea)} m²)`,
        quantity: round2(hours),
        unit: 'Std',
        unitPrice: input.laborRatePerHour,
        total: round2(hours * input.laborRatePerHour)
      });

      const paintLiters = (wallArea + ceilingArea) / 8;
      const paintPrice = 6.0;
      items.push({
        description: `Material: Qualitätsfarbe (${round2(paintLiters)} l)`,
        quantity: round2(paintLiters),
        unit: 'l',
        unitPrice: paintPrice,
        total: round2(paintLiters * paintPrice)
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
        total: round2(m.unitPrice * m.quantity)
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

  const id = `OF-${Date.now()}`;
  return {
    id,
    createdAt: new Date().toISOString(),
    input,
    items,
    subtotal,
    margin,
    totalBeforeTax,
    tax,
    total,
    currency
  };
}
