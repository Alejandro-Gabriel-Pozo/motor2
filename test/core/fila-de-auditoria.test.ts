import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { filaDeAuditoria, TEXTO_DE_VALOR_NO_SERIALIZABLE, type CambioAuditable } from "../../src/core/permisos/auditoria";

/**
 * `filaDeAuditoria` (Hito 5, pieza 5.4, B4 de `docs/plan-hito-5-pureza.md`): lo PURO del escritor de la auditoría —los valores a texto, el «no cambió» y el `null` del `sucursalId`—,
 * ahora en `core/permisos/auditoria.ts`. Es la misma tabla que `test/auditoria/registrar-cambio-auditado.test.ts` (que prueba el escritor entero con una base falsa), sin base ni
 * doble de la base: si una de las dos se desvía de la otra, la que corresponde se pone en rojo.
 */
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

const fila = (cambio: Partial<CambioAuditable>) => filaDeAuditoria({ ...BASE, ...cambio });

describe("filaDeAuditoria", () => {
  it("devuelve los 8 campos exactos, sin ninguno de más", () => {
    expect(filaDeAuditoria(BASE)).toStrictEqual({
      entidad: "Producto",
      entidadId: "prod-1",
      descripcion: 'Producto "Pan": precio de venta',
      campo: "precioVenta",
      valorAnterior: "100",
      valorNuevo: "120",
      actorId: "usuario-1",
      sucursalId: "suc-1",
    });
  });

  it("`null` y `undefined` son «sin valor» (null); `0`, `false` y `\"\"` son valores y se guardan como texto", () => {
    expect(fila({ valorAnterior: null, valorNuevo: "0" })).toMatchObject({ valorAnterior: null, valorNuevo: "0" });
    expect(fila({ valorAnterior: undefined, valorNuevo: 0 })).toMatchObject({ valorAnterior: null, valorNuevo: "0" });
    expect(fila({ valorAnterior: 0, valorNuevo: null })).toMatchObject({ valorAnterior: "0", valorNuevo: null });
    expect(fila({ valorAnterior: null, valorNuevo: false })).toMatchObject({ valorAnterior: null, valorNuevo: "false" });
    expect(fila({ valorAnterior: "", valorNuevo: null })).toMatchObject({ valorAnterior: "", valorNuevo: null });
    expect(fila({ valorAnterior: "algo", valorNuevo: undefined })).toMatchObject({ valorAnterior: "algo", valorNuevo: null });
  });

  it("números, Decimal, booleanos, fechas y textos se pasan con `String`", () => {
    expect(fila({ valorAnterior: 1.5, valorNuevo: -2 })).toMatchObject({ valorAnterior: "1.5", valorNuevo: "-2" });
    expect(fila({ valorAnterior: 0.1 + 0.2, valorNuevo: 1e21 })).toMatchObject({ valorAnterior: "0.30000000000000004", valorNuevo: "1e+21" });
    expect(fila({ valorAnterior: new Prisma.Decimal("12.50"), valorNuevo: new Prisma.Decimal("13.00") })).toMatchObject({ valorAnterior: "12.5", valorNuevo: "13" });
    expect(fila({ valorAnterior: true, valorNuevo: false })).toMatchObject({ valorAnterior: "true", valorNuevo: "false" });
    const antes = new Date("2026-09-01T10:00:00.000Z");
    const despues = new Date("2026-10-01T15:30:00.000Z");
    expect(fila({ valorAnterior: antes, valorNuevo: despues })).toMatchObject({ valorAnterior: String(antes), valorNuevo: String(despues) });
    expect(fila({ valorAnterior: "Pan", valorNuevo: 'Pan "integral"' })).toMatchObject({ valorAnterior: "Pan", valorNuevo: 'Pan "integral"' });
  });

  it("si el texto anterior y el nuevo son iguales NO hay fila (null)", () => {
    expect(fila({ valorAnterior: 5, valorNuevo: "5" })).toBeNull();
    expect(fila({ valorAnterior: null, valorNuevo: undefined })).toBeNull();
    expect(fila({ valorAnterior: undefined, valorNuevo: undefined })).toBeNull();
    expect(fila({ valorAnterior: true, valorNuevo: "true" })).toBeNull();
    expect(fila({ valorAnterior: new Prisma.Decimal("1.0"), valorNuevo: 1 })).toBeNull();
    const fecha = new Date("2026-10-01T15:30:00.000Z");
    expect(fila({ valorAnterior: fecha, valorNuevo: new Date(fecha.getTime()) })).toBeNull();
  });

  it("pero distingue lo que es distinto: `0`, `false` y `\"\"` contra sin valor SÍ dan fila", () => {
    expect(fila({ valorAnterior: 0, valorNuevo: null })).not.toBeNull();
    expect(fila({ valorAnterior: false, valorNuevo: undefined })).not.toBeNull();
    expect(fila({ valorAnterior: "", valorNuevo: null })).not.toBeNull();
  });

  it("`sucursalId` ausente, `undefined` o `null` queda en null (la clave siempre está); uno dado se conserva", () => {
    const { sucursalId: _quitada, ...sinSucursal } = BASE;
    void _quitada;
    const sinClave = filaDeAuditoria(sinSucursal)!;
    expect(Object.keys(sinClave)).toContain("sucursalId");
    expect(sinClave.sucursalId).toBeNull();
    expect(fila({ sucursalId: undefined })).toHaveProperty("sucursalId", null);
    expect(fila({ sucursalId: null })).toHaveProperty("sucursalId", null);
    expect(fila({ sucursalId: "suc-9" })).toHaveProperty("sucursalId", "suc-9");
  });

  it("la entidad, el id, la descripción, el campo y el actor pasan sin tocarse", () => {
    expect(
      fila({ entidad: "CapacidadSucursal", entidadId: "suc-1:carta", descripcion: "Capacidad “carta”: apagada", campo: "habilitada", actorId: "otro-usuario", valorAnterior: true, valorNuevo: false })
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

/**
 * Objetos y arreglos (defecto de trazabilidad): antes `String({...})` dejaba «[object Object]» y la fila era ilegible. Ahora un objeto plano o un arreglo se guarda como JSON compacto con las
 * claves ordenadas (mismo contenido, mismo texto); lo demás —texto, número, booleano, `Date`, `Decimal`, `null`— sigue EXACTAMENTE como antes (lo fija el resto de este archivo).
 * Un valor circular no corta el cambio que se audita: queda un texto fijo, sin contenido (falla cerrada, sin volcar nada).
 */
describe("filaDeAuditoria: objetos y arreglos como JSON legible", () => {
  const nuevo = (valorNuevo: unknown) => fila({ valorAnterior: "previo", valorNuevo })!.valorNuevo;

  it("un objeto plano: JSON compacto, sin «[object Object]»", () => {
    expect(nuevo({ fechaPago: "2026-10-01", medio: "EFECTIVO" })).toBe('{"fechaPago":"2026-10-01","medio":"EFECTIVO"}');
  });

  it("un arreglo de objetos (la carga repartida de una factura)", () => {
    expect(nuevo([{ sucursal: "Central", importe: 320, porcentajeDeclaradoBp: 10000, estado: "RECIBIDA" }])).toBe('[{"estado":"RECIBIDA","importe":320,"porcentajeDeclaradoBp":10000,"sucursal":"Central"}]');
  });

  it("el orden de las claves no cambia el texto (en todos los niveles); el orden de un arreglo sí se conserva", () => {
    expect(nuevo({ b: 1, a: { d: 1, c: 2 } })).toBe(nuevo({ a: { c: 2, d: 1 }, b: 1 }));
    expect(nuevo({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
    expect(nuevo([2, 1])).toBe("[2,1]");
  });

  it("anidado: objetos dentro de arreglos y arreglos dentro de objetos", () => {
    expect(nuevo({ partes: [{ z: 1, y: [3, { b: 1, a: 2 }] }] })).toBe('{"partes":[{"y":[3,{"a":2,"b":1}],"z":1}]}');
  });

  it("una `Date` y un `Decimal` dentro de un objeto van como texto (ISO la fecha, sin ceros de más el decimal)", () => {
    expect(nuevo({ cuando: new Date("2026-10-01T15:30:00.000Z"), monto: new Prisma.Decimal("1.50") })).toBe('{"cuando":"2026-10-01T15:30:00.000Z","monto":"1.5"}');
  });

  it("un `bigint` dentro de un objeto no rompe: va como texto", () => {
    expect(nuevo({ n: BigInt(7) })).toBe('{"n":"7"}');
  });

  it("`undefined` dentro de un objeto se omite y dentro de un arreglo es `null` (JSON estándar); `null` se conserva", () => {
    expect(nuevo({ a: undefined, b: null })).toBe('{"b":null}');
    expect(nuevo([undefined, null])).toBe("[null,null]");
  });

  it("objeto y arreglo vacíos", () => {
    expect(nuevo({})).toBe("{}");
    expect(nuevo([])).toBe("[]");
  });

  it("el «no cambió» también vale para objetos: mismo contenido en otro orden no da fila; distinto contenido sí", () => {
    expect(fila({ valorAnterior: { a: 1, b: 2 }, valorNuevo: { b: 2, a: 1 } })).toBeNull();
    expect(fila({ valorAnterior: { a: 1 }, valorNuevo: { a: 2 } })).not.toBeNull();
  });

  it("un valor circular no explota ni vuelca contenido: queda el texto fijo", () => {
    const circular: Record<string, unknown> = { nombre: "dato" };
    circular.yo = circular;
    expect(nuevo(circular)).toBe(TEXTO_DE_VALOR_NO_SERIALIZABLE);
    const arreglo: unknown[] = [1];
    arreglo.push(arreglo);
    expect(nuevo(arreglo)).toBe(TEXTO_DE_VALOR_NO_SERIALIZABLE);
  });

  it("un `getter` que falla tampoco corta el cambio", () => {
    expect(nuevo({ get roto(): string { throw new Error("no"); } })).toBe(TEXTO_DE_VALOR_NO_SERIALIZABLE);
  });

  it("los primitivos, `Date` y `Decimal` de primer nivel siguen EXACTAMENTE como antes (sin comillas ni JSON)", () => {
    expect(nuevo("texto")).toBe("texto");
    expect(nuevo(120)).toBe("120");
    expect(nuevo(true)).toBe("true");
    expect(nuevo(false)).toBe("false");
    expect(nuevo(new Date("2026-10-01T15:30:00.000Z"))).toBe(String(new Date("2026-10-01T15:30:00.000Z")));
    expect(nuevo(new Prisma.Decimal("1.50"))).toBe("1.5");
    expect(nuevo(null)).toBeNull();
    expect(nuevo(undefined)).toBeNull();
  });
});
