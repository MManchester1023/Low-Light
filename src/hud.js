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
    this.tag = document.getElementById('guardTag');
    this.tagIcon = this.tag.querySelector('.icon');
    this.tagBar = this.tag.querySelector('.bar');
    this.tagFill = this.tag.querySelector('.bar .fill');
    this.overlay = document.getElementById('overlay');
    this.overlayH1 = this.overlay.querySelector('h1');
    this.overlayMsg = this.overlay.querySelector('.msg');
    this.overlaySmall = this.overlay.querySelector('.small');
  }

  update({ light = 0, stance = '', prompt = '', guard = null, noise = 0, nv = false, held = '' } = {}) {
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
    this._guard(guard);
  }

  _guard(guard) {
    const tag = this.tag;
    if (!guard || !guard.pos || guard.hidden) { tag.style.display = 'none'; return; }
    _v.copy(guard.pos).project(this.camera);
    if (_v.z > 1 || _v.x < -1 || _v.x > 1 || _v.y < -1 || _v.y > 1) { tag.style.display = 'none'; return; }
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    tag.style.display = 'block';
    tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;

    const s = guard.suspicion || 0;
    const icon = guard.icon || '';
    if (this.tagIcon.textContent !== icon) this.tagIcon.textContent = icon;
    this.tagIcon.style.color = icon === '!' ? '#e8412f' : '#f0d040';
    if (Number.isFinite(guard.grip)) {
      // grip mode: bar always shown, width = grip, red (about to break free) -> pale blue-white (plenty of time)
      const gr = Math.max(0, Math.min(1, guard.grip));
      tag.classList.add('grip');
      this.tagBar.style.visibility = 'visible';
      this.tagFill.style.width = (gr * 100).toFixed(1) + '%';
      const r = Math.round(232 + (220 - 232) * gr);
      const g = Math.round(65 + (235 - 65) * gr);
      const b = Math.round(47 + (255 - 47) * gr);
      this.tagFill.style.background = `rgb(${r},${g},${b})`;
    } else if (s < 0.5) {
      tag.classList.remove('grip');
      this.tagBar.style.visibility = 'hidden';
    } else {
      tag.classList.remove('grip');
      this.tagBar.style.visibility = 'visible';
      const t = Math.max(0, Math.min(1, s / 100));
      this.tagFill.style.width = (t * 100).toFixed(1) + '%';
      this.tagFill.style.background = `rgb(${Math.round(240 - 10 * t)},${Math.round(208 - 150 * t)},${Math.round(64 - 20 * t)})`;
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
