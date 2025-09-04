import { useState } from 'react'

export default function OfferEditor() {
  const [companyName, setCompanyName] = useState('Malerbetrieb Muster GmbH')
  const [customerName, setCustomerName] = useState('Max Mustermann')
  const [trade, setTrade] = useState<'maler'|'elektro'|'sanitär'|'boden'|'dach'>('maler')
  const [labor, setLabor] = useState(55)
  const [rooms, setRooms] = useState([
    { name: 'Wohnzimmer', width_m: 4, length_m: 5, height_m: 2.6 }
  ])
  const [offer, setOffer] = useState<any | null>(null)

  const addRoom = () => setRooms(r => [...r, { name: 'Neuer Raum', width_m: 3, length_m: 3, height_m: 2.5 }])
  const updateRoom = (i: number, key: string, val: number|string) => {
    setRooms(rs => rs.map((r, idx) => idx===i ? { ...r, [key]: key==='name' ? val : Number(val) } : r))
  }
  const removeRoom = (i: number) => setRooms(rs => rs.filter((_, idx) => idx!==i))

  const generate = async () => {
    const payload = {
      trade,
      company: { name: companyName },
      customer: { name: customerName },
      project: { title: 'Renovierung', rooms },
      laborRatePerHour: Number(labor),
      marginPercentage: 15,
      taxRatePercentage: 19
    }
    const res = await fetch('/api/offers/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    setOffer(data)
    localStorage.setItem('lastOffer', JSON.stringify(data))
  }

  const exportPDF = async () => {
    if (!offer) return
    const res = await fetch('/api/offers/export-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offer)
    })
    const data = await res.json()
    if (data.path) window.open(data.path, '_blank')
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Angebot erstellen</h2>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Gewerk</span>
            <select value={trade} onChange={e => setTrade(e.target.value as any)} className="border rounded px-2 py-1">
              <option value="maler">Maler</option>
              <option value="elektro">Elektro</option>
              <option value="sanitär">Sanitär</option>
              <option value="boden">Boden</option>
              <option value="dach">Dach</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <span className="text-sm">Firma</span>
              <input value={companyName} onChange={e=>setCompanyName(e.target.value)} className="border rounded px-2 py-1"/>
            </label>
            <label className="grid gap-1">
              <span className="text-sm">Kunde</span>
              <input value={customerName} onChange={e=>setCustomerName(e.target.value)} className="border rounded px-2 py-1"/>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-sm">Stundenlohn (€)</span>
            <input type="number" value={labor} onChange={e=>setLabor(Number(e.target.value))} className="border rounded px-2 py-1"/>
          </label>
        </div>

        <h3 className="mt-6 font-semibold">Räume</h3>
        <div className="mt-2 grid gap-3">
          {rooms.map((r, i) => (
            <div key={i} className="border rounded p-3 grid grid-cols-5 gap-2 items-end">
              <input value={r.name} onChange={e=>updateRoom(i,'name',e.target.value)} className="col-span-2 border rounded px-2 py-1"/>
              <input type="number" value={r.width_m} onChange={e=>updateRoom(i,'width_m',e.target.value)} className="border rounded px-2 py-1" placeholder="Breite (m)"/>
              <input type="number" value={r.length_m} onChange={e=>updateRoom(i,'length_m',e.target.value)} className="border rounded px-2 py-1" placeholder="Länge (m)"/>
              <input type="number" value={r.height_m} onChange={e=>updateRoom(i,'height_m',e.target.value)} className="border rounded px-2 py-1" placeholder="Höhe (m)"/>
              <button onClick={()=>removeRoom(i)} className="text-sm text-red-600">Entfernen</button>
            </div>
          ))}
          <button onClick={addRoom} className="btn w-max">+ Raum</button>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={generate} className="btn">Angebot berechnen</button>
          <button onClick={exportPDF} className="btn btn-secondary">PDF exportieren</button>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Vorschau</h2>
        {!offer && <p className="text-gray-500">Noch kein Angebot berechnet.</p>}
        {offer && (
          <div className="text-sm">
            <div className="font-semibold mb-2">Positionen</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1">Beschreibung</th>
                  <th className="py-1">Menge</th>
                  <th className="py-1">Einheit</th>
                  <th className="py-1">Preis</th>
                  <th className="py-1">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {offer.items.map((it:any, idx:number)=>(
                  <tr key={idx} className="border-b">
                    <td className="py-1 pr-2">{it.description}</td>
                    <td className="py-1">{it.quantity}</td>
                    <td className="py-1">{it.unit}</td>
                    <td className="py-1">{it.unitPrice.toFixed(2)} €</td>
                    <td className="py-1">{it.total.toFixed(2)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 text-right">
              <div>Zwischensumme: {offer.subtotal.toFixed(2)} €</div>
              <div>Aufschlag: {offer.margin.toFixed(2)} €</div>
              <div>Netto: {offer.totalBeforeTax.toFixed(2)} €</div>
              <div>MwSt: {offer.tax.toFixed(2)} €</div>
              <div className="font-semibold">Gesamt: {offer.total.toFixed(2)} €</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
