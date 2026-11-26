const GAME_KEYS = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight',
  'KeyC', 'KeyE', 'KeyR', 'KeyV', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this._down = new Set();
    this._pressed = new Set();
    this._dx = 0;
    this._dy = 0;
    this._locked = false;

    window.addEventListener('keydown', (e) => {
      if (this._locked && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this._down.add(e.code);
      this._pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (this._locked && GAME_KEYS.has(e.code)) e.preventDefault();
      this._down.delete(e.code);
    });
    window.addEventListener('blur', () => { this._down.clear(); this._pressed.clear(); });

    const lock = () => {
      if (document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (_) { /* ignore */ }
      }
    };
    canvas.addEventListener('click', lock);
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.addEventListener('click', lock);

    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === canvas;
      if (!this._locked) { this._down.clear(); this._dx = 0; this._dy = 0; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._locked) return;
      this._dx += e.movementX;
      this._dy += e.movementY;
    });
  }

  down(code) { return this._down.has(code); }
  pressed(code) { return this._pressed.has(code); }
  get mouseDX() { return this._dx; }
  get mouseDY() { return this._dy; }
  get locked() { return this._locked; }
  endFrame() { this._pressed.clear(); this._dx = 0; this._dy = 0; }
}

export class NullInput {
  down() { return false; }
  pressed() { return false; }
  get mouseDX() { return 0; }
  get mouseDY() { return 0; }
  get locked() { return false; }
  endFrame() {}
}
