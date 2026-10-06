import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, sembrarProductoDisponible, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { registrarMovimiento } from "../../src/server/actions/movimientos/movimientos";
import { registrarVenta } from "../../src/server/actions/movimientos/venta";
import { construirIndiceRecetas, type IndiceRecetas } from "../../src/core/reportes/comun";
import { obtenerIngredientesRecetaVigente } from "../../src/core/reportes/historial-producto";
import { compararRendimientosPorSucursal } from "../../src/core/reportes/rendimiento-por-sucursal";
import { calcularRendimientoRecetasSimples } from "../../src/core/reportes/rendimiento-recetas";
import { listarProductosConReceta } from "../../src/server/consultas/catalogo/recetas";
import { dependenciasParaDesactivar } from "../../src/server/lecturas/catalogo/dependencias-para-desactivar";
import { guardarReceta, listarVersionesDeReceta, obtenerRecetaVigente } from "../../src/server/actions/catalogo/recetas";
import { fijarRendimientoLocal } from "../../src/server/actions/catalogo/rendimiento-local";

/**
 * CARACTERIZACIÓN — congela cómo cada lector elige la receta VIGENTE (la de mayor `version` de cada plato) HOY, ANTES de unificar esa
 * elección en un solo lugar (`core/catalogo/recetas-vigentes.ts`). NO se edita al migrar un lector: si alguno cambia qué versión elige,
 * qué filas escribe o en qué orden devuelve, este archivo lo tiene que detectar en rojo. Los valores de los snapshots se capturaron de
 * una corrida real contra el código previo a la migración — no se derivaron a mano.
 *
 * El fixture arma los casos que un lector con el criterio equivocado resolvería distinto:
 *  - Pan: versiones 1 y 4 (se creó primero la 4, y faltan la 2 y la 3).
 *  - Torta: versiones 2 y 5, con calibraciones: la sucursal S1 calibró la línea de la versión VIEJA (2) y la de la vigente (5); S2 calibró
 *    la vigente.
 *  - Flan: la última versión (6) NO tiene ingredientes (la receta vigente quedó vacía; la 3 todavía usaba Azúcar).
 *  - Otro: disponible solo en S2, no en S1.
 * Ningún número de versión se repite entre platos: así el orden en que cada lector recorre los platos (que sale del `orderBy: version`)
 * es determinístico y también queda congelado.
 */
describe("Caracterización: qué versión de receta usa cada lector (vigente = mayor versión)", () => {
  let s1: string;
  let s2: string;
  let kg: string;
  let seccionId: string;
  let nombres: Map<string, string>;
  let ids: Record<"harina" | "sal" | "azucar" | "pan" | "torta" | "flan" | "otro", string>;

  const n = (id: string) => nombres.get(id) ?? `?${id}`;
  const fecha = new Date("2026-03-10T12:00:00Z");

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    s1 = base.sucursal.id;
    s2 = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    kg = (await sembrarCatalogoBase()).kg.id;
    seccionId = (await sembrarSeccion(s1, "Depósito")).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: s1, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const mp = (codigo: string, nombre: string) => sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: kg }, s1);
    const pv = (codigo: string, nombre: string, sucursalId: string, extra: { seProduce?: boolean } = {}) =>
      sembrarProductoDisponible({ codigo, nombre, tipo: "PV", unidadStockId: kg, precioVenta: 100, ...extra }, sucursalId);
    const harina = await mp("MP_HARINA", "Harina");
    const sal = await mp("MP_SAL", "Sal");
    const azucar = await mp("MP_AZUCAR", "Azúcar");
    const pan = await pv("PV_PAN", "Pan", s1, { seProduce: true });
    const torta = await pv("PV_TORTA", "Torta", s1);
    const flan = await pv("PV_FLAN", "Flan", s1);
    const otro = await pv("PV_OTRO", "Otro", s2);
    ids = { harina: harina.id, sal: sal.id, azucar: azucar.id, pan: pan.id, torta: torta.id, flan: flan.id, otro: otro.id };
    nombres = new Map([
      [harina.id, "Harina"], [sal.id, "Sal"], [azucar.id, "Azúcar"], [pan.id, "Pan"], [torta.id, "Torta"], [flan.id, "Flan"], [otro.id, "Otro"],
      [s1, "S1"], [s2, "S2"],
    ]);

    const version = (productoId: string, v: number, lineas: { mp: string; cantidad: number; merma?: number }[]) =>
      prisma.recetaVersion.create({
        data: {
          productoId, version: v,
          ingredientes: { create: lineas.map((l) => ({ insumoProductoId: l.mp, cantidad: l.cantidad, mermaPorcentaje: l.merma ?? 0, unidadId: kg })) },
        },
        include: { ingredientes: true },
      });

    await version(pan.id, 4, [{ mp: harina.id, cantidad: 2 }, { mp: sal.id, cantidad: 0.5 }]);
    await version(pan.id, 1, [{ mp: harina.id, cantidad: 1 }]);
    const torta2 = await version(torta.id, 2, [{ mp: azucar.id, cantidad: 1 }]);
    const torta5 = await version(torta.id, 5, [{ mp: azucar.id, cantidad: 1.5, merma: 10 }, { mp: harina.id, cantidad: 0.2 }]);
    await version(flan.id, 3, [{ mp: azucar.id, cantidad: 0.4 }]);
    await version(flan.id, 6, []);
    await version(otro.id, 7, [{ mp: sal.id, cantidad: 1 }]);

    const lineaAzucar = (v: typeof torta2) => v.ingredientes.find((i) => i.insumoProductoId === azucar.id)!.id;
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaAzucar(torta2), sucursalId: s1, cantidad: 9, mermaPorcentaje: null } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaAzucar(torta5), sucursalId: s1, cantidad: 1.8, mermaPorcentaje: 12 } });
    await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaAzucar(torta5), sucursalId: s2, cantidad: 2.5, mermaPorcentaje: null } });

    for (const [p, cantidad, precioTotal] of [[harina.id, 100, 500], [sal.id, 50, 250], [azucar.id, 80, 400]] as const) {
      const r = await registrarMovimiento({ proceso: "COMPRA", fecha, seccionId, items: [{ productoId: p, cantidad, precioTotal }] });
      expect(r.ok, r.mensaje).toBe(true);
    }
  });

  const aLineas = (ings: IndiceRecetas["recetaPorProducto"] extends Map<string, infer V> ? V : never) =>
    ings.map((i) => ({ insumo: i.insumoNombre, cantidad: i.cantidad, merma: i.mermaPorcentaje, cantidadCentral: i.cantidadCentral, mermaCentral: i.mermaPorcentajeCentral, calibrado: i.calibradoLocal }));
  const aIndice = (ix: IndiceRecetas) => ({
    sucursal: ix.sucursalId === null ? null : n(ix.sucursalId),
    productosEnOrden: [...ix.recetaPorProducto].map(([id, ings]) => [n(id), aLineas(ings)]),
    mpsEnRecetasEnOrden: [...ix.mpsEnRecetas].map(n),
  });
  const filasDe = async (proceso: string) => {
    const filas = await prisma.movimientoStock.findMany({
      where: { operacion: { proceso: proceso as never } },
      orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
    });
    return filas.map((m) => [m.proceso, n(m.productoId), Number(m.cantidad)]);
  };
  const lineaDe = async (productoId: string, v: number, mpId: string) =>
    (await prisma.recetaIngrediente.findFirstOrThrow({ where: { insumoProductoId: mpId, recetaVersion: { productoId, version: v } } })).id;

  it("construirIndiceRecetas: una receta por plato (la de mayor versión), en el orden en que aparece cada plato — central, en S1 y en S2", async () => {
    expect(aIndice(await construirIndiceRecetas(prisma))).toMatchInlineSnapshot(`
      {
        "mpsEnRecetasEnOrden": [
          "Harina",
          "Sal",
          "Azúcar",
        ],
        "productosEnOrden": [
          [
            "Pan",
            [
              {
                "calibrado": false,
                "cantidad": 2,
                "cantidadCentral": 2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
              {
                "calibrado": false,
                "cantidad": 0.5,
                "cantidadCentral": 0.5,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Torta",
            [
              {
                "calibrado": false,
                "cantidad": 1.5,
                "cantidadCentral": 1.5,
                "insumo": "Azúcar",
                "merma": 10,
                "mermaCentral": 10,
              },
              {
                "calibrado": false,
                "cantidad": 0.2,
                "cantidadCentral": 0.2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Flan",
            [],
          ],
          [
            "Otro",
            [
              {
                "calibrado": false,
                "cantidad": 1,
                "cantidadCentral": 1,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
        ],
        "sucursal": null,
      }
    `);
    expect(aIndice(await construirIndiceRecetas(prisma, s1))).toMatchInlineSnapshot(`
      {
        "mpsEnRecetasEnOrden": [
          "Harina",
          "Sal",
          "Azúcar",
        ],
        "productosEnOrden": [
          [
            "Pan",
            [
              {
                "calibrado": false,
                "cantidad": 2,
                "cantidadCentral": 2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
              {
                "calibrado": false,
                "cantidad": 0.5,
                "cantidadCentral": 0.5,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Torta",
            [
              {
                "calibrado": true,
                "cantidad": 1.8,
                "cantidadCentral": 1.5,
                "insumo": "Azúcar",
                "merma": 12,
                "mermaCentral": 10,
              },
              {
                "calibrado": false,
                "cantidad": 0.2,
                "cantidadCentral": 0.2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Flan",
            [],
          ],
          [
            "Otro",
            [
              {
                "calibrado": false,
                "cantidad": 1,
                "cantidadCentral": 1,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
        ],
        "sucursal": "S1",
      }
    `);
    expect(aIndice(await construirIndiceRecetas(prisma, s2))).toMatchInlineSnapshot(`
      {
        "mpsEnRecetasEnOrden": [
          "Harina",
          "Sal",
          "Azúcar",
        ],
        "productosEnOrden": [
          [
            "Pan",
            [
              {
                "calibrado": false,
                "cantidad": 2,
                "cantidadCentral": 2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
              {
                "calibrado": false,
                "cantidad": 0.5,
                "cantidadCentral": 0.5,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Torta",
            [
              {
                "calibrado": true,
                "cantidad": 2.5,
                "cantidadCentral": 1.5,
                "insumo": "Azúcar",
                "merma": 10,
                "mermaCentral": 10,
              },
              {
                "calibrado": false,
                "cantidad": 0.2,
                "cantidadCentral": 0.2,
                "insumo": "Harina",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
          [
            "Flan",
            [],
          ],
          [
            "Otro",
            [
              {
                "calibrado": false,
                "cantidad": 1,
                "cantidadCentral": 1,
                "insumo": "Sal",
                "merma": 0,
                "mermaCentral": 0,
              },
            ],
          ],
        ],
        "sucursal": "S2",
      }
    `);
  });

  it("producción y venta: consumen los ingredientes de la versión vigente (Pan v4, Torta v5, Flan v6 sin ingredientes)", async () => {
    const produccion = await registrarMovimiento({ proceso: "PRODUCCION", fecha, seccionId, items: [{ productoId: ids.pan, cantidad: 3 }] });
    expect({ ok: produccion.ok, mensaje: produccion.mensaje }).toMatchInlineSnapshot(`
      {
        "mensaje": "Se guardaron 3 movimiento(s).",
        "ok": true,
      }
    `);
    expect(await filasDe("PRODUCCION")).toMatchInlineSnapshot(`
      [
        [
          "PRODUCCION",
          "Pan",
          3,
        ],
        [
          "CONSUMO",
          "Harina",
          -6,
        ],
        [
          "CONSUMO",
          "Sal",
          -1.5,
        ],
      ]
    `);

    const ventaTorta = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: ids.torta, cantidadVendida: 2 }] });
    expect({ ok: ventaTorta.ok, mensaje: ventaTorta.mensaje }).toMatchInlineSnapshot(`
      {
        "mensaje": "Se registraron 1 venta(s) correctamente.",
        "ok": true,
      }
    `);
    const ventaFlan = await registrarVenta({ fecha, seccionId, ventas: [{ productoId: ids.flan, cantidadVendida: 1 }] });
    expect({ ok: ventaFlan.ok, mensaje: ventaFlan.mensaje }).toMatchInlineSnapshot(`
      {
        "mensaje": "Se registraron 1 venta(s) correctamente.",
        "ok": true,
      }
    `);
    expect(await filasDe("VENTA")).toMatchInlineSnapshot(`
      [
        [
          "CONSUMO",
          "Azúcar",
          -4.03,
        ],
        [
          "CONSUMO",
          "Harina",
          -0.4,
        ],
        [
          "VENTA",
          "Torta",
          -2,
        ],
        [
          "VENTA",
          "Flan",
          -1,
        ],
      ]
    `);
  });

  it("obtenerIngredientesRecetaVigente: central, calibrado en S1 / S2, receta vacía y producto sin receta", async () => {
    const ver = async (productoId: string, sucursalId?: string) => (await obtenerIngredientesRecetaVigente(productoId, prisma, sucursalId)).map((i) => [i.nombre, i.cantidad, i.unidad]);
    expect({
      tortaCentral: await ver(ids.torta),
      tortaS1: await ver(ids.torta, s1),
      tortaS2: await ver(ids.torta, s2),
      panCentral: await ver(ids.pan),
      flan: await ver(ids.flan),
      sinReceta: await ver(ids.harina),
    }).toMatchInlineSnapshot(`
      {
        "flan": [],
        "panCentral": [
          [
            "Harina",
            2,
            "kg",
          ],
          [
            "Sal",
            0.5,
            "kg",
          ],
        ],
        "sinReceta": [],
        "tortaCentral": [
          [
            "Azúcar",
            1.5,
            "kg",
          ],
          [
            "Harina",
            0.2,
            "kg",
          ],
        ],
        "tortaS1": [
          [
            "Azúcar",
            1.8,
            "kg",
          ],
          [
            "Harina",
            0.2,
            "kg",
          ],
        ],
        "tortaS2": [
          [
            "Azúcar",
            2.5,
            "kg",
          ],
          [
            "Harina",
            0.2,
            "kg",
          ],
        ],
      }
    `);
  });

  it("compararRendimientosPorSucursal: solo las líneas VIGENTES, con todas / solo calibradas / un plato", async () => {
    const aFilas = (filas: Awaited<ReturnType<typeof compararRendimientosPorSucursal>>) =>
      filas.map((f) => ({ plato: f.productoNombre, insumo: f.insumoNombre, central: f.central, algunaCalibrada: f.algunaCalibrada, porSucursal: [...f.porSucursal].map(([id, v]) => [n(id), v]) }));
    const sucursales = [{ id: s1, nombre: "S1" }, { id: s2, nombre: "S2" }];
    expect({
      todas: aFilas(await compararRendimientosPorSucursal(sucursales, { todas: true }, prisma)),
      soloCalibradas: aFilas(await compararRendimientosPorSucursal(sucursales, {}, prisma)),
      soloTortaTodas: aFilas(await compararRendimientosPorSucursal(sucursales, { productoId: ids.torta, todas: true }, prisma)),
    }).toMatchInlineSnapshot(`
      {
        "soloCalibradas": [
          {
            "algunaCalibrada": true,
            "central": {
              "bruto": 1.65,
              "cantidad": 1.5,
              "mermaPorcentaje": 10,
            },
            "insumo": "Azúcar",
            "plato": "Torta",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 2.016,
                  "calibrado": true,
                  "cantidad": 1.8,
                  "desviacionPorcentaje": 22.2,
                  "mermaPorcentaje": 12,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 2.75,
                  "calibrado": true,
                  "cantidad": 2.5,
                  "desviacionPorcentaje": 66.7,
                  "mermaPorcentaje": 10,
                  "recetaPropia": false,
                },
              ],
            ],
          },
        ],
        "soloTortaTodas": [
          {
            "algunaCalibrada": true,
            "central": {
              "bruto": 1.65,
              "cantidad": 1.5,
              "mermaPorcentaje": 10,
            },
            "insumo": "Azúcar",
            "plato": "Torta",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 2.016,
                  "calibrado": true,
                  "cantidad": 1.8,
                  "desviacionPorcentaje": 22.2,
                  "mermaPorcentaje": 12,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 2.75,
                  "calibrado": true,
                  "cantidad": 2.5,
                  "desviacionPorcentaje": 66.7,
                  "mermaPorcentaje": 10,
                  "recetaPropia": false,
                },
              ],
            ],
          },
          {
            "algunaCalibrada": false,
            "central": {
              "bruto": 0.2,
              "cantidad": 0.2,
              "mermaPorcentaje": 0,
            },
            "insumo": "Harina",
            "plato": "Torta",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 0.2,
                  "calibrado": false,
                  "cantidad": 0.2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 0.2,
                  "calibrado": false,
                  "cantidad": 0.2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
            ],
          },
        ],
        "todas": [
          {
            "algunaCalibrada": false,
            "central": {
              "bruto": 1,
              "cantidad": 1,
              "mermaPorcentaje": 0,
            },
            "insumo": "Sal",
            "plato": "Otro",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 1,
                  "calibrado": false,
                  "cantidad": 1,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 1,
                  "calibrado": false,
                  "cantidad": 1,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
            ],
          },
          {
            "algunaCalibrada": false,
            "central": {
              "bruto": 2,
              "cantidad": 2,
              "mermaPorcentaje": 0,
            },
            "insumo": "Harina",
            "plato": "Pan",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 2,
                  "calibrado": false,
                  "cantidad": 2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 2,
                  "calibrado": false,
                  "cantidad": 2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
            ],
          },
          {
            "algunaCalibrada": false,
            "central": {
              "bruto": 0.5,
              "cantidad": 0.5,
              "mermaPorcentaje": 0,
            },
            "insumo": "Sal",
            "plato": "Pan",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 0.5,
                  "calibrado": false,
                  "cantidad": 0.5,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 0.5,
                  "calibrado": false,
                  "cantidad": 0.5,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
            ],
          },
          {
            "algunaCalibrada": true,
            "central": {
              "bruto": 1.65,
              "cantidad": 1.5,
              "mermaPorcentaje": 10,
            },
            "insumo": "Azúcar",
            "plato": "Torta",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 2.016,
                  "calibrado": true,
                  "cantidad": 1.8,
                  "desviacionPorcentaje": 22.2,
                  "mermaPorcentaje": 12,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 2.75,
                  "calibrado": true,
                  "cantidad": 2.5,
                  "desviacionPorcentaje": 66.7,
                  "mermaPorcentaje": 10,
                  "recetaPropia": false,
                },
              ],
            ],
          },
          {
            "algunaCalibrada": false,
            "central": {
              "bruto": 0.2,
              "cantidad": 0.2,
              "mermaPorcentaje": 0,
            },
            "insumo": "Harina",
            "plato": "Torta",
            "porSucursal": [
              [
                "S1",
                {
                  "bruto": 0.2,
                  "calibrado": false,
                  "cantidad": 0.2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
              [
                "S2",
                {
                  "bruto": 0.2,
                  "calibrado": false,
                  "cantidad": 0.2,
                  "desviacionPorcentaje": 0,
                  "mermaPorcentaje": 0,
                  "recetaPropia": false,
                },
              ],
            ],
          },
        ],
      }
    `);
  });

  it("calcularRendimientoRecetasSimples (S1): una fila por línea de la receta vigente de los platos disponibles en S1", async () => {
    const filas = await calcularRendimientoRecetasSimples(s1, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-31T23:59:59Z"), prisma);
    expect(
      filas
        .map((f) => ({
          plato: f.productoVentaNombre, insumo: f.insumoONombre, cantidadActual: f.cantidadActual, cantidadCentral: f.cantidadActualCentral,
          calibradoLocal: f.calibradoLocal, mermaActual: f.mermaActual, totalComprado: f.totalComprado, rotulo: f.rotulo,
        }))
        .sort((a, b) => a.plato.localeCompare(b.plato) || a.insumo.localeCompare(b.insumo))
    ).toMatchInlineSnapshot(`
      [
        {
          "calibradoLocal": false,
          "cantidadActual": 0.5,
          "cantidadCentral": 0.5,
          "insumo": "Sal",
          "mermaActual": 0,
          "plato": "Pan",
          "rotulo": null,
          "totalComprado": 50,
        },
        {
          "calibradoLocal": true,
          "cantidadActual": 1.8,
          "cantidadCentral": 1.5,
          "insumo": "Azúcar",
          "mermaActual": 12,
          "plato": "Torta",
          "rotulo": null,
          "totalComprado": 80,
        },
      ]
    `);
  });

  it("obtenerRecetaVigente / listarVersionesDeReceta / listarProductosConReceta", async () => {
    const aReceta = (r: Awaited<ReturnType<typeof obtenerRecetaVigente>>) =>
      r === null ? null : { version: r.version, ingredientes: r.ingredientes.map((i) => [n(i.insumoProductoId), Number(i.cantidad)]) };
    const versiones = async (productoId: string) => (await listarVersionesDeReceta(productoId)).map((v) => v.version);
    expect({
      torta: aReceta(await obtenerRecetaVigente(ids.torta)),
      pan: aReceta(await obtenerRecetaVigente(ids.pan)),
      flan: aReceta(await obtenerRecetaVigente(ids.flan)),
      sinReceta: aReceta(await obtenerRecetaVigente(ids.harina)),
      versionesTorta: await versiones(ids.torta),
      versionesPan: await versiones(ids.pan),
      versionesFlan: await versiones(ids.flan),
    }).toMatchInlineSnapshot(`
      {
        "flan": {
          "ingredientes": [],
          "version": 6,
        },
        "pan": {
          "ingredientes": [
            [
              "Harina",
              2,
            ],
            [
              "Sal",
              0.5,
            ],
          ],
          "version": 4,
        },
        "sinReceta": null,
        "torta": {
          "ingredientes": [
            [
              "Azúcar",
              1.5,
            ],
            [
              "Harina",
              0.2,
            ],
          ],
          "version": 5,
        },
        "versionesFlan": [
          6,
          3,
        ],
        "versionesPan": [
          4,
          1,
        ],
        "versionesTorta": [
          5,
          2,
        ],
      }
    `);

    const lista = await listarProductosConReceta(prisma);
    expect(lista.map((p) => ({ plato: p.nombre, versiones: p.recetaVersiones.map((v) => [v.version, v._count.ingredientes]) }))).toMatchInlineSnapshot(`
      [
        {
          "plato": "Flan",
          "versiones": [
            [
              6,
              0,
            ],
          ],
        },
        {
          "plato": "Otro",
          "versiones": [
            [
              7,
              1,
            ],
          ],
        },
        {
          "plato": "Pan",
          "versiones": [
            [
              4,
              2,
            ],
          ],
        },
        {
          "plato": "Torta",
          "versiones": [
            [
              5,
              2,
            ],
          ],
        },
      ]
    `);
  });

  it("dependenciasParaDesactivar: solo cuentan los platos cuya receta VIGENTE usa el insumo, disponibles en la sucursal", async () => {
    const ver = async (productoId: string, sucursalId: string) => (await dependenciasParaDesactivar(productoId, sucursalId, prisma)).recetasVigentes.map((r) => r.nombre);
    expect({
      azucarS1: await ver(ids.azucar, s1),
      harinaS1: await ver(ids.harina, s1),
      salS1: await ver(ids.sal, s1),
      salS2: await ver(ids.sal, s2),
    }).toMatchInlineSnapshot(`
      {
        "azucarS1": [
          "Torta",
        ],
        "harinaS1": [
          "Pan",
          "Torta",
        ],
        "salS1": [
          "Pan",
        ],
        "salS2": [
          "Otro",
        ],
      }
    `);
  });

  it("fijarRendimientoLocal: rechaza la línea de una versión vieja y acepta la de la vigente", async () => {
    const vieja = await fijarRendimientoLocal(await lineaDe(ids.torta, 2, ids.azucar), { cantidad: 3, mermaPorcentaje: null });
    const vigente = await fijarRendimientoLocal(await lineaDe(ids.torta, 5, ids.azucar), { cantidad: 3, mermaPorcentaje: null });
    expect({ vieja, vigente }).toMatchInlineSnapshot(`
      {
        "vieja": {
          "mensaje": "La receta cambió mientras mirabas el reporte; recargá.",
          "ok": false,
        },
        "vigente": {
          "mensaje": "Rendimiento de "Azúcar" en "Torta" calibrado para «Central».",
          "ok": true,
        },
      }
    `);
    const fila = await prisma.rendimientoLocalIngrediente.findFirstOrThrow({
      where: { sucursalId: s1, recetaIngrediente: { recetaVersion: { productoId: ids.torta, version: 5 }, insumoProductoId: ids.azucar } },
    });
    expect([Number(fila.cantidad), fila.mermaPorcentaje === null ? null : Number(fila.mermaPorcentaje)]).toMatchInlineSnapshot(`
      [
        3,
        null,
      ]
    `);
  });

  it("guardarReceta: la versión nueva es MAX(version)+1 y arrastra las calibraciones de la vigente", async () => {
    const r = await guardarReceta(ids.torta, [
      { insumoProductoId: ids.azucar, cantidad: 1.5, unidadId: kg, mermaPorcentaje: 10 },
      { insumoProductoId: ids.harina, cantidad: 0.2, unidadId: kg },
    ]);
    expect({ ok: r.ok, mensaje: r.mensaje }).toMatchInlineSnapshot(`
      {
        "mensaje": "Receta de "Torta" guardada como versión 6.",
        "ok": true,
      }
    `);
    const versiones = await prisma.recetaVersion.findMany({
      where: { productoId: ids.torta },
      orderBy: { version: "asc" },
      include: { ingredientes: { include: { rendimientosLocales: true, insumoProducto: { select: { nombre: true } } } } },
    });
    expect(
      versiones.map((v) => ({
        version: v.version,
        lineas: v.ingredientes
          .map((i) => ({ insumo: i.insumoProducto.nombre, calibraciones: i.rendimientosLocales.map((c) => [n(c.sucursalId), c.cantidad === null ? null : Number(c.cantidad), c.mermaPorcentaje === null ? null : Number(c.mermaPorcentaje)]).sort() }))
          .sort((a, b) => a.insumo.localeCompare(b.insumo)),
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "lineas": [
            {
              "calibraciones": [
                [
                  "S1",
                  9,
                  null,
                ],
              ],
              "insumo": "Azúcar",
            },
          ],
          "version": 2,
        },
        {
          "lineas": [
            {
              "calibraciones": [
                [
                  "S1",
                  1.8,
                  12,
                ],
                [
                  "S2",
                  2.5,
                  null,
                ],
              ],
              "insumo": "Azúcar",
            },
            {
              "calibraciones": [],
              "insumo": "Harina",
            },
          ],
          "version": 5,
        },
        {
          "lineas": [
            {
              "calibraciones": [
                [
                  "S1",
                  1.8,
                  12,
                ],
                [
                  "S2",
                  2.5,
                  null,
                ],
              ],
              "insumo": "Azúcar",
            },
            {
              "calibraciones": [],
              "insumo": "Harina",
            },
          ],
          "version": 6,
        },
      ]
    `);
  });
});
