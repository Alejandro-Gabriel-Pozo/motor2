import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { DIA_MS } from "../setup/tiempo";
import { ZONA_ARGENTINA, diaDeCalendario, mediodiaDelDia, sumarDias } from "../../src/core/tiempo/zona-horaria";

/**
 * P1, paso 2: un formulario que pide «el día» de una operación guarda el MEDIODÍA ARGENTINO de ese día (`mediodiaDelDia(día, ZONA_ARGENTINA)`, 15:00 UTC), no las 00:00 UTC de `new Date("AAAA-MM-DD")`
 * (que en hora argentina es el día anterior a las 21:00). Los specs de unidad prueban `mediodiaDelDia`, pero ninguno ve a un formulario real: revertir uno de los cinco a `new Date(fecha)` los dejaba a todos
 * en verde. Acá se carga una Merma, una Compra y un Pago a consignante DESDE LA PANTALLA con un día pasado, y se compara contra la base el instante exacto que quedó guardado.
 *
 * Sin reloj fijo: el servidor valida la fecha con el reloj real (no más de 400 días atrás ni más allá de mañana), así que el día es el de hace 5 días calculado en hora argentina con el reloj real
 * (nunca se vuelve falso con el tiempo, y no depende de la zona en que corra el CI). Va dos veces, con el navegador en Buenos Aires y en Tokio: el resultado no tiene que depender de la zona
 * del navegador (el formulario manda un instante calculado con la constante argentina, no con `new Date()` del navegador).
 *
 * Los nombres llevan marca (`Date.now()`): varios specs comparten la base E2E en una corrida.
 */
const DIA = diaDeCalendario(new Date(Date.now() - 5 * DIA_MS), ZONA_ARGENTINA);
const INSTANTE_ESPERADO = mediodiaDelDia(DIA, ZONA_ARGENTINA).toISOString();

const sembrarProducto = async (sucursalId: string, prefijo: string) => {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-${prefijo}-${marca}`, nombre: `E2E ${prefijo} Harina ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  return { marca, producto };
};

for (const zona of ["America/Argentina/Buenos_Aires", "Asia/Tokyo"]) {
  test.describe(`con el navegador en ${zona}`, () => {
    test.use({ timezoneId: zona });

    test("Merma: el día elegido queda guardado como el mediodía argentino de ese día", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
      const { producto } = await sembrarProducto(sucursalId, "MER");
      const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
      // Stock para poder mermar: una compra vieja cargada directo en la base (no es lo que se prueba).
      const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(Date.now() - 30 * DIA_MS), usuarioId: admin.id } });
      await prisma.movimientoStock.create({
        data: { operacionId: compra.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
      });

      await page.goto("/movimientos/merma");
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "el navegador tiene que estar en la zona del caso").toBe(zona);

      await page.getByLabel("Fecha", { exact: true }).fill(DIA);
      await page.getByRole("combobox", { name: "Sección", exact: true }).selectOption({ label: seccion.nombre });
      await page.locator('input[placeholder="Código o nombre…"]').first().fill(producto.nombre);
      await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
      await page.getByLabel("Cantidad").fill("1");
      await page.getByRole("combobox", { name: "Motivo", exact: true }).selectOption({ index: 1 });
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();

      await expect(page.getByText(/Se guardaron 1 movimiento/)).toBeVisible();
      const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, proceso: "MERMA" }, include: { operacion: true } });
      expect(movimiento.operacion.fecha.toISOString()).toBe(INSTANTE_ESPERADO);
    });

    test("Compra: el día elegido queda guardado como el mediodía argentino de ese día", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
      const { producto } = await sembrarProducto(sucursalId, "COM");
      const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });

      await page.goto("/movimientos/compra");
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "el navegador tiene que estar en la zona del caso").toBe(zona);

      await page.getByLabel("Fecha", { exact: true }).fill(DIA);
      await page.getByRole("combobox", { name: "Sección", exact: true }).selectOption({ label: seccion.nombre });
      await page.locator('input[placeholder="Código o nombre…"]').first().fill(producto.nombre);
      await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
      await page.locator("label:has-text('Cantidad') input").first().fill("10");
      await page.locator("label:has-text('Precio total') input").first().fill("1000");
      await page.getByRole("button", { name: "Confirmar", exact: true }).click();

      await expect(page.getByText(/Se guardaron 1 movimiento/)).toBeVisible();
      const movimiento = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: producto.id, proceso: "COMPRA" }, include: { operacion: true } });
      expect(movimiento.operacion.fecha.toISOString()).toBe(INSTANTE_ESPERADO);
    });

    test("Pago a consignante: el día elegido queda guardado como el mediodía argentino y la pantalla lo muestra en el período de ese día", async ({ paginaAutenticada: page, sucursalId }) => {
      const marca = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
      const consignante = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_FDE_${marca}`, nombre: `E2E Consignante Día ${marca}` } });
      // Un pago viejo (fuera del día de la prueba) para que el consignante aparezca en la tabla y tenga su botón «Registrar pago».
      await prisma.pagoConsignante.create({ data: { sucursalId, proveedorId: consignante.id, importe: 1, fecha: new Date(Date.now() - 30 * DIA_MS), usuarioId: admin.id } });

      await page.goto("/reportes/consignacion");
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "el navegador tiene que estar en la zona del caso").toBe(zona);

      await page.getByRole("row", { name: new RegExp(consignante.nombre) }).getByRole("button", { name: "Registrar pago", exact: true }).click();
      const dialogo = page.getByRole("dialog");
      await dialogo.getByLabel(/^Importe/).fill("137");
      await dialogo.getByLabel("Fecha", { exact: true }).fill(DIA);
      await dialogo.getByRole("button", { name: "Registrar pago", exact: true }).click();
      await expect(dialogo).toBeHidden();

      const pago = await prisma.pagoConsignante.findFirstOrThrow({ where: { proveedorId: consignante.id, importe: 137 } });
      expect(pago.fecha.toISOString()).toBe(INSTANTE_ESPERADO);

      // Y la pantalla de Consignación, con el período D..D, lo cuenta (cierra el último día en la zona de la empresa): Pagado $137, no $0 ni la fila ausente.
      await page.goto(`/reportes/consignacion?desde=${DIA}&hasta=${DIA}`);
      await expect(page.getByRole("row", { name: new RegExp(`${consignante.nombre}\\s+\\$0\\s+\\$137\\b`) })).toBeVisible();
      // El día anterior no lo incluye: el consignante ni aparece en ese período.
      await page.goto(`/reportes/consignacion?desde=${sumarDias(DIA, -1)}&hasta=${sumarDias(DIA, -1)}`);
      await expect(page.getByRole("row", { name: new RegExp(consignante.nombre) })).toHaveCount(0);
    });
  });
}
