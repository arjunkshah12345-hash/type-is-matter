import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5173/?q=high&intro=0');
await p.waitForFunction(() => window.__TIM?.ready && __TIM.phase==='rest');
const pts = [[0.5, 0.5], [0.3, 0.35], [0.7, 0.62], [0.2, 0.7], [0.82, 0.3], [0.5, 0.28], [0.42, 0.75], [0.62, 0.45], [0.12, 0.5], [0.9, 0.85]];
for (const [i,[fx,fy]] of pts.entries()) {
  await p.mouse.click(1440*fx, 900*fy); await p.mouse.move(2, 898);
  const t0 = await p.evaluate(()=>__TIM.simTime);
  while (true) {
    await p.waitForTimeout(1000);
    const st = await p.evaluate(()=>({ph:__TIM.phase,t:__TIM.simTime,m:__TIM.modes().join(','),e:__TIM.errorsPx().map(x=>Math.round(x)).join(',')}));
    if (st.ph==='rest') { console.log(i,'ok',(st.t-t0).toFixed(2)); break; }
    if (st.t-t0>12) { console.log(i,'STUCK',JSON.stringify(st)); break; }
  }
}
await b.close();
