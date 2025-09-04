import { useState } from 'react'

export default function ProjectDocs() {
  const [files, setFiles] = useState<FileList | null>(null)
  const [uploaded, setUploaded] = useState<any[]>([])
  const [notes, setNotes] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('PRJ-1')

  const upload = async () => {
    if (!files) return
    const fd = new FormData()
    Array.from(files).forEach(f => fd.append('photos', f))
    const res = await fetch(`/api/projects/${projectId}/photos`, { method: 'POST', body: fd })
    const data = await res.json()
    setUploaded(data.files || [])
  }

  const generateReport = async () => {
    const res = await fetch(`/api/projects/${projectId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    })
    const data = await res.json()
    setReport(data.report)
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Baustellen-Dokumentation</h2>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm">Projekt-ID</span>
            <input value={projectId} onChange={e=>setProjectId(e.target.value)} className="border rounded px-2 py-1"/>
          </label>
          <label className="grid gap-1">
            <span className="text-sm">Fotos</span>
            <input type="file" multiple accept="image/*" onChange={e=>setFiles(e.target.files)} />
          </label>
          <button className="btn w-max" onClick={upload}>Hochladen</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {uploaded.map((u, i) => (
            <img key={i} src={u.path} alt="upload" className="w-full h-24 object-cover rounded border" />
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Notizen & Bericht</h2>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} className="w-full h-40 border rounded p-2" placeholder="- Material geliefert\n- Untergrund gespachtelt\n- 1. Anstrich erledigt"/>
        <div className="mt-3">
          <button onClick={generateReport} className="btn">Bericht erzeugen</button>
        </div>
        {report && (
          <pre className="mt-4 bg-gray-50 p-3 rounded border whitespace-pre-wrap">{report}</pre>
        )}
      </div>
    </div>
  )
}
