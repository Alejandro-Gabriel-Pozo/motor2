import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Proceso } from "@prisma/client";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase } from "../setup/test-db";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";

/**
 * M2-1 (Paquete 2): las columnas de `Operacion` para las reversiones, el motivo de anulación, la merma por anulación y el reemplazo de unidades, más el motivo de cancelación del conteo
 * (migración 20261015120000_m2_operacion_reversiones_y_motivo). Tres mitades: (1) la migración deja todo puesto y validado; (2) cada regla rechaza, con el nombre de su CHECK / índice / FK,
 * una fila que la rompe; (3) los dos árbitros de la base que protegen contra la carrera y el reintento: UNA sola reversión por operación (dos anulaciones a la vez) y UNA sola merma por
 * anulación (un reintento).
 *
 * Las filas inválidas de los CHECK se arman con un UPDATE crudo del dueño sobre una fila válida (el CHECK rige igual para INSERT y UPDATE) para que el mensaje sea el de Postgres y traiga el
 * nombre de la restricción. Mutación: sacar un CHECK (o el índice único) de la migración deja en rojo solo su caso.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261015120000_m2_operacion_reversiones_y_motivo");

const CHECKS = [
  "Operacion_revierte_solo_ajuste_chk",
  "Operacion_motivo_anulacion_chk",
  "Operacion_merma_por_anulacion_solo_merma_chk",
  "Operacion_reemplaza_solo_venta_chk",
  "ConteoFisico_motivo_cancelacion_chk",
];
const INDICES_UNICOS = ["Operacion_empresaId_revierteAOperacionId_key", "Operacion_empresaId_mermaPorAnulacionDeId_key", "Operacion_empresaId_reemplazaAOperacionId_key"];
const FOREIGN_KEYS = ["Operacion_empresaId_revierteAOperacionId_fkey", "Operacion_empresaId_mermaPorAnulacionDeId_fkey", "Operacion_empresaId_reemplazaAOperacionId_fkey"];
const COLUMNAS_DE_OPERACION = ["revierteAOperacionId", "motivoAnulacion", "mermaPorAnulacionDeId", "reemplazaAOperacionId"];

let usuarioId: string;
let sucursalId: string;
let productoId: string;
let seccionId: string;

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  sucursalId = base.sucursal.id;
  usuarioId = (await prisma.user.create({ data: { email: "operador@test.com" } })).id;
  const unidad = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
  const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
  productoId = (await prisma.producto.create({ data: { codigo: "MP_A", nombre: "MP_A", tipo: "MP", unidadStockId: unidad.id, insumoId: insumo.id } })).id;
  seccionId = (await prisma.seccion.create({ data: { sucursalId, nombre: "Depósito" } })).id;
});

type DatosOperacion = { proceso: Proceso } & Partial<{
  anuladaEn: Date;
  anuladaPorId: string;
  motivoAnulacion: string;
  revierteAOperacionId: string;
  mermaPorAnulacionDeId: string;
  reemplazaAOperacionId: string;
}>;

/** Una operación por el rol de ejecución (el camino real de la app). */
function operacion(datos: DatosOperacion) {
  return prisma.operacion.create({ data: { sucursalId, fecha: new Date(), usuarioId, ...datos } });
}

/** Una venta ya anulada (la base de una reversión, una merma o un reemplazo). */
const ventaAnulada = (motivoAnulacion?: string) => operacion({ proceso: "VENTA", anuladaEn: new Date(), anuladaPorId: usuarioId, ...(motivoAnulacion ? { motivoAnulacion } : {}) });

/** Aplica `SET ...` (literales fijos de este archivo, sin entrada externa) sobre una fila y exige que falle justo con esa restricción. */
async function exigirRechazo(tabla: "Operacion" | "ConteoFisico", id: string, set: string, restriccion: string) {
  await expect(prismaAdmin.$executeRawUnsafe(`UPDATE "${tabla}" SET ${set} WHERE id = '${id}'`)).rejects.toThrow(new RegExp(restriccion));
}

function conteo(estado: "CANCELADO" | "RESUELTO") {
  return prisma.conteoFisico.create({
    data: { sucursalId, fecha: new Date(), productoId, seccionId, saldoSistema: 5, conteoReal: 3, diferencia: -2, accion: "AJUSTAR", estado, usuarioId },
  });
}

describe("la migración deja las columnas, los índices, las claves foráneas y las reglas puestas y validadas", () => {
  it("existen las 4 columnas de Operacion y la de ConteoFisico, todas NULLABLES y sin valor por defecto", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; is_nullable: string; column_default: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND ((table_name = 'Operacion' AND column_name = ANY(${COLUMNAS_DE_OPERACION}::text[])) OR (table_name = 'ConteoFisico' AND column_name = 'motivoCancelacion'))`;
    expect(filas.map((f) => `${f.tabla}.${f.columna}`).sort()).toEqual([...COLUMNAS_DE_OPERACION.map((c) => `Operacion.${c}`), "ConteoFisico.motivoCancelacion"].sort());
    expect(filas.every((f) => f.is_nullable === "YES" && f.column_default === null)).toBe(true);
  });

  it("existen los 5 CHECK, todos validados", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${CHECKS}::text[])`;
    expect(filas.map((f) => f.conname).sort()).toEqual([...CHECKS].sort());
    expect(filas.every((f) => f.convalidated)).toBe(true);
  });

  it("los 3 índices únicos son sobre (empresaId, columna) y las 3 claves foráneas son compuestas hacia Operacion(empresaId, id) con RESTRICT", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT c.relname::text AS nombre, pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indisunique AND c.relname::text = ANY(${INDICES_UNICOS}::text[])`;
    expect(indices.map((i) => i.nombre).sort()).toEqual([...INDICES_UNICOS].sort());
    for (const i of indices) expect(i.definicion, i.nombre).toMatch(/\("empresaId", "(revierteAOperacionId|mermaPorAnulacionDeId|reemplazaAOperacionId)"\)/);

    const fks = await prismaAdmin.$queryRaw<Array<{ conname: string; definicion: string }>>`
      SELECT conname::text AS conname, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE contype = 'f' AND conname::text = ANY(${FOREIGN_KEYS}::text[])`;
    expect(fks.map((f) => f.conname).sort()).toEqual([...FOREIGN_KEYS].sort());
    for (const f of fks) {
      expect(f.definicion, f.conname).toMatch(/FOREIGN KEY \("empresaId", "\w+"\) REFERENCES "Operacion"\("empresaId", id\) ON UPDATE CASCADE ON DELETE RESTRICT/);
    }
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa puede perder datos", () => {
    const migracion = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(migracion.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    for (const nombre of [...CHECKS, ...INDICES_UNICOS, ...FOREIGN_KEYS]) expect(reversa, `el down.sql saca ${nombre}`).toContain(nombre);
    for (const columna of [...COLUMNAS_DE_OPERACION, "motivoCancelacion"]) expect(reversa, `el down.sql saca la columna ${columna}`).toContain(`"${columna}"`);
  });
});

describe("revierteAOperacionId: la reversión de una anulación", () => {
  it("una AJUSTE puede revertir a una venta, y una operación sin reversión queda con NULL", async () => {
    const venta = await ventaAnulada();
    const reversion = await operacion({ proceso: "AJUSTE", revierteAOperacionId: venta.id });
    expect(reversion.revierteAOperacionId).toBe(venta.id);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id } })).revierteAOperacionId).toBeNull();
    const conReversion = await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id }, include: { reversion: true } });
    expect(conReversion.reversion?.id).toBe(reversion.id);
  });

  it("solo una AJUSTE revierte: cualquier otro proceso se rechaza", async () => {
    const venta = await ventaAnulada();
    for (const proceso of ["VENTA", "COMPRA", "MERMA", "CONSUMO", "CONTROL"] as const) {
      const o = await operacion({ proceso });
      await exigirRechazo("Operacion", o.id, `"revierteAOperacionId" = '${venta.id}'`, "Operacion_revierte_solo_ajuste_chk");
    }
  });

  it("una operación no se revierte a sí misma", async () => {
    const ajuste = await operacion({ proceso: "AJUSTE" });
    await exigirRechazo("Operacion", ajuste.id, `"revierteAOperacionId" = id`, "Operacion_revierte_solo_ajuste_chk");
  });

  it("UNA sola reversión por operación (idempotencia en la base): la segunda se rechaza con el índice único, y otra operación distinta sí puede tener la suya", async () => {
    const venta = await ventaAnulada();
    const otra = await ventaAnulada();
    await operacion({ proceso: "AJUSTE", revierteAOperacionId: venta.id });
    await expect(operacion({ proceso: "AJUSTE", revierteAOperacionId: venta.id })).rejects.toMatchObject({ code: "P2002" });
    await operacion({ proceso: "AJUSTE", revierteAOperacionId: otra.id });
    // Los AJUSTE sin enlace (manuales, reversiones anteriores a M2) no chocan entre sí: Postgres admite muchos NULL.
    await operacion({ proceso: "AJUSTE" });
    await operacion({ proceso: "AJUSTE" });
    expect(await prismaAdmin.operacion.count({ where: { revierteAOperacionId: { not: null } } })).toBe(2);
  });

  it("apuntar a una operación que no existe se rechaza (clave foránea)", async () => {
    await expect(operacion({ proceso: "AJUSTE", revierteAOperacionId: "no-existe" })).rejects.toThrow(/foreign key|Foreign key|revierteAOperacionId/i);
  });

  it("aislamiento entre empresas: una reversión de la empresa A no puede apuntar a una operación de la empresa B (la clave foránea es (empresaId, id))", async () => {
    await prismaAdmin.$executeRawUnsafe(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_testigo','${EMPRESA_TESTIGO_ID}','Testigo')`);
    await prismaAdmin.$executeRawUnsafe(
      `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","anuladaEn") VALUES ('op_testigo','${EMPRESA_TESTIGO_ID}','suc_testigo','VENTA',now(),'${usuarioId}',now())`,
    );
    await expect(operacion({ proceso: "AJUSTE", revierteAOperacionId: "op_testigo" })).rejects.toThrow(/foreign key|Foreign key|revierteAOperacionId/i);
    // La misma referencia dentro de la empresa testigo sí vale: el rechazo es por empresa, no por la operación.
    await prismaAdmin.$executeRawUnsafe(
      `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","revierteAOperacionId") VALUES ('aj_testigo','${EMPRESA_TESTIGO_ID}','suc_testigo','AJUSTE',now(),'${usuarioId}','op_testigo')`,
    );
    expect(EMPRESA_DE_PRUEBA_ID).not.toBe(EMPRESA_TESTIGO_ID);
  });

  it("la operación revertida no se puede borrar mientras tenga su reversión (RESTRICT): se anula, no se borra", async () => {
    const venta = await ventaAnulada();
    await operacion({ proceso: "AJUSTE", revierteAOperacionId: venta.id });
    await expect(prismaAdmin.$executeRawUnsafe(`DELETE FROM "Operacion" WHERE id = '${venta.id}'`)).rejects.toThrow(/Operacion_empresaId_revierteAOperacionId_fkey/);
  });
});

describe("revierteAOperacionId: la carrera de dos anulaciones a la vez", () => {
  it("dos transacciones que revierten la MISMA operación a la vez: una confirma y la otra falla con el índice único (nunca dos reversiones)", async () => {
    const venta = await ventaAnulada();
    const conexion = async () => {
      const cliente = new Client({ connectionString: process.env.DIRECT_URL });
      await cliente.connect();
      return cliente;
    };
    const [a, b, observador] = [await conexion(), await conexion(), await conexion()];
    const insertar = (cliente: Client, id: string) =>
      cliente.query(
        `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","revierteAOperacionId") VALUES ($1,$2,$3,'AJUSTE',now(),$4,$5)`,
        [id, EMPRESA_DE_PRUEBA_ID, sucursalId, usuarioId, venta.id],
      );
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      const pidDeB = (await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await insertar(a, "aj_a");
      // B intenta lo mismo con A todavía abierta: se queda esperando el índice único.
      const enB = insertar(b, "aj_b").then(
        () => "confirmo" as const,
        (e: { code?: string; constraint?: string }) => e,
      );
      // Espera (con tope) a que B esté bloqueada de verdad, no a un sleep a ciegas.
      let bloqueada = false;
      for (let i = 0; i < 100 && !bloqueada; i++) {
        const { rows } = await observador.query(`SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`, [pidDeB]);
        bloqueada = rows.length > 0;
        if (!bloqueada) await new Promise((r) => setTimeout(r, 20));
      }
      expect(bloqueada, "B quedó esperando a A (el índice único la serializa)").toBe(true);
      await a.query("COMMIT");
      const resultadoB = await enB;
      expect(resultadoB).toMatchObject({ code: "23505", constraint: "Operacion_empresaId_revierteAOperacionId_key" });
      await b.query("ROLLBACK");
    } finally {
      await Promise.all([a, b, observador].map((c) => c.end().catch(() => undefined)));
    }
    const reversiones = await prismaAdmin.operacion.findMany({ where: { revierteAOperacionId: venta.id } });
    expect(reversiones.map((r) => r.id)).toEqual(["aj_a"]);
  });

  it("si la que ganó la carrera se deshace (ROLLBACK), la otra sí puede confirmar: el índice no deja una reserva fantasma", async () => {
    const venta = await ventaAnulada();
    const a = new Client({ connectionString: process.env.DIRECT_URL });
    await a.connect();
    try {
      await a.query("BEGIN");
      await a.query(
        `INSERT INTO "Operacion" ("id","empresaId","sucursalId","proceso","fecha","usuarioId","revierteAOperacionId") VALUES ('aj_a','${EMPRESA_DE_PRUEBA_ID}','${sucursalId}','AJUSTE',now(),'${usuarioId}','${venta.id}')`,
      );
      await a.query("ROLLBACK");
    } finally {
      await a.end();
    }
    await operacion({ proceso: "AJUSTE", revierteAOperacionId: venta.id });
    expect(await prismaAdmin.operacion.count({ where: { revierteAOperacionId: venta.id } })).toBe(1);
  });

  it("varias parejas de anulaciones lanzadas a la vez (Promise.all) por el camino real de la app: en cada pareja gana exactamente una", async () => {
    const ventas = await Promise.all(Array.from({ length: 8 }, () => ventaAnulada()));
    const resultados = await Promise.all(
      ventas.flatMap((v) => [0, 1].map(() => operacion({ proceso: "AJUSTE", revierteAOperacionId: v.id }).then(() => "ok" as const, (e: { code?: string }) => e.code ?? "otro"))),
    );
    expect(resultados.filter((r) => r === "ok")).toHaveLength(ventas.length);
    expect(resultados.filter((r) => r === "P2002")).toHaveLength(ventas.length);
    for (const v of ventas) expect(await prismaAdmin.operacion.count({ where: { revierteAOperacionId: v.id } }), v.id).toBe(1);
  });
});

describe("motivoAnulacion: el motivo con que se anuló una operación", () => {
  it("una operación anulada admite un motivo de hasta 200 caracteres (cuenta caracteres, no bytes)", async () => {
    const venta = await ventaAnulada("Se equivocó el mozo");
    expect(venta.motivoAnulacion).toBe("Se equivocó el mozo");
    const justo = await ventaAnulada("ñ".repeat(200));
    expect(justo.motivoAnulacion).toHaveLength(200);
  });

  it("una operación VIGENTE no puede tener motivo de anulación", async () => {
    const venta = await operacion({ proceso: "VENTA" });
    await exigirRechazo("Operacion", venta.id, `"motivoAnulacion" = 'sin anular'`, "Operacion_motivo_anulacion_chk");
    await expect(operacion({ proceso: "VENTA", motivoAnulacion: "sin anular" })).rejects.toThrow(/Operacion_motivo_anulacion_chk/);
  });

  it("el motivo no puede ser vacío ni solo espacios, ni pasar de 200 caracteres", async () => {
    const venta = await ventaAnulada();
    await exigirRechazo("Operacion", venta.id, `"motivoAnulacion" = ''`, "Operacion_motivo_anulacion_chk");
    await exigirRechazo("Operacion", venta.id, `"motivoAnulacion" = '   '`, "Operacion_motivo_anulacion_chk");
    await exigirRechazo("Operacion", venta.id, `"motivoAnulacion" = '${"a".repeat(201)}'`, "Operacion_motivo_anulacion_chk");
  });

  it("una compra anulada también lleva motivo (D9: venta, compra o conteo), y volver a dejarla vigente con el motivo puesto se rechaza", async () => {
    const compra = await operacion({ proceso: "COMPRA", anuladaEn: new Date(), anuladaPorId: usuarioId, motivoAnulacion: "Factura duplicada" });
    expect(compra.motivoAnulacion).toBe("Factura duplicada");
    await exigirRechazo("Operacion", compra.id, `"anuladaEn" = NULL, "anuladaPorId" = NULL`, "Operacion_motivo_anulacion_chk");
  });
});

describe("mermaPorAnulacionDeId: la merma de una venta anulada cuyo género no se recuperó", () => {
  it("una MERMA puede apuntar a la venta anulada de la que sale", async () => {
    const venta = await ventaAnulada("Cliente se fue");
    const merma = await operacion({ proceso: "MERMA", mermaPorAnulacionDeId: venta.id });
    expect(merma.mermaPorAnulacionDeId).toBe(venta.id);
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: venta.id }, include: { mermaPorAnulacion: true } })).mermaPorAnulacion?.id).toBe(merma.id);
  });

  it("solo una MERMA lo lleva, y no se apunta a sí misma", async () => {
    const venta = await ventaAnulada();
    for (const proceso of ["AJUSTE", "VENTA", "CONSUMO"] as const) {
      const o = await operacion({ proceso });
      await exigirRechazo("Operacion", o.id, `"mermaPorAnulacionDeId" = '${venta.id}'`, "Operacion_merma_por_anulacion_solo_merma_chk");
    }
    const merma = await operacion({ proceso: "MERMA" });
    await exigirRechazo("Operacion", merma.id, `"mermaPorAnulacionDeId" = id`, "Operacion_merma_por_anulacion_solo_merma_chk");
  });

  it("IDEMPOTENCIA: una segunda merma de la MISMA anulación (un reintento) se rechaza con el índice único; la de otra anulación sí entra", async () => {
    const venta = await ventaAnulada();
    const otra = await ventaAnulada();
    await operacion({ proceso: "MERMA", mermaPorAnulacionDeId: venta.id });
    await expect(operacion({ proceso: "MERMA", mermaPorAnulacionDeId: venta.id })).rejects.toMatchObject({ code: "P2002" });
    await operacion({ proceso: "MERMA", mermaPorAnulacionDeId: otra.id });
    await operacion({ proceso: "MERMA" });
    await operacion({ proceso: "MERMA" });
    expect(await prismaAdmin.operacion.count({ where: { mermaPorAnulacionDeId: { not: null } } })).toBe(2);
  });

  it("dos mermas de la misma anulación lanzadas a la vez: gana una sola", async () => {
    const venta = await ventaAnulada();
    const resultados = await Promise.all([0, 1, 2].map(() => operacion({ proceso: "MERMA", mermaPorAnulacionDeId: venta.id }).then(() => "ok" as const, (e: { code?: string }) => e.code ?? "otro")));
    expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
    expect(resultados.filter((r) => r === "P2002")).toHaveLength(2);
  });

  it("apuntar a una operación que no existe se rechaza", async () => {
    await expect(operacion({ proceso: "MERMA", mermaPorAnulacionDeId: "no-existe" })).rejects.toThrow(/foreign key|Foreign key|mermaPorAnulacionDeId/i);
  });
});

describe("reemplazaAOperacionId: anular y rehacer unidades", () => {
  it("una VENTA puede reemplazar a otra venta anulada", async () => {
    const original = await ventaAnulada();
    const nueva = await operacion({ proceso: "VENTA", reemplazaAOperacionId: original.id });
    expect((await prisma.operacion.findUniqueOrThrow({ where: { id: original.id }, include: { reemplazadaPor: true } })).reemplazadaPor?.id).toBe(nueva.id);
  });

  it("solo una VENTA reemplaza, y no a sí misma", async () => {
    const original = await ventaAnulada();
    for (const proceso of ["AJUSTE", "COMPRA", "MERMA"] as const) {
      const o = await operacion({ proceso });
      await exigirRechazo("Operacion", o.id, `"reemplazaAOperacionId" = '${original.id}'`, "Operacion_reemplaza_solo_venta_chk");
    }
    const venta = await operacion({ proceso: "VENTA" });
    await exigirRechazo("Operacion", venta.id, `"reemplazaAOperacionId" = id`, "Operacion_reemplaza_solo_venta_chk");
  });

  it("una operación se reemplaza UNA sola vez: el segundo reemplazo se rechaza (también si llegan a la vez)", async () => {
    const original = await ventaAnulada();
    const otra = await ventaAnulada();
    await operacion({ proceso: "VENTA", reemplazaAOperacionId: original.id });
    await expect(operacion({ proceso: "VENTA", reemplazaAOperacionId: original.id })).rejects.toMatchObject({ code: "P2002" });
    const aLaVez = await Promise.all([0, 1].map(() => operacion({ proceso: "VENTA", reemplazaAOperacionId: otra.id }).then(() => "ok" as const, (e: { code?: string }) => e.code ?? "otro")));
    expect(aLaVez.sort()).toEqual(["P2002", "ok"]);
  });
});

describe("ConteoFisico.motivoCancelacion: el motivo con que se canceló un conteo (D9)", () => {
  it("un conteo CANCELADO admite un motivo de hasta 200 caracteres; uno sin motivo (los anteriores a M2) queda con NULL", async () => {
    const c = await conteo("CANCELADO");
    expect(c.motivoCancelacion).toBeNull();
    await prisma.conteoFisico.update({ where: { id: c.id }, data: { motivoCancelacion: "Contamos la sección equivocada" } });
    await prisma.conteoFisico.update({ where: { id: c.id }, data: { motivoCancelacion: "ñ".repeat(200) } });
  });

  it("solo un conteo CANCELADO puede tener motivo de cancelación", async () => {
    const c = await conteo("RESUELTO");
    await exigirRechazo("ConteoFisico", c.id, `"motivoCancelacion" = 'x'`, "ConteoFisico_motivo_cancelacion_chk");
  });

  it("el motivo no puede ser vacío ni solo espacios, ni pasar de 200 caracteres", async () => {
    const c = await conteo("CANCELADO");
    await exigirRechazo("ConteoFisico", c.id, `"motivoCancelacion" = ''`, "ConteoFisico_motivo_cancelacion_chk");
    await exigirRechazo("ConteoFisico", c.id, `"motivoCancelacion" = '  '`, "ConteoFisico_motivo_cancelacion_chk");
    await exigirRechazo("ConteoFisico", c.id, `"motivoCancelacion" = '${"a".repeat(201)}'`, "ConteoFisico_motivo_cancelacion_chk");
  });
});
