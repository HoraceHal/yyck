// 校验课程数据:每个汉字 ↔ 一个粤拼音节;粤拼格式合法;词块拼回原句;同字异音提示
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'public');
const ctx = vm.createContext({});
for (const f of ['data.js', 'lessons-extra.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
const get = n => vm.runInContext(n, ctx);
const LESSONS = get('LESSONS'), GRAMMAR = get('GRAMMAR'), COMPARE = get('COMPARE'), TONE_SETS = get('TONE_SETS'), INITIALS = get('INITIALS'), FINALS = get('FINALS');

const han = /[㐀-鿿]/g;
const SYL = /^(ng|gw|kw|[bpmfdtnlgkhwzcsj])?(aang|aak|aai|aau|aam|aan|aap|aat|aa|eoi|eon|eot|oeng|oek|oe|yun|yut|yu|eng|ek|ei|ou|oi|on|ong|ot|ok|ui|un|ung|ut|uk|ai|au|am|an|ang|ap|at|ak|iu|im|in|ing|ip|it|ik|e|i|o|u|a)[1-6]$|^(m|ng)[1-6]$/;
let bad = 0, n = 0;
const chk = (it, where) => {
  n++;
  const hc = (it.c.match(han) || []).length, syl = it.j.trim() ? it.j.trim().split(/\s+/) : []; // 纯英文词(如 WhatsApp)粤拼为空
  const okSyl = syl.every(s => SYL.test(s));
  if (hc !== syl.length || !okSyl) { bad++; console.log('MISMATCH', where, it.c, '|', it.j, `han=${hc} syl=${syl.length} validSyl=${okSyl}`); }
  if (it.w && it.w.map(x => x[0]).join('') !== it.c) { bad++; console.log('TOKENS', where, it.c); }
};
const ids = new Set();
LESSONS.forEach(L => {
  if (ids.has(L.id)) { bad++; console.log('DUP LESSON', L.id); } ids.add(L.id);
  L.words.concat(L.phrases).forEach(it => chk(it, L.id));
  if (L.dialog) L.dialog.lines.forEach(l => chk(l.it, L.id + '/dialog'));
  else console.log('note: no dialog in', L.id);
  ['goal', 'tip', 'desc', 'title'].forEach(k => { if (!L[k]) { bad++; console.log('MISSING', k, L.id); } });
  console.log(L.id.padEnd(4), L.title.padEnd(12), `${L.words.length}词 ${L.phrases.length}句 ${L.dialog ? L.dialog.lines.length : 0}行对话`);
});
GRAMMAR.forEach(g => g.ex.forEach(it => chk(it, 'G')));
COMPARE.forEach(([m, w]) => chk(w, 'CMP'));
TONE_SETS.forEach(s => s.items.forEach(([c, j], i) => { if (+j.slice(-1) !== i + 1) { bad++; console.log('TONE', c, j); } }));
[...INITIALS, ...FINALS].forEach(([f, c, j]) => chk({ c, j }, 'IF'));

// 同一个字出现多种读音(提示,供人工确认,不算错误)
const readings = {};
const scan = it => { const syl = it.j.split(/\s+/); let k = 0; for (const ch of it.c) if (/[㐀-鿿]/.test(ch)) { const s = syl[k++]; (readings[ch] = readings[ch] || new Set()).add(s); } };
LESSONS.forEach(L => { L.words.concat(L.phrases).forEach(scan); if (L.dialog) L.dialog.lines.forEach(l => scan(l.it)); });
console.log('\n同字多读音(请人工确认是否为正常变调/多音字):');
Object.entries(readings).filter(([, s]) => s.size > 1).forEach(([c, s]) => console.log(' ', c, [...s].join(' / ')));

// 地道性提示(不算错误,供人工复核):这些用法常带普通话/内地色彩
const lint = [['嗎', '句尾"嗎"偏普通话,优先用 咩 / 係咪 / A唔A / 呀'], ['打包', '香港:打包=吃剩的带走;外卖说 外賣/帶走'], ['請你', '日常更常说 唔該你…'], ['菜單', '香港常说 餐牌']];
console.log('\n地道性提示(请人工确认是否有意保留):');
let hits = 0;
LESSONS.forEach(L => L.words.concat(L.phrases, L.dialog ? L.dialog.lines.map(l => l.it) : []).forEach(it => lint.forEach(([k, why]) => { if (it.c.includes(k)) { hits++; console.log(`  [${L.id}] ${it.c}  ← 含「${k}」:${why}`); } })));
if (!hits) console.log('  (无)');

const totW =LESSONS.reduce((a, L) => a + L.words.length, 0), totP = LESSONS.reduce((a, L) => a + L.phrases.length, 0);
console.log(`\n课程 ${LESSONS.length} 课,词 ${totW},句 ${totP};共检查 ${n} 条;问题 ${bad}`);
process.exit(bad ? 1 : 0);
