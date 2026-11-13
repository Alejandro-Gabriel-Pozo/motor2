const { chromium } = require("/home/user/motor2/node_modules/playwright");
const AxeBuilder = require("/home/user/motor2/node_modules/@axe-core/playwright").default;
const BASE = "http://localhost:3100";
const OUT = "/home/user/motor2/capturas";
(async () => {
  const browser = await chromium.launch();
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", hasTouch: tag === "m", isMobile: tag === "m" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/carta-publica/hoteles-del-neuquen/huinganco", { waitUntil: "networkidle", timeout: 90000 });
    const sig = page.getByRole("button", { name: /siguiente|next|→|›/i }).last();
    console.log(tag, "botones:", JSON.stringify(await page.locator("button").evaluateAll((bs) => bs.map((b) => (b.getAttribute("aria-label") || b.innerText).trim().slice(0, 30)))));
    let prev = "";
    for (let i = 0; i < 17; i++) {
      const txt = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80);
      
      prev = txt;
      const n = String(i).padStart(2, "0");
      if (tag === "m" || [0, 1, 4, 5, 13].includes(i)) await page.screenshot({ path: `${OUT}/g3-carta-publica-lamina${n}-${tag}.png` });
      let axe = [];
      try { axe = (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id + "(" + v.nodes.length + ")"); } catch {}
      const desb = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(tag, n, txt.slice(0, 60), "| desborde", desb, "| axe", axe.join(","));
      try { await page.getByRole("button", { name: "Página siguiente" }).click({ timeout: 4000 }); await page.waitForTimeout(900); } catch { break; }
    }
    await ctx.close();
  }
  await browser.close();
})();
