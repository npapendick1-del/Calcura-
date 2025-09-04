export default function OfferPreview() {
  const offerRaw = localStorage.getItem('lastOffer')
  const offer = offerRaw ? JSON.parse(offerRaw) : null
  return (
    <div className="card">
      <h2 className="text-lg font-semibold mb-4">Vorschau (letztes Angebot)</h2>
      {!offer && <p className="text-gray-500">Noch kein Angebot vorhanden.</p>}
      {offer && (
        <div className="text-sm">
          <div className="font-semibold mb-2">{offer.input?.project?.title}</div>
          <ul className="list-disc pl-5">
            {offer.items.map((it:any, i:number) => <li key={i}>{it.description} — {it.total.toFixed(2)} €</li>)}
          </ul>
          <div className="mt-3 font-semibold">Gesamt: {offer.total.toFixed(2)} €</div>
        </div>
      )}
    </div>
  )
}
