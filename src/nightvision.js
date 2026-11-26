import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D tScene;
uniform float uTime;
uniform vec2 uRes;
uniform float uGain;
uniform float uWhite;
uniform float uLift;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float lumAt(vec2 uv) {
  vec3 c = texture2D(tScene, uv).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  // slight softness: small cross blur
  vec2 px = 1.0 / uRes;
  float lum = lumAt(vUv) * 0.4
    + (lumAt(vUv + vec2(px.x, 0.0)) + lumAt(vUv - vec2(px.x, 0.0))
     + lumAt(vUv + vec2(0.0, px.y)) + lumAt(vUv - vec2(0.0, px.y))) * 0.15;

  // Log amplification: dark rooms render at ~0.001 luminance and lit areas at ~0.25, a 200x gap.
  // A log curve lifts the dark a lot while lit areas just bloom to white, keeping detail in both.
  float v = log(1.0 + uGain * lum) / log(1.0 + uGain * uWhite);
  v = pow(clamp(v, 0.0, 1.0), uLift);

  // film grain (animated)
  float n = hash(vec3(gl_FragCoord.xy, floor(uTime * 30.0))) - 0.5;
  v += n * 0.16 * (0.4 + 0.6 * (1.0 - v));

  // scanlines
  v *= 0.93 + 0.07 * sin(gl_FragCoord.y * 3.14159);

  // vignette (circular-ish)
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float d = length(q);
  v *= 1.0 - smoothstep(0.35, 0.85, d);

  v = max(v, 0.0);
  vec3 col = vec3(0.35, 1.0, 0.4) * v;
  // bright areas push toward pale green-white
  col += vec3(0.25, 0.1, 0.25) * smoothstep(0.7, 1.0, v);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class NightVision {
  constructor(renderer) {
    this.renderer = renderer;
    this._enabled = false;
    this._time = 0;
    this._size = new THREE.Vector2(1, 1);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uGain: { value: 10000.0 }, // amplification strength
        uWhite: { value: 0.25 },   // scene luminance that maps to full white
        uLift: { value: 0.85 },     // <1 brightens mid and dark tones
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const s = renderer.getSize(new THREE.Vector2());
    this.setSize(s.x || 1, s.y || 1);
  }

  get enabled() { return this._enabled; }
  set enabled(b) { this._enabled = !!b; }
  toggle() { this._enabled = !this._enabled; return this._enabled; }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    const pw = Math.max(1, Math.floor(w * pr)), ph = Math.max(1, Math.floor(h * pr));
    this.target.setSize(pw, ph);
    this.material.uniforms.uRes.value.set(pw, ph);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer;
    if (!this._enabled) { r.render(scene, camera); return; }
    this._time += dt;
    this.material.uniforms.uTime.value = this._time;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
