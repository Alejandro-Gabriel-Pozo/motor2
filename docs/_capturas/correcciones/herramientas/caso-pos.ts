/**
 * CASOS 1 y 2: la persona (gerente, rol admin) opera el POS por las pantallas reales. Mesa 1 (SALON): 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000.
 * Mostrador (puesto 0): 1 Capuccino + 1 Flan casero = $17.000. Se cierra la cuenta (ticket N.º ejemplar A), se anula UNA línea ya vendida desde Trazabilidad
 * (Brownie / Flan casero: la única forma de que el ticket quede «desactualizado») y se emite el ticket corregido con motivo (ejemplar B que corrige al A).
 *
 * Uso: tsx caso-pos.ts mesa | mostrador
 */
import { abrir, foto, toques } from "./comun";

type Puesto = "mesa" | "mostrador";
let depuracion: import("playwright").Page | undefined;

const CONFIG = {
  mesa: {
    prefijo: "20-mesa",
    items: [["Cerveza Patagonia", "2"], ["Brownie", "1"], ["Café", "2"]] as Array<[string, string]>,
    anular: "Brownie",
    motivo: "El cliente devolvió el brownie",
  },
  mostrador: {
    prefijo: "30-mostrador",
    items: [["Capuccino", "1"], ["Flan casero", "1"]] as Array<[string, string]>,
    anular: "Flan casero",
    motivo: "El flan salió frío y no se cobró",
  },
};

(async () => {
  const puesto = (process.argv[2] as Puesto) ?? "mesa";
  // «solo-cerrar»: deja un ticket más SIN corregir (para la maqueta de «Corregir un ticket»); las capturas van a archivos descartables.
  const soloCerrar = process.argv[3] === "solo-cerrar";
  const c = soloCerrar ? { ...CONFIG[puesto], prefijo: `zz-descartar-${puesto}`, items: puesto === "mesa" ? CONFIG.mesa.items : ([["Capuccino", "2"], ["Flan casero", "1"]] as Array<[string, string]>) } : CONFIG[puesto];
  const { navegador, page } = await abrir(375);
  depuracion = page;
  process.on('unhandledRejection', () => undefined);
  const clic = async (destino: ReturnType<typeof page.getByRole>) => {
    toques.clics += 1;
    await destino.click();
  };
  const aviso = page.locator('[role="status"][aria-live="polite"]');

  // 1) Entrar al puesto
  if (puesto === "mesa") {
    await page.goto("http://localhost:3300/mesas");
    await clic(page.locator('li[data-mesa="1"]').getByRole("link", { name: "Tomar pedido" }));
    await page.waitForURL(/\/mesas\/(?!mostrador)[a-z0-9]+$/);
    await page.locator("main h1").filter({ hasText: /Mesa 0?1/ }).waitFor();
    await page.getByRole("button", { name: "Abrir cuenta" }).click();
    toques.clics += 1;
    const dialogo = page.getByRole("dialog", { name: "¿Cuántos comensales?" });
    await clic(dialogo.getByRole("button", { name: "2", exact: true }));
    await clic(dialogo.getByRole("button", { name: "Confirmar apertura" }));
  } else {
    await page.goto("http://localhost:3300/mesas/mostrador");
    await clic(page.getByRole("button", { name: "Nueva cuenta" }));
  }
  await page.getByRole("combobox", { name: "Producto" }).waitFor();
  const urlPuesto = page.url();

  // 2) Cargar el pedido, un producto por vez (pantalla real «Por agregar»)
  let agregados = 0;
  for (const [nombre, cantidad] of c.items) {
    await page.getByRole("combobox", { name: "Producto" }).fill(nombre);
    toques.campos += 1;
    await clic(page.getByRole("option", { name: new RegExp(nombre) }).first());
    if (cantidad !== "1") {
      await page.getByLabel(`Cantidad de ${nombre}`, { exact: true }).fill(cantidad);
      toques.campos += 1;
    }
    await clic(page.getByRole("button", { name: /^Agregar \d+ al pedido$/ }));
    await aviso.waitFor();
    agregados += 1;
    await page.getByRole("heading", { name: `Sin enviar · ${agregados}` }).waitFor();
  }
  await clic(page.getByRole("button", { name: "Enviar a cocina" }));
  await page.getByRole("heading", { name: /Envío 1/ }).waitFor();
  await foto(page, `${c.prefijo}-0-pedido-enviado`);

  // 3) Cerrar la cuenta: registra la venta y emite el ticket N.º …-A
  await clic(page.getByRole("button", { name: "Cerrar cuenta" }));
  const cierre = page.getByRole("dialog", { name: /^Cerrar cuenta/ });
  await foto(page, `${c.prefijo}-1-cerrar-cuenta`);
  await clic(cierre.getByRole("button", { name: "Cerrar y registrar la venta" }));
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-2-antes-cuenta-cerrada`);
  if (soloCerrar) {
    await navegador.close();
    return;
  }

  // 4) Anular UNA línea ya vendida (Reportes → Tickets → abrir el ticket → «Trazabilidad» de la línea → Anular venta)
  await page.goto("http://localhost:3300/reportes/tickets");
  const ticket = page.locator("details").first();
  await clic(ticket.locator("summary"));
  await foto(page, `${c.prefijo}-3-reporte-tickets-antes`);
  await clic(ticket.locator("tr", { hasText: c.anular }).getByRole("link", { name: "Trazabilidad" }));
  await page.getByRole("button", { name: "Anular venta" }).waitFor();
  await foto(page, `${c.prefijo}-4-trazabilidad-anular-venta`);
  await clic(page.getByRole("button", { name: "Anular venta" }));
  await clic(page.getByRole("button", { name: "Sí, anular" }));
  await page.getByText(/anulada|anuló/i).first().waitFor();

  // 5) Volver al puesto: «Cuentas cerradas» ahora dice que el ticket quedó desactualizado
  await page.goto(urlPuesto);
  toques.clics += 1; // volver al puesto (tocar su tarjeta)
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-5-ticket-desactualizado`);

  // 6) Emitir el ticket corregido, con motivo
  await clic(page.getByRole("button", { name: /^Emitir el ticket corregido/ }));
  const emitir = page.getByRole("dialog", { name: /Emitir ticket corregido/ });
  await foto(page, `${c.prefijo}-6-emitir-dialogo`);
  await clic(emitir.getByRole("button", { name: "Emitir e imprimir" }));
  await emitir.getByRole("alert").waitFor();
  await foto(page, `${c.prefijo}-7-emitir-sin-motivo`);
  await emitir.getByLabel("Motivo (obligatorio)").fill(c.motivo);
  toques.campos += 1;
  await clic(emitir.getByRole("button", { name: "Emitir e imprimir" }));
  await page.getByText(/Ticket N\.º .* emitida/).first().waitFor().catch(() => undefined);
  await page.waitForLoadState("networkidle");
  await foto(page, `${c.prefijo}-8-despues-ticket-corregido`);
  await page.reload();
  await page.getByRole("heading", { name: "Cuentas cerradas" }).waitFor();
  await foto(page, `${c.prefijo}-8b-despues-recargado`);

  // 7) El reporte de tickets: ahora hay dos ejemplares del mismo número
  await page.goto("http://localhost:3300/reportes/tickets");
  await page.locator("details").first().locator("summary").click();
  await foto(page, `${c.prefijo}-9-reporte-tickets`);
  console.log(`[toques] ${puesto} (solo pasos de la corrección, sin contar la carga del pedido): ver informe; totales corridos: ${JSON.stringify(toques)}`);
  await navegador.close();
})().catch(async (e) => {
  console.error(e);
  await depuracion?.screenshot({ path: "/tmp/claude-0/explor/fallo-pos.png", fullPage: true }).catch(() => undefined);
  process.exit(1);
});
