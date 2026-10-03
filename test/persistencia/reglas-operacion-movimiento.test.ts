import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Proceso } from "@prisma/client";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarCatalogoBase, sembrarMotivosYDestinos, sembrarSeccion } from "../setup/test-db";
import { construirReversionDeVenta } from "../../src/core/movimientos/anulaciones";
import { construirReversion } from "../../src/core/compras/anulacion";

/**
 * Tanda 6: reglas de integridad de Operacion y MovimientoStock en la base (migración 20261002160000_reglas_en_la_base_operacion_movimiento).
 * Dos mitades: (1) cada regla rechaza, con el nombre de su CHECK, una fila que la rompe; (2) el uso normal de la app (compras, ventas
 * fraccionadas, anulaciones, conteos, mermas, producción, traspasos, idempotencia) sigue escribiendo sin que ninguna regla se interponga.
 *
 * Las filas inválidas se arman con un UPDATE crudo del dueño sobre una fila válida (el CHECK rige igual para INSERT y UPDATE) para que el
 * mensaje sea el de Postgres y traiga el nombre de la restricción. Mutación: sacar un CHECK de la migración deja en rojo solo su caso.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261002160000_reglas_en_la_base_operacion_movimiento");

const CHECKS = [
  "MovimientoStock_signo_por_proceso_chk",
  "MovimientoStock_precios_no_negativos_chk",
  "MovimientoStock_cantidad_exacta_signo_chk",
  "MovimientoStock_campos_de_venta_chk",
  "MovimientoStock_sustituye_solo_consumo_chk",
  "MovimientoStock_traspaso_solo_en_traspasos_chk",
  "MovimientoStock_conteo_solo_en_control_chk",
  "Operacion_motivo_solo_merma_chk",
  "Operacion_destino_solo_consumo_chk",
  "Operacion_seccion_destino_solo_transferencia_chk",
  "Operacion_transferencia_exige_seccion_destino_chk",
  "Operacion_anulacion_coherente_chk",
];
const INDICE_PASO_UNICO = "MovimientoStock_traspaso_paso_unico_key";

function sentencias(archivo: string): string[] {
  return readFileSync(join(CARPETA, archivo), "utf8")
    .replace(/\r\n/g, "\n")
    .split(";\n")
    .map((s) =>
      s
        .split("\n")
        .filter((linea) => !linea.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

async function correr(archivo: string) {
  for (const sentencia of sentencias(archivo)) await prismaAdmin.$executeRawUnsafe(sentencia);
}

let usuarioId: string;
let otroUsuarioId: string;
let sucursalId: string;
let seccionId: string;
let seccionDestinoId: string;
let productoId: string;
let otroProductoId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  const { kg, insumo } = await sembrarCatalogoBase();
  seccionId = (await sembrarSeccion(sucursalId, "Depósito")).id;
  seccionDestinoId = (await sembrarSeccion(sucursalId, "Cocina")).id;
  usuarioId = (await prisma.user.create({ data: { email: "operador@test.com" } })).id;
  otroUsuarioId = (await prisma.user.create({ data: { email: "supervisor@test.com" } })).id;
  const nuevoProducto = (codigo: string) => prisma.producto.create({ data: { codigo, nombre: codigo, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  productoId = (await nuevoProducto("MP_A")).id;
  otroProductoId = (await nuevoProducto("MP_B")).id;
});

type DatosOperacion = { proceso: Proceso } & Partial<{
  motivoId: string;
  destinoId: string;
  seccionDestinoId: string;
  anuladaEn: Date;
  anuladaPorId: string;
  claveIdempotencia: string;
  payloadHash: string;
  resultadoMensaje: string;
}>;

function operacion(datos: DatosOperacion) {
  return prisma.operacion.create({ data: { sucursalId, fecha: new Date(), usuarioId, ...datos } });
}

type DatosLinea = Partial<{
  productoId: string;
  seccionId: string;
  precioTotal: number;
  precioPorUnidadStock: number;
  cantidadExacta: number;
  costoUnitarioVenta: number;
  precioListaUnitario: number;
  conteoFisicoId: string;
  traspasoSucursalId: string;
  sustituyeAProductoId: string;
}>;

/** Una línea de Kardex por el rol de ejecución (el camino real de la app), en una operación nueva del mismo proceso salvo que se pase una. */
async function linea(proceso: Proceso, cantidad: number, datos: DatosLinea = {}, operacionId?: string) {
  const idOperacion = operacionId ?? (await operacion(proceso === "TRANSFERENCIA" ? { proceso, seccionDestinoId } : { proceso })).id;
  return prisma.movimientoStock.create({
    data: { operacionId: idOperacion, productoId, seccionId, proceso, cantidad, detalle: proceso, precioTotal: 0, precioPorUnidadStock: 0, ...datos },
  });
}

async function traspaso() {
  const destinoId = (await prisma.sucursal.create({ data: { nombre: `Destino ${Math.random().toString(36).slice(2, 8)}` } })).id;
  return prisma.traspasoSucursal.create({
    data: { origenSucursalId: sucursalId, destinoSucursalId: destinoId, productoId, cantidad: 2, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: usuarioId },
  });
}

function conteo() {
  return prisma.conteoFisico.create({
    data: { sucursalId, fecha: new Date(), productoId, seccionId, saldoSistema: 5, conteoReal: 3, diferencia: -2, accion: "AJUSTAR", estado: "RESUELTO", usuarioId },
  });
}

/** Aplica `SET ...` (literales fijos de este archivo, sin entrada externa) sobre una fila y exige que falle justo con ese CHECK. */
async function exigirRechazo(tabla: "MovimientoStock" | "Operacion", id: string, set: string, restriccion: string) {
  await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "${tabla}" SET ${set} WHERE id = '${id}'`)).rejects.toThrow(new RegExp(restriccion));
}

describe("la migración deja las reglas puestas y validadas", () => {
  it("existen los 12 CHECK, todos validados, y el índice único parcial", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    expect(filas.map((f) => f.conname).sort()).toEqual([...CHECKS].sort());
    expect(filas.every((f) => f.convalidated)).toBe(true);
    const indice = await prismaAdmin.$queryRaw<Array<{ indisunique: boolean; predicado: string | null }>>`
      SELECT i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS predicado
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname::text = ${INDICE_PASO_UNICO}`;
    expect(indice).toHaveLength(1);
    expect(indice[0].indisunique).toBe(true);
    expect(indice[0].predicado).toMatch(/traspasoSucursalId/);
  });

  it("el script es idempotente y la reversa saca todo sin tocar datos (y se vuelve a poner al final)", async () => {
    const l = await linea("COMPRA", 3);
    try {
      await correr("migration.sql");
      await correr("down.sql");
      const quedan = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_constraint WHERE conname::text = ANY(${CHECKS}::text[])`;
      expect(Number(quedan[0].n)).toBe(0);
      const indice = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_class WHERE relname::text = ${INDICE_PASO_UNICO}`;
      expect(Number(indice[0].n)).toBe(0);
      // Sin las reglas, la fila inválida entra: prueba de que la reversa de verdad las quitó.
      await prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET cantidad = -3 WHERE id = '${l.id}'`);
    } finally {
      await prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET cantidad = 3 WHERE id = '${l.id}'`);
      await correr("migration.sql");
    }
    const vuelven = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_constraint WHERE conname::text = ANY(${CHECKS}::text[]) AND convalidated`;
    expect(Number(vuelven[0].n)).toBe(CHECKS.length);
  });

  it("la verificación previa corre limpia sobre una base sin filas fuera de regla", async () => {
    await linea("COMPRA", 3);
    const sql = readFileSync(join(CARPETA, "verificacion-previa.sql"), "utf8").replace(/\r\n/g, "\n");
    const filas = await prismaAdmin.$queryRawUnsafe<Array<{ regla: string; fuera_de_regla: bigint | number | string }>>(sql.replace(/;\s*$/, ""));
    expect(filas.length).toBe(CHECKS.length + 1);
    expect(filas.filter((f) => Number(f.fuera_de_regla) !== 0)).toEqual([]);
  });

  it("la verificación previa cuenta una fila fuera de regla (en una base donde las reglas no estuvieran)", async () => {
    const l = await linea("COMPRA", 3);
    const sql = readFileSync(join(CARPETA, "verificacion-previa.sql"), "utf8").replace(/\r\n/g, "\n").replace(/;\s*$/, "");
    try {
      await correr("down.sql");
      await prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET cantidad = -3 WHERE id = '${l.id}'`);
      const filas = await prismaAdmin.$queryRawUnsafe<Array<{ regla: string; fuera_de_regla: bigint | number | string }>>(sql);
      expect(filas.filter((f) => Number(f.fuera_de_regla) !== 0).map((f) => [f.regla, Number(f.fuera_de_regla)])).toEqual([["MovimientoStock_signo_por_proceso_chk", 1]]);
    } finally {
      await prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET cantidad = 3 WHERE id = '${l.id}'`);
      await correr("migration.sql");
    }
  });
});

describe("MovimientoStock: el signo sale del proceso", () => {
  const SUMAN: Proceso[] = ["COMPRA", "PRODUCCION", "DEVOLUCION_CLIENTE", "TRANSFERENCIA_ENTRADA_SUCURSAL", "REINGRESO_TRANSFERENCIA_SUCURSAL"];
  const RESTAN: Proceso[] = ["CONSUMO", "MERMA", "VENTA", "DEVOLUCION_CONSIGNACION", "DEVOLUCION_PROVEEDOR", "TRANSFERENCIA_SALIDA_SUCURSAL"];

  it.each(SUMAN)("%s no admite una cantidad negativa", async (proceso) => {
    const l = await linea(proceso, 2);
    await exigirRechazo("MovimientoStock", l.id, "cantidad = -2", "MovimientoStock_signo_por_proceso_chk");
  });

  it.each(RESTAN)("%s no admite una cantidad positiva", async (proceso) => {
    const l = await linea(proceso, -2);
    await exigirRechazo("MovimientoStock", l.id, "cantidad = 2", "MovimientoStock_signo_por_proceso_chk");
  });

  it("LIQUIDACION_CONSIGNACION no mueve stock: cantidad distinta de cero se rechaza", async () => {
    const l = await linea("LIQUIDACION_CONSIGNACION", 0, { precioTotal: 10, precioPorUnidadStock: 5 });
    await exigirRechazo("MovimientoStock", l.id, "cantidad = 1", "MovimientoStock_signo_por_proceso_chk");
    await exigirRechazo("MovimientoStock", l.id, "cantidad = -1", "MovimientoStock_signo_por_proceso_chk");
  });

  it("insertar directo por el rol de ejecución una compra negativa o una merma positiva también se rechaza", async () => {
    await expect(linea("COMPRA", -1)).rejects.toThrow();
    await expect(linea("MERMA", 1)).rejects.toThrow();
    expect(await prismaAdmin.movimientoStock.count()).toBe(0);
  });

  it("AJUSTE, CONTROL, TRANSFERENCIA y RECLASIFICACION admiten cualquier signo y el cero", async () => {
    for (const proceso of ["AJUSTE", "CONTROL", "TRANSFERENCIA", "RECLASIFICACION"] as const) {
      for (const cantidad of [-4, 0, 4]) await linea(proceso, cantidad);
    }
    expect(await prismaAdmin.movimientoStock.count()).toBe(12);
  });
});

describe("MovimientoStock: precios y arrastre de redondeo", () => {
  it("el precio por unidad no puede ser negativo, en ningún proceso", async () => {
    for (const proceso of ["COMPRA", "AJUSTE"] as const) {
      const l = await linea(proceso, 1);
      await exigirRechazo("MovimientoStock", l.id, `"precioPorUnidadStock" = -1`, "MovimientoStock_precios_no_negativos_chk");
    }
  });

  it("el importe de línea solo puede ser negativo en AJUSTE y LIQUIDACION_CONSIGNACION (las reversiones)", async () => {
    for (const [proceso, cantidad] of [["COMPRA", 1], ["VENTA", -1], ["CONSUMO", -1], ["MERMA", -1], ["PRODUCCION", 1]] as const) {
      const l = await linea(proceso, cantidad);
      await exigirRechazo("MovimientoStock", l.id, `"precioTotal" = -1`, "MovimientoStock_precios_no_negativos_chk");
    }
    const ajuste = await linea("AJUSTE", -1);
    const liquidacion = await linea("LIQUIDACION_CONSIGNACION", 0);
    await prismaAdmin.$executeRawUnsafe(`UPDATE "MovimientoStock" SET "precioTotal" = -50 WHERE id IN ('${ajuste.id}', '${liquidacion.id}')`);
  });

  it("cantidadExacta no puede tener el signo contrario al de cantidad", async () => {
    const consumo = await linea("CONSUMO", -1);
    await exigirRechazo("MovimientoStock", consumo.id, `"cantidadExacta" = 0.5`, "MovimientoStock_cantidad_exacta_signo_chk");
    const reversion = await linea("AJUSTE", 1);
    await exigirRechazo("MovimientoStock", reversion.id, `"cantidadExacta" = -0.5`, "MovimientoStock_cantidad_exacta_signo_chk");
  });
});

describe("MovimientoStock: campos que pertenecen a un solo proceso", () => {
  it("costo y precio de lista de venta solo en la línea VENTA, y sin negativos", async () => {
    const compra = await linea("COMPRA", 1);
    await exigirRechazo("MovimientoStock", compra.id, `"costoUnitarioVenta" = 5`, "MovimientoStock_campos_de_venta_chk");
    await exigirRechazo("MovimientoStock", compra.id, `"precioListaUnitario" = 5`, "MovimientoStock_campos_de_venta_chk");
    const venta = await linea("VENTA", -1);
    await exigirRechazo("MovimientoStock", venta.id, `"costoUnitarioVenta" = -1`, "MovimientoStock_campos_de_venta_chk");
    await exigirRechazo("MovimientoStock", venta.id, `"precioListaUnitario" = -1`, "MovimientoStock_campos_de_venta_chk");
  });

  it("el producto que sustituye solo lo lleva el CONSUMO", async () => {
    const venta = await linea("VENTA", -1);
    await exigirRechazo("MovimientoStock", venta.id, `"sustituyeAProductoId" = '${otroProductoId}'`, "MovimientoStock_sustituye_solo_consumo_chk");
  });

  it("el traspaso solo cuelga de sus tres pasos", async () => {
    const t = await traspaso();
    const compra = await linea("COMPRA", 1);
    await exigirRechazo("MovimientoStock", compra.id, `"traspasoSucursalId" = '${t.id}'`, "MovimientoStock_traspaso_solo_en_traspasos_chk");
  });

  it("el conteo físico solo cuelga de líneas CONTROL", async () => {
    const c = await conteo();
    for (const [proceso, cantidad] of [["MERMA", -1], ["AJUSTE", -1], ["COMPRA", 1]] as const) {
      const l = await linea(proceso, cantidad);
      await exigirRechazo("MovimientoStock", l.id, `"conteoFisicoId" = '${c.id}'`, "MovimientoStock_conteo_solo_en_control_chk");
    }
  });
});

describe("MovimientoStock: cada paso de un traspaso escribe una sola línea", () => {
  it("repetir salida, entrada o reingreso del mismo traspaso se rechaza; los tres pasos distintos conviven", async () => {
    const t = await traspaso();
    await linea("TRANSFERENCIA_SALIDA_SUCURSAL", -2, { traspasoSucursalId: t.id });
    await linea("TRANSFERENCIA_ENTRADA_SUCURSAL", 2, { traspasoSucursalId: t.id });
    await linea("REINGRESO_TRANSFERENCIA_SUCURSAL", 2, { traspasoSucursalId: t.id });

    await expect(linea("TRANSFERENCIA_SALIDA_SUCURSAL", -2, { traspasoSucursalId: t.id })).rejects.toMatchObject({ code: "P2002" });
    await expect(linea("TRANSFERENCIA_ENTRADA_SUCURSAL", 2, { traspasoSucursalId: t.id })).rejects.toMatchObject({ code: "P2002" });
    expect(await prismaAdmin.movimientoStock.count({ where: { traspasoSucursalId: t.id } })).toBe(3);
  });

  it("dos traspasos distintos pueden tener cada uno su salida, y las líneas sin traspaso no cuentan", async () => {
    const a = await traspaso();
    const b = await traspaso();
    await linea("TRANSFERENCIA_SALIDA_SUCURSAL", -2, { traspasoSucursalId: a.id });
    await linea("TRANSFERENCIA_SALIDA_SUCURSAL", -2, { traspasoSucursalId: b.id });
    await linea("COMPRA", 1);
    await linea("COMPRA", 1);
    expect(await prismaAdmin.movimientoStock.count()).toBe(4);
  });
});

describe("Operacion: campos que pertenecen a un solo proceso", () => {
  it("el motivo solo en la MERMA", async () => {
    const { motivos } = await sembrarMotivosYDestinos();
    const motivoId = [...motivos.values()][0];
    const compra = await operacion({ proceso: "COMPRA" });
    await exigirRechazo("Operacion", compra.id, `"motivoId" = '${motivoId}'`, "Operacion_motivo_solo_merma_chk");
  });

  it("el destino solo en el CONSUMO", async () => {
    const { destinos } = await sembrarMotivosYDestinos();
    const destinoId = [...destinos.values()][0];
    const merma = await operacion({ proceso: "MERMA" });
    await exigirRechazo("Operacion", merma.id, `"destinoId" = '${destinoId}'`, "Operacion_destino_solo_consumo_chk");
  });

  it("la sección de destino solo en la TRANSFERENCIA, y la TRANSFERENCIA siempre la lleva", async () => {
    const compra = await operacion({ proceso: "COMPRA" });
    await exigirRechazo("Operacion", compra.id, `"seccionDestinoId" = '${seccionDestinoId}'`, "Operacion_seccion_destino_solo_transferencia_chk");
    const transferencia = await operacion({ proceso: "TRANSFERENCIA", seccionDestinoId });
    await exigirRechazo("Operacion", transferencia.id, `"seccionDestinoId" = NULL`, "Operacion_transferencia_exige_seccion_destino_chk");
    await expect(operacion({ proceso: "TRANSFERENCIA" })).rejects.toThrow();
  });
});

describe("Operacion: anulación e idempotencia", () => {
  it("quién anuló sin cuándo no existe, y solo la VENTA y la COMPRA se anulan", async () => {
    const venta = await operacion({ proceso: "VENTA" });
    await exigirRechazo("Operacion", venta.id, `"anuladaPorId" = '${otroUsuarioId}'`, "Operacion_anulacion_coherente_chk");
    for (const proceso of ["AJUSTE", "MERMA", "TRANSFERENCIA_SALIDA_SUCURSAL"] as const) {
      const o = await operacion({ proceso });
      await exigirRechazo("Operacion", o.id, `"anuladaEn" = now()`, "Operacion_anulacion_coherente_chk");
    }
  });

  it("borrar al usuario que anuló deja la anulación en pie (anuladaPorId pasa a NULL con anuladaEn puesta)", async () => {
    const venta = await operacion({ proceso: "VENTA", anuladaEn: new Date(), anuladaPorId: otroUsuarioId });
    await prismaAdmin.user.delete({ where: { id: otroUsuarioId } });
    const despues = await prismaAdmin.operacion.findUniqueOrThrow({ where: { id: venta.id } });
    expect(despues.anuladaPorId).toBeNull();
    expect(despues.anuladaEn).not.toBeNull();
  });

  it("no hay regla que ate clave, hash y mensaje: el estado 'fail closed' (§11.3) de chequearIdempotencia tiene que poder existir", async () => {
    await expect(operacion({ proceso: "COMPRA", claveIdempotencia: "k-1" })).resolves.toBeDefined();
    await expect(operacion({ proceso: "COMPRA", claveIdempotencia: "k-2", payloadHash: "h-2" })).resolves.toBeDefined();
  });
});

describe("el flujo normal sigue escribiendo", () => {
  it("compra con lote, precios y su anulación (reversión AJUSTE con importe negativo)", async () => {
    const op = await operacion({ proceso: "COMPRA" });
    const compra = await linea("COMPRA", 10, { precioTotal: 1000, precioPorUnidadStock: 100 }, op.id);
    const [reversion] = construirReversion([
      { productoId, productoCodigo: "MP_A", productoNombre: "MP_A", seccionId, seccionNombre: "Depósito", loteVencimiento: null, cantidad: 10, precioTotal: 1000, precioPorUnidadStock: 100, detalle: compra.detalle },
    ]);
    const opAnulacion = await operacion({ proceso: "AJUSTE" });
    await linea("AJUSTE", reversion.cantidad, { precioTotal: reversion.precioTotal, precioPorUnidadStock: reversion.precioPorUnidadStock }, opAnulacion.id);
    await prisma.operacion.update({ where: { id: op.id }, data: { anuladaEn: new Date(), anuladaPorId: otroUsuarioId } });

    const saldo = await prismaAdmin.movimientoStock.aggregate({ _sum: { cantidad: true } });
    expect(Number(saldo._sum.cantidad)).toBe(0);
  });

  it("venta fraccionada con consumo redondeado a cero, sustituto, consignación y descuento; y su anulación completa", async () => {
    const op = await operacion({ proceso: "VENTA", claveIdempotencia: "venta-1", payloadHash: "hash-1", resultadoMensaje: "Venta registrada." });
    const lineas = [
      await linea("VENTA", -1, { precioTotal: 800, precioPorUnidadStock: 800, costoUnitarioVenta: 300, precioListaUnitario: 1000 }, op.id),
      await linea("CONSUMO", -1, { cantidadExacta: -0.6, sustituyeAProductoId: otroProductoId }, op.id),
      await linea("CONSUMO", 0, { cantidadExacta: -0.3 }, op.id),
      await linea("LIQUIDACION_CONSIGNACION", 0, { precioTotal: 120, precioPorUnidadStock: 120 }, op.id),
    ];

    const reversiones = construirReversionDeVenta(
      lineas.map((l) => ({
        productoId: l.productoId,
        seccionId: l.seccionId,
        proceso: l.proceso,
        cantidad: Number(l.cantidad),
        cantidadExacta: l.cantidadExacta === null ? null : Number(l.cantidadExacta),
        loteVencimiento: l.loteVencimiento,
        detalle: l.detalle,
        precioTotal: Number(l.precioTotal),
        precioPorUnidadStock: Number(l.precioPorUnidadStock),
      }))
    );
    const opReversion = await operacion({ proceso: "AJUSTE" });
    for (const r of reversiones) {
      await prisma.movimientoStock.create({
        data: {
          operacionId: opReversion.id,
          productoId: r.productoId,
          seccionId: r.seccionId,
          proceso: r.proceso as Proceso,
          cantidad: r.cantidad,
          cantidadExacta: r.cantidadExacta,
          detalle: r.detalle,
          precioTotal: r.precioTotal,
          precioPorUnidadStock: r.precioPorUnidadStock,
        },
      });
    }
    await prisma.operacion.update({ where: { id: op.id }, data: { anuladaEn: new Date(), anuladaPorId: otroUsuarioId } });

    const total = await prismaAdmin.movimientoStock.aggregate({ _sum: { cantidad: true, cantidadExacta: true } });
    expect(Number(total._sum.cantidad)).toBe(0);
    expect(Number(total._sum.cantidadExacta)).toBeCloseTo(0, 6);
  });

  it("producción, merma con motivo, consumo con destino y transferencia entre secciones", async () => {
    const { motivos, destinos } = await sembrarMotivosYDestinos();
    const produccion = await operacion({ proceso: "PRODUCCION" });
    await linea("PRODUCCION", 5, {}, produccion.id);
    await linea("CONSUMO", -2, {}, produccion.id);
    const merma = await operacion({ proceso: "MERMA", motivoId: [...motivos.values()][0] });
    await linea("MERMA", -1, {}, merma.id);
    const consumo = await operacion({ proceso: "CONSUMO", destinoId: [...destinos.values()][0] });
    await linea("CONSUMO", -1, {}, consumo.id);
    const transferencia = await operacion({ proceso: "TRANSFERENCIA", seccionDestinoId });
    await linea("TRANSFERENCIA", -1, {}, transferencia.id);
    await linea("TRANSFERENCIA", 1, { seccionId: seccionDestinoId }, transferencia.id);
    expect(await prismaAdmin.movimientoStock.count()).toBe(6);
  });

  it("conteo físico: ajuste CONTROL con su reversión al cancelar comparten el conteoFisicoId; el ajuste en cero también entra", async () => {
    const c = await conteo();
    const op = await operacion({ proceso: "CONTROL" });
    await linea("CONTROL", -2, { conteoFisicoId: c.id }, op.id);
    const opCancelar = await operacion({ proceso: "CONTROL" });
    await linea("CONTROL", 2, { conteoFisicoId: c.id }, opCancelar.id);
    await linea("CONTROL", 0, { conteoFisicoId: c.id });
    expect(await prismaAdmin.movimientoStock.count({ where: { conteoFisicoId: c.id } })).toBe(3);
  });

  it("reclasificación (una salida y varias entradas) y devoluciones", async () => {
    const op = await operacion({ proceso: "RECLASIFICACION" });
    await linea("RECLASIFICACION", -3, {}, op.id);
    await linea("RECLASIFICACION", 2, { seccionId: seccionDestinoId }, op.id);
    await linea("RECLASIFICACION", 1, { seccionId: seccionDestinoId }, op.id);
    await linea("DEVOLUCION_PROVEEDOR", -1, { precioTotal: 100, precioPorUnidadStock: 100 });
    await linea("DEVOLUCION_CONSIGNACION", -1);
    await linea("DEVOLUCION_CLIENTE", 1, { precioTotal: 100, precioPorUnidadStock: 100 });
    expect(await prismaAdmin.movimientoStock.count()).toBe(6);
  });

  it("idempotencia: sin clave, con clave y hash, y con el mensaje guardado", async () => {
    await operacion({ proceso: "COMPRA" });
    await operacion({ proceso: "COMPRA", claveIdempotencia: "k-1", payloadHash: "h-1" });
    await operacion({ proceso: "COMPRA", claveIdempotencia: "k-2", payloadHash: "h-2", resultadoMensaje: "Compra registrada." });
    expect(await prismaAdmin.operacion.count()).toBe(3);
  });
});
