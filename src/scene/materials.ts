import * as THREE from 'three';
import { noiseTexture } from './environment';
const micro = noiseTexture(256, 0.84, 1.0, 3);
micro.repeat.set(0.9, 0.9);
/** Polished, slightly imperfect chrome. roughness ≈ 0.13 ± 0.025 per object. */
export function chromeMaterial(rand: () => number): THREE.MeshPhysicalMaterial {
  const r = 0.13 + (rand() * 2 - 1) * 0.025;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.93, 0.925, 0.91),
    metalness: 1.0,
    roughness: r / 0.92, // roughnessMap averages ≈ 0.92 → effective mean = r
    roughnessMap: micro,
    bumpMap: micro,
    bumpScale: 0.05,
    envMapIntensity: 1.0,
    specularIntensity: 1,
  });
}
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
