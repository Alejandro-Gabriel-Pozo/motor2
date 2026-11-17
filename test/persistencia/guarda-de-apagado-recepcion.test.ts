import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModulosDeEmpresaError } from "../../src/core/features/empresa/cambio-de-modulos";
import { cambiarModulosDeEmpresa } from "../../src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa";
import type { AutorDeCambioDePlataforma } from "../../src/server/operaciones-de-plataforma/auditar-cambio-de-plataforma";
import { cambiarModulosDesdeLaConsola } from "../../plataforma/src/servidor/modulos";
import { EMPRESA_DE_PRUEBA_ID } from "../setup/empresa-de-prueba";
import { HAY_ROL_DE_PLATAFORMA, plataformaReal } from "../setup/cliente-plataforma-real";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";
import {
  actualizarModulo, conexionDeLaApp, conexionDelDuenio, conexionDelQueApaga, estadoDelModulo, fijarModuloSaltandoLaGuarda, insertarParte, MODULO, nuevaCabecera, partesPendientesVivas, sembrarMundo, sembrarPartes,
  SLUG_DE_LA_EMPRESA_DE_PRUEBA, type Mundo,
} from "../setup/guarda-de-apagado";

/**
 * Compras, guarda de apagado de la recepción separada (migración 20261117170000; docs/diseno-compras-guarda-de-apagado-2026-11-17.md): la BASE no deja apagar `recepcion_de_compras` mientras la empresa tenga compras pendientes de recibir (de
 * cualquier sucursal, sin anular), ni deja nacer una parte pendiente con el módulo apagado. Acá, contra Postgres real: la estructura que deja la migración; el mensaje y la cuenta; las tres vías (UPDATE directo, el script y la consola con el
 * rol real `motor2_plataforma` si la base de test lo tiene); idempotencia; aislamiento entre empresas; CONCURRENCIA REAL con dos conexiones a la vez (apagar vs cargar una pendiente); y la reversa (`down.sql`). Todas las combinaciones de
 * estado × vía × ubicación × pedido las recorre `combinaciones-compras-guarda-de-apagado.test.ts` contra el oráculo.
 *
 * Mutación: sacar el disparador de `ModuloEmpresa` deja en rojo los rechazos; sacar el `FOR SHARE` del de `FacturaProveedorSucursal` deja en rojo la concurrencia «cargar primero»/«apagar primero»; contar solo la sucursal activa (sin SECURITY DEFINER)
 * deja en rojo «otra sucursal».
 */
afterAll(async () => {
  await prismaAdmin.$executeRawUnsafe('TRUNCATE TABLE "AuditoriaPlataforma"');
  await limpiarBaseDeTest();
  await plataformaReal.$disconnect();
  await prismaAdmin.$disconnect();
});

const RAIZ = join(__dirname, "../..");
const MIGRACION = "20261117170000_guarda_de_apagado_recepcion_separada";
const AUTOR: AutorDeCambioDePlataforma = { adminId: "admin-guarda", adminEmail: "operador@plataforma.com", instalacionId: "principal", instalacionNombre: "principal" };
const AUTOR_CONSOLA = { adminId: "admin-guarda", adminEmail: "operador@plataforma.com", instalacionId: "principal" };
/** El cliente de la vía: el rol real de la consola si la base de test lo tiene, si no el dueño (el disparador rige para los dos). */
const dbDeLaVia = () => (HAY_ROL_DE_PLATAFORMA ? plataformaReal : prismaAdmin);
const auditorias = () => prismaAdmin.auditoriaPlataforma.findMany({ orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });

let m: Mundo;
const abiertos: Client[] = [];
const abrir = async (c: Promise<Client>): Promise<Client> => {
  const x = await c;
  abiertos.push(x);
  return x;
};

beforeEach(async () => {
  await limpiarBaseDeTest();
  m = await sembrarMundo();
});
afterEach(async () => {
  await Promise.all(abiertos.splice(0).map((c) => c.query("ROLLBACK").catch(() => undefined).then(() => c.end().catch(() => undefined))));
});

describe("la migración deja las funciones y los disparadores, sin dar permisos de más", () => {
  it("dos disparadores activos (UPDATE de ModuloEmpresa, INSERT de la parte pendiente) y tres funciones del dueño con búsqueda fija", async () => {
    const t = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; habilitado: string; def: string }>>`
      SELECT tgrelid::regclass::text AS tabla, tgname::text AS nombre, tgenabled::text AS habilitado, pg_get_triggerdef(oid) AS def FROM pg_trigger
       WHERE tgname IN ('ModuloEmpresa_recepcion_pendientes_chk', 'FacturaProveedorSucursal_modulo_recepcion_chk') AND NOT tgisinternal ORDER BY 2`;
    expect(t.map((x) => [x.tabla, x.nombre, x.habilitado])).toEqual([['"FacturaProveedorSucursal"', "FacturaProveedorSucursal_modulo_recepcion_chk", "O"], ['"ModuloEmpresa"', "ModuloEmpresa_recepcion_pendientes_chk", "O"]]);
    expect(t[0]!.def).toMatch(/BEFORE INSERT ON .*FOR EACH ROW WHEN \(\(?new\."estadoRecepcion" = 'PENDIENTE'::text\)?\)/i);
    expect(t[1]!.def).toMatch(/BEFORE UPDATE ON .*FOR EACH ROW/);
    const f = await prismaAdmin.$queryRaw<Array<{ nombre: string; definer: boolean; config: string[] | null }>>`
      SELECT proname::text AS nombre, prosecdef AS definer, proconfig AS config FROM pg_proc
       WHERE proname IN ('compras_pendientes_de_recepcion', 'modulo_empresa_guarda_de_apagado_recepcion', 'factura_proveedor_sucursal_guarda_de_modulo_recepcion') ORDER BY 1`;
    expect(f).toHaveLength(3);
    for (const x of f) {
      expect(x.definer, x.nombre).toBe(true);
      expect(x.config?.join(" "), `${x.nombre}: search_path fijo`).toMatch(/search_path=pg_catalog, public, pg_temp/);
    }
  });

  it("ningún rol de la app puede llamar a la cuenta de pendientes (EXECUTE revocado) y NO se agregó ningún permiso sobre FacturaProveedorSucursal a la plataforma", async () => {
    const r = await prismaAdmin.$queryRaw<Array<{ app: boolean; plataforma: boolean | null; tabla_plataforma: boolean | null }>>`
      SELECT has_function_privilege('motor2_app', 'compras_pendientes_de_recepcion(text)', 'EXECUTE') AS app,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN has_function_privilege('motor2_plataforma', 'compras_pendientes_de_recepcion(text)', 'EXECUTE') END AS plataforma,
             CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN has_table_privilege('motor2_plataforma', '"FacturaProveedorSucursal"', 'SELECT,INSERT,UPDATE,DELETE') END AS tabla_plataforma`;
    expect(r[0]).toMatchObject({ app: false });
    expect(r[0]!.plataforma ?? false).toBe(false);
    expect(r[0]!.tabla_plataforma ?? false).toBe(false);
  });
});

describe("la cuenta de pendientes y el mensaje del rechazo", () => {
  it("cuenta las partes pendientes SIN ANULAR de TODAS las sucursales de la empresa (la RLS por sucursal no la limita) y nombra las sucursales sin repetir", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA", 2);
    await sembrarPartes(m, "SOLO_ANULADAS", "OTRA_SUCURSAL_DE_LA_EMPRESA", 1);
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_EMPRESA", 3);
    const [r] = await prismaAdmin.$queryRaw<Array<{ cantidad: number; sucursales: string }>>`SELECT cantidad, sucursales FROM compras_pendientes_de_recepcion(${EMPRESA_DE_PRUEBA_ID}::text)`;
    expect(r).toEqual({ cantidad: 2, sucursales: "Norte" });
    const [t] = await prismaAdmin.$queryRaw<Array<{ cantidad: number; sucursales: string }>>`SELECT cantidad, sucursales FROM compras_pendientes_de_recepcion('empresa_testigo'::text)`;
    expect(t).toEqual({ cantidad: 3, sucursales: "Testigo" });
  });

  it("el UPDATE directo rechazado es un 23514 con la restricción nombrada y un mensaje con la cantidad y las sucursales", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA", 2);
    const c = await abrir(conexionDelQueApaga());
    const r = await actualizarModulo(c, EMPRESA_DE_PRUEBA_ID, "INACTIVO");
    expect(r).toMatchObject({ ok: false, codigo: "23514", restriccion: "ModuloEmpresa_recepcion_pendientes_chk" });
    expect((r as { mensaje: string }).mensaje).toBe("GUARDA_APAGADO_RECEPCION|2|Norte");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
  });

  it("cambiarle a la fila el módulo o la empresa (lo mismo que apagarla) con pendientes también se rechaza; apagar OTRO módulo no se mira", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA");
    const c = await abrir(conexionDelDuenio());
    for (const sql of [
      `UPDATE "ModuloEmpresa" SET "modulo" = 'otro_modulo' WHERE "empresaId" = '${EMPRESA_DE_PRUEBA_ID}' AND "modulo" = '${MODULO}'`,
      `UPDATE "ModuloEmpresa" SET "empresaId" = 'empresa_testigo' WHERE "empresaId" = '${EMPRESA_DE_PRUEBA_ID}' AND "modulo" = '${MODULO}'`,
    ]) {
      await expect(c.query(sql), sql).rejects.toMatchObject({ code: "23514", constraint: "ModuloEmpresa_recepcion_pendientes_chk" });
    }
    await prismaAdmin.moduloEmpresa.upsert({ where: { empresaId_modulo: { empresaId: EMPRESA_DE_PRUEBA_ID, modulo: "stock" } }, create: { empresaId: EMPRESA_DE_PRUEBA_ID, modulo: "stock", estado: "ACTIVO" }, update: { estado: "ACTIVO" } });
    await c.query(`UPDATE "ModuloEmpresa" SET "estado" = 'INACTIVO' WHERE "empresaId" = '${EMPRESA_DE_PRUEBA_ID}' AND "modulo" = 'stock'`);
    expect((await prismaAdmin.moduloEmpresa.findUnique({ where: { empresaId_modulo: { empresaId: EMPRESA_DE_PRUEBA_ID, modulo: "stock" } } }))?.estado).toBe("INACTIVO");
  });

  it("falla cerrado: fuera de READ COMMITTED no se puede apagar (la cuenta podría no ver una compra recién confirmada), con cualquier cantidad de pendientes", async () => {
    const c = await abrir(conexionDelQueApaga());
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await expect(c.query('UPDATE "ModuloEmpresa" SET "estado" = \'INACTIVO\' WHERE "empresaId" = $1 AND "modulo" = $2', [EMPRESA_DE_PRUEBA_ID, MODULO])).rejects.toMatchObject({ code: "23514", message: expect.stringContaining("GUARDA_APAGADO_RECEPCION|0|") });
    await c.query("ROLLBACK");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
  });

  it("encender sigue andando: con pendientes y el módulo apagado (el estado de antes de la guarda) la plataforma lo enciende", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA");
    await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "INACTIVO");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("INACTIVO");
    const c = await abrir(conexionDelQueApaga());
    expect(await actualizarModulo(c, EMPRESA_DE_PRUEBA_ID, "ACTIVO")).toEqual({ ok: true });
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
  });
});

describe("el texto y la auditoría en las dos vías que apagan", () => {
  const TEXTO = "No se puede apagar la recepción separada de compras: hay 2 compra(s) pendientes de recibir (sucursales: Norte). Recibilas o anulalas antes.";

  it("la consola devuelve un resultado de error con el texto (no una excepción), no cambia nada y deja una fila de rastro con el módulo y la cantidad", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA", 2);
    const r = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] });
    expect(r).toEqual({ ok: false, mensaje: TEXTO });
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
    const filas = await auditorias();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ accion: "modulo-desactivar-rechazado", empresaAfectadaId: EMPRESA_DE_PRUEBA_ID, adminId: AUTOR_CONSOLA.adminId, detalle: { modulo: MODULO, pendientes: 2, instalacion: "principal" } });
  });

  it("el script lanza un error con el MISMO texto (el script lo imprime y sale con error), no cambia nada y deja el mismo rastro (origen script)", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA", 2);
    const error = await cambiarModulosDeEmpresa(dbDeLaVia(), { slug: SLUG_DE_LA_EMPRESA_DE_PRUEBA, desactivar: [MODULO] }, AUTOR).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ModulosDeEmpresaError);
    expect((error as Error).message).toBe(TEXTO);
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
    const filas = await auditorias();
    expect(filas.map((f) => f.accion)).toEqual(["modulo-desactivar-rechazado"]);
    expect(filas[0]).toMatchObject({ empresaAfectadaId: EMPRESA_DE_PRUEBA_ID, detalle: { modulo: MODULO, pendientes: 2, origen: "script" } });
  });

  it("IDEMPOTENCIA del rechazo: repetir el pedido da el mismo texto, no cambia nada y cada intento deja UNA fila de rastro (ni una de más ni una de menos)", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA", 2);
    const a = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] });
    const b = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] });
    expect(b).toEqual(a);
    expect((await auditorias()).map((f) => f.accion)).toEqual(["modulo-desactivar-rechazado", "modulo-desactivar-rechazado"]);
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
  });

  it("IDEMPOTENCIA del apagado: sin pendientes se apaga y la segunda vez es un éxito sin cambios y SIN auditoría duplicada (consola y script)", async () => {
    const uno = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] });
    expect(uno).toMatchObject({ ok: true });
    const dos = await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] });
    expect(dos).toMatchObject({ ok: true, mensaje: "Sin cambios: ya estaba así.", cambiados: [] });
    const tres = await cambiarModulosDeEmpresa(dbDeLaVia(), { slug: SLUG_DE_LA_EMPRESA_DE_PRUEBA, desactivar: [MODULO] }, AUTOR);
    expect(tres.cambiados).toEqual([]);
    expect((await auditorias()).map((f) => f.accion)).toEqual(["modulo-desactivado"]);
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("INACTIVO");
  });

  it("recibir la última pendiente antes del apagado deja apagar; anularla también", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA");
    expect(await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] })).toMatchObject({ ok: false });
    await prismaAdmin.$executeRawUnsafe(`UPDATE "FacturaProveedorSucursal" SET "estadoRecepcion" = 'RECIBIDA', "recibidaEn" = now(), "recibidaPorId" = '${m.e.usuarioId}'`);
    expect(await cambiarModulosDesdeLaConsola(dbDeLaVia(), AUTOR_CONSOLA, EMPRESA_DE_PRUEBA_ID, { desactivar: [MODULO] })).toMatchObject({ ok: true });
  });
});

describe("aislamiento entre empresas", () => {
  it("las pendientes de OTRA empresa no bloquean el apagado de esta; y las de esta no bloquean el de la otra", async () => {
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_EMPRESA", 2);
    const c = await abrir(conexionDelQueApaga());
    expect(await actualizarModulo(c, EMPRESA_DE_PRUEBA_ID, "INACTIVO")).toEqual({ ok: true });
    expect(await actualizarModulo(c, "empresa_testigo", "INACTIVO")).toMatchObject({ ok: false, codigo: "23514" });
    expect(await estadoDelModulo("empresa_testigo")).toBe("ACTIVO");
  });
});

describe("la otra mitad: no nace una parte pendiente con el módulo apagado", () => {
  it("con el módulo apagado (o sin fila) el INSERT de una parte pendiente es un 23514 con la restricción nombrada; una parte recibida no mira el módulo", async () => {
    const app = await abrir(conexionDeLaApp(m.e));
    const factura = await nuevaCabecera(m, "0002-00000001");
    await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "INACTIVO");
    await expect(insertarParte(app, m, factura)).rejects.toMatchObject({ code: "23514", constraint: "FacturaProveedorSucursal_modulo_recepcion_chk" });
    await prismaAdmin.moduloEmpresa.deleteMany({ where: { empresaId: EMPRESA_DE_PRUEBA_ID, modulo: MODULO } });
    await expect(insertarParte(app, m, factura)).rejects.toMatchObject({ code: "23514", constraint: "FacturaProveedorSucursal_modulo_recepcion_chk" });
    await insertarParte(app, m, factura, "RECIBIDA");
    expect(await prismaAdmin.facturaProveedorSucursal.count({ where: { facturaProveedorId: factura } })).toBe(1);
  });
});

describe("CONCURRENCIA REAL: apagar vs cargar una compra pendiente, dos conexiones abiertas a la vez", () => {
  /** Espera lo justo para que la consulta bloqueada llegue a la base y se quede esperando. */
  const aflojar = () => new Promise((r) => setTimeout(r, 250));
  const resolver = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e as { code?: string; constraint?: string; message?: string } }));

  it("el apagado va PRIMERO (sin confirmar): la carga de la pendiente espera, y al confirmarse el apagado la carga se rechaza; el módulo queda apagado y sin pendientes", async () => {
    const apaga = await abrir(conexionDelQueApaga());
    const app = await abrir(conexionDeLaApp(m.e));
    const factura = await nuevaCabecera(m, "0003-00000001");
    await apaga.query("BEGIN");
    expect(await actualizarModulo(apaga, EMPRESA_DE_PRUEBA_ID, "INACTIVO")).toEqual({ ok: true });
    await app.query("BEGIN");
    let terminada = false;
    const carga = resolver(insertarParte(app, m, factura)).then((r) => ((terminada = true), r));
    await aflojar();
    expect(terminada, "la carga espera al apagado: no se resolvió todavía").toBe(false);
    await apaga.query("COMMIT");
    const r = await carga;
    expect(r).toMatchObject({ ok: false, e: { code: "23514", constraint: "FacturaProveedorSucursal_modulo_recepcion_chk" } });
    await app.query("ROLLBACK");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("INACTIVO");
    expect(await partesPendientesVivas(EMPRESA_DE_PRUEBA_ID)).toBe(0);
  });

  it("la carga va PRIMERO (sin confirmar): el apagado espera, y al confirmarse la carga el apagado ve la pendiente y se rechaza; el módulo queda encendido con su pendiente", async () => {
    const apaga = await abrir(conexionDelQueApaga());
    const app = await abrir(conexionDeLaApp(m.e));
    const factura = await nuevaCabecera(m, "0003-00000002");
    await app.query("BEGIN");
    await insertarParte(app, m, factura);
    await apaga.query("BEGIN");
    let terminado = false;
    const apagado = actualizarModulo(apaga, EMPRESA_DE_PRUEBA_ID, "INACTIVO").then((r) => ((terminado = true), r));
    await aflojar();
    expect(terminado, "el apagado espera a la carga: no se resolvió todavía").toBe(false);
    await app.query("COMMIT");
    const r = await apagado;
    expect(r).toMatchObject({ ok: false, codigo: "23514", restriccion: "ModuloEmpresa_recepcion_pendientes_chk", mensaje: "GUARDA_APAGADO_RECEPCION|1|Norte" });
    await apaga.query("ROLLBACK");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("ACTIVO");
    expect(await partesPendientesVivas(EMPRESA_DE_PRUEBA_ID)).toBe(1);
  });

  it("la carga va primero pero se DESHACE: el apagado espera y después procede (no queda nada reservado)", async () => {
    const apaga = await abrir(conexionDelQueApaga());
    const app = await abrir(conexionDeLaApp(m.e));
    const factura = await nuevaCabecera(m, "0003-00000003");
    await app.query("BEGIN");
    await insertarParte(app, m, factura);
    await apaga.query("BEGIN");
    const apagado = actualizarModulo(apaga, EMPRESA_DE_PRUEBA_ID, "INACTIVO");
    await aflojar();
    await app.query("ROLLBACK");
    expect(await apagado).toEqual({ ok: true });
    await apaga.query("COMMIT");
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("INACTIVO");
    expect(await partesPendientesVivas(EMPRESA_DE_PRUEBA_ID)).toBe(0);
  });

  it("dos apagados a la vez: uno aplica y el otro lo ve ya apagado (sin error); dos cargas pendientes a la vez con el módulo encendido entran las dos", async () => {
    const a = await abrir(conexionDelQueApaga());
    const b = await abrir(conexionDelQueApaga());
    const [ra, rb] = await Promise.all([actualizarModulo(a, EMPRESA_DE_PRUEBA_ID, "INACTIVO"), actualizarModulo(b, EMPRESA_DE_PRUEBA_ID, "INACTIVO")]);
    expect([ra, rb]).toEqual([{ ok: true }, { ok: true }]);
    expect(await estadoDelModulo(EMPRESA_DE_PRUEBA_ID)).toBe("INACTIVO");
    await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "ACTIVO");
    const [f1, f2] = [await nuevaCabecera(m, "0004-00000001"), await nuevaCabecera(m, "0004-00000002")];
    const [c1, c2] = [await abrir(conexionDeLaApp(m.e)), await abrir(conexionDeLaApp(m.e))];
    const r = await Promise.all([resolver(insertarParte(c1, m, f1)), resolver(insertarParte(c2, m, f2))]);
    expect(r.map((x) => x.ok)).toEqual([true, true]);
    expect(await partesPendientesVivas(EMPRESA_DE_PRUEBA_ID)).toBe(2);
  });

  it("CARRERA REPETIDA sin orden forzado (30 rondas): nunca queda el módulo apagado con una parte pendiente viva, y exactamente uno de los dos gana", async () => {
    const RONDAS = 30;
    let gananCargas = 0;
    let ganaApagado = 0;
    for (let i = 0; i < RONDAS; i++) {
      await prismaAdmin.$executeRawUnsafe('DELETE FROM "FacturaProveedorSucursal"');
      await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "ACTIVO");
      const factura = await nuevaCabecera(m, `0005-${String(i + 1).padStart(8, "0")}`);
      const apaga = await conexionDelQueApaga();
      const app = await conexionDeLaApp(m.e);
      try {
        const [apagado, carga] = await Promise.all([actualizarModulo(apaga, EMPRESA_DE_PRUEBA_ID, "INACTIVO"), resolver(insertarParte(app, m, factura))]);
        const estado = await estadoDelModulo(EMPRESA_DE_PRUEBA_ID);
        const pendientes = await partesPendientesVivas(EMPRESA_DE_PRUEBA_ID);
        expect(estado === "INACTIVO" && pendientes > 0, `ronda ${i}: módulo apagado con una pendiente viva`).toBe(false);
        // Exactamente uno gana: o se apagó (y la carga se rechazó) o se cargó (y el apagado se rechazó).
        expect(apagado.ok !== carga.ok, `ronda ${i}: apagado=${JSON.stringify(apagado)} carga=${JSON.stringify(carga)}`).toBe(true);
        if (apagado.ok) ganaApagado++;
        else gananCargas++;
      } finally {
        await apaga.end();
        await app.end();
      }
    }
    expect(gananCargas + ganaApagado).toBe(RONDAS);
  });
});

describe("la reversa (down.sql) deja la base como antes, y se puede volver a aplicar", () => {
  it("sin los disparadores se puede apagar con pendientes y cargar una pendiente sin el módulo; bajarla dos veces no falla; volver a aplicar la migración restituye la guarda", async () => {
    const down = readFileSync(join(RAIZ, "prisma/migrations", MIGRACION, "down.sql"), "utf8");
    const up = readFileSync(join(RAIZ, "prisma/migrations", MIGRACION, "migration.sql"), "utf8");
    await sembrarPartes(m, "UNA_SIN_ANULAR", "OTRA_SUCURSAL_DE_LA_EMPRESA");
    const duenio = await abrir(conexionDelDuenio());
    try {
      await duenio.query(down);
      await duenio.query(down);
      const sobras = await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`
        SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('compras_pendientes_de_recepcion', 'modulo_empresa_guarda_de_apagado_recepcion', 'factura_proveedor_sucursal_guarda_de_modulo_recepcion'))
             + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('ModuloEmpresa_recepcion_pendientes_chk', 'FacturaProveedorSucursal_modulo_recepcion_chk')) AS n`;
      expect(sobras[0]!.n).toBe(BigInt(0));
      const c = await abrir(conexionDelQueApaga());
      expect(await actualizarModulo(c, EMPRESA_DE_PRUEBA_ID, "INACTIVO")).toEqual({ ok: true });
    } finally {
      await duenio.query(down);
      await duenio.query(up);
    }
    await fijarModuloSaltandoLaGuarda(EMPRESA_DE_PRUEBA_ID, "ACTIVO");
    const c2 = await abrir(conexionDelQueApaga());
    expect(await actualizarModulo(c2, EMPRESA_DE_PRUEBA_ID, "INACTIVO")).toMatchObject({ ok: false, codigo: "23514" });
  });
});
