import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Hud {
  constructor(camera) {
    this.camera = camera;
    this.meterFill = document.querySelector('#meter .fill');
    this.stanceEl = document.querySelector('#meter .stance');
    this.noiseFill = document.querySelector('#meter .noise-fill');
    this.nvEl = document.getElementById('nv');
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
  }

  update({ light = 0, stance = '', prompt = '', guards = [], noise = 0, nv = false, held = '',
    health = 1, alert = '', hurt = 0 } = {}) {
    const hp = `HEALTH ${Math.round(Math.max(0, health) * 100)}`;
    if (this.healthEl.textContent !== hp) this.healthEl.textContent = hp;
    this.healthEl.classList.toggle('low', health < 0.5);
    if (this.alertEl.textContent !== alert) this.alertEl.textContent = alert;
    this.hurtEl.style.opacity = Math.max(0, Math.min(1, hurt)).toFixed(2);
    if (this.heldEl.textContent !== held) this.heldEl.textContent = held;
    const nz = Math.max(0, Math.min(1, noise));
    this.noiseFill.style.width = (nz * 100).toFixed(1) + '%';
    // muted grey-blue -> orange-red
    this.noiseFill.style.background =
      `rgb(${Math.round(95 + 150 * nz)},${Math.round(106 - 20 * nz)},${Math.round(125 - 85 * nz)})`;
    const nvShow = nv ? 'block' : 'none';
    if (this.nvEl.style.display !== nvShow) this.nvEl.style.display = nvShow;
    const l = Math.max(0, Math.min(1, light));
    this.meterFill.style.width = (l * 100).toFixed(1) + '%';
    // dim grey-green -> bright warm white
    const r = Math.round(80 + 175 * l), g = Math.round(96 + 153 * l), b = Math.round(86 + 124 * l);
    this.meterFill.style.background = `rgb(${r},${g},${b})`;
    if (this.stanceEl.textContent !== stance) this.stanceEl.textContent = stance;
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

  showOverlay(title, msg, small = '') {
    this.overlayH1.textContent = title;
    this.overlayMsg.textContent = msg;
    this.overlaySmall.textContent = small;
    this.overlay.classList.remove('hidden');
  }

  hideOverlay() { this.overlay.classList.add('hidden'); }

  get overlayVisible() { return !this.overlay.classList.contains('hidden'); }
}
