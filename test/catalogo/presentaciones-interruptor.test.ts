import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { MENSAJE_PRESENTACIONES_APAGADAS, PRESENTACIONES_VISIBLES } from "../../src/core/catalogo/public";
import { actualizarActivaPresentacion, agregarPresentacionAlternativa, listarPresentaciones, obtenerDatosDeCompraDelProducto } from "../../src/server/actions/catalogo/productos";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarSeccion } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { nroFacturaDePrueba } from "../setup/comprobante-de-prueba";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";

/**
 * Interruptor de las PRESENTACIONES de compra (`PRESENTACIONES_VISIBLES`, `src/core/catalogo/presentaciones-visibles.ts`; decisión del dueño, 2026-11-06: «falta ocultar las presentaciones»;
 * el envase vive en el vínculo proveedor × materia prima, Q3 opción C). Fija los DOS estados:
 *  - APAGADO (el valor de hoy): el servidor rechaza crear, reactivar, activar y desactivar una presentación aunque el pedido se arme a mano; las lecturas que alimentan las pantallas
 *    (`listarPresentaciones`, `obtenerDatosDeCompraDelProducto`) no devuelven ninguna aunque exista; la pantalla del producto no ofrece su gestión (`presentaciones-interruptor-pantalla.test.tsx`). Los datos no se tocan, y una compra cuya línea
 *    ya trae el id de una presentación entra exactamente el mismo stock que con el interruptor encendido (nunca se reinterpreta en silencio una cantidad tecleada).
 *  - ENCENDIDO (reversibilidad: cargando los módulos con el interruptor en `true`): vuelve el comportamiento de antes.
 */

let unidadKgId: string;
let unidadGId: string;
let productoId: string;
let seccionId: string;
let proveedorId: string;
let admin: { id: string; email: string };

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  const catalogo = await sembrarCatalogoBase();
  unidadKgId = catalogo.kg.id;
  unidadGId = catalogo.g.id;
  admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  productoId = (await prisma.producto.create({ data: { codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId, factorConversion: 1 } })).id;
  seccionId = (await sembrarSeccion(base.sucursal.id)).id;
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
  await prisma.disponibilidadProducto.create({ data: { sucursalId: base.sucursal.id, productoId, disponible: true } });
});

/** Una presentación que ya existía (cargada antes de apagar el interruptor), escrita directo en la base. */
const sembrarPresentacion = () => prisma.presentacion.create({ data: { productoId, unidadCompraId: unidadGId, factorConversion: 20, activa: true } });

describe("presentaciones APAGADAS (decisión del dueño 2026-11-06)", () => {
  it("el interruptor está apagado", () => {
    expect(PRESENTACIONES_VISIBLES).toBe(false);
  });

  it("agregarPresentacionAlternativa se rechaza con el mensaje del interruptor y no escribe nada (ni la presentación ni su auditoría)", async () => {
    const r = await agregarPresentacionAlternativa(productoId, unidadGId, 20);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(MENSAJE_PRESENTACIONES_APAGADAS);
    expect(await prisma.presentacion.count()).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "Presentacion" } })).toBe(0);
  });

  it("actualizarActivaPresentacion se rechaza y la presentación que ya existía queda como estaba", async () => {
    const existente = await sembrarPresentacion();
    const r = await actualizarActivaPresentacion(existente.id, false);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe(MENSAJE_PRESENTACIONES_APAGADAS);
    expect((await prisma.presentacion.findUniqueOrThrow({ where: { id: existente.id } })).activa).toBe(true);
  });

  it("sin sesión o sin permiso el rechazo sigue siendo el de siempre (el interruptor va después del permiso)", async () => {
    const { getUsuarioActual } = await import("../../src/server/sesion/session");
    vi.mocked(getUsuarioActual).mockResolvedValueOnce(null);
    await expect(agregarPresentacionAlternativa(productoId, unidadGId, 20)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("las lecturas no devuelven la presentación que existe: la lista de la gestión y la unidad de la Compra por pasos quedan vacías", async () => {
    await sembrarPresentacion();
    expect(await listarPresentaciones(productoId)).toEqual([]);
    const datos = await obtenerDatosDeCompraDelProducto(productoId);
    expect(datos?.unidades.presentaciones).toEqual([]);
    expect(datos?.unidades.porDefecto.unidadCompraId).toBe(unidadKgId);
  });

  it("los datos no se tocan y una compra con una línea que ya trae la presentación entra el mismo stock que con el interruptor encendido (2 × 20 = 40 kg)", async () => {
    await sembrarPresentacion();
    const r = await registrarMovimiento({
      proceso: "COMPRA",
      nroFactura: nroFacturaDePrueba(),
      fecha: new Date(),
      seccionId,
      proveedorId,
      items: [{ productoId, cantidad: 2, unidadCompraId: unidadGId, precioTotal: 100, referenciaProveedor: REFERENCIA_DE_PRUEBA }],
      claveIdempotencia: crypto.randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId } });
    expect(Number(mov.cantidad)).toBe(40);
    expect(await prisma.presentacion.count()).toBe(1);
  });
});

describe("presentaciones ENCENDIDAS (reversibilidad: con el interruptor en true vuelve lo de antes)", () => {
  /** Carga de nuevo los módulos con el interruptor encendido (el resto del módulo, tal cual). */
  async function conInterruptorEncendido() {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/presentaciones-visibles", async (original) => ({ ...(await original<typeof import("../../src/core/catalogo/presentaciones-visibles")>()), PRESENTACIONES_VISIBLES: true }));
    const sesion = await import("../../src/server/sesion/session");
    vi.mocked(sesion.getUsuarioActual).mockResolvedValue({ id: admin.id, email: admin.email, nombre: null });
    return { acciones: await import("../../src/server/actions/catalogo/productos") };
  }
  afterEach(() => {
    vi.doUnmock("../../src/core/catalogo/presentaciones-visibles");
    vi.resetModules();
  });

  it("se puede crear, listar, desactivar y la Compra por pasos la ofrece", async () => {
    const { acciones } = await conInterruptorEncendido();
    const alta = await acciones.agregarPresentacionAlternativa(productoId, unidadGId, 20);
    expect(alta.ok, alta.mensaje).toBe(true);
    const lista = await acciones.listarPresentaciones(productoId);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ unidadCompraId: unidadGId, factorConversion: 20, activa: true });
    expect((await acciones.obtenerDatosDeCompraDelProducto(productoId))?.unidades.presentaciones).toEqual([{ unidadCompraId: unidadGId, nombre: "g", factor: 20 }]);
    expect((await acciones.actualizarActivaPresentacion(lista[0].id, false)).ok).toBe(true);
    expect((await acciones.listarPresentaciones(productoId))[0].activa).toBe(false);
  });
});
