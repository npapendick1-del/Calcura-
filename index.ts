import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import offersRouter from './routes/offers.js';
import projectsRouter from './routes/projects.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static for uploaded images and generated PDFs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/generated', express.static(path.join(__dirname, '..', 'generated')));

app.use('/api/offers', offersRouter);
app.use('/api/projects', projectsRouter);

// Serve built frontend if available
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(webDist));
app.get('*', (_req, res) => {
  try {
    res.sendFile(path.join(webDist, 'index.html'));
  } catch {
    res.status(200).send('API is running.');
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`MeisterKI server listening on http://localhost:${PORT}`);
});
