import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Hud {
  constructor(camera) {
    this.camera = camera;
    this.meterFill = document.querySelector('#meter .fill');
    this.stanceEl = document.querySelector('#meter .stance');
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

  update({ light = 0, stance = '', prompt = '', guard = null } = {}) {
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
    if (!guard || !guard.pos) { tag.style.display = 'none'; return; }
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
    if (s < 0.5) {
      this.tagBar.style.visibility = 'hidden';
    } else {
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
