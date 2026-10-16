import * as THREE from 'three';
/**
 * Secondary elastic deformation (visual only; colliders stay rigid). Not FEM.
 * Four modal oscillators, each amp = A·exp(-d·t)·sin(f·t + φ), evaluated on the CPU (4 floats per letter)
 * and applied in the vertex shader to the immutable base vertices, so nothing accumulates.
 *  A: height-varying shear   B: compression + lateral expansion   C: bend about vertical centreline   D: torsion
 */
export const MAX_DEFORM = 0.025; // fraction of glyph height
const FREQ = [2 * Math.PI * 7.5, 2 * Math.PI * 11.0, 2 * Math.PI * 9.0, 2 * Math.PI * 5.5];
const DAMP = [7.0, 10.0, 8.0, 6.0];

export class ElasticState {
  readonly uniform = { value: new THREE.Vector4() };
  readonly size = { value: new THREE.Vector3(0.5, 0.5, 0.15) };
  private A = new Float32Array(4);
  private t0 = new Float32Array(4);
  private phi = new Float32Array(4);
  /** impulse: normalised strength (0..1+), dir: rough mode weighting from impact direction */
  excite(now: number, strength: number, wx: number, wy: number, seed: number) {
    const s = Math.min(1, strength);
    if (s < 0.02) return;
    const w = [Math.abs(wx) * 0.8 + 0.2, Math.abs(wy) * 0.9 + 0.1, 0.55, 0.45];
    for (let m = 0; m < 4; m++) {
      const cur = this.envelope(m, now);
      const a = MAX_DEFORM * s * w[m];
      if (a > cur) { this.A[m] = Math.min(MAX_DEFORM, a); this.t0[m] = now; this.phi[m] = ((seed * (m + 3) * 0.6180339) % 1) * 0.6; }
    }
  }
  private envelope(m: number, now: number) { return this.A[m] * Math.exp(-DAMP[m] * (now - this.t0[m])); }
  update(now: number) {
    const u = this.uniform.value;
    let total = 0;
    const v = [0, 0, 0, 0];
    for (let m = 0; m < 4; m++) {
      const t = now - this.t0[m];
      v[m] = this.A[m] === 0 ? 0 : this.A[m] * Math.exp(-DAMP[m] * t) * Math.sin(FREQ[m] * t + this.phi[m]);
      if (t > 1.5) this.A[m] = 0;
      total += Math.abs(v[m]);
    }
    const k = total > MAX_DEFORM ? MAX_DEFORM / total : 1; // combined clamp ≤ 2.5% of height
    u.set(v[0] * k, v[1] * k, v[2] * k, v[3] * k);
  }
  energy() { return Math.abs(this.uniform.value.x) + Math.abs(this.uniform.value.y) + Math.abs(this.uniform.value.z) + Math.abs(this.uniform.value.w); }
}

export function applyElastic(material: THREE.Material, state: ElasticState) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uElastic = state.uniform;
    shader.uniforms.uHalf = state.size;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uElastic;\nuniform vec3 uHalf;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 p = transformed;
        float H = uHalf.y * 2.0;
        float yn = p.y / uHalf.y;
        float xn = p.x / uHalf.x;
        p.x += uElastic.x * yn * 0.5 * H;                       // A shear varying with height
        p.y -= uElastic.y * p.y * 2.0;                          // B compression
        p.xz += uElastic.y * p.xz;                              //   lateral expansion
        p.z += uElastic.z * (xn * xn - 0.33) * H;               // C bend around vertical centreline
        float a = uElastic.w * yn * 2.0;                        // D torsional wobble
        float ca = cos(a), sa = sin(a);
        p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
        transformed = p;
      }`);
  };
  material.customProgramCacheKey = () => 'elastic-v1';
}
