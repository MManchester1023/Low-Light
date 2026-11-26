// Keyboard + mouse input.
// Clicking starts play. Pointer lock is requested but not required: some browsers and embedded
// panes refuse it, so without a lock you look around by dragging the mouse (or with the arrow keys).

const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
  'KeyC', 'KeyE', 'KeyG', 'KeyR', 'KeyV', 'KeyP', 'KeyN', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this._down = new Set();
    this._pressed = new Set();
    this._dx = 0;
    this._dy = 0;
    this._locked = false;
    this._active = false;
    this._dragging = false;
    this.onActiveChange = null; // (active: boolean) => void

    window.addEventListener('keydown', (e) => {
      if (this._active && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (this._active && (e.code === 'Escape' || e.code === 'KeyP')) { this._setActive(false); return; }
      this._down.add(e.code);
      this._pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this._active && GAME_KEYS.has(e.code)) e.preventDefault();
      this._down.delete(e.code);
    });
    window.addEventListener('blur', () => { this._down.clear(); this._pressed.clear(); this._dragging = false; });

    const start = () => {
      this._setActive(true);
      if (document.pointerLockElement === canvas) return;
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (_) { /* lock refused: drag-to-look still works */ }
    };
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.addEventListener('click', start);
    canvas.addEventListener('click', () => { if (!this._active) start(); });

    document.addEventListener('pointerlockchange', () => {
      const was = this._locked;
      this._locked = document.pointerLockElement === canvas;
      // Losing a lock we had (the browser's Esc) pauses the game.
      if (was && !this._locked) this._setActive(false);
    });

    canvas.addEventListener('mousedown', () => { if (this._active) this._dragging = true; });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this._active || !(this._locked || this._dragging)) return;
      this._dx += e.movementX;
      this._dy += e.movementY;
    });
  }

  _setActive(on) {
    if (this._active === on) return;
    this._active = on;
    this._dragging = false;
    if (!on) {
      this._down.clear();
      this._dx = 0;
      this._dy = 0;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    if (this.onActiveChange) this.onActiveChange(on);
  }

  down(code) { return this._down.has(code); }
  pressed(code) { return this._pressed.has(code); }
  get mouseDX() { return this._dx; }
  get mouseDY() { return this._dy; }
  get locked() { return this._locked; }
  /** True while the game is being played (clicked in, not paused). */
  get active() { return this._active; }
  endFrame() { this._pressed.clear(); this._dx = 0; this._dy = 0; }
}

export class NullInput {
  down() { return false; }
  pressed() { return false; }
  get mouseDX() { return 0; }
  get mouseDY() { return 0; }
  get locked() { return false; }
  get active() { return false; }
  endFrame() {}
}
