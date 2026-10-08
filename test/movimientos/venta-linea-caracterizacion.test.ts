import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import type { ActorVenta, DatosVentaEnTx, OpcionesVentaEnTx, ResultadoVentaEnTx } from "../../src/core/movimientos/registrar-venta";
import { registrarVentaEnTx } from "../../src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";

/**
 * Red de la LÍNEA DE VENTA (Hito 5, pieza 5.1, paso 5.1-0 de docs/plan-hito-5-pureza.md): lo que `armarLinea` y `cargarDeudaDeRedondeo` (privadas de `registrar-venta-en-tx.ts`)
 * deciden, caso por caso. Se escribe ANTES de mudar nada (5.1-1 a 5.1-4 sacan las lecturas a `server/lecturas` y las reglas a `core/movimientos/linea-de-venta.ts`) y NO se edita
 * en ningún paso posterior: si una mudanza cambia un mensaje, el ORDEN en que se chequea una cosa antes que otra, el orden de una receta o el filtro de la deuda, tiene que dar rojo acá.
 *
 * Las matrices (`caracterizacion/venta-matriz*.test.ts`) ya fijan la venta entera en goldens de miles de líneas; este archivo fija, una por una y a la vista, las salidas TEMPRANAS de
 * `armarLinea` (que los goldens registran, pero mezcladas): qué mensaje gana cuando fallan dos cosas a la vez, y qué lecturas alcanzó a hacer la línea antes de rechazar (el multiconjunto
 * de lecturas, como `conTraza` de la matriz: el orden dentro de un `Promise.all` puede variar, el orden de las lecturas NO es parte del contrato fino de la traza). Cada caso corre
 * `registrarVentaEnTx` dentro de `prisma.$transaction` con el `tx` envuelto, igual que la matriz, y fija el resultado, las lecturas, las escrituras en secuencia y — en los
 * exitosos — las filas CONSUMO que quedaron escritas (cantidad, `cantidadExacta` y lote, en el orden en que se escribieron).
 *
 * Casos: C1 ingrediente que no es MP; C2 receta con dos ingredientes y el segundo no disponible; C3 producto que no es PV y además no disponible (gana la disponibilidad); C4 no es PV
 * con paso de venta y cantidad fuera del paso (gana el tipo); C5 producto inexistente; C6 dos líneas, la segunda con cantidad −1; C7 la misma MP dos veces en la receta con los ids
 * insertados al revés (el orden es por id, no por inserción) y dos lotes; C8 venta de solo un PV que se produce (no hay deuda que leer); C9 otra sucursal con resto de redondeo
 * del mismo insumo (no afecta a la venta de Central).
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

const ESCRITURAS = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)$|^\$executeRaw/;

/** Las lecturas de la traza, por tipo y en orden alfabético (`{ "producto.findUnique": 2, … }`). */
function lecturasPorTipo(traza: readonly string[]): Record<string, number> {
  const porTipo: Record<string, number> = {};
  for (const t of [...traza].sort()) if (!ESCRITURAS.test(t)) porTipo[t] = (porTipo[t] ?? 0) + 1;
  return porTipo;
}

describe("Caracterización de la línea de venta (armarLinea y la deuda de redondeo): salidas tempranas, orden de la receta y filtro de sucursal", () => {
  let sucursalId: string;
  let seccionId: string;
  let usuarioId: string;
  let actor: ActorVenta;
  let unidadId: string;
  const nombres = new Map<string, string>();

  beforeEach(async () => {
    nombres.clear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    actor = { usuarioId, sucursalId, sucursalNombre: "Central" };
    unidadId = (await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } })).id;
    nombres.set(seccionId, "Depósito");
  });

  /** Un producto con nombre simbólico; `disponible: false` lo deja SIN fila de disponibilidad en la sucursal (fila ausente = no disponible). */
  async function producto(codigo: string, tipo: "MP" | "PV", extra: Record<string, unknown> = {}, opciones: { disponible?: boolean; unidadStockId?: string } = {}): Promise<string> {
    const data = { codigo, nombre: codigo, tipo, unidadStockId: opciones.unidadStockId ?? unidadId, ...extra } as Prisma.ProductoUncheckedCreateInput;
    const p = opciones.disponible === false ? await prisma.producto.create({ data }) : await sembrarProductoDisponible(data, sucursalId);
    nombres.set(p.id, codigo);
    return p.id;
  }

  /** Una receta v1 con sus ingredientes insertados EN EL ORDEN DADO (cada uno con el id que se pida: el orden de lectura es por id, no por inserción). */
  async function receta(productoId: string, ingredientes: { id: string; insumoProductoId: string; cantidad: number }[]): Promise<void> {
    const version = await prisma.recetaVersion.create({ data: { productoId, version: 1 } });
    for (const ing of ingredientes) {
      await prisma.recetaIngrediente.create({ data: { id: ing.id, recetaVersionId: version.id, insumoProductoId: ing.insumoProductoId, cantidad: ing.cantidad, unidadId, mermaPorcentaje: 0 } });
    }
  }

  /** Stock escrito DIRECTO en el Kardex (una compra de `cantidad`), en la sección y el lote dados. */
  async function stock(productoId: string, cantidad: number, lote: string | null = null, deSucursalId = sucursalId, deSeccionId = seccionId): Promise<void> {
    const operacion = await prisma.operacion.create({ data: { sucursalId: deSucursalId, proceso: "COMPRA", fecha: new Date("2026-09-01"), usuarioId } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: operacion.id, productoId, seccionId: deSeccionId, proceso: "COMPRA", cantidad, loteVencimiento: lote ? new Date(lote) : null,
        detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0,
      },
    });
  }

  const datosDe = (lineas: DatosVentaEnTx["lineas"]): DatosVentaEnTx => ({ fecha: new Date("2026-09-30"), origen: { tipo: "seccion", seccionId }, lineas });

  /** Corre la venta en una transacción con traza y devuelve lo que se fija de ella. */
  async function correr(lineas: DatosVentaEnTx["lineas"], opciones?: OpcionesVentaEnTx) {
    const traza: string[] = [];
    const r: ResultadoVentaEnTx = await prisma.$transaction((tx) => registrarVentaEnTx(conTraza(tx, traza), actor, datosDe(lineas), opciones));
    return {
      resultado: r.ok ? { ok: true as const, mensaje: r.mensaje, operaciones: r.operacionIds.length, avisos: r.avisosStockNegativo.length } : { ok: false as const, mensaje: r.mensaje },
      lecturas: lecturasPorTipo(traza),
      escrituras: traza.filter((t) => ESCRITURAS.test(t)),
    };
  }

  /** Las filas CONSUMO de Central, en el orden en que se escribieron, con las cantidades como texto exacto y los ids por su nombre. */
  async function consumos() {
    const filas = await prisma.movimientoStock.findMany({ where: { proceso: "CONSUMO", seccionId }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    return filas.map((f) => ({
      producto: nombres.get(f.productoId) ?? f.productoId,
      cantidad: f.cantidad.toString(),
      cantidadExacta: f.cantidadExacta === null ? null : f.cantidadExacta.toString(),
      lote: f.loteVencimiento === null ? null : f.loteVencimiento.toISOString().slice(0, 10),
    }));
  }

  it("C1: un ingrediente de la receta que no es MP rechaza con el texto de la materia prima y la traza hasta ese ingrediente", async () => {
    const otroPv = await producto("PV_NO_ES_MP", "PV");
    const pizza = await producto("PV_PIZZA", "PV", { precioVenta: 100 });
    await receta(pizza, [{ id: "ing-1", insumoProductoId: otroPv, cantidad: 1 }]);
    const visto = await correr([{ productoId: pizza, cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C1);
    expect(await consumos()).toEqual([]);
  });

  it("C2: con dos ingredientes y el segundo no disponible, el mensaje nombra al SEGUNDO y la traza incluye las lecturas del primero", async () => {
    const harina = await producto("MP_HARINA", "MP");
    const levadura = await producto("MP_LEVADURA", "MP", {}, { disponible: false });
    const pan = await producto("PV_PAN", "PV", { precioVenta: 100 });
    await receta(pan, [
      { id: "ing-1", insumoProductoId: harina, cantidad: 1 },
      { id: "ing-2", insumoProductoId: levadura, cantidad: 1 },
    ]);
    const visto = await correr([{ productoId: pan, cantidadVendida: 1 }]);
    // El primer ingrediente alcanzó a leerse antes de rechazar por el segundo: 3 lecturas de disponibilidad (el PV, la harina y la levadura) y 3 fichas de producto.
    expect(visto).toEqual(ESPERADO.C2);
  });

  it("C3: un producto que no es PV y además no está disponible rechaza por la DISPONIBILIDAD (se chequea antes que el tipo)", async () => {
    const insumo = await producto("MP_SUELTA", "MP", {}, { disponible: false });
    const visto = await correr([{ productoId: insumo, cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C3);
  });

  it("C4: un producto que no es PV, con paso de venta y una cantidad fuera del paso, rechaza por el TIPO (se chequea antes que el paso)", async () => {
    const insumo = await producto("MP_CON_PASO", "MP", { pasoVenta: 0.5 });
    const visto = await correr([{ productoId: insumo, cantidadVendida: 0.3 }]);
    expect(visto).toEqual(ESPERADO.C4);
  });

  it("C5: un producto inexistente rechaza con «El producto no existe.» y no lee más que su ficha", async () => {
    const visto = await correr([{ productoId: "producto-que-no-existe", cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C5);
  });

  it("C6: con dos líneas y la segunda con cantidad −1, rechaza con «no es un número válido» y la traza solo tiene las lecturas de la primera", async () => {
    const harina = await producto("MP_HARINA", "MP");
    const sal = await producto("MP_SAL", "MP");
    const pan = await producto("PV_PAN", "PV", { precioVenta: 100 });
    const focaccia = await producto("PV_FOCACCIA", "PV", { precioVenta: 100 });
    await receta(pan, [{ id: "ing-1", insumoProductoId: harina, cantidad: 1 }]);
    await receta(focaccia, [{ id: "ing-2", insumoProductoId: sal, cantidad: 1 }]);
    const visto = await correr([
      { productoId: pan, cantidadVendida: 1 },
      { productoId: focaccia, cantidadVendida: -1 },
    ]);
    // Solo la primera línea leyó su receta (1 `recetaVersion.findFirst`) y sus fichas (2 `producto.findUnique`: el PV y su harina): la de la segunda ni se miró, porque la cantidad se valida antes que cualquier lectura.
    expect(visto).toEqual(ESPERADO.C6);
  });

  it("C7: la misma MP dos veces en la receta, con los ids insertados al revés, se consume por ORDEN DE ID (no de inserción) y el arrastre de redondeo lo sigue", async () => {
    const bollo = await producto("MP_BOLLO", "MP");
    const combo = await producto("PV_COMBO", "PV", { precioVenta: 100 });
    // Se inserta primero «ing-2» (0,3) y después «ing-1» (0,2): leída por id, la receta es 0,2 → 0,3.
    await receta(combo, [
      { id: "ing-2", insumoProductoId: bollo, cantidad: 0.3 },
      { id: "ing-1", insumoProductoId: bollo, cantidad: 0.2 },
    ]);
    // Dos lotes de vencimiento distinto: el que vence antes (FEFO) se consume primero y alcanza justo para 0,25.
    await stock(bollo, 0.25, "2026-11-01");
    await stock(bollo, 1, "2026-12-01");
    const visto = await correr([{ productoId: combo, cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C7);
    expect(await consumos()).toEqual(ESPERADO.C7_CONSUMOS);
  });

  it("C8: la venta de solo un PV que se produce no lee la deuda de redondeo (no hay productos consumidos)", async () => {
    const torta = await producto("PV_TORTA", "PV", { precioVenta: 100, seProduce: true });
    await stock(torta, 2, "2026-12-01");
    const visto = await correr([{ productoId: torta, cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C8);
    expect(await consumos()).toEqual([]);
  });

  it("C9: el resto de redondeo del mismo insumo en OTRA sucursal no entra en la deuda de Central", async () => {
    const bollo = await producto("MP_BOLLO", "MP");
    const pan = await producto("PV_PAN", "PV", { precioVenta: 100 });
    await receta(pan, [{ id: "ing-1", insumoProductoId: bollo, cantidad: 0.5 }]);
    await stock(bollo, 3);
    // Norte consumió 0,4 de bollo y escribió 1: SU deuda es −0,6. Si la deuda de Central la incluyera, la media unidad de Central (0,5 − 0,6) se escribiría en 0 y no en 1.
    const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
    const seccionNorte = (await sembrarSeccion(norte.id, "Cocina Norte")).id;
    const operacion = await prisma.operacion.create({ data: { sucursalId: norte.id, proceso: "VENTA", fecha: new Date("2026-09-20"), usuarioId } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: operacion.id, productoId: bollo, seccionId: seccionNorte, proceso: "CONSUMO", cantidad: -1, cantidadExacta: -0.4,
        detalle: "Consumo previo de Norte", precioTotal: 0, precioPorUnidadStock: 0,
      },
    });
    const visto = await correr([{ productoId: pan, cantidadVendida: 1 }]);
    expect(visto).toEqual(ESPERADO.C9);
    expect(await consumos()).toEqual(ESPERADO.C9_CONSUMOS);
  });
});

// Lo que hace el código de hoy (commit 34fb36dc, antes de 5.1-1): resultado, lecturas por tipo (multiconjunto) y escrituras en secuencia. El rechazo no escribe nada.
const ESPERADO = {
  C1: {
    resultado: { ok: false, mensaje: 'La materia prima de la receta de "PV_PIZZA" no está marcada como MP.' },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 1, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 1, "grupo.findMany": 1, "precioLocalProducto.findMany": 1,
      "producto.findMany": 1, "producto.findUnique": 2, "recetaSucursal.findMany": 2, "recetaVersion.findFirst": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C2: {
    resultado: { ok: false, mensaje: "La receta de «PV_PAN» usa «MP_LEVADURA», que no está disponible en «Central»: activala acá o cambiá la receta." },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 1, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 3, "grupo.findMany": 1, "precioLocalProducto.findMany": 1,
      "producto.findMany": 1, "producto.findUnique": 3, "recetaSucursal.findMany": 2, "recetaVersion.findFirst": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C3: {
    resultado: { ok: false, mensaje: "«MP_SUELTA» no está disponible en «Central»." },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 1, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 1, "grupo.findMany": 1, "precioLocalProducto.findMany": 1,
      "producto.findMany": 1, "producto.findUnique": 1, "recetaSucursal.findMany": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C4: {
    resultado: { ok: false, mensaje: '"MP_CON_PASO" no está habilitado para venta: solo se puede vender un PV (vinculado por receta a la materia prima que consume).' },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 1, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 1, "grupo.findMany": 1, "precioLocalProducto.findMany": 1,
      "producto.findMany": 1, "producto.findUnique": 1, "recetaSucursal.findMany": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C5: {
    resultado: { ok: false, mensaje: "El producto no existe." },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 1, "grupo.findMany": 1, "precioLocalProducto.findMany": 1, "producto.findMany": 1, "producto.findUnique": 1, "recetaSucursal.findMany": 1,
      "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C6: {
    resultado: { ok: false, mensaje: "La cantidad vendida no es un número válido." },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 2, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 2, "grupo.findMany": 1, "precioLocalProducto.findMany": 2,
      "producto.findMany": 1, "producto.findUnique": 2, "recetaSucursal.findMany": 2, "recetaVersion.findFirst": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: [],
  },
  C7: {
    resultado: { ok: true, mensaje: "Se registraron 1 venta(s) correctamente.", operaciones: 1, avisos: 0 },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 2, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 3, "grupo.findMany": 1, "movimientoStock.groupBy": 2, "precioLocalProducto.findMany": 2,
      "producto.findMany": 2, "producto.findUnique": 2, "recetaSucursal.findMany": 2, "recetaVersion.findFirst": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: ["operacion.create", "movimientoStock.createMany"],
  },
  // Por orden de id la receta es 0,2 → 0,3: la primera sale entera del lote que vence antes (0,2 → se escribe 0, deuda 0,2); la segunda toma lo que le queda a ese lote (0,05 → 0, deuda 0,25)
  // y el resto del segundo (0,25 → 0,25 + 0,25 = 0,5 → se escribe 1). Con la receta en orden de inserción (0,3 → 0,2) las cantidades exactas y los lotes de cada fila serían otros.
  C7_CONSUMOS: [
    { producto: "MP_BOLLO", cantidad: "0", cantidadExacta: "-0.2", lote: "2026-11-01" },
    { producto: "MP_BOLLO", cantidad: "0", cantidadExacta: "-0.05", lote: "2026-11-01" },
    { producto: "MP_BOLLO", cantidad: "-1", cantidadExacta: "-0.25", lote: "2026-12-01" },
  ],
  C8: {
    resultado: { ok: true, mensaje: "Se registraron 1 venta(s) correctamente.", operaciones: 1, avisos: 0 },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 2, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 1, "grupo.findMany": 1, "movimientoStock.groupBy": 1, "precioLocalProducto.findMany": 2,
      "producto.findMany": 1, "producto.findUnique": 1, "recetaSucursal.findMany": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: ["operacion.create", "movimientoStock.createMany"],
  },
  C9: {
    resultado: { ok: true, mensaje: "Se registraron 1 venta(s) correctamente.", operaciones: 1, avisos: 0 },
    lecturas: {
      $queryRaw: 1, "capacidadSucursal.findMany": 2, "disponibilidadProducto.findMany": 1, "disponibilidadProducto.findUnique": 2, "grupo.findMany": 1, "movimientoStock.groupBy": 2, "precioLocalProducto.findMany": 2,
      "producto.findMany": 2, "producto.findUnique": 2, "recetaSucursal.findMany": 2, "recetaVersion.findFirst": 1, "recetaVersion.findMany": 1, "seccion.findUnique": 1,
    },
    escrituras: ["operacion.create", "movimientoStock.createMany"],
  },
  // Sin la deuda de Norte (−0,6) la media unidad de Central se escribe en 1 (Math.round(0,5)); con ella se escribiría 0.
  C9_CONSUMOS: [{ producto: "MP_BOLLO", cantidad: "-1", cantidadExacta: "-0.5", lote: null }],
};
