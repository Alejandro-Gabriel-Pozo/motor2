/**
 * MAQUETA (rama temporal alegp/tmp-capturas-poda-genero, no se mergea): capturas a 375 px de las pantallas REALES, con el prefijo que se pasa (antes|despues).
 * Uso: tsx capturar.ts antes|despues  (con el servidor en el puerto 3300 y la carta sembrada).
 */
import { abrir, foto, URL_BASE } from "./comun";

(async () => {
  const prefijo = process.argv[2];
  const { navegador, page } = await abrir(375);
  await page.goto(`${URL_BASE}/carta`);
  await foto(page, `${prefijo}-1-carta-admin-hoy`);
  await page.goto(`${URL_BASE}/carta/parametrizacion/secciones`);
  await foto(page, `${prefijo}-2-carta-admin-secciones`);
  await page.goto(`${URL_BASE}/mesas/mostrador`);
  // Si la cuenta del mostrador ya estaba abierta (corrida anterior), se sigue con ella.
  await page.getByRole("button", { name: "Nueva cuenta" }).click({ timeout: 5_000 }).catch(() => undefined);
  await page.getByRole("group", { name: "Secciones de la carta" }).waitFor();
  await foto(page, `${prefijo}-3-pos-selector-cafeteria`);
  await page.getByRole("group", { name: "Secciones de la carta" }).getByRole("button", { name: /Bebidas/ }).click();
  await foto(page, `${prefijo}-4-pos-selector-bebidas`);
  await page.goto(`${URL_BASE}/carta-publica/${process.env.EMPRESA_SLUG ?? "e2e"}/varvarco`);
  await foto(page, `${prefijo}-5-carta-publica`);
  for (const ruta of ["/carta/agrupados", "/carta/parametrizacion/generos"]) {
    const r = await page.goto(`${URL_BASE}${ruta}`);
    console.log(`[estado] ${ruta} → ${r?.status()}`);
  }
  await navegador.close();
})();
