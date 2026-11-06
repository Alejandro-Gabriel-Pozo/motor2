/**
 * MAQUETA E0 (rama temporal alegp/tmp-capturas-e0, no se mergea): «Corregir una línea» de una cuenta cerrada, por la pantalla REAL (PR2 de E0).
 * Mesa 1 (SALÓN): 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000, se corrige el Brownie ENTERO → $36.000.
 * Mostrador (puesto 0): 1 Capuccino + 1 Flan casero = $17.000, se corrige el Flan → $8.000.
 * Cuenta los toques de la corrección (desde la fila de «Cuentas cerradas» hasta el ticket corregido).
 *
 * Uso: tsx caso-corregir-linea.ts mesa | mostrador
 */
import { abrir, foto } from "./comun";

type Puesto = "mesa" | "mostrador";
const CONFIG = {
  mesa: { prefijo: "50-mesa", items: [["Cerveza Patagonia", "2"], ["Brownie", "1"], ["Café", "2"]] as Array<[string, string]>, linea: "Brownie", motivo: "El cliente devolvió el brownie" },
  mostrador: { prefijo: "60-mostrador", items: [["Capuccino", "1"], ["Flan casero", "1"]] as Array<[string, string]>, linea: "Flan casero", motivo: "El flan salió frío y no se cobró" },
};

(async () => {
  const puesto = (process.argv[2] as Puesto) ?? "mesa";
  const c = CONFIG[puesto];
  const { navegador, page } = await abrir(375);
  const aviso = page.locator('[role="status"][aria-live="polite"]');
  let toques = 0;
  let campos = 0;

  // 1) Entrar al puesto, cargar el pedido y cerrar la cuenta (mismo recorrido de siempre; no cuenta como corrección)
  if (puesto === "mesa") {
    await page.goto("http://localhost:3300/mesas");
    await page.locator('li[data-mesa="1"]').getByRole("link", { name: "Tomar pedido" }).click();
    await page.waitForURL(/\/mesas\/(?!mostrador)[a-z0-9]+$/);
    await page.locator("main h1").filter({ hasText: /Mesa 0?1/ }).waitFor();
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await dialogo.getByRole("button", { name: "2", exact: true }).click();
    await dialogo.getByRole("button", { name: "Confirmar apertura" }).click();
  } else {
    await page.goto("http://localhost:3300/mesas/mostrador");
    await page.getByRole("button", { name: "Nueva cuenta" }).click();
  }
  await page.getByRole("combobox", { name: "Producto" }).waitFor();
  const urlPuesto = page.url();
  let agregados = 0;
  for (const [nombre, cantidad] of c.items) {
    await page.getByRole("combobox", { name: "Producto" }).fill(nombre);
    await page.getByRole("option", { name: new RegExp(nombre) }).first().click();
    if (cantidad !== "1") await page.getByLabel(`Cantidad de ${nombre}`, { exact: true }).fill(cantidad);
    await page.getByRole("button", { name: /^Agregar \d+ al pedido$/ }).click();
    await aviso.waitFor();
    agregados += 1;
    await page.getByRole("heading", { name: `Sin enviar · ${agregados}` }).waitFor();
  }
  await page.getByRole("button", { name: "Enviar a cocina" }).click();
  await page.getByRole("heading", { name: /Envío 1/ }).waitFor();
  await page.getByRole("button", { name: "Cerrar cuenta" }).click();
  await page.getByRole("dialog", { name: /^Cerrar cuenta/ }).getByRole("button", { name: "Cerrar y registrar la venta" }).click();
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-0-antes-cuenta-cerrada`);

  // 2) LA CORRECCIÓN: un botón, un diálogo (elegir la línea + motivo) y un botón
  toques += 1;
  await page.getByRole("button", { name: /^Corregir una línea/ }).click();
  const dialogo = page.getByRole("dialog", { name: /Corregir una línea/ });
  await dialogo.waitFor();
  await foto(page, `${c.prefijo}-1-dialogo-abierto`);
  toques += 1;
  await dialogo.locator("label", { hasText: c.linea }).click(); // la persona toca la tarjeta entera
  await foto(page, `${c.prefijo}-2-linea-elegida`);
  campos += 1;
  await dialogo.getByLabel("Motivo (obligatorio)").fill(c.motivo);
  await foto(page, `${c.prefijo}-3-motivo-escrito`);
  toques += 1;
  await dialogo.getByRole("button", { name: "Corregir e imprimir" }).click();
  await page.getByText(/Ticket N\.º .* emitida/).first().waitFor();
  // (e) SIN recargar: se mide cuánto tarda la fila de la cuenta en mostrar el ejemplar B y el total nuevo
  const t0 = Date.now();
  const fila = page.locator("[data-cuenta-cerrada]").first();
  await fila.getByText(/N\.º \d+-B/).waitFor();
  console.log(`[refresco] la fila mostró el ejemplar B ${Date.now() - t0} ms después del aviso, sin recargar`);
  await page.waitForLoadState("networkidle");
  await foto(page, `${c.prefijo}-4-despues-sin-recargar`);
  console.log(`[fila sin recargar] ${(await fila.innerText()).replace(/\s+/g, " ")}`);
  await page.goto(urlPuesto);
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-5-despues-recargado`);

  // 3) Trazabilidad: el reporte de tickets, con el motivo
  await page.goto("http://localhost:3300/reportes/tickets");
  await page.locator("details").first().locator("summary").click();
  await foto(page, `${c.prefijo}-6-reporte-tickets`);
  console.log(`[toques] ${puesto}: ${toques} toques + ${campos} campo de texto (motivo), en UNA pantalla`);
  await navegador.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
