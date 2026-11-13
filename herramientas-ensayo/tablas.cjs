const { abrir, BASE } = require("./lib.cjs");
(async () => {
  const { browser, ctx } = await abrir(375, 844);
  await ctx.addCookies([{ name: "sucursalActivaId", value: "cmuzjoulf000606l3p3hj66hc", url: BASE }]);
  const page = await ctx.newPage();
  for (const r of ["/administracion/usuarios", "/administracion/roles", "/traspasos", "/catalogo/productos/cmvtjflfd002108jpim08e4cf"]) {
    await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 90000 });
    const t = await page.evaluate(() => [...document.querySelectorAll("table")].map((t) => { let e = t.parentElement; while (e && e !== document.body) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll") break; e = e.parentElement; } return { tablaAncho: t.scrollWidth, contenedor: e && e !== document.body ? { ox: getComputedStyle(e).overflowX, cw: e.clientWidth, sw: e.scrollWidth } : null, cab: [...t.querySelectorAll("th")].map((h) => h.innerText.trim()).join("|").slice(0, 80) }; }));
    console.log(r, JSON.stringify(t));
  }
  await browser.close();
})();
