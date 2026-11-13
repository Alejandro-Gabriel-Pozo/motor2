const { chromium } = require("/home/user/motor2/node_modules/playwright");
const AxeBuilder = require("/home/user/motor2/node_modules/@axe-core/playwright").default;
const BASE = "http://localhost:3200";
const OUT = "/home/user/motor2/capturas";
(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    for (const conSesion of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", hasTouch: tag === "m", isMobile: tag === "m" });
      if (conSesion) await ctx.addCookies([{ name: "plataforma.sesion", value: "ensayo-plataforma-token-20261113-xyz", url: BASE, httpOnly: true, sameSite: "Strict" }]);
      const page = await ctx.newPage();
      const rutas = conSesion ? [["h2-consola-inicio", "/"]] : [["h1-consola-login", "/login"]];
      for (const [n, ruta] of rutas) {
        const r = await page.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${n}-${tag}.png`, fullPage: true });
        const desb = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const axe = (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id + "(" + v.nodes.length + ")");
        console.log(tag, n, r.status(), page.url().replace(BASE, ""), "desborde", desb, "axe", axe.join(","));
        if (conSesion && tag === "m") { console.log((await page.locator("body").innerText()).slice(0, 700)); console.log(JSON.stringify(await page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))))); }
      }
      await ctx.close();
    }
  }
  await browser.close();
})();
