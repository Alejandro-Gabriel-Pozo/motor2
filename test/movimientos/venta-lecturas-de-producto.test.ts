import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import type { ActorVenta, DatosVentaEnTx, ResultadoVentaEnTx } from "../../src/core/movimientos/registrar-venta";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";

/**
 * Las fichas de producto que lee `registrarVentaEnTx` (Hito 5, pieza 5.1, bloque B2a): las de los productos CONSUMIDOS —y, si la parte salió de un sustituto, la del producto al que
 * reemplazó— se leen JUSTO ANTES del bucle de escritura, DESPUÉS de la validación de stock, y no adentro del bucle. Dos cosas que ninguna otra red ve, porque el multiconjunto de lecturas
 * de las matrices no distingue el momento ni el rechazo por stock con un producto sin leer:
 * 1. un rechazo por stock insuficiente NO suma lecturas de los productos consumidos (el hermano que habría salido el consumo queda sin leer);
 * 2. en una venta que sale, ninguna ficha de producto se lee después de escribir la primera Operación (las filas se arman sin leer nada), y cada ficha se lee UNA sola vez (caché).
 * El caso: la receta del pan usa harina A (sin stock) y sal (sin stock en el primer caso, con stock en el segundo); la harina B, hermana de la A (mismo Insumo), tiene stock y es de donde
 * sale el consumo — una ficha que `armarLinea` nunca leyó.
 */

type Delegados = Record<string, Record<string, (...args: unknown[]) => unknown>>;

/** Un `tx` que anota cada llamada a la base (`modelo.operación`, `$queryRaw`, `$executeRaw`) y la deja pasar (copia del `conTraza` de `caracterizacion/venta-matriz.test.ts`). */
function conTraza(tx: Prisma.TransactionClient, traza: string[]): Prisma.TransactionClient {
  const crudo = tx as unknown as Record<string, unknown>;
  return new Proxy(crudo, {
    get(objetivo, propiedad) {
      const valor = objetivo[propiedad as string];
      if (typeof propiedad !== "string") return valor;
      if (propiedad.startsWith("$") && typeof valor === "function") {
        return (...args: unknown[]) => {
          traza.push(propiedad);
          return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
        };
      }
      if (valor && typeof valor === "object" && !propiedad.startsWith("_")) {
        return new Proxy(valor as Delegados[string], {
          get(modelo, operacion) {
            const f = modelo[operacion as string];
            if (typeof operacion !== "string" || typeof f !== "function") return f;
            return (...args: unknown[]) => {
              traza.push(`${propiedad}.${operacion}`);
              return f.apply(modelo, args);
            };
          },
        });
      }
      return valor;
    },
  }) as unknown as Prisma.TransactionClient;
}

describe("registrarVentaEnTx: cuándo se leen las fichas de los productos consumidos", () => {
  let sucursalId: string;
  let seccionId: string;
  let actor: ActorVenta;
  let unidadId: string;
  let pan: string;
  let sal: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    const usuario = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    actor = { usuarioId: usuario.id, sucursalId, sucursalNombre: "Central" };
    unidadId = (await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } })).id;

    // Harina A y B comparten Insumo: son hermanas (la familia de A incluye a B). Solo B tiene stock.
    const insumoHarina = await prisma.insumo.create({ data: { nombre: "Harina" } });
    const harinaA = (await sembrarProductoDisponible({ codigo: "MP_HARINA_A", nombre: "MP_HARINA_A", tipo: "MP", unidadStockId: unidadId, insumoId: insumoHarina.id }, sucursalId)).id;
    const harinaB = (await sembrarProductoDisponible({ codigo: "MP_HARINA_B", nombre: "MP_HARINA_B", tipo: "MP", unidadStockId: unidadId, insumoId: insumoHarina.id }, sucursalId)).id;
    sal = (await sembrarProductoDisponible({ codigo: "MP_SAL", nombre: "MP_SAL", tipo: "MP", unidadStockId: unidadId }, sucursalId)).id;
    pan = (await sembrarProductoDisponible({ codigo: "PV_PAN", nombre: "PV_PAN", tipo: "PV", unidadStockId: unidadId, precioVenta: 100 }, sucursalId)).id;
    const version = await prisma.recetaVersion.create({ data: { productoId: pan, version: 1 } });
    await prisma.recetaIngrediente.create({ data: { id: "ing-1", recetaVersionId: version.id, insumoProductoId: harinaA, cantidad: 1, unidadId, mermaPorcentaje: 0 } });
    await prisma.recetaIngrediente.create({ data: { id: "ing-2", recetaVersionId: version.id, insumoProductoId: sal, cantidad: 1, unidadId, mermaPorcentaje: 0 } });
    await comprar(harinaB, 5);
  });

  async function comprar(productoId: string, cantidad: number): Promise<void> {
    const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2026-09-01"), usuarioId: actor.usuarioId } });
    await prisma.movimientoStock.create({
      data: { operacionId: operacion.id, productoId, seccionId, proceso: "COMPRA", cantidad, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
    });
  }

  async function vender(): Promise<{ r: ResultadoVentaEnTx; traza: string[] }> {
    const traza: string[] = [];
    const datos: DatosVentaEnTx = { fecha: new Date("2026-09-30"), origen: { tipo: "seccion", seccionId }, lineas: [{ productoId: pan, cantidadVendida: 1 }] };
    const r = await prisma.$transaction((tx) => registrarVentaEnTx(conTraza(tx, traza), actor, datos, {}));
    return { r, traza };
  }

  const cuantas = (traza: readonly string[], tipo: string) => traza.filter((t) => t === tipo).length;

  it("un rechazo por stock insuficiente no lee la ficha del hermano de donde habría salido el consumo (solo el PV, la harina A y la sal)", async () => {
    const { r, traza } = await vender();
    expect(r).toEqual({ ok: false, mensaje: 'Stock insuficiente para "MP_SAL". Actual: 0, requerido: 1.' });
    expect(cuantas(traza, "producto.findUnique")).toBe(3);
    expect(traza.filter((t) => /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)$/.test(t))).toEqual([]);
  });

  it("una venta que sale lee la ficha del hermano UNA vez y antes de escribir la primera Operación", async () => {
    await comprar(sal, 5);
    const { r, traza } = await vender();
    expect(r.ok).toBe(true);
    // El PV, la harina A, la sal y la harina B (el hermano de donde salió la harina): cuatro fichas, cada una una vez.
    expect(cuantas(traza, "producto.findUnique")).toBe(4);
    const primeraEscritura = traza.indexOf("operacion.create");
    expect(primeraEscritura).toBeGreaterThan(-1);
    expect(traza.lastIndexOf("producto.findUnique")).toBeLessThan(primeraEscritura);
    expect(traza.filter((t) => /\.(create|createMany)$/.test(t))).toEqual(["operacion.create", "movimientoStock.createMany"]);
  });
});
