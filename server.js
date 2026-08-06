require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { createJob, getJob, runPipeline, GENERATED_DIR } = require('./lib/pipeline');

const app = express();
const PORT = process.env.PORT || 3000;
// This must be the server's real public URL once deployed (e.g.
// https://your-app.onrender.com) - Higgsfield needs to fetch images from
// this server over the internet, so it can't be localhost.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(GENERATED_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/generated', express.static(GENERATED_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

/**
 * Accepts:
 *  - photos: room photo files (multipart), in final walkthrough order
 *  - meta: JSON string, array of { name } aligned with the photo order,
 *    plus optional { roomDurationSeconds, transitionDurationSeconds, motionPreset }
 */
app.post('/api/generate', upload.array('photos', 30), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos uploaded' });
    }
    const meta = JSON.parse(req.body.meta || '{}');
    const names = meta.names || req.files.map((f, i) => `Room ${i + 1}`);

    const rooms = req.files.map((file, i) => ({
      id: i,
      name: names[i] || `Room ${i + 1}`,
      localImagePath: file.path,
      publicImageUrl: `${PUBLIC_BASE_URL}/uploads/${path.basename(file.path)}`,
    }));

    const jobId = createJob();

    runPipeline(jobId, rooms, {
      publicBaseUrl: PUBLIC_BASE_URL,
      roomDurationSeconds: meta.roomDurationSeconds,
      transitionDurationSeconds: meta.transitionDurationSeconds,
      motionPreset: meta.motionPreset,
    });

    res.json({ jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Walkthrough backend listening on port ${PORT}`);
  console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
  if (!process.env.HIGGSFIELD_API_KEY) {
    console.warn('WARNING: HIGGSFIELD_API_KEY is not set in the environment.');
  }
});
