import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, type DatosProductoEdicion } from "../../src/server/actions/catalogo/productos";
import type { ResultadoConSincronizable } from "../../src/server/actions/tipos";

/**
 * Edición del producto con control del VALOR VISTO del precio de venta (ola «precio y carta», Fase 2, paso A4), por la Server Action pública y contra Postgres real. Con la clave fina el formulario
 * manda SIEMPRE el precio de venta: antes, quien editaba solo el nombre con la pantalla abierta desde antes devolvía el precio a su valor viejo en silencio, y dos administradores guardando a la vez se
 * pisaban. Ahora, si el precio cambia, el que mostraba el formulario (`precioVentaVisto`) tiene que ser el guardado, dentro de una transacción SERIALIZABLE.
 */
const ITERACIONES = 8;

describe("precio de venta del producto: control del valor visto (A4)", () => {
  let unidadId: string;
  let sucursalId: string;
  let n = 0;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
  });

  const producto = async (nombre: string, precioVenta = 100) => (await sembrarProductoDisponible({ codigo: `PV_PDV_${n++}`, nombre, tipo: "PV", precioVenta, unidadStockId: unidadId }, sucursalId)).id;
  const formulario = (nombre: string, precioVenta: number, precioVentaVisto?: number): DatosProductoEdicion => ({
    nombre,
    tipo: "PV",
    unidadStockId: unidadId,
    factorConversion: 1,
    precioVenta,
    ...(precioVentaVisto !== undefined && { precioVentaVisto }),
  });
  const guardado = async (id: string) => {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id } });
    return { nombre: p.nombre, precioVenta: Number(p.precioVenta) };
  };
  const auditoriasDePrecio = (id: string) => prisma.registroAuditoria.count({ where: { entidad: "Producto", entidadId: id, campo: "precioVenta" } });
  const codigo = (r: PromiseSettledResult<ResultadoConSincronizable>) =>
    r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : r.value.mensaje.includes("mientras lo editabas") ? "PRECIO_DESACTUALIZADO" : r.value.mensaje;

  it(`concurrencia (${ITERACIONES} vueltas): dos administradores con el precio visto 100 guardan 120 y 130 a la vez → uno gana, el otro PRECIO_DESACTUALIZADO, UNA auditoría del precio`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Fainá ${i}`;
      const id = await producto(nombre);
      const res = await Promise.allSettled([actualizarProducto(id, formulario(nombre, 120, 100)), actualizarProducto(id, formulario(nombre, 130, 100))]);
      expect(res.map(codigo).sort(), `vuelta ${i}`).toEqual(["PRECIO_DESACTUALIZADO", "ok"]);
      const gano = res.findIndex((r) => r.status === "fulfilled" && r.value.ok);
      expect((await guardado(id)).precioVenta, `vuelta ${i}`).toBe(gano === 0 ? 120 : 130);
      expect(await auditoriasDePrecio(id), `vuelta ${i}`).toBe(1);
    }
  });

  it("EL DEFECTO: quien edita solo el nombre con el formulario abierto desde antes (manda el precio viejo) ya no lo devuelve a su valor viejo: se rechaza y no se guarda nada", async () => {
    const id = await producto("Pizza");
    expect((await actualizarProducto(id, formulario("Pizza", 120, 100))).ok).toBe(true); // A sube el precio
    expect(await actualizarProducto(id, formulario("Pizza grande", 100, 100))).toEqual({
      ok: false,
      mensaje: "Alguien cambió el precio de venta de «Pizza» mientras lo editabas (ahora es $120): no se guardó nada. Recargá la pantalla y volvé a hacer el cambio.",
    });
    expect([await guardado(id), await auditoriasDePrecio(id)]).toEqual([{ nombre: "Pizza", precioVenta: 120 }, 1]);
  });

  it("IDEMPOTENTE: el mismo guardado dos veces → ok, ok; un solo cambio y una sola auditoría del precio", async () => {
    const id = await producto("Empanada");
    expect(await actualizarProducto(id, formulario("Empanada", 150.5, 100))).toMatchObject({ ok: true, mensaje: 'Producto "Empanada" actualizado.' });
    expect(await actualizarProducto(id, formulario("Empanada", 150.5, 100))).toMatchObject({ ok: true, mensaje: 'Producto "Empanada" actualizado.' });
    expect([await guardado(id), await auditoriasDePrecio(id)]).toEqual([{ nombre: "Empanada", precioVenta: 150.5 }, 1]);
  });

  it(`concurrencia (${ITERACIONES} vueltas): el MISMO guardado dos veces a la vez → dos ok y una sola auditoría del precio`, async () => {
    for (let i = 0; i < ITERACIONES; i++) {
      const nombre = `Flan ${i}`;
      const id = await producto(nombre);
      const res = await Promise.allSettled([actualizarProducto(id, formulario(nombre, 120, 100)), actualizarProducto(id, formulario(nombre, 120, 100))]);
      expect(res.map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
      expect([(await guardado(id)).precioVenta, await auditoriasDePrecio(id)], `vuelta ${i}`).toEqual([120, 1]);
    }
  });

  it("falla cerrado: cambiar el precio sin mandar el visto se rechaza; sin cambiar el precio, el visto no hace falta (ni se mira)", async () => {
    const id = await producto("Tarta");
    expect(await actualizarProducto(id, formulario("Tarta", 200))).toMatchObject({ ok: false, mensaje: expect.stringContaining("(ahora es $100)") });
    expect(await actualizarProducto(id, formulario("Tarta", 200, Number.NaN))).toMatchObject({ ok: false, mensaje: expect.stringContaining("mientras lo editabas") });
    expect(await actualizarProducto(id, { ...formulario("Tarta", 200), precioVentaVisto: "100" as unknown as number })).toMatchObject({ ok: false });
    expect(await guardado(id)).toEqual({ nombre: "Tarta", precioVenta: 100 });
    expect(await actualizarProducto(id, formulario("Tarta de jamón", 100))).toMatchObject({ ok: true });
    expect(await actualizarProducto(id, formulario("Tarta de jamón y queso", 100, 55))).toMatchObject({ ok: true }); // el precio no cambia: el visto viejo no importa
    expect([await guardado(id), await auditoriasDePrecio(id)]).toEqual([{ nombre: "Tarta de jamón y queso", precioVenta: 100 }, 0]);
  });

  it("el visto se compara al centavo", async () => {
    const id = await producto("Medialuna", 3500.5);
    expect(await actualizarProducto(id, formulario("Medialuna", 3600, 3500.5))).toMatchObject({ ok: true });
    expect(await actualizarProducto(id, formulario("Medialuna", 3700, 3600.01))).toMatchObject({ ok: false });
    expect((await guardado(id)).precioVenta).toBe(3600);
  });
});
