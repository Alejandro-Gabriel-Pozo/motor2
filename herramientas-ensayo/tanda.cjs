const { abrir, medir, BASE } = require("./lib.cjs");
const fs = require("fs");
const OUT = "/home/user/motor2/capturas";
const NUEVO = "19c6c714-a159-4112-a6bb-ff2c5ddbb201";
const BIFE = "cmvtjflfd002108jpim08e4cf";
const PANTALLAS = [
  ["b-carta-hoy", "/carta"],
  ["c-en-la-carta-producto-nuevo", `/catalogo/productos/${NUEVO}/en-la-carta`],
  ["d01-admin-usuarios", "/administracion/usuarios"],
  ["d02-admin-sucursales", "/administracion/sucursales"],
  ["d03-admin-roles", "/administracion/roles"],
  ["d04-reportes-compras", "/reportes/compras"],
  ["d05-reportes-rotacion-mesas", "/reportes/rotacion-mesas"],
  ["d06-reportes-tickets", "/reportes/tickets"],
  ["d07-traspasos", "/traspasos"],
  ["d08-comparativa-proveedores", "/catalogo/proveedores/comparativa"],
  ["d09-reportes-historial", "/reportes/historial"],
  ["d10-receta-ficha", `/catalogo/recetas/${BIFE}`],
  ["d11-receta-historial", `/catalogo/recetas/${BIFE}/historial`],
  ["e-salon-mesas", "/mesas"],
  ["f1-promociones-parametrizacion", "/carta/parametrizacion/promociones"],
  ["g1-carta-publica-huinganco", "/carta-publica/hoteles-del-neuquen/huinganco"],
  ["g2-carta-publica-portal", "/carta-publica/hoteles-del-neuquen"],
  ["i-inicio", "/inicio"],
];
(async () => {
  const sel = process.argv[2]; // m | d
  const filtro = process.argv[3];
  const [w, h] = sel === "m" ? [375, 844] : [1366, 768];
  const { browser, ctx } = await abrir(w, h);
  await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
  const page = await ctx.newPage();
  const res = {};
  for (const [nombre, ruta] of PANTALLAS) {
    if (filtro && !nombre.startsWith(filtro)) continue;
    try {
      const r = await page.goto(BASE + ruta, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(800);
      let alto = await page.evaluate(() => document.documentElement.scrollHeight);
      if (sel === "d") {
        const sh = await page.evaluate(() => { let mx = 0; document.querySelectorAll("*").forEach((e) => { const o = getComputedStyle(e).overflowY; if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) mx = Math.max(mx, e.scrollHeight - e.clientHeight); }); return mx; });
        if (sh > 0) { alto = 768 + sh; await page.setViewportSize({ width: w, height: Math.min(alto, 6500) }); await page.waitForTimeout(600); }
      }
      const opts = sel === "d" ? { fullPage: false } : alto > 6500 ? { clip: { x: 0, y: 0, width: w, height: 6500 }, fullPage: true } : { fullPage: true };
      await page.screenshot({ path: `${OUT}/${nombre}-${sel}.png`, ...opts });
      const m = await medir(page);
      if (sel === "d") await page.setViewportSize({ width: w, height: h });
      res[nombre] = { status: r.status(), url: page.url().replace(BASE, ""), alto, ...m };
      console.log(nombre, r.status(), "→", res[nombre].url, "alto", alto, "desborde", m.desborde, "chicos", m.botonesChicos, "axe", m.axe.map((a) => a.id + "(" + a.nodos + ")").join(","));
    } catch (e) { console.log(nombre, "ERROR", String(e).slice(0, 150)); res[nombre] = { error: String(e).slice(0, 150) }; }
  }
  fs.writeFileSync(`${process.argv[1].replace("tanda.cjs", "")}res-tanda-${sel}${filtro ? "-" + filtro : ""}.json`, JSON.stringify(res, null, 1));
  await browser.close();
})();
