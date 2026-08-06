/**
 * Higgsfield API client.
 *
 * IMPORTANT: Higgsfield's API is accessed through multiple surfaces (their
 * own cloud.higgsfield.ai, plus third-party gateways like Segmind/WaveSpeed
 * that wrap the same underlying model with slightly different request
 * shapes). The exact endpoint paths and field names below are my best
 * reconstruction from public documentation, but you should confirm them
 * against your own Higgsfield dashboard/docs once you have API access,
 * since these details can change and vary by plan tier.
 *
 * Everything endpoint/field-related is pulled from env vars or the
 * constants below so you (or a developer) can adjust it in one place
 * without touching the rest of the pipeline.
 */

const fetch = require('node-fetch');

const API_KEY = process.env.HIGGSFIELD_API_KEY;
const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://cloud.higgsfield.ai/api/v1';
const GENERATE_PATH = process.env.HIGGSFIELD_GENERATE_PATH || '/image-to-video';
const STATUS_PATH_BASE = process.env.HIGGSFIELD_STATUS_PATH_BASE || '/image-to-video/';

// Model/quality tier - "dop-preview" balances quality and cost; switch to
// "dop-lite" for cheaper/faster iteration while testing.
const MODEL = process.env.HIGGSFIELD_MODEL || 'dop-preview';

if (!API_KEY) {
  console.warn('[higgsfield] HIGGSFIELD_API_KEY is not set - generation calls will fail.');
}

async function submitImageToVideo({ imageUrl, prompt, motion, motionStrength = 0.6, durationSeconds = 5 }) {
  const payload = {
    model: MODEL,
    image_url: imageUrl,
    prompt,
    motion, // e.g. a preset name from your Higgsfield dashboard's motion library
    motion_strength: motionStrength,
    duration: durationSeconds,
    camera_fixed: false,
  };

  const res = await fetch(`${BASE_URL}${GENERATE_PATH}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield submit failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id || data.request_id || data.job_id;
}

// For doorway transitions we want a clip conditioned on TWO images (the
// outgoing room's last frame and the incoming room's first frame), so the
// generated motion actually bridges between them. Higgsfield's multi-image
// capable models (e.g. their Seedance-class I2V) accept an images_list.
// If your account's available models differ, adjust MODEL_MULTI below.
const MODEL_MULTI = process.env.HIGGSFIELD_MULTI_MODEL || 'seedance-v2.0-i2v';

async function submitTransitionVideo({ imageUrlA, imageUrlB, prompt, durationSeconds = 3 }) {
  const payload = {
    model: MODEL_MULTI,
    images_list: [imageUrlA, imageUrlB],
    prompt,
    duration: durationSeconds,
  };

  const res = await fetch(`${BASE_URL}${GENERATE_PATH}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield transition submit failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.id || data.request_id || data.job_id;
}

async function pollUntilDone(jobId, { timeoutMs = 5 * 60 * 1000, intervalMs = 4000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}${STATUS_PATH_BASE}${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Higgsfield status check failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    const status = data.status || data.state;

    if (status === 'succeeded' || status === 'completed' || status === 'SUCCEED') {
      const videoUrl = data.video_url || data.output?.video_url || data.output?.[0];
      if (!videoUrl) throw new Error('Higgsfield job succeeded but no video_url in response: ' + JSON.stringify(data));
      return videoUrl;
    }
    if (status === 'failed' || status === 'error') {
      throw new Error('Higgsfield job failed: ' + JSON.stringify(data));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Higgsfield job ${jobId} timed out after ${timeoutMs}ms`);
}

module.exports = { submitImageToVideo, submitTransitionVideo, pollUntilDone };
