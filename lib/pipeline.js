const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuid } = require('uuid');

const higgsfield = require('./higgsfield');
const ffmpegUtils = require('./ffmpeg');

const GENERATED_DIR = path.join(__dirname, '..', 'generated');

const jobs = new Map();

function createJob() {
  const jobId = uuid();
  jobs.set(jobId, { id: jobId, status: 'queued', stage: '', progress: 0, videoUrl: null, error: null });
  return jobId;
}
function getJob(jobId) { return jobs.get(jobId); }
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
 * rooms: [{ id, name, publicImageUrl }, ...] in final walkthrough order.
 *
 * Each room photo is sent to Higgsfield individually to generate an
 * AI camera-motion clip. The clips are then joined with a local ffmpeg
 * crossfade (not a second Higgsfield call) - Higgsfield's documented API
 * doesn't support two-image-conditioned "bridge" generation, so this is
 * the reliable way to get a smooth join between rooms instead of a hard cut.
 */
async function runPipeline(jobId, rooms, options = {}) {
  const jobDir = path.join(GENERATED_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const roomDuration = options.roomDurationSeconds || 5;
  const transitionDuration = Math.min(options.transitionDurationSeconds || 1, roomDuration - 0.5);
  const roomPrompt = options.roomPrompt ||
    'Smooth drone-style camera glide through the room, gentle forward and slight downward motion, cinematic real estate walkthrough, photorealistic, no distortion';

  try {
    updateJob(jobId, { status: 'running', stage: 'Generating room clips', progress: 5 });

    const totalSteps = rooms.length + 1; // each room's generation + final stitch
    let completedSteps = 0;
    const bump = (stage) => {
      completedSteps += 1;
      updateJob(jobId, { stage, progress: Math.round((completedSteps / totalSteps) * 90) + 5 });
    };

    const roomClipPaths = [];
    for (const room of rooms) {
      updateJob(jobId, { stage: `Generating clip for ${room.name}` });

      const requestId = await higgsfield.submitImageToVideo({
        imageUrls: room.publicImageUrls,
        prompt: roomPrompt,
        durationSeconds: roomDuration,
      });
      const videoUrl = await higgsfield.pollUntilDone(requestId);

      const rawPath = path.join(jobDir, `room_${room.id}_raw.mp4`);
      await downloadToFile(videoUrl, rawPath);

      const normPath = path.join(jobDir, `room_${room.id}.mp4`);
      await ffmpegUtils.normalizeVideo(rawPath, normPath);
      roomClipPaths.push(normPath);
      bump(`Generated clip for ${room.name}`);
    }

    updateJob(jobId, { stage: 'Blending rooms together', progress: 95 });
    const finalPath = path.join(jobDir, 'final.mp4');

    if (roomClipPaths.length === 1) {
      fs.copyFileSync(roomClipPaths[0], finalPath);
    } else {
      await ffmpegUtils.chainXfadeConcat(roomClipPaths, finalPath, { transitionSeconds: transitionDuration });
    }
    bump('Done');

    const finalUrl = `${options.publicBaseUrl}/generated/${jobId}/final.mp4`;
    updateJob(jobId, { status: 'done', stage: 'Done', progress: 100, videoUrl: finalUrl });
  } catch (err) {
    console.error(`[pipeline] job ${jobId} failed:`, err);
    updateJob(jobId, { status: 'error', error: err.message });
  }
}

module.exports = { createJob, getJob, updateJob, runPipeline, GENERATED_DIR };
