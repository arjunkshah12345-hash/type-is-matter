import * as THREE from 'three';
/**
 * Procedural studio for reflections: large cool softbox upper-left, warm fill right (~½ key),
 * narrow rim strip behind/above, dark flags, warm-grey walls and an ivory floor. Prefiltered with PMREM.
 */
export function buildStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 24, 40), new THREE.MeshBasicMaterial({ color: 0x8d8a84, side: THREE.BackSide }));
  room.position.y = 6; s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xd8d4cb }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -5.9; s.add(floor);
  const panel = (w: number, h: number, color: number, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); return m;
  };
  // key: large rectangular softbox, upper-left front, cool white → long reflections
  panel(9, 14, 0xf2f6ff, 7.0, [-11, 8, 10]);
  // fill: large soft warm light on the right, about half of key
  panel(10, 10, 0xffe6cc, 3.4, [14, 2, 6]);
  // rim: narrow strip behind and above
  panel(22, 1.0, 0xffffff, 9.0, [0, 11, -12]);
  // a second slim overhead strip gives the bevels a clean top line
  panel(1.2, 16, 0xffffff, 4.0, [3, 12, 4]);
  // front reflector behind the camera: a tall graded scrim the flat faces see (bright top → deep bottom)
  {
    const g = new THREE.PlaneGeometry(26, 14, 1, 24);
    const pos = g.getAttribute('position'); const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + 7) / 14; // 0 bottom → 1 top
      const h = Math.min(1, Math.max(0, (t - 0.335) / 0.05)); const st = h * h * (3 - 2 * h);
      const v = (0.02 + 0.16 * t) * (1 - st) + st * (0.95 - 0.5 * (t - 0.38)) + 1.5 * Math.exp(-Math.pow((t - 0.56) / 0.025, 2));
      col.push(v * 0.98, v * 0.98, v);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.position.set(0, 0.5, 16); m.lookAt(0, 0.5, 0); s.add(m);
  }
  // dark flags (negative fill) to carve shape into the chrome
  panel(3.5, 16, 0x0d0d0c, 1, [-7.5, 0, 14]);
  panel(3, 14, 0x101010, 1, [9, -1, 12]);
  panel(5, 14, 0x0f0f0e, 1, [-15, 0, -4]);
  panel(30, 3, 0x121211, 1, [0, -6.5, 8]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.012, 0.1, 100);
  pmrem.dispose();
  s.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

/** Subtle grain texture for the paper-like cyclorama and the metal micro-imperfections. */
export function noiseTexture(size = 256, lo = 0.9, hi = 1.0, seed = 7): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let x = seed;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  // value noise: a few octaves of smoothed random for organic, non-repeating micro variation
  const base = new Float32Array(size * size);
  for (let i = 0; i < base.length; i++) base[i] = rnd();
  const blur = (src: Float32Array, r: number) => {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
      let acc = 0, n = 0;
      for (let k = -r; k <= r; k++) { acc += src[y * size + ((xx + k + size) % size)]; n++; }
      dst[y * size + xx] = acc / n;
    }
    const d2 = new Float32Array(src.length);
    for (let y = 0; y < size; y++) for (let xx = 0; xx < size; xx++) {
      let acc = 0, n = 0;
      for (let k = -r; k <= r; k++) { acc += dst[((y + k + size) % size) * size + xx]; n++; }
      d2[y * size + xx] = acc / n;
    }
    return d2;
  };
  const b1 = blur(base, 6), b2 = blur(base, 2);
  for (let i = 0; i < size * size; i++) {
    const v = 0.45 * (b1[i] - 0.5) * 6 + 0.35 * (b2[i] - 0.5) * 3 + 0.2 * (base[i] - 0.5);
    const t = Math.min(1, Math.max(0, 0.5 + v));
    const c = Math.round((lo + (hi - lo) * t) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = c; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

/** Curved photography cyclorama (floor sweeping up into the back wall), flat ivory with very subtle tonal variation. */
export class Cyclorama {
  readonly group = new THREE.Group();
  private mesh?: THREE.Mesh;
  private shadow?: THREE.Mesh;
  private grain = noiseTexture(256, 0.965, 1.0, 11);
  private mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, map: this.grain, toneMapped: false });
  readonly shadowMat = new THREE.ShadowMaterial({ color: 0x3a3226, opacity: 0.1 });
  build(floorY: number, width: number, height: number) {
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.shadow) { this.group.remove(this.shadow); this.shadow.geometry.dispose(); }
    const zFront = 30, zCurve = -4, R = 4, segX = 2, segs: [number, number][] = [];
    // profile in (z, y)
    segs.push([zFront, floorY]); segs.push([zCurve, floorY]);
    for (let i = 1; i <= 16; i++) { const a = (i / 16) * Math.PI / 2; segs.push([zCurve - Math.sin(a) * R, floorY + (1 - Math.cos(a)) * R]); }
    segs.push([zCurve - R, floorY + height + 40]);
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const base = new THREE.Color('#E9E6DF');
    const W = width * 2 + 20;
    segs.forEach(([z, y], i) => {
      for (let j = 0; j <= segX; j++) {
        const x = -W / 2 + (j / segX) * W;
        pos.push(x, y, z);
        // very subtle tonal variation: slightly deeper in the sweep, lighter toward the top
        const t = (y - floorY) / (height + 8);
        let k = 1.0 - 0.018 * Math.exp(-Math.pow((y - floorY - R * 0.4) / (R * 0.6), 2)) + 0.012 * Math.min(1, Math.max(0, t)) - 0.01 * Math.abs(j / segX - 0.5);
        if (i === 0) k -= 0.012;
        const c = base.clone().multiplyScalar(k);
        col.push(c.r, c.g, c.b);
        uv.push(x * 0.12, (y + z) * 0.12);
      }
    });
    for (let i = 0; i < segs.length - 1; i++) for (let j = 0; j < segX; j++) {
      const a = i * (segX + 1) + j, b = a + 1, c = a + segX + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = -1;
    this.group.add(this.mesh);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(W, 34), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.set(0, floorY + 0.002, 13);
    this.shadow.receiveShadow = true;
    this.group.add(this.shadow);
  }
}
