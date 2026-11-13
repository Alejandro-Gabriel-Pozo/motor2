const { abrir, medir, BASE } = require("./lib.cjs");
const fs = require("fs");
const OUT = "/home/user/motor2/capturas";
const res = {};
(async () => {
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const { browser, ctx } = await abrir(w, h);
    await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
    const page = await ctx.newPage();
    await page.goto(BASE + "/mesas/cmuzn3r5e000j06jp8p7f1pkj", { waitUntil: "networkidle", timeout: 90000 });
    const shot = async (n, full = true) => {
      if (tag === "d" && full) { const sh = await page.evaluate(() => { let mx = 0; document.querySelectorAll("*").forEach((e) => { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) mx = Math.max(mx, e.scrollHeight - e.clientHeight); }); return mx; }); if (sh > 0) await page.setViewportSize({ width: w, height: Math.min(768 + sh, 3000) }); }
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${n}-${tag}.png`, fullPage: tag === "m" && full });
      res[`${n}-${tag}`] = await medir(page);
      if (tag === "d") await page.setViewportSize({ width: w, height: h });
    };
    await shot("f2-pos-mesa-01-inicio");
    await page.getByRole("button", { name: /^Promociones$/ }).click();
    await page.waitForTimeout(1500);
    await shot("f3-pos-promociones");
    await page.getByRole("button", { name: /Menú ejecutivo/ }).first().click();
    await page.waitForTimeout(3000);
    console.log(tag, "TRAS CLIC PROMO:\n", (await page.locator("body").innerText()).split("Agregar al pedido")[1]?.slice(0, 900));
    await shot("f4-pos-armando-promo");
    console.log(tag, "BOTONES:", JSON.stringify(await page.locator("main button, dialog button").allInnerTexts()).slice(0, 600));
    await browser.close();
  }
  fs.writeFileSync("/tmp/claude-0/-home-user-motor2/04595602-76c6-5140-8514-16e652752f44/scratchpad/res-pos.json", JSON.stringify(res, null, 1));
})();
