# Silence Cut — Design Spec
**Data:** 2026-05-28

## Objetivo
Adicionar um quarto módulo ao Audio Tools que detecta e elimina silêncios de arquivos de áudio/vídeo, substituindo cada silêncio por uma pausa curta configurável pelo usuário (0.05s–0.5s).

## Comportamento
- O usuário faz upload de um arquivo de áudio ou vídeo
- Escolhe a duração da pausa que substituirá cada silêncio detectado (slider 0.05s–0.5s, default 0.15s)
- Clica em "Remover Silêncios"
- Recebe o arquivo processado com nome `{stem}_nosil{ext}`

## Parâmetros de detecção (internos, não expostos na UI)
- Threshold: `-30dB`
- Duração mínima de silêncio: `0.3s`

## Design Visual
- Segue exatamente o mesmo padrão dos módulos SPEED (amarelo) e WORD CUT (teal)
- Grid passa de `1fr 1fr` para `repeat(4, 1fr)` (breakpoints: ≤1080px → 2 cols, ≤720px → 1 col)
- Card com dropzone, slider de pausa, botão e status — mesmos componentes CSS existentes
- Cor de destaque: `--accent3: #f0803c` (laranja), seguindo a mesma variável CSS pattern

## Backend — Rota `POST /silence-cut`

### Pipeline
1. **Detecção**: `ffmpeg -i input -af "silencedetect=noise=-30dB:d=0.3" -f null -` → parseia stderr para extrair pares `silence_start` / `silence_end`
2. **Inversão**: calcula segmentos não-silenciosos invertendo os intervalos de silêncio; inclui início e fim do arquivo como limites
3. **Corte**: para cada segmento de fala → arquivo temporário; entre cada dois segmentos → clip de silêncio com duração = `gap`
4. **Concat**: escreve `concat_list.txt`, roda passo final de junção
   - Vídeo: re-encoda com `libx264 -crf 18` / `aac`
   - Áudio: re-encoda com `libmp3lame -q:a 2`

### Validação
- `gap`: float, clampado entre 0.05 e 0.5 no servidor
- Arquivo obrigatório; erro 400 se ausente
- Se nenhum silêncio for detectado: retorna o arquivo original sem alteração (status 200 com aviso no filename `_nosil`)

### Geração do clip de silêncio
- Áudio: `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t {gap}`
- Vídeo: `ffmpeg -f lavfi -i "color=black:size={w}x{h}:rate={fps}" -f lavfi -i anullsrc -t {gap}`  
  Dimensões e fps extraídos via `ffprobe` no início do processamento

### Limpeza
- Todos os arquivos temporários (segmentos + gaps + lista) removidos após envio

## Estrutura de arquivos
Nenhum arquivo novo — toda a lógica vai em `server.js` e o card em `public/index.html`.
