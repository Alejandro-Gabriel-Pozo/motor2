const { abrir, medir, BASE } = require("./lib.cjs");
(async () => {
  const { browser, ctx } = await abrir(375, 844);
  await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/catalogo/productos/cmvtjflfd002108jpim08e4cf", { waitUntil: "networkidle", timeout: 90000 });
  await page.getByRole("button", { name: /Duplicar/ }).first().click();
  await page.waitForSelector("dialog[open], [role=dialog]");
  await page.getByLabel(/Nombre del producto nuevo/).fill("Bife con salsa de hongos");
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Duplicar$/ }).last().dblclick();
  await page.waitForFunction(() => { const d = document.querySelector("dialog[open],[role=dialog]"); return d && /creado/i.test(d.innerText); }, null, { timeout: 90000 });
  console.log("seg", ((Date.now() - t0) / 1000).toFixed(1));
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/home/user/motor2/capturas/a4-resultado-duplicar-exito-m.png" });
  const m = await medir(page);
  console.log(m.desborde, m.botonesChicos, JSON.stringify(m.chicosEj), m.axe.map((a) => a.id));
  await browser.close();
})();
