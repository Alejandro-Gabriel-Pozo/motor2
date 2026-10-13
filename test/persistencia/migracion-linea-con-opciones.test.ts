import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import {
  HUELLA_DE_PRUEBA,
  sembrarAdicional,
  sembrarEscenarioDeOpciones,
  sembrarLineaConOpciones,
  sentenciaDeFoto,
  sentenciaDeLinea,
  type EscenarioDeOpciones,
} from "../setup/opciones";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * GO-1d — migración 20261020130000_go1d_linea_con_opciones: la LÍNEA CON OPCIONES (`CuentaItem.huellaOpciones` y `lineaPadreId`, `Operacion.operacionPadreId`), la FOTO de lo elegido (`OpcionElegidaEnLinea`) y los tres disparadores, contra la base real.
 * Toca dos tablas con datos, así que lo primero que se mide es que todo lo de hoy sigue pasando igual.
 *
 * Qué se mide: las columnas nuevas nacen en NULL y las filas viejas siguen; T1 (`CuentaItem_opciones_chk`: el padre existe, es de la misma cuenta y es de un solo nivel; la huella y el padre no cambian; una línea con adicionales no se
 * mueve de cuenta; el espejo repite huella y padre); los CHECK de la línea (un adicional sin promo, sin precio de carta, sin huella y nunca en $0; la huella con su formato) y de la operación (el padre solo en una VENTA); T3
 * (`Operacion_padre_inmutable_chk`); la cascada del borrador (la foto se borra con su línea aunque la app no tenga DELETE; un padre con adicionales no se borra); que la foto no cambia aunque cambie la versión, el precio o el nombre (I9);
 * T2 (`OpcionElegidaEnLinea_coherente_chk`) y los CHECK de la foto, cada uno en su borde; que la foto solo se agrega; y que el flujo de hoy no dispara nada que no deba.
 * El aislamiento por sucursal lo mide `opciones-rls`; la concurrencia y la atomicidad, `opciones-concurrencia`; el dinero, `opciones-dinero`.
 *
 * Mutaciones demostradas (ver las filas O.320 a O.328 de docs/pureza-integracion.md): sacar `CuentaItem_adicional_chk`, sacar de T1 el chequeo de la misma cuenta o la inmutabilidad, cambiar el CASCADE de la foto por RESTRICT y poner `=` en lugar de
 * `IS NOT DISTINCT FROM` en `OpcionElegidaEnLinea_diferencia_chk`.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261020130000_go1d_linea_con_opciones");
const PROPIA = { empresaId: EMPRESA_DE_PRUEBA_ID };

let e: EscenarioDeOpciones;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeOpciones();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const rechazo = (restriccion: string, codigo = "23514") => ({ codigo, restriccion });
const alcanceA = () => ({ lectura: [e.sucursalA], escritura: [e.sucursalA] });
const linea = (cuentaId: string, extra: Record<string, unknown> = {}) => sentenciaDeLinea({ cuentaId, productoId: e.cafeId }, { ...PROPIA, ...extra });
const adicionalSql = (cuentaId: string, lineaPadreId: string, extra: Record<string, unknown> = {}) =>
  sentenciaDeLinea({ cuentaId, productoId: e.anclaDelShotId }, { ...PROPIA, precioUnitario: "200.00", lineaPadreId, ...extra });
/** La fila entera de una foto, para comparar antes y después (con las fechas como texto). */
const fotoDe = async (id: string) => JSON.stringify(await prismaAdmin.opcionElegidaEnLinea.findUniqueOrThrow({ where: { id } }));
const fotoVariante = (cuentaItemId: string, extra: Record<string, unknown> = {}) => sentenciaDeFoto({ ...e, cuentaItemId }, { ...PROPIA, ...extra });
/** La foto de «Shot extra» (ADICIONAL, monto fijo de 200,00). */
const fotoShot = (cuentaItemId: string, extra: Record<string, unknown> = {}) =>
  sentenciaDeFoto(
    { ...e, cuentaItemId },
    { ...PROPIA, grupoId: e.grupoAdicionalId, opcionId: e.shotId, versionDeOpcionId: e.versionDe[e.shotId]!, tipoGrupo: "ADICIONAL", nombreGrupo: "Extras", nombreOpcion: "Shot extra", tipoDeDiferencia: "MONTO", importeUnitario: "200.00", ...extra },
  );
/** La foto de «Chico» (MEDIDA, en diferencia por monto, factor 0,5). */
const fotoChico = (cuentaItemId: string, extra: Record<string, unknown> = {}) =>
  sentenciaDeFoto(
    { ...e, cuentaItemId },
    {
      ...PROPIA,
      grupoId: e.grupoMedidaId,
      opcionId: e.chicoId,
      versionDeOpcionId: e.versionDe[e.chicoId]!,
      tipoGrupo: "MEDIDA",
      nombreGrupo: "Tamaño",
      nombreOpcion: "Chico",
      modoPrecio: "DIFERENCIA",
      tipoDeDiferencia: "MONTO",
      importeUnitario: "-50.00",
      factorEscala: "0.5000",
      ...extra,
    },
  );

describe("las columnas nuevas nacen en NULL y lo de hoy sigue pasando igual", () => {
  it("`huellaOpciones`, `lineaPadreId` y `operacionPadreId` son TEXT nulables sin valor por defecto; sus índices, claves foráneas y CHECK están puestos y validados", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('huellaOpciones', 'lineaPadreId', 'operacionPadreId') ORDER BY 1, 2`;
    expect(columnas.map((c) => `${c.tabla}.${c.columna}:${c.tipo}:${c.es_nulable}:${c.por_defecto}`)).toEqual([
      "CuentaItem.huellaOpciones:text:YES:null",
      "CuentaItem.lineaPadreId:text:YES:null",
      "Operacion.operacionPadreId:text:YES:null",
    ]);
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; unico: boolean }>>`
      SELECT ic.relname::text AS nombre, i.indisunique AS unico FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE ic.relname IN ('CuentaItem_lineaPadreId_idx', 'Operacion_operacionPadreId_idx') ORDER BY 1`;
    expect(indices).toEqual([{ nombre: "CuentaItem_lineaPadreId_idx", unico: false }, { nombre: "Operacion_operacionPadreId_idx", unico: false }]);
    const restricciones = await prismaAdmin.$queryRaw<Array<{ nombre: string; tipo: string; validada: boolean; definicion: string }>>`
      SELECT conname::text AS nombre, contype::text AS tipo, convalidated AS validada, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conname IN ('CuentaItem_empresaId_lineaPadreId_fkey', 'Operacion_empresaId_operacionPadreId_fkey', 'CuentaItem_huella_opciones_chk', 'CuentaItem_adicional_chk', 'Operacion_padre_solo_venta_chk') ORDER BY 1`;
    expect(restricciones.map((r) => `${r.nombre}:${r.tipo}:${r.validada}`)).toEqual([
      "CuentaItem_adicional_chk:c:true",
      "CuentaItem_empresaId_lineaPadreId_fkey:f:true",
      "CuentaItem_huella_opciones_chk:c:true",
      "Operacion_empresaId_operacionPadreId_fkey:f:true",
      "Operacion_padre_solo_venta_chk:c:true",
    ]);
    const def = (n: string) => restricciones.find((r) => r.nombre === n)!.definicion;
    expect(def("CuentaItem_empresaId_lineaPadreId_fkey")).toBe('FOREIGN KEY ("empresaId", "lineaPadreId") REFERENCES "CuentaItem"("empresaId", id) ON UPDATE CASCADE ON DELETE RESTRICT');
    expect(def("Operacion_empresaId_operacionPadreId_fkey")).toBe('FOREIGN KEY ("empresaId", "operacionPadreId") REFERENCES "Operacion"("empresaId", id) ON UPDATE CASCADE ON DELETE RESTRICT');
  });

  it("una línea y una operación escritas como hoy (sin las columnas nuevas) quedan con todo en NULL, y el trigger no las toca", async () => {
    const item = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 2, precioUnitario: "900.00", creadoPorId: e.usuarioId } });
    const op = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:00:00Z"), usuarioId: e.usuarioId } });
    const fila = await prismaAdmin.cuentaItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([fila.huellaOpciones, fila.lineaPadreId]).toEqual([null, null]);
    expect((await prismaAdmin.operacion.findUniqueOrThrow({ where: { id: op.id } })).operacionPadreId).toBeNull();
  });

  it("el flujo de hoy no dispara T1 de más: la línea simple sale por el camino corto, y un UPDATE de `numeroEnvio` u `operacionId` no lo dispara; el de `cuentaId` sí", async () => {
    const duenio = await conexionDelDuenio();
    await duenio.query("SET track_functions = 'pl'");
    const llamadas = async () => {
      await duenio.query("SELECT pg_stat_force_next_flush()");
      const r = await duenio.query<{ calls: string }>(`SELECT COALESCE(sum(calls), 0)::text AS calls FROM pg_stat_user_functions WHERE funcname = 'CuentaItem_reglas_de_opciones'`);
      return Number(r.rows[0]!.calls);
    };
    const base = await llamadas();
    const alta = linea(e.cuentaAId);
    await duenio.query(alta.texto, alta.params);
    expect(await llamadas(), "el INSERT de una línea simple corre T1 (camino corto)").toBe(base + 1);
    await duenio.query(`UPDATE "CuentaItem" SET "numeroEnvio" = 1 WHERE "id" = $1`, [alta.id]);
    await duenio.query(`UPDATE "CuentaItem" SET "operacionId" = NULL, "precioUnitario" = 1100.00 WHERE "id" = $1`, [alta.id]);
    expect(await llamadas(), "ni `numeroEnvio` ni `operacionId` ni el precio lo disparan").toBe(base + 1);
    await duenio.query(`UPDATE "CuentaItem" SET "cuentaId" = $2 WHERE "id" = $1`, [alta.id, e.cuentaAOtraId]);
    expect(await llamadas(), "mover de cuenta sí lo dispara").toBe(base + 2);
  });

  it("un espejo de una línea simple (como hoy) se inserta igual, y uno cuyo original no se ve lo decide la clave foránea (23503), no el disparador", async () => {
    const duenio = await conexionDelDuenio();
    const original = linea(e.cuentaAId);
    expect(await probar(duenio, original)).toBeNull();
    expect(await probar(duenio, linea(e.cuentaAId, { anulaAItemId: original.id, cantidad: -1 }))).toBeNull();
    expect(await probar(duenio, linea(e.cuentaAId, { anulaAItemId: "no-existe", cantidad: -1 }))).toEqual(rechazo("CuentaItem_empresaId_anulaAItemId_fkey", "23503"));
  });
});

describe("T1: las reglas de la línea padre, la huella y el espejo", () => {
  it("un adicional con padre de OTRA cuenta, con padre inexistente o con sí mismo como padre da 23514 (`padre_misma_cuenta`)", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, adicionalSql(e.cuentaAOtraId, padre.id))).toEqual(rechazo("CuentaItem_padre_misma_cuenta_chk"));
    expect(await probar(duenio, adicionalSql(e.cuentaAId, "no-existe"))).toEqual(rechazo("CuentaItem_padre_misma_cuenta_chk"));
    const propio = randomUUID();
    expect(await probar(duenio, adicionalSql(e.cuentaAId, propio, { id: propio }))).toEqual(rechazo("CuentaItem_padre_misma_cuenta_chk"));
    expect(await probar(duenio, adicionalSql(e.cuentaAId, padre.id)), "el adicional bien armado entra").toBeNull();
  });

  it("el padre de un adicional no puede ser otro adicional ni un espejo (un solo nivel): 23514 (`padre_un_nivel`)", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const espejo = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: -1, precioUnitario: "1000.00", huellaOpciones: HUELLA_DE_PRUEBA, anulaAItemId: padre.id, creadoPorId: e.usuarioId } as never });
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, adicionalSql(e.cuentaAId, adicional.id)), "el padre es un adicional").toEqual(rechazo("CuentaItem_padre_un_nivel_chk"));
    expect(await probar(duenio, adicionalSql(e.cuentaAId, espejo.id)), "el padre es un espejo").toEqual(rechazo("CuentaItem_padre_un_nivel_chk"));
  });

  it("la huella y la línea padre de una línea no cambian nunca (23514 `opciones_inmutables`), ni al ponerlas, ni al sacarlas, ni al cambiarlas por otras", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const otroPadre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const simple = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId } });
    const duenio = await conexionDelDuenio();
    const cambiar = (id: string, columna: string, valor: string | null) => intentar(duenio, `UPDATE "CuentaItem" SET "${columna}" = $2 WHERE "id" = $1`, [id, valor]);
    expect(await cambiar(padre.id, "huellaOpciones", "f".repeat(64))).toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    expect(await cambiar(padre.id, "huellaOpciones", null)).toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    expect(await cambiar(simple.id, "huellaOpciones", HUELLA_DE_PRUEBA), "ponerle huella a una línea simple").toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    expect(await cambiar(adicional.id, "lineaPadreId", otroPadre.id)).toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    expect(await cambiar(adicional.id, "lineaPadreId", null)).toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    expect(await cambiar(simple.id, "lineaPadreId", padre.id), "colgar una línea simple de un padre").toEqual(rechazo("CuentaItem_opciones_inmutables_chk"));
    // Escribir el MISMO valor no es un cambio.
    expect(await cambiar(padre.id, "huellaOpciones", HUELLA_DE_PRUEBA)).toBeNull();
    expect(await cambiar(adicional.id, "lineaPadreId", padre.id)).toBeNull();
  });

  it("un adicional, o una línea con adicionales, no se mueve de cuenta (23514); una línea sin hijos se mueve (el disparador no se mete)", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const suelta = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId } });
    const duenio = await conexionDelDuenio();
    const mover = (id: string) => intentar(duenio, `UPDATE "CuentaItem" SET "cuentaId" = $2 WHERE "id" = $1`, [id, e.cuentaAOtraId]);
    expect(await mover(adicional.id), "el adicional").toEqual(rechazo("CuentaItem_padre_misma_cuenta_chk"));
    expect(await mover(padre.id), "el padre con adicionales").toEqual(rechazo("CuentaItem_padre_misma_cuenta_chk"));
    expect(await mover(suelta.id), "la línea sin hijos").toBeNull();
    expect((await prismaAdmin.cuentaItem.findUniqueOrThrow({ where: { id: suelta.id } })).cuentaId).toBe(e.cuentaAOtraId);
  });

  it("mover de cuenta una línea sin hijos a una sucursal fuera del alcance responde como hoy: la RLS lo frena con 42501, no el disparador", async () => {
    const suelta = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId } });
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await intentar(app, `UPDATE "CuentaItem" SET "cuentaId" = $2 WHERE "id" = $1`, [suelta.id, e.cuentaBId])).toMatchObject({ codigo: "42501" });
    expect((await prismaAdmin.cuentaItem.findUniqueOrThrow({ where: { id: suelta.id } })).cuentaId).toBe(e.cuentaAId);
  });

  it("el espejo repite la huella y el padre del original: uno de un adicional con OTRO padre, uno de un padre sin su huella y uno de una línea simple con huella dan 23514 (`espejo_coherente`); los coherentes entran", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const otroPadre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const simple = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId } });
    const duenio = await conexionDelDuenio();
    const espejoDe = (original: string, productoId: string, extra: Record<string, unknown>) => sentenciaDeLinea({ cuentaId: e.cuentaAId, productoId }, { ...PROPIA, anulaAItemId: original, cantidad: -1, ...extra });
    expect(await probar(duenio, espejoDe(adicional.id, e.anclaDelShotId, { precioUnitario: "200.00", lineaPadreId: otroPadre.id })), "otro padre").toEqual(rechazo("CuentaItem_espejo_coherente_chk"));
    expect(await probar(duenio, espejoDe(adicional.id, e.anclaDelShotId, { precioUnitario: "200.00" })), "un espejo de adicional sin padre").toEqual(rechazo("CuentaItem_espejo_coherente_chk"));
    expect(await probar(duenio, espejoDe(padre.id, e.cafeId, {})), "un espejo de un padre sin su huella").toEqual(rechazo("CuentaItem_espejo_coherente_chk"));
    expect(await probar(duenio, espejoDe(padre.id, e.cafeId, { huellaOpciones: "e".repeat(64) })), "con otra huella").toEqual(rechazo("CuentaItem_espejo_coherente_chk"));
    expect(await probar(duenio, espejoDe(simple.id, e.cafeId, { huellaOpciones: HUELLA_DE_PRUEBA })), "huella inventada en el espejo de una línea simple").toEqual(rechazo("CuentaItem_espejo_coherente_chk"));
    expect(await probar(duenio, espejoDe(padre.id, e.cafeId, { huellaOpciones: HUELLA_DE_PRUEBA })), "el espejo del padre, con su huella").toBeNull();
    expect(await probar(duenio, espejoDe(adicional.id, e.anclaDelShotId, { precioUnitario: "200.00", lineaPadreId: padre.id })), "el espejo del adicional, con su padre").toBeNull();
    expect(await probar(duenio, espejoDe(simple.id, e.cafeId, {})), "el espejo de una línea simple, como hoy").toBeNull();
  });
});

describe("los CHECK de la línea y de la operación", () => {
  it("un adicional con promo, con precio de carta, en $0 o con huella da 23514 (`CuentaItem_adicional_chk`); sin ningún defecto entra", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const duenio = await conexionDelDuenio();
    for (const [cual, extra] of [
      ["con promo", { promoCuentaId: "una-promo" }],
      ["con precio de carta", { precioCartaUnitario: "250.00" }],
      ["en $0", { precioUnitario: "0.00" }],
      ["con un precio negativo", { precioUnitario: "-1.00" }],
      ["con huella", { huellaOpciones: HUELLA_DE_PRUEBA }],
    ] as const) {
      expect(await probar(duenio, adicionalSql(e.cuentaAId, padre.id, extra)), cual).toEqual(rechazo("CuentaItem_adicional_chk"));
    }
    expect(await probar(duenio, adicionalSql(e.cuentaAId, padre.id, { precioUnitario: "0.01" })), "el piso, 0,01, entra").toBeNull();
    expect(await cuantos("CuentaItem", `"lineaPadreId" IS NOT NULL`)).toBe(1);
  });

  it("la huella tiene que ser de 64 caracteres hexadecimales en minúscula (23514 `huella_opciones`); una línea sin padre puede llevar o no huella", async () => {
    const duenio = await conexionDelDuenio();
    for (const mala of ["", "abc", "f".repeat(63), "f".repeat(65), "F".repeat(64), "g".repeat(64), ` ${"f".repeat(63)}`]) {
      expect(await probar(duenio, linea(e.cuentaAId, { huellaOpciones: mala })), JSON.stringify(mala)).toEqual(rechazo("CuentaItem_huella_opciones_chk"));
    }
    expect(await probar(duenio, linea(e.cuentaAId, { huellaOpciones: "0123456789abcdef".repeat(4) }))).toBeNull();
    expect(await probar(duenio, linea(e.cuentaAId))).toBeNull();
  });

  it("una operación hija solo de una VENTA, que no es su propio padre y no lleva promo: de una COMPRA, de sí misma o con promo da 23514 (`padre_solo_venta`)", async () => {
    const venta = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:00:00Z"), usuarioId: e.usuarioId } });
    const duenio = await conexionDelDuenio();
    const hija = (extra: Record<string, unknown>) =>
      sentenciaDe("Operacion", { id: randomUUID(), ...PROPIA, sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:00:00Z"), usuarioId: e.usuarioId, operacionPadreId: venta.id, ...extra });
    expect(await probar(duenio, hija({ proceso: "COMPRA", proveedorId: e.proveedorId }))).toEqual(rechazo("Operacion_padre_solo_venta_chk"));
    const propia = randomUUID();
    expect(await probar(duenio, hija({ id: propia, operacionPadreId: propia }))).toEqual(rechazo("Operacion_padre_solo_venta_chk"));
    expect(await probar(duenio, hija({ promoCuentaId: "una-promo" }))).toEqual(rechazo("Operacion_padre_solo_venta_chk"));
    expect(await probar(duenio, hija({}))).toBeNull();
    expect(await probar(duenio, hija({ operacionPadreId: "no-existe" })), "un padre inexistente lo para la clave foránea").toEqual(rechazo("Operacion_empresaId_operacionPadreId_fkey", "23503"));
    expect(await cuantos("Operacion", `"operacionPadreId" IS NOT NULL`)).toBe(1);
  });

  it("T3: la operación padre no cambia nunca (23514 `padre_inmutable`), ni a otra, ni a NULL; escribir lo mismo y los demás UPDATE de hoy pasan; un padre con hijas no se borra (23503)", async () => {
    const venta = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:00:00Z"), usuarioId: e.usuarioId } });
    const otra = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:05:00Z"), usuarioId: e.usuarioId } });
    const hija = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, proceso: "VENTA", fecha: new Date("2026-10-01T12:00:00Z"), usuarioId: e.usuarioId, operacionPadreId: venta.id } as never });
    const duenio = await conexionDelDuenio();
    const cambiar = (valor: string | null) => intentar(duenio, `UPDATE "Operacion" SET "operacionPadreId" = $2 WHERE "id" = $1`, [hija.id, valor]);
    expect(await cambiar(otra.id)).toEqual(rechazo("Operacion_padre_inmutable_chk"));
    expect(await cambiar(null)).toEqual(rechazo("Operacion_padre_inmutable_chk"));
    expect(await intentar(duenio, `UPDATE "Operacion" SET "operacionPadreId" = $2 WHERE "id" = $1`, [venta.id, otra.id]), "ponerle padre a una operación sin padre").toEqual(rechazo("Operacion_padre_inmutable_chk"));
    expect(await cambiar(venta.id), "el mismo valor").toBeNull();
    expect(await intentar(duenio, `UPDATE "Operacion" SET "anuladaEn" = now(), "anuladaPorId" = $2, "resultadoMensaje" = 'Anulada', "motivoAnulacion" = 'Prueba' WHERE "id" = $1`, [hija.id, e.usuarioId]), "los UPDATE de hoy no lo disparan").toBeNull();
    expect(await intentar(duenio, `DELETE FROM "Operacion" WHERE "id" = $1`, [venta.id])).toMatchObject({ codigo: "23503" });
  });
});

describe("la cascada del borrador y el padre con adicionales (I15)", () => {
  it("como motor2_app, borrar un borrador con foto borra la foto con él, aunque la app no tenga DELETE sobre la foto", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoVariante(padre.id))).toBeNull();
    expect(await probar(app, fotoChico(padre.id))).toBeNull();
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(2);
    expect(await intentar(app, `DELETE FROM "OpcionElegidaEnLinea" WHERE "cuentaItemId" = $1`, [padre.id]), "la app no borra fotos").toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "id" = $1 AND "numeroEnvio" IS NULL`, [padre.id])).toBeNull();
    expect(await cuantos("CuentaItem", `"id" = '${padre.id}'`)).toBe(0);
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(0);
  });

  it("borrar un padre con adicionales colgados da 23503 y no deja nada a medias; borrando primero el adicional (con su foto), el padre se va", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoShot(adicional.id))).toBeNull();
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "id" = $1`, [padre.id])).toEqual(rechazo("CuentaItem_empresaId_lineaPadreId_fkey", "23503"));
    expect(await cuantos("CuentaItem", `"id" = '${padre.id}'`)).toBe(1);
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "id" = $1`, [adicional.id])).toBeNull();
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(0);
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "id" = $1`, [padre.id])).toBeNull();
  });

  it("quitar una promo sin enviar (`DELETE` de los componentes de la promo) con un adicional colgado de un componente da 23503: falla cerrado, no se pierde el adicional", async () => {
    const seccion = await prisma.seccionCarta.create({ data: { nombre: "Menús" } });
    const promoCarta = await prisma.promoCarta.create({ data: { sucursales: { create: { sucursalId: e.sucursalA } }, seccionCartaId: seccion.id, titulo: "Combo", precio: 1, activa: true } });
    const promoCuenta = await prisma.promoCuenta.create({ data: { cuentaId: e.cuentaAId, promoCartaId: promoCarta.id, precio: 1000, titulo: "Combo", creadoPorId: e.usuarioId } });
    const componente = await sembrarLineaConOpciones(e.cuentaAId, e, { promoCuentaId: promoCuenta.id, precioCartaUnitario: "1200.00" });
    await sembrarAdicional(e.cuentaAId, componente.id, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await intentar(app, `DELETE FROM "CuentaItem" WHERE "promoCuentaId" = $1`, [promoCuenta.id])).toEqual(rechazo("CuentaItem_empresaId_lineaPadreId_fkey", "23503"));
    expect(await cuantos("CuentaItem")).toBe(2);
  });
});

describe("la foto no cambia aunque cambie lo que la originó (I9)", () => {
  it("después de una versión 2 de la opción, de otro precio por producto, de otro precio en la sucursal y de renombrar el grupo y la opción, la fila de la foto es idéntica", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    const foto = fotoChico(padre.id);
    expect(await probar(app, foto)).toBeNull();
    const antes = await fotoDe(foto.id);
    await prisma.versionDeOpcion.create({ data: { opcionId: e.chicoId, numero: 2, tipoDeDiferencia: "PORCENTAJE", porcentaje: "-12.5000", factorEscala: "0.7500", creadoPorId: e.usuarioId } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: e.chicoId }, data: { tipoDeDiferencia: "MONTO", diferenciaPrecio: "-999.00", version: 2 } });
    await prisma.precioLocalDeOpcion.create({ data: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.chicoId, precio: "777.00" } });
    await prisma.grupoDeOpciones.update({ where: { id: e.grupoMedidaId }, data: { nombre: "Medida" } });
    await prisma.opcionDeGrupo.update({ where: { id: e.chicoId }, data: { nombre: "Pequeño" } });
    await prisma.producto.update({ where: { id: e.cafeId }, data: { nombre: "Café doble", precioVenta: "2000.00" } });
    expect(await fotoDe(foto.id)).toBe(antes);
    const fila = JSON.parse(antes) as Record<string, unknown>;
    expect([fila.nombreGrupo, fila.nombreOpcion, fila.importeUnitario, fila.factorEscala]).toEqual(["Tamaño", "Chico", "-50", "0.5"]);
  });
});

describe("T2 y los CHECK de la foto, cada uno en su borde", () => {
  it("una foto bien armada de cada tipo entra: MEDIDA, VARIANTE, INCLUIDA (en 0) y ADICIONAL (en una línea con padre y con el ancla)", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoChico(padre.id))).toBeNull();
    expect(await probar(app, fotoVariante(padre.id))).toBeNull();
    expect(await probar(app, sentenciaDeFoto({ ...e, cuentaItemId: padre.id }, { grupoId: e.grupoIncluidaId, opcionId: e.azucarId, versionDeOpcionId: e.versionDe[e.azucarId]!, tipoGrupo: "INCLUIDA", nombreGrupo: "Viene con", nombreOpcion: "Azúcar" }))).toBeNull();
    expect(await probar(app, fotoShot(adicional.id))).toBeNull();
    expect(await probar(app, fotoVariante(padre.id, { opcionId: e.almendrasId, versionDeOpcionId: e.versionDe[e.almendrasId]!, nombreOpcion: "Almendras", tipoDeDiferencia: "PORCENTAJE", porcentaje: "15.0000", importeUnitario: "150.00", cantidad: 2 })), "una variante en porcentaje").toBeNull();
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(5);
  });

  it("T2: el tipo cambiado, la opción de otro grupo, la versión de OTRA opción y la línea que no existe dan 23514", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoVariante(padre.id, { tipoGrupo: "INCLUIDA" })), "tipoGrupo distinto del del grupo").toEqual(rechazo("OpcionElegidaEnLinea_opcion_del_grupo_chk"));
    expect(await probar(app, fotoVariante(padre.id, { grupoId: e.grupoMedidaId })), "la opción no es de ese grupo").toEqual(rechazo("OpcionElegidaEnLinea_opcion_del_grupo_chk"));
    expect(await probar(app, fotoVariante(padre.id, { opcionId: "no-existe" })), "opción inexistente").toEqual(rechazo("OpcionElegidaEnLinea_opcion_del_grupo_chk"));
    expect(await probar(app, fotoVariante(padre.id, { versionDeOpcionId: e.versionDe[e.almendrasId]! })), "la versión es de otra opción").toEqual(rechazo("OpcionElegidaEnLinea_version_de_la_opcion_chk"));
    expect(await probar(app, fotoVariante("no-existe"))).toEqual(rechazo("OpcionElegidaEnLinea_linea_valida_chk"));
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(0);
  });

  it("T2: la foto en un espejo, la de un ADICIONAL en una línea sin padre o con otro producto, y la de otro tipo en una línea sin huella o con padre dan 23514", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const sinHuella = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId } });
    const otroProducto = await sembrarAdicional(e.cuentaAId, padre.id, e, { productoId: e.lecheId });
    const espejo = await prisma.cuentaItem.create({ data: { cuentaId: e.cuentaAId, productoId: e.cafeId, cantidad: -1, precioUnitario: "1000.00", huellaOpciones: HUELLA_DE_PRUEBA, anulaAItemId: padre.id, creadoPorId: e.usuarioId } as never });
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoVariante(espejo.id)), "la foto en un espejo").toEqual(rechazo("OpcionElegidaEnLinea_linea_valida_chk"));
    expect(await probar(app, fotoShot(padre.id)), "un ADICIONAL en la línea padre (sin padre)").toEqual(rechazo("OpcionElegidaEnLinea_adicional_en_su_linea_chk"));
    expect(await probar(app, fotoShot(otroProducto.id)), "un ADICIONAL en una línea con otro producto").toEqual(rechazo("OpcionElegidaEnLinea_adicional_en_su_linea_chk"));
    expect(await probar(app, fotoVariante(sinHuella.id)), "una variante en una línea sin huella").toEqual(rechazo("OpcionElegidaEnLinea_opcion_en_su_linea_chk"));
    expect(await probar(app, fotoVariante(adicional.id)), "una variante en una línea con padre").toEqual(rechazo("OpcionElegidaEnLinea_opcion_en_su_linea_chk"));
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(0);
  });

  it("a lo sumo una MEDIDA y un ADICIONAL por línea (23505), y la misma opción no se repite en la línea", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoChico(padre.id))).toBeNull();
    expect(await probar(app, fotoChico(padre.id, { opcionId: e.medianoId, versionDeOpcionId: e.versionDe[e.medianoId]!, nombreOpcion: "Mediano" })), "dos MEDIDA en la línea").toEqual({ codigo: "23505", restriccion: "OpcionElegidaEnLinea_una_medida_por_linea_key" });
    expect(await probar(app, fotoChico(padre.id))).toEqual({ codigo: "23505", restriccion: "OpcionElegidaEnLinea_cuentaItemId_opcionId_key" });
    expect(await probar(app, fotoShot(adicional.id))).toBeNull();
    expect(await probar(app, fotoShot(adicional.id)), "el mismo ADICIONAL dos veces en su línea").toMatchObject({ codigo: "23505" });
    expect(await probar(app, fotoVariante(padre.id))).toBeNull();
    expect(await probar(app, fotoVariante(padre.id, { opcionId: e.almendrasId, versionDeOpcionId: e.versionDe[e.almendrasId]!, nombreOpcion: "Almendras" })), "dos VARIANTE distintas sí pueden convivir en la tabla").toBeNull();
  });

  it("los CHECK del precio: una INCLUIDA con importe, un ADICIONAL sin monto fijo o en menos de 0,01, un ABSOLUTO sin precio y una DIFERENCIA sin tipo dan 23514", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const adicional = await sembrarAdicional(e.cuentaAId, padre.id, e);
    const app = await conexionComoApp(undefined, alcanceA());
    const incluida = (extra: Record<string, unknown>) =>
      sentenciaDeFoto({ ...e, cuentaItemId: padre.id }, { grupoId: e.grupoIncluidaId, opcionId: e.azucarId, versionDeOpcionId: e.versionDe[e.azucarId]!, tipoGrupo: "INCLUIDA", nombreGrupo: "Viene con", nombreOpcion: "Azúcar", ...extra });
    expect(await probar(app, incluida({ importeUnitario: "5.00" })), "INCLUIDA con importe").toEqual(rechazo("OpcionElegidaEnLinea_incluida_chk"));
    expect(await probar(app, incluida({ tipoDeDiferencia: "MONTO" })), "INCLUIDA con tipo de diferencia").toEqual(rechazo("OpcionElegidaEnLinea_incluida_chk"));
    expect(await probar(app, fotoShot(adicional.id, { importeUnitario: "0.00" })), "ADICIONAL en $0").toEqual(rechazo("OpcionElegidaEnLinea_adicional_chk"));
    expect(await probar(app, fotoShot(adicional.id, { tipoDeDiferencia: null })), "ADICIONAL sin tipo (el NULL no se cuela)").toEqual(rechazo("OpcionElegidaEnLinea_adicional_chk"));
    expect(await probar(app, fotoShot(adicional.id, { tipoDeDiferencia: "PORCENTAJE", porcentaje: "10.0000" })), "ADICIONAL en porcentaje").toEqual(rechazo("OpcionElegidaEnLinea_adicional_chk"));
    expect(await probar(app, fotoChico(padre.id, { modoPrecio: "ABSOLUTO", tipoDeDiferencia: null, importeUnitario: "0.00" })), "ABSOLUTO en $0").toEqual(rechazo("OpcionElegidaEnLinea_absoluto_chk"));
    expect(await probar(app, fotoChico(padre.id, { modoPrecio: "ABSOLUTO", importeUnitario: "900.00" })), "ABSOLUTO con tipo de diferencia").toEqual(rechazo("OpcionElegidaEnLinea_absoluto_chk"));
    expect(await probar(app, fotoChico(padre.id, { tipoDeDiferencia: null })), "DIFERENCIA sin tipo").toEqual(rechazo("OpcionElegidaEnLinea_diferencia_de_medida_chk"));
    expect(await probar(app, fotoChico(padre.id, { modoPrecio: "ABSOLUTO", tipoDeDiferencia: null, importeUnitario: "900.00" })), "ABSOLUTO a 900,00").toBeNull();
  });

  it("los CHECK de la MEDIDA y de la diferencia: modo solo en MEDIDA, factor solo en MEDIDA, MEDIDA siempre con cantidad 1, el porcentaje en su rango y siempre con su tipo (el NULL no se cuela)", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    expect(await probar(app, fotoChico(padre.id, { cantidad: 2 })), "MEDIDA con cantidad 2").toEqual(rechazo("OpcionElegidaEnLinea_medida_chk"));
    expect(await probar(app, fotoChico(padre.id, { modoPrecio: null })), "MEDIDA sin modo").toEqual(rechazo("OpcionElegidaEnLinea_medida_chk"));
    expect(await probar(app, fotoVariante(padre.id, { modoPrecio: "DIFERENCIA", tipoDeDiferencia: "MONTO" })), "VARIANTE con modo").toEqual(rechazo("OpcionElegidaEnLinea_medida_chk"));
    expect(await probar(app, fotoVariante(padre.id, { factorEscala: "1.0000" })), "VARIANTE con factor").toEqual(rechazo("OpcionElegidaEnLinea_medida_chk"));
    expect(await probar(app, fotoVariante(padre.id, { porcentaje: "10.0000" })), "porcentaje con el tipo NULL").toEqual(rechazo("OpcionElegidaEnLinea_diferencia_chk"));
    expect(await probar(app, fotoVariante(padre.id, { tipoDeDiferencia: "PORCENTAJE" })), "tipo PORCENTAJE sin porcentaje").toEqual(rechazo("OpcionElegidaEnLinea_diferencia_chk"));
    expect(await probar(app, fotoVariante(padre.id, { tipoDeDiferencia: "MONTO", porcentaje: "10.0000" })), "tipo MONTO con porcentaje").toEqual(rechazo("OpcionElegidaEnLinea_diferencia_chk"));
    // Con un tipo cerrado y un porcentaje, el rango de la base es el del núcleo (-100 se rechaza, 1000 desborda).
    const enPorcentaje = (porcentaje: string) => fotoVariante(padre.id, { tipoDeDiferencia: "PORCENTAJE", porcentaje, importeUnitario: "10.00" });
    expect(await probar(app, enPorcentaje("-100.0000"))).toEqual(rechazo("OpcionElegidaEnLinea_porcentaje_chk"));
    expect(await probar(app, enPorcentaje("1000.0000"))).toMatchObject({ codigo: "22003" });
    for (const [orden, borde] of ["-99.9999", "999.9999"].entries()) {
      const s = fotoVariante(padre.id, { opcionId: orden === 0 ? e.vacaId : e.almendrasId, versionDeOpcionId: e.versionDe[orden === 0 ? e.vacaId : e.almendrasId]!, tipoDeDiferencia: "PORCENTAJE", porcentaje: borde, importeUnitario: "10.00" });
      expect(await probar(app, s), borde).toBeNull();
    }
    expect(await probar(app, fotoChico(padre.id, { opcionId: e.medianoId, versionDeOpcionId: e.versionDe[e.medianoId]!, factorEscala: "0" })), "factor 0").toEqual(rechazo("OpcionElegidaEnLinea_factor_chk"));
    expect(await probar(app, fotoChico(padre.id, { opcionId: e.medianoId, versionDeOpcionId: e.versionDe[e.medianoId]!, factorEscala: "10.0001" })), "factor de más de 10").toEqual(rechazo("OpcionElegidaEnLinea_factor_chk"));
  });

  it("la cantidad es de 1 a 10 y los nombres congelados tienen un carácter visible y hasta 80; el tipo y los modos son listas cerradas", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    for (const mala of [0, 11, -1]) expect(await probar(app, fotoVariante(padre.id, { cantidad: mala })), `cantidad ${mala}`).toEqual(rechazo("OpcionElegidaEnLinea_cantidad_chk"));
    for (const malo of ["", "\t", "x".repeat(81)]) {
      expect(await probar(app, fotoVariante(padre.id, { nombreGrupo: malo })), `grupo ${malo.length}`).toEqual(rechazo("OpcionElegidaEnLinea_nombres_chk"));
      expect(await probar(app, fotoVariante(padre.id, { nombreOpcion: malo })), `opción ${malo.length}`).toEqual(rechazo("OpcionElegidaEnLinea_nombres_chk"));
    }
    // Un tipo o modo fuera de lista rompe, además, la coherencia con el grupo o con la MEDIDA, que se informa primero por el disparador o por el nombre.
    expect(await probar(app, fotoVariante(padre.id, { tipoDeDiferencia: "OTRO" }))).toMatchObject({ codigo: "23514" });
    expect(await probar(app, fotoChico(padre.id, { modoPrecio: "OTRO" }))).toMatchObject({ codigo: "23514" });
    expect(await probar(app, fotoVariante(padre.id, { cantidad: 10 }))).toBeNull();
  });

  it("la foto referencia a SU línea, grupo, opción y versión con claves compuestas RESTRICT salvo la línea (CASCADE)", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"OpcionElegidaEnLinea"'::regclass AND contype = 'f' ORDER BY 1`;
    expect(fks.map((f) => f.nombre)).toEqual([
      "OpcionElegidaEnLinea_empresaId_cuentaItemId_fkey", "OpcionElegidaEnLinea_empresaId_fkey", "OpcionElegidaEnLinea_empresaId_grupoId_fkey", "OpcionElegidaEnLinea_empresaId_opcionId_fkey", "OpcionElegidaEnLinea_empresaId_versionDeOpcionId_fkey",
    ]);
    const def = (n: string) => fks.find((f) => f.nombre === n)!.definicion;
    expect(def("OpcionElegidaEnLinea_empresaId_cuentaItemId_fkey")).toBe('FOREIGN KEY ("empresaId", "cuentaItemId") REFERENCES "CuentaItem"("empresaId", id) ON UPDATE CASCADE ON DELETE CASCADE');
    for (const n of ["OpcionElegidaEnLinea_empresaId_grupoId_fkey", "OpcionElegidaEnLinea_empresaId_opcionId_fkey", "OpcionElegidaEnLinea_empresaId_versionDeOpcionId_fkey", "OpcionElegidaEnLinea_empresaId_fkey"]) {
      expect(def(n), n).toMatch(/ON DELETE RESTRICT/);
    }
  });
});

describe("la foto solo se agrega", () => {
  it("privilegios EXACTOS: motor2_app tiene SELECT e INSERT y ninguna columna actualizable; motor2_plataforma, nada; la RLS por empresa está puesta, sin FORCE", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'OpcionElegidaEnLinea' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 2`;
    expect(filas).toEqual([{ rol: "motor2_app", privilegio: "INSERT" }, { rol: "motor2_app", privilegio: "SELECT" }]);
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"OpcionElegidaEnLinea"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`;
    expect(columnas).toEqual([]);
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"OpcionElegidaEnLinea"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
  });

  it("como motor2_app, UPDATE y DELETE de una foto dan 42501, y la foto queda", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const app = await conexionComoApp(undefined, alcanceA());
    const foto = fotoVariante(padre.id);
    expect(await probar(app, foto)).toBeNull();
    for (const columna of ["importeUnitario", "nombreOpcion", "cantidad", "cuentaItemId", "empresaId"]) {
      expect(await intentar(app, `UPDATE "OpcionElegidaEnLinea" SET "${columna}" = "${columna}" WHERE "id" = $1`, [foto.id]), columna).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `DELETE FROM "OpcionElegidaEnLinea" WHERE "id" = $1`, [foto.id])).toMatchObject({ codigo: "42501" });
    expect(await intentar(app, `TRUNCATE "OpcionElegidaEnLinea"`)).toMatchObject({ codigo: "42501" });
    expect(await cuantos("OpcionElegidaEnLinea")).toBe(1);
  });

  it("una opción, un grupo o una versión usada por una foto no se puede borrar (RESTRICT), ni como dueño", async () => {
    const padre = await sembrarLineaConOpciones(e.cuentaAId, e);
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, fotoVariante(padre.id))).toBeNull();
    for (const [tabla, id] of [["OpcionDeGrupo", e.vacaId], ["GrupoDeOpciones", e.grupoVarianteId], ["VersionDeOpcion", e.versionDe[e.vacaId]!]] as const) {
      expect(await intentar(duenio, `DELETE FROM "${tabla}" WHERE "id" = $1`, [id]), tabla).toMatchObject({ codigo: "23503" });
    }
  });
});

describe("el migration.sql y el down.sql", () => {
  it("avisan que requieren autorización y que la reversa aborta con datos, nombran los tres disparadores y no se disfrazan de migración de políticas de sucursal", () => {
    const subida = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    for (const nombre of ["CuentaItem_opciones_chk", "OpcionElegidaEnLinea_coherente_chk", "Operacion_padre_inmutable_chk"]) expect(subida).toContain(`CREATE TRIGGER "${nombre}"`);
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    for (const nombre of ["CuentaItem_opciones_chk", "Operacion_padre_inmutable_chk"]) expect(reversa).toContain(`DROP TRIGGER IF EXISTS "${nombre}"`);
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

/** Un INSERT de una fila de cualquier tabla para un cliente `pg` (con `$1...`). */
function sentenciaDe(tabla: string, datos: Record<string, unknown>) {
  const columnas = Object.keys(datos);
  return { texto: `INSERT INTO "${tabla}" (${columnas.map((c) => `"${c}"`).join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`, params: columnas.map((c) => datos[c]) };
}
