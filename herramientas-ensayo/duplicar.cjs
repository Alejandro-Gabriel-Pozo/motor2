const { abrir, medir, BASE } = require("./lib.cjs");
const fs = require("fs");
const OUT = "/home/user/motor2/capturas";
const ID = "cmvtjflfd002108jpim08e4cf";
const res = {};
async function nuevaPagina(w, h) {
  const { browser, ctx } = await abrir(w, h);
  await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
  return { browser, page: await ctx.newPage() };
}
async function snap(page, nombre, tag, completa = true) {
  await page.screenshot({ path: `${OUT}/${nombre}-${tag}.png`, fullPage: completa });
  res[`${nombre}-${tag}`] = await medir(page);
}
async function abrirDialogo(page) {
  await page.goto(BASE + "/catalogo/productos/" + ID, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: /Duplicar/ }).first().click();
  await page.waitForSelector("dialog[open], [role=dialog]");
  await page.waitForTimeout(500);
}
(async () => {
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const { browser, page } = await nuevaPagina(w, h);
    await page.goto(BASE + "/catalogo/productos/" + ID, { waitUntil: "networkidle", timeout: 60000 });
    await snap(page, "a1-ficha-bife-con-boton-duplicar", tag);
    await abrirDialogo(page);
    await snap(page, "a2-dialogo-duplicar-vacio", tag, false);
    if (tag === "m") {
      const campo = page.getByLabel(/Nombre del producto nuevo/);
      await campo.fill("Bife con chimichurri");
      await snap(page, "a3-dialogo-duplicar-con-nombre", tag, false);
      // doble clic rápido
      const b = page.getByRole("button", { name: /^Duplicar$/ }).last();
      await b.dblclick();
      await page.waitForTimeout(6000);
      console.log("URL tras duplicar:", page.url().replace(BASE, ""));
      console.log((await page.locator("main").innerText()).slice(0, 700));
      await snap(page, "a4-resultado-duplicar", tag);
      fs.writeFileSync(OUT + "/_url-nuevo.txt", page.url());
    }
    await browser.close();
  }
  fs.writeFileSync("/tmp/claude-0/-home-user-motor2/04595602-76c6-5140-8514-16e652752f44/scratchpad/res-dup1.json", JSON.stringify(res, null, 1));
})();
