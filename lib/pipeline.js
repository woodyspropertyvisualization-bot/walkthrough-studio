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
 * rooms: [{ id, name, publicImageUrls: [url, ...] }, ...] in final
 * walkthrough order. publicImageUrls can have more than one entry when the
 * user added multiple angles of the same room.
 *
 * Confirmed via real API responses from both Higgsfield and Runway: neither
 * provider's image-to-video endpoint actually blends multiple photos into
 * one smarter generation - each generation only meaningfully uses one
 * image. So instead of faking that, this pipeline generates ONE clip PER
 * PHOTO (every angle of every room becomes its own real AI-generated clip),
 * then crossfades ALL of them together in order - across rooms AND across
 * angles within a room - using the same proven ffmpeg technique. A 3-angle
 * room shows all 3 angles in smooth sequence rather than one blended
 * understanding of the space, which is what's actually achievable today.
 */
async function runPipeline(jobId, rooms, options = {}) {
  const jobDir = path.join(GENERATED_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
 
  const roomDuration = options.roomDurationSeconds || 5;
  const transitionDuration = Math.min(options.transitionDurationSeconds || 1, roomDuration - 0.5);
  const roomPrompt = options.roomPrompt ||
    'Smooth drone-style camera glide through the room, gentle forward and slight downward motion, cinematic real estate walkthrough, photorealistic, no distortion';
 
  try {
    // Flatten rooms -> individual (room, imageUrl, angleIndex) generation units,
    // preserving room order and angle order within each room.
    const units = [];
    rooms.forEach((room) => {
      room.publicImageUrls.forEach((url, angleIdx) => {
        units.push({ room, url, angleIdx, clipId: `${room.id}_${angleIdx}` });
      });
    });
 
    updateJob(jobId, { status: 'running', stage: 'Generating clips', progress: 5 });
 
    const totalSteps = units.length + 1; // each photo's generation + final stitch
    let completedSteps = 0;
    const bump = (stage) => {
      completedSteps += 1;
      updateJob(jobId, { stage, progress: Math.round((completedSteps / totalSteps) * 90) + 5 });
    };
 
    const clipPaths = [];
    for (const unit of units) {
      const label = unit.room.publicImageUrls.length > 1
        ? `${unit.room.name} (angle ${unit.angleIdx + 1}/${unit.room.publicImageUrls.length})`
        : unit.room.name;
      updateJob(jobId, { stage: `Generating clip for ${label}` });
 
      const requestId = await higgsfield.submitImageToVideo({
        imageUrls: unit.url,
        prompt: roomPrompt,
        durationSeconds: roomDuration,
      });
      const videoUrl = await higgsfield.pollUntilDone(requestId);
 
      const rawPath = path.join(jobDir, `clip_${unit.clipId}_raw.mp4`);
      await downloadToFile(videoUrl, rawPath);
 
      const normPath = path.join(jobDir, `clip_${unit.clipId}.mp4`);
      await ffmpegUtils.normalizeVideo(rawPath, normPath);
      clipPaths.push(normPath);
      bump(`Generated clip for ${label}`);
    }
 
    updateJob(jobId, { stage: 'Blending everything together', progress: 95 });
    const finalPath = path.join(jobDir, 'final.mp4');
 
    if (clipPaths.length === 1) {
      fs.copyFileSync(clipPaths[0], finalPath);
    } else {
      await ffmpegUtils.chainXfadeConcat(clipPaths, finalPath, { transitionSeconds: transitionDuration });
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
