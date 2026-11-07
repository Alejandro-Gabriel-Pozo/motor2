/**
 * MAQUETA E1 (rama temporal alegp/tmp-capturas-e1, no se mergea): «Corregir una línea» con el paso nuevo «cuántas unidades quitar». La persona (gerente, rol admin) opera el POS por las
 * pantallas reales (servidor `next start` de producción contra la base local descartable `motor2_e2e`, ver sembrar-datos-reales.ts).
 *   mesa:      Mesa 1 (SALON): 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000 → se quita 1 Cerveza → $32.000.
 *   mostrador: puesto 0: 1 Capuccino ($8.000) + 1 Flan casero ($9.000) = $17.000 → líneas de 1 unidad: se corrige la línea entera (el Flan) → $8.000.
 * Uso: tsx caso-quitar-unidades.ts mesa | mostrador
 */
import { abrir, foto, toques } from "./comun";

type Puesto = "mesa" | "mostrador";
const CONFIG = {
  mesa: { prefijo: "e1-mesa", items: [["Cerveza Patagonia", "2"], ["Brownie", "1"], ["Café", "2"]] as Array<[string, string]> },
  mostrador: { prefijo: "e1-mostrador", items: [["Capuccino", "1"], ["Flan casero", "1"]] as Array<[string, string]> },
};

(async () => {
  const puesto = (process.argv[2] as Puesto) ?? "mesa";
  const c = CONFIG[puesto];
  const { navegador, page } = await abrir(375);
  const clic = async (destino: ReturnType<typeof page.getByRole>) => {
    toques.clics += 1;
    await destino.click();
  };
  const aviso = page.locator('[role="status"][aria-live="polite"]');

  // 1) Entrar al puesto y cargar el pedido (esto NO cuenta como pasos de la corrección)
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
  await page.waitForTimeout(300);

  // 2) ANTES
  await foto(page, `${c.prefijo}-1-antes-cuenta-cerrada`);

  // 3) Corregir una línea (desde acá se cuentan los toques de la corrección)
  toques.clics = 0;
  toques.campos = 0;
  await clic(page.getByRole("button", { name: /^Corregir una línea/ }));
  const dialogo = page.getByRole("dialog", { name: /Corregir una línea/ });
  await dialogo.waitFor();
  await foto(page, `${c.prefijo}-2-dialogo-elegir-linea`);

  const linea = puesto === "mesa" ? "Cerveza Patagonia" : "Flan casero";
  await clic(dialogo.locator("label", { hasText: linea }).first());
  await page.waitForTimeout(200);
  await foto(page, `${c.prefijo}-3-linea-elegida`);

  if (puesto === "mesa") {
    // el stepper arranca en 1: «Queda 1 × Cerveza Patagonia ($14.000)» y total corregido $32.000
    await dialogo.getByText("Queda").waitFor();
    await foto(page, `${c.prefijo}-4-quitando-1-unidad`);
  }
  const motivo = puesto === "mesa" ? "La mesa tomó una sola cerveza" : "El flan salió frío y no se cobró";
  await dialogo.getByLabel("Motivo (obligatorio)").fill(motivo);
  toques.campos += 1;
  await foto(page, `${c.prefijo}-5-con-motivo`);
  await clic(dialogo.getByRole("button", { name: "Corregir e imprimir" }));
  await page.getByText(/Ticket N\.º .* emitida/).first().waitFor().catch(() => undefined);
  await page.waitForLoadState("networkidle");
  await foto(page, `${c.prefijo}-6-despues-aviso`);

  // 4) DESPUÉS (recargado) y el reporte
  await page.goto(urlPuesto);
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-7-despues-recargado`);
  await page.goto("http://localhost:3300/reportes/tickets");
  await page.locator("details").first().locator("summary").click();
  await foto(page, `${c.prefijo}-8-reporte-tickets`);
  console.log(`[toques de la corrección] ${puesto}: ${JSON.stringify(toques)}`);
  await navegador.close();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
