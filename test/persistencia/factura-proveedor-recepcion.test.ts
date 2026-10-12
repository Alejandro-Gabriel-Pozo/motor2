import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, opcionesDeConexionConEmpresa } from "../setup/empresa-de-prueba";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { datosDeFactura, datosDeRenglon, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3b (segunda parte, migración 20261016101500_factura_proveedor_recepcion): la RECEPCIÓN de la mercadería por sucursal. El stock de una factura entra recién cuando la factura está REPARTIDA y la parte de esa
 * sucursal está RECIBIDA. Qué fija la base: `estadoRecepcion` (PENDIENTE por defecto o RECIBIDA), `recibidaEn` (la fecha de stock elegida, UTC) y `recibidaPorId`, con CHECK de coherencia; UPDATE solo por columna sobre esas tres; y un
 * DISPARADOR que permite únicamente la transición PENDIENTE a RECIBIDA (una recibida no vuelve atrás ni cambia de fecha ni de persona: se corrige anulando).
 *
 * Idempotencia y concurrencia, con transacciones reales como `motor2_app`: dos confirmaciones de recepción a la vez de la MISMA parte dejan UNA sola (la guarda es `UPDATE ... WHERE "estadoRecepcion" = 'PENDIENTE'`: la segunda espera a la
 * primera, re-evalúa la fila y no encuentra ninguna), y el caso de uso entra stock SOLO si el UPDATE tocó una fila: repetir no duplica stock. Lo que la base NO mira (que la cabecera esté confirmada cuando se recibe) lo valida el caso de uso.
 *
 * Mutación: sacar el CHECK de coherencia, el disparador, o darle UPDATE de más al rol deja en rojo solo sus casos; sacar la guarda `WHERE "estadoRecepcion" = 'PENDIENTE'` duplica el stock en la prueba de concurrencia.
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeFactura;
const abiertos: Client[] = [];
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
});
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.end().catch(() => undefined)));
});

async function nuevaParte(extra: Record<string, unknown> = {}, sucursalId = e.sucursalA) {
  const f = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
  return prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: f.id, sucursalId, porcentajeDeclaradoBp: 10000, ...extra } as never });
}
const RECIBIDA = { estadoRecepcion: "RECIBIDA", recibidaEn: new Date("2026-09-02T15:00:00.000Z"), recibidaPorId: "" };
const recibida = (extra: Record<string, unknown> = {}) => ({ ...RECIBIDA, recibidaPorId: e.usuarioId, ...extra });

async function conexion(): Promise<Client> {
  const sucursales = [e.sucursalA, e.sucursalB];
  const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: sucursales, escritura: sucursales }) });
  await c.connect();
  abiertos.push(c);
  return c;
}

describe("la migración deja las columnas, las reglas, el disparador y los privilegios de la recepción", () => {
  it("estadoRecepcion es TEXT NOT NULL DEFAULT PENDIENTE; recibidaEn (TIMESTAMP) y recibidaPorId son NULLABLES", async () => {
    const c = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; defecto: string | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS defecto FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'FacturaProveedorSucursal' AND column_name IN ('estadoRecepcion', 'recibidaEn', 'recibidaPorId') ORDER BY 1`;
    expect(c).toEqual([
      { columna: "estadoRecepcion", tipo: "text", es_nulable: "NO", defecto: "'PENDIENTE'::text" },
      { columna: "recibidaEn", tipo: "timestamp without time zone", es_nulable: "YES", defecto: null },
      { columna: "recibidaPorId", tipo: "text", es_nulable: "YES", defecto: null },
    ]);
  });

  it("los 3 CHECK y la clave foránea están puestos y validados, y el disparador está activo sobre las tres columnas", async () => {
    const nombres = ["FacturaProveedorSucursal_estado_recepcion_chk", "FacturaProveedorSucursal_recepcion_coherente_chk", "FacturaProveedorSucursal_recibida_por_chk"];
    const r = await prismaAdmin.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`SELECT conname::text AS conname, convalidated FROM pg_constraint WHERE contype = 'c' AND conname::text = ANY(${nombres}::text[])`;
    expect(r.map((x) => x.conname).sort()).toEqual(nombres);
    expect(r.every((x) => x.convalidated)).toBe(true);
    const fk = await prismaAdmin.$queryRaw<Array<{ d: string }>>`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'FacturaProveedorSucursal_recibidaPorId_fkey'`;
    expect(fk[0]!.d).toMatch(/REFERENCES "User"\(id\).*ON DELETE RESTRICT/);
    const t = await prismaAdmin.$queryRaw<Array<{ nombre: string; habilitado: string; def: string }>>`
      SELECT tgname::text AS nombre, tgenabled::text AS habilitado, pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgrelid = '"FacturaProveedorSucursal"'::regclass AND NOT tgisinternal`;
    expect(t.map((x) => [x.nombre, x.habilitado])).toEqual([["FacturaProveedorSucursal_recepcion_transicion_chk", "O"]]);
    expect(t[0]!.def).toMatch(/BEFORE UPDATE OF "estadoRecepcion", "recibidaEn", "recibidaPorId" ON/);
  });

  it("motor2_app tiene UPDATE por columna SOLO de la recepción en la parte (nunca DELETE ni UPDATE de tabla)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const r = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"FacturaProveedorSucursal"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`;
    expect(r.map((x) => x.columna)).toEqual(["estadoRecepcion", "recibidaEn", "recibidaPorId"]);
    const t = await prismaAdmin.$queryRaw<Array<{ upd: boolean; del: boolean }>>`SELECT has_table_privilege('motor2_app', '"FacturaProveedorSucursal"', 'UPDATE') AS upd, has_table_privilege('motor2_app', '"FacturaProveedorSucursal"', 'DELETE') AS del`;
    expect(t).toEqual([{ upd: false, del: false }]);
  });
});

describe("las reglas de la recepción", () => {
  it("una parte nace PENDIENTE, sin fecha ni persona", async () => {
    const p = await nuevaParte();
    expect([p.estadoRecepcion, p.recibidaEn, p.recibidaPorId]).toEqual(["PENDIENTE", null, null]);
  });

  it("una parte puede nacer RECIBIDA (las partes solo de gastos las crea la aplicación así), con su fecha y su persona", async () => {
    const p = await nuevaParte(recibida());
    expect([p.estadoRecepcion, p.recibidaEn?.toISOString(), p.recibidaPorId]).toEqual(["RECIBIDA", "2026-09-02T15:00:00.000Z", e.usuarioId]);
  });

  it("el estado es PENDIENTE o RECIBIDA (FacturaProveedorSucursal_estado_recepcion_chk)", async () => {
    await expect(nuevaParte({ estadoRecepcion: "EN_CAMINO" })).rejects.toThrow(/FacturaProveedorSucursal_estado_recepcion_chk/);
  });

  it("RECIBIDA si y solo si hay fecha de recepción (FacturaProveedorSucursal_recepcion_coherente_chk)", async () => {
    await expect(nuevaParte({ estadoRecepcion: "RECIBIDA" })).rejects.toThrow(/FacturaProveedorSucursal_recepcion_coherente_chk/);
    await expect(nuevaParte({ recibidaEn: new Date("2026-09-02T15:00:00Z"), recibidaPorId: e.usuarioId })).rejects.toThrow(/FacturaProveedorSucursal_recepcion_coherente_chk/);
  });

  it("la persona que recibió va junto con la fecha (FacturaProveedorSucursal_recibida_por_chk) y tiene que existir (clave foránea)", async () => {
    await expect(nuevaParte({ estadoRecepcion: "RECIBIDA", recibidaEn: new Date("2026-09-02T15:00:00Z") })).rejects.toThrow(/FacturaProveedorSucursal_recibida_por_chk/);
    await expect(nuevaParte(recibida({ recibidaPorId: "no-existe" }))).rejects.toThrow(/FacturaProveedorSucursal_recibidaPorId_fkey/);
  });
});

describe("el disparador: solo PENDIENTE a RECIBIDA, y una vez", () => {
  const raw = (sql: string, params: unknown[] = []) => prismaAdmin.$executeRawUnsafe(sql, ...params);

  it("de PENDIENTE a RECIBIDA anda (también con el dueño de las tablas)", async () => {
    const p = await nuevaParte();
    await raw(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = '2026-09-02T15:00:00Z', "recibidaPorId" = $1 WHERE id = $2`, [e.usuarioId, p.id]);
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: p.id } })).estadoRecepcion).toBe("RECIBIDA");
  });

  it("una recibida NO vuelve a PENDIENTE (aunque se limpien la fecha y la persona para cumplir los CHECK)", async () => {
    const p = await nuevaParte(recibida());
    await expect(raw(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'PENDIENTE', "recibidaEn" = NULL, "recibidaPorId" = NULL WHERE id = $1`, [p.id])).rejects.toThrow(/FacturaProveedorSucursal_recepcion_transicion_chk|ya RECIBIDA/);
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: p.id } })).estadoRecepcion).toBe("RECIBIDA");
  });

  it("una recibida NO cambia de fecha ni de persona", async () => {
    const otro = (await prisma.user.create({ data: { email: "otro@test.com" } })).id;
    const p = await nuevaParte(recibida());
    await expect(raw(`UPDATE "FacturaProveedorSucursal" SET "recibidaEn" = '2026-09-09T15:00:00Z' WHERE id = $1`, [p.id])).rejects.toThrow(/ya RECIBIDA/);
    await expect(raw(`UPDATE "FacturaProveedorSucursal" SET "recibidaPorId" = $1 WHERE id = $2`, [otro, p.id])).rejects.toThrow(/ya RECIBIDA/);
    const hoy = await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: p.id } });
    expect([hoy.recibidaEn?.toISOString(), hoy.recibidaPorId]).toEqual(["2026-09-02T15:00:00.000Z", e.usuarioId]);
  });

  it("repetir la misma recepción (mismos valores) es inofensivo", async () => {
    const p = await nuevaParte(recibida());
    await raw(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = '2026-09-02T15:00:00Z', "recibidaPorId" = $1 WHERE id = $2`, [e.usuarioId, p.id]);
  });

  it("el disparador no mira lo que no es la recepción: otras columnas de la parte (como dueño) se pueden tocar en una recibida", async () => {
    const p = await nuevaParte(recibida());
    await raw(`UPDATE "FacturaProveedorSucursal" SET "porcentajeDeclaradoBp" = 5000 WHERE id = $1`, [p.id]);
  });
});

describe("como motor2_app", () => {
  it("confirma la recepción con UPDATE por columna, y no puede tocar el porcentaje ni la operación (permission denied)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const db = baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;
    const p = await nuevaParte();
    const r = await db.facturaProveedorSucursal.update({ where: { id: p.id }, data: { estadoRecepcion: "RECIBIDA", recibidaEn: new Date("2026-09-02T15:00:00Z"), recibidaPorId: e.usuarioId } });
    expect(r.estadoRecepcion).toBe("RECIBIDA");
    await expect(db.facturaProveedorSucursal.update({ where: { id: p.id }, data: { porcentajeDeclaradoBp: 1 } })).rejects.toThrow(/permission denied/i);
    await expect(db.facturaProveedorSucursal.update({ where: { id: p.id }, data: { estadoRecepcion: "PENDIENTE", recibidaEn: null, recibidaPorId: null } })).rejects.toThrow(/ya RECIBIDA|recepcion_transicion/);
  });

  it("la política de sucursal rige: con escritura solo en la sucursal B no se confirma la recepción de la parte de A (0 filas, no cambia nada)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const p = await nuevaParte();
    const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(EMPRESA_DE_PRUEBA_ID, { lectura: [e.sucursalA, e.sucursalB], escritura: [e.sucursalB] }) });
    abiertos.push(c);
    await c.connect();
    const r = await c.query(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = $2 WHERE id = $1 AND "estadoRecepcion" = 'PENDIENTE'`, [p.id, e.usuarioId]);
    expect(r.rowCount).toBe(0);
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: p.id } })).estadoRecepcion).toBe("PENDIENTE");
  });
});

describe("CONCURRENCIA e IDEMPOTENCIA: la misma parte confirmada a la vez deja UNA recepción y UN solo ingreso de stock", () => {
  /**
   * Lo que hará el caso de uso (Etapa C), en miniatura: en UNA transacción, `UPDATE ... WHERE "estadoRecepcion" = 'PENDIENTE'` y, solo si tocó una fila, escribe la línea de stock (un `MovimientoStock` de COMPRA).
   * Devuelve si esta transacción fue la que recibió.
   */
  async function recibir(c: Client, parteId: string, operacionId: string): Promise<"recibio" | "ya-estaba"> {
    await c.query("BEGIN");
    try {
      const r = await c.query(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = $3, "recibidaPorId" = $2 WHERE id = $1 AND "estadoRecepcion" = 'PENDIENTE'`, [parteId, e.usuarioId, new Date("2026-09-02T15:00:00Z")]);
      if (r.rowCount === 1) {
        await c.query(
          `INSERT INTO "MovimientoStock" ("id","operacionId","productoId","seccionId","proceso","cantidad","detalle","precioTotal","precioPorUnidadStock") VALUES ($1,$2,$3,$4,'COMPRA',10,'recepción','100.00','10')`,
          [randomUUID(), operacionId, e.productoId, e.seccionA],
        );
      }
      await c.query("COMMIT");
      return r.rowCount === 1 ? "recibio" : "ya-estaba";
    } catch (error) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  async function escenario() {
    const f = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
    await prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: f.id, productoId: e.productoId }) as never });
    const op = await prisma.operacion.create({ data: { sucursalId: e.sucursalA, fecha: new Date(), usuarioId: e.usuarioId, proceso: "COMPRA" } });
    const parte = await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: f.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000, operacionId: op.id } });
    return { parte, op };
  }
  const lineas = (operacionId: string) => prismaAdmin.movimientoStock.count({ where: { operacionId } });

  it("dos confirmaciones a la vez de la misma parte: una recibe y entra UNA línea de stock; la otra ve que ya estaba", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parte, op } = await escenario();
    const [a, b] = await Promise.all([conexion(), conexion()]);
    const r = await Promise.all([recibir(a, parte.id, op.id), recibir(b, parte.id, op.id)]);
    expect([...r].sort()).toEqual(["recibio", "ya-estaba"]);
    expect(await lineas(op.id), "una sola línea de stock").toBe(1);
    expect((await prismaAdmin.facturaProveedorSucursal.findUniqueOrThrow({ where: { id: parte.id } })).estadoRecepcion).toBe("RECIBIDA");
  });

  it("ocho confirmaciones a la vez: una sola recibe, una sola línea de stock", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parte, op } = await escenario();
    const clientes = await Promise.all(Array.from({ length: 8 }, () => conexion()));
    const r = await Promise.all(clientes.map((c) => recibir(c, parte.id, op.id)));
    expect(r.filter((x) => x === "recibio")).toHaveLength(1);
    expect(r.filter((x) => x === "ya-estaba")).toHaveLength(7);
    expect(await lineas(op.id)).toBe(1);
  });

  it("la segunda transacción ESPERA a la primera (no lo adivina) y, al confirmar la primera, no toca ninguna fila", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parte } = await escenario();
    const [a, b] = await Promise.all([conexion(), conexion()]);
    await a.query("BEGIN");
    await a.query(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = $2 WHERE id = $1 AND "estadoRecepcion" = 'PENDIENTE'`, [parte.id, e.usuarioId]);
    await b.query("BEGIN");
    const pidB = Number((await b.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);
    const segunda = b.query(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = $2 WHERE id = $1 AND "estadoRecepcion" = 'PENDIENTE'`, [parte.id, e.usuarioId]);
    for (let i = 0; i < 200; i++) {
      const w = await prismaAdmin.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pidB}`;
      if (w[0]?.wait_event_type === "Lock") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await a.query("COMMIT");
    expect((await segunda).rowCount, "la segunda no encontró ninguna parte PENDIENTE").toBe(0);
    await b.query("COMMIT");
  });

  it("repetir la confirmación (mismo pedido, otra vez) no duplica el stock", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { parte, op } = await escenario();
    const a = await conexion();
    expect(await recibir(a, parte.id, op.id)).toBe("recibio");
    for (let i = 0; i < 3; i++) expect(await recibir(a, parte.id, op.id)).toBe("ya-estaba");
    expect(await lineas(op.id)).toBe(1);
  });

  it("dos partes que reclaman la misma Operacion: la unicidad de operacionId deja pasar una", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const { op } = await escenario();
    const f2 = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
    await expect(prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: f2.id, sucursalId: e.sucursalA, porcentajeDeclaradoBp: 10000, operacionId: op.id } })).rejects.toMatchObject({ code: "P2002" });
  });
});
