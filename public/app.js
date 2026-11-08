(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');

/* ================= 状态 ================= */
const KEY = 'jyutung.v1';
const defaults = () => ({ done: {}, srs: {}, xp: 0, streak: 0, lastDay: '', toneBest: 0, soundsDone: false, rv: {}, set: { jp: true, rate: 0.8, voice: '' } });
function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY)) || {};
    const d = defaults();
    return Object.assign(d, o, { set: Object.assign(d.set, o.set || {}) });
  } catch (e) { return defaults(); }
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 隐私模式等情况下忽略 */ } }

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
function addXP(n) {
  S.xp += n;
  const t = today();
  if (S.lastDay !== t) { S.streak = (S.lastDay && dayDiff(S.lastDay, t) === 1) ? S.streak + 1 : 1; S.lastDay = t; }
  save();
}
const streakNow = () => (S.lastDay && dayDiff(S.lastDay, today()) <= 1) ? S.streak : 0;

/* ================= 工具 ================= */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isHan = ch => /[㐀-鿿]/.test(ch);
const toneOf = s => (s.match(/[1-6]$/) || ['0'])[0];
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }

/* 汉字 + 粤拼(逐字对齐,声调着色) */
function ruby(c, j, size) {
  const syl = j.trim().split(/\s+/); let k = 0, out = '';
  for (const ch of c) {
    if (isHan(ch)) { const s = syl[k++] || ''; out += `<ruby>${ch}<rt class="t${toneOf(s)}">${s}</rt></ruby>`; }
    else out += `<span class="pn">${esc(ch)}</span>`;
  }
  return `<span class="cn ${size || ''}" lang="zh-HK">${out}</span>`;
}
const spk = (text, cls) => `<button class="spk ${cls || ''}" data-say="${esc(text)}" aria-label="播放发音" title="播放发音">🔊</button>`;

function contour(p, cls) {
  const w = 56, h = 36, y = v => h - 5 - (v - 1) / 4 * (h - 10);
  const pts = p.map((v, i) => `${6 + i * (w - 12) / (p.length - 1)},${y(v)}`);
  const lines = [1, 2, 3, 4, 5].map(v => `<line x1="2" x2="${w - 2}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`).join('');
  const [ex, ey] = pts[pts.length - 1].split(',');
  return `<svg class="${cls || ''}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${lines}<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${ex}" cy="${ey}" r="3.6" fill="currentColor"/></svg>`;
}

function wordCard(it) {
  return `<div class="wcard">${spk(it.c)}<div class="body">${ruby(it.c, it.j)}<div class="mn">${esc(it.m)}</div>${it.n ? `<div class="nt">💡 ${esc(it.n)}</div>` : ''}</div></div>`;
}
function phraseCard(it) {
  return `<div class="pcard">${spk(it.c)}<div class="body">${ruby(it.c, it.j, 'md')}<div class="mn muted">${esc(it.m)}</div></div></div>`;
}

/* ================= 数据索引 ================= */
const ITEMS = {};
const ALL = [];
LESSONS.forEach(L => {
  L.words.forEach((w, i) => { w.id = `${L.id}w${i}`; w.L = L.id; ITEMS[w.id] = w; ALL.push(w); });
  L.phrases.forEach((p, i) => { p.id = `${L.id}p${i}`; p.L = L.id; ITEMS[p.id] = p; ALL.push(p); });
});
const lessonById = id => LESSONS.find(l => l.id === id);

/* ================= 语音 ================= */
let voices = [];
function loadVoices() { try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { voices = []; } updateVoiceNote(); }
const isYue = v => /^(zh[-_]HK|yue)/i.test(v.lang) || /cantonese|粵|粤/i.test(v.name);
function pickVoice() {
  if (S.set.voice) { const v = voices.find(v => v.name === S.set.voice); if (v) return v; }
  return voices.find(isYue) || null;
}
/* ===== 发音引擎:优先播放真人录音,没有录音才用语音合成 ===== */
const hashText = t => { let h = 5381; for (const ch of t) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0; return h.toString(36); };
let AUDIO = {};      // 仓库里的真人录音:hash -> 文件名(public/audio/manifest.json)
let LOCALREF = {};   // 本机录的标准音:hash -> objectURL
let curAudio = null, seqId = 0, rateOverride = null;
fetch('audio/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(j => { AUDIO = j || {}; }).catch(() => {});
const recUrl = text => { const h = hashText(text.trim()); return LOCALREF[h] || (AUDIO[h] ? 'audio/' + AUDIO[h] : null); };
function stopAll() { seqId++; try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ignore */ } if (curAudio) { curAudio.pause(); curAudio = null; } }
function playOne(text) {
  return new Promise(res => {
    const url = recUrl(text);
    if (url) { const a = new Audio(url); curAudio = a; a.onended = a.onerror = () => res(); a.play().catch(() => res()); return; }
    const v = pickVoice();
    if (!v) { res(); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[\s]+/g, ' '));
    u.voice = v; u.lang = v.lang; u.rate = rateOverride || S.set.rate;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}
async function playSeq(texts) { const my = ++seqId; for (const t of texts) { if (my !== seqId) return; await playOne(t); } }
function speak(text) {
  if (!recUrl(text)) {
    if (!window.speechSynthesis) { toast('当前浏览器不支持语音朗读,请换用 Edge 或 Chrome'); return false; }
    if (!pickVoice()) { toast('没有找到粤语语音,请看页面上方的提示或「设置」'); return false; }
  }
  stopAll(); playSeq([text]); return true;
}
function speakQueue(texts) {
  if (!texts.some(recUrl) && !pickVoice()) { speak('x'); return; }
  stopAll(); playSeq(texts); toast('正在连续播放…点任意喇叭可打断');
}
function updateVoiceNote() {
  const n = $('#vnote');
  const ok = !!pickVoice();
  const loading = !voicesSettled && window.speechSynthesis && voices.length === 0;
  n.hidden = ok || loading;
  if (!n.hidden) n.innerHTML = '⚠ 这个浏览器里没有找到<b>粤语(中文-香港)语音</b>,点喇叭会没有声音。推荐用 <b>Edge</b> 或 <b>Chrome</b> 打开本页,或查看 <a href="#/settings" style="text-decoration:underline">设置页的解决办法</a>。';
}
let voicesSettled = false;
if (window.speechSynthesis) { loadVoices(); speechSynthesis.addEventListener('voiceschanged', loadVoices); setTimeout(() => { voicesSettled = true; loadVoices(); }, 1500); } else voicesSettled = true;

/* ================= 复习(间隔重复) ================= */
const INTERVALS = [0, 1, 3, 7, 14, 30];
const dueIds = () => Object.keys(S.srs).filter(id => ITEMS[id] && S.srs[id].due <= today());
function grade(id, g) {
  const c = S.srs[id] || { box: 0, due: today() };
  if (g === 0) { c.box = 0; c.due = today(); }
  else if (g === 1) { c.due = addDays(today(), 1); }
  else { c.box = Math.min(c.box + 1, 5); c.due = addDays(today(), INTERVALS[c.box]); }
  S.srs[id] = c;
}
function updateBadge() { const n = dueIds().length, b = $('#dueBadge'); b.hidden = !n; b.textContent = n; }

/* ================= 页面:首页 ================= */
const STAGES = { L1: 1, L8: 1, L2: 1, L3: 1, L23: 1, L4: 2, L9: 2, L18: 2, L20: 2, L28: 2, L5: 2, L6: 2, L19: 2, L10: 2, L27: 2, L16: 3, L7: 3, L25: 3, L21: 3, L26: 3, L17: 3, L24: 3, L22: 3, L11: 3, L12: 3, L13: 3, L14: 3, L15: 3 };
const STAGE_NAMES = { 1: '第一阶段 · 能开口:打招呼、听不懂怎么办、数字时间', 2: '第二阶段 · 能生活:吃、买、行、住(广州版)', 3: '第三阶段 · 能融入:见家人、聊家常、和女朋友交流' };
function viewHome() {
  const due = dueIds().length, doneN = LESSONS.filter(l => S.done[l.id]).length;
  const nextL = LESSONS.find(l => !S.done[l.id]);
  const needSounds = !S.soundsDone && doneN === 0;
  const cur = needSounds ? 'sounds' : (nextL ? nextL.id : '');
  const first = doneN === 0 && !S.soundsDone && !Object.keys(S.srs).length;
  app.innerHTML = `
  <section class="hero">
    <h1>${first ? '从零开始,学会说粤语 👋' : '欢迎回来!继续学粤语'}</h1>
    <p class="muted" style="margin:0">用你熟悉的普通话来对照,先学发音,再学 ${LESSONS.length} 个生活场景,目标是能和本地人开口交流。每天 15 分钟就够。</p>
    ${first ? '<a class="btn primary" style="margin-top:14px" href="#/guide">📖 第一次来?先看「新手指南」(3 分钟)</a>' : ''}
    <div class="stats">
      <div class="stat"><b>🔥 ${streakNow()}</b><span>连续学习(天)</span></div>
      <div class="stat"><b>⭐ ${S.xp}</b><span>经验值</span></div>
      <div class="stat"><b>📚 ${Object.keys(S.srs).length}</b><span>已学词句</span></div>
      <div class="stat"><b>✅ ${doneN}/${LESSONS.length}</b><span>完成课程</span></div>
    </div>
  </section>

  ${first ? `<div class="card" style="margin-top:14px"><h2>新手 3 步,马上开始</h2><ol class="plan"><li><b>听声调</b>:去「发音」页,点喇叭听 6 个声调(5 分钟)。</li><li><b>学第 1 课</b>:跟着喇叭大声读,再做练习。</li><li><b>明天回来复习</b>:「复习」页会提醒你,记忆靠重复。</li></ol><p class="muted small" style="margin:0">看不懂词上面的小字?那是<b>粤拼</b>,点任意一个粤拼,会告诉你怎么拆。</p></div>` : ''}
  <div class="card" style="margin-top:14px;border:2px solid var(--brand)">
    <h2 style="margin-bottom:4px">💞 见家长速成路线(推荐先走这条)</h2>
    <p class="muted small" style="margin:0 0 10px">目标:先能和女朋友的妈妈(地道广州人)顺利聊起来。约 2 周,按顺序点:</p>
    <div class="chips">
      <a class="chip" href="#/sounds"><b>1.</b> 发音入门</a>
      ${['L1', 'L8', 'L18', 'L16', 'L21'].map((id, i) => `<a class="chip" href="#/lesson/${id}"><b>${i + 2}.</b> ${lessonById(id).title}</a>`).join('')}
      <a class="chip" href="#/particles"><b>7.</b> 语气词(吖、啦、喎…)</a>
    </div>
  </div>

  <div class="row" style="margin:16px 0 4px"><h2 class="grow" style="margin:0">学习路线</h2>${due ? `<a class="btn primary sm" href="#/review">复习 ${due} 个 →</a>` : ''}</div>
  <div class="path">
    <a class="step ${S.soundsDone ? 'done' : ''} ${cur === 'sounds' ? 'next' : ''}" href="#/sounds">
      <span class="ic">🔊</span><span><span class="tt">第 0 步:发音入门</span><br><span class="muted small">6 个声调 · 声母韵母 · 听辨小游戏(先学这个!)</span></span>
      <span class="st">${S.soundsDone ? '✔ 已完成' : cur === 'sounds' ? '从这里开始 →' : '建议先学'}</span></a>
    ${LESSONS.map((l, i) => `${STAGES[l.id] !== (LESSONS[i - 1] && STAGES[LESSONS[i - 1].id]) ? `<h3 class="stage">${STAGE_NAMES[STAGES[l.id]]}</h3>` : ''}
    <a class="step ${S.done[l.id] ? 'done' : ''} ${cur === l.id ? 'next' : ''}" href="#/lesson/${l.id}">
      <span class="ic">${l.icon}</span><span><span class="tt">第 ${i + 1} 课:${l.title}${S.seen.includes(l.id) ? '' : ' <span class="newtag">NEW</span>'}</span><br><span class="muted small">${l.desc}</span></span>
      <span class="st">${S.done[l.id] ? '✔ 已完成' : cur === l.id ? '继续 →' : `${l.words.length} 词 · ${l.phrases.length} 句`}</span></a>`).join('')}
  </div>

  <div class="card" style="margin-top:20px">
    <h2>每天这样学(约 15 分钟)</h2>
    <ol class="plan">
      <li><b>复习 5 分钟</b>:先清掉「复习」里到期的词句,这是记得牢的关键。</li>
      <li><b>新课 8 分钟</b>:点喇叭跟读每个词,<b>大声读出来</b>,再做练习题。</li>
      <li><b>听 2 分钟</b>:随便挑几个句子反复听,感受语调。</li>
    </ol>
    <p class="muted small" style="margin:8px 0 0">小窍门:先把「粤拼」当拐杖,熟悉后到「设置」里关掉它,逼自己靠听觉和汉字认。</p>
  </div>
  <div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
    <a class="card" href="#/guide"><b>📖 新手指南</b><br><span class="muted small">粤语是什么、粤拼怎么读、四周计划、常见误区</span></a>
    <a class="card" href="#/phrasebook"><b>🔎 常用句库</b><br><span class="muted small">想说什么就搜,和本地人交流时临场查</span></a>
    <a class="card" href="#/patterns"><b>🧩 句型模板(造句机)</b><br><span class="muted small">14 个万能框架,换个词就是新句子</span></a>
    <a class="card" href="#/particles"><b>💬 语气词</b><br><span class="muted small">呀 啦 喇 㗎 咩 喎 吖……听出长辈的语气</span></a>
    <a class="card" href="#/verify"><b>✅ 请女朋友帮我校对</b><br><span class="muted small">让地道广州人逐条检查,发给我修正</span></a>
    <a class="card" href="#/listen"><b>👂 听力实战</b><br><span class="muted small">不看字,只听一句,选意思</span></a>
    <a class="card" href="#/record"><b>🎙 真人录音 / 跟读对比</b><br><span class="muted small">让女朋友录标准音;自己跟读再对比</span></a>
  </div>`;
}

/* ================= 页面:发音 ================= */
let soundTab = 'tones';
function viewSounds(tab) {
  soundTab = tab || soundTab;
  const tabs = [['tones', '① 六个声调'], ['initials', '② 声母'], ['finals', '③ 韵母'], ['train', '④ 听辨游戏'], ['lazy', '⑤ 广州口音(懶音)']];
  const head = `<h1>发音入门</h1><div class="tabs" role="tablist">${tabs.map(([k, n]) => `<a class="tab ${soundTab === k ? 'on' : ''}" role="tab" href="#/sounds/${k}">${n}</a>`).join('')}</div>`;
  let body = '';
  if (soundTab === 'tones') {
    body = `
    <div class="card stack">
      <p style="margin:0"><b>声调是粤语的灵魂。</b>同一个音节,声调不同,意思完全不同。粤语日常用 <b>6 个声调</b>(普通话是 4 个)。粤拼用<b>数字 1–6</b>标在音节后面:<b>si1</b> = 声调 1。</p>
      <p style="margin:0" class="muted">下面 6 个字,拼音都是 si,只是声调不同。点喇叭,逐个听、逐个模仿。</p>
    </div>
    <div class="grid" style="margin-top:14px">${TONES.map(t => `
      <div class="card tone t${t.n}">
        ${contour(t.pitch)}
        <div class="n">声调 ${t.n} · ${t.name} <span class="muted small">(${t.num})</span></div>
        <div style="margin:2px 0">${ruby(t.ex[0], t.ex[1], 'lg')}</div>
        ${spk(t.ex[0])}
        <p class="small" style="color:var(--text);margin:8px 0 0">${t.tip}</p>
      </div>`).join('')}</div>
    <div class="card stack" style="margin-top:14px">
      <h3>声调和普通话的对照</h3>
      <p style="margin:0">粤语 <b>1 声</b> ≈ 普通话一声(妈 mā),<b>2 声</b> ≈ 普通话二声(麻 má)。其余 4 个声调普通话里没有,需要多听。先把 1、2、3 声练熟,就能分辨大部分情况。</p>
      <h3>入声(收音要"断")</h3>
      <p style="margin:0">以 <b>-p -t -k</b> 结尾的音节(如 食 sik6、八 baat3、十 sap6)叫入声,发音又短又"顿",不要拖长,也不要把 p/t/k 读出爆破声。它们的声调数字只会是 1、3、6。</p>
    </div>`;
  } else if (soundTab === 'initials' || soundTab === 'finals') {
    const isI = soundTab === 'initials', arr = isI ? INITIALS : FINALS;
    body = `<div class="card stack">
      <p style="margin:0">${isI ? '粤拼的<b>声母</b>(开头辅音)共 19 个。重点记住:<b>j 读 y</b>、<b>z c s 不卷舌</b>、多了一个 <b>ng</b> 开头。' : '<b>韵母</b>是音节的主体。重点:<b>aa(长)和 a(短)</b>是两个不同的音,如 <b>三 saam1</b> 对 <b>心 sam1</b>;<b>eo / oe / yu</b> 是圆唇音。'}</p>
      <p class="muted small" style="margin:0">一个音节 = 声母 + 韵母 + 声调。例:<b>你 nei5</b> = n + ei + 5;<b>我 ngo5</b> = ng + o + 5。</p></div>
    <div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${arr.map(([f, c, j, n]) => `
      <div class="cell"><span class="lab">${f}</span><div class="body">${ruby(c, j)}<div class="muted small">${esc(n)}</div></div>${spk(c)}</div>`).join('')}</div>`;
  } else if (soundTab === 'lazy') {
    body = lazyHTML();
  } else {
    body = viewTrainHTML();
  }
  app.innerHTML = head + body;
}

function lazyHTML() {
  const rows = [['你', 'nei5', 'lei5', 'n 读成 l'], ['男', 'naam4', 'laam4', 'n 读成 l'], ['我', 'ngo5', 'o5', 'ng 脱落'], ['牛', 'ngau4', 'au4', 'ng 脱落'], ['國', 'gwok3', 'gok3', 'gw 读成 g'], ['光', 'gwong1', 'gong1', 'gw 读成 g'], ['廣', 'gwong2', 'gong2', 'gw 读成 g']];
  return `<div class="card stack">
    <p style="margin:0"><b>懶音</b>是广州话里常见的"偷懒读法"。广州的年轻人和长辈都经常这样说,听起来和标准读音略有不同。</p>
    <p style="margin:0">你只需要做到两件事:<b>① 听得懂</b>(知道和标准读音是同一个字);<b>② 自己先说标准读音</b>。</p></div>
  <table class="cmp" style="margin-top:14px"><thead><tr><th>字</th><th>标准读音</th><th>常听到的懶音</th><th>规律</th><th></th></tr></thead><tbody>
  ${rows.map(([c, std, lz, why]) => `<tr><td>${ruby(c, std)}</td><td><b class="t${toneOf(std)}">${std}</b></td><td><b class="t${toneOf(lz)}">${lz}</b></td><td class="small">${why}</td><td>${spk(c)}</td></tr>`).join('')}</tbody></table>
  <div class="card" style="margin-top:14px"><h3>怎么练?</h3><p class="small muted" style="margin:0">喇叭播放的是标准读音。多听女朋友和阿姨说话,留意她们把「你」说成 lei5、把「我」说成 o5。听到了就知道是同一个字,不用纠结。</p></div>`;
}

/* ---- 声调听辨游戏 ---- */
let TT = null;
function trainStart(setId) { TT = { set: TONE_SETS.find(s => s.id === setId) || TONE_SETS[0], n: 0, score: 0, total: 10, cur: 0, picked: 0, prev: 0 }; trainNext(false); }
function trainNext(render = true) { let t; do { t = 1 + Math.floor(Math.random() * 6); } while (t === TT.prev); TT.cur = t; TT.prev = t; TT.picked = 0; if (render) { viewSounds('train'); } setTimeout(() => speak(TT.set.items[t - 1][0]), 200); }
function viewTrainHTML() {
  if (!TT) {
    return `<div class="card stack"><p style="margin:0">听一个字的发音,判断它是<b>第几声</b>。一共 10 题,答对 7 题就算过关 🎯</p>
      <div class="row">${TONE_SETS.map(s => `<button class="btn" data-act="trainStart" data-v="${s.id}">${s.name}</button>`).join('')}</div>
      <p class="muted small" style="margin:0">提示:先看看第 ① 页每个声调的音高曲线,再来挑战。刚开始分不出来很正常,多听几遍!</p></div>`;
  }
  if (TT.n >= TT.total) {
    const pass = TT.score >= 7;
    return `<div class="card" style="text-align:center"><div class="big-score">${TT.score}/${TT.total}</div>
      <p>${pass ? '🎉 过关!你已经能分辨基本声调了。' : '再练练,多听几遍就会好很多。'}</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="trainStart" data-v="${TT.set.id}">再来一次</button><button class="btn" data-act="trainReset">换一组</button></div></div>`;
  }
  const w = TT.set.items[TT.cur - 1], answered = !!TT.picked;
  return `<div class="card">
    <div class="row"><span class="muted small">第 ${TT.n + 1} / ${TT.total} 题 · ${TT.set.name} · 得分 ${TT.score}</span></div>
    <div class="bar" style="margin:8px 0"><i style="width:${TT.n / TT.total * 100}%"></i></div>
    <div class="qprompt"><div class="qlabel">这个字是第几声?</div>${spk(w[0], 'big')}
      ${answered ? `<div style="margin-top:6px">${ruby(w[0], w[1], 'lg')}</div>` : ''}</div>
    <div class="tgrid" style="margin-top:10px">${TONES.map(t => `<button class="tbtn t${t.n} ${answered ? (t.n === TT.cur ? 'ok' : (t.n === TT.picked ? 'bad' : '')) : ''}" data-act="trainPick" data-v="${t.n}" ${answered ? 'disabled' : ''}>${contour(t.pitch)}<b>${t.n}</b></button>`).join('')}</div>
    ${answered ? `<div class="fb ${TT.picked === TT.cur ? 'ok' : 'bad'}">${TT.picked === TT.cur ? '✅ 答对了!' : `❌ 正确答案是 <b>声调 ${TT.cur}</b>`}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" data-act="trainNext">${TT.n + 1 >= TT.total ? '查看结果' : '下一题'}</button></div>` : '<p class="muted small" style="text-align:center;margin:10px 0 0">按键盘 1–6 也可以作答</p>'}
  </div>`;
}

/* ================= 页面:课程 ================= */
function viewLesson(id) {
  const L = lessonById(id);
  if (!L) return viewHome();
  if (!S.seen.includes(id)) { S.seen.push(id); save(); }
  const idx = LESSONS.indexOf(L);
  app.innerHTML = `
  <a class="muted small" href="#/">← 返回学习路线</a>
  <h1 style="margin-top:6px">${L.icon} 第 ${idx + 1} 课:${L.title}</h1>
  <p class="muted">${L.desc}</p>
  ${L.goal ? `<div class="goal">🎯 <b>学完这课,你能:</b>${L.goal}</div>` : ''}
  <div class="tip" style="margin-bottom:12px"><b>💡 先看这个:</b><br>${L.tip}</div>
  ${L.pit ? `<div class="pit">⚠ <b>易错点:</b>${L.pit}</div>` : ''}
  ${legendHTML()}
  ${L.culture ? `<div class="culture">🌏 <b>本地小贴士:</b>${L.culture}</div>` : ''}
  <p class="muted small" style="margin:14px 0 8px">学习方法:<b>先听 → 跟着大声读 → 遮住粤拼自测 → 做练习</b>。每个词至少跟读 3 遍。</p>
  <div class="row" style="margin:6px 0"><h2 class="grow" style="margin:0">① 学词汇 <span class="muted small">(${L.words.length} 个)</span></h2>
    <button class="btn sm" data-act="playAll" data-v="${L.id}w">▶ 连续播放</button></div>
  <div class="grid" style="margin-bottom:22px">${L.words.map(wordCard).join('')}</div>
  <div class="row" style="margin:6px 0"><h2 class="grow" style="margin:0">② 学句子 <span class="muted small">(${L.phrases.length} 句)</span></h2>
    <button class="btn sm" data-act="playAll" data-v="${L.id}p">▶ 连续播放</button></div>
  <div class="stack" style="margin-bottom:24px">${L.phrases.map(phraseCard).join('')}</div>
  ${dialogHTML(L)}
  <div class="card row" style="justify-content:space-between">
    <div><b>${L.dialog ? '④' : '③'} 做练习</b><br><span class="muted small">12 道题:听音辨义、认字、排句子。正确率 ≥ 70% 通过,并加入复习。</span></div>
    <a class="btn primary" href="#/practice/${L.id}">开始练习 →</a></div>`;
}

const legendHTML = () => `<div class="legend"><b>声调颜色:</b>${TONES.map(t => `<span class="t${t.n}"><b>${t.n}</b> ${t.name}</span>`).join('')}<span class="muted">· 点任意粤拼,看它怎么拆</span></div>`;

/* 情景对话:可遮住译文、可选择"我演 A / 我演 B"(对方台词模糊,点一下显示) */
function dialogHTML(L) {
  const d = L.dialog; if (!d) return '';
  return `<div class="row" style="margin:6px 0"><h2 class="grow" style="margin:0">③ 情景对话:${d.title}</h2>
      <button class="btn sm" data-act="playDialog" data-v="${L.id}">▶ 播放整段</button></div>
    <div class="card dlg" id="dlg" style="margin-bottom:24px">
      <div class="row small" style="margin-bottom:10px">
        <span class="muted">练习方式:</span>
        <button class="tab on" data-act="role" data-v="">看全文</button>
        <button class="tab" data-act="role" data-v="A">我演「${d.roles.A}」</button>
        <button class="tab" data-act="role" data-v="B">我演「${d.roles.B}」</button>
        <label class="switch small" style="margin-left:auto"><input type="checkbox" data-act="hideM"> 遮住译文</label>
      </div>
      <div class="stack">${d.lines.map(l => `
        <div class="line ${l.who}" data-act="revealLine"><div class="bubble">
          <div class="who">${d.roles[l.who]}</div>
          <div class="row" style="flex-wrap:nowrap">${spk(l.it.c)}<div class="txt">${ruby(l.it.c, l.it.j, 'md')}</div></div>
          <div class="mn muted small">${esc(l.it.m)}</div>
        </div></div>`).join('')}</div>
      <p class="muted small" style="margin:12px 0 0">玩法:选「我演 …」后,你要演的台词会模糊,先自己说出来,再点一下看答案。</p>
    </div>`;
}

/* ================= 页面:练习 ================= */
let Q = null;
function buildQuiz(L) {
  const wt = ['listen-m', 'read-m', 'm-c', 'listen-c'];
  const qs = shuffle(L.words).slice(0, 7).map((it, i) => ({ type: wt[i % 4], it }));
  shuffle(L.phrases).slice(0, 5).forEach((it, i) => qs.push({ type: i % 2 ? 'listen-m' : 'arrange', it }));
  qs.forEach(q => {
    if (q.type === 'arrange') { q.tokens = shuffle(q.it.w.map((w, id) => ({ id, c: w[0], j: w[1] }))); q.built = []; }
    else {
      const key = (q.type === 'm-c' || q.type === 'listen-c') ? 'c' : 'm';
      const pool = ALL.filter(x => x.k === q.it.k && x[key] !== q.it[key]);
      const order = shuffle(pool.filter(x => x.L === L.id)).concat(shuffle(pool.filter(x => x.L !== L.id)));
      const seen = new Set([q.it[key]]), pick = [];
      for (const x of order) { if (!seen.has(x[key])) { seen.add(x[key]); pick.push(x); if (pick.length === 3) break; } }
      q.key = key; q.opts = shuffle([q.it].concat(pick)).map(x => ({ it: x, ok: x === q.it }));
    }
  });
  return shuffle(qs);
}
function startPractice(id) {
  const L = lessonById(id); if (!L) return viewHome();
  Q = { L, qs: buildQuiz(L), i: 0, score: 0, wrong: [] };
  renderQ(true);
}
function answerBlock(it) { return `<div class="row" style="margin-top:6px">${spk(it.c)}<div>${ruby(it.c, it.j, 'md')}<div class="mn muted small">${esc(it.m)}</div>${it.n ? `<div class="nt small">💡 ${esc(it.n)}</div>` : ''}</div></div>`; }
function renderQ(auto) {
  if (!Q) return;
  if (Q.i >= Q.qs.length) return renderResult();
  const q = Q.qs[Q.i], it = q.it, done = q.done;
  let prompt = '', body = '';
  const listen = q.type === 'listen-m' || q.type === 'listen-c';
  if (q.type === 'listen-m') prompt = `<div class="qlabel">听一听,选出它的意思</div>${spk(it.c, 'big')}`;
  if (q.type === 'listen-c') prompt = `<div class="qlabel">听一听,选出你听到的</div>${spk(it.c, 'big')}`;
  if (q.type === 'read-m') prompt = `<div class="qlabel">这是什么意思?</div>${ruby(it.c, it.j, it.k === 'p' ? 'md' : 'lg')} ${spk(it.c)}`;
  if (q.type === 'm-c') prompt = `<div class="qlabel">「${esc(it.m)}」用粤语怎么说?</div>`;
  if (q.type === 'arrange') {
    prompt = `<div class="qlabel">把词语排成正确的粤语句子</div><div style="font-size:1.25rem;font-weight:700;margin-bottom:6px">${esc(it.m)}</div>`;
    const used = new Set(q.built);
    body = `<div class="slots ${listen ? 'nojp' : ''}">${q.built.length ? q.built.map((id, k) => `<button class="tok" data-act="untok" data-i="${k}" ${done ? 'disabled' : ''}>${ruby(q.tokens.find(t => t.id === id).c, q.tokens.find(t => t.id === id).j)}</button>`).join('') : '<span class="muted small">点下面的词,按顺序放到这里</span>'}</div>
      <div class="row" style="margin-top:12px;justify-content:center">${q.tokens.map(t => `<button class="tok ${used.has(t.id) ? 'used' : ''}" data-act="tok" data-i="${t.id}" ${done ? 'disabled' : ''}>${ruby(t.c, t.j)}</button>`).join('')}</div>`;
    if (!done) body += `<div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="check" ${q.built.length === q.tokens.length ? '' : 'disabled'}>检查</button></div>`;
  } else {
    body = `<div class="opts ${q.type === 'listen-c' ? 'nojp' : ''}">${q.opts.map((o, i) => {
      const cls = done ? (o.ok ? 'ok' : (q.picked === i ? 'bad' : '')) : '';
      return `<button class="opt ${cls}" data-act="opt" data-i="${i}" ${done ? 'disabled' : ''}><kbd>${i + 1}</kbd>${q.key === 'c' ? ruby(o.it.c, o.it.j, 'md') : `<span>${esc(o.it.m)}</span>`}</button>`;
    }).join('')}</div>`;
  }
  let fb = '';
  if (done) fb = `<div class="fb ${q.right ? 'ok' : 'bad'}"><b>${q.right ? '✅ 答对了!' : '❌ 再记一下:'}</b><div class="ans">${answerBlock(it)}</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-act="next">${Q.i + 1 >= Q.qs.length ? '查看结果' : '继续'}</button></div>`;
  app.innerHTML = `
  <div class="row"><a class="muted small" href="#/lesson/${Q.L.id}">✕ 退出</a><span class="grow"></span><span class="muted small">${Q.i + 1} / ${Q.qs.length}</span></div>
  <div class="bar" style="margin:8px 0"><i style="width:${Q.i / Q.qs.length * 100}%"></i></div>
  <div class="card"><div class="qprompt">${prompt}</div>${body}${fb}</div>`;
  if (auto && listen && !done) setTimeout(() => speak(it.c), 250);
}
function finishAnswer(q, right) {
  q.done = true; q.right = right;
  if (right) { Q.score++; addXP(10); } else Q.wrong.push(q.it);
  renderQ();
  setTimeout(() => speak(q.it.c), 120);
}
function renderResult() {
  const L = Q.L, n = Q.qs.length, pct = Q.score / n, pass = pct >= 0.7;
  if (pass) {
    const firstTime = !S.done[L.id];
    S.done[L.id] = true;
    if (firstTime) addXP(30);
  }
  // 加入复习:通过后全部加入;答错的立即到期
  if (pass) L.words.concat(L.phrases).forEach(it => { if (!S.srs[it.id]) S.srs[it.id] = { box: 0, due: today() }; });
  Q.wrong.forEach(it => { S.srs[it.id] = { box: 0, due: today() }; });
  save(); updateBadge();
  const next = LESSONS[LESSONS.indexOf(L) + 1];
  app.innerHTML = `<div class="card" style="text-align:center">
    <div class="big-score">${Q.score}/${n}</div>
    <h2>${pass ? '🎉 通过!本课已完成' : '差一点,再练一次吧'}</h2>
    <p class="muted">${pass ? '这一课的词和句子已加入「复习」,明天记得回来复习。' : '正确率达到 70% 就算通过。先回去再听听词汇和句子。'}</p>
    ${Q.wrong.length ? `<div style="text-align:left;margin:14px 0"><h3>需要再看看</h3><div class="stack">${Q.wrong.map(phraseCardOrWord).join('')}</div></div>` : ''}
    <div class="row" style="justify-content:center">
      <a class="btn" href="#/lesson/${L.id}">回到课文</a>
      <button class="btn ${pass ? '' : 'primary'}" data-act="retry">再练一次</button>
      ${pass && next ? `<a class="btn primary" href="#/lesson/${next.id}">下一课 →</a>` : ''}
    </div></div>`;
  Q = null;
}
const phraseCardOrWord = it => it.k === 'p' ? phraseCard(it) : wordCard(it);

/* ================= 页面:复习 ================= */
let Rv = null;
function viewReview() {
  if (!Rv) {
    const ids = shuffle(dueIds()).slice(0, 20);
    if (!ids.length) {
      const learned = Object.keys(S.srs).length;
      app.innerHTML = `<h1>复习</h1><div class="card" style="text-align:center"><div style="font-size:3rem">🎉</div><h2>${learned ? '今天的复习都完成了!' : '还没有需要复习的内容'}</h2>
        <p class="muted">${learned ? '明天再来,记忆会更牢。' : '完成一课的练习后,这一课的词句就会进入复习队列。'}</p>
        <a class="btn primary" href="#/">${learned ? '去学新课' : '开始第一课'}</a></div>`;
      return;
    }
    Rv = { q: ids, i: 0, shown: false, total: ids.length, good: 0 };
    return renderCard(true);
  }
  renderCard();
}
function renderCard(auto) {
  if (!Rv) return;
  if (Rv.i >= Rv.q.length) {
    addXP(Rv.good * 5);
    const r = Rv; Rv = null; updateBadge();
    app.innerHTML = `<h1>复习</h1><div class="card" style="text-align:center"><div style="font-size:3rem">✅</div><h2>本轮复习完成</h2><p class="muted">共 ${r.total} 个,记得 ${r.good} 个。+${r.good * 5} 经验值</p>
      <div class="row" style="justify-content:center">${dueIds().length ? '<a class="btn primary" href="#/review" data-act="again">继续复习</a>' : ''}<a class="btn" href="#/">返回首页</a></div></div>`;
    return;
  }
  const it = ITEMS[Rv.q[Rv.i]];
  app.innerHTML = `<div class="row"><h1 class="grow" style="margin:0">复习</h1><span class="muted small">${Rv.i + 1} / ${Rv.q.length}</span></div>
  <div class="bar" style="margin:8px 0 14px"><i style="width:${Rv.i / Rv.q.length * 100}%"></i></div>
  <div class="card flash">
    <div class="qlabel">${Rv.shown ? '答案' : '先自己想想:这是什么意思?怎么读?'}</div>
    <div class="${Rv.shown ? '' : 'nojp'}">${ruby(it.c, it.j, it.k === 'p' ? 'md' : 'lg')}</div>
    ${spk(it.c, 'big')}
    ${Rv.shown ? `<div style="font-size:1.2rem;font-weight:700">${esc(it.m)}</div>${it.n ? `<div class="nt small" style="color:var(--brand)">💡 ${esc(it.n)}</div>` : ''}` : ''}
  </div>
  <div class="row" style="justify-content:center;margin-top:14px">${Rv.shown ? `
    <button class="btn" data-act="grade" data-v="0">😵 不记得</button>
    <button class="btn" data-act="grade" data-v="1">🤔 有点难</button>
    <button class="btn primary" data-act="grade" data-v="2">😄 记得</button>` : '<button class="btn primary" data-act="reveal">显示答案</button>'}</div>`;
  if (auto || !Rv.shown) setTimeout(() => { if (Rv && !Rv.shown) speak(it.c); }, 250);
}

/* ================= 页面:语法 ================= */
function viewGrammar() {
  app.innerHTML = `<h1>语法速查</h1>
  <div class="card stack">
    <p style="margin:0">好消息:粤语和普通话的<b>语序基本一样</b>(主语 + 动词 + 宾语),你不用重新学句子结构。区别主要在<b>常用词</b>和一些<b>助词</b>。</p>
    <p style="margin:0" class="muted small">粤语口语的书写用<b>繁体字</b>,并有一批口语专用字(如 嘅、咗、冇、啲、喺、嚟、佢、哋)。这些字看起来陌生,但数量不多,学几课就眼熟。</p>
  </div>
  <div class="stack" style="margin-top:16px">${GRAMMAR.map(g => `<div class="card"><h2>${g.title}</h2><p>${g.body}</p><div class="stack">${g.ex.map(phraseCard).join('')}</div></div>`).join('')}</div>
  <div class="card" style="margin-top:16px"><h2>普通话 → 粤语 常用词对照</h2>
    <p class="muted small">这些词和普通话完全不同,是日常最高频的,值得单独背。</p>
    <table class="cmp"><thead><tr><th>普通话</th><th>粤语</th><th></th></tr></thead><tbody>${COMPARE.map(([m, w]) => `<tr><td>${esc(m)}</td><td>${ruby(w.c, w.j)}</td><td>${spk(w.c)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ================= 页面:新手指南 ================= */
function viewGuide() {
  const ex = [['你', 'nei5', 'n + ei + 5', '像普通话"内",但声调是 5(低升)'], ['我', 'ngo5', 'ng + o + 5', '"哦"前面加一个鼻音 ng(像"嗯")'], ['好', 'hou2', 'h + ou + 2', '像"好"但读 hou,声调 2(高升)'], ['三', 'saam1', 's + aam + 1', 'aa 是长音,嘴张大'], ['食', 'sik6', 's + ik + 6', '以 k 收尾,短促,不发出完整的 k']];
  const sec = (title, body, open) => `<details class="card g" ${open ? 'open' : ''}><summary>${title}</summary><div class="gbody">${body}</div></details>`;
  app.innerHTML = `<h1>新手指南</h1>
  <p class="muted">零基础也不用怕。花 3 分钟读完,后面学起来会轻松很多。</p>
  <div class="stack">
  ${sec('1. 粤语是什么?和普通话差多少?', `
    <p><b>粤语</b>(也叫广东话、白话)是广东大部分地区、香港、澳门以及许多海外华人社区日常使用的语言。</p>
    <p>粤语和普通话是<b>两种不同的语言</b>,不只是"口音"。它们用同一套汉字,但<b>读音、常用词、部分说法</b>都不一样,所以会普通话并不能直接听懂粤语。</p>
    <p><b>对你有利的:</b></p><ul><li>语序大体和普通话一样(我 + 食 + 飯 = 我吃饭);</li><li>很多词一看就懂;</li><li>你已经会汉字,只需要学新的读音。</li></ul>
    <p><b>需要新学的:</b></p><ul><li><b>读音</b>,尤其是 6 个声调;</li><li>一批口语词:<b>食</b>(吃)、<b>飲</b>(喝)、<b>睇</b>(看)、<b>佢</b>(他/她);</li><li>一些口语字:<b>嘅 咗 冇 啲 喺</b>。</li></ul>`, true)}
  ${sec('2. 三个关键概念:粤拼、声调、繁体字', `
    <p><b>粤拼(Jyutping)</b>:用拉丁字母标注粤语读音的方案,是目前最通行的一种。本站每个字上方的小字就是粤拼,如 <b>nei5 hou2</b>(你好)。</p>
    <p><b>声调</b>:同一个音节,音高不同意思就不同。粤拼用<b>数字 1–6</b>放在音节后面表示声调。</p>
    <p><b>繁体字</b>:粤语书面语(尤其香港、澳门)用繁体字。学习阶段你不用刻意背字:本站每个字都有粤拼,边听边看,自然就认得了。</p>`)}
  ${sec('3. 粤拼怎么读?(一步一步拆)', `
    <p>一个音节 = <b>声母</b>(开头的辅音)+ <b>韵母</b>(主体)+ <b>声调数字</b>。例如:</p>
    <table class="cmp"><thead><tr><th>字</th><th>粤拼</th><th>拆开</th><th>读法提示</th><th></th></tr></thead><tbody>
    ${ex.map(([c, j, a, h]) => `<tr><td>${ruby(c, j)}</td><td><b>${j}</b></td><td>${a}</td><td class="small">${h}</td><td>${spk(c)}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">想系统练习,去「发音」页:先听声调,再看声母韵母。</p>`)}
  ${sec('4. 六个声调怎么记?', `
    <p>把声调想成<b>唱歌</b>:</p>
    <ul><li><b>平调有三个</b>:声调 1(高)、3(中)、6(低)——音高不变,只是高低不同;</li>
    <li><b>上升有两个</b>:声调 2(从中往高)、5(从低往中)——像"嗯?"的疑问感;</li>
    <li><b>下降一个</b>:声调 4(往下沉到最低)。</li></ul>
    <p><b>练习方法:</b>反复读 <b>詩 史 試 時 市 是</b>(si1 si2 si3 si4 si5 si6),像唱音阶。一边读一边用手比划:平调手不动、升调手往上抬、降调手往下压。</p>
    <p><b>优先级:</b>刚开始先分清 <b>1 / 3 / 6</b>(高中低)和 <b>2</b>(升),这四个能解决大部分情况。</p>
    <a class="btn sm" href="#/sounds/tones">去听 6 个声调 →</a>`)}
  ${sec('5. 最常见的 6 个发音误区', `
    <ol class="plan">
    <li><b>j 读 y,不是普通话的 j。</b>野 je5 像 "ye",人 jan4 像 "yan"。</li>
    <li><b>z c s 不卷舌。</b>普通话的 zh ch sh,在粤语里都读 z c s。</li>
    <li><b>aa 和 a 是两个音。</b>三 saam1(长)≠ 心 sam1(短)。</li>
    <li><b>-p -t -k 收尾要"顿住"。</b>食 sik6 的 k 不要发出爆破声,嘴型到位就停。</li>
    <li><b>别用普通话声调去套。</b>"好"普通话是 hǎo(降升),粤语 hou2 是高升。</li>
    <li><b>别被"懶音"吓到。</b>很多本地人会把 n 说成 l(你 → lei5)、把 ng 省掉(我 → o5)。还有 gw/kw 读成 g/k(國 gwok3 → gok3)。广州的长辈这样说很常见,你听到了知道是同一个字就行,自己按标准读。</li></ol>`)}
  ${sec('6. 学习计划:2 周见家长速成 / 5 周完整版', `
    <p><b>如果很快要见女朋友的妈妈,先走「速成路线」(约 2 周):</b></p>
    <ol class="plan"><li>发音入门(声调听辨过关)</li>
    <li>第 1 课 打招呼 → 听不懂怎么办(这是救命课)</li>
    <li>广州美食与饮早茶 → <b>见女朋友的妈妈</b> → 和长辈聊家常</li>
    <li>「语气词」页:重点学 呀、啦、吖、喎、咯</li></ol>
    <p><b>5 周完整版:</b></p>
    <table class="cmp"><thead><tr><th>周</th><th>学什么</th><th>目标</th></tr></thead><tbody>
    <tr><td><b>第 1 周</b></td><td>发音入门 · 打招呼 · 听不懂怎么办 · 数字与价钱 · 日期时间</td><td class="small">能自我介绍,会请对方说慢一点</td></tr>
    <tr><td><b>第 2 周</b></td><td>茶餐厅点餐 · 点餐进阶 · 广州美食与饮早茶 · 街市买菜与付款</td><td class="small">能点餐、饮早茶、买菜付款</td></tr>
    <tr><td><b>第 3 周</b></td><td>购物讲价 · 交通问路 · 广州地名与出行 · 酒店与打车</td><td class="small">能逛街、问路、打车</td></tr>
    <tr><td><b>第 4 周</b></td><td>见女朋友的妈妈 · 家人日常 · 和长辈聊家常 · 和女朋友</td><td class="small">能和家人聊天、说心里话</td></tr>
    <tr><td><b>第 5 周</b></td><td>节日祝福 · 闲聊 · 看医生 · 加联系方式 · 地道口语 · 紧急求助 · 句型模板与语气词</td><td class="small">能和广州人聊上 5 分钟</td></tr></tbody></table>
    <p class="small muted">每周末把本周的课重做一遍练习,并清空「复习」。节奏可按自己的进度调整。</p>`)}
  ${sec('7. 每天怎么练?(跟读四步法)', `
    <ol class="plan"><li><b>听</b>:先点喇叭听 2 遍,不看字,感受语调。</li>
    <li><b>看</b>:再看汉字和粤拼,对一遍。</li>
    <li><b>跟读</b>:<b>大声读出来</b>,模仿声调的起伏,不要只在心里默念。</li>
    <li><b>自测</b>:到「设置」关掉粤拼,只看汉字能不能读出来。</li></ol>
    <p>另外:<b>每天 15 分钟比周末 2 小时更有效</b>;复习别跳过。想多听,可以看港剧、听粤语歌(比如 Beyond 的《海闊天空》),跟着唱对声调很有帮助。</p>`)}
  ${sec('8. 和本地人交流的小贴士', `
    <ul><li><b>先说短句就够了。</b>"凍奶茶,唔該" 这样的 词 + 唔該 就能把事情办成。</li>
    <li><b>听不懂别慌。</b>说:唔好意思 → 唔該你講慢啲 → 唔該你再講一次(第 2 课)。</li>
    <li><b>如果对方改说英语或普通话:</b>笑着说「我想練習廣東話」,大部分人会愿意配合。</li>
    <li><b>语气词让你听起来更自然:</b>呀 aa3、啦 laa1、喇 laa3。</li>
    <li><b>说错没关系。</b>本地人通常会为你愿意开口而高兴。</li>
    <li><b>用「句库」临场查:</b>想说什么,搜普通话关键词就能找到对应的粤语说法。</li></ul>
    <a class="btn sm" href="#/phrasebook">打开常用句库 →</a>`)}
  ${sec('9. 和女朋友的妈妈交流:实战指南', `
    <p>她妈妈是地道广州人、听不懂普通话,所以你说的每一句粤语都很珍贵。几个实用原则:</p>
    <ol class="plan">
    <li><b>称呼先问女朋友。</b>最稳妥是叫「阿姨」(aa3 ji1)。不确定就问她:「我應該點稱呼你媽媽呀?」</li>
    <li><b>开口三件事:笑、慢、复述。</b>听不懂就笑着说「阿姨,唔該你講慢啲」(第 2 课);抓住关键词,重复一遍确认:「你係話……呀?」(你是说……吗?)</li>
    <li><b>老人家的口音和习惯:</b>语速快,常把 n 说成 l(你 → lei5)、gw/kw 说成 g/k(國 → gok3),爱用语气词(吖、啦、喎、咯)。她说「食多啲啦」「飲啖湯吖」就是在关心你。</li>
    <li><b>她大概会问你:</b>你幾多歲?做咩工作?食咗飯未?屋企有邊啲人?幾時結婚?——第 21 课有完整回答。</li>
    <li><b>能加分的小事:</b>夸饭菜「好好食」、说「食飽喇,多謝阿姨」、主动「我嚟洗碗」、走时说「下次再嚟探阿姨」。</li>
    <li><b>让女朋友当你的老师:</b>用「校对」页(首页或设置里)让她逐条听、逐条看,告诉你哪里不地道。这是提高准确度最快的办法。</li></ol>
    <div class="row"><a class="btn sm" href="#/lesson/L16">去学「见女朋友的妈妈」→</a><a class="btn sm" href="#/verify">请她帮我校对 →</a></div>`)}
  ${sec('10. 广州 vs 香港:说法不同的地方', `
    <p>本站以<b>广州说法</b>为主。下面这些地方香港说法不同,和香港人交流时用得上:</p>
    <table class="cmp"><thead><tr><th>意思</th><th>广州(本站)</th><th>香港</th></tr></thead><tbody>
    <tr><td>外卖/带走</td><td><b>打包</b></td><td>帶走、外賣(打包 = 吃剩的带走)</td></tr>
    <tr><td>菜单</td><td><b>菜單</b></td><td>餐牌</td></tr>
    <tr><td>聊天软件</td><td><b>微信</b></td><td>WhatsApp</td></tr>
    <tr><td>报警/急救</td><td><b>110 / 120</b></td><td>999</td></tr>
    <tr><td>交通</td><td><b>扫码、羊城通</b></td><td>八達通</td></tr>
    <tr><td>夹英文</td><td>较少</td><td>很多(OK、sorry、check in…)</td></tr></tbody></table>
    <p class="small muted">听到对方的说法,跟着用就对了。</p>
    <p><b>少用句尾"嗎"。</b>普通话习惯用"…吗?"提问,粤语更常用 <b>咩</b>、<b>係咪</b>(是不是)、<b>A唔A</b>(得唔得閒)和句尾 <b>呀</b>。</p>`)}
  ${sec('11. 常见问题', `
    <p><b>为什么有些词的读音和书上不一样?</b><br>粤语有"变调":某些词口语里声调会变,例如「朋友」词典读 pang4 jau5,口语常说 pang4 jau2。本站标的是常见读音,遇到本地人读得不同,以对方为准。</p>
    <p><b>粤语到底有几个声调?</b><br>传统说法是 9 个(包含 3 个入声),粤拼把入声并入后是 6 个。日常学 6 个就够了。</p>
    <p><b>必须先学繁体字吗?</b><br>不用。先听说,边学边认;本站每个字都标了粤拼。</p>
    <p><b>本站的发音是真人录音吗?</b><br>不是,用的是浏览器自带的粤语语音合成。它可能和真人有细微差别,建议配合真人对话、影视作品对照校正。</p>
    <p><b>香港和广州的粤语有区别吗?</b><br>基本互通,有少量用词和口音差异(香港多英语借词)。本站以广州说法为主,并标出香港不同的说法。</p>
    <p><b>粤拼和其他拼音方案有什么关系?</b><br>粤拼是香港语言学学会 1993 年制定的方案,目前使用最广。</p>`)}
  </div>
  <div class="row" style="margin-top:18px"><a class="btn primary" href="#/sounds">开始发音入门 →</a><a class="btn" href="#/lesson/L1">直接学第 1 课</a></div>`;
}

/* ================= 页面:常用句库(可搜索) ================= */
let pbq = '';
const PART_GROUP = { id: 'PART', icon: '💬', title: '语气词例句' };
function allPhrases() {
  const seen = new Set(), out = [];
  LESSONS.forEach(L => {
    const add = it => { if (seen.has(it.c)) return; seen.add(it.c); out.push({ it, L }); };
    L.phrases.forEach(add);
    if (L.dialog) L.dialog.lines.forEach(l => add(l.it));
  });
  PARTICLES.forEach(q => q.ex.forEach(it => { if (seen.has(it.c)) return; seen.add(it.c); out.push({ it, L: PART_GROUP }); }));
  return out;
}
let pbmode = 'p';
function allWordRows() {
  const seen = new Set(), out = [];
  LESSONS.forEach(L => L.words.forEach(w => { const k = w.c + '|' + w.j; if (seen.has(k)) return; seen.add(k); out.push({ it: w, L }); }));
  return out;
}
function pbListHTML() {
  const q = pbq.trim().toLowerCase(), isW = pbmode === 'w';
  const hit = it => !q || it.m.toLowerCase().includes(q) || it.c.includes(q) || it.j.toLowerCase().includes(q) || (it.n || '').toLowerCase().includes(q);
  const rows = (isW ? allWordRows() : allPhrases()).filter(({ it }) => hit(it));
  if (!rows.length) return '<div class="card muted">没有找到。试试换个关键词,比如「多少钱」「厕所」「谢谢」「nei5」。</div>';
  let html = `<p class="muted small">共 ${rows.length} ${isW ? '个词' : '句'}</p>`;
  LESSONS.concat([PART_GROUP]).forEach(L => {
    const rs = rows.filter(r => r.L === L);
    if (rs.length) html += `<h3 class="stage">${L.icon} ${L.title}</h3><div class="${isW ? 'grid' : 'stack'}">${rs.map(r => (isW ? wordCard(r.it) : phraseCard(r.it))).join('')}</div>`;
  });
  return html;
}
function viewPhrasebook() {
  app.innerHTML = `<h1>常用句库 / 词库</h1>
  <p class="muted">想说什么,直接搜。支持搜<b>普通话</b>、<b>粤语汉字</b>或<b>粤拼</b>。点喇叭听发音。</p>
  <div class="tabs"><button class="tab ${pbmode === 'p' ? 'on' : ''}" data-act="pbmode" data-v="p">句子</button><button class="tab ${pbmode === 'w' ? 'on' : ''}" data-act="pbmode" data-v="w">词汇</button></div>
  <input id="pbq" class="search" type="search" placeholder="例如:多少钱 / 洗手间 / 唔該 / nei5" value="${esc(pbq)}" autocomplete="off">
  <div id="pbl">${pbListHTML()}</div>`;
}

/* ================= 页面:句型模板(造句机) ================= */
function fillPattern(i, k, say) {
  const p = PATTERNS[i], sl = p.slots[k];
  const c = p.pre[0] + sl[0] + p.suf[0], j = [p.pre[1], sl[1], p.suf[1]].filter(Boolean).join(' ');
  $('#out' + i).innerHTML = `<div class="pcard">${spk(c)}<div class="body">${ruby(c, j, 'md')}<div class="mn muted">${esc(p.mT.replace('{}', sl[2]))}</div></div></div>`;
  document.querySelectorAll(`#pat${i} .chip`).forEach((b, n) => b.classList.toggle('on', n === k));
  if (say) speak(c);
}
function viewPatterns() {
  app.innerHTML = `<h1>句型模板(造句机)</h1>
  <p class="muted">学会这 ${PATTERNS.length} 个万能框架,换一个词就能说出新句子。<b>点下面的词,马上生成整句并朗读。</b>先把框架背熟,比背单句有用得多。</p>
  <div class="stack">${PATTERNS.map((p, i) => `<div class="card" id="pat${i}"><h2>${i + 1}. ${esc(p.title)}</h2>
    <p class="muted small" style="margin:0 0 8px">${esc(p.note)}</p>
    <div class="chips">${p.slots.map((sl, k) => `<button class="chip" data-act="fill" data-p="${i}" data-s="${k}"><span class="cn md" lang="zh-HK">${esc(sl[0])}</span><span class="small muted">${esc(sl[2])}</span></button>`).join('')}</div>
    <div id="out${i}" style="margin-top:10px"></div></div>`).join('')}</div>`;
  PATTERNS.forEach((p, i) => fillPattern(i, 0, false));
}

/* ================= 页面:语气词 ================= */
function viewParticles() {
  const quick = [['让问句更柔和', '呀', 'aa3'], ['建议、催促、答应', '啦', 'laa1'], ['情况变了、已经发生', '喇 / 咯', 'laa3 / lok3'], ['强调"我告诉你"', '㗎', 'gaa3'], ['惊讶、反问', '咩', 'me1'], ['"只是……而已"', '啫 / 咋', 'ze1 / zaa3'], ['听说、突然想起来', '喎', 'wo3'], ['"当然啦"', '囉', 'lo1'], ['推测"大概"', '啩', 'gwaa3'], ['劝人吃东西、做事', '吖', 'aa1']];
  app.innerHTML = `<h1>语气词</h1>
  <p class="muted">语气词放在句末,决定一句话听起来"像不像本地人"。长辈说话里特别多,听懂它们,你就能听出她是在关心你、催你,还是在开玩笑。</p>
  <div class="card"><h2>想表达什么,用哪个?</h2><table class="cmp"><thead><tr><th>想表达</th><th>用</th><th>粤拼</th></tr></thead><tbody>${quick.map(([a, b, c]) => `<tr><td>${a}</td><td class="cn md" lang="zh-HK">${b}</td><td class="small">${c}</td></tr>`).join('')}</tbody></table></div>
  <div class="stack" style="margin-top:14px">${PARTICLES.map(q => `<div class="card"><div class="row"><span style="font-size:2rem;font-family:var(--cn);font-weight:700" lang="zh-HK">${q.c}</span><b class="t${toneOf(q.j)}">${q.j}</b><span class="muted small" style="margin-left:auto">${esc(q.like)}</span></div>
    <p style="margin:6px 0 10px">${esc(q.use)}</p><div class="stack">${q.ex.map(phraseCard).join('')}</div></div>`).join('')}</div>`;
}

/* ================= 页面:请女朋友帮我校对 ================= */
const vkey = it => it.c + '|' + it.j;
function verifyGroups() {
  const seen = new Set(), groups = [];
  const add = (g, it) => { const k = vkey(it); if (seen.has(k)) return; seen.add(k); g.items.push(it); };
  LESSONS.forEach(L => {
    const g = { id: L.id, title: `${L.icon} ${L.title}`, items: [] };
    L.words.forEach(it => add(g, it)); L.phrases.forEach(it => add(g, it));
    if (L.dialog) L.dialog.lines.forEach(l => add(g, l.it));
    groups.push(g);
  });
  const gp = { id: 'PART', title: '💬 语气词例句', items: [] };
  PARTICLES.forEach(q => q.ex.forEach(it => add(gp, it)));
  groups.push(gp);
  return groups;
}
function rvStat(items) { let ok = 0, bad = 0; items.forEach(it => { const r = S.rv[vkey(it)]; if (r) { if (r.s === 'ok') ok++; else bad++; } }); return { ok, bad, total: items.length }; }
function rvReport() {
  let ok = 0, bad = 0; const lines = [];
  verifyGroups().forEach(g => g.items.forEach(it => {
    const r = S.rv[vkey(it)]; if (!r) return;
    if (r.s === 'ok') ok++; else { bad++; lines.push(`✘ ${it.c} | ${it.j} | ${it.m}${r.note ? ' | 正确说法:' + r.note : ''}`); }
  }));
  return `粵語通 校对结果:已校对 ${ok + bad} 条,有问题 ${bad} 条\n` + lines.join('\n');
}
let verifyArg = '';
function viewVerify(arg) {
  verifyArg = arg || '';
  const groups = verifyGroups();
  if (!arg) {
    const tot = groups.reduce((a, g) => a + g.items.length, 0);
    const st = groups.reduce((a, g) => { const x = rvStat(g.items); return { ok: a.ok + x.ok, bad: a.bad + x.bad }; }, { ok: 0, bad: 0 });
    app.innerHTML = `<a class="muted small" href="#/settings">← 设置</a><h1>请女朋友帮我校对</h1>
    <div class="card stack"><p style="margin:0">这个网站的粤语是 AI 写的,没有母语者审核过。你女朋友是地道广州人,是最好的审核人 😊</p>
      <ol class="plan"><li>让她打开下面某一课,逐条听发音、看汉字和粤拼;</li><li>说得对就点 <b>✔</b>;不对、或者不像广州话,点 <b>✘</b>,并写下正确的说法;</li><li>校对完,点页面底部「复制校对结果」,发给我,我来修正。</li></ol></div>
    <p class="muted small" style="margin:12px 0">总进度:已校对 ${st.ok + st.bad} / ${tot} 条,其中有问题 ${st.bad} 条。</p>
    <div class="stack">${groups.map(g => { const x = rvStat(g.items); return `<a class="step" href="#/verify/${g.id}"><span class="tt grow">${g.title}</span><span class="st" style="display:block">${x.ok + x.bad}/${x.total}${x.bad ? ' · ✘' + x.bad : ''}</span></a>`; }).join('')}</div>
    <div class="card" style="margin-top:16px"><h3>校对结果(复制发给我)</h3>
      <textarea id="rvout" class="search" rows="8" readonly>${esc(rvReport())}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="copyRv">复制校对结果</button></div></div>`;
    return;
  }
  const g = groups.find(x => x.id === arg);
  if (!g) return viewVerify('');
  app.innerHTML = `<a class="muted small" href="#/verify">← 返回校对列表</a><h1>${g.title}</h1>
  <p class="muted small">点喇叭听发音。✔ = 正确且像广州话;✘ = 有问题(可填写正确说法)。</p>
  <div class="stack">${g.items.map(it => {
    const k = vkey(it), r = S.rv[k];
    return `<div class="pcard vrow ${r ? r.s : ''}"><button class="spk" data-say="${esc(it.c)}" aria-label="播放">🔊</button>
      <div class="body">${ruby(it.c, it.j, 'md')}<div class="mn muted small">${esc(it.m)}</div>${r && r.s === 'bad' && r.note ? `<div class="small" style="color:var(--bad)">正确:${esc(r.note)}</div>` : ''}</div>
      <div class="vbtns"><button class="btn sm ${r && r.s === 'ok' ? 'primary' : ''}" data-act="vok" data-k="${esc(k)}" aria-label="正确">✔</button><button class="btn sm ${r && r.s === 'bad' ? 'primary' : ''}" data-act="vbad" data-k="${esc(k)}" aria-label="有问题">✘</button></div></div>`;
  }).join('')}</div>`;
}
const rerenderVerify = () => { const y = window.scrollY; viewVerify(verifyArg); window.scrollTo(0, y); };

/* ================= 页面:听力实战 ================= */
let LS = null;
function listenPool(scope) {
  const seen = new Set(), out = [];
  LESSONS.filter(L => scope === 'all' || (scope === 'done' ? S.done[L.id] : String(STAGES[L.id]) === scope)).forEach(L =>
    L.phrases.concat(L.dialog ? L.dialog.lines.map(l => l.it) : []).forEach(it => { if (!seen.has(it.c)) { seen.add(it.c); out.push(it); } }));
  return out;
}
function listenStart(scope) {
  const pool = listenPool(scope);
  if (pool.length < 4) { toast('这个范围里的句子太少,先学几课,或选「全部」'); return; }
  const qs = shuffle(pool).slice(0, 10).map(it => {
    const others = shuffle(pool.filter(x => x.m !== it.m)).filter((x, i, a) => a.findIndex(y => y.m === x.m) === i).slice(0, 3);
    return { it, opts: shuffle([it].concat(others)) };
  });
  LS = { scope, qs, i: 0, score: 0, picked: -1, rate: 0 };
  viewListen();
  setTimeout(playListen, 250);
}
function playListen() { const q = LS && LS.qs[LS.i]; if (!q) return; rateOverride = LS.rate || null; stopAll(); playSeq([q.it.c]).then(() => { rateOverride = null; }); }
function viewListen() {
  if (!LS) {
    app.innerHTML = `<h1>听力实战</h1>
    <p class="muted">听一句粤语,选出意思。<b>不看字、不看粤拼</b>,专门练耳朵。每轮 10 题。</p>
    <div class="card stack"><h3>选择范围</h3>
      <div class="row">${[['1', '第一阶段(入门)'], ['2', '第二阶段(生活)'], ['3', '第三阶段(家人)'], ['done', '我学过的课'], ['all', '全部']].map(([k, n]) => `<button class="btn" data-act="listenStart" data-v="${k}">${n}</button>`).join('')}</div>
      <p class="muted small" style="margin:0">觉得太快?答题时点「慢速再听」。键盘 1–4 选答案,Enter 下一题。</p></div>`;
    return;
  }
  if (LS.i >= LS.qs.length) {
    addXP(LS.score * 3);
    app.innerHTML = `<div class="card" style="text-align:center"><div class="big-score">${LS.score}/${LS.qs.length}</div>
      <h2>${LS.score >= 8 ? '🎉 耳朵很灵!' : LS.score >= 5 ? '不错,继续练' : '多听几遍,会越来越好'}</h2>
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="listenStart" data-v="${LS.scope}">再来一轮</button><button class="btn" data-act="listenReset">换范围</button></div></div>`;
    return;
  }
  const q = LS.qs[LS.i], done = LS.picked >= 0, right = done && q.opts[LS.picked] === q.it;
  app.innerHTML = `<div class="row"><span class="muted small">第 ${LS.i + 1} / ${LS.qs.length} 题 · 得分 ${LS.score}</span></div>
  <div class="bar" style="margin:8px 0"><i style="width:${LS.i / LS.qs.length * 100}%"></i></div>
  <div class="card"><div class="qprompt"><div class="qlabel">听一听,这句话是什么意思?</div>${spk(q.it.c, 'big')}
    <div class="row" style="justify-content:center;margin-top:8px"><button class="btn sm" data-act="listenRate" data-v="0">正常速度再听</button><button class="btn sm" data-act="listenRate" data-v="0.55">🐢 慢速再听</button></div></div>
    <div class="opts">${q.opts.map((o, i) => `<button class="opt ${done ? (o === q.it ? 'ok' : (LS.picked === i ? 'bad' : '')) : ''}" data-act="listenPick" data-i="${i}" ${done ? 'disabled' : ''}><kbd>${i + 1}</kbd><span>${esc(o.m)}</span></button>`).join('')}</div>
    ${done ? `<div class="fb ${right ? 'ok' : 'bad'}"><b>${right ? '✅ 听对了!' : '❌ 再听听:'}</b><div class="ans">${answerBlock(q.it)}</div></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-act="listenNext">${LS.i + 1 >= LS.qs.length ? '查看结果' : '下一题'}</button></div>` : ''}</div>`;
}

/* ================= 真人录音 / 跟读对比 ================= */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = d => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) { // 无压缩(store)zip,够用且无需外部库
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  const csize = central.reduce((a, q) => a + q.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

const ADB = {
  db: null,
  open() {
    return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => {
      const r = indexedDB.open('jyutung-audio', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('ref'); r.result.createObjectStore('mine'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); });
  },
  get(store, k) { return this.run(store, 'readonly', o => o.get(k)); },
  put(store, k, v) { return this.run(store, 'readwrite', o => o.put(v, k)); },
  del(store, k) { return this.run(store, 'readwrite', o => o.delete(k)); },
  keys(store) { return this.run(store, 'readonly', o => o.getAllKeys()); },
  async entries(store) { const ks = await this.keys(store); const out = []; for (const k of ks) out.push({ key: k, value: await this.get(store, k) }); return out; }
};
async function loadLocalRef() { try { (await ADB.entries('ref')).forEach(({ key, value }) => { LOCALREF[key] = URL.createObjectURL(value.blob); }); } catch (e) { /* 隐私模式等 */ } }
if (window.indexedDB) loadLocalRef();

const RC = { rec: null, stream: null, chunks: [], h: '', mode: 'ref', text: '', mt: '' };
function recItems(L) {
  const seen = new Set(), out = [];
  const add = it => { if (!seen.has(it.c)) { seen.add(it.c); out.push(it); } };
  if (L.id === 'PART') PARTICLES.forEach(q => q.ex.forEach(add));
  else { L.phrases.forEach(add); if (L.dialog) L.dialog.lines.forEach(l => add(l.it)); L.words.forEach(add); }
  return out;
}
async function viewRecord(arg) {
  const [mode, lid] = (arg || '').split('/');
  if (!mode) {
    const have = new Set((await ADB.keys('ref').catch(() => [])) || []);
    app.innerHTML = `<h1>🎙 真人录音 / 跟读对比</h1>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      <div class="card stack"><h2>A. 录标准音(给女朋友)</h2><p class="muted small" style="margin:0">让她用手机逐句读出来。录音保存在这台设备上,点喇叭就会播放她的声音。全部录完点「导出」,把 zip 发给我,我放进网站,以后所有人点喇叭听到的都是她的声音。</p>
        <p class="small" style="margin:0">已录 <b>${have.size}</b> 条。建议先录「见女朋友的妈妈」「和长辈聊家常」「语气词」。</p></div>
      <div class="card stack"><h2>B. 跟读对比(自己练)</h2><p class="muted small" style="margin:0">听标准音 → 录下自己 → 回放对比。录音只保存在你的设备上,不会上传。</p></div></div>
    <h3 class="stage">A. 录标准音:选一课</h3><div class="stack">${LESSONS.concat([{ id: 'PART', icon: '💬', title: '语气词例句' }]).map(L => { const items = recItems(L), n = items.filter(it => have.has(hashText(it.c.trim()))).length; return `<a class="step" href="#/record/ref/${L.id}"><span class="ic">${L.icon}</span><span class="tt grow">${L.title}</span><span class="st" style="display:block">${n}/${items.length}</span></a>`; }).join('')}</div>
    <div class="card" style="margin-top:14px"><h3>导出女朋友的录音</h3><p class="muted small">会下载一个 zip(含全部录音和对照表)。录音格式取决于她的浏览器,安卓/电脑 Chrome 是 webm,iPhone 是 m4a,都能直接用。</p><button class="btn primary" data-act="recExport">导出全部录音(zip)</button></div>
    <h3 class="stage">B. 跟读对比:选一课</h3><div class="stack">${LESSONS.map(L => `<a class="step" href="#/record/mine/${L.id}"><span class="ic">${L.icon}</span><span class="tt grow">${L.title}</span></a>`).join('')}</div>`;
    return;
  }
  const L = lid === 'PART' ? { id: 'PART', icon: '💬', title: '语气词例句' } : lessonById(lid);
  if (!L) return viewRecord('');
  const have = new Set((await ADB.keys(mode).catch(() => [])) || []);
  const items = recItems(L);
  app.innerHTML = `<a class="muted small" href="#/record">← 返回</a><h1>${L.icon} ${L.title}</h1>
  <p class="muted small">${mode === 'ref' ? '请逐句读出来:点 ⏺ 开始,读完点 ⏹。读得自然、清楚、像平时说话。可以点 ▶ 回听,不满意就重录。' : '点喇叭听标准音,点 ⏺ 录下自己,再点 🔁 对比(先播标准音,再播你的)。'}</p>
  <div class="stack">${items.map(it => { const h = hashText(it.c.trim()), has = have.has(h), active = RC.rec && RC.h === h && RC.mode === mode; return `<div class="pcard rrow ${has ? 'ok' : ''}"><button class="spk" data-say="${esc(it.c)}" aria-label="听标准音">🔊</button>
    <div class="body">${ruby(it.c, it.j, 'md')}<div class="mn muted small">${esc(it.m)}</div></div>
    <div class="rbtns"><button class="btn sm ${active ? 'primary' : ''}" data-act="recToggle" data-h="${h}" data-m="${mode}" data-t="${esc(it.c)}">${active ? '⏹' : '⏺'}</button>
      ${has ? `<button class="btn sm" data-act="recPlay" data-h="${h}" data-m="${mode}" aria-label="回放">▶</button>${mode === 'mine' ? `<button class="btn sm" data-act="recCompare" data-h="${h}" data-t="${esc(it.c)}" aria-label="对比">🔁</button>` : ''}<button class="btn sm ghost" data-act="recDel" data-h="${h}" data-m="${mode}" aria-label="删除">🗑</button>` : ''}</div></div>`; }).join('')}</div>`;
}
async function recStop(save = true) {
  const r = RC.rec; if (!r) return;
  RC.rec = null;
  await new Promise(res => { r.onstop = res; try { r.stop(); } catch (e) { res(); } });
  if (RC.stream) RC.stream.getTracks().forEach(t => t.stop());
  RC.stream = null;
  if (save && RC.chunks.length) {
    const blob = new Blob(RC.chunks, { type: RC.mt || 'audio/webm' });
    await ADB.put(RC.mode, RC.h, { blob, type: RC.mt, text: RC.text });
    if (RC.mode === 'ref') LOCALREF[RC.h] = URL.createObjectURL(blob);
  }
  RC.chunks = [];
}
async function playBlobEntry(mode, h) {
  const v = await ADB.get(mode, h); if (!v) return Promise.resolve();
  stopAll();
  return new Promise(res => { const a = new Audio(URL.createObjectURL(v.blob)); curAudio = a; a.onended = a.onerror = () => res(); a.play().catch(() => res()); });
}
const refreshRecord = async () => { const y = window.scrollY; await viewRecord(location.hash.replace(/^#\/record\/?/, '')); window.scrollTo(0, y); };

/* ================= 页面:设置 ================= */
function viewSettings() {
  const zh = voices.filter(v => /^(zh|yue)/i.test(v.lang));
  const cur = pickVoice();
  app.innerHTML = `<h1>设置</h1>
  <div class="card stack">
    <label class="switch"><input type="checkbox" data-set="jp" ${S.set.jp ? 'checked' : ''}><span><b>显示粤拼</b><br><span class="muted small">学熟之后关掉,锻炼只看汉字就能读。</span></span></label>
    <div class="field"><label for="rate"><b>朗读速度</b> <span class="muted small" id="rateV">${S.set.rate.toFixed(2)}×</span></label><input id="rate" type="range" min="0.5" max="1.2" step="0.05" value="${S.set.rate}" data-set="rate"></div>
    <div class="field"><label for="voice"><b>朗读声音</b></label>
      <select id="voice" data-set="voice"><option value="">自动选择粤语声音</option>${zh.map(v => `<option value="${esc(v.name)}" ${S.set.voice === v.name ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>
      <div class="small ${cur ? '' : 'muted'}">${cur ? `✅ 当前使用:${esc(cur.name)}` : '⚠ 没有找到粤语声音'}</div>
      <div class="row"><button class="btn sm" data-act="testVoice">🔊 试听「你好,我係新學員」</button></div></div>
  </div>
  ${cur ? '' : `<div class="warn" style="margin-top:14px"><b>没有声音怎么办?</b><ol class="plan"><li>换用 <b>Microsoft Edge</b> 打开本页(自带高质量粤语语音:HiuGaai / HiuMaan / WanLung)。</li><li>或用 <b>Chrome</b>,通常自带「粤语(香港)」语音。</li><li>Windows 系统:设置 → 时间和语言 → 语言和区域 → 添加语言「中文(香港特别行政区)」,并勾选安装「文本转语音」。装好后重启浏览器。</li><li>手机:Android 的 Chrome 在系统「文字转语音」里安装粤语语音包;iPhone 的 Safari 在 设置 → 辅助功能 → 朗读内容 → 声音 → 粤语 中下载。</li></ol></div>`}
  <div class="card" style="margin-top:14px"><h3>🎙 真人录音 / 跟读对比</h3><p class="muted small">让女朋友把句子读出来,网站就会播放她的真实声音;你也可以录自己的跟读,和标准音对比。</p><a class="btn sm primary" href="#/record">打开录音页 →</a></div>
  <div class="card" style="margin-top:14px"><h3>✅ 请女朋友帮我校对</h3><p class="muted small">让地道广州人逐条检查粤语是否准确、像不像广州话,把结果复制发给我修正。</p><a class="btn sm primary" href="#/verify">打开校对页 →</a></div>
  <div class="card" style="margin-top:14px"><h3>学习数据</h3><p class="muted small">进度保存在这台设备的浏览器里(不会上传)。清除浏览器数据会丢失进度。</p>
    <button class="btn sm" data-act="reset">清空全部进度</button></div>`;
}

/* ================= 路由 ================= */
function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/([^/]*)\/?(.*)$/) || [];
  const page = m[1] || 'home', arg = m[2] || '';
  if (page !== 'practice') Q = null;
  if (page !== 'review') Rv = null;
  if (page !== 'sounds') TT = null;
  if (page !== 'listen') LS = null;
  if (page !== 'record' && RC.rec) recStop(false);
  document.body.classList.toggle('nojp', !S.set.jp);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (page === 'lesson' || page === 'practice' ? 'home' : page === 'verify' || page === 'record' ? 'settings' : page)));
  if (page === 'home') viewHome();
  else if (page === 'sounds') viewSounds(arg);
  else if (page === 'lesson') viewLesson(arg);
  else if (page === 'practice') startPractice(arg);
  else if (page === 'review') viewReview();
  else if (page === 'grammar') viewGrammar();
  else if (page === 'guide') viewGuide();
  else if (page === 'patterns') viewPatterns();
  else if (page === 'particles') viewParticles();
  else if (page === 'verify') viewVerify(arg);
  else if (page === 'listen') viewListen();
  else if (page === 'record') viewRecord(arg);
  else if (page === 'phrasebook') viewPhrasebook();
  else if (page === 'settings') viewSettings();
  else viewHome();
  updateBadge(); updateVoiceNote();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ================= 事件 ================= */
const ACT = {
  opt(t) { const q = Q && Q.qs[Q.i]; if (!q || q.done) return; const i = +t.dataset.i; q.picked = i; finishAnswer(q, q.opts[i].ok); },
  next() { Q.i++; renderQ(true); },
  tok(t) { const q = Q.qs[Q.i]; if (q.done) return; q.built.push(+t.dataset.i); renderQ(); },
  untok(t) { const q = Q.qs[Q.i]; if (q.done) return; q.built.splice(+t.dataset.i, 1); renderQ(); },
  check() { const q = Q.qs[Q.i]; if (q.done) return; finishAnswer(q, q.built.map(id => q.tokens.find(t => t.id === id).c).join('') === q.it.c); },
  retry() { startPractice(location.hash.split('/')[2] || (Q && Q.L.id)); },
  playAll(t) {
    const [lid, kind] = [t.dataset.v.slice(0, -1), t.dataset.v.slice(-1)];
    const L = lessonById(lid);
    speakQueue((kind === 'w' ? L.words : L.phrases).map(it => it.c));
  },
  playDialog(t) { speakQueue(lessonById(t.dataset.v).dialog.lines.map(l => l.it.c)); },
  role(t) {
    const d = $('#dlg'); d.classList.remove('mask-A', 'mask-B');
    d.querySelectorAll('.line').forEach(l => l.classList.remove('rev'));
    if (t.dataset.v) d.classList.add('mask-' + t.dataset.v);
    d.querySelectorAll('[data-act="role"]').forEach(b => b.classList.toggle('on', b === t));
  },
  hideM(t) { $('#dlg').classList.toggle('hide-m', t.checked); },
  revealLine(t) { t.classList.toggle('rev'); },
  reveal() { Rv.shown = true; renderCard(); },
  grade(t) {
    const g = +t.dataset.v, id = Rv.q[Rv.i];
    grade(id, g);
    if (g === 0) Rv.q.push(id); else if (g === 2) Rv.good++;
    Rv.i++; Rv.shown = false; save(); updateBadge(); renderCard(true);
  },
  again() { Rv = null; setTimeout(route, 0); },
  trainStart(t) { trainStart(t.dataset.v); viewSounds('train'); },
  trainReset() { TT = null; viewSounds('train'); },
  trainPick(t) {
    if (TT.picked) return;
    TT.picked = +t.dataset.v; if (TT.picked === TT.cur) TT.score++;
    viewSounds('train');
    setTimeout(() => speak(TT.set.items[TT.cur - 1][0]), 100);
  },
  trainNext() {
    TT.n++;
    if (TT.n >= TT.total) {
      if (TT.score >= 7 && !S.soundsDone) { S.soundsDone = true; addXP(30); }
      if (TT.score > S.toneBest) S.toneBest = TT.score;
      save(); viewSounds('train');
    } else trainNext(true);
  },
  testVoice() { speak('你好,我係新學員'); },
  reset() { if (confirm('确定清空全部学习进度吗?此操作不能撤销。')) { S = defaults(); save(); updateBadge(); location.hash = '#/'; route(); } }
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-say],[data-act]');
  if (!t) return;
  if (t.dataset.say !== undefined) { e.preventDefault(); speak(t.dataset.say); return; }
  const f = ACT[t.dataset.act]; if (f) f(t, e);
});
document.addEventListener('click', e => {
  const rt = e.target.closest && e.target.closest('rt'); if (!rt) return;
  const sy = rt.textContent.trim(), m = sy.match(/^(ng|gw|kw|[bpmfdtnlgkhwzcsj])?([a-z]+)([1-6])$/);
  if (!m) return;
  const tn = TONES[+m[3] - 1];
  toast(`${sy} = ${m[1] || '(无声母)'} + ${m[2]} + ${m[3]}(${tn.name}调)`);
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-set]'); if (!t) return;
  const k = t.dataset.set;
  if (k === 'jp') { S.set.jp = t.checked; document.body.classList.toggle('nojp', !S.set.jp); }
  if (k === 'voice') { S.set.voice = t.value; viewSettings(); }
  save(); updateVoiceNote();
});
document.addEventListener('input', e => {
  if (e.target.id === 'pbq') { pbq = e.target.value; $('#pbl').innerHTML = pbListHTML(); return; }
  const t = e.target.closest('[data-set="rate"]'); if (!t) return;
  S.set.rate = +t.value; $('#rateV').textContent = S.set.rate.toFixed(2) + '×'; save();
});
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (Q) {
    const q = Q.qs[Q.i]; if (!q) return;
    if (/^[1-4]$/.test(e.key) && q.opts && !q.done) { const b = app.querySelectorAll('.opt')[+e.key - 1]; if (b) b.click(); }
    else if (e.key === 'Enter') { const b = app.querySelector('[data-act="next"],[data-act="check"]:not([disabled])'); if (b) { e.preventDefault(); b.click(); } }
  } else if (TT && TT.cur && /^[1-6]$/.test(e.key) && !TT.picked && TT.n < TT.total) { ACT.trainPick({ dataset: { v: e.key } }); }
  else if (TT && TT.picked && e.key === 'Enter') { e.preventDefault(); ACT.trainNext(); }
  else if (LS && LS.i < LS.qs.length) {
    if (/^[1-4]$/.test(e.key) && LS.picked < 0) { const b = app.querySelectorAll('.opt')[+e.key - 1]; if (b) b.click(); }
    else if (e.key === 'Enter' && LS.picked >= 0) { e.preventDefault(); ACT.listenNext(); }
  }
  else if (Rv) {
    if (!Rv.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); ACT.reveal(); }
    else if (Rv.shown && /^[1-3]$/.test(e.key)) ACT.grade({ dataset: { v: String(+e.key - 1) } });
  }
});

Object.assign(ACT, {
  fill(t) { fillPattern(+t.dataset.p, +t.dataset.s, true); },
  vok(t) { S.rv[t.dataset.k] = { s: 'ok' }; save(); rerenderVerify(); },
  vbad(t) {
    const k = t.dataset.k, old = S.rv[k] && S.rv[k].note || '';
    const note = prompt('正确的说法 / 读音是什么?(可以留空,只标记有问题)', old);
    if (note === null) return;
    S.rv[k] = { s: 'bad', note: note.trim() }; save(); rerenderVerify();
  },
  copyRv() {
    const txt = rvReport(), manual = () => { const ta = $('#rvout'); if (ta) ta.select(); toast('请按 Ctrl+C 复制文本框里的内容'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('已复制,可以直接粘贴发给我'), manual); else manual();
  }
});

Object.assign(ACT, {
  pbmode(t) { pbmode = t.dataset.v; viewPhrasebook(); },
  listenStart(t) { listenStart(t.dataset.v); },
  listenReset() { LS = null; viewListen(); },
  listenRate(t) { LS.rate = +t.dataset.v; playListen(); },
  listenPick(t) {
    if (LS.picked >= 0) return;
    const q = LS.qs[LS.i], i = +t.dataset.i; LS.picked = i;
    if (q.opts[i] === q.it) { LS.score++; addXP(5); }
    viewListen(); setTimeout(() => speak(q.it.c), 100);
  },
  listenNext() { LS.i++; LS.picked = -1; viewListen(); if (LS.i < LS.qs.length) setTimeout(playListen, 250); },
  async recToggle(t) {
    const h = t.dataset.h, mode = t.dataset.m;
    if (RC.rec) { const same = RC.h === h && RC.mode === mode; await recStop(true); await refreshRecord(); if (same) return; }
    try {
      if (!navigator.mediaDevices || !window.MediaRecorder) { toast('这个浏览器不支持录音,请用 Chrome / Edge / Safari 打开'); return; }
      stopAll();
      RC.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      RC.mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      RC.rec = new MediaRecorder(RC.stream, RC.mt ? { mimeType: RC.mt } : undefined);
      RC.chunks = []; RC.h = h; RC.mode = mode; RC.text = t.dataset.t.trim();
      RC.rec.ondataavailable = e => { if (e.data && e.data.size) RC.chunks.push(e.data); };
      RC.rec.start();
      await refreshRecord(); toast('正在录音…读完点 ⏹');
    } catch (e) { RC.rec = null; toast('无法使用麦克风:请允许浏览器访问麦克风(需要 https 或 localhost)'); }
  },
  async recPlay(t) { await playBlobEntry(t.dataset.m, t.dataset.h); },
  async recCompare(t) { stopAll(); await playSeq([t.dataset.t.trim()]); await playBlobEntry('mine', t.dataset.h); },
  async recDel(t) {
    const h = t.dataset.h, m = t.dataset.m;
    await ADB.del(m, h); if (m === 'ref') delete LOCALREF[h];
    await refreshRecord();
  },
  async recExport() {
    const ents = await ADB.entries('ref');
    if (!ents.length) { toast('还没有录音可导出'); return; }
    const enc = new TextEncoder(), files = [], manifest = {}, list = [];
    for (const { key, value } of ents) {
      const ext = /mp4/.test(value.type) ? 'm4a' : /ogg/.test(value.type) ? 'ogg' : 'webm';
      const name = `${key}.${ext}`;
      files.push({ name, data: new Uint8Array(await value.blob.arrayBuffer()) });
      manifest[key] = name; list.push(`${key}\t${name}\t${value.text || ''}`);
    }
    files.push({ name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) });
    files.push({ name: 'list.txt', data: enc.encode(list.join('\n')) });
    const a = document.createElement('a'); a.href = URL.createObjectURL(makeZip(files)); a.download = 'yuetung-audio.zip';
    document.body.appendChild(a); a.click(); a.remove();
    toast(`已导出 ${ents.length} 条录音`);
  }
});

/* ================= 自动更新:检测新版本 / 新课程 ================= */
// 初始化"已见过的课程":老用户把第 1–7 课视为已见(这样新增的课会显示 NEW),新用户全部视为已见
if (!Array.isArray(S.seen)) {
  S.seen = (Object.keys(S.done).length || Object.keys(S.srs).length) ? ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] : LESSONS.map(l => l.id);
  save();
}
let loadedVer = null;
async function checkVersion() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (loadedVer === null) { loadedVer = v.version; return; }
    if (v.version !== loadedVer) {
      const more = v.lessons > LESSONS.length ? `新增了课程(现在共 ${v.lessons} 课)` : '内容有更新';
      const n = $('#unote');
      n.innerHTML = `📚 ${more}。<button class="btn sm primary" data-act="reload" style="margin-left:8px">刷新获取</button>`;
      n.hidden = false;
    }
  } catch (e) { /* 离线或 file:// 打开时静默忽略 */ }
}
ACT.reload = () => location.reload();
checkVersion();
setInterval(checkVersion, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

route();
})();
