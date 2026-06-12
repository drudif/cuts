const express  = require("express");
const multer   = require("multer");
const { ZipArchive } = require("archiver");
const { execFile } = require("child_process");
const path  = require("path");
const fs    = require("fs");
const os    = require("os");

const app    = express();
const upload = multer({ dest: os.tmpdir() });

const SOUNDS_DIR = path.join(__dirname, "sounds");

app.use(express.static("public"));
app.use("/sounds", express.static(SOUNDS_DIR));

// ─── helpers ────────────────────────────────────────────────────────────────

function probe(inputPath) {
  return new Promise((resolve, reject) => {
    execFile("ffprobe", [
      "-v", "quiet", "-print_format", "json",
      "-show_streams", "-show_format", inputPath
    ], (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 100 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

function transcribe(filePath) {
  return new Promise((resolve, reject) => {
    execFile("python3", [
      path.join(__dirname, "transcribe.py"), filePath
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout.trim());
        if (data.error) return reject(new Error(data.error));
        resolve(data);
      } catch (e) { reject(e); }
    });
  });
}

/** Normalise a string the same way transcribe.py does */
function normalize(str) {
  return str.toLowerCase().replace(/[^\w\s]/g, "").trim();
}

/**
 * Given an array of { start, end } intervals,
 * merge any that overlap or are within `gap` seconds of each other.
 */
function mergeIntervals(intervals, gap = 0) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end + gap) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/**
 * Find all occurrences of a search phrase (space-separated words)
 * in the word-list returned by transcribe.py.
 * Returns array of { start, end, phrase }.
 */
function findPhrase(wordList, phrase) {
  const terms  = phrase.split(/\s+/).map(normalize).filter(Boolean);
  const n      = terms.length;
  const hits   = [];

  for (let i = 0; i <= wordList.length - n; i++) {
    const match = terms.every((t, j) => {
      const w = wordList[i + j];
      return w && (w.segment ? w.word.includes(t) : w.word === t);
    });
    if (match) {
      hits.push({ start: wordList[i].start, end: wordList[i + n - 1].end, phrase });
    }
  }
  return hits;
}

/** Sanitise a phrase into a safe filename slug */
function slugify(phrase) {
  return phrase.trim().toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w-]/g, "")
    .slice(0, 60) || "corte";
}

/**
 * Runs ffmpeg silencedetect and returns array of { start, end } silence intervals.
 * Always resolves — parse failures return empty array.
 */
function detectSilences(inputPath) {
  return new Promise((resolve) => {
    execFile("ffmpeg", [
      "-i", inputPath,
      "-af", "silencedetect=noise=-30dB:d=0.3",
      "-f", "null", "-"
    ], { maxBuffer: 10 * 1024 * 1024 }, (_err, _stdout, stderr) => {
      const starts = [], ends = [];
      const startRe = /silence_start:\s*([\d.e+\-]+)/g;
      const endRe   = /silence_end:\s*([\d.e+\-]+)/g;
      let m;
      while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
      while ((m = endRe.exec(stderr))   !== null) ends.push(parseFloat(m[1]));
      const silences = [];
      for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
        silences.push({ start: starts[i], end: ends[i] });
      }
      resolve(silences);
    });
  });
}

/**
 * Inverts silence intervals into keep (non-silent) segments.
 * Always returns at least one segment covering the full duration.
 */
function computeKeepSegments(silences, duration) {
  const segments = [];
  let cursor = 0;
  for (const { start, end } of silences) {
    if (start > cursor + 0.01) segments.push({ start: cursor, end: start });
    cursor = end;
  }
  if (cursor < duration - 0.01) segments.push({ start: cursor, end: duration });
  if (!segments.length) segments.push({ start: 0, end: duration });
  return segments;
}

// ─── route: speed up ────────────────────────────────────────────────────────

app.post("/process", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const speed = parseFloat(req.body.speed);
  if (![1.25, 1.5, 1.75, 2].includes(speed))
    return res.status(400).json({ error: "Velocidade inválida." });

  const inputPath  = req.file.path;
  const ext        = path.extname(req.file.originalname) || ".mp4";
  const outputPath = path.join(os.tmpdir(), `output_${Date.now()}${ext}`);
  const outputName = `${path.basename(req.file.originalname, ext)}_${speed}x${ext}`;

  try {
    const info        = await probe(inputPath);
    const streams     = info.streams || [];
    const videoStream = streams.find(s => s.codec_type === "video");
    const audioStream = streams.find(s => s.codec_type === "audio");
    const hasVideo    = !!videoStream;

    let args;

    if (hasVideo) {
      const streamBitrate = parseInt(videoStream.bit_rate);
      const formatBitrate = parseInt(info.format?.bit_rate || 0);
      const audioBitrate  = parseInt(audioStream?.bit_rate || 128000);
      let   videoBps      = streamBitrate > 0 ? streamBitrate : formatBitrate - audioBitrate;
      if (!videoBps || videoBps <= 0) videoBps = formatBitrate || 8_000_000;

      args = [
        "-i", inputPath,
        "-vf", `setpts=${(1 / speed).toFixed(6)}*PTS`,
        "-af", `atempo=${speed}`,
        "-c:v", "libx264", "-crf", "18",
        "-b:v", `${videoBps}`, "-maxrate", `${videoBps}`, "-bufsize", `${videoBps * 2}`,
        "-preset", "slow", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", `${Math.min(audioBitrate, 320000)}`,
        "-y", outputPath
      ];
    } else {
      args = ["-i", inputPath, "-af", `atempo=${speed}`, "-y", outputPath];
    }

    await ffmpeg(args);
    fs.unlinkSync(inputPath);
    res.download(outputPath, outputName, () => fs.unlinkSync(outputPath));

  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    console.error(err);
    res.status(500).json({ error: "Erro ao processar o arquivo." });
  }
});

// ─── route: search & cut ────────────────────────────────────────────────────

app.post("/search-cut", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const rawWords  = (req.body.words || "").trim();
  const tolerance = Math.min(1.0, Math.max(0.1, parseFloat(req.body.tolerance) || 0.3));

  if (!rawWords) return res.status(400).json({ error: "Nenhuma palavra informada." });

  // Phrases are comma-separated; each phrase can have multiple words
  const phrases = rawWords.split(",").map(p => p.trim()).filter(Boolean);

  const inputPath  = req.file.path;
  const ext        = path.extname(req.file.originalname) || ".mp4";
  const outputPath = path.join(os.tmpdir(), `cuts_${Date.now()}${ext}`);
  const outputName = `${path.basename(req.file.originalname, ext)}_cuts${ext}`;
  const tempFiles  = [];

  try {
    // 1. Probe
    const info        = await probe(inputPath);
    const streams     = info.streams || [];
    const videoStream = streams.find(s => s.codec_type === "video");
    const hasVideo    = !!videoStream;
    const duration    = parseFloat(info.format?.duration || 0);

    // 2. Transcribe
    const wordList = await transcribe(inputPath);

    // 3. Find all phrase occurrences
    let hits = [];
    for (const phrase of phrases) {
      hits = hits.concat(findPhrase(wordList, phrase));
    }

    if (!hits.length)
      return res.status(404).json({ error: "Nenhuma ocorrência encontrada." });

    // 4. Apply tolerance — keep phrase label; merge overlapping segments
    const withTolerance = hits
      .map(h => ({
        start:  Math.max(0, h.start - tolerance),
        end:    Math.min(duration, h.end + tolerance),
        phrase: h.phrase
      }))
      .sort((a, b) => a.start - b.start);

    // Merge overlapping/adjacent, keep the phrase of the first hit in each group
    const segments = [];
    for (const seg of withTolerance) {
      const last = segments[segments.length - 1];
      if (last && seg.start <= last.end + 0.05) {
        last.end = Math.max(last.end, seg.end);
        // keep last.phrase (first phrase in the merge)
      } else {
        segments.push({ ...seg });
      }
    }

    // 5. Cut each segment — track per-phrase counter for filenames
    const phraseCounters = {};
    const segmentMeta    = []; // { tempPath, fileName }

    for (let i = 0; i < segments.length; i++) {
      const { start, end, phrase } = segments[i];
      const slug    = slugify(phrase);
      phraseCounters[slug] = (phraseCounters[slug] || 0) + 1;
      const counter = String(phraseCounters[slug]).padStart(2, "0");
      const fileName = `${slug}_${counter}${ext}`;

      const tempOut = path.join(os.tmpdir(), `seg_${Date.now()}_${i}${ext}`);
      tempFiles.push(tempOut);
      segmentMeta.push({ tempOut, fileName });

      const segArgs = hasVideo
        ? [
            "-ss", `${start}`, "-to", `${end}`, "-i", inputPath,
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-y", tempOut
          ]
        : [
            "-ss", `${start}`, "-to", `${end}`, "-i", inputPath,
            "-c:a", "libmp3lame", "-q:a", "2",
            "-y", tempOut
          ];

      await ffmpeg(segArgs);
    }

    // 6. Pack all segments into a ZIP — each file named by phrase + counter
    const baseName = path.basename(req.file.originalname, ext);
    const zipPath  = path.join(os.tmpdir(), `cuts_${Date.now()}.zip`);
    const zipName  = `${baseName}_cuts.zip`;

    await new Promise((resolve, reject) => {
      const output  = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      segmentMeta.forEach(({ tempOut, fileName }) => {
        archive.file(tempOut, { name: fileName });
      });
      archive.finalize();
    });

    // 7. Send and cleanup
    fs.unlinkSync(inputPath);
    tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });

    res.download(zipPath, zipName, () => {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    });

  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao processar." });
  }
});

// ─── route: censor ──────────────────────────────────────────────────────────

const VALID_SOUNDS = ["beep", "metal", "buzzer", "quack"];

/** Returns the mean_volume (dB) of an audio file using ffmpeg volumedetect. */
function measureVolume(inputPath) {
  return new Promise((resolve) => {
    execFile("ffmpeg", [
      "-i", inputPath, "-af", "volumedetect", "-f", "null", "-"
    ], { maxBuffer: 10 * 1024 * 1024 }, (_err, _stdout, stderr) => {
      const m = stderr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      resolve(m ? parseFloat(m[1]) : -20);
    });
  });
}

/**
 * Builds an ffmpeg filter_complex string that:
 *  - mutes [0:a] at every segment
 *  - normalises [1:a] (censor sound) to beepVolume dB, then places a copy at each position
 *  - mixes everything into [out]
 */
function buildCensorFilter(segments, beepVolume) {
  const n = segments.length;

  const muteExpr = segments
    .map(s => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`)
    .join("+");

  const parts = [];

  parts.push(`[0:a]volume=0:enable='${muteExpr}'[muted]`);

  // Normalise beep to match the original audio's mean volume
  const csLabels = Array.from({ length: n }, (_, i) => `[cs${i}]`).join("");
  parts.push(`[1:a]volume=${beepVolume.toFixed(1)}dB,asplit=${n}${csLabels}`);

  const beepLabels = [];
  for (let i = 0; i < n; i++) {
    const dur     = Math.max(0.05, segments[i].end - segments[i].start).toFixed(3);
    const delayMs = Math.round(segments[i].start * 1000);
    parts.push(`[cs${i}]atrim=0:${dur},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[b${i}]`);
    beepLabels.push(`[b${i}]`);
  }

  parts.push(`[muted]${beepLabels.join("")}amix=inputs=${1 + n}:normalize=0[out]`);

  return parts.join(";");
}

app.post("/censor", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const rawWords  = (req.body.words || "").trim();
  const tolerance = Math.min(1.0, Math.max(0.0, parseFloat(req.body.tolerance) || 0.1));
  const sound     = VALID_SOUNDS.includes(req.body.sound) ? req.body.sound : "beep";

  if (!rawWords) return res.status(400).json({ error: "Nenhuma palavra informada." });

  const phrases    = rawWords.split(",").map(p => p.trim()).filter(Boolean);
  const inputPath  = req.file.path;
  const ext        = path.extname(req.file.originalname) || ".mp4";
  const outputPath = path.join(os.tmpdir(), `censored_${Date.now()}${ext}`);
  const outputName = `${path.basename(req.file.originalname, ext)}_censored${ext}`;
  const censorPath = path.join(SOUNDS_DIR, `${sound}.mp3`);

  try {
    const info        = await probe(inputPath);
    const streams     = info.streams || [];
    const videoStream = streams.find(s => s.codec_type === "video");
    const hasVideo    = !!videoStream;
    const duration    = parseFloat(info.format?.duration || 0);

    // Transcribe
    const wordList = await transcribe(inputPath);

    // Find all occurrences
    let hits = [];
    for (const phrase of phrases) hits = hits.concat(findPhrase(wordList, phrase));

    if (!hits.length) return res.status(404).json({ error: "Nenhuma ocorrência encontrada." });

    // Apply tolerance and merge overlapping
    const withTol = hits
      .map(h => ({
        start: Math.max(0, h.start - tolerance),
        end:   Math.min(duration, h.end + tolerance)
      }))
      .sort((a, b) => a.start - b.start);

    const segments = [];
    for (const seg of withTol) {
      const last = segments[segments.length - 1];
      if (last && seg.start <= last.end + 0.05) {
        last.end = Math.max(last.end, seg.end);
      } else {
        segments.push({ ...seg });
      }
    }

    // Measure original audio volume; beep sits 10 dB above speech average
    const beepVolume    = await measureVolume(inputPath) + 10;
    const filterComplex = buildCensorFilter(segments, beepVolume);

    const args = hasVideo
      ? [
          "-i", inputPath, "-i", censorPath,
          "-filter_complex", filterComplex,
          "-map", "0:v", "-map", "[out]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-y", outputPath
        ]
      : [
          "-i", inputPath, "-i", censorPath,
          "-filter_complex", filterComplex,
          "-map", "[out]",
          "-c:a", "libmp3lame", "-q:a", "2",
          "-y", outputPath
        ];

    await ffmpeg(args);
    fs.unlinkSync(inputPath);
    res.download(outputPath, outputName, () => {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    });

  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao censurar." });
  }
});

// ─── route: silence cut ──────────────────────────────────────────────────────

app.post("/silence-cut", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const gap       = Math.min(0.5, Math.max(0.05, parseFloat(req.body.gap) || 0.15));
  const inputPath = req.file.path;
  const origExt   = path.extname(req.file.originalname) || ".mp4";
  const origStem  = path.basename(req.file.originalname, origExt);
  const tempFiles = [];

  try {
    // 1. Probe
    const info        = await probe(inputPath);
    const streams     = info.streams || [];
    const videoStream = streams.find(s => s.codec_type === "video");
    const duration    = parseFloat(info.format?.duration || 0);

    if (!duration) return res.status(400).json({ error: "Não foi possível determinar a duração do arquivo." });

    const hasVideo = !!videoStream;
    const workExt  = hasVideo ? ".mp4" : ".mp3";

    // 2. Detect silences
    const silences = await detectSilences(inputPath);

    // 3. Keep `gap` seconds of each silence as a breathing pause and remove the
    //    rest. We shorten every silence to its first `gap` seconds, so the kept
    //    footage stays real video — no black frames, no synthetic gap clips.
    const trimmedSilences = silences
      .map(s => ({ start: s.start + gap, end: s.end }))
      .filter(s => s.end - s.start > 0.02);

    // 4. Invert into keep-segments and cut each straight from the source.
    const segments = computeKeepSegments(trimmedSilences, duration);
    const concatItems = [];

    for (let i = 0; i < segments.length; i++) {
      const { start, end } = segments[i];
      const segPath = path.join(os.tmpdir(), `nosil_seg_${Date.now()}_${i}${workExt}`);
      tempFiles.push(segPath);

      const segArgs = hasVideo
        ? ["-ss", `${start}`, "-to", `${end}`, "-i", inputPath,
           "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-y", segPath]
        : ["-ss", `${start}`, "-to", `${end}`, "-i", inputPath,
           "-c:a", "libmp3lame", "-q:a", "2", "-y", segPath];

      await ffmpeg(segArgs);
      concatItems.push(segPath);
    }

    // 5. Write concat list
    const listPath = path.join(os.tmpdir(), `nosil_list_${Date.now()}.txt`);
    fs.writeFileSync(listPath, concatItems.map(f => `file '${f}'`).join("\n"));
    tempFiles.push(listPath);

    // 6. Final concat
    const outputPath = path.join(os.tmpdir(), `nosil_out_${Date.now()}${workExt}`);
    const outputName = `${origStem}_nosil${origExt}`;
    tempFiles.push(outputPath);

    await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-y", outputPath]);

    // 7. Send and cleanup
    fs.unlinkSync(inputPath);
    res.download(outputPath, outputName, () => {
      tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    });

  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao processar." });
  }
});

// ─── start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Audio Speeder rodando em http://localhost:${PORT}`);
});
