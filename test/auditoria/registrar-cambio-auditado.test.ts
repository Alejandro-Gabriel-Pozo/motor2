import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { type CambioAuditable } from "../../src/core/permisos/auditoria";
import { registrarCambioAuditado } from "../../src/server/auditoria/registrar-cambio-auditado";

/**
 * Red del ESCRITOR de la auditoría (Hito 5, pieza 5.4, B1 de `docs/plan-hito-5-pureza.md`; B5 de `docs/pureza-integracion.md`). SIN base: una `db` falsa captura la única escritura
 * (`registroAuditoria.create`) y el test fija, con `toStrictEqual`, los 8 campos de la fila y cómo se pasa cada valor a texto. Se escribió ANTES de mudar el escritor a
 * `server/auditoria/` (B3) y de sacarle lo puro (B4): una mudanza o una partición que cambie un valor, el «no cambió» o el `null` del `sucursalId` lo ve en rojo.
 *
 * Lo que fija, y por qué importa: la auditoría es sensible (quién cambió qué y cuándo) y su fila tiene que ser la misma de siempre.
 *  - `null` y `undefined` son «sin valor» (se guardan como `null`) y NO se confunden con `0`, `false` ni `""`, que son valores y se guardan como texto;
 *  - todo lo demás se pasa con `String(valor)`: números, `Decimal` (sin ceros de más), booleanos y fechas (un `JSON.stringify` le pondría comillas al texto y a la fecha);
 *  - si el texto anterior y el nuevo son iguales (`5` contra `"5"`, o los dos sin valor) NO se escribe nada: un formulario guardado sin tocar ese campo no ensucia el registro;
 *  - `sucursalId` ausente o `undefined` se guarda como `null` (un cambio de la empresa, no de una sucursal), nunca como clave faltante.
 */
function dbFalsa() {
  const create = vi.fn(async (args: unknown) => args);
  return { db: { registroAuditoria: { create } } as unknown as Parameters<typeof registrarCambioAuditado>[0], create };
}

const BASE: CambioAuditable = {
  entidad: "Producto",
  entidadId: "prod-1",
  descripcion: 'Producto "Pan": precio de venta',
  campo: "precioVenta",
  valorAnterior: 100,
  valorNuevo: 120,
  actorId: "usuario-1",
  sucursalId: "suc-1",
};

/** Registra un cambio y devuelve el `data` que llegó a `registroAuditoria.create` (o `null` si no se escribió nada). */
async function escrito(cambio: Partial<CambioAuditable>) {
  const { db, create } = dbFalsa();
  await registrarCambioAuditado(db, { ...BASE, ...cambio });
  if (create.mock.calls.length === 0) return null;
  expect(create).toHaveBeenCalledTimes(1);
  return (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
}

describe("registrarCambioAuditado: la fila que escribe", () => {
  it("escribe UNA fila con los 8 campos exactos, sin ninguno de más, y solo `data` en el pedido", async () => {
    const { db, create } = dbFalsa();
    await registrarCambioAuditado(db, BASE);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toStrictEqual({
      data: {
        entidad: "Producto",
        entidadId: "prod-1",
        descripcion: 'Producto "Pan": precio de venta',
        campo: "precioVenta",
        valorAnterior: "100",
        valorNuevo: "120",
        actorId: "usuario-1",
        sucursalId: "suc-1",
      },
    });
  });

  it("no devuelve nada y espera a la escritura (si la base falla, el error sube)", async () => {
    const create = vi.fn(async () => {
      throw new Error("base caída");
    });
    const db = { registroAuditoria: { create } } as unknown as Parameters<typeof registrarCambioAuditado>[0];
    await expect(registrarCambioAuditado(db, BASE)).rejects.toThrow("base caída");
    const { db: otra } = dbFalsa();
    await expect(registrarCambioAuditado(otra, BASE)).resolves.toBeUndefined();
  });

  it("`null` y `undefined` son «sin valor» y se guardan como null; `0`, `false` y `\"\"` son valores y se guardan como texto", async () => {
    expect(await escrito({ valorAnterior: null, valorNuevo: "0" })).toMatchObject({ valorAnterior: null, valorNuevo: "0" });
    expect(await escrito({ valorAnterior: undefined, valorNuevo: 0 })).toMatchObject({ valorAnterior: null, valorNuevo: "0" });
    expect(await escrito({ valorAnterior: 0, valorNuevo: null })).toMatchObject({ valorAnterior: "0", valorNuevo: null });
    expect(await escrito({ valorAnterior: null, valorNuevo: false })).toMatchObject({ valorAnterior: null, valorNuevo: "false" });
    expect(await escrito({ valorAnterior: "", valorNuevo: null })).toMatchObject({ valorAnterior: "", valorNuevo: null });
    expect(await escrito({ valorAnterior: "algo", valorNuevo: undefined })).toMatchObject({ valorAnterior: "algo", valorNuevo: null });
  });

  it("los números se guardan con `String` (decimales y negativos incluidos)", async () => {
    expect(await escrito({ valorAnterior: 1.5, valorNuevo: -2 })).toMatchObject({ valorAnterior: "1.5", valorNuevo: "-2" });
    expect(await escrito({ valorAnterior: 0.1 + 0.2, valorNuevo: 1e21 })).toMatchObject({ valorAnterior: "0.30000000000000004", valorNuevo: "1e+21" });
  });

  it("un `Decimal` de Prisma se guarda con su texto, sin ceros de más", async () => {
    expect(await escrito({ valorAnterior: new Prisma.Decimal("12.50"), valorNuevo: new Prisma.Decimal("13.00") })).toMatchObject({ valorAnterior: "12.5", valorNuevo: "13" });
  });

  it("los booleanos se guardan como «true» y «false»", async () => {
    expect(await escrito({ valorAnterior: true, valorNuevo: false })).toMatchObject({ valorAnterior: "true", valorNuevo: "false" });
  });

  it("las fechas se guardan con `String(fecha)` (sin comillas ni ISO) y los textos tal cual (sin comillas)", async () => {
    const antes = new Date("2026-09-01T10:00:00.000Z");
    const despues = new Date("2026-10-01T15:30:00.000Z");
    expect(await escrito({ valorAnterior: antes, valorNuevo: despues })).toMatchObject({ valorAnterior: String(antes), valorNuevo: String(despues) });
    expect(String(antes)).not.toContain('"');
    expect(await escrito({ valorAnterior: "Pan", valorNuevo: 'Pan "integral"' })).toMatchObject({ valorAnterior: "Pan", valorNuevo: 'Pan "integral"' });
  });

  it("si el texto anterior y el nuevo son iguales NO escribe nada (el mismo valor, de otro tipo; los dos sin valor; el mismo Decimal)", async () => {
    expect(await escrito({ valorAnterior: 5, valorNuevo: "5" })).toBeNull();
    expect(await escrito({ valorAnterior: null, valorNuevo: undefined })).toBeNull();
    expect(await escrito({ valorAnterior: undefined, valorNuevo: undefined })).toBeNull();
    expect(await escrito({ valorAnterior: true, valorNuevo: "true" })).toBeNull();
    expect(await escrito({ valorAnterior: new Prisma.Decimal("1.0"), valorNuevo: 1 })).toBeNull();
    const fecha = new Date("2026-10-01T15:30:00.000Z");
    expect(await escrito({ valorAnterior: fecha, valorNuevo: new Date(fecha.getTime()) })).toBeNull();
  });

  it("pero distingue lo que es distinto: `0` contra sin valor, `false` contra sin valor y `\"\"` contra sin valor SÍ escriben", async () => {
    expect(await escrito({ valorAnterior: 0, valorNuevo: null })).not.toBeNull();
    expect(await escrito({ valorAnterior: false, valorNuevo: undefined })).not.toBeNull();
    expect(await escrito({ valorAnterior: "", valorNuevo: null })).not.toBeNull();
  });

  it("`sucursalId` ausente, `undefined` o `null` se guarda como null (la clave siempre está); uno dado se conserva", async () => {
    const { sucursalId: _quitada, ...sinSucursal } = BASE;
    void _quitada;
    const { db, create } = dbFalsa();
    await registrarCambioAuditado(db, sinSucursal);
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toContain("sucursalId");
    expect(data.sucursalId).toBeNull();
    expect(await escrito({ sucursalId: undefined })).toHaveProperty("sucursalId", null);
    expect(await escrito({ sucursalId: null })).toHaveProperty("sucursalId", null);
    expect(await escrito({ sucursalId: "suc-9" })).toHaveProperty("sucursalId", "suc-9");
  });

  it("la entidad, el id, la descripción, el campo y el actor pasan sin tocarse", async () => {
    expect(
      await escrito({ entidad: "CapacidadSucursal", entidadId: "suc-1:carta", descripcion: "Capacidad “carta”: apagada", campo: "habilitada", actorId: "otro-usuario", valorAnterior: true, valorNuevo: false })
    ).toStrictEqual({
      entidad: "CapacidadSucursal",
      entidadId: "suc-1:carta",
      descripcion: "Capacidad “carta”: apagada",
      campo: "habilitada",
      valorAnterior: "true",
      valorNuevo: "false",
      actorId: "otro-usuario",
      sucursalId: "suc-1",
    });
  });
});
