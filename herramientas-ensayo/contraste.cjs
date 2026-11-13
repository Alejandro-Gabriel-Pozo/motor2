const { chromium } = require("/home/user/motor2/node_modules/playwright");
const AxeBuilder = require("/home/user/motor2/node_modules/@axe-core/playwright").default;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 844 }, locale: "es-AR" });
  const page = await ctx.newPage();
  await page.goto("http://localhost:3100/carta-publica/hoteles-del-neuquen/huinganco", { waitUntil: "networkidle", timeout: 90000 });
  for (let i = 0; i <= 11; i++) {
    if (i === 3 || i === 11) {
      const r = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      for (const v of r.violations) for (const n of v.nodes.slice(0, 4)) console.log(i, n.html.slice(0, 110).replace(/\s+/g, " "), "|", (n.any[0] && n.any[0].message || "").slice(0, 150));
      console.log(i, "titulo lamina:", (await page.locator("[aria-current], h1, h2").allInnerTexts()).slice(0, 4).join(" / ").slice(0, 100));
    }
    await page.getByRole("button", { name: "Página siguiente" }).click();
    await page.waitForTimeout(800);
  }
  await browser.close();
})();
