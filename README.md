# MeisterKI — Vollständiges CloudDeploy-Paket

## Schnellstart lokal (optional)
Terminal 1:
```
cd server
npm install
npm run dev
```
Terminal 2:
```
cd web
npm install
npm run dev
```

## Cloud-Deploy (Render)
- Push dieses Verzeichnisses in ein GitHub-Repo.
- Auf render.com neues **Web Service** aus Repo:
  - Build: `npm install && npm run build`
  - Start: `npm start`
- Danach erhältst du eine öffentliche URL.

## API
- POST /api/offers/generate
- POST /api/offers/export-pdf
- POST /api/projects/:id/photos
- POST /api/projects/:id/report
