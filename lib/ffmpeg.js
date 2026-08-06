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

async function extractFrame(videoPath, outPath, timestampSeconds = 0) {
  await run('ffmpeg', ['-y', '-ss', String(timestampSeconds), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath]);
  return outPath;
}

async function extractLastFrame(videoPath, outPath, durationSeconds) {
  const seekTo = Math.max(0, durationSeconds - 0.1);
  return extractFrame(videoPath, outPath, seekTo);
}

/** Concatenates a list of same-codec video files into one output file. */
async function concatVideos(videoPaths, outPath, workDir) {
  const listPath = path.join(workDir, 'concat_list.txt');
  const listContent = videoPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(listPath, listContent);
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
  return outPath;
}

/** Re-encodes to a consistent codec/resolution/fps so generated clips concatenate cleanly. */
async function normalizeVideo(inPath, outPath, { width = 1280, height = 720, fps = 30 } = {}) {
  await run('ffmpeg', [
    '-y', '-i', inPath,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an',
    outPath,
  ]);
  return outPath;
}

/** Builds a short crossfade transition clip between the end of clip A and
 * the start of clip B, using ffmpeg's xfade filter. This replaces calling
 * Higgsfield for the doorway transition, since two-image-conditioned
 * generation isn't a documented capability of their API - this is a
 * reliable local alternative that still gives a smooth blend between the
 * two AI-generated room clips. */
async function crossfadeTransition(clipAPath, clipBPath, outPath, { durationSeconds = 1, fps = 30 } = {}) {
  await run('ffmpeg', [
    '-y',
    '-i', clipAPath,
    '-i', clipBPath,
    '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${durationSeconds}:offset=0[v]`,
    '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    outPath,
  ]);
  return outPath;
}

async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(parseFloat(out.trim()));
      else reject(new Error('ffprobe failed to read duration'));
    });
  });
}

module.exports = { extractFrame, extractLastFrame, concatVideos, normalizeVideo, crossfadeTransition, getVideoDuration };

module.exports.chainXfadeConcat = async function chainXfadeConcat(clipPaths, outPath, { transitionSeconds = 1 } = {}) {
  const durations = [];
  for (const p of clipPaths) durations.push(await module.exports.getVideoDuration(p));

  const inputArgs = [];
  clipPaths.forEach((p) => { inputArgs.push('-i', p); });

  let filter = '';
  let cumulative = durations[0];
  let lastLabel = '0:v';
  for (let i = 1; i < clipPaths.length; i++) {
    const t = Math.min(transitionSeconds, durations[i - 1], durations[i]);
    const offset = Math.max(0, cumulative - t);
    const outLabel = `v${i}`;
    filter += `[${lastLabel}][${i}:v]xfade=transition=fade:duration=${t}:offset=${offset}[${outLabel}];`;
    lastLabel = outLabel;
    cumulative = cumulative + durations[i] - t;
  }
  filter = filter.slice(0, -1);

  await run('ffmpeg', ['-y', ...inputArgs, '-filter_complex', filter, '-map', `[${lastLabel}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', outPath]);
  return outPath;
};
