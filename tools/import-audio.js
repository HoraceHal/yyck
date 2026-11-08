// 导入女朋友的真人录音:
//   1. 在网站「录音」页导出 yuetung-audio.zip,解压到某个文件夹
//   2. 运行:node tools/import-audio.js <解压后的文件夹>
// 会把音频文件复制到 public/audio/,并把对照表合并进 public/audio/manifest.json
const fs = require('fs'), path = require('path');
const src = process.argv[2];
if (!src || !fs.existsSync(path.join(src, 'manifest.json'))) { console.error('用法: node tools/import-audio.js <解压后的文件夹(里面要有 manifest.json)>'); process.exit(1); }
const dst = path.join(__dirname, '..', 'public', 'audio');
fs.mkdirSync(dst, { recursive: true });
const incoming = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const mp = path.join(dst, 'manifest.json');
const current = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : {};
let n = 0;
for (const [hash, file] of Object.entries(incoming)) {
  if (!/^[a-z0-9]+\.(webm|m4a|ogg|mp3)$/.test(file)) { console.warn('跳过可疑文件名:', file); continue; }
  fs.copyFileSync(path.join(src, file), path.join(dst, file));
  if (current[hash] && current[hash] !== file) { try { fs.unlinkSync(path.join(dst, current[hash])); } catch (e) { /* ignore */ } }
  current[hash] = file; n++;
}
fs.writeFileSync(mp, JSON.stringify(current, null, 1) + '\n');
console.log(`已导入 ${n} 条录音,manifest 现有 ${Object.keys(current).length} 条。`);
