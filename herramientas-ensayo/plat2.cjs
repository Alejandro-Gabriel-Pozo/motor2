const { chromium } = require("/home/user/motor2/node_modules/playwright");
const AxeBuilder = require("/home/user/motor2/node_modules/@axe-core/playwright").default;
const { abrir, medir, BASE } = require("./lib.cjs");
const OUT = "/home/user/motor2/capturas";
(async () => {
  const browser = await chromium.launch();
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: "es-AR", hasTouch: tag === "m", isMobile: tag === "m" });
    await ctx.addCookies([{ name: "plataforma.sesion", value: "ensayo-plataforma-token-20261113-xyz", url: "http://localhost:3200", httpOnly: true, sameSite: "Strict" }]);
    const page = await ctx.newPage();
    await page.goto("http://localhost:3200/instalaciones/principal/empresas", { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/h3-consola-empresas-${tag}.png`, fullPage: true });
    const desb = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const axe = (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id + "(" + v.nodes.length + ")");
    console.log(tag, "empresas", page.url().replace("http://localhost:3200", ""), "desborde", desb, "axe", axe.join(","));
    if (tag === "m") console.log((await page.locator("body").innerText()).slice(0, 500));
    await ctx.close();
  }
  await browser.close();
  // Producto nuevo y lista de productos
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const { browser: b, ctx } = await abrir(w, h);
    await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
    const page = await ctx.newPage();
    for (const [n, ruta] of [["a7-producto-duplicado-bife-con-chimichurri", "/catalogo/productos/19c6c714-a159-4112-a6bb-ff2c5ddbb201"], ["a8-lista-productos", "/catalogo/productos?q=bife"]]) {
      await page.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(600);
      if (tag === "d") { const sh = await page.evaluate(() => { let mx = 0; document.querySelectorAll("*").forEach((e) => { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) mx = Math.max(mx, e.scrollHeight - e.clientHeight); }); return mx; }); if (sh > 0) await page.setViewportSize({ width: w, height: Math.min(768 + sh, 4000) }); }
      await page.screenshot({ path: `${OUT}/${n}-${tag}.png`, fullPage: tag === "m" });
      const m = await medir(page);
      console.log(tag, n, "desborde", m.desborde, "chicos", m.botonesChicos, "axe", m.axe.map((a) => a.id).join(","));
      if (tag === "m" && n.startsWith("a7")) console.log((await page.locator("main").innerText()).slice(0, 1400));
      if (tag === "d") await page.setViewportSize({ width: w, height: h });
    }
    await b.close();
  }
})();
