// 生成 public/version.json:网页每隔一段时间读取它,发现版本变化就提示用户刷新。
// 用法:node tools/build-version.js [输出路径]    (CI 发布前会自动运行)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'public');
const ctx = vm.createContext({});
for (const f of ['data.js', 'lessons-extra.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const lessons = vm.runInContext('LESSONS.length', ctx);
const sha = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // 例如 202611081530
const out = process.argv[2] || path.join(dir, 'version.json');
fs.writeFileSync(out, JSON.stringify({ version: `${stamp}-${sha}`, lessons }) + '\n');
console.log('wrote', out, fs.readFileSync(out, 'utf8').trim());
