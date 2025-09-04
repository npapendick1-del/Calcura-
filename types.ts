export type Trade = 'maler' | 'elektro' | 'sanitär' | 'boden' | 'dach';

export interface OfferItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface OfferInput {
  trade: Trade;
  company: { name: string; address?: string; email?: string; phone?: string };
  customer: { name: string; address?: string; email?: string; phone?: string };
  project: {
    title: string;
    description?: string;
    rooms?: { name: string; width_m: number; length_m: number; height_m?: number }[];
    materials?: { name: string; unitPrice: number; quantity: number; unit: string }[];
    notes?: string;
  };
  laborRatePerHour: number;
  marginPercentage?: number;
  taxRatePercentage?: number;
}

export interface Offer {
  id: string;
  createdAt: string;
  input: OfferInput;
  items: OfferItem[];
  subtotal: number;
  margin: number;
  totalBeforeTax: number;
  tax: number;
  total: number;
  currency: string;
}
