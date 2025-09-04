import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import App from './App'
import OfferEditor from './pages/OfferEditor'
import ProjectDocs from './pages/ProjectDocs'
import OfferPreview from './pages/OfferPreview'

const router = createBrowserRouter([
  { path: '/', element: <App />,
    children: [
      { index: true, element: <OfferEditor /> },
      { path: 'docs', element: <ProjectDocs /> },
      { path: 'preview', element: <OfferPreview /> },
    ]
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
