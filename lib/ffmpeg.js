const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
    });
  });
}

/** Extracts a single frame (as jpg) from a video file, near the given timestamp. */
async function extractFrame(videoPath, outPath, timestampSeconds = 0) {
  await run('ffmpeg', [
    '-y',
    '-ss', String(timestampSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ]);
  return outPath;
}

/** Extracts the last frame of a video (approximated by seeking near the end). */
async function extractLastFrame(videoPath, outPath, durationSeconds) {
  const seekTo = Math.max(0, durationSeconds - 0.1);
  return extractFrame(videoPath, outPath, seekTo);
}

/** Concatenates a list of video files (same codec/resolution expected) into one output file. */
async function concatVideos(videoPaths, outPath, workDir) {
  const listPath = path.join(workDir, 'concat_list.txt');
  const listContent = videoPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  await run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outPath,
  ]);
  return outPath;
}

/** Re-encodes a video to a consistent codec/resolution/fps so clips from
 * different generations concatenate cleanly (generated clips can otherwise
 * have mismatched encodings that break stream-copy concatenation). */
async function normalizeVideo(inPath, outPath, { width = 1280, height = 720, fps = 30 } = {}) {
  await run('ffmpeg', [
    '-y',
    '-i', inPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-an',
    outPath,
  ]);
  return outPath;
}

async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(parseFloat(out.trim()));
      else reject(new Error('ffprobe failed to read duration'));
    });
  });
}

module.exports = { extractFrame, extractLastFrame, concatVideos, normalizeVideo, getVideoDuration };
