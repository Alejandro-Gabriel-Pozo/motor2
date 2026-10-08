import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Las consultas que hace `agregarItems` (`ctx.db` y `ctx.transaccion`) se anotan en `registro.consultas`: el guard es el REAL (sus lecturas, que van por el
 * contexto propio de `conGate`, no se cuentan); solo se reemplaza la base que la acción recibe por un cliente DERIVADO del de prueba que anota cada consulta y
 * la deja pasar. Molde: `test/administracion/usuarios-hora-del-pedido.test.ts` (el envoltorio real con un `ctx` retocado).
 */
const registro = vi.hoisted(() => ({ consultas: [] as string[] }));
vi.mock("../../src/server/actions/con-permiso", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/actions/con-permiso")>();
  const { prisma } = await import("../setup/test-db");
  // Solo `$allOperations` de primer nivel, SIN `$allModels`: en Prisma 7 recibe las de modelo (con `model`) y las crudas (`$queryRaw`, sin él); con los dos,
  // cada consulta de modelo se contaría dos veces (lo mismo que mide `reportes-c0.test.ts`).
  const contador = prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        registro.consultas.push(model ? `${model.charAt(0).toLowerCase()}${model.slice(1)}.${operation}` : operation);
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
  // La conexión de prueba ya trae la empresa fijada (ADR-022): esta transacción no hace el `set_config` de `transaccionDeEmpresa`, que no es de la acción.
  const transaccion = Object.assign(<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opciones?: Parameters<PrismaClient["$transaction"]>[1]) => contador.$transaction((tx) => fn(tx), opciones), {
    aleatorio: () => 0,
  });
  return {
    ...real,
    conPermiso: ((clave, fn) => real.conPermiso(clave, (ctx) => fn({ ...ctx, db: contador, transaccion }))) as typeof real.conPermiso,
  };
});

import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";

/**
 * Conteo de consultas de `agregarItems` (Hito 4, paso 0.5 de `docs/plan-hito-4-pureza.md` §5; O.12 y D5 del plan del POS), escrito contra el código ANTERIOR
 * a mudarla a un caso de uso y que NO se edita en ningún paso posterior: la mudanza (12a y 12b del bloque POS-B) tiene que hacer EXACTAMENTE las mismas
 * consultas, en la misma cantidad, con las escrituras al final.
 *
 * Por escenario se fija el MULTICONJUNTO exacto de consultas (ordenado: el orden fino de las lecturas no se fija, la cantidad de cada tipo sí) y que las
 * escrituras sean las últimas y en este orden: un `promoCuenta.create` por promo y UN `cuentaItem.createMany`; un rechazo no escribe nada. El N+1 por ítem
 * (cada producto se valida con sus propias lecturas: producto, disponibilidad, precio, descuento) queda DOCUMENTADO acá, NO arreglado (decisión del dueño,
 * 2026-10-08: D5 no se toca).
 */
const ESCRITURAS = new Set(["promoCuenta.create", "cuentaItem.createMany"]);

function contar(consultas: readonly string[]): string[] {
  const porTipo = new Map<string, number>();
  for (const c of consultas) porTipo.set(c, (porTipo.get(c) ?? 0) + 1);
  return [...porTipo].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k}×${n}`);
}

let s: Awaited<ReturnType<typeof sembrarSalon>>;
let cuentaId: string;
let menuDelDia: { promoCartaId: string; elecciones: { seccionCartaId: string; elegidos: { productoId: string; cantidad: number }[] }[] }[];

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
  const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
  const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.milanesa.id, visibleEnCarta: true, seccionCartaId: platos.id } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: s.flan.id, visibleEnCarta: true, seccionCartaId: postres.id } });
  const promo = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: s.sucursalId } }, seccionCartaId: platos.id, titulo: "Menú del día", precio: 10000 } });
  await prisma.promoCartaCupo.createMany({
    data: [
      { promoCartaId: promo.id, seccionCartaId: platos.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 0 },
      { promoCartaId: promo.id, seccionCartaId: postres.id, cantidadMinima: 1, cantidadMaxima: 1, orden: 1 },
    ],
  });
  menuDelDia = [
    {
      promoCartaId: promo.id,
      elecciones: [
        { seccionCartaId: platos.id, elegidos: [{ productoId: s.milanesa.id, cantidad: 1 }] },
        { seccionCartaId: postres.id, elegidos: [{ productoId: s.flan.id, cantidad: 1 }] },
      ],
    },
  ];
  cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
  registro.consultas.length = 0;
});

async function medir(llamada: () => Promise<{ ok: boolean; mensaje: string }>) {
  registro.consultas.length = 0;
  const r = await llamada();
  return { r, consultas: [...registro.consultas] };
}

/** Las escrituras de la llamada: tienen que ser las ÚLTIMAS consultas, en el orden dado. */
function escriturasAlFinal(consultas: readonly string[]): string[] {
  const escrituras = consultas.filter((c) => ESCRITURAS.has(c) || /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$|^\$executeRaw/.test(c));
  expect(consultas.slice(consultas.length - escrituras.length), consultas.join("\n")).toEqual(escrituras);
  return escrituras;
}

describe("agregarItems: consultas por escenario (contra el código de antes de mudarla)", () => {
  it("1 suelto", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }]));
    expect(r.ok, r.mensaje).toBe(true);
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×2",
      "cuenta.findFirst×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×1",
      "disponibilidadProducto.findUnique×1",
      "precioLocalProducto.findMany×1",
      "producto.findUnique×1",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany"]);
  });

  it("3 sueltos (el N+1 por ítem, documentado)", async () => {
    const { r, consultas } = await medir(() =>
      agregarItems(cuentaId, [
        { productoId: s.milanesa.id, cantidad: 1 },
        { productoId: s.flan.id, cantidad: 2 },
        { productoId: s.pizza.id, cantidad: 1 },
      ]),
    );
    expect(r.ok, r.mensaje).toBe(true);
    // El N+1: 1 + 6 por ítem (producto, disponibilidad, 2 de capacidad, precio local, descuento) + la escritura.
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×6",
      "cuenta.findFirst×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×3",
      "disponibilidadProducto.findUnique×3",
      "precioLocalProducto.findMany×3",
      "producto.findUnique×3",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany"]);
  });

  it("1 promo", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [], menuDelDia));
    expect(r.ok, r.mensaje).toBe(true);
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×1",
      "contenidoCartaProducto.findMany×1",
      "cuenta.findFirst×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×2",
      "generoCarta.findMany×1",
      "itemAgrupadoCarta.findMany×2",
      "precioLocalProducto.findMany×2",
      "producto.findMany×2",
      "promoCarta.findFirst×1",
      "promoCarta.findMany×2",
      "promoCuenta.create×1",
      "seccionCarta.findMany×1",
      "sucursal.findUnique×1",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["promoCuenta.create", "cuentaItem.createMany"]);
  });

  it("1 suelto + 1 promo", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.pizza.id, cantidad: 1 }], menuDelDia));
    expect(r.ok, r.mensaje).toBe(true);
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×3",
      "contenidoCartaProducto.findMany×1",
      "cuenta.findFirst×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×3",
      "disponibilidadProducto.findUnique×1",
      "generoCarta.findMany×1",
      "itemAgrupadoCarta.findMany×2",
      "precioLocalProducto.findMany×3",
      "producto.findMany×2",
      "producto.findUnique×1",
      "promoCarta.findFirst×1",
      "promoCarta.findMany×2",
      "promoCuenta.create×1",
      "seccionCarta.findMany×1",
      "sucursal.findUnique×1",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["promoCuenta.create", "cuentaItem.createMany"]);
  });

  it("rechazo en el segundo ítem (una materia prima): lee hasta ahí y no escribe nada", async () => {
    const { r, consultas } = await medir(() =>
      agregarItems(cuentaId, [
        { productoId: s.milanesa.id, cantidad: 1 },
        { productoId: s.muzzarella.id, cantidad: 1 },
      ]),
    );
    expect(r).toEqual({ ok: false, mensaje: "«Muzzarella» no se puede pedir: solo se piden productos de venta (PV)." });
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×2",
      "cuenta.findFirst×1",
      "descuentoProductoSucursal.findMany×1",
      "disponibilidadProducto.findUnique×1",
      "precioLocalProducto.findMany×1",
      "producto.findUnique×2",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });

  it("cuenta cerrada: una sola lectura y ninguna escritura", async () => {
    await prisma.cuenta.update({ where: { id: cuentaId }, data: { cerradaEn: new Date(), cerradaPorId: s.admin.id } });
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }]));
    expect(r).toEqual({ ok: false, mensaje: "La cuenta de la mesa 4 ya está cerrada." });
    expect(contar(consultas)).toEqual(["cuenta.findFirst×1"]);
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });
});
