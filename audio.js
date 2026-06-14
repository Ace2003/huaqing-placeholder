/* ============================================================
   音频引擎 — Web Audio API 实时合成
   环境音乐 + 交互音效，零音频文件，零版权
   ============================================================ */
(function (global) {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let musicNodes = [];
  let musicPlaying = false;
  let sparklerTimer = null;

  function init() {
    if (ctx) return;
    const AC = global.AudioContext || global.webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(masterGain);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.5;
    sfxGain.connect(masterGain);
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // ===== 主机工作白噪音 =====
  // 设计：模拟电脑主机运行时的环境声场
  // - 风扇呼啸（棕噪声 + 低通）= 主机最底层的"沙沙"声
  // - 中频气流（粉噪声 + 低通）= 机箱内的空气流动
  // - 工频电感嗡鸣（正弦 60Hz + 120Hz 谐波）= 电源/线圈嗡鸣
  // - 极轻的高频嘶嘶（白噪声 + 高通）= 电路底噪
  // - 周期性硬盘"咔嗒"声 = HDD 读写
  function startMusic() {
    init();
    resume();
    if (musicPlaying) return;
    musicPlaying = true;

    const now = ctx.currentTime;

    // 1) 风扇主体：棕噪声 + 低通 ~500Hz（低频风扇"呼呼"）
    const fanNoise = makeNoiseSource('brown');
    const fanFilter = ctx.createBiquadFilter();
    fanFilter.type = 'lowpass';
    fanFilter.frequency.value = 480;
    fanFilter.Q.value = 0.8;
    const fanGain = ctx.createGain();
    fanGain.gain.value = 0;

    // 风扇"加减速"起伏：每 8-15s 风扇音量轻微变化（CPU 负载感）
    const fanLfo = ctx.createOscillator();
    fanLfo.frequency.value = 0.08;
    const fanLfoGain = ctx.createGain();
    fanLfoGain.gain.value = 0.05;
    fanLfo.connect(fanLfoGain);
    fanLfoGain.connect(fanGain.gain);

    fanNoise.connect(fanFilter);
    fanFilter.connect(fanGain);
    fanGain.connect(musicGain);
    fanNoise.start(now);
    fanLfo.start(now);
    fanGain.gain.setValueAtTime(0, now);
    fanGain.gain.linearRampToValueAtTime(0.22, now + 3);
    musicNodes.push(fanNoise, fanFilter, fanGain, fanLfo, fanLfoGain);

    // 2) 中频气流：粉噪声 + 低通 ~1800Hz（机箱空气流动）
    const airNoise = makeNoiseSource('pink');
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 1800;
    airFilter.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    airNoise.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(musicGain);
    airNoise.start(now);
    airGain.gain.setValueAtTime(0, now);
    airGain.gain.linearRampToValueAtTime(0.08, now + 4);
    musicNodes.push(airNoise, airFilter, airGain);

    // 3) 工频嗡鸣：60Hz 正弦 + 120Hz 谐波（电源/线圈蜂鸣）
    [60, 120].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(musicGain);
      osc.start(now);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.025 : 0.012, now + 4);
      musicNodes.push(osc, g);
    });

    // 4) 高频电路嘶嘶：白噪声 + 高通 ~6000Hz（极轻）
    const hissNoise = makeNoiseSource('white');
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 6000;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hissNoise.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(musicGain);
    hissNoise.start(now);
    hissGain.gain.setValueAtTime(0, now);
    hissGain.gain.linearRampToValueAtTime(0.015, now + 5);
    musicNodes.push(hissNoise, hissFilter, hissGain);

    // —— 总音量渐入 ——
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(0.55, now + 2);

    // 5) 周期性硬盘读写声：每 5-10s 触发一次"咔嗒"
    sparklerTimer = setInterval(() => {
      if (!musicPlaying) return;
      playHddTick();
    }, 7000);
    // 偶尔的连续读写（连续咔嗒）
    setTimeout(() => { if (musicPlaying) playHddBurst(); }, 9000);
  }

  // 生成噪声 buffer（white / pink / brown）
  function makeNoiseSource(type) {
    const seconds = 3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (type === 'white') {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      // Paul Kellet 近似算法
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function stopMusic() {
    if (!musicPlaying || !ctx) return;
    musicPlaying = false;
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(0, now + 1.0);
    if (sparklerTimer) { clearInterval(sparklerTimer); sparklerTimer = null; }

    setTimeout(() => {
      musicNodes.forEach(n => {
        try { if (n.stop) n.stop(); } catch(e) {}
        try { n.disconnect(); } catch(e) {}
      });
      musicNodes = [];
    }, 1200);
  }

  // 硬盘单次"咔嗒"声
  function playHddTick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    // 高频短脉冲：极短的白噪声 + bandpass
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3500 + Math.random() * 2000;
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.value = 0.08 + Math.random() * 0.04;
    src.connect(bp); bp.connect(g); g.connect(musicGain);
    src.start(now);
  }

  // 偶发的连续读写（3-5 次连续咔嗒）
  function playHddBurst() {
    if (!ctx || !musicPlaying) return;
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      setTimeout(() => { if (musicPlaying) playHddTick(); }, i * (80 + Math.random() * 60));
    }
    // 安排下一次
    setTimeout(() => { if (musicPlaying) playHddBurst(); }, 15000 + Math.random() * 15000);
  }

  // ===== 交互音效 =====

  // 解码思考音（低频嗡嗡）
  function playThinking() {
    init(); resume();
    if (!ctx) return null;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 110;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.2);
    gain.gain.linearRampToValueAtTime(0.05, now + 2.5);
    gain.gain.linearRampToValueAtTime(0, now + 3);

    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);

    // 颤音
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 3;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vib.start(now);

    return { osc, vib, gain, stopAt: now + 3 };
  }

  function stopThinking(thinkingSound) {
    if (!thinkingSound || !ctx) return;
    const now = ctx.currentTime;
    try {
      thinkingSound.gain.gain.cancelScheduledValues(now);
      thinkingSound.gain.gain.setValueAtTime(thinkingSound.gain.gain.value, now);
      thinkingSound.gain.gain.linearRampToValueAtTime(0, now + 0.2);
      thinkingSound.osc.stop(now + 0.3);
      thinkingSound.vib.stop(now + 0.3);
    } catch(e) {}
  }

  // 结果出现音（清脆叮）
  function playReveal() {
    init(); resume();
    if (!ctx) return;
    const now = ctx.currentTime;
    // 两个音的琶音
    [880, 1320].forEach((freq, i) => {
      const t = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.8);
    });
  }

  // 升级音（上升琶音）
  function playLevelUp() {
    init(); resume();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => { // C E G C
      const t = now + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain);
      gain.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  // 点击音
  function playClick() {
    init(); resume();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  const Audio = {
    init, resume,
    startMusic, stopMusic,
    isMusicPlaying: () => musicPlaying,
    playThinking, stopThinking,
    playReveal, playLevelUp, playClick,
  };
  global.CatAudio = Audio;
})(window);
