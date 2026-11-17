import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { ZONA_ARGENTINA } from "../../../src/core/tiempo/zona-horaria";
import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { cerrarConexiones } from "../../setup/gasto";
import { entrarComo, sembrarCuenta, sembrarSalon } from "../salon-fixture";
import { agregarItemsCasoDeUso } from "../../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuenta } from "../../../src/server/actions/pos/cuenta-cierre";

/**
 * CARACTERIZACIÓN (no es una regla deseada: FIJA lo que el POS hace HOY, para que un cambio futuro sea deliberado). Pedido del orquestador al construir el Frente 2
 * (`docs/diseno-precio-fuera-del-alta-2026-11-17.md` §3.A: «antes de construir se verifica el POS con un producto de venta disponible en $0»).
 *
 * Qué pasa hoy con un PV YA DISPONIBLE cuyo precio vale $0 (el de la empresa o el de la sucursal): `agregarItems` NO lo rechaza, escribe la línea con `precioUnitario` 0, y `cerrarCuenta` lo cobra a $0
 * (cuenta cerrada, venta de $0). No hay ninguna barrera de «precio 0» en el POS: lo único que impide venderlo es que no esté disponible (que es lo que hace el alta, A1).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
let cuentaId: string;

const actor = () => ({
  usuarioId: s.admin.id,
  empresaId: EMPRESA_POR_DEFECTO_ID,
  sucursalId: s.sucursalId,
  sucursalNombre: s.sucursal.nombre,
  empresaZonaHoraria: ZONA_ARGENTINA,
  ahora: new Date(),
  ...baseDeTest({ lectura: [s.sucursalId], escritura: [s.sucursalId] }),
});
const agregar = () => agregarItemsCasoDeUso(actor(), { cuentaId, items: [{ productoId: s.milanesa.id, cantidad: 1 }], promos: [] });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
});
afterEach(cerrarConexiones);

describe("CARACTERIZACIÓN del POS con un producto de venta disponible en $0", () => {
  it("precio GLOBAL en $0: agregarItems lo ACEPTA y la línea queda a $0", async () => {
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { precioVenta: 0 } });
    const r = await agregar();
    expect(r.ok, r.mensaje).toBe(true);
    const lineas = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect(lineas.map((l) => Number(l.precioUnitario))).toEqual([0]);
  });

  it("precio LOCAL de la sucursal en $0 (con el global en 9.000): agregarItems lo ACEPTA y la línea queda a $0 (gana el local)", async () => {
    await prisma.precioLocalProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, precio: "0.00", habilitado: true } });
    const r = await agregar();
    expect(r.ok, r.mensaje).toBe(true);
    const lineas = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect(lineas.map((l) => Number(l.precioUnitario))).toEqual([0]);
  });

  it("cerrar la cuenta con esa línea a $0: ACEPTA el cierre (cuenta cerrada, venta de $0)", async () => {
    await prisma.producto.update({ where: { id: s.milanesa.id }, data: { precioVenta: 0 } });
    expect((await agregar()).ok).toBe(true);
    await prisma.cuentaItem.updateMany({ where: { cuentaId }, data: { numeroEnvio: 1 } }); // «enviado a cocina»: el cierre no admite ítems sin enviar
    const r = await cerrarCuenta(cuentaId);
    expect(r.ok, r.mensaje).toBe(true);
    const cuenta = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } });
    expect(cuenta.cerradaEn, "la cuenta quedó cerrada").not.toBeNull();
  });
});
