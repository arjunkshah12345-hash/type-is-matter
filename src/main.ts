import * as THREE from 'three';
import { loadFont } from './typography/font';
import { GlyphLibrary } from './typography/glyphGeometry';
import { computeLayout, LINES, type Layout } from './typography/layout';
import { applyElastic } from './typography/deformation';
import { StudioCamera } from './scene/camera';
import { buildStudioEnvironment, Cyclorama } from './scene/environment';
import { StudioLights } from './scene/lighting';
import { chromeMaterial, makeRng } from './scene/materials';
import { initPhysics, PhysicsWorld, STEP, MAX_FRAME } from './physics/world';
import { RigidGlyph, GAINS } from './physics/rigidGlyph';
import { MagneticField, shockwave } from './physics/magneticField';
import { CollisionEvents } from './physics/collisionEvents';
import { PointerInput } from './interaction/pointer';
import { StateMachine } from './interaction/stateMachine';
import { HandTracker } from './interaction/gestures';
import { MetalSynth } from './audio/synthesizer';
import { Recorder, MAX_SECONDS, pickFormat } from './export/recording';
import { download, drawPosterFrame } from './export/image';
import { Controls } from './ui/controls';

const params = new URLSearchParams(location.search);
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason)));

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
function showFallback() { document.getElementById('fallback')!.hidden = false; document.getElementById('ui')!.style.display = 'none'; (window as any).__TIM = { ready: true, fallback: true }; }

async function main() {
  if (!webglAvailable() || params.get('nowebgl') === '1') return showFallback();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('reduced') === '1';
  const lockHigh = params.get('q') === 'high';
  const seed = Number(params.get('seed') ?? 1001);
  const rand = makeRng(seed);

  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch { return showFallback(); }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0xe9e6df, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  await initPhysics();
  const [font] = await Promise.all([loadFont(), document.fonts.load("12px 'Plex Mono'").catch(() => null)]);

  const scene = new THREE.Scene();
  scene.environment = buildStudioEnvironment(renderer);
  const cyc = new Cyclorama(); scene.add(cyc.group);
  const lights = new StudioLights(); scene.add(lights.group);
  const cam = new StudioCamera();

  const lib = new GlyphLibrary(font);
  const layout: Layout = computeLayout(lib, LINES);
  const pw = new PhysicsWorld();
  const letters: RigidGlyph[] = [];
  const meshes: THREE.Mesh[] = [];
  layout.slots.forEach((s, i) => {
    const g = lib.get(s.char);
    const L = new RigidGlyph(pw, g, i, s.x, s.y, s.z);
    const mat = chromeMaterial(rand);
    L.roughness = mat.roughness;
    applyElastic(mat, L.elastic);
    const mesh = new THREE.Mesh(g.geometry, mat);
    mesh.castShadow = true; mesh.userData.index = i;
    L.mesh = mesh; scene.add(mesh); meshes.push(mesh); letters.push(L);
  });
  const events = new CollisionEvents(); events.register(letters);
  const field = new MagneticField();
  const sm = new StateMachine();
  const synth = new MetalSynth();
  const hand = new HandTracker();
  const recorder = new Recorder();
  let simTime = 0;

  // ---------- sizing ----------
  let cssW = 1, cssH = 1, quality = 0, dprBase = 1;
  const SHADOW = [2048, 1024, 0, 0, 0], DPRS = [1, 1, 1, 0.75, 0.55];
  function applyQuality() {
    const sz = SHADOW[quality];
    renderer.shadowMap.enabled = sz > 0;
    lights.shadowLight.castShadow = sz > 0;
    if (sz > 0 && lights.shadowLight.shadow.mapSize.x !== sz) {
      lights.shadowLight.shadow.mapSize.set(sz, sz);
      lights.shadowLight.shadow.map?.dispose(); (lights.shadowLight.shadow as any).map = null;
    }
    cyc.shadowMat.visible = sz > 0;
    renderer.setPixelRatio(dprBase * DPRS[quality]);
    renderer.setSize(cssW, cssH, false);
  }
  function resize() {
    cssW = Math.max(1, window.innerWidth); cssH = Math.max(1, window.innerHeight);
    dprBase = Math.min(2, window.devicePixelRatio || 1);
    cam.frame(layout.width, layout.height, cssW / cssH);
    const vh = cam.viewH, halfW = (vh * cam.aspect) / 2;
    const floorY = -layout.height / 2 - Math.min(0.14 * vh, 1.5);
    pw.setBounds(floorY, Math.max(halfW - 0.3, layout.width / 2 + 0.3), vh / 2 - 0.25);
    cyc.build(floorY, halfW * 2, vh);
    lights.fitShadow(halfW, floorY);
    applyQuality();
    cam.resetParallax();
  }
  resize();
  window.addEventListener('resize', resize);
  const upp = () => cam.unitsPerPx(cssH);

  // ---------- intro placement (letters are invisible until they arrive; initial placement, not a teleport) ----------
  const lastIdx = letters.length - 1;
  const lineTimes = [[0.45, 1.10], [0.95, 1.55], [1.35, 2.0]];
  const SETTLE = 0.42;
  letters.forEach((L) => {
    const s = layout.slots[L.index];
    if (reduced || params.get('intro') === '0') { L.setMode('hold', 0); return; }
    const n = LINES[s.line].length, [t0, t1] = lineTimes[s.line];
    L.arriveAt = t0 + (n > 1 ? (s.index / (n - 1)) : 0) * (t1 - t0 - SETTLE);
    const px = 40 + rand() * 80; // 40–120px from final position
    const dy = px * upp() * (L.index === lastIdx ? 1.25 : 1), dz = 0.5 + rand() * 1.6; // from slightly different depths
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.18, (rand() - 0.5) * 0.22, (rand() - 0.5) * 0.12));
    L.body.setTranslation({ x: L.rest.x, y: L.rest.y + dy, z: L.rest.z + dz }, false);
    L.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
    if (L.index === lastIdx) L.body.setLinvel({ x: 0, y: -2.2, z: -1.0 }, false);
    L.sync(); L.pushPrev();
    L.mode = 'pending'; L.body.setGravityScale(0, false);
    L.mesh.visible = false;
  });
  if (reduced || params.get('intro') === '0') { sm.phase = 'rest'; document.getElementById('caption')!.classList.add('on'); }
  let lastLanded = false, captionShown = sm.phase === 'rest';
  scene.environmentRotation.set(0, reduced ? 0 : -0.55, 0);
  renderer.compile(scene, cam.camera);

  // ---------- interactions ----------
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const ndcToPlane = (x: number, y: number, z: number, out: THREE.Vector3) => {
    ray.setFromCamera(tmpV2.set(x, y, 0) as unknown as THREE.Vector2, cam.camera);
    plane.constant = -z;
    return ray.ray.intersectPlane(plane, out) ?? out.set(0, 0, z);
  };
  let drag: { i: number; local: THREE.Vector3; z: number; target: THREE.Vector3 } | null = null;
  let hoverNdc: [number, number] | null = null;
  const pointerWorld = new THREE.Vector3();

  function impactAt(x: number, y: number, pt?: THREE.Vector3) {
    const c = pt ? pt.clone() : ndcToPlane(x, y, 0, new THREE.Vector3());
    c.z = Math.max(c.z, 0) + 0.45;
    sm.interact(simTime); sm.phase = 'collapse';
    letters.forEach((L) => { if (L.mode !== 'drag') L.setMode('free', simTime); L.body.wakeUp(); });
    const R = 340 * Math.max(1, Math.max(cssW / 1440, cssH / 900)) * upp(); // ~340px at the 1440×900 reference
    const sep = shockwave(letters, c, R, rand, cssW < 700 ? 0.75 : 1);
    letters.forEach((L) => { const d = L.currP.distanceTo(c) / R; if (d < 1) L.elastic.excite(simTime, (1 - d) * (1 - d) * 1.2, rand(), rand(), L.index + simTime); });
    lastImpact = { sep, t: simTime };
  }
  let lastImpact = { sep: 0, t: -1 };
  new PointerInput(canvas, {
    hover(x, y) { hoverNdc = [x, y]; cam.setParallaxTarget(x, y); sm.lastActivity = simTime; },
    leave() { hoverNdc = null; field.active = false; cam.setParallaxTarget(0, 0); canvas.classList.remove('grab'); },
    pick(x, y) {
      ray.setFromCamera(tmpV2.set(x, y, 0) as unknown as THREE.Vector2, cam.camera);
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit ? { index: hit.object.userData.index as number, point: hit.point.clone() } : null;
    },
    impact: impactAt,
    dragStart(i, p) {
      const L = letters[i];
      const local = p.clone().sub(L.currP).applyQuaternion(tmpQ.copy(L.currQ).invert());
      drag = { i, local, z: p.z, target: p.clone() };
      L.setMode('drag', simTime); sm.dragging = true; sm.interact(simTime);
      canvas.classList.add('grabbing');
    },
    dragMove(x, y) { if (drag) { ndcToPlane(x, y, drag.z, drag.target); sm.interact(simTime); } },
    dragEnd() {
      if (!drag) return;
      const L = letters[drag.i];
      L.clearForces(); L.setMode('free', simTime); // keeps its simulated velocity
      drag = null; sm.dragging = false; sm.interact(simTime); sm.phase = 'collapse';
      canvas.classList.remove('grabbing');
    },
    hoverLetter(h) { canvas.classList.toggle('grab', h); },
  });

  function reassembleNow() {
    if (drag) return;
    sm.lastInteraction = -1e9;
    if (sm.phase === 'intro') return;
    if (letters.some((L) => L.mode === 'free')) sm.phase = 'collapse';
  }

  // ---------- controls ----------
  const controls = new Controls({
    async sound() { if (synth.enabled) { await synth.disable(); return false; } await synth.enable(); return true; },
    async hand() {
      if (hand.running) { hand.stop(); controls.setHand(false); field.handStrength = 0; return false; }
      try { controls.note('STARTING CAMERA — PROCESSED LOCALLY, NOTHING IS UPLOADED', 3500); await hand.start(); controls.setHand(true); return true; }
      catch (e) { hand.stop(); controls.setHand(false); controls.note('HAND MODE UNAVAILABLE: ' + String((e as Error).message || e).toUpperCase().slice(0, 60)); return false; }
    },
    reset() { reassembleNow(); controls.note('RESTORING COMPOSITION'); },
    png() { exportPNG(true); },
    poster() { exportPoster(true); },
    record() {
      if (recorder.active) { recorder.stop(); return; }
      try {
        const fmt = pickFormat();
        if (!fmt) throw new Error('unsupported');
        startRecordingSize();
        recorder.start(canvas, (url, ext) => { controls.setRec(null); controls.setRecLabel('RECORD 15S'); controls.setDownload(url, ext); endRecordingSize(); if (ext !== 'mp4') controls.note('MP4 NOT SUPPORTED HERE — SAVED AS WEBM', 4000); });
        controls.setRecLabel('STOP RECORDING'); controls.setDownload(null);
      } catch { controls.note('RECORDING NOT SUPPORTED IN THIS BROWSER'); }
    },
  });
  let recSaved: { w: number; h: number } | null = null;
  function startRecordingSize() { recSaved = { w: cssW, h: cssH }; canvas.classList.add('recording'); renderer.setPixelRatio(1); renderer.setSize(1920, 1080, false); cam.frame(layout.width, layout.height, 16 / 9); }
  function endRecordingSize() { canvas.classList.remove('recording'); recSaved = null; resize(); }

  // ---------- export ----------
  function renderOffscreen(w: number, h: number, setup: () => void, teardown: () => void): HTMLCanvasElement {
    const prevPR = renderer.getPixelRatio();
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    const prevQ = quality; if (quality > 0) { quality = 0; renderer.shadowMap.enabled = true; lights.shadowLight.castShadow = true; cyc.shadowMat.visible = true; }
    setup();
    renderer.render(scene, cam.camera);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    teardown();
    quality = prevQ; renderer.setPixelRatio(prevPR); resize();
    return out;
  }
  function exportPNG(save: boolean) {
    const c = renderOffscreen(2400, 1500, () => { cam.frame(layout.width, layout.height, 2400 / 1500); cam.place(0, 0); }, () => {});
    const url = c.toDataURL('image/png');
    if (save) download(url, 'type-is-matter-2400x1500.png');
    return url;
  }
  let posterGroup: THREE.Group | null = null;
  function exportPoster(save: boolean) {
    const W = 2400, H = 3000;
    if (!posterGroup) {
      posterGroup = new THREE.Group();
      const pl = computeLayout(lib, LINES, 1.24, 'left', 0.05); // reflowed: flush-left stack, tighter leading
      pl.slots.forEach((s, i) => { const m = new THREE.Mesh(lib.get(s.char).geometry, letters[i].mesh.material); m.position.set(s.x, s.y, 0); m.castShadow = true; posterGroup!.add(m); });
      posterGroup.userData.w = pl.width; posterGroup.userData.h = pl.height;
    }
    const pg = posterGroup;
    const c = renderOffscreen(W, H, () => {
      meshes.forEach((m) => (m.visible = false));
      scene.add(pg);
      const vh = Math.max(pg.userData.w / (0.82 * (W / H)), pg.userData.h / 0.5);
      cam.viewH = vh; cam.aspect = W / H; cam.applyFrustum();
      pg.position.set(0, pw.bounds.floorY + 0.95 + pg.userData.h / 2, 0);
      cam.target.set(0, pg.position.y - vh * 0.08, 0); cam.place(0, 0);
      cyc.build(pw.bounds.floorY, vh, vh * 1.5); lights.fitShadow(vh / 2, pw.bounds.floorY);
    }, () => { scene.remove(pg); meshes.forEach((m) => (m.visible = true)); cam.target.set(0, 0, 0); });
    drawPosterFrame(c.getContext('2d')!, W, H);
    const url = c.toDataURL('image/png');
    if (save) download(url, 'type-is-matter-poster-2400x3000.png');
    return url;
  }

  // ---------- simulation step ----------
  const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const handWorld = new THREE.Vector3();
  let reassemblyProgress = 0;
  function step(dt: number) {
    simTime += dt;
    // intro choreography
    if (sm.phase === 'intro') {
      for (const L of letters) if (L.mode === 'pending' && simTime >= L.arriveAt) { L.setMode('arrive', simTime); L.mesh.visible = true; L.visibleAt = simTime; }
      if (!lastLanded) {
        const L = letters[lastIdx];
        if (L.mode === 'arrive' && L.currP.y <= L.rest.y) { lastLanded = true; L.elastic.excite(simTime, 0.55, 0, 1, 7); synth.hit(0.9, 1); }
      }
      if (letters.every((L) => L.mode === 'hold')) { sm.phase = 'rest'; sm.lastActivity = simTime; }
    }
    if (sm.shouldReassemble(simTime)) {
      sm.phase = 'reassemble'; sm.reassembleStart = simTime;
      for (const L of letters) if (L.mode === 'free') { L.setMode('return', simTime); }
    }
    if (sm.phase === 'reassemble') {
      if (letters.every((L) => L.mode === 'hold')) { sm.phase = 'rest'; sm.lastActivity = simTime; }
    }
    // idle ripple (once, after 8s without interaction)
    if (sm.phase === 'rest' && !reduced && !sm.rippleDone && simTime - Math.max(sm.lastActivity, 2.6) > 8) { field.rippleStart = simTime; sm.rippleDone = true; }

    const gRamp = 1 - smooth((simTime - sm.reassembleStart) / 0.7); // gravity → 0 smoothly during reassembly
    let errSum = 0;
    for (const L of letters) {
      switch (L.mode) {
        case 'pending': L.clearForces(); break;
        case 'arrive': {
          const t = simTime - L.modeTime;
          L.applyMagnet(L.index === lastIdx ? { w: 11, z: 0.34, wr: 10, zr: 0.4 } : GAINS.arrive, 1, false);
          if (t > 0.6 && L.posError() < 0.004 && L.angError() < 0.01) L.setMode('hold', simTime);
          break;
        }
        case 'hold': L.applyMagnet(GAINS.hold, 1, true); break;
        case 'free': L.clearForces(); break;
        case 'return': {
          const t = simTime - L.modeTime;
          L.gain = smooth(t / 0.35);
          L.body.setGravityScale(gRamp, false);
          L.applyMagnet(reduced ? GAINS.returnReduced : GAINS.return, Math.max(0.02, L.gain), false);
          const e = L.restError();
          if (t > 2.6 && e > 0.01) L.setGhost(true);
          errSum += Math.min(1, e);
          if (t > 0.5 && e < 0.002 && L.linv.length() < 0.02 && L.angError() < 0.003 && L.angv.length() < 0.03) L.setMode('hold', simTime);
          break;
        }
        case 'drag': {
          if (!drag) break;
          const anchor = tmpV.copy(drag.local).applyQuaternion(L.currQ).add(L.currP);
          // velocity of the grab point: v + ω × r
          const rx = anchor.x - L.currP.x, ry = anchor.y - L.currP.y, rz = anchor.z - L.currP.z;
          const vx = L.linv.x + L.angv.y * rz - L.angv.z * ry, vy = L.linv.y + L.angv.z * rx - L.angv.x * rz, vz = L.linv.z + L.angv.x * ry - L.angv.y * rx;
          const w = 22, z = 0.8;
          let ax = w * w * (drag.target.x - anchor.x) - 2 * z * w * vx, ay = w * w * (drag.target.y - anchor.y) - 2 * z * w * vy, az = w * w * (drag.target.z - anchor.z) - 2 * z * w * vz;
          const am = Math.hypot(ax, ay, az), MAX = 140;
          if (am > MAX) { ax *= MAX / am; ay *= MAX / am; az *= MAX / am; }
          L.body.resetForces(false); L.body.resetTorques(false);
          L.body.addForceAtPoint({ x: ax * L.mass, y: ay * L.mass, z: az * L.mass }, { x: anchor.x, y: anchor.y, z: anchor.z }, true);
          break;
        }
      }
    }
    reassemblyProgress = sm.phase === 'reassemble' ? 1 - errSum / Math.max(1, letters.filter((L) => L.mode === 'return').length || 1) : 1;
    for (const L of letters) L.pushPrev();
    pw.world.step(pw.events);
    events.drain(pw, letters, dt);
    for (const L of letters) L.sync();
  }

  // ---------- frame loop ----------
  const ft = new Float32Array(4096); let ftN = 0, ftHead = 0;
  let last = -1, slowT = 0, fastT = 0, running = true, emaFt = 16;
  const caption = document.getElementById('caption')!;
  function frame(nowMs: number) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (last < 0) last = nowMs;
    const rdt = (nowMs - last) / 1000; last = nowMs;
    if (ftN || rdt > 0) { ft[ftHead] = rdt * 1000; ftHead = (ftHead + 1) & 4095; ftN = Math.min(4096, ftN + 1); }
    accumulate(rdt);
    // hand mode
    if (hand.running) {
      const hs = hand.update(nowMs, rdt);
      if (hs.tracking || hs.strength > 0.01) {
        ndcToPlane(hs.x * 2 - 1, -(hs.y * 2 - 1), 0, handWorld);
        field.hand.copy(handWorld);
        if (hs.gesture === 'open') { field.handSign = 1; field.handStrength = hs.strength; }
        else if (hs.gesture === 'pinch') { field.handSign = -1; field.handStrength = hs.strength; }
        else field.handStrength *= 0.9;
        if (hs.gesture === 'gust' && hs.strength > 0.6 && simTime - lastImpact.t > 0.8) impactAt(hs.x * 2 - 1, -(hs.y * 2 - 1));
        if (hs.gesture === 'fist' && hs.strength > 0.6) reassembleNow();
        if (hs.strength > 0.3) sm.lastActivity = simTime;
      } else field.handStrength *= 0.9;
    }
    // hover field
    if (hoverNdc && !drag) { ndcToPlane(hoverNdc[0], hoverNdc[1], 0, pointerWorld); field.pointer.copy(pointerWorld); field.active = true; } else if (!hoverNdc) field.active = false;
    field.update(letters, upp(), simTime, Math.min(rdt, 0.05), reduced);
    // interpolate render transforms
    const alpha = acc / STEP;
    for (const L of letters) {
      L.mesh.position.lerpVectors(L.prevP, L.currP, alpha);
      L.mesh.quaternion.slerpQuaternions(L.prevQ, L.currQ, alpha);
      L.elastic.excite(simTime, events.hits[L.index] / 3.5, rand(), rand(), L.index * 13 + simTime);
      L.elastic.update(simTime);
      const mat = L.mesh.material as THREE.MeshPhysicalMaterial;
      if (L.mode === 'arrive' || (L.mesh.visible && simTime - L.visibleAt < 0.2)) {
        const o = Math.min(1, (simTime - L.visibleAt) / 0.16);
        if (o < 1) { mat.transparent = true; mat.opacity = o; } else if (mat.transparent) { mat.transparent = false; mat.opacity = 1; }
      }
    }
    if (events.frameCount) synth.hit(events.frameMax, events.frameCount);
    synth.reassembly(sm.phase === 'reassemble', reassemblyProgress);
    events.resetFrame();
    // reflection sweep 2.0–2.6s
    if (!reduced && simTime < 2.8) scene.environmentRotation.y = -0.55 * (1 - smooth((simTime - 2.0) / 0.6));
    if (!captionShown && simTime >= 2.6) { captionShown = true; caption.classList.add('on'); }
    cam.update(Math.min(rdt, 0.05), !reduced && !recSaved);
    if (recorder.active) {
      const e = recorder.elapsed();
      controls.setRec(`REC ${String(Math.floor(e)).padStart(2, '0')}S`);
      if (e >= MAX_SECONDS) recorder.stop();
    }
    renderer.render(scene, cam.camera);
    // adaptive quality: shadows go first, then resolution; geometry is never reduced
    emaFt += (rdt * 1000 - emaFt) * 0.05;
    if (!lockHigh && !recSaved) {
      if (emaFt > 22) { slowT += rdt; fastT = 0; } else if (emaFt < 11) { fastT += rdt; slowT = 0; } else { slowT = fastT = 0; }
      if (slowT > 2 && quality < 4) { quality++; slowT = 0; applyQuality(); }
      if (fastT > 6 && quality > 0) { quality--; fastT = 0; applyQuality(); }
    }
  }
  let acc = 0, pauseAt = -1;
  function accumulate(rdt: number) {
    if (pauseAt >= 0 && simTime >= pauseAt) { acc = 0; return; }
    acc += Math.min(rdt, MAX_FRAME); // cap after inactivity / long frames
    let n = 0;
    while (acc >= STEP && n < 12) { step(STEP); acc -= STEP; n++; }
    if (n === 12) acc = Math.min(acc, STEP);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; }
    else if (!running) { running = true; last = -1; requestAnimationFrame(frame); }
  });
  requestAnimationFrame(frame);

  // ---------- test / QA hooks ----------
  const toScreen = (p: THREE.Vector3) => { tmpV.copy(p).project(cam.camera); return { x: (tmpV.x + 1) / 2 * cssW, y: (1 - tmpV.y) / 2 * cssH }; };
  (window as any).__TIM = {
    ready: true, errors, letters: letters.length,
    get phase() { return sm.phase; }, get simTime() { return simTime; }, get quality() { return quality; },
    allHold: () => letters.every((L) => L.mode === 'hold'),
    modes: () => letters.map((L) => L.mode),
    maxRestErrorPx: () => Math.max(...letters.map((L) => L.restError() / upp() + L.angError() * (L.glyph.height / 2) / upp())),
    errorsPx: () => letters.map((L) => +(L.restError() / upp()).toFixed(3)),
    invalid: () => {
      const b = pw.bounds;
      for (const L of letters) {
        const p = L.currP, v = L.linv, w = L.angv;
        if (![p.x, p.y, p.z, v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite)) return 'nan:' + L.index;
        if (v.length() > 200 || w.length() > 500) return 'velocity:' + L.index;
        if (Math.abs(p.x) > b.halfW + 0.3 || p.y < b.floorY - 0.3 || p.y > b.ceil + 0.5 || Math.abs(p.z) > 3) return 'escaped:' + L.index;
      }
      return null;
    },
    minHeightAboveFloor: () => Math.min(...letters.map((L) => L.currP.y)) - pw.bounds.floorY,
    lastImpact: () => lastImpact,
    contacts: () => ({ pairs: events.pairCount, distinct: [...events.letterPairs] }),
    clearContacts: () => { events.pairCount = 0; events.letterPairs.clear(); },
    screenOf: (i: number) => toScreen(letters[i].currP),
    restScreenOf: (i: number) => toScreen(letters[i].rest),
    modeOf: (i: number) => letters[i].mode,
    chars: () => letters.map((L) => L.glyph.char).join(''),
    frameStats: () => {
      const n = ftN, a = Array.from(ft.slice(0, n)).filter((x) => x > 0).sort((x, y) => x - y);
      const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
      return { n: a.length, median: q(0.5), p95: q(0.95), quality, dpr: renderer.getPixelRatio(), size: [renderer.domElement.width, renderer.domElement.height] };
    },
    resetFrameStats: () => { ftN = 0; ftHead = 0; },
    exportPNG: () => exportPNG(false), exportPoster: () => exportPoster(false),
    recordFormat: () => pickFormat(),
    handTracks: () => hand.activeTracks(),
    reduced,
    pauseAt: (t: number) => { pauseAt = t; },
    resume: () => { pauseAt = -1; },
  };
}
main().catch((e) => { errors.push(String(e)); console.error(e); showFallback(); });
