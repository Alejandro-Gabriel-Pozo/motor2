import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarCompraDeKardex, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { AHORA_DE_LA_CORRIDA, DIA_MS, enElPasado } from "../setup/tiempo";
import type { Transaccion } from "../../src/lib/db-tipos";
import { registrarVentaCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";

/**
 * Red de O.38b (D0 de `docs/plan-hito-4-pureza.md` §4): las LECTURAS de una venta, contadas por tipo. D1 a D3 generalizan a N sucursales tres cargadores que la
 * venta usa DENTRO de su transacción (`construirMapaProductos` → `disponibilidadDeProductos`, y el costo de reposición `obtenerCostoActualPorMP`, los dos vía
 * `calcularCostosYMargenes`, que congela el costo al vender). La venta sigue siendo de UNA sucursal: la versión de una sucursal llama a la de N con un elemento,
 * así que el conteo de cada tipo de lectura tiene que quedar IDÉNTICO en cada paso. Lo fija para los dos caminos de la venta:
 *  - una venta de MOSTRADOR (`registrarVentaCasoDeUso`, el caso de uso de la acción `registrarVenta`, el mismo que usa `venta-matriz-ampliada`);
 *  - un CIERRE del POS (`cerrarCuentaCasoDeUso`, que vende con el mismo núcleo `registrarVentaEnTx`).
 * Las matrices de la venta ya vuelcan la traza de cada paso, pero dentro de un golden de miles de líneas; este test lo dice en una sola aserción por camino.
 *
 * Cómo se cuenta: la transacción que recibe el caso de uso pasa a la función un `tx` envuelto en un Proxy que anota cada `modelo.operación` y cada `$queryRaw` /
 * `$executeRaw` (el cliente de una transacción no se puede extender con `$extends`: por eso un Proxy, y por eso cuenta también los `$` crudos, que es por donde
 * sale el costo de reposición). Además fija que el costo congelado sea el de LA sucursal que vende: hay otra sucursal con una compra más nueva y más cara del
 * mismo insumo (si el costo de reposición generalizado leyera todas, la venta congelaría el de la otra).
 */

type Delegados = Record<string, Record<string, (...args: unknown[]) => unknown>>;

/** Un `tx` que anota cada llamada a la base (`modelo.operación`, `$queryRaw`, `$executeRaw`, …) y la deja pasar. */
function contado(tx: Prisma.TransactionClient, registro: string[]): Prisma.TransactionClient {
  const crudo = tx as unknown as Record<string, unknown>;
  return new Proxy(crudo, {
    get(objetivo, propiedad) {
      const valor = objetivo[propiedad as string];
      if (typeof propiedad !== "string") return valor;
      if (propiedad.startsWith("$") && typeof valor === "function") {
        return (...args: unknown[]) => {
          registro.push(propiedad);
          return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
        };
      }
      if (valor && typeof valor === "object" && !propiedad.startsWith("_")) {
        return new Proxy(valor as Delegados[string], {
          get(modelo, operacion) {
            const f = modelo[operacion as string];
            if (typeof operacion !== "string" || typeof f !== "function") return f;
            return (...args: unknown[]) => {
              registro.push(`${propiedad}.${operacion}`);
              return f.apply(modelo, args);
            };
          },
        });
      }
      return valor;
    },
  }) as unknown as Prisma.TransactionClient;
}

const ESCRITURAS = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$|^\$executeRaw/;

/** Las lecturas del registro, por tipo y en orden alfabético (`{ "producto.findMany": 1, … }`). */
function lecturasPorTipo(registro: readonly string[]): Record<string, number> {
  const porTipo: Record<string, number> = {};
  for (const r of [...registro].sort()) if (!ESCRITURAS.test(r)) porTipo[r] = (porTipo[r] ?? 0) + 1;
  return porTipo;
}

/** Una transacción real que pasa a la función el `tx` contado. */
const transaccionContada = (registro: string[]): Transaccion => (fn, opciones) => prisma.$transaction((tx) => fn(contado(tx, registro)), opciones);

describe("Lecturas de una venta (red de O.38b: idénticas en cada paso D1-D3)", () => {
  let usuarioId: string;
  let sucursalId: string;
  let seccionId: string;
  let panId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const { kg } = await sembrarCatalogoBase();
    sucursalId = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    seccionId = (await sembrarSeccion(sucursalId)).id;
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = (await sembrarSeccion(norte.id)).id;

    const harina = await sembrarProductoDisponible({ codigo: "MP_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: kg.id }, sucursalId);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: norte.id, productoId: harina.id, disponible: true } });
    const pan = await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "Pan", tipo: "PV", unidadStockId: kg.id, precioVenta: 100 }, sucursalId);
    panId = pan.id;
    await prisma.recetaVersion.create({ data: { productoId: pan.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.5, unidadId: kg.id }] } } });

    // Central compró a $20 el kg; Norte, DESPUÉS, a $50: el costo de reposición de Central sigue siendo $20 (0,5 kg → $10 por pan).
    await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: harina.id, proveedorId: null, fecha: enElPasado(10 * DIA_MS).toISOString(), precioPorUnidadStock: 20 });
    await sembrarCompraDeKardex({ sucursalId, seccionId, usuarioId, productoId: harina.id, proveedorId: null, fecha: enElPasado(9 * DIA_MS).toISOString(), precioPorUnidadStock: 20 });
    await sembrarCompraDeKardex({ sucursalId: norte.id, seccionId: seccionNorte, usuarioId, productoId: harina.id, proveedorId: null, fecha: enElPasado(2 * DIA_MS).toISOString(), precioPorUnidadStock: 50 });
  });

  /** El costo unitario congelado en la fila VENTA del pan. */
  const costoCongelado = async () => {
    const venta = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: panId, proceso: "VENTA" } });
    return venta.costoUnitarioVenta === null ? null : Number(venta.costoUnitarioVenta);
  };

  it("una venta de mostrador lee lo mismo que hoy, tipo por tipo, y congela el costo de SU sucursal", async () => {
    const registro: string[] = [];
    const r = await registrarVentaCasoDeUso(
      { usuarioId, sucursalId, sucursalNombre: "Central", transaccion: transaccionContada(registro) },
      { fecha: enElPasado(DIA_MS), seccionId, ventas: [{ productoId: panId, cantidadVendida: 1 }] }
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(lecturasPorTipo(registro), registro.join("\n")).toEqual(LECTURAS_DE_LA_VENTA_DE_MOSTRADOR);
    expect(await costoCongelado()).toBe(10);
  });

  it("un cierre del POS lee lo mismo que hoy, tipo por tipo, y congela el costo de SU sucursal", async () => {
    const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 1 } });
    const cuenta = await prisma.cuenta.create({ data: { mesaId: mesa.id, abiertaPorId: usuarioId } });
    await prisma.cuentaItem.create({ data: { cuentaId: cuenta.id, productoId: panId, cantidad: 1, precioUnitario: 100, numeroEnvio: 1, creadoPorId: usuarioId } });
    const registro: string[] = [];
    const r = await cerrarCuentaCasoDeUso(
      { usuarioId, sucursalId, sucursalNombre: "Central", email: "admin@test.com", transaccion: transaccionContada(registro), ahora: AHORA_DE_LA_CORRIDA },
      { cuentaId: cuenta.id }
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(lecturasPorTipo(registro), registro.join("\n")).toEqual(LECTURAS_DEL_CIERRE_DEL_POS);
    expect(await costoCongelado()).toBe(10);
  });
});

// Las lecturas de hoy (commit af4f1cde, antes de D1). Si un paso de O.38b las cambia, este test lo dice en rojo: los cargadores generalizados tienen que hacer,
// para una sucursal, EXACTAMENTE las mismas lecturas que antes.
// `$queryRaw` ×1 es el costo de reposición; `disponibilidadProducto.findMany` ×1, la disponibilidad del mapa de productos (las dos, de `calcularCostosYMargenes`).
const LECTURAS_DE_LA_VENTA_DE_MOSTRADOR: Record<string, number> = {
  $queryRaw: 1,
  "capacidadSucursal.findMany": 2,
  "disponibilidadProducto.findMany": 1,
  "disponibilidadProducto.findUnique": 2,
  "grupo.findMany": 1,
  "movimientoStock.groupBy": 2,
  "precioLocalProducto.findMany": 2,
  "producto.findMany": 2,
  "producto.findUnique": 2,
  "recetaSucursal.findMany": 2,
  "recetaVersion.findFirst": 1,
  "recetaVersion.findMany": 1,
  "seccion.findUnique": 1,
};
const LECTURAS_DEL_CIERRE_DEL_POS: Record<string, number> = {
  $queryRaw: 1,
  "capacidadSucursal.findMany": 1,
  "cuenta.findFirst": 1,
  "disponibilidadProducto.findMany": 1,
  "disponibilidadProducto.findUnique": 2,
  "ejemplarTicket.aggregate": 1,
  "grupo.findMany": 1,
  "movimientoStock.groupBy": 3,
  "precioLocalProducto.findMany": 1,
  "producto.findMany": 2,
  "producto.findUnique": 2,
  "recetaSucursal.findMany": 2,
  "recetaVersion.findFirst": 1,
  "recetaVersion.findMany": 1,
  "seccion.findMany": 1,
  "seccionHabitualProducto.findMany": 1,
};
