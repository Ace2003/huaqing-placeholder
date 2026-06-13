/* ============================================================
   像素猫渲染引擎 v3 — 英短蓝猫（离屏画布优化版）
   先渲染到 32x32 小画布，再 drawImage 缩放，性能极佳
   ============================================================ */
(function (global) {
  'use strict';

  const C = {
    outline:  '#1e2a3a',
    furDark:  '#4a6378',
    furMid:   '#6b8aa3',
    furLight: '#8daec5',
    furHi:    '#a8c5d8',
    belly:    '#c5d8e3',
    earIn:    '#d4a0b0',
    eye:      '#c4881e',
    eyeDark:  '#8a5e15',
    eyeShine: '#ffe89a',
    nose:     '#d47a8e',
    noseDark: '#a85a6e',
    mouth:    '#6a4a52',
    blush:    '#e89ab0',
    whisker:  '#d8e0e8',
  };

  const GRID = 32;

  function PixelCat(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // 离屏小画布（32x32 像素）
    this.off = document.createElement('canvas');
    this.off.width = GRID;
    this.off.height = GRID;
    this.ox = this.off.getContext('2d');

    this.state = 'idle';
    this.frame = 0;
    this.blinkT = 0;
    this.blinking = false;
    this.tailPhase = 0;
    this.earTwitch = 0;
    this.hearts = [];
    this.onStateChange = opts.onStateChange || function(){};
    this.level = opts.level || 1;
    this._raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  PixelCat.prototype.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = this.canvas.clientWidth || 200;
    this.canvas.width = css * dpr;
    this.canvas.height = css * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.dpr = dpr;
    this.cssSize = css;
  };

  // 在 32x32 离屏画布上画 1 像素
  PixelCat.prototype.p1 = function (gx, gy, color) {
    if (!color) return;
    this.ox.fillStyle = color;
    this.ox.fillRect(gx | 0, gy | 0, 1, 1);
  };

  // 离屏画布上填充椭圆
  PixelCat.prototype.ellipse = function (cx, cy, rx, ry, color) {
    if (!color) return;
    this.ox.fillStyle = color;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      for (let x = -Math.ceil(rx); x <= Math.ceil(rx); x++) {
        if ((x*x)/(rx*rx) + (y*y)/(ry*ry) <= 1) {
          this.ox.fillRect((cx+x) | 0, (cy+y) | 0, 1, 1);
        }
      }
    }
  };

  // 离屏画布上画线
  PixelCat.prototype.line = function (x0, y0, x1, y1, color) {
    let dx = Math.abs(x1-x0), dy = Math.abs(y1-y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0|0, y = y0|0;
    this.ox.fillStyle = color;
    while (true) {
      this.ox.fillRect(x, y, 1, 1);
      if (x === (x1|0) && y === (y1|0)) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  };

  PixelCat.prototype.setState = function (s) {
    if (this.state !== s) { this.state = s; this.onStateChange(s); }
  };

  // ===== 主绘制 =====
  PixelCat.prototype.draw = function (dt) {
    // 清空离屏画布
    this.ox.clearRect(0, 0, GRID, GRID);

    this.frame += dt * 6;
    this.tailPhase += dt * 1.5;
    this.earTwitch += dt;
    this.blinkT += dt;

    if (this.blinkT > 2.5 + Math.random() * 2 && !this.blinking) this.blinking = true;
    if (this.blinking && this.blinkT > 2.8) { this.blinking = false; this.blinkT = 0; }

    const breathe = Math.sin(this.frame * 0.4) * 0.6;
    const bounce = (this.state === 'charging' || this.state === 'happy')
      ? Math.abs(Math.sin(this.frame * 1.8)) * 1.2 : 0;

    if (this.state === 'dead') {
      this.drawDead();
    } else {
      this.drawCat(breathe, bounce);
    }

    // 爱心粒子（也在离屏画布上）
    if ((this.state === 'charging' || this.state === 'happy') && Math.random() < 0.06) {
      this.hearts.push({ x: 8 + Math.random()*16, y: 10, vy: -0.4 - Math.random()*0.3, vx: (Math.random()-0.5)*0.3, life: 1 });
    }
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.x += h.vx; h.y += h.vy; h.life -= dt * 0.7;
      if (h.life <= 0) { this.hearts.splice(i,1); continue; }
      this.drawHeart(h.x, h.y, h.life);
    }

    // 缩放绘制到显示画布（一次 drawImage，极快）
    this.ctx.clearRect(0, 0, this.cssSize, this.cssSize);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, GRID, GRID, 0, 0, this.cssSize, this.cssSize);
  };

  PixelCat.prototype.drawCat = function (breathe, bounce) {
    const oy = bounce - breathe;
    const bBr = breathe;

    // 阴影
    this.ellipse(16, 29, 8, 1.2, 'rgba(0,0,0,0.25)');
    // 尾巴
    this.drawTail(this.tailPhase, oy);
    // 身体
    this.ellipse(16, 24 + bBr*0.5, 9, 6.5 + bBr*0.3, C.furMid);
    this.ellipse(13, 22 + bBr*0.5, 4, 3, C.furLight);
    this.ellipse(16, 25 + bBr*0.5, 4.5, 3.5, C.belly);
    // 前爪
    this.ellipse(12, 28, 2.2, 1.5, C.furMid);
    this.ellipse(20, 28, 2.2, 1.5, C.furMid);
    this.ellipse(12, 28, 1, 0.8, C.furDark);
    this.ellipse(20, 28, 1, 0.8, C.furDark);

    // 头
    const hy = 14 + oy;
    this.drawEars(hy);
    this.ellipse(16, hy, 9.5, 8.5, C.furMid);
    this.ellipse(12, hy - 2, 3.5, 2.5, C.furLight);
    this.ellipse(11, hy - 3, 1.5, 1, C.furHi);
    this.ellipse(7.5, hy + 2, 2, 2.5, C.furDark);
    this.ellipse(24.5, hy + 2, 2, 2.5, C.furDark);
    this.ellipse(16, hy + 5, 4, 2.5, C.furLight);
    this.drawFace(hy);
  };

  PixelCat.prototype.drawEars = function (hy) {
    this.ellipse(8, hy - 6, 2.5, 3.5, C.furMid);
    this.ellipse(8, hy - 6, 1.5, 2.5, C.earIn);
    this.ellipse(24, hy - 6, 2.5, 3.5, C.furMid);
    this.ellipse(24, hy - 6, 1.5, 2.5, C.earIn);
    this.p1(8, hy - 9, C.furDark);
    this.p1(24, hy - 9, C.furDark);
  };

  PixelCat.prototype.drawFace = function (hy) {
    const eyeOpen = !this.blinking && this.state !== 'low';
    const eyeY = hy - 1;

    if (this.state === 'happy' || this.state === 'charging') {
      this.drawHappyEye(11, eyeY);
      this.drawHappyEye(21, eyeY);
    } else if (eyeOpen) {
      this.drawEye(11, eyeY);
      this.drawEye(21, eyeY);
    } else {
      this.line(9, eyeY, 13, eyeY, C.eyeDark);
      this.line(9, eyeY+1, 13, eyeY+1, C.eyeDark);
      this.line(19, eyeY, 23, eyeY, C.eyeDark);
      this.line(19, eyeY+1, 23, eyeY+1, C.eyeDark);
    }

    this.ellipse(9, hy + 3, 1.8, 1.2, C.blush);
    this.ellipse(23, hy + 3, 1.8, 1.2, C.blush);

    // 鼻子
    this.p1(15, hy + 2, C.noseDark);
    this.p1(16, hy + 2, C.noseDark);
    this.p1(15, hy + 3, C.nose);
    this.p1(16, hy + 3, C.nose);
    this.p1(17, hy + 3, C.nose);
    this.p1(14, hy + 3, C.nose);

    // 嘴
    if (this.state === 'happy' || this.state === 'charging') {
      this.p1(15, hy + 5, C.mouth);
      this.p1(16, hy + 5, C.mouth);
      this.p1(14, hy + 4, C.mouth);
      this.p1(17, hy + 4, C.mouth);
      this.p1(13, hy + 5, C.mouth);
      this.p1(18, hy + 5, C.mouth);
    } else {
      this.line(16, hy + 4, 14, hy + 5, C.mouth);
      this.line(16, hy + 4, 18, hy + 5, C.mouth);
    }

    // 胡须
    this.line(6, hy + 2, 2, hy + 1, C.whisker);
    this.line(6, hy + 3, 2, hy + 3, C.whisker);
    this.line(6, hy + 4, 2, hy + 5, C.whisker);
    this.line(26, hy + 2, 30, hy + 1, C.whisker);
    this.line(26, hy + 3, 30, hy + 3, C.whisker);
    this.line(26, hy + 4, 30, hy + 5, C.whisker);
  };

  PixelCat.prototype.drawEye = function (cx, cy) {
    this.ellipse(cx, cy, 2.8, 3.2, C.eyeDark);
    this.ellipse(cx, cy, 2.3, 2.8, C.eye);
    this.ellipse(cx, cy, 0.8, 2.2, C.outline);
    this.ellipse(cx - 0.5, cy - 1, 1, 1, C.eyeShine);
    this.p1(cx + 1, cy + 1, C.eyeShine);
  };

  PixelCat.prototype.drawHappyEye = function (cx, cy) {
    this.p1(cx - 2, cy + 1, C.eyeDark);
    this.p1(cx - 1, cy, C.eyeDark);
    this.p1(cx, cy - 1, C.eyeDark);
    this.p1(cx + 1, cy, C.eyeDark);
    this.p1(cx + 2, cy + 1, C.eyeDark);
  };

  PixelCat.prototype.drawTail = function (phase, oy) {
    const sway = Math.sin(phase) * 1.2;
    const pts = [
      [25, 24], [27 + sway*0.3, 22], [28 + sway*0.6, 19],
      [27 + sway, 16], [25 + sway, 15],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i+1];
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        this.ellipse(x0 + (x1-x0)*t, y0 + (y1-y0)*t, 1.8, 1.8, C.furMid);
      }
    }
    const last = pts[pts.length-1];
    this.ellipse(last[0], last[1], 1.2, 1.2, C.furLight);
  };

  PixelCat.prototype.drawDead = function () {
    this.ellipse(16, 26, 9, 1.5, 'rgba(0,0,0,0.3)');
    this.ellipse(16, 20, 10, 5, C.furDark);
    this.ellipse(16, 19, 9, 4, C.furMid);
    this.ellipse(22, 19, 5, 4, C.furMid);
    // X 眼
    this.p1(20, 17, C.outline);
    this.p1(22, 19, C.outline);
    this.p1(22, 17, C.outline);
    this.p1(20, 19, C.outline);
    this.p1(23, 17, C.outline);
    this.p1(25, 19, C.outline);
    this.p1(25, 17, C.outline);
    this.p1(23, 19, C.outline);
  };

  PixelCat.prototype.drawHeart = function (gx, gy, alpha) {
    const c = alpha > 0.5 ? '#ff6b8a' : '#ffb0c0';
    this.ox.globalAlpha = Math.max(0, alpha);
    this.p1(gx, gy, c); this.p1(gx+2, gy, c);
    this.p1(gx, gy+1, c); this.p1(gx+1, gy+1, c); this.p1(gx+2, gy+1, c);
    this.p1(gx+1, gy+2, c);
    this.ox.globalAlpha = 1;
  };

  // 等级徽章（画在显示画布上，不在离屏上）
  PixelCat.prototype.drawLevelBadge = function () {
    if (!this.level) return;
    const ctx = this.ctx;
    const s = this.cssSize / GRID;
    const bx = 24 * s, by = 2 * s;
    const bw = 7 * s, bh = 4 * s;
    ctx.fillStyle = 'rgba(255,217,102,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#1e2a3a';
    ctx.font = `bold ${3.2 * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Lv' + this.level, bx + bw/2, by + bh/2 + 0.3*s);
  };

  PixelCat.prototype.start = function () {
    if (this._raf) return;
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      this.draw(dt);
      this.drawLevelBadge();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  };

  PixelCat.prototype.stop = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  global.PixelCat = PixelCat;
})(window);
