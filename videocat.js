/* ============================================================
   视频猫渲染引擎 v4
   - 完整帧不裁剪
   - 背景彻底透明（先抠再映射，无残留）
   - 升级效果只在猫周围，不碰猫像素
   ============================================================ */
(function (global) {
  'use strict';

  const PIX_W = 32;
  const PIX_H = 56;

  // 背景色 + 容差
  const BG_R = 6, BG_G = 26, BG_B = 72;
  const BG_CUT = 60;       // 小于此距离 = 完全透明
  const BG_FADE = 25;      // 过渡区间

  // 7 色暖调色板（去掉深蓝，避免残留矩形）
  const PALETTE = [
    [42, 32, 48],    // 0: 深描边
    [120, 72, 60],   // 1: 深棕毛
    [180, 118, 92],  // 2: 中间毛
    [228, 148, 148], // 3: 粉色
    [240, 200, 160], // 4: 浅毛
    [255, 240, 224], // 5: 高光
    [200, 150, 110], // 6: 过渡棕
  ];

  const paletteCache = {};
  function nearestPalette(r, g, b) {
    const key = ((r >> 3) << 6) | ((g >> 3) << 3) | (b >> 3);
    if (paletteCache[key]) return paletteCache[key];
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < PALETTE.length; i++) {
      const p = PALETTE[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    paletteCache[key] = best;
    return best;
  }

  const BAYER = [
    [ 0, 8, 2,10],
    [12, 4,14, 6],
    [ 3,11, 1, 9],
    [15, 7,13, 5],
  ];

  function VideoCat(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.small = document.createElement('canvas');
    this.small.width = PIX_W;
    this.small.height = PIX_H;
    this.sctx = this.small.getContext('2d');

    this.state = 'idle';
    this.level = opts.level || 1;
    this.onStateChange = opts.onStateChange || function(){};
    this._raf = null;
    this._ready = false;
    // 萤火虫粒子（升级特效用）
    this.fireflies = [];

    this.video = document.createElement('video');
    this.video.src = 'cat.mp4';
    this.video.loop = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;

    this.video.addEventListener('loadeddata', () => {
      this._ready = true;
      this.video.play().catch(() => {});
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  VideoCat.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = this.canvas.clientWidth || 140;
    const cssH = this.canvas.clientHeight || 240;
    this.canvas.width = css * dpr;
    this.canvas.height = cssH * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.cssW = css;
    this.cssH = cssH;
  };

  VideoCat.prototype.setState = function (s) {
    if (this.state !== s) { this.state = s; this.onStateChange(s); }
  };

  VideoCat.prototype.draw = function () {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (!this._ready || this.video.readyState < 2) {
      ctx.fillStyle = 'rgba(255,217,102,0.08)';
      ctx.fillRect(this.cssW*0.25, this.cssH*0.3, this.cssW*0.5, this.cssH*0.4);
      return;
    }

    // 1. 视频帧缩放到小画布
    this.sctx.drawImage(this.video, 0, 0, PIX_W, PIX_H);

    // 2. 像素处理
    const imgData = this.sctx.getImageData(0, 0, PIX_W, PIX_H);
    const d = imgData.data;
    const charging = (this.state === 'charging' || this.state === 'happy');

    for (let y = 0; y < PIX_H; y++) {
      for (let x = 0; x < PIX_W; x++) {
        const i = (y * PIX_W + x) * 4;
        const r = d[i], g = d[i+1], b = d[i+2];

        // ★ 先判断背景距离（用原始颜色，映射前）
        const dr = r - BG_R, dg = g - BG_G, db = b - BG_B;
        const dist = Math.sqrt(dr*dr + dg*dg + db*db);

        if (dist < BG_CUT) {
          // 完全透明
          d[i+3] = 0;
          continue;
        } else if (dist < BG_CUT + BG_FADE) {
          // 过渡透明
          d[i+3] = Math.round(255 * (dist - BG_CUT) / BG_FADE);
        }

        // 拜耳抖动
        const bayerVal = BAYER[y & 3][x & 3];
        const adj = bayerVal > 8 ? 10 : -10;

        // 色板映射（不注入金色，保持猫自然色）
        const idx = nearestPalette(
          Math.max(0, Math.min(255, r + adj)),
          Math.max(0, Math.min(255, g + adj)),
          Math.max(0, Math.min(255, b + adj))
        );
        const p = PALETTE[idx];
        d[i] = p[0]; d[i+1] = p[1]; d[i+2] = p[2];
      }
    }
    this.sctx.putImageData(imgData, 0, 0);

    // 3. 放大到显示画布
    ctx.imageSmoothingEnabled = false;
    const dispH = this.cssH;
    const dispW = dispH * (PIX_W / PIX_H);
    const dx = (this.cssW - dispW) / 2;

    // ★ 先画升级光环（在猫身后）
    this.drawLevelAura(ctx, dx, 0, dispW, dispH);

    // 画猫
    ctx.drawImage(this.small, 0, 0, PIX_W, PIX_H, dx, 0, dispW, dispH);

    // ★ 再画升级前景特效（萤火虫、星光，在猫前面但不碰猫像素）
    this.drawLevelForeground(ctx);

    // 充电光晕
    if (charging) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.1 + Math.abs(Math.sin(Date.now()/300)) * 0.06;
      const grad = ctx.createRadialGradient(this.cssW/2, this.cssH*0.45, 0, this.cssW/2, this.cssH*0.45, this.cssW*0.6);
      grad.addColorStop(0, 'rgba(255,200,140,0.4)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.restore();
    }
  };

  // 升级光环（猫身后，径向柔光，不刺眼）
  VideoCat.prototype.drawLevelAura = function (ctx, dx, dy, dw, dh) {
    if (this.level < 3) return;
    const t = Date.now() / 1000;
    const cx = dx + dw / 2;
    const cy = dy + dh * 0.45;
    const breath = 0.85 + Math.sin(t * 1.5) * 0.15;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // 主光晕
    const baseAlpha = Math.min(0.18, 0.04 + this.level * 0.008);
    const grad = ctx.createRadialGradient(cx, cy, dw * 0.08, cx, cy, dw * 0.65 * breath);
    grad.addColorStop(0, `rgba(255,210,160,${baseAlpha})`);
    grad.addColorStop(0.5, `rgba(255,190,140,${baseAlpha * 0.5})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(dx - 20, dy - 20, dw + 40, dh + 40);

    ctx.restore();
  };

  // 升级前景特效（萤火虫光点，浮在猫周围，不碰猫）
  VideoCat.prototype.drawLevelForeground = function (ctx) {
    const lv = this.level;
    if (lv < 5) return;
    const t = Date.now() / 1000;
    const w = this.cssW, h = this.cssH;

    // 根据等级决定萤火虫数量
    const count = lv >= 15 ? 6 : (lv >= 10 ? 4 : 2);

    ctx.save();
    for (let i = 0; i < count; i++) {
      // 每个萤火虫有自己的轨道
      const seed = i * 1.7;
      const angle = t * 0.3 + seed;
      const orbitR = w * (0.28 + Math.sin(t * 0.4 + seed) * 0.08);
      const fx = w/2 + Math.cos(angle) * orbitR;
      const fy = h * 0.4 + Math.sin(angle * 0.7 + seed) * h * 0.25;
      const flicker = 0.4 + Math.sin(t * 3 + seed * 2) * 0.35;

      // 柔光点（径向渐变，不是硬方块）
      const r = 4 + Math.sin(t * 2 + seed) * 1.5;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, r * 2);
      grad.addColorStop(0, `rgba(255,235,180,${flicker})`);
      grad.addColorStop(0.4, `rgba(255,210,140,${flicker * 0.5})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(fx - r*2, fy - r*2, r*4, r*4);

      // 中心亮点
      ctx.fillStyle = `rgba(255,250,220,${flicker * 0.9})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Lv15+ 额外星光闪烁
    if (lv >= 15) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 3; i++) {
        const seed = i * 3.3;
        const sx = w * (0.2 + (i * 0.3));
        const sy = h * (0.15 + Math.sin(t + seed) * 0.05);
        const twinkle = Math.max(0, Math.sin(t * 2 + seed));
        if (twinkle > 0.3) {
          ctx.globalAlpha = (twinkle - 0.3) * 0.7;
          // 四角星
          ctx.strokeStyle = 'rgba(255,240,200,1)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx - 3, sy); ctx.lineTo(sx + 3, sy);
          ctx.moveTo(sx, sy - 3); ctx.lineTo(sx, sy + 3);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };

  VideoCat.prototype.drawLevelBadge = function () {
    if (!this.level) return;
    const ctx = this.ctx;
    const s = 10;
    const bx = this.cssW - s * 2.6;
    const by = s * 0.4;
    const bw = s * 2.4, bh = s * 1.3;
    ctx.fillStyle = 'rgba(255,217,102,0.92)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#1e2a3a';
    ctx.font = `bold ${s * 0.8}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('L' + this.level, bx + bw/2, by + bh/2 + 1);
  };

  VideoCat.prototype.start = function () {
    if (this._raf) return;
    const loop = () => {
      this.draw();
      this.drawLevelBadge();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  VideoCat.prototype.stop = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  global.VideoCat = VideoCat;
})(window);
