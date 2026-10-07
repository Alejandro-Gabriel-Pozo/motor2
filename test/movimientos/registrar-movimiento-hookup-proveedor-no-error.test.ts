import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// `upsertProveedorPorProducto` es REAL salvo cuando un test le pide fallar: así se prueba que un fallo del vínculo proveedor↔producto tira abajo la compra ENTERA
// (decisión del dueño, 2026-10-06; antes era «best-effort» fuera de la transacción) y que el reintento con la misma clave escribe las dos cosas.
vi.mock("../../src/server/persistencia/catalogo/upsert-proveedor-por-producto", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/persistencia/catalogo/upsert-proveedor-por-producto")>();
  return { upsertProveedorPorProducto: vi.fn(real.upsertProveedorPorProducto) };
});

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, sembrarMotivosYDestinos, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { upsertProveedorPorProducto } from "../../src/server/persistencia/catalogo/upsert-proveedor-por-producto";
import { calcularSaldoTotal } from "../../src/server/lecturas/movimientos/saldos";

/**
 * El vínculo proveedor↔producto de una Compra va DENTRO de la transacción (Pureza Fase 4; investigación del 2026-10-06, `para motor 2\_planes\investigacion-vinculo-proveedor-
 * producto-2026-10-06.md`). Si falla —sea con una excepción real o con un valor que NO es un Error, como `null`—, la compra entera se revierte: ni Kardex, ni Operación, ni vínculo;
 * nada queda a medias. Con la MISMA clave de idempotencia el reintento escribe todo, una sola vez.
 */
describe("registrarMovimiento (Compra): el vínculo proveedor↔producto es parte de la transacción", () => {
  let sucursalId: string;
  let seccionAId: string;
  let unidadKgId: string;
  let productoId: string;
  let proveedorId: string;

  beforeEach(async () => {
    vi.mocked(upsertProveedorPorProducto).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    unidadKgId = catalogo.kg.id;
    await sembrarMotivosYDestinos();
    seccionAId = (await sembrarSeccion(sucursalId, "Depósito A")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    productoId = (await sembrarProductoDisponible({ codigo: "MP_HARINA_HOOKUP", nombre: "Harina", tipo: "MP", unidadStockId: unidadKgId, unidadCompraId: unidadKgId }, sucursalId)).id;
    proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_HOOKUP", nombre: "Distribuidora Hookup" } })).id;
  });

  const comprar = (claveIdempotencia?: string) =>
    registrarMovimiento({ proceso: "COMPRA", fecha: new Date("2026-09-20"), seccionId: seccionAId, proveedorId, claveIdempotencia, items: [{ productoId, cantidad: 10, precioTotal: 1000 }] });

  const estado = async () => ({
    saldo: await calcularSaldoTotal(productoId, seccionAId, prisma),
    operaciones: await prisma.operacion.count({ where: { proceso: "COMPRA" } }),
    vinculos: await prisma.proveedorPorProducto.count({ where: { productoId } }),
  });

  it.each([
    ["una excepción real", () => new Error("falla el vínculo")],
    ["un valor que NO es un Error (null)", () => null],
  ])("si el vínculo falla con %s, la compra entera se revierte (ni Kardex, ni Operación, ni vínculo)", async (_nombre, causa) => {
    vi.mocked(upsertProveedorPorProducto).mockRejectedValueOnce(causa());

    await comprar().then(
      (r) => expect(r.ok, "la compra no puede salir ok si el vínculo falló").toBe(false),
      () => undefined // si la acción lanza, también es una falla visible: lo que importa es que no quede nada escrito
    );

    expect(await estado()).toEqual({ saldo: 0, operaciones: 0, vinculos: 0 });
  });

  it("el reintento con la MISMA clave de idempotencia escribe las dos cosas, una sola vez", async () => {
    const clave = randomUUID();
    vi.mocked(upsertProveedorPorProducto).mockRejectedValueOnce(new Error("falla el vínculo"));
    await comprar(clave).catch(() => undefined);
    expect(await estado()).toEqual({ saldo: 0, operaciones: 0, vinculos: 0 });

    const reintento = await comprar(clave);
    expect(reintento.ok).toBe(true);
    expect(await estado()).toEqual({ saldo: 10, operaciones: 1, vinculos: 1 });

    // Un tercer envío exacto es un duplicado: devuelve lo guardado y no vuelve a escribir nada.
    const duplicado = await comprar(clave);
    expect(duplicado.ok).toBe(true);
    expect(await estado()).toEqual({ saldo: 10, operaciones: 1, vinculos: 1 });
  });

  it("sin fallos, la compra escribe el Kardex y el vínculo juntos (y el vínculo usa la fecha de la compra)", async () => {
    expect((await comprar()).ok).toBe(true);
    expect(await estado()).toEqual({ saldo: 10, operaciones: 1, vinculos: 1 });
    const vinculo = await prisma.proveedorPorProducto.findFirstOrThrow({ where: { productoId } });
    expect(vinculo.ultimaCompra.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(Number(vinculo.precioPorUnidadStock)).toBe(100);
  });
});
