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
const dlg = (page) => page.locator("dialog[open], [role=dialog]").first();
(async () => {
  // Éxito (escritorio): nombre nuevo + doble clic
  {
    const { browser, page } = await nuevaPagina(1366, 768);
    await abrirDialogo(page);
    await page.getByLabel(/Nombre del producto nuevo/).fill("Bife a la pimienta");
    const t0 = Date.now();
    await page.getByRole("button", { name: /^Duplicar$/ }).last().dblclick();
    await page.waitForFunction(() => { const d = document.querySelector("dialog[open],[role=dialog]"); return d && /creó|creado|Listo|Ver /i.test(d.innerText); }, null, { timeout: 90000 }).catch(() => {});
    console.log("segundos hasta resultado:", ((Date.now() - t0) / 1000).toFixed(1));
    console.log("TEXTO DIALOGO:", (await dlg(page).innerText()).slice(0, 900));
    await snap(page, "a4-resultado-duplicar-exito", "d", false);
    await browser.close();
  }
  // Éxito (celular) con otro nombre natural
  // Nombre repetido (celular y escritorio): «Bife con chimichurri» ya existe
  for (const [tag, w, h] of [["m", 375, 844], ["d", 1366, 768]]) {
    const { browser, page } = await nuevaPagina(w, h);
    await abrirDialogo(page);
    await page.getByLabel(/Nombre del producto nuevo/).fill("Bife con chimichurri");
    await page.getByRole("button", { name: /^Duplicar$/ }).last().click();
    await page.waitForFunction(() => { const d = document.querySelector("dialog[open],[role=dialog]"); return d && /ya existe|Ya existe|existe/i.test(d.innerText); }, null, { timeout: 90000 }).catch(() => {});
    const t = await dlg(page).innerText();
    console.log(tag, "REPETIDO:", t.split("\n").filter((l) => /existe/i.test(l)).join(" | "));
    await snap(page, "a5-nombre-repetido", tag, false);
    // mismo nombre con otras mayúsculas
    await page.getByLabel(/Nombre del producto nuevo/).fill("BIFE CON CHIMICHURRI");
    await page.getByRole("button", { name: /^Duplicar$/ }).last().click();
    await page.waitForTimeout(9000);
    const t2 = await dlg(page).innerText();
    console.log(tag, "MAYUSCULAS:", t2.split("\n").filter((l) => /existe|creó|creado/i.test(l)).join(" | "));
    await snap(page, "a6-nombre-repetido-otras-mayusculas", tag, false);
    await browser.close();
  }
  // Producto nuevo (ficha) en ambos tamaños
  const { browser: b2, ctx: c2 } = await abrir(375, 844);
  await b2.close();
  fs.writeFileSync("/tmp/claude-0/-home-user-motor2/04595602-76c6-5140-8514-16e652752f44/scratchpad/res-dup2.json", JSON.stringify(res, null, 1));
})();
