const { chromium } = require("/home/user/motor2/node_modules/playwright");
const AxeBuilder = require("/home/user/motor2/node_modules/@axe-core/playwright").default || require("/home/user/motor2/node_modules/@axe-core/playwright").AxeBuilder;
const BASE = "http://localhost:3100";
const TOKEN = "ensayo-general-token-20261113-abcdef0123456789";
async function abrir(ancho, alto) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires", hasTouch: ancho < 600, isMobile: ancho < 600 });
  await ctx.addCookies([{ name: "authjs.session-token", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" }]);
  return { browser, ctx };
}
// Mide desborde horizontal, botones/enlaces < 44px y corre axe.
async function medir(page) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const desborde = de.scrollWidth - de.clientWidth;
    const chicos = [];
    document.querySelectorAll("button, a[href], input:not([type=hidden]), select, [role=button], [role=tab], summary").forEach((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") return;
      if (r.height < 44 || r.width < 44) chicos.push({ t: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("name") || el.tagName).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return { desborde, chicos };
  });
  let axe = [];
  try {
    const r = await new AxeBuilder({ page }).analyze();
    axe = r.violations.map((v) => ({ id: v.id, impacto: v.impact, nodos: v.nodes.length, ayuda: v.help, ej: (v.nodes[0] && v.nodes[0].target.join(" ")) || "" }));
  } catch (e) { axe = [{ id: "axe-fallo", ayuda: String(e).slice(0, 120) }]; }
  return { desborde: m.desborde, botonesChicos: m.chicos.length, chicosEj: m.chicos.slice(0, 6), axe };
}
module.exports = { abrir, medir, BASE };
