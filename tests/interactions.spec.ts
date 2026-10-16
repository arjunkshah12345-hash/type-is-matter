import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
declare const __TIM: any;
const TOL_PX = 1.0;
async function boot(page: Page, q = '?q=high&intro=0') {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('/' + q);
  await page.waitForFunction(() => (window as any).__TIM?.ready, null, { timeout: 60_000 });
  await page.waitForFunction(() => __TIM.phase === 'rest', null, { timeout: 120_000 });
  return errs;
}
const simTime = (p: Page) => p.evaluate(() => __TIM.simTime as number);
async function waitSim(p: Page, dt: number) { const t = await simTime(p); await p.waitForFunction((t) => __TIM.simTime >= t, t + dt, { timeout: 300_000 }); }

test('10 clicks at different locations: every letter returns within tolerance after each', async ({ page }) => {
  const errs = await boot(page);
  const pts = [[0.5, 0.5], [0.3, 0.35], [0.7, 0.62], [0.2, 0.7], [0.82, 0.3], [0.5, 0.28], [0.42, 0.75], [0.62, 0.45], [0.12, 0.5], [0.9, 0.85]];
  const vp = page.viewportSize()!;
  for (const [i, [fx, fy]] of pts.entries()) {
    await page.mouse.click(vp.width * fx, vp.height * fy);
    await page.mouse.move(2, vp.height - 2);
    await waitSim(page, 0.3);
    const t0 = await simTime(page);
    await page.waitForFunction(() => __TIM.phase === 'rest', null, { timeout: 300_000 });
    const t1 = await simTime(page);
    await waitSim(page, 0.3);
    const err = await page.evaluate(() => __TIM.maxRestErrorPx());
    const inv = await page.evaluate(() => __TIM.invalid());
    console.log(`click ${i + 1} at (${fx},${fy}): settled ${(t1 - t0 + 0.3).toFixed(2)}s sim after impact, max error ${err.toFixed(3)}px`);
    expect(inv).toBeNull();
    expect(err).toBeLessThan(TOL_PX);
  }
  const imp = await page.evaluate(() => __TIM.lastImpact());
  expect(errs).toEqual([]);
  expect(imp.t).toBeGreaterThan(0);
});

test('centre click separates at least 6 letters', async ({ page }) => {
  await boot(page);
  const vp = page.viewportSize()!;
  await page.mouse.click(vp.width / 2, vp.height / 2);
  const imp = await page.evaluate(() => __TIM.lastImpact());
  console.log('separated by centre impulse:', imp.sep);
  expect(imp.sep).toBeGreaterThanOrEqual(6);
});

test('drag a letter across two others: collisions happen, letter stays interactive after release', async ({ page }) => {
  await boot(page);
  // drag the "S" of STAYS (index 7) horizontally through T and A
  const chars = await page.evaluate(() => __TIM.chars());
  const iS = chars.indexOf('STAYS'.charAt(0), 7);
  const s = await page.evaluate((i) => __TIM.screenOf(i), iS);
  const a = await page.evaluate((i) => __TIM.screenOf(i), iS + 2);
  await page.evaluate(() => __TIM.clearContacts());
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  const steps = 30;
  for (let k = 1; k <= steps; k++) { await page.mouse.move(s.x + ((a.x - s.x) * 1.7 * k) / steps, s.y + 4 * Math.sin(k / 3), { steps: 1 }); await waitSim(page, 0.03); }
  expect(await page.evaluate((i) => __TIM.modeOf(i), iS)).toBe('drag');
  await page.mouse.up();
  const contacts = await page.evaluate(() => __TIM.contacts());
  const withS = contacts.distinct.filter((p: string) => p.split('-').map(Number).includes(iS));
  console.log('letter-letter contact pairs involving dragged S:', withS);
  expect(withS.length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate((i) => __TIM.modeOf(i), iS)).toBe('free'); // released with simulated velocity
  // still interactive: grab it again where it is now
  await waitSim(page, 0.4);
  await page.evaluate(() => __TIM.pauseAt(__TIM.simTime)); await page.waitForTimeout(300); // freeze so the pointer lands on it
  const s2 = await page.evaluate((i) => __TIM.screenOf(i), iS);
  await page.mouse.move(s2.x, s2.y); await page.mouse.down();
  await page.evaluate(() => __TIM.resume());
  await page.mouse.move(s2.x + 40, s2.y - 30, { steps: 5 });
  expect(await page.evaluate((i) => __TIM.modeOf(i), iS)).toBe('drag');
  await page.mouse.up();
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => __TIM.phase === 'rest', null, { timeout: 300_000 });
  await waitSim(page, 0.3);
  expect(await page.evaluate(() => __TIM.maxRestErrorPx())).toBeLessThan(TOL_PX);
});

test('60s stability run: no NaN, no runaway velocity, nothing escapes, no uncaught errors', async ({ page }) => {
  const errs = await boot(page);
  const vp = page.viewportSize()!;
  const start = Date.now();
  let k = 0;
  while (Date.now() - start < 60_000) {
    const r = (n: number) => (Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1;
    const x = vp.width * (0.15 + 0.7 * Math.abs(r(1))), y = vp.height * (0.2 + 0.6 * Math.abs(r(2)));
    if (k % 3 === 2) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y - 60, { steps: 6 }); await page.mouse.up(); }
    else await page.mouse.click(x, y);
    k++;
    for (let j = 0; j < 4; j++) {
      await page.waitForTimeout(500);
      const inv = await page.evaluate(() => __TIM.invalid());
      expect(inv).toBeNull();
    }
  }
  console.log(`stability: ${k} interactions over 60s wall-clock, sim time ${(await simTime(page)).toFixed(1)}s`);
  expect(await page.evaluate(() => __TIM.errors)).toEqual([]);
  expect(errs).toEqual([]);
});

test('20s frame-time run (default adaptive quality)', async ({ page }) => {
  await boot(page, '?intro=0');
  const vp = page.viewportSize()!;
  await page.evaluate(() => __TIM.resetFrameStats());
  const start = Date.now();
  let k = 0;
  while (Date.now() - start < 20_000) {
    await page.mouse.move(vp.width * (0.3 + 0.4 * Math.sin(k / 5) ** 2), vp.height * 0.5, { steps: 3 });
    if (k === 10) await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(250); k++;
  }
  const st = await page.evaluate(() => __TIM.frameStats());
  console.log('FRAME STATS (software GPU, SwiftShader):', JSON.stringify(st));
  fs.writeFileSync('qa/frame-stats.json', JSON.stringify(st, null, 2));
  expect(st.n).toBeGreaterThan(10);
});

test('UI controls: export PNG/poster sizes, menu, reset, keyboard focus, hand mode lifecycle', async ({ page }) => {
  await boot(page);
  await page.click('#btn-export');
  await expect(page.locator('#exportmenu')).toBeVisible();
  const png = await page.evaluate(() => __TIM.exportPNG());
  const poster = await page.evaluate(() => __TIM.exportPoster());
  const dims = await page.evaluate(async ([a, b]) => {
    const load = (u: string) => new Promise<number[]>((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = u; });
    return [await load(a), await load(b)];
  }, [png, poster]);
  expect(dims).toEqual([[2400, 1500], [2400, 3000]]);
  const fmt = await page.evaluate(() => __TIM.recordFormat());
  console.log('recording format chosen:', JSON.stringify(fmt));
  expect(fmt).not.toBeNull();
  // keyboard: focus the control and activate with Enter
  await page.locator('#btn-sound').focus();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('btn-sound');
  await page.keyboard.press('Enter');
  await expect(page.locator('#btn-sound')).toHaveText('[ SOUND ON ]');
  await page.click('#btn-sound');
  await expect(page.locator('#btn-sound')).toHaveText('[ SOUND OFF ]');
  // hand mode with Chromium's fake camera (no real hand; verifies opt-in, indicator, local model load, track shutdown)
  await page.click('#btn-hand');
  await page.waitForFunction(() => document.getElementById('btn-hand')!.getAttribute('aria-pressed') === 'true' || document.getElementById('note')!.textContent!.includes('UNAVAILABLE'), null, { timeout: 120_000 });
  const handOn = await page.evaluate(() => document.getElementById('btn-hand')!.getAttribute('aria-pressed'));
  console.log('hand mode started:', handOn, await page.evaluate(() => document.getElementById('note')!.textContent));
  if (handOn === 'true') {
    await expect(page.locator('#camind')).toBeVisible();
    expect(await page.evaluate(() => __TIM.handTracks())).toBeGreaterThan(0);
    await page.click('#btn-hand');
    expect(await page.evaluate(() => __TIM.handTracks())).toBe(0);
    await expect(page.locator('#camind')).toBeHidden();
  }
  await page.click('#btn-reset');
});

test('reduced motion: no intro, stable composition', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/?q=high');
  await page.waitForFunction(() => (window as any).__TIM?.ready);
  expect(await page.evaluate(() => __TIM.reduced)).toBe(true);
  expect(await page.evaluate(() => __TIM.phase)).toBe('rest');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => __TIM.maxRestErrorPx())).toBeLessThan(TOL_PX);
  await ctx.close();
});

test('static fallback when WebGL is unavailable', async ({ page }) => {
  await page.goto('/?nowebgl=1');
  await expect(page.locator('#fallback')).toBeVisible();
});
