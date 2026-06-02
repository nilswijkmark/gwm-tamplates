const raw = (process.env.BEATS_METADATA || '').replace(/^=/, '');
const beats = JSON.parse(raw);
const { execSync } = require('child_process');
const fs = require('fs');

const displayNameMap = {
  'Big Dave': 'Big Dave', 'big_dave': 'Big Dave', 'big dave': 'Big Dave', 'dave': 'Big Dave',
  'Smug Tom': 'Tom', 'smug_tom': 'Tom', 'smug tom': 'Tom', 'tom': 'Tom', 'Tom': 'Tom',
  'Sam': 'Sam', 'sam': 'Sam'
};

beats.forEach((b, i) => {
  const hflip = b.hflip === 'true' ? 'hflip,' : '';
  const chip = '0x' + b.chip_color;
  const rawName = (b.character || '').replace(/['"`]/g, '').trim();
  const displayName = displayNameMap[rawName] || rawName;
  const chipFile = 'chip_' + i + '.txt';
  fs.writeFileSync(chipFile, displayName);

  let runwayDuration = null;
  try {
    const probe = execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 beat_raw_' + i + '.mp4').toString().trim();
    runwayDuration = parseFloat(probe);
    console.log('Beat ' + i + ' Runway duration: ' + runwayDuration + 's');
  } catch (e) {
    console.log('ffprobe failed for beat ' + i + ', using raw timestamps');
  }

  const filterParts = [
    '[0:v]' + hflip + 'scale=-2:1080,crop=1080:1080:(iw-1080)/2:0',
    'colorchannelmixer=rr=1.05:gg=1.02:bb=0.92',
    'eq=saturation=1.05',
    'vignette=angle=PI/5',
    'drawbox=x=0:y=900:w=1080:h=170:color=black@0.68:t=fill',
    'drawbox=x=26:y=28:w=190:h=64:color=' + chip + '@0.94:t=fill',
    'drawbox=x=26:y=92:w=190:h=4:color=0xD4A84C@1:t=fill',
    'drawtext=fontsize=30:fontcolor=white:x=46:y=43:textfile=' + chipFile
  ];

  const wordTs = b.word_timestamps || [];
  if (wordTs.length > 0) {
    let scale = 1.0;
    if (runwayDuration && wordTs.length > 0) {
      const elDuration = wordTs[wordTs.length - 1].end;
      if (elDuration > 0) {
        scale = runwayDuration / elDuration;
        console.log('Beat ' + i + ': EL=' + elDuration + 's Runway=' + runwayDuration + 's scale=' + scale.toFixed(4));
      }
    }

    let chunks = [], cur = [];
    wordTs.forEach(w => {
      const test = [...cur, w].map(x => x.word).join(' ');
      if (cur.length && (test.length > 22 || cur.length >= 4)) { chunks.push(cur); cur = [w]; }
      else cur.push(w);
    });
    if (cur.length) chunks.push(cur);

    chunks.forEach((chunk, ci) => {
      const s = (chunk[0].start * scale).toFixed(3);
      const e = (chunk[chunk.length - 1].end * scale).toFixed(3);
      const text = chunk.map(x => x.word).join(' ');
      const tf = 'caption_' + i + '_' + ci + '.txt';
      fs.writeFileSync(tf, text);
      filterParts.push('drawtext=fontsize=36:fontcolor=white:x=(w-text_w)/2:y=960:textfile=' + tf + ':enable=between(t\\,' + s + '\\,' + e + ')');
    });
  } else {
    const words = b.text.split(' ');
    let chunks = [], cur = [];
    words.forEach(w => {
      const test = [...cur, w].join(' ');
      if (cur.length && (test.length > 22 || cur.length >= 4)) { chunks.push(cur.join(' ')); cur = [w]; }
      else cur.push(w);
      if (/[.,?!;:]$/.test(w) && cur.length) { chunks.push(cur.join(' ')); cur = []; }
    });
    if (cur.length) chunks.push(cur.join(' '));
    const dur = parseFloat(b.duration_hint) || 3;
    const start = 0.25;
    const end = Math.max(start + 0.4, Math.min(dur - 0.1, dur));
    const span = (end - start) / Math.max(1, chunks.length);
    chunks.forEach((chunk, ci) => {
      const s = (start + ci * span).toFixed(2);
      const e = (start + (ci + 1) * span).toFixed(2);
      const tf = 'caption_' + i + '_' + ci + '.txt';
      fs.writeFileSync(tf, chunk);
      filterParts.push('drawtext=fontsize=36:fontcolor=white:x=(w-text_w)/2:y=960:textfile=' + tf + ':enable=between(t\\,' + s + '\\,' + e + ')');
    });
  }

  const filter = filterParts.join(',') + '[v]';
  const filterFile = 'filter_' + i + '.txt';
  fs.writeFileSync(filterFile, filter);

  const cmd = 'ffmpeg -y -i beat_raw_' + i + '.mp4 -filter_complex_script ' + filterFile +
    ' -map [v] -map 0:a -r 30 -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a aac -b:a 160k beat_' + i + '.mp4';
  console.log('Composing beat ' + i + ': ' + displayName);
  execSync(cmd, { stdio: 'inherit' });
});
