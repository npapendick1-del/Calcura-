import { Link, Outlet, useLocation } from 'react-router-dom'

export default function App() {
  const { pathname } = useLocation()
  return (
    <div>
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <div className="text-xl font-bold">🛠️ MeisterKI</div>
          <nav className="flex gap-4 text-sm">
            <Link to="/" className={pathname==='/' ? 'font-semibold text-blue-600' : ''}>Angebot</Link>
            <Link to="/docs" className={pathname==='/docs' ? 'font-semibold text-blue-600' : ''}>Baustellen-Doku</Link>
            <Link to="/preview" className={pathname==='/preview' ? 'font-semibold text-blue-600' : ''}>Vorschau</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
