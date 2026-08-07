require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { createJob, getJob, runPipeline, GENERATED_DIR } = require('./lib/pipeline');

const app = express();
const PORT = process.env.PORT || 3000;
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
 *  - photos: room photo files (multipart), FLATTENED in room order (all of
 *    room 0's angle photos first, then all of room 1's, etc.)
 *  - meta: JSON string with:
 *      - names: [name, ...] aligned with rooms (not photos)
 *      - photoCounts: [count, ...] aligned with rooms - how many of the
 *        flattened photos belong to each room, in order. Used to regroup
 *        the flat photo list back into per-room angle groups.
 *      - roomDurationSeconds, transitionDurationSeconds, roomPrompt,
 *        transitionPrompt (all optional)
 */
app.post('/api/generate', upload.array('photos', 60), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos uploaded' });
    }
    const meta = JSON.parse(req.body.meta || '{}');
    const names = meta.names || [];
    const photoCounts = meta.photoCounts || req.files.map(() => 1); // default: 1 photo per room if not specified

    if (photoCounts.reduce((a, b) => a + b, 0) !== req.files.length) {
      return res.status(400).json({ error: 'photoCounts does not match the number of uploaded photos' });
    }

    const rooms = [];
    let fileCursor = 0;
    photoCounts.forEach((count, roomIdx) => {
      const roomFiles = req.files.slice(fileCursor, fileCursor + count);
      fileCursor += count;
      rooms.push({
        id: roomIdx,
        name: names[roomIdx] || `Room ${roomIdx + 1}`,
        publicImageUrls: roomFiles.map((f) => `${PUBLIC_BASE_URL}/uploads/${path.basename(f.path)}`),
      });
    });

    const jobId = createJob();

    runPipeline(jobId, rooms, {
      publicBaseUrl: PUBLIC_BASE_URL,
      roomDurationSeconds: meta.roomDurationSeconds,
      transitionDurationSeconds: meta.transitionDurationSeconds,
      roomPrompt: meta.roomPrompt,
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
  if (!process.env.HIGGSFIELD_API_KEY || !process.env.HIGGSFIELD_API_SECRET) {
    console.warn('WARNING: HIGGSFIELD_API_KEY and/or HIGGSFIELD_API_SECRET is not set in the environment.');
  }
});
