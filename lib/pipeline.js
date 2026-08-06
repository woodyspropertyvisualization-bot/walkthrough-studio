const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuid } = require('uuid');

const higgsfield = require('./higgsfield');
const ffmpegUtils = require('./ffmpeg');

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

// In-memory job store. Fine for a single-instance deployment; if you ever
// run multiple server instances behind a load balancer, swap this for a
// shared store (e.g. Redis) so status checks hit the right instance.
const jobs = new Map();

function createJob() {
  const jobId = uuid();
  jobs.set(jobId, {
    id: jobId,
    status: 'queued', // queued | running | done | error
    stage: '',
    progress: 0,
    videoUrl: null,
    error: null,
  });
  return jobId;
}

function getJob(jobId) {
  return jobs.get(jobId);
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch);
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = await res.buffer();
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

/**
 * rooms: [{ name, publicImageUrl, localImagePath }, ...] in final walkthrough order
 * publicBaseUrl: the server's own publicly reachable URL, so Higgsfield can fetch
 *   uploaded photos and intermediate frames back from this server.
 */
async function runPipeline(jobId, rooms, options = {}) {
  const jobDir = path.join(GENERATED_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const roomDuration = options.roomDurationSeconds || 5;
  const transitionDuration = options.transitionDurationSeconds || 3;
  const roomPrompt = options.roomPrompt ||
    'Smooth drone-style camera glide through the room, gentle forward and slight downward motion, cinematic real estate walkthrough, photorealistic, no distortion';
  const transitionPrompt = options.transitionPrompt ||
    'Camera smoothly continues moving forward through the doorway from one room into the next, seamless continuous motion, cinematic real estate walkthrough';

  try {
    updateJob(jobId, { status: 'running', stage: 'Generating room clips', progress: 5 });

    const totalSteps = rooms.length + Math.max(0, rooms.length - 1) + 1; // rooms + transitions + final stitch
    let completedSteps = 0;
    const bump = (stage) => {
      completedSteps += 1;
      updateJob(jobId, { stage, progress: Math.round((completedSteps / totalSteps) * 90) + 5 });
    };

    // 1. Generate each room's clip
    const roomClipPaths = [];
    for (const room of rooms) {
      const jobRef = await higgsfield.submitImageToVideo({
        imageUrl: room.publicImageUrl,
        prompt: roomPrompt,
        motion: options.motionPreset, // optional - a preset name from your Higgsfield dashboard
        durationSeconds: roomDuration,
      });
      const videoUrl = await higgsfield.pollUntilDone(jobRef);
      const rawPath = path.join(jobDir, `room_${room.id}_raw.mp4`);
      await downloadToFile(videoUrl, rawPath);

      const normPath = path.join(jobDir, `room_${room.id}.mp4`);
      await ffmpegUtils.normalizeVideo(rawPath, normPath);
      roomClipPaths.push({ room, path: normPath });
      bump(`Generated clip for ${room.name}`);
    }

    // 2. Generate each doorway transition, bridging last frame of room i
    //    with the original photo of room i+1 (which is what room i+1's
    //    clip visually starts from).
    const transitionPaths = [];
    for (let i = 0; i < roomClipPaths.length - 1; i++) {
      const a = roomClipPaths[i];
      const bRoom = rooms[i + 1];

      const duration = await ffmpegUtils.getVideoDuration(a.path);
      const lastFramePath = path.join(jobDir, `frame_${a.room.id}_last.jpg`);
      await ffmpegUtils.extractLastFrame(a.path, lastFramePath, duration);

      // Higgsfield needs a URL it can fetch, not a local path - these are
      // served by this same server (see server.js static route).
      const lastFrameUrl = `${options.publicBaseUrl}/generated/${jobId}/${path.basename(lastFramePath)}`;

      const jobRef = await higgsfield.submitTransitionVideo({
        imageUrlA: lastFrameUrl,
        imageUrlB: bRoom.publicImageUrl,
        prompt: transitionPrompt,
        durationSeconds: transitionDuration,
      });
      const videoUrl = await higgsfield.pollUntilDone(jobRef);
      const rawPath = path.join(jobDir, `trans_${i}_raw.mp4`);
      await downloadToFile(videoUrl, rawPath);

      const normPath = path.join(jobDir, `trans_${i}.mp4`);
      await ffmpegUtils.normalizeVideo(rawPath, normPath);
      transitionPaths.push(normPath);
      bump(`Generated transition ${i + 1} of ${roomClipPaths.length - 1}`);
    }

    // 3. Interleave room clips and transitions, then stitch
    updateJob(jobId, { stage: 'Stitching final video', progress: 95 });
    const sequence = [];
    roomClipPaths.forEach((r, i) => {
      sequence.push(r.path);
      if (transitionPaths[i]) sequence.push(transitionPaths[i]);
    });

    const finalPath = path.join(jobDir, 'final.mp4');
    await ffmpegUtils.concatVideos(sequence, finalPath, jobDir);
    bump('Done');

    const finalUrl = `${options.publicBaseUrl}/generated/${jobId}/final.mp4`;
    updateJob(jobId, { status: 'done', stage: 'Done', progress: 100, videoUrl: finalUrl });
  } catch (err) {
    console.error(`[pipeline] job ${jobId} failed:`, err);
    updateJob(jobId, { status: 'error', error: err.message });
  }
}

module.exports = { createJob, getJob, updateJob, runPipeline, GENERATED_DIR };
