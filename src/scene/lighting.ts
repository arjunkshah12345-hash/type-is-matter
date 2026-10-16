import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
/** Physically based studio lights matching the environment panels. */
export class StudioLights {
  readonly group = new THREE.Group();
  readonly shadowLight: THREE.DirectionalLight;
  constructor() {
    RectAreaLightUniformsLib.init();
    const key = new THREE.RectAreaLight(0xf2f6ff, 5.0, 9, 14); key.position.set(-11, 8, 10); key.lookAt(0, 0, 0);
    const fill = new THREE.RectAreaLight(0xffe6cc, 2.5, 10, 10); fill.position.set(14, 2, 6); fill.lookAt(0, 0, 0);
    const rim = new THREE.RectAreaLight(0xffffff, 7.0, 22, 1.0); rim.position.set(0, 11, -12); rim.lookAt(0, 0, 0);
    this.group.add(key, fill, rim);
    // shadow caster aligned with the key softbox; soft contact shadows on the cyclorama only
    const d = new THREE.DirectionalLight(0xffffff, 0.0001);
    d.position.set(-3, 16, 3.5); d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048); d.shadow.radius = 9; d.shadow.blurSamples = 20; d.shadow.bias = -0.0008; d.shadow.normalBias = 0.02;
    this.shadowLight = d;
    this.group.add(d, d.target);
  }
  fitShadow(halfW: number, floorY: number) {
    const c = this.shadowLight.shadow.camera;
    c.left = -halfW - 4; c.right = halfW + 4; c.top = 10; c.bottom = -10; c.near = 1; c.far = 50; c.updateProjectionMatrix();
    this.shadowLight.target.position.set(0, floorY, 0);
  }
}
