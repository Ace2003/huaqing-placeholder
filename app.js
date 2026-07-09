/* ============================================================
   猫的第六感 — 主逻辑
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'cat6_data';

  // ========== 存档 ==========
  let data = { insight: 0, streak: 0, lastDate: '', history: [], profiles: [], selectedProfileId: null };
  function loadData() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) data = Object.assign(data, JSON.parse(raw));
    } catch (e) {}
    // 更新连击
    const today = new Date().toDateString();
    if (data.lastDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      data.streak = data.lastDate === yesterday ? data.streak : 0;
    }
  }
  function saveData() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // ========== 猫猫 ==========
  let cat = null;
  function initCat() {
    cat = new VideoCat($('cat-canvas'), { onStateChange(){} });
    cat.start();
    window.cat = cat;       // 暴露到全局方便控制台调试
    window.catData = data;  // 暴露数据
  }

  // ========== 统计更新 ==========
  function updateStats() {
    $('stat-insight').textContent = data.insight;
    $('stat-streak').textContent = data.streak;
  }

  // ========== 解码（自动判断单条 / 整段对话）==========
  function detectBatch(text) {
    if (!text) return false;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 2) return true;
    // 含 我： / TA： / 对方： / A： / B： 等对话前缀，视为整段
    if (/^(我|TA|对方|A|B|ta|我方|对方|甲方|乙方)[：:]/m.test(text)) return true;
    return false;
  }

  async function decode() {
    const input = $('msg-input');
    const text = input.value.trim();
    if (!text) { toast('先粘贴一条消息吧'); return; }

    const isBatch = detectBatch(text);

    const btn = $('btn-decode');
    btn.disabled = true;
    btn.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span> 猫猫在读…';
    $('cat-stage').classList.add('thinking');
    if (cat) cat.setState('charging');
    if (window.CatAudio) thinkingSound = CatAudio.playThinking();

    try {
      let result;
      if (isBatch) {
        const res = await fetch('/api/decode_batch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        result = await res.json();
        if (window.CatAudio) { if (thinkingSound) CatAudio.stopThinking(thinkingSound); CatAudio.playReveal(); }
        lastBatchResult = { original: text, ...result };
        showBatchResult(result);
        recordBatchDecode(text, result);
        if (result.degraded) toast('AI 失灵：' + (result.degraded_reason || '显示兜底预录'));
      } else {
        const profile = getSelectedProfile();
        const res = await fetch('/api/decode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, profile })
        });
        result = await res.json();
        if (window.CatAudio) { if (thinkingSound) CatAudio.stopThinking(thinkingSound); CatAudio.playReveal(); }
        showResult(text, result);
        recordDecode(text, result);
        if (result.degraded) toast('AI 失灵：' + (result.degraded_reason || '显示兜底预录'));
      }
    } catch (e) {
      toast('网络抖了一下，再试一次');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>让猫猫解码</span><span class="btn-arrow">→</span>';
      $('cat-stage').classList.remove('thinking');
      if (cat) cat.setState('idle');
    }
  }

  function showResult(original, r) {
    $('input-section').classList.add('hidden');
    $('result-section').classList.remove('hidden');

    const emoMap = {
      happy:'开心', tired:'疲惫', anxious:'焦虑', wronged:'委屈', annoyed:'烦躁',
      indifferent:'冷淡', flirty:'暧昧', defensive:'防御'
    };
    const dangerMap = { green:'安全', yellow:'需小心', red:'⚠ 危险信号' };

    $('result-emotion-badge').className = 'badge-' + (r.emotion_tag || 'indifferent');
    $('result-emotion-badge').textContent = emoMap[r.emotion_tag] || '未知';
    $('result-danger-badge').className = 'badge-' + (r.danger_level || 'green');
    $('result-danger-badge').textContent = dangerMap[r.danger_level] || '安全';

    $('result-original-text').textContent = '「' + original + '」';

    const vals = $('result-card').querySelectorAll('.result-row .result-val');
    // [0]=surface [1]=real [2]=want [3]=subtext [4]=clue
    vals[0].textContent = r.surface_meaning || '';
    vals[1].textContent = r.real_emotion || '';
    vals[2].textContent = r.what_they_want || '';
    vals[3].textContent = r.subtext || '';
    vals[4].textContent = r.context_clue || '';

    $('result-reply-text').textContent = r.suggested_reply || '';
    $('whisper-text').textContent = r.cat_whisper || '';

    lastResult = { original, ...r };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function recordDecode(original, r) {
    data.insight++;
    const today = new Date().toDateString();
    if (data.lastDate === today) {
      // 同一天不重复加连击
    } else if (data.lastDate === new Date(Date.now() - 86400000).toDateString()) {
      data.streak++;
    } else {
      data.streak = 1;
    }
    data.lastDate = today;
    data.history.unshift({
      type: 'single',
      msg: original,
      real: r.real_emotion,
      emotion: r.emotion_tag,
      reply: r.suggested_reply,
      time: Date.now(),
      full: r,
    });
    data.history = data.history.slice(0, 50);
    saveData();
    updateStats();
    renderHistory();
  }

  function recordBatchDecode(original, r) {
    data.insight++;
    const today = new Date().toDateString();
    if (data.lastDate === today) {
      // 同一天不重复加连击
    } else if (data.lastDate === new Date(Date.now() - 86400000).toDateString()) {
      data.streak++;
    } else {
      data.streak = 1;
    }
    data.lastDate = today;
    data.history.unshift({
      type: 'batch',
      msg: original,
      real: r.deadlock || r.power_dynamic,
      reply: r.advice,
      time: Date.now(),
      full: r,
    });
    data.history = data.history.slice(0, 50);
    saveData();
    updateStats();
    renderHistory();
  }

  let lastResult = null;
  let lastBatchResult = null;

  // ========== 关闭结果（返回输入界面，不重置 textarea） ==========
  function closeResult() {
    $('result-section').classList.add('hidden');
    $('batch-result').classList.add('hidden');
    $('input-section').classList.remove('hidden');
    $('msg-input').focus();
  }

  // ========== 再来一条（清空 textarea） ==========
  function decodeAgain() {
    $('result-section').classList.add('hidden');
    $('batch-result').classList.add('hidden');
    $('input-section').classList.remove('hidden');
    $('msg-input').value = '';
    $('msg-input').focus();
  }

  // ========== 复制回复 ==========
  function copyReply() {
    const text = $('result-reply-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = $('btn-copy-reply');
      btn.textContent = '已复制 ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
    }).catch(() => toast('复制失败，手动选一下'));
  }

  // ========== 分享图 ==========
  function generateShareImage() {
    if (!lastResult) return;
    const r = lastResult;
    const W = 720, H = 960;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');

    // 背景
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#11111f');
    grad.addColorStop(1, '#0a0a14');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // 光晕
    const halo = cx.createRadialGradient(W/2, 200, 0, W/2, 200, 400);
    halo.addColorStop(0, 'rgba(255,217,102,0.15)');
    halo.addColorStop(1, 'transparent');
    cx.fillStyle = halo;
    cx.fillRect(0, 0, W, H);

    // 品牌头
    cx.fillStyle = '#ffd966';
    cx.font = 'bold 28px "Noto Sans SC", sans-serif';
    cx.textAlign = 'center';
    cx.fillText('🐱 猫的第六感', W/2, 70);

    cx.fillStyle = '#6a6a85';
    cx.font = '13px "Noto Sans SC", sans-serif';
    cx.fillText('中文潜台词解码器', W/2, 95);

    // 原消息
    let y = 150;
    cx.fillStyle = '#c4bca8';
    cx.font = '12px "Noto Sans SC", sans-serif';
    cx.textAlign = 'left';
    cx.fillText('原消息', 60, y);
    y += 24;
    cx.fillStyle = '#1a1a2e';
    roundRect(cx, 50, y - 16, W - 100, 56, 10); cx.fill();
    cx.fillStyle = '#fef6e4';
    cx.font = 'italic 17px "Noto Sans SC", sans-serif';
    wrapText(cx, '「' + r.original + '」', 70, y + 10, W - 140, 24);
    y += 70;

    // 真实情绪（重点）
    cx.fillStyle = '#ff7ea3';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('TA的真实情绪', 60, y);
    y += 24;
    cx.fillStyle = '#fef6e4';
    cx.font = 'bold 20px "Noto Sans SC", sans-serif';
    wrapText(cx, r.real_emotion || '', 60, y, W - 120, 28);
    y += Math.ceil((r.real_emotion || '').length / 18) * 28 + 10;

    // 潜台词
    cx.fillStyle = '#ff9eb5';
    cx.font = '12px "Noto Sans SC", sans-serif';
    cx.fillText('潜台词', 60, y);
    y += 24;
    cx.fillStyle = '#1a1a2e';
    roundRect(cx, 50, y - 16, W - 100, 0, 8); // 占位
    cx.fillStyle = '#ff9eb5';
    cx.font = 'italic 16px "Noto Sans SC", sans-serif';
    const subH = wrapText(cx, r.subtext || '', 70, y + 10, W - 140, 24);
    y += subH + 20;

    // 建议回复
    cx.fillStyle = '#7ee893';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('✦ 建议回复', 60, y);
    y += 28;
    const replyGrad = cx.createLinearGradient(50, y, W - 50, y);
    replyGrad.addColorStop(0, 'rgba(126,232,147,0.1)');
    replyGrad.addColorStop(1, 'rgba(109,213,237,0.08)');
    cx.fillStyle = replyGrad;
    roundRect(cx, 50, y - 12, W - 100, 60, 10); cx.fill();
    cx.strokeStyle = 'rgba(126,232,147,0.2)';
    cx.lineWidth = 1;
    roundRect(cx, 50, y - 12, W - 100, 60, 10); cx.stroke();
    cx.fillStyle = '#fef6e4';
    cx.font = 'bold 18px "Noto Sans SC", sans-serif';
    wrapText(cx, r.suggested_reply || '', 70, y + 16, W - 140, 26);

    // 底部猫猫话
    y = H - 120;
    cx.fillStyle = '#ffd966';
    cx.font = '14px "Noto Sans SC", sans-serif';
    cx.textAlign = 'center';
    cx.fillText('🐱 ' + (r.cat_whisper || ''), W/2, y);

    cx.fillStyle = '#6a6a85';
    cx.font = '12px "Noto Sans SC", sans-serif';
    cx.fillText('猫的第六感 · 读懂中文潜台词', W/2, H - 40);

    // 显示
    const shareCanvas = $('share-canvas');
    shareCanvas.width = W; shareCanvas.height = H;
    shareCanvas.style.aspectRatio = W + '/' + H;
    const sctx = shareCanvas.getContext('2d');
    sctx.drawImage(c, 0, 0);
    $('share-modal').classList.remove('hidden');
    shareImageDataUrl = c.toDataURL('image/png');
  }

  // 整段对话的分享图
  function generateBatchShareImage() {
    const r = lastBatchResult;
    if (!r) { toast('还没有可分享的结果'); return; }
    const W = 720, H = 1180;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');

    // 背景
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0f1320');
    grad.addColorStop(1, '#0a0a14');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // 顶部氛围光
    const halo = cx.createRadialGradient(W/2, 180, 0, W/2, 180, 420);
    halo.addColorStop(0, 'rgba(109,213,237,0.12)');
    halo.addColorStop(1, 'transparent');
    cx.fillStyle = halo;
    cx.fillRect(0, 0, W, H);

    // 品牌头
    cx.fillStyle = '#6dd5ed';
    cx.font = 'bold 26px "Noto Sans SC", sans-serif';
    cx.textAlign = 'center';
    cx.fillText('🐱 猫的第六感', W/2, 70);
    cx.fillStyle = '#6a6a85';
    cx.font = '13px "Noto Sans SC", sans-serif';
    cx.fillText('关系动态分析', W/2, 95);

    // 原始对话
    let y = 140;
    cx.fillStyle = '#c4bca8';
    cx.font = '12px "Noto Sans SC", sans-serif';
    cx.textAlign = 'left';
    cx.fillText('聊天记录', 60, y);
    y += 22;
    cx.fillStyle = '#1a1a2e';
    roundRect(cx, 50, y - 14, W - 100, 92, 10); cx.fill();
    cx.fillStyle = '#a8b3c4';
    cx.font = '13px "Noto Sans SC", sans-serif';
    const dialogPreview = (r.original || '').split('\n').slice(0, 4).join('\n');
    const more = (r.original || '').split('\n').length > 4 ? '\n…' : '';
    wrapText(cx, dialogPreview + more, 68, y + 8, W - 136, 20);
    y += 104;

    // 权力动态
    cx.fillStyle = '#6dd5ed';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('▸ 权力动态', 60, y); y += 22;
    cx.fillStyle = '#fef6e4';
    cx.font = '15px "Noto Sans SC", sans-serif';
    const dynH = wrapText(cx, r.power_dynamic || '', 60, y, W - 120, 22);
    y += dynH + 14;

    // TA 的隐藏状态
    cx.fillStyle = '#ff9eb5';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('▸ TA的隐藏状态', 60, y); y += 22;
    cx.fillStyle = '#fef6e4';
    cx.font = '15px "Noto Sans SC", sans-serif';
    const theirH = wrapText(cx, r.their_hidden_state || '', 60, y, W - 120, 22);
    y += theirH + 14;

    // 沟通死结（重点）
    cx.fillStyle = '#ff7ea3';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('▸ 沟通死结', 60, y); y += 22;
    cx.fillStyle = '#1a1a2e';
    roundRect(cx, 50, y - 12, W - 100, 0, 8);
    cx.fillStyle = '#ff7ea3';
    cx.font = 'italic 16px "Noto Sans SC", sans-serif';
    const dlH = wrapText(cx, r.deadlock || '', 60, y + 8, W - 120, 24);
    y += dlH + 16;

    // 猫猫的建议
    cx.fillStyle = '#7ee893';
    cx.font = 'bold 12px "Noto Sans SC", sans-serif';
    cx.fillText('✦ 猫猫的建议', 60, y); y += 24;
    const adviceGrad = cx.createLinearGradient(50, y, W - 50, y);
    adviceGrad.addColorStop(0, 'rgba(126,232,147,0.10)');
    adviceGrad.addColorStop(1, 'rgba(109,213,237,0.08)');
    cx.fillStyle = adviceGrad;
    roundRect(cx, 50, y - 12, W - 100, 68, 10); cx.fill();
    cx.strokeStyle = 'rgba(126,232,147,0.2)';
    cx.lineWidth = 1;
    roundRect(cx, 50, y - 12, W - 100, 68, 10); cx.stroke();
    cx.fillStyle = '#fef6e4';
    cx.font = 'bold 15px "Noto Sans SC", sans-serif';
    wrapText(cx, r.advice || '', 68, y + 14, W - 136, 22);

    // 底部猫猫话
    y = H - 110;
    cx.fillStyle = '#6dd5ed';
    cx.font = '13px "Noto Sans SC", sans-serif';
    cx.textAlign = 'center';
    cx.fillText('🐱 ' + (r.cat_whisper || ''), W/2, y);

    cx.fillStyle = '#6a6a85';
    cx.font = '11px "Noto Sans SC", sans-serif';
    cx.fillText('猫的第六感 · 关系动态分析', W/2, H - 36);

    // 显示
    const shareCanvas = $('share-canvas');
    shareCanvas.width = W; shareCanvas.height = H;
    shareCanvas.style.aspectRatio = W + '/' + H;
    const sctx = shareCanvas.getContext('2d');
    sctx.drawImage(c, 0, 0);
    $('share-modal').classList.remove('hidden');
    shareImageDataUrl = c.toDataURL('image/png');
  }

  let shareImageDataUrl = null;

  function roundRect(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r);
    cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r);
    cx.arcTo(x, y, x + w, y, r);
    cx.closePath();
  }

  function wrapText(cx, text, x, y, maxW, lh) {
    const chars = (text || '').split('');
    let line = '', cy = y, totalLines = 1;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (cx.measureText(test).width > maxW && line) {
        cx.fillText(line, x, cy);
        line = chars[i];
        cy += lh;
        totalLines++;
      } else {
        line = test;
      }
    }
    if (line) cx.fillText(line, x, cy);
    return totalLines * lh;
  }

  // ========== 历史 ==========
  function renderHistory() {
    const list = $('history-list');
    const empty = $('history-empty');
    if (!data.history.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = data.history.map((h, i) => {
      const isBatch = h.type === 'batch';
      const badge = isBatch ? '<span class="hist-badge">关系</span>' : '';
      const firstLine = (h.msg || '').split('\n').filter(l => l.trim())[0] || '';
      const preview = isBatch ? firstLine + (h.msg.split('\n').length > 1 ? ' ...' : '') : (h.msg || '');
      return `
      <div class="history-item ${isBatch ? 'history-batch' : ''}" data-idx="${i}">
        <div class="history-msg">${badge}${escapeHtml(preview)}</div>
        <div class="history-real">${escapeHtml(h.real || '')}</div>
        <div class="history-time">${timeAgo(h.time)}</div>
      </div>
    `;
    }).join('');
    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = +el.dataset.idx;
        const h = data.history[idx];
        if (!h) return;
        $('history-drawer').classList.add('hidden');
        if (h.type === 'batch') {
          $('input-section').classList.add('hidden');
          $('result-section').classList.add('hidden');
          $('batch-result').classList.remove('hidden');
          showBatchResult(h.full || {});
        } else {
          $('input-section').classList.add('hidden');
          $('batch-result').classList.add('hidden');
          $('result-section').classList.remove('hidden');
          showResult(h.msg, h.full || {});
        }
      });
    });
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d/60) + '分钟前';
    if (d < 86400) return Math.floor(d/3600) + '小时前';
    return Math.floor(d/86400) + '天前';
  }

  // ========== Toast ==========
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  // ========== 绑定 ==========
  function bindEvents() {
    $('btn-decode').addEventListener('click', decode);
    $('msg-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); decode(); }
    });
    document.querySelectorAll('.example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $('msg-input').value = chip.dataset.text;
        decode();
      });
    });
    $('btn-again').addEventListener('click', decodeAgain);
    $('btn-copy-reply').addEventListener('click', copyReply);
    $('btn-share').addEventListener('click', generateShareImage);

    $('btn-close-result').addEventListener('click', closeResult);
    $('btn-close-batch').addEventListener('click', closeResult);
    $('btn-share-batch').addEventListener('click', generateBatchShareImage);

    $('btn-history').addEventListener('click', () => $('history-drawer').classList.remove('hidden'));
    $('btn-close-history').addEventListener('click', () => $('history-drawer').classList.add('hidden'));

    $('btn-download-share').addEventListener('click', () => {
      if (!shareImageDataUrl) return;
      const a = document.createElement('a');
      a.href = shareImageDataUrl;
      a.download = '猫的第六感-' + Date.now() + '.png';
      a.click();
      toast('图片已保存');
    });
    $('btn-close-share').addEventListener('click', () => $('share-modal').classList.add('hidden'));
  }

  // ========== 人物档案系统 ==========
  const RELATION_EMOJI = {
    '恋人':'💜','前任':'💔','暧昧对象':'🤍','暗恋对象':'🌸','朋友':'🤝',
    '闺蜜/兄弟':'🍻','同事':'💼','领导':'👑','下属':'📋','家人':'🏡',
    '父母':'👪','客户':'🤝','网友':'💻','陌生人':'❓','其他':'👤'
  };

  function getSelectedProfile() {
    if (!data.selectedProfileId) return null;
    return data.profiles.find(p => p.id === data.selectedProfileId) || null;
  }

  function renderProfileSelector() {
    const p = getSelectedProfile();
    const btn = $('btn-select-profile');
    const name = $('profile-current-name');
    if (p) {
      name.textContent = (RELATION_EMOJI[p.relation] || '👤') + ' ' + p.name + (p.relation ? ' · ' + p.relation : '');
      btn.classList.add('has-profile');
    } else {
      name.textContent = '通用场景（无背景）';
      btn.classList.remove('has-profile');
    }
  }

  function renderProfileList() {
    const list = $('profile-list');
    const empty = $('profile-empty');
    if (!data.profiles.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = data.profiles.map(p => `
      <div class="profile-card-item ${p.id === data.selectedProfileId ? 'active' : ''}" data-id="${p.id}">
        <div class="pci-avatar">${RELATION_EMOJI[p.relation] || '👤'}</div>
        <div class="pci-info">
          <div class="pci-name">${escapeHtml(p.name)}</div>
          <div class="pci-meta">${escapeHtml(p.relation || '未设关系')} · ${escapeHtml((p.personality || []).slice(0,2).join(' ') || '点击编辑')}</div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.profile-card-item').forEach(el => {
      el.addEventListener('click', () => {
        data.selectedProfileId = el.dataset.id === data.selectedProfileId ? null : el.dataset.id;
        saveData();
        renderProfileSelector();
        renderProfileList();
        if (data.selectedProfileId) {
          $('profile-drawer').classList.add('hidden');
          toast('已选择档案，猫猫会更懂TA');
        }
      });
    });
  }

  let editingProfileId = null;

  function openProfileEditor(profileId) {
    editingProfileId = profileId;
    $('profile-list-view').classList.add('hidden');
    $('profile-edit-view').classList.remove('hidden');

    const p = profileId ? data.profiles.find(x => x.id === profileId) : null;
    $('profile-edit-title').textContent = p ? '编辑档案' : '新建档案';
    $('pf-name').value = p?.name || '';
    $('pf-relation').value = p?.relation || '';
    $('pf-age').value = p?.age || '';
    $('pf-background').value = p?.background || '';
    $('pf-myThoughts').value = p?.myThoughts || '';
    $('pf-theirThoughts').value = p?.theirThoughts || '';
    $('pf-history').value = p?.history || '';

    // 性格 chips
    const selected = new Set(p?.personality || []);
    document.querySelectorAll('.pf-chip').forEach(c => {
      c.classList.toggle('active', selected.has(c.dataset.v));
    });
    $('btn-delete-profile').style.display = p ? '' : 'none';
  }

  function saveProfile() {
    const name = $('pf-name').value.trim();
    if (!name) { toast('先填个称呼吧'); return; }
    const personality = [];
    document.querySelectorAll('.pf-chip.active').forEach(c => personality.push(c.dataset.v));

    const profile = {
      id: editingProfileId || ('p' + Date.now()),
      name,
      relation: $('pf-relation').value,
      age: $('pf-age').value,
      personality,
      background: $('pf-background').value.trim(),
      myThoughts: $('pf-myThoughts').value.trim(),
      theirThoughts: $('pf-theirThoughts').value.trim(),
      history: $('pf-history').value.trim(),
      updatedAt: Date.now(),
    };
    if (editingProfileId) {
      const idx = data.profiles.findIndex(p => p.id === editingProfileId);
      if (idx >= 0) data.profiles[idx] = profile;
    } else {
      data.profiles.unshift(profile);
    }
    saveData();
    renderProfileList();
    renderProfileSelector();
    backToProfileList();
    toast(editingProfileId ? '档案已更新' : '档案已创建');
  }

  function deleteProfile() {
    if (!editingProfileId) return;
    if (!confirm('确定删除这个档案？')) return;
    data.profiles = data.profiles.filter(p => p.id !== editingProfileId);
    if (data.selectedProfileId === editingProfileId) data.selectedProfileId = null;
    saveData();
    renderProfileList();
    renderProfileSelector();
    backToProfileList();
    toast('档案已删除');
  }

  function backToProfileList() {
    $('profile-edit-view').classList.add('hidden');
    $('profile-list-view').classList.remove('hidden');
    editingProfileId = null;
  }

  function bindProfileEvents() {
    $('btn-select-profile').addEventListener('click', () => {
      $('profile-drawer').classList.remove('hidden');
      backToProfileList();
    });
    $('btn-close-profile').addEventListener('click', () => $('profile-drawer').classList.add('hidden'));
    $('btn-new-profile').addEventListener('click', () => openProfileEditor(null));
    $('btn-back-profile-list').addEventListener('click', backToProfileList);
    $('btn-save-profile').addEventListener('click', saveProfile);
    $('btn-delete-profile').addEventListener('click', deleteProfile);
    document.querySelectorAll('.pf-chip').forEach(c => {
      c.addEventListener('click', () => c.classList.toggle('active'));
    });
  }

  // ========== 图片上传（多图并发 + 取消 + 整理） ==========
  // item.status: 'queued' | 'processing' | 'ok' | 'failed'
  let imageQueue = [];
  let imgIdSeq = 0;
  let currentRun = null; // { abortController, cancelled }

  // 上传前压缩：用 createImageBitmap 原生解码（比 Image+FileReader 快 3-5×），
  // toBlob 直接出二进制（比 toDataURL 快 2×），最长边 1280px / JPEG 0.72。
  // 聊天截图 OCR 不需要高清，这套参数能把 payload 砍 50%+ 且准确率几乎无损。
  async function compressImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        const MAX = 1280;
        let w = bitmap.width, h = bitmap.height;
        if (Math.max(w, h) > MAX) {
          const k = MAX / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const cx = canvas.getContext('2d');
        cx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const blob = await new Promise((res, rej) =>
          canvas.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/jpeg', 0.72)
        );
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error('read failed'));
          r.readAsDataURL(blob);
        });
        return { dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg' };
      } catch (e) {
        // 落到老路径
      }
    }
    // fallback：旧浏览器
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          const MAX = 1280;
          let { width: w, height: h } = img;
          if (Math.max(w, h) > MAX) {
            const k = MAX / Math.max(w, h);
            w = Math.round(w * k); h = Math.round(h * k);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const cx = canvas.getContext('2d');
          cx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          resolve({ dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function bindImageUpload() {
    const fileInput = $('image-input');
    const btnUpload = $('btn-upload-image');
    const preview = $('image-preview');
    const status = $('image-status');
    const statusText = $('image-status-text');
    const actions = $('image-status-actions');
    const uploadSection = $('image-upload-section');

    btnUpload.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      fileInput.value = '';
      if (files.length) await addImageFiles(files);
    });

    uploadSection.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadSection.style.borderColor = 'var(--accent)';
      uploadSection.style.background = 'rgba(255,217,102,0.1)';
    });
    uploadSection.addEventListener('dragleave', () => {
      uploadSection.style.borderColor = '';
      uploadSection.style.background = '';
    });
    uploadSection.addEventListener('drop', async (e) => {
      e.preventDefault();
      uploadSection.style.borderColor = '';
      uploadSection.style.background = '';
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length) await addImageFiles(files);
    });

    preview.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-remove');
      if (btn) {
        const id = +btn.dataset.id;
        imageQueue = imageQueue.filter(it => it.id !== id);
        renderImagePreview();
        updateStatus();
        flushToTextarea();
        return;
      }
      // 失败/排队中的缩略图点击 = 重试单张
      const thumb = e.target.closest('.img-thumb.failed, .img-thumb.queued');
      if (thumb) {
        const id = +thumb.dataset.id;
        const item = imageQueue.find(it => it.id === id);
        if (item) {
          item.status = 'queued';
          item.errorReason = '';
          renderImagePreview();
          updateStatus();
          runQueue();
        }
      }
    });

    async function addImageFiles(files) {
      // 全部压缩入队（status=queued），不阻塞主线程
      for (const file of files) {
        const id = ++imgIdSeq;
        let item;
        try {
          const { dataUrl, base64, mime } = await compressImage(file);
          item = { id, dataUrl, base64, mime, status: 'queued', text: '', errorReason: '' };
        } catch (e) {
          item = { id, dataUrl: '', base64: '', mime: '', status: 'failed', text: '', errorReason: '压缩失败：' + e.message };
        }
        imageQueue.push(item);
        renderImagePreview();
        updateStatus();
      }
      runQueue();
    }

    // 并发池：最多 CONCURRENCY 个 in-flight
    async function runQueue() {
      if (currentRun) return; // 已有运行中的，避免叠加
      const abortController = new AbortController();
      currentRun = { abortController, cancelled: false };
      const CONCURRENCY = 5; // 用户上限 5 张，正好一图一槽

      async function worker() {
        while (true) {
          if (currentRun.cancelled) return;
          const item = imageQueue.find(it => it.status === 'queued');
          if (!item) return;
          item.status = 'processing';
          item.errorReason = '';
          renderImagePreview();
          updateStatus();
          try {
            const res = await fetch('/api/parse_image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: item.base64, mime: item.mime }),
              signal: abortController.signal,
            });
            const result = await res.json();
            if (result.error || !result.text) {
              item.status = 'failed';
              item.text = '';
              item.errorReason = result.error || result.details || '模型未返回结果';
            } else {
              item.status = 'ok';
              item.text = result.text.trim();
            }
          } catch (e) {
            if (e.name === 'AbortError') {
              item.status = 'queued'; // 回队列，下次可继续
            } else {
              item.status = 'failed';
              item.errorReason = '网络异常：' + e.message;
            }
          }
          renderImagePreview();
          updateStatus();
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      const wasCancelled = currentRun.cancelled;
      currentRun = null;
      flushToTextarea();
      if (!wasCancelled) {
        const okCount = imageQueue.filter(it => it.status === 'ok').length;
        if (okCount > 1) toast(`已合并 ${okCount} 张截图`);
        else if (okCount === 1) toast('图片文字已提取');
      }
      updateStatus();
    }

    function cancelAll() {
      if (!currentRun) return;
      currentRun.cancelled = true;
      currentRun.abortController.abort();
      // worker 退出后 currentRun 会被置空并 updateStatus
    }

    function retryAllFailed() {
      let count = 0;
      imageQueue.forEach(it => {
        if (it.status === 'failed') {
          it.status = 'queued';
          it.errorReason = '';
          count++;
        }
      });
      renderImagePreview();
      updateStatus();
      if (count) runQueue();
    }

    function clearAll() {
      if (currentRun) cancelAll();
      imageQueue = [];
      renderImagePreview();
      updateStatus();
      $('msg-input').value = '';
    }

    function renderImagePreview() {
      if (!imageQueue.length) {
        preview.classList.add('hidden');
        preview.innerHTML = '';
        return;
      }
      preview.classList.remove('hidden');
      preview.innerHTML = imageQueue.map((it, i) => {
        const cls = it.status === 'processing' ? 'processing'
                  : it.status === 'failed' ? 'failed'
                  : it.status === 'queued' ? 'queued' : '';
        const src = it.dataUrl || '';
        const titleMap = {
          failed: it.errorReason || '识别失败，点击重试',
          queued: '排队中，点击立即重试',
          processing: '识别中…',
        };
        const title = titleMap[it.status] || '';
        const clickable = (it.status === 'failed' || it.status === 'queued') ? 'cursor:pointer;' : '';
        return `
          <div class="img-thumb ${cls}" data-id="${it.id}" title="${escapeHtml(title)}" style="${clickable}">
            <img src="${src}" alt="图${i + 1}">
            <span class="img-thumb-order">${i + 1}</span>
            <button class="btn-remove" data-id="${it.id}" title="移除">✕</button>
          </div>
        `;
      }).join('');
    }

    function addActionButton(label, handler, danger) {
      const btn = document.createElement('button');
      btn.className = 'img-action-btn' + (danger ? ' danger' : '');
      btn.textContent = label;
      btn.addEventListener('click', handler);
      actions.appendChild(btn);
    }

    function updateStatus() {
      const total = imageQueue.length;
      actions.innerHTML = '';
      if (!total) { status.classList.add('hidden'); return; }
      const ok = imageQueue.filter(it => it.status === 'ok').length;
      const failed = imageQueue.filter(it => it.status === 'failed').length;
      const processing = imageQueue.filter(it => it.status === 'processing').length;
      const queued = imageQueue.filter(it => it.status === 'queued').length;

      status.classList.remove('hidden');

      if (processing > 0 || (currentRun && queued > 0)) {
        // 识别中
        statusText.textContent = `识别中… ${ok}/${total}`;
        addActionButton('取消', cancelAll);
      } else if (queued > 0) {
        // 取消后剩余
        statusText.textContent = `已暂停 · ${ok}/${total} 完成，剩 ${queued} 张`;
        addActionButton('继续识别', () => runQueue());
        addActionButton('清空全部', clearAll, true);
      } else if (failed > 0) {
        // 全部结束但有失败
        const firstFail = imageQueue.find(it => it.status === 'failed');
        statusText.textContent = `${ok}/${total} 成功 · ${failed} 张失败：${firstFail?.errorReason || '未知'}`;
        addActionButton(`重试 ${failed} 张失败`, retryAllFailed);
        addActionButton('清空全部', clearAll, true);
      } else {
        // 全部成功
        statusText.textContent = `识别完成 ✓ ${total} 张`;
        addActionButton('清空全部', clearAll, true);
      }
    }

    function flushToTextarea() {
      const okItems = imageQueue.filter(it => it.status === 'ok' && it.text);
      if (!okItems.length) return;
      const text = okItems.map(it => it.text).join('\n');
      $('msg-input').value = text;
      $('msg-input').focus();
    }
  }

  // ========== 音频 ==========
  let thinkingSound = null;

  function bindBatchEvents() {
    $('btn-batch-again').addEventListener('click', decodeAgain);
  }
  function bindAudio() {
    const btn = $('btn-music');
    // 首次点击任意位置开启音频上下文
    const firstClick = () => {
      if (window.CatAudio) CatAudio.init();
      document.removeEventListener('click', firstClick);
    };
    document.addEventListener('click', firstClick);

    btn.addEventListener('click', () => {
      if (!window.CatAudio) return;
      CatAudio.init();
      if (CatAudio.isMusicPlaying()) {
        CatAudio.stopMusic();
        btn.textContent = '🔇';
        btn.classList.remove('active');
      } else {
        CatAudio.startMusic();
        btn.textContent = '🔊';
        btn.classList.add('active');
      }
    });
  }

  // ========== 模式切换（已合并入单一输入框，保留空函数兼容 init）==========
  function bindModeTabs() {}

  // ========== 批量解码（已合并入 decode，保留空实现避免引用错误）==========
  async function decodeBatch() {}

  function showBatchResult(r) {
    $('input-section').classList.add('hidden');
    $('result-section').classList.add('hidden');
    $('batch-result').classList.remove('hidden');

    const healthMap = { green:'💚 健康', yellow:'⚠️ 需注意', red:'🔴 危险' };
    $('batch-dynamic').textContent = r.power_dynamic || '';
    $('batch-their-state').textContent = r.their_hidden_state || '';
    $('batch-your-state').textContent = r.your_hidden_state || '';
    $('batch-deadlock').textContent = r.deadlock || '';
    $('batch-health').textContent = (healthMap[r.health_level] || '') + ' ' + (r.health_detail || '');
    $('batch-advice').textContent = r.advice || '';
    $('batch-whisper').textContent = r.cat_whisper || '';

    lastBatchResult = { ...(lastBatchResult || {}), ...r };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ========== 首次引导 ==========
  function showOnboarding() {
    if (localStorage.getItem('cat6_onboarded')) return;
    setTimeout(() => {
      $('onboarding').classList.remove('hidden');
    }, 800);
  }

  function bindOnboarding() {
    $('ob-start').addEventListener('click', () => {
      $('onboarding').classList.add('hidden');
      localStorage.setItem('cat6_onboarded', '1');
      // 自动开启音乐
      if (window.CatAudio) {
        CatAudio.init();
        CatAudio.startMusic();
        $('btn-music').textContent = '🔊';
        $('btn-music').classList.add('active');
      }
    });
  }

  // ========== 初始化 ==========
  function init() {
    loadData();
    initCat();
    updateStats();
    renderHistory();
    bindEvents();
    bindProfileEvents();
    bindAudio();
    bindModeTabs();
    bindOnboarding();
    bindBatchEvents();
    bindImageUpload();
    renderProfileSelector();
    renderProfileList();
    showOnboarding();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
