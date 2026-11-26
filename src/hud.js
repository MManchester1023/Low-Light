import * as THREE from 'three';

const _v = new THREE.Vector3();
const VIS_CELLS = 12;
const HP_CELLS = 10;

/** Row of segment cells inside the wrist unit. */
function makeCells(el, n) {
  el.textContent = '';
  const cells = [];
  for (let i = 0; i < n; i++) { const c = document.createElement('i'); el.append(c); cells.push(c); }
  return cells;
}

/** What the light reading means, in a word. */
function visWord(l) {
  if (l < 0.12) return 'DARK';
  if (l < 0.35) return 'DIM';
  if (l < 0.65) return 'LIT';
  return 'EXPOSED';
}

// HUD: the wrist unit (light, sound, vitals, kit, status), the context prompt, guard tags, alert banner.
export class Hud {
  constructor(camera) {
    this.camera = camera;
    this.wristEl = document.getElementById('wrist');
    this.ledEl = document.getElementById('wristLed');
    this.visCells = makeCells(document.getElementById('visCells'), VIS_CELLS);
    this.hpCellsEl = document.getElementById('hpCells');
    this.hpCells = makeCells(this.hpCellsEl, HP_CELLS);
    this.visWordEl = document.getElementById('visWord');
    this.sndWordEl = document.getElementById('sndWord');
    this.scope = document.getElementById('scope');
    this.scopeCtx = this.scope.getContext('2d');
    this.scopePhase = 0;
    this.statusEl = document.getElementById('status');
    this.stanceEl = document.getElementById('stance');
    this.ammoPips = document.getElementById('ammoPips');
    this.ammoText = document.getElementById('ammoText');
    this.heldEl = document.getElementById('held');
    this.promptEl = document.getElementById('prompt');
    this.tagTemplate = document.getElementById('guardTag'); // one tag per guard, cloned from this
    this.tags = [];
    this.healthEl = document.getElementById('health');
    this.alertEl = document.getElementById('alert');
    this.hurtEl = document.getElementById('hurt');
    this.overlay = document.getElementById('overlay');
    this.overlayH1 = this.overlay.querySelector('h1');
    this.overlayMsg = this.overlay.querySelector('.msg');
    this.overlaySmall = this.overlay.querySelector('.small');
    this.lastHealth = 1;
  }

  /**
   * light, noise: 0..1 · noiseM: noise radius in m · health: 0..1 · status: 'QUIET' | 'CAUTION' | 'ALERT'
   * ammo: { mag, size, reserve, text } · held: extra kit lines · stance, prompt, alert: text · hurt: 0..1 flash
   */
  update({ light = 0, stance = '', prompt = '', guards = [], noise = 0, noiseM = 0, nv = false, held = '',
    health = 1, alert = '', hurt = 0, status = 'QUIET', ammo = null, dt = 1 / 60 } = {}) {
    const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

    // Light: segment cells, the top few turn amber.
    const l = Math.max(0, Math.min(1, light));
    const lit = Math.round(l * VIS_CELLS);
    this.visCells.forEach((c, i) => {
      c.classList.toggle('on', i < lit);
      c.classList.toggle('hot', i >= VIS_CELLS * 0.66);
    });
    setText(this.visWordEl, visWord(l));

    // Sound: a little oscilloscope whose swing follows the noise radius.
    const nz = Math.max(0, Math.min(1, noise));
    this.drawScope(nz, dt);
    setText(this.sndWordEl, noiseM > 0.05 ? `${noiseM.toFixed(1)}m` : 'SILENT');

    // Vitals.
    const h = Math.max(0, Math.min(1, health));
    const hpOn = Math.ceil(h * HP_CELLS - 1e-6);
    this.hpCells.forEach((c, i) => c.classList.toggle('on', i < hpOn));
    this.hpCellsEl.classList.toggle('low', h < 0.5);
    setText(this.healthEl, String(Math.round(h * 100)));
    if (h < this.lastHealth) {
      this.wristEl.classList.remove('hit');
      void this.wristEl.offsetWidth; // restart the glitch animation
      this.wristEl.classList.add('hit');
    }
    this.lastHealth = h;

    // Kit.
    if (ammo) {
      setText(this.ammoPips, '▮'.repeat(ammo.mag) + '▯'.repeat(Math.max(0, ammo.size - ammo.mag)));
      setText(this.ammoText, `+${ammo.reserve}${ammo.text ? ' ' + ammo.text : ''}`);
    }
    setText(this.heldEl, held);

    // Status.
    setText(this.statusEl, status);
    const cls = status === 'ALERT' ? 'alert' : status === 'CAUTION' ? 'caution' : '';
    this.statusEl.className = 'status ' + cls;
    this.ledEl.className = 'led ' + cls;
    setText(this.stanceEl, stance);
    this.wristEl.classList.toggle('nv', nv);

    if (this.alertEl.textContent !== alert) this.alertEl.textContent = alert;
    this.hurtEl.style.opacity = Math.max(0, Math.min(1, hurt)).toFixed(2);
    if (this.promptEl.textContent !== prompt) this.promptEl.textContent = prompt;
    while (this.tags.length < guards.length) {
      const el = this.tags.length ? this.tagTemplate.cloneNode(true) : this.tagTemplate;
      el.removeAttribute('id');
      el.classList.add('guardTag');
      if (el !== this.tagTemplate) this.tagTemplate.parentNode.appendChild(el);
      this.tags.push({ el, icon: el.querySelector('.icon'), bar: el.querySelector('.bar'), fill: el.querySelector('.bar .fill') });
    }
    this.tags.forEach((t, i) => this._guard(t, guards[i]));
  }

  _guard(el, guard) {
    const tag = el.el;
    if (!guard || !guard.pos || guard.hidden) { tag.style.display = 'none'; return; }
    _v.copy(guard.pos).project(this.camera);
    if (_v.z > 1 || _v.x < -1 || _v.x > 1 || _v.y < -1 || _v.y > 1) { tag.style.display = 'none'; return; }
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    tag.style.display = 'block';
    tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;

    const s = guard.suspicion || 0;
    const icon = guard.icon || '';
    if (el.icon.textContent !== icon) el.icon.textContent = icon;
    el.icon.style.color = icon === '!' ? '#e8412f' : '#f0d040';
    if (Number.isFinite(guard.grip)) {
      // grip mode: bar always shown, width = grip, red (about to break free) -> pale blue-white (plenty of time)
      const gr = Math.max(0, Math.min(1, guard.grip));
      tag.classList.add('grip');
      el.bar.style.visibility = 'visible';
      el.fill.style.width = (gr * 100).toFixed(1) + '%';
      const r = Math.round(232 + (220 - 232) * gr);
      const g = Math.round(65 + (235 - 65) * gr);
      const b = Math.round(47 + (255 - 47) * gr);
      el.fill.style.background = `rgb(${r},${g},${b})`;
    } else if (s < 0.5) {
      tag.classList.remove('grip');
      el.bar.style.visibility = 'hidden';
    } else {
      tag.classList.remove('grip');
      el.bar.style.visibility = 'visible';
      const t = Math.max(0, Math.min(1, s / 100));
      el.fill.style.width = (t * 100).toFixed(1) + '%';
      el.fill.style.background = `rgb(${Math.round(240 - 10 * t)},${Math.round(208 - 150 * t)},${Math.round(64 - 20 * t)})`;
    }
  }

  /** Oscilloscope trace for the sound reading: flat and faint when quiet, a jagged swing when loud. */
  drawScope(level, dt) {
    const ctx = this.scopeCtx;
    const w = this.scope.width;
    const hgt = this.scope.height;
    this.scopePhase += dt * (4 + level * 14);
    ctx.clearRect(0, 0, w, hgt);
    ctx.strokeStyle = 'rgba(141,255,171,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, hgt / 2 + 0.5);
    ctx.lineTo(w, hgt / 2 + 0.5);
    ctx.stroke();
    ctx.strokeStyle = level > 0.6 ? '#ffb347' : '#8dffab';
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const amp = (hgt / 2 - 2) * Math.max(0.04, level);
    const p = this.scopePhase;
    for (let x = 0; x <= w; x += 2) {
      const t = x / w;
      const y = Math.sin(t * 19 + p) * 0.6 + Math.sin(t * 43 - p * 1.7) * 0.3 + Math.sin(t * 97 + p * 2.3) * 0.15 * level;
      const px = hgt / 2 + y * amp;
      if (x === 0) ctx.moveTo(x, px); else ctx.lineTo(x, px);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  showOverlay(title, msg, small = '') {
    this.overlayH1.textContent = title;
    this.overlayMsg.textContent = msg;
    this.overlaySmall.textContent = small;
    this.overlay.classList.remove('hidden');
  }

  hideOverlay() { this.overlay.classList.add('hidden'); }

  get overlayVisible() { return !this.overlay.classList.contains('hidden'); }
}
