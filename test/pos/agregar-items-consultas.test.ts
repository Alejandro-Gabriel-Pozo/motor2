import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

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

import { EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { fijarModulosActivos } from "../setup/modulos";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { elegida, sembrarCafeDelSalon } from "../setup/opciones";
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
 *
 * Primera edición posterior, a propósito (S-22 / D2, tanda T10 del endurecimiento de seguridad): los dos escenarios que traen una promo suman UNA lectura del
 * registro de módulos (`moduloEmpresa.findMany`), porque sin el módulo Promociones el pedido se rechaza. Los pedidos de puros sueltos no la hacían.
 *
 * Segunda edición, a propósito (P18 / D18, decisión del dueño 2026-10-11: sin Carta no rige el descuento de producto): el registro de módulos se lee SIEMPRE,
 * una vez por pedido y después de la cuenta, para decidir si rige el descuento; por eso suman esa lectura también «1 suelto», «3 sueltos» y «rechazo en el segundo
 * ítem». «Cuenta cerrada» no cambia (devuelve antes de leerlo) y los escenarios con promo quedan iguales (ya la hacían).
 *
 * Tercera edición, SOLO ADITIVA (P3 del Paquete 1, idempotencia I3): ningún escenario de arriba cambia (sin clave no se lee ni se escribe nada nuevo). Se suma el bloque «con clave de idempotencia»: UNA lectura
 * (`agregadoDeCuenta.findUnique`, la primera de todas) y UNA escritura (`agregadoDeCuenta.create`, la última, después de los ítems); y el reintento, que hace esa única lectura y no escribe nada.
 *
 * Cuarta edición, a propósito (GO-2b, ADR-030: las opciones de venta): todo pedido que pasa la cuenta y el registro de módulos suma UNA lectura agrupada de lo que admite cada producto
 * (`producto.findMany`, una por pedido y no por ítem: el mínimo obligatorio se exige aunque no se manden opciones, y sirve también para los componentes de las promos). «Cuenta cerrada» y el
 * reintento no cambian (devuelven antes). Las escrituras de un pedido sin opciones no cambian. Se suma el bloque «con opciones»: la línea configurada se escribe con un `cuentaItem.create` (más uno
 * por adicional) y un `opcionElegidaEnLinea.createMany`, sin el `createMany` de los sueltos si no hay ninguno; y una MEDIDA en ABSOLUTO suma la grilla de la sucursal (la capacidad y las filas).
 */
const ESCRITURAS = new Set(["promoCuenta.create", "cuentaItem.createMany", "agregadoDeCuenta.create"]);

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
      "moduloEmpresa.findMany×1", // P18 / D18: el registro de módulos se lee SIEMPRE (una vez): decide si rige el descuento de producto (solo con Carta).
      "precioLocalProducto.findMany×1",
      "producto.findMany×1", // GO-2b: lo que admite cada producto del pedido, en UNA lectura.
      "producto.findUnique×1",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany"]);
  });

  it("P18 / D18: con Carta apagada, 1 suelto NO lee el descuento de producto (lee el registro de módulos una vez) y congela el precio de lista", async () => {
    await fijarModulosActivos(EMPRESA_POR_DEFECTO_ID, ["salon"]);
    await prisma.descuentoProductoSucursal.create({ data: { productoId: s.milanesa.id, sucursalId: s.sucursalId, porcentaje: 15 } });
    registro.consultas.length = 0;
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }]));
    expect(r.ok, r.mensaje).toBe(true);
    expect(consultas.filter((c) => c.startsWith("descuentoProductoSucursal."))).toEqual([]);
    expect(consultas.filter((c) => c === "moduloEmpresa.findMany")).toHaveLength(1);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany"]);
    const [item] = await prisma.cuentaItem.findMany({ where: { cuentaId } });
    expect(Number(item.precioUnitario)).toBe(9000);
    expect(item.precioCartaUnitario).toBeNull();
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
      "moduloEmpresa.findMany×1", // P18 / D18: UNA vez por pedido, no por ítem.
      "precioLocalProducto.findMany×3",
      "producto.findMany×1", // GO-2b: UNA vez por pedido, no por ítem.
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
      "moduloEmpresa.findMany×1", // S-22 / D2: se lee UNA vez el registro de módulos (Promociones prendido) y se comparte con la lectura de la promo.
      "precioLocalProducto.findMany×2",
      "producto.findMany×3", // GO-2b: +1, lo que admiten los componentes de la promo (en v1 no llevan opciones: uno con un grupo obligatorio se rechaza).
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
      "moduloEmpresa.findMany×1", // S-22 / D2: ídem (una sola lectura, compartida con la promo).
      "precioLocalProducto.findMany×3",
      "producto.findMany×3", // GO-2b: +1, una sola lectura para el suelto y los componentes.
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
      "moduloEmpresa.findMany×1", // P18 / D18: se lee antes de validar el primer ítem.
      "precioLocalProducto.findMany×1",
      "producto.findMany×1", // GO-2b: antes del primer ítem.
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

describe("agregarItems CON clave de idempotencia (P3, I3): +1 lectura y +1 escritura, y el reintento solo lee", () => {
  const CLAVE = "33333333-3333-4333-8333-333333333333";

  it("1 suelto con clave: las mismas consultas de siempre + la lectura del comprobante + su escritura al final, después de los ítems", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE));
    expect(r.ok, r.mensaje).toBe(true);
    expect(contar(consultas)).toEqual([
      "agregadoDeCuenta.create×1", // +1 escritura
      "agregadoDeCuenta.findUnique×1", // +1 lectura
      "capacidadSucursal.findMany×2",
      "cuenta.findFirst×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×1",
      "disponibilidadProducto.findUnique×1",
      "moduloEmpresa.findMany×1",
      "precioLocalProducto.findMany×1",
      "producto.findMany×1", // GO-2b
      "producto.findUnique×1",
    ]);
    expect(consultas[0], "la lectura del comprobante es el PRIMER paso, antes de mirar la cuenta").toBe("agregadoDeCuenta.findUnique");
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany", "agregadoDeCuenta.create"]);
  });

  it("1 promo con clave: promoCuenta.create, cuentaItem.createMany y por último el comprobante", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [], menuDelDia, CLAVE));
    expect(r.ok, r.mensaje).toBe(true);
    expect(consultas.filter((c) => c.startsWith("agregadoDeCuenta."))).toEqual(["agregadoDeCuenta.findUnique", "agregadoDeCuenta.create"]);
    expect(escriturasAlFinal(consultas)).toEqual(["promoCuenta.create", "cuentaItem.createMany", "agregadoDeCuenta.create"]);
  });

  it("el reintento (misma clave, mismo pedido): UNA lectura y ninguna escritura; no vuelve a validar nada", async () => {
    expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE));
    expect(r).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(contar(consultas)).toEqual(["agregadoDeCuenta.findUnique×1"]);
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });

  it("el reintento con la cuenta ya CERRADA: la misma única lectura (no mira la cuenta) y devuelve el mensaje original", async () => {
    expect((await agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE)).ok).toBe(true);
    await prisma.cuenta.update({ where: { id: cuentaId }, data: { cerradaEn: new Date(), cerradaPorId: s.admin.id } });
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.milanesa.id, cantidad: 1 }], [], CLAVE));
    expect(r).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(contar(consultas)).toEqual(["agregadoDeCuenta.findUnique×1"]);
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });

  it("rechazo con clave (materia prima): lee el comprobante, no escribe nada y no consume la clave", async () => {
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.muzzarella.id, cantidad: 1 }], [], CLAVE));
    expect(r).toEqual({ ok: false, mensaje: "«Muzzarella» no se puede pedir: solo se piden productos de venta (PV)." });
    expect(consultas.filter((c) => c.startsWith("agregadoDeCuenta."))).toEqual(["agregadoDeCuenta.findUnique"]);
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });
});

describe("agregarItems CON opciones (GO-2b, cuarta edición): la línea configurada se escribe aparte, al final", () => {
  it("un café grande con almendras y un shot: las lecturas de siempre + la de las opciones; escribe la línea, el adicional y las fotos (sin el createMany de los sueltos)", async () => {
    const c = await sembrarCafeDelSalon(s);
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.grandeId), elegida(c, c.almendrasId), elegida(c, c.shotId)] }]));
    expect(r).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×2",
      "cuenta.findFirst×1",
      "cuentaItem.create×2",
      "descuentoProductoSucursal.findMany×1",
      "disponibilidadProducto.findUnique×1",
      "moduloEmpresa.findMany×1",
      "opcionElegidaEnLinea.createMany×1",
      "precioLocalProducto.findMany×1",
      "producto.findMany×1",
      "producto.findUnique×1",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.create", "cuentaItem.create", "opcionElegidaEnLinea.createMany"]);
  });

  it("un suelto sin opciones y un café configurado: primero el createMany de los sueltos, después la línea configurada; una MEDIDA en ABSOLUTO suma la grilla (capacidad y filas)", async () => {
    const c = await sembrarCafeDelSalon(s, { modoPrecioMedida: "ABSOLUTO", precioAbsoluto: { mediano: "1100.00" } });
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: s.flan.id, cantidad: 1 }, { productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.medianoId)] }]));
    expect(r).toEqual({ ok: true, mensaje: "Se agregaron 2 ítems a la mesa 4." });
    expect(contar(consultas)).toEqual([
      "capacidadSucursal.findMany×5",
      "cuenta.findFirst×1",
      "cuentaItem.create×1",
      "cuentaItem.createMany×1",
      "descuentoProductoSucursal.findMany×2",
      "disponibilidadProducto.findUnique×2",
      "moduloEmpresa.findMany×1",
      "opcionElegidaEnLinea.createMany×1",
      "precioLocalDeOpcion.findMany×1",
      "precioLocalProducto.findMany×2",
      "producto.findMany×1",
      "producto.findUnique×2",
    ]);
    expect(escriturasAlFinal(consultas)).toEqual(["cuentaItem.createMany", "cuentaItem.create", "opcionElegidaEnLinea.createMany"]);
  });

  it("un rechazo por opciones (falta el tamaño obligatorio) lee lo mismo que el pedido y no escribe nada", async () => {
    const c = await sembrarCafeDelSalon(s);
    const { r, consultas } = await medir(() => agregarItems(cuentaId, [{ productoId: c.cafeId, cantidad: 1, opciones: [elegida(c, c.vacaId)] }]));
    expect(r).toEqual({ ok: false, mensaje: "«Café»: Elegí al menos 1 opción de «Tamaño»." });
    expect(escriturasAlFinal(consultas)).toEqual([]);
  });
});

