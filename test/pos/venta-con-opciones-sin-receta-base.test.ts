import { ZONA_ARGENTINA } from "../../src/core/tiempo/zona-horaria";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarProductoDisponible } from "../setup/test-db";
import { entrarComo, sembrarCuenta, sembrarSalon } from "./salon-fixture";
import { sembrarGaseosaPorOpcion, sembrarLineaConOpcion, sembrarLineaDeGaseosa, type GaseosaPorOpcion } from "./gaseosa-fixture";
import { agregarItems } from "../../src/server/actions/pos/cuenta-pedido";
import { agregarItemsCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/agregar-items";
import { cerrarCuentaCasoDeUso } from "../../src/server/actions/pos/casos-de-uso/cerrar-cuenta";
import { volverALaRecetaCentralCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/volver-a-la-receta-central";
import { generarReporteVentasSinReceta } from "../../src/server/consultas/reportes/ventas-sin-receta";
import type { Transaccion } from "../../src/lib/db-tipos";

/**
 * Ventas con opciones, paso 2 (diseño 2026-10-29, secciones D y E), contra Postgres real: el aviso temprano al AGREGAR a la cuenta y el cobro dan el MISMO veredicto, para cada combinación de
 * modo de venta × base × fuente de la receta efectiva × consumo de la opción (MATRIZ DE 24 CASOS), y lo que se descuenta es exactamente lo que dice el oráculo escrito aquí aparte (una tabla por
 * base y consumo, que no sale del código). Más: idempotencia I1 (el rechazo no gasta la clave; arreglada la base, el reintento agrega una sola vez) y la carrera C1 (la sucursal vuelve a la receta
 * central vacía mientras se cobra).
 */
let s: Awaited<ReturnType<typeof sembrarSalon>>;
const baseDe = (sucursal: string) => baseDeTest({ lectura: [sucursal], escritura: [sucursal] });
const actor = () => ({ usuarioId: s.admin.id, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: s.sucursalId, sucursalNombre: s.sucursal.nombre, email: "admin@test.com", empresaZonaHoraria: ZONA_ARGENTINA, ahora: new Date(), ...baseDe(s.sucursalId) });

beforeEach(async () => {
  await limpiarBaseDeTest();
  s = await sembrarSalon();
  await entrarComo(s.admin);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// La matriz de 24 casos
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Modo = "DIRECTO con VARIANTE opcional" | "BASE_CONFIGURABLE con MEDIDA ABSOLUTO";
type Base = "vacía" | "con X";
type Fuente = "central" | "propia habilitada";
type Consumo = "ninguno" | "SUMA Y" | "REEMPLAZA X→Y";
const MODOS: readonly Modo[] = ["DIRECTO con VARIANTE opcional", "BASE_CONFIGURABLE con MEDIDA ABSOLUTO"];
const BASES: readonly Base[] = ["vacía", "con X"];
const FUENTES: readonly Fuente[] = ["central", "propia habilitada"];
const CONSUMOS: readonly Consumo[] = ["ninguno", "SUMA Y", "REEMPLAZA X→Y"];

/**
 * EL ORÁCULO (a mano, aparte del código): con la base de un ingrediente X se vende siempre y se descuenta la base más/menos lo que hace la opción; con la base vacía se vende solo si la opción SUMA
 * (un REEMPLAZA no tiene qué reemplazar). `null` = se rechaza.
 */
const ESPERADO: Readonly<Record<Base, Readonly<Record<Consumo, readonly string[] | null>>>> = {
  "con X": { ninguno: ["X"], "SUMA Y": ["X", "Y"], "REEMPLAZA X→Y": ["Y"] },
  vacía: { ninguno: null, "SUMA Y": ["Y"], "REEMPLAZA X→Y": null },
};

/** El producto del caso, la opción elegida y su versión, con las dos fuentes de receta: la EFECTIVA con `base` y la otra con el contenido contrario (para probar que se lee la efectiva). */
async function sembrarCaso(modo: Modo, base: Base, fuente: Fuente, consumo: Consumo) {
  const mp = async (codigo: string, nombre: string) => (await sembrarProductoDisponible({ codigo, nombre, tipo: "MP", unidadStockId: s.unidad.id }, s.sucursalId)).id;
  const x = await mp("MP_X", "Insumo X");
  const y = await mp("MP_Y", "Insumo Y");
  const porOpcion = modo === "BASE_CONFIGURABLE con MEDIDA ABSOLUTO";
  const producto = await sembrarProductoDisponible(
    { codigo: "PV_CASO", nombre: "Producto del caso", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: 2500, ...(porOpcion ? { modoDeVenta: "BASE_CONFIGURABLE" } : {}) },
    s.sucursalId
  );
  // Las recetas: la efectiva tiene `base`; la otra fuente, lo contrario (con X si la efectiva está vacía, sin nada si tiene X).
  const conX = (sucursalId: string | null) =>
    prisma.recetaVersion.create({ data: { productoId: producto.id, version: 1, ...(sucursalId ? { sucursalId } : {}), ingredientes: { create: [{ insumoProductoId: x, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }] } } });
  const vacia = (sucursalId: string | null) => prisma.recetaVersion.create({ data: { productoId: producto.id, version: 1, ...(sucursalId ? { sucursalId } : {}), ingredientes: { create: [] } } });
  if (fuente === "central") {
    if (base === "con X") await conX(null);
    else await vacia(null);
    // La propia queda DESHABILITADA con el contenido contrario: no es la efectiva.
    if (base === "vacía") await conX(s.sucursalId);
    await prisma.recetaSucursal.create({ data: { sucursalId: s.sucursalId, productoId: producto.id, habilitada: false } });
  } else {
    // La propia es la efectiva; la central tiene lo contrario.
    if (base === "vacía") await conX(null);
    if (base === "con X") await conX(s.sucursalId);
    else await vacia(s.sucursalId);
    await prisma.recetaSucursal.create({ data: { sucursalId: s.sucursalId, productoId: producto.id, habilitada: true } });
  }

  const grupo = await prisma.grupoDeOpciones.create({ data: porOpcion ? { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } : { nombre: "Variante", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
  const opcion = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "La opción", orden: 1 } });
  const version = await prisma.versionDeOpcion.create({
    data: { opcionId: opcion.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", ...(porOpcion ? { factorEscala: "1.0000" } : {}), creadoPorId: s.admin.id },
  });
  if (consumo === "SUMA Y") await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: version.id, efecto: "SUMA", insumoProductoId: y, cantidad: "1.0000", unidadId: s.unidad.id } });
  if (consumo === "REEMPLAZA X→Y") {
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: version.id, efecto: "REEMPLAZA", insumoProductoId: y, reemplazaAProductoId: x, cantidad: "1.0000", unidadId: s.unidad.id } });
  }
  await prisma.productoAdmiteGrupo.create({ data: { productoId: producto.id, grupoId: grupo.id, orden: 0, ...(porOpcion ? { modoPrecio: "ABSOLUTO" } : {}) } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: producto.id, opcionId: opcion.id, ...(porOpcion ? { precioAbsoluto: "3000.00" } : {}) } });
  return { productoId: producto.id, opcionId: opcion.id, versionId: version.id, insumo: { [x]: "X", [y]: "Y" } as Record<string, string> };
}

describe("matriz de 24 casos: agregar y cobrar dan el mismo veredicto, y se descuenta lo que dice el oráculo", () => {
  for (const modo of MODOS)
    for (const base of BASES)
      for (const fuente of FUENTES)
        for (const consumo of CONSUMOS) {
          it(`${modo} · base ${base} (${fuente}, la otra fuente al revés) · opción ${consumo}`, async () => {
            const c = await sembrarCaso(modo, base, fuente, consumo);
            const esperado = ESPERADO[base][consumo];
            const opciones = [{ opcionId: c.opcionId, cantidad: 1, versionDeOpcionId: c.versionId }];

            // AGREGAR a la cuenta (el aviso temprano).
            const cuentaDeAgregar = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
            const agregado = await agregarItemsCasoDeUso(actor(), { cuentaId: cuentaDeAgregar, items: [{ productoId: c.productoId, cantidad: 1, opciones }], promos: [] });
            expect(agregado.ok, JSON.stringify(agregado)).toBe(esperado !== null);
            if (!agregado.ok) expect(agregado.codigo).toBe("PRODUCTO_SIN_RECETA");

            // COBRAR (la barrera final), con la línea sembrada directo para que el veredicto no dependa del aviso.
            const mesa2 = await prisma.mesa.create({ data: { sucursalId: s.sucursalId, numero: 5 } });
            const cuentaDeCobrar = (await sembrarCuenta(mesa2.id, s.admin.id)).id;
            await sembrarLineaConOpcion(s, { productoId: c.productoId, cuentaId: cuentaDeCobrar, opcionId: c.opcionId, versionDeOpcionId: c.versionId, precioBase: 2500 });
            const cobro = await cerrarCuentaCasoDeUso(actor(), { cuentaId: cuentaDeCobrar });
            expect(cobro.ok, JSON.stringify(cobro)).toBe(esperado !== null);

            if (esperado === null) {
              // Rechazo: el mismo código y el mismo texto en los dos lugares (nombra la opción), sin nada escrito por el cobro.
              expect(cobro.ok).toBe(false);
              if (!agregado.ok && !cobro.ok) {
                expect(cobro.codigo).toBe("PRODUCTO_SIN_RECETA");
                expect(agregado.mensaje).toBe(cobro.mensaje);
                expect(cobro.mensaje).toContain("“La opción”");
              }
              expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
              expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(0);
            } else {
              // Venta: el conjunto de CONSUMO es el del oráculo (por nombre de insumo).
              const consumos = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO" } });
              expect(consumos.map((m) => c.insumo[m.productoId]!).sort()).toEqual([...esperado].sort());
              expect(await prisma.operacion.count({ where: { proceso: "VENTA" } })).toBe(1);
            }
            // Ninguna venta quedó sin consumo: «Ventas sin receta» vacío.
            expect(await generarReporteVentasSinReceta(s.sucursalId, prisma)).toEqual([]);
          });
        }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// I1: idempotencia del agregado
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("I1, idempotencia al agregar una base sin receta con una opción sin consumo", () => {
  const CLAVE = "55555555-5555-4555-8555-555555555555";
  let g: GaseosaPorOpcion;
  beforeEach(async () => {
    g = await sembrarGaseosaPorOpcion(s);
  });
  const pedir = (cuentaId: string) => agregarItems(cuentaId, [{ productoId: g.gaseosaId, cantidad: 1, opciones: [{ opcionId: g.fantaId, cantidad: 1, versionDeOpcionId: g.versionDe[g.fantaId]! }] }], [], CLAVE);

  it("el rechazo no gasta la clave ni deja filas; arreglada la base (receta propia habilitada), el reintento con el mismo pedido y la misma clave agrega UNA vez, y un tercero devuelve el mensaje original", async () => {
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const mensajeFanta = "“Gaseosa 500 cc” con “Fanta” no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “Gaseosa 500 cc” en Catálogo → Recetas.";
    for (let i = 0; i < 2; i++) expect(await pedir(cuentaId)).toEqual({ ok: false, mensaje: mensajeFanta });
    expect(await prisma.cuentaItem.count()).toBe(0);
    expect(await prisma.agregadoDeCuenta.count()).toBe(0);

    // Se arregla la base (la receta propia de la sucursal, con un ingrediente) y se reintenta con la misma clave.
    const masa = await sembrarProductoDisponible({ codigo: "MP_BASE_GASEOSA", nombre: "Base de gaseosa", tipo: "MP", unidadStockId: s.unidad.id }, s.sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: g.gaseosaId, version: 1, sucursalId: s.sucursalId, ingredientes: { create: [{ insumoProductoId: masa.id, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }] } } });
    await prisma.recetaSucursal.create({ data: { sucursalId: s.sucursalId, productoId: g.gaseosaId, habilitada: true } });
    expect(await pedir(cuentaId)).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(await pedir(cuentaId)).toEqual({ ok: true, mensaje: "Se agregó 1 ítem a la mesa 4." });
    expect(await prisma.cuentaItem.count()).toBe(1);
    expect(await prisma.agregadoDeCuenta.count()).toBe(1);
  });

  it("si en vez de la base se arregla la OPCIÓN (versión nueva con consumo), el reintento con la versión vieja da OPCION_CAMBIO: hay que volver a elegir", async () => {
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    const pedido = { cuentaId, items: [{ productoId: g.gaseosaId, cantidad: 1, opciones: [{ opcionId: g.fantaId, cantidad: 1, versionDeOpcionId: g.versionDe[g.fantaId]! }] }], promos: [], claveIdempotencia: CLAVE };
    expect((await agregarItemsCasoDeUso(actor(), pedido)).ok).toBe(false);
    const v2 = await prisma.versionDeOpcion.create({ data: { opcionId: g.fantaId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: s.admin.id } });
    await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: v2.id, efecto: "SUMA", insumoProductoId: g.botellaId, cantidad: "1.0000", unidadId: s.unidad.id } });
    const reintento = await agregarItemsCasoDeUso(actor(), pedido);
    expect(reintento.ok).toBe(false);
    if (!reintento.ok) expect(reintento.codigo).toBe("OPCION_CAMBIO");
    expect(await prisma.cuentaItem.count()).toBe(0);
    expect(await prisma.agregadoDeCuenta.count()).toBe(0);
    // Volviendo a elegir con la versión nueva, se agrega.
    const nuevo = await agregarItemsCasoDeUso(actor(), { ...pedido, items: [{ productoId: g.gaseosaId, cantidad: 1, opciones: [{ opcionId: g.fantaId, cantidad: 1, versionDeOpcionId: v2.id }] }] });
    expect(nuevo.ok, JSON.stringify(nuevo)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// C1: volver a la receta central vacía MIENTRAS se cobra
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe("C1: la sucursal vuelve a la receta central VACÍA mientras se cobra «Gaseosa · Fanta» (la opción no tiene consumo)", () => {
  it("intercalado forzado: o vende con la receta propia que leyó (con su CONSUMO) o, si Postgres lo hace reintentar, rechaza sin escribir; nunca una venta sin consumo", async () => {
    const g = await sembrarGaseosaPorOpcion(s);
    const masa = await sembrarProductoDisponible({ codigo: "MP_MASA_GASEOSA", nombre: "Masa de gaseosa", tipo: "MP", unidadStockId: s.unidad.id }, s.sucursalId);
    await prisma.recetaVersion.create({ data: { productoId: g.gaseosaId, version: 1, sucursalId: s.sucursalId, ingredientes: { create: [{ insumoProductoId: masa.id, cantidad: 1, unidadId: s.unidad.id, mermaPorcentaje: 0 }] } } });
    await prisma.recetaSucursal.create({ data: { sucursalId: s.sucursalId, productoId: g.gaseosaId, habilitada: true } });
    const cuentaId = (await sembrarCuenta(s.mesa.id, s.admin.id)).id;
    await sembrarLineaDeGaseosa(s, g, cuentaId, g.fantaId);

    const base = baseDe(s.sucursalId);
    let avisarFoto!: () => void;
    const fotoTomada = new Promise<void>((r) => (avisarFoto = r));
    let soltar!: () => void;
    const suelto = new Promise<void>((r) => (soltar = r));
    let intentos = 0;
    // La primera consulta de la transacción fija su foto; en el PRIMER intento el cierre espera ahí hasta que «volver a la central» confirmó.
    const transaccion: Transaccion = Object.assign(
      <T,>(fn: (tx: Parameters<Parameters<Transaccion>[0]>[0]) => Promise<T>, opciones?: Parameters<Transaccion>[1]) =>
        base.transaccion(async (tx) => {
          intentos++;
          await tx.recetaSucursal.findMany({ where: { productoId: g.gaseosaId }, select: { habilitada: true } });
          if (intentos === 1) {
            avisarFoto();
            await suelto;
          }
          return fn(tx);
        }, opciones),
      { aleatorio: () => 0 }
    );
    const cierre = cerrarCuentaCasoDeUso({ ...actor(), transaccion }, { cuentaId });
    await fotoTomada;
    expect((await volverALaRecetaCentralCasoDeUso(actor(), { productoId: g.gaseosaId })).ok).toBe(true);
    soltar();
    const r = await cierre;

    const ventas = await prisma.operacion.findMany({ where: { proceso: "VENTA" }, include: { movimientos: true } });
    const cuenta = await prisma.cuenta.findUniqueOrThrow({ where: { id: cuentaId } });
    if (r.ok) {
      // La foto era la de antes de volver a la central: vende con la receta propia, CON su consumo.
      expect(ventas).toHaveLength(1);
      expect(ventas[0]!.movimientos.map((m) => [m.proceso, m.productoId]).sort()).toEqual([
        ["CONSUMO", masa.id],
        ["VENTA", g.gaseosaId],
      ]);
      expect(cuenta.cerradaEn).not.toBeNull();
    } else {
      // Si el conflicto lo hizo reintentar, el reintento ve la receta central vacía y la opción sin consumo: rechaza sin escribir.
      expect(intentos).toBeGreaterThan(1);
      expect(r.codigo).toBe("PRODUCTO_SIN_RECETA");
      expect(r.mensaje).toContain("“Fanta” no descuenta ningún insumo");
      expect(ventas).toEqual([]);
      expect(await prisma.movimientoStock.count({ where: { proceso: { in: ["VENTA", "CONSUMO"] } } })).toBe(0);
      expect(cuenta.cerradaEn).toBeNull();
    }
  });
});

