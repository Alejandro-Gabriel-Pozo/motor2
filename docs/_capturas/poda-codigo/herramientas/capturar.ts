/** MAQUETA (rama temporal alegp/tmp-capturas-poda-codigo, no se mergea): captura la pantalla REAL «Perfil de la empresa» a 375 px. Uso: tsx capturar.ts <puerto> <nombre-de-archivo> */
import { chromium } from "playwright";
import path from "node:path";

async function main() {
  const [puerto, nombre] = process.argv.slice(2);
  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  await contexto.addCookies([{ name: "authjs.session-token", value: "maqueta-sesion-gerente", domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  await page.goto(`http://localhost:${puerto}/administracion/empresa`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.resolve(__dirname, "..", `${nombre}.png`), fullPage: true });
  console.log(await page.locator("dl").innerText().catch(() => "(sin dl: " + page.url() + ")"));
  await navegador.close();
}
main();
