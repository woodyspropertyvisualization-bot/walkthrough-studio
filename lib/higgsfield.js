/**
 * Higgsfield API client - matches the official documented API at
 * https://platform.higgsfield.ai (confirmed against real docs, not guessed).
 *
 * Auth: Higgsfield requires BOTH an API key and an API secret, joined with
 * a colon: "Authorization: Key {api_key}:{api_key_secret}". Get both from
 * your Higgsfield Cloud dashboard's API Keys page.
 */
 
const fetch = require('node-fetch');
 
const API_KEY = process.env.HIGGSFIELD_API_KEY;
const API_SECRET = process.env.HIGGSFIELD_API_SECRET;
const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai';
 
// Confirmed via Higgsfield's official Node SDK README (higgsfield-ai/higgsfield-js):
// the image-to-video endpoint is /v1/image2video/dop and takes input_images as
// a LIST - this is what lets us send multiple angle photos of the same room
// for one generation, instead of just a single image_url.
const MODEL = process.env.HIGGSFIELD_MODEL || 'dop-standard';
 
if (!API_KEY || !API_SECRET) {
  console.warn('[higgsfield] HIGGSFIELD_API_KEY and/or HIGGSFIELD_API_SECRET is not set - generation calls will fail.');
}
 
function authHeader() {
  return `Key ${API_KEY}:${API_SECRET}`;
}
 
async function submitImageToVideo({ imageUrls, prompt, durationSeconds = 5 }) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  const payload = {
    params: {
      model: MODEL,
      prompt,
      duration: durationSeconds,
      input_images: urls.map((url) => ({ type: 'image_url', image_url: url })),
    },
  };
 
  const res = await fetch(`${BASE_URL}/v1/image2video/dop`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
 
  const data = await res.json().catch(() => ({}));
  console.log('[higgsfield] submit response:', res.status, JSON.stringify(data));
  if (!res.ok) {
    throw new Error(`Higgsfield submit failed (${res.status}): ${JSON.stringify(data)}`);
  }
  if (!data.request_id) {
    throw new Error(`Higgsfield submit succeeded but no request_id in response: ${JSON.stringify(data)}`);
  }
  return data.request_id;
}
 
async function pollUntilDone(requestId, { timeoutMs = 15 * 60 * 1000, intervalMs = 5000 } = {}) {
  const start = Date.now();
  let pollCount = 0;
  while (Date.now() - start < timeoutMs) {
    pollCount += 1;
    const res = await fetch(`${BASE_URL}/requests/${requestId}/status`, {
      headers: { 'Authorization': authHeader(), 'Accept': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[higgsfield] poll #${pollCount} for ${requestId}:`, res.status, JSON.stringify(data));
    if (!res.ok) {
      throw new Error(`Higgsfield status check failed (${res.status}): ${JSON.stringify(data)}`);
    }
 
    if (data.status === 'completed') {
      const videoUrl = data.video && data.video.url;
      if (!videoUrl) throw new Error('Higgsfield job completed but no video.url in response: ' + JSON.stringify(data));
      return videoUrl;
    }
    if (data.status === 'failed') {
      throw new Error('Higgsfield generation failed: ' + JSON.stringify(data));
    }
    if (data.status === 'nsfw') {
      throw new Error('Higgsfield flagged this image/prompt as NSFW and refunded credits - try a different photo or prompt: ' + JSON.stringify(data));
    }
    // "queued" or "in_progress" - keep polling
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Higgsfield request ${requestId} timed out after ${timeoutMs}ms`);
}
 
module.exports = { submitImageToVideo, pollUntilDone };
