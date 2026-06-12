# Silence Cut — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um quarto módulo ao Audio Tools que detecta silêncios em arquivos de áudio/vídeo e os substitui por pausas curtas configuráveis (0.05s–0.5s).

**Architecture:** O backend detecta silêncios via `ffmpeg silencedetect`, calcula os segmentos de fala, corta cada segmento em arquivo temporário, gera clips de silêncio com a duração escolhida, escreve uma concat list e une tudo em passo final. O frontend adiciona um 4º card seguindo exatamente o padrão visual dos módulos existentes (SPEED/WORD CUT).

**Tech Stack:** Node.js/Express, ffmpeg (silencedetect + concat demuxer), HTML/CSS/JS vanilla — sem dependências novas.

---

## Arquivos modificados

| Arquivo | O que muda |
|---|---|
| `public/index.html` | CSS vars laranja, grid 4 colunas, card HTML do módulo 4, JS do módulo 4 |
| `server.js` | Funções `detectSilences` e `computeKeepSegments`, rota `POST /silence-cut` |

---

### Task 1: CSS — variáveis laranja, grid 4 colunas e estilos do módulo

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Adicionar `--accent3` e `--accent3-dark` ao bloco `:root`**

Localizar o bloco `:root` (linha ~10) e adicionar as duas variáveis após `--danger`:

```css
--accent3:     #f0803c;
--accent3-dark:#c8642e;
```

Resultado esperado do bloco completo:
```css
:root {
  --bg:          #0e0e0e;
  --surface:     #181818;
  --border:      #2a2a2a;
  --text:        #f0ece4;
  --muted:       #5a5a5a;
  --accent:      #d4f03c;
  --accent-dark: #a8be28;
  --accent2:     #3cf0c8;
  --accent2-dark:#28be9c;
  --accent3:     #f0803c;
  --accent3-dark:#c8642e;
  --danger:      #ff4d4d;
  --radius:      10px;
}
```

- [ ] **Step 2: Alterar grid de 2 para 4 colunas e atualizar breakpoints**

Substituir o bloco `.grid` e o `@media (max-width: 720px)` existente por:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
  width: 100%;
  max-width: 1400px;
  align-items: start;
}

@media (max-width: 1080px) {
  .grid { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 720px) {
  .grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Adicionar classes de cor laranja (`.card-title.orange`, `.btn.orange`, etc.)**

Após o bloco `.btn.teal:hover:not(:disabled)`, adicionar:

```css
.btn.orange { background: var(--accent3); color: #0e0e0e; }
.btn.orange:hover:not(:disabled) { background: var(--accent3-dark); }
```

Após `.card-title.teal`:

```css
.card-title.orange { color: var(--accent3); }
```

Após `.file-name.teal`:

```css
.file-name.orange  { color: var(--accent3); }
```

Após `.dropzone.dragover-teal { border-color: var(--accent2); }`:

```css
.dropzone.dragover-orange { border-color: var(--accent3); }
```

Após `.status.success-teal   { color: var(--accent2); }`:

```css
.status.success-orange { color: var(--accent3); }
```

Após `.spinner.teal   { border-top-color: var(--accent2); }`:

```css
.spinner.orange { border-top-color: var(--accent3); }
```

- [ ] **Step 4: Adicionar `.silence-row` e `.gap-val` (equivalentes ao `.tolerance-row`)**

Após o bloco `.tolerance-val { ... }`, adicionar:

```css
.silence-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.silence-row input[type=range] {
  flex: 1;
  -webkit-appearance: none;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.silence-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent3);
  cursor: pointer;
  transition: transform 0.1s;
}
.silence-row input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.2); }
.gap-val {
  font-size: 0.82rem;
  color: var(--accent3);
  min-width: 3.5rem;
  text-align: right;
}
```

- [ ] **Step 5: Verificar visualmente no browser**

Abrir `http://localhost:3000` (ou abrir o HTML direto). Os dois cards existentes devem continuar idênticos. O grid deve estar mais largo (4 colunas), com os dois cards ocupando as duas primeiras colunas.

---

### Task 2: HTML — card SILENCE CUT

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Adicionar o 4º card após o fechamento do MODULE 2**

Localizar o comentário `<!-- ══ MODULE 2: SEARCH & CUT ══ -->` e, após o `</div>` que fecha esse card, adicionar:

```html
    <!-- ══ MODULE 4: SILENCE CUT ══ -->
    <div class="card">
      <div class="card-header">
        <h1 class="card-title orange">SILENCE CUT</h1>
        <p class="card-sub">elimine pausas longas</p>
      </div>

      <div class="dropzone" id="dz4">
        <input type="file" id="file4" accept="audio/*,video/*" />
        <span class="drop-icon">🔇</span>
        <div class="drop-label">
          <strong>Arraste ou clique para escolher</strong>
          MP3, MP4, WAV, M4A…
        </div>
        <div class="file-name orange" id="fname4"></div>
      </div>

      <div>
        <span class="section-label">
          Pausa entre falas &nbsp;—&nbsp; <span id="gapLabel">0.15s</span>
        </span>
        <div class="silence-row">
          <input type="range" id="gapSlider" min="0.05" max="0.5" step="0.05" value="0.15" />
          <span class="gap-val" id="gapVal">0.15s</span>
        </div>
      </div>

      <button class="btn orange" id="btn4" disabled>Remover Silêncios</button>
      <div class="status" id="status4"></div>
    </div>
```

> **Nota:** O MODULE 3 (sendo construído em outra sessão) ficará entre o MODULE 2 e o MODULE 4. Por ora, o MODULE 4 ocupa a 3ª coluna visualmente — isso se ajusta automaticamente quando o MODULE 3 for inserido antes dele no HTML.

- [ ] **Step 2: Verificar HTML no browser**

O card "SILENCE CUT" deve aparecer na 3ª posição do grid (laranja, dropzone, slider de 0.05–0.5, botão desabilitado). Arrastar um arquivo deve habilitar o botão.

---

### Task 3: JavaScript — lógica do módulo 4

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Adicionar o bloco JS do módulo 4**

Antes do comentário `// ── shared helpers ──`, adicionar:

```javascript
// ── Module 4: Silence Cut ────────────────────────────────────────────────────

let file4 = null;

setupDropzone("dz4", "file4", (f) => {
  file4 = f;
  document.getElementById("fname4").textContent = f.name;
  document.getElementById("btn4").disabled = false;
}, "orange");

const gapSlider = document.getElementById("gapSlider");
const gapVal    = document.getElementById("gapVal");
const gapLabel  = document.getElementById("gapLabel");
gapSlider.addEventListener("input", () => {
  const v = parseFloat(gapSlider.value).toFixed(2) + "s";
  gapVal.textContent = v;
  gapLabel.textContent = v;
});

document.getElementById("btn4").addEventListener("click", async () => {
  if (!file4) return;
  const form = new FormData();
  form.append("audio", file4);
  form.append("gap", gapSlider.value);
  await submit({
    url: "/silence-cut", form,
    btn: "btn4", statusEl: "status4",
    spinnerClass: "orange", successClass: "success-orange",
    loadingMsg: "detectando silêncios…",
    filename: (orig) => `${stem(orig)}_nosil${ext(orig)}`
  });
});
```

- [ ] **Step 2: Verificar interação no browser**

1. Arrastar um arquivo de áudio/vídeo para o dropzone laranja → nome aparece em laranja, botão habilita
2. Mover o slider → label "Pausa entre falas" e valor à direita atualizam em tempo real
3. Clicar o botão → spinner laranja e mensagem "detectando silêncios…" aparecem (pode falhar se o servidor ainda não tem a rota — comportamento esperado: erro "Erro desconhecido")

---

### Task 4: Backend — funções auxiliares `detectSilences` e `computeKeepSegments`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Adicionar `detectSilences` após o bloco de funções existentes**

Localizar o comentário `// ─── route: speed up ───` e, **antes** dele, adicionar:

```javascript
/**
 * Runs ffmpeg silencedetect and returns array of { start, end } silence intervals.
 * Always resolves (never rejects) — parse failures return empty array.
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
```

- [ ] **Step 2: Verificar funções manualmente via node REPL**

```bash
cd /Users/fernando.drudi/Desktop/VIBECODING/audio-speeder
node -e "
const { execFile } = require('child_process');

function detectSilences(inputPath) {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-i', inputPath, '-af', 'silencedetect=noise=-30dB:d=0.3', '-f', 'null', '-'],
      { maxBuffer: 10*1024*1024 }, (_err, _stdout, stderr) => {
        const starts=[], ends=[];
        const sr=/silence_start:\s*([\d.e+\-]+)/g, er=/silence_end:\s*([\d.e+\-]+)/g;
        let m;
        while((m=sr.exec(stderr))!==null) starts.push(parseFloat(m[1]));
        while((m=er.exec(stderr))!==null) ends.push(parseFloat(m[1]));
        const silences=[];
        for(let i=0;i<Math.min(starts.length,ends.length);i++) silences.push({start:starts[i],end:ends[i]});
        resolve(silences);
      });
  });
}

// Use any audio file on the system for quick test
detectSilences('/dev/null').then(s => console.log('silences:', s)).catch(console.error);
"
```

Saída esperada: `silences: []` (arquivo vazio não tem silêncios detectáveis — sem crash).

- [ ] **Step 3: Testar `computeKeepSegments` com casos básicos**

```bash
node -e "
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

// Caso 1: silêncio no meio
console.log(JSON.stringify(computeKeepSegments([{start:2,end:5}], 10)));
// Esperado: [{start:0,end:2},{start:5,end:10}]

// Caso 2: silêncio no início
console.log(JSON.stringify(computeKeepSegments([{start:0,end:1.5}], 10)));
// Esperado: [{start:1.5,end:10}]

// Caso 3: sem silêncios
console.log(JSON.stringify(computeKeepSegments([], 10)));
// Esperado: [{start:0,end:10}]
"
```

Saída esperada:
```
[{"start":0,"end":2},{"start":5,"end":10}]
[{"start":1.5,"end":10}]
[{"start":0,"end":10}]
```

---

### Task 5: Backend — rota `POST /silence-cut`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Adicionar a rota após o fechamento da rota `/search-cut`**

Localizar o comentário `// ─── start ───` e, **antes** dele, adicionar:

```javascript
// ─── route: silence cut ──────────────────────────────────────────────────────

app.post("/silence-cut", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const gap = Math.min(0.5, Math.max(0.05, parseFloat(req.body.gap) || 0.15));

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

    // 3. Compute keep segments
    const segments = computeKeepSegments(silences, duration);

    // 4. Cut segments + generate gap clips
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

      // Insert gap between segments (not after the last one)
      if (i < segments.length - 1) {
        const gapPath = path.join(os.tmpdir(), `nosil_gap_${Date.now()}_${i}${workExt}`);
        tempFiles.push(gapPath);

        let gapArgs;
        if (hasVideo) {
          const w   = videoStream.width;
          const h   = videoStream.height;
          const fps = videoStream.r_frame_rate || "25/1";
          gapArgs = [
            "-f", "lavfi", "-i", `color=black:size=${w}x${h}:rate=${fps}`,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-map", "0:v", "-map", "1:a",
            "-t", `${gap}`,
            "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-y", gapPath
          ];
        } else {
          gapArgs = [
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", `${gap}`,
            "-c:a", "libmp3lame", "-q:a", "2", "-y", gapPath
          ];
        }

        await ffmpeg(gapArgs);
        concatItems.push(gapPath);
      }
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
```

- [ ] **Step 2: Reiniciar o servidor**

```bash
cd /Users/fernando.drudi/Desktop/VIBECODING/audio-speeder
node server.js
```

Saída esperada: `✅ Audio Speeder rodando em http://localhost:3000`

- [ ] **Step 3: Testar com arquivo de áudio (MP3)**

1. Abrir `http://localhost:3000`
2. No card SILENCE CUT, fazer upload de qualquer MP3
3. Deixar slider em 0.15s
4. Clicar "Remover Silêncios"
5. Aguardar download de `{nome}_nosil.mp3`
6. Abrir o arquivo resultante — deve ser mais curto (ou igual se não havia silêncios acima de 0.3s), sem cortes bruscos nas falas

- [ ] **Step 4: Testar com arquivo de vídeo (MP4)**

1. Fazer upload de um MP4 com silêncios visíveis
2. Clicar "Remover Silêncios"
3. Download de `{nome}_nosil.mp4` — verificar que áudio e vídeo estão sincronizados

- [ ] **Step 5: Testar valor mínimo e máximo do slider**

- Slider em 0.05s → pausas quase imperceptíveis entre falas
- Slider em 0.50s → pausa de meio segundo entre cada fala
- Ambos devem processar sem erros

- [ ] **Step 6: Testar arquivo sem silêncios**

Usar um arquivo de áudio contínuo (música, fala ininterrupta). O resultado deve ser baixado sem erros — é o arquivo re-encodado sem modificações significativas de duração.

---

### Task 6: Commit final

- [ ] **Step 1: Verificar arquivos modificados**

```bash
cd /Users/fernando.drudi/Desktop/VIBECODING/audio-speeder
git diff --stat
```

Esperado: `public/index.html` e `server.js` modificados.

- [ ] **Step 2: Commit**

```bash
git add public/index.html server.js docs/superpowers/specs/2026-05-28-silence-cut-design.md docs/superpowers/plans/2026-05-28-silence-cut.md
git commit -m "feat: add SILENCE CUT module — replace silences with configurable gap"
```
