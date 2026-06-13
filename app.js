/* ============================================================
   猫的第六感 — 主逻辑
   ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const SAVE_KEY = 'cat6_data';

  // ========== 存档 ==========
  let data = { insight: 0, streak: 0, lastDate: '', history: [], profiles: [], selectedProfileId: null, catLevel: 1, catName: '蓝喵' };
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
    cat = new PixelCat($('cat-canvas'), { onStateChange(){}, level: data.catLevel || 1 });
    cat.start();
  }

  // ========== 统计更新 ==========
  function updateStats() {
    $('stat-insight').textContent = data.insight;
    $('stat-streak').textContent = data.streak;
  }

  // ========== 解码 ==========
  async function decode() {
    const input = $('msg-input');
    const text = input.value.trim();
    if (!text) { toast('先粘贴一条消息吧'); return; }

    const btn = $('btn-decode');
    btn.disabled = true;
    btn.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span> 猫猫在读…';
    $('cat-stage').classList.add('thinking');
    if (cat) cat.setState('charging');

    try {
      const profile = getSelectedProfile();
      const res = await fetch('/api/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, profile })
      });
      const result = await res.json();
      showResult(text, result);
      recordDecode(text, result);
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
    // 猫猫成长：每 5 次洞察升一级
    const newLevel = Math.min(99, 1 + Math.floor(data.insight / 5));
    if (newLevel > data.catLevel) {
      data.catLevel = newLevel;
      if (cat) cat.level = newLevel;
      setTimeout(() => toast('🎉 猫猫升级了！Lv.' + newLevel), 1500);
    }
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

  let lastResult = null;

  // ========== 再来一条 ==========
  function decodeAgain() {
    $('result-section').classList.add('hidden');
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
    list.innerHTML = data.history.map((h, i) => `
      <div class="history-item" data-idx="${i}">
        <div class="history-msg">${escapeHtml(h.msg)}</div>
        <div class="history-real">${escapeHtml(h.real || '')}</div>
        <div class="history-time">${timeAgo(h.time)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = +el.dataset.idx;
        const h = data.history[idx];
        if (h) {
          showResult(h.msg, h.full || {});
          $('history-drawer').classList.add('hidden');
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

  // ========== 初始化 ==========
  function init() {
    loadData();
    initCat();
    updateStats();
    renderHistory();
    bindEvents();
    bindProfileEvents();
    renderProfileSelector();
    renderProfileList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
