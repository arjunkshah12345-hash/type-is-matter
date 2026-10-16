import { chromium } from '@playwright/test';
const vps = (process.argv[2]||'1440x900,1920x1080,390x844').split(',').map(s=>s.split('x').map(Number));
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
for (const [w,h] of vps) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto('http://localhost:5173/?q=high');
  await p.waitForFunction(() => window.__TIM?.ready);
  const tag = `${w}x${h}`;
  await p.waitForFunction(() => __TIM.phase === 'rest' && __TIM.simTime > 3.2, null, { timeout: 120000 });
  await p.screenshot({ path: `qa/A-initial-${tag}.png` });
  await p.mouse.move(w/2, h/2 - h*0.02, { steps: 4 });
  await p.waitForFunction(t => __TIM.simTime > t, (await p.evaluate(()=>__TIM.simTime)) + 0.6);
  await p.screenshot({ path: `qa/B-hover-${tag}.png` });
  await p.mouse.move(w/2, h/2); 
  // click on empty space between lines near centre? centre click: use a real pointer click
  await p.evaluate(() => __TIM.pauseAt(-1));
  await p.mouse.down(); await p.mouse.up();
  const t0 = await p.evaluate(()=>{ __TIM.pauseAt(__TIM.simTime + 0.22); return __TIM.simTime; });
  await p.waitForFunction(t => __TIM.simTime >= t, t0 + 0.22); await p.waitForTimeout(400);
  await p.screenshot({ path: `qa/C-impact-${tag}.png` }); await p.evaluate(() => __TIM.resume());
  console.log(tag, 'impact', JSON.stringify(await p.evaluate(()=>__TIM.lastImpact())));
  await p.mouse.move(5, h-5);
  await p.waitForFunction(() => __TIM.phase === 'reassemble', null, { timeout: 120000 });
  const t1 = await p.evaluate(()=>{ __TIM.pauseAt(__TIM.simTime + 0.7); return __TIM.simTime; });
  await p.waitForFunction(t => __TIM.simTime >= t, t1 + 0.7); await p.waitForTimeout(400);
  await p.screenshot({ path: `qa/D-reassembly-${tag}.png` }); await p.evaluate(() => __TIM.resume());
  await p.waitForFunction(() => __TIM.phase === 'rest', null, { timeout: 180000 });
  const t2 = await p.evaluate(()=>__TIM.simTime);
  await p.waitForFunction(t => __TIM.simTime > t, t2 + 0.5);
  console.log(tag, 'reassembled in', (t2 - t1).toFixed(2), 's sim; maxErrPx', await p.evaluate(()=>__TIM.maxRestErrorPx()), 'invalid', await p.evaluate(()=>__TIM.invalid()));
  await p.screenshot({ path: `qa/E-settled-${tag}.png` });
  const url = await p.evaluate(() => __TIM.exportPoster());
  const fs = await import('fs');
  fs.writeFileSync(`qa/F-poster-${tag}.png`, Buffer.from(url.split(',')[1], 'base64'));
  await p.screenshot({ path: `qa/F-after-export-${tag}.png` });
  if (w === 1440) { const u2 = await p.evaluate(() => __TIM.exportPNG()); fs.writeFileSync(`qa/export-2400x1500.png`, Buffer.from(u2.split(',')[1], 'base64')); }
  console.log(tag, 'errors', await p.evaluate(()=>__TIM.errors));
  await ctx.close();
}
await b.close();
