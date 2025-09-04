import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    const dir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (_req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `photo-${unique}${ext}`);
  }
});
const upload = multer({ storage });

router.post('/:projectId/photos', upload.array('photos', 10), (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  res.json({ ok: true, files: files.map(f => ({ filename: f.filename, path: `/uploads/${f.filename}` })) });
});

router.post('/:projectId/report', (req, res) => {
  const { notes } = req.body as { notes?: string };
  const lines = (notes || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const report = [
    'Baustellenbericht:',
    ...lines.map((l, i) => `${i+1}. ${l}`),
    '',
    'Automatisch erstellt mit MeisterKI (MVP).'
  ].join('\n');
  res.json({ ok: true, report });
});

export default router;
