import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import type { Transaccion } from "../../src/lib/db-tipos";
import { baseDeTest, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible } from "../setup/test-db";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { agregarPresentacionAlternativaCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-presentacion-alternativa";
import { guardComandoAgregarPresentacionAlternativa, guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";

/**
 * M.2, concurrencia (hallazgo de la auditoría independiente de P1 a P3). Las reglas de `producto_campos_sensibles` comparan lo que se quiere escribir con la fila leída DENTRO de la transacción, pero esa lectura va sin
 * candado (READ COMMITTED): si otra persona (con la clave) cambia el precio, el factor o la unidad ENTRE la lectura y la escritura, quien NO tiene la clave los pisaba con el valor viejo que llevaba su formulario, sin
 * rastro. Por eso, sin la clave, la escritura NO incluye los campos que la clave protege (ya son iguales a los guardados por la validación: no hay nada que escribir), y reactivar una presentación sin la clave solo
 * escribe `activa`.
 *
 * El escenario se arma con DOS transacciones y una barrera: la del operador lee la fila y, antes de seguir, espera a que otra conexión (el administrador) cambie los valores y confirme.
 */
describe("M.2: quien no tiene la clave fina no pisa lo que otra persona cambió entre su lectura y su escritura", () => {
  let sucursalId: string;
  let operadorId: string;
  let kgId: string;
  let gId: string;
  let productoId: string;

  /** Un contexto cuya transacción, tras la PRIMERA lectura `findUnique` de `tabla`, espera a `entreLecturaYEscritura` (la barrera: otra conexión cambia la fila y confirma). */
  function actorConBarrera(tabla: "producto" | "presentacion", entreLecturaYEscritura: () => Promise<void>) {
    let disparada = false;
    const transaccion: Transaccion = (async (fn: Parameters<Transaccion>[0], opciones?: Parameters<Transaccion>[1]) =>
      baseDeTest.transaccion(async (tx) => {
        const delegado = (tx as unknown as Record<string, Record<string, unknown>>)[tabla]!;
        const delegadoConBarrera = new Proxy(delegado, {
          get(objetivo, propiedad) {
            const valor = objetivo[propiedad as string];
            if (propiedad === "findUnique" && typeof valor === "function") {
              return async (...argumentos: unknown[]) => {
                const leido = await (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, argumentos);
                if (!disparada) {
                  disparada = true;
                  await entreLecturaYEscritura();
                }
                return leido;
              };
            }
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        const txConBarrera = new Proxy(tx, {
          get(objetivo, propiedad) {
            if (propiedad === tabla) return delegadoConBarrera;
            const valor = (objetivo as unknown as Record<string | symbol, unknown>)[propiedad];
            return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(objetivo) : valor;
          },
        });
        return fn(txConBarrera);
      }, opciones)) as Transaccion;
    return { ...baseDeTest, usuarioId: operadorId, sucursalId, ahora: new Date(), transaccion };
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    gId = catalogo.g.id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    productoId = (
      await sembrarProductoDisponible({ codigo: "MP_QUESO", nombre: "Queso", tipo: "MP", unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, precioVenta: 500 }, sucursalId)
    ).id;
  });

  it("EL DEFECTO (edición): el operador sin la clave edita el nombre con el formulario viejo mientras un administrador cambia precio, factor y unidad de compra → lo del administrador NO se pisa", async () => {
    const formularioViejo = { nombre: "Queso cremoso", tipo: "MP" as const, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, precioVenta: 500 };
    const actor = actorConBarrera("producto", async () => {
      // El administrador cambia los tres campos y confirma, mientras la transacción del operador ya leyó la fila (precio 500, factor 25).
      await prismaAdmin.producto.update({ where: { id: productoId }, data: { precioVenta: 600, factorConversion: 20, unidadCompraId: kgId } });
    });
    const r = await actualizarProductoCasoDeUso(actor, {
      productoId,
      datos: formularioViejo,
      puerta: guardComandoDatosDeProducto({ datos: formularioViejo }),
      puedeGestionarConsignacion: false,
      puedeEditarCamposSensibles: false,
    });
    expect(r.ok, r.mensaje).toBe(true);
    const p = await prisma.producto.findUniqueOrThrow({ where: { id: productoId } });
    expect(p.nombre).toBe("Queso cremoso"); // lo que el operador SÍ podía cambiar, se guardó
    expect([Number(p.precioVenta), Number(p.factorConversion), p.unidadCompraId, p.unidadStockId]).toEqual([600, 20, kgId, kgId]); // lo del administrador, intacto
  });

  it("EL DEFECTO (presentación): el operador sin la clave reactiva una presentación con el MISMO factor mientras un administrador le cambia el factor → el factor del administrador NO se pisa", async () => {
    await prisma.presentacion.create({ data: { productoId, unidadCompraId: kgId, factorConversion: 20, activa: false } });
    const actor = actorConBarrera("presentacion", async () => {
      await prismaAdmin.presentacion.update({ where: { productoId_unidadCompraId: { productoId, unidadCompraId: kgId } }, data: { factorConversion: 30 } });
    });
    // El producto tiene como unidad de compra por defecto `g`, así que la presentación alternativa en `kg` es válida.
    const r = await agregarPresentacionAlternativaCasoDeUso(actor, {
      productoId,
      unidadCompraId: kgId,
      factorConversion: 20,
      factor: guardComandoAgregarPresentacionAlternativa({ productoId, unidadCompraId: kgId, factorConversion: 20 }).factor,
      puedeEditarCamposSensibles: false,
    });
    expect(r.ok, r.mensaje).toBe(true);
    const fila = await prisma.presentacion.findUniqueOrThrow({ where: { productoId_unidadCompraId: { productoId, unidadCompraId: kgId } } });
    expect(fila.activa).toBe(true); // lo que el operador SÍ podía hacer: reactivarla
    expect(Number(fila.factorConversion)).toBe(30); // el factor del administrador, intacto
  });

  it("control: con la clave, la escritura incluye los campos (quien tiene la clave define el valor)", async () => {
    const formulario = { nombre: "Queso", tipo: "MP" as const, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, precioVenta: 700 };
    const r = await actualizarProductoCasoDeUso(actorConBarrera("producto", async () => undefined), {
      productoId,
      datos: formulario,
      puerta: guardComandoDatosDeProducto({ datos: formulario }),
      puedeGestionarConsignacion: false,
      puedeEditarCamposSensibles: true,
    });
    expect(r.ok, r.mensaje).toBe(true);
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: productoId } })).precioVenta)).toBe(700);
  });

  /**
   * M.2-A4 (F): el escenario de arriba cambia los tres campos a la vez; acá cada campo SOLO, para que un defecto en uno (la unidad de stock, que el primero ni toca) no quede tapado por los otros. Dos formularios: el de
   * antes de P6 (manda los cuatro valores que vio al abrirse) y el de P6 (sin la clave NO manda los cuatro: «no viene» es «queda como estaba»). En los dos, lo que el administrador confirmó entre la lectura y la
   * escritura del operador no se pisa.
   */
  describe("cada campo sensible por separado: el operador sin la clave no pisa lo que el administrador cambió entre su lectura y su escritura", () => {
    type Campo = "precioVenta" | "factorConversion" | "unidadCompraId" | "unidadStockId";
    const CAMBIOS: { campo: Campo; cambio: () => Record<string, unknown>; esperado: () => unknown; leer: (p: { precioVenta: unknown; factorConversion: unknown; unidadCompraId: string | null; unidadStockId: string }) => unknown }[] = [
      { campo: "precioVenta", cambio: () => ({ precioVenta: 600 }), esperado: () => 600, leer: (p) => Number(p.precioVenta) },
      { campo: "factorConversion", cambio: () => ({ factorConversion: 20 }), esperado: () => 20, leer: (p) => Number(p.factorConversion) },
      { campo: "unidadCompraId", cambio: () => ({ unidadCompraId: kgId }), esperado: () => kgId, leer: (p) => p.unidadCompraId },
      { campo: "unidadStockId", cambio: () => ({ unidadStockId: gId }), esperado: () => gId, leer: (p) => p.unidadStockId },
    ];
    const FORMULARIOS: [string, (v: { nombre: string; tipo: "MP"; unidadStockId: string; unidadCompraId: string; factorConversion: number; precioVenta: number }, campo: Campo) => Record<string, unknown>][] = [
      ["el formulario que manda los cuatro valores", (v) => v],
      [
        "el formulario de P6, que no los manda",
        (v) => {
          const { unidadStockId, unidadCompraId, factorConversion, precioVenta, ...sinSensibles } = v;
          void [unidadStockId, unidadCompraId, factorConversion, precioVenta];
          return sinSensibles;
        },
      ],
    ];

    for (const [formulario, armar] of FORMULARIOS) {
      it.each(CAMBIOS)(`${formulario}, mientras el administrador cambia $campo → ese campo NO se pisa y el nombre sí se guarda`, async ({ campo, cambio, esperado, leer }) => {
        const vistoAlAbrir = { nombre: "Queso cremoso", tipo: "MP" as const, unidadStockId: kgId, unidadCompraId: gId, factorConversion: 25, precioVenta: 500 };
        const datos = armar(vistoAlAbrir, campo);
        const actor = actorConBarrera("producto", async () => {
          await prismaAdmin.producto.update({ where: { id: productoId }, data: cambio() });
        });
        const r = await actualizarProductoCasoDeUso(actor, {
          productoId,
          datos: datos as never,
          puerta: guardComandoDatosDeProducto({ datos }),
          puedeGestionarConsignacion: false,
          puedeEditarCamposSensibles: false,
        });
        expect(r.ok, r.mensaje).toBe(true);
        const p = await prisma.producto.findUniqueOrThrow({ where: { id: productoId } });
        expect(p.nombre).toBe("Queso cremoso");
        expect(leer(p), `${campo}: el valor del administrador`).toEqual(esperado());
      });
    }
  });
});
