/**
 * Bloque 5A, P5 (solo lectura): verifica el registro de módulos de la base que apunte DIRECT_URL (el dueño: salta el RLS y ve todas las empresas).
 * Corre solo al final de `scripts/construir.ts` en modo `verificar` y a mano con `npm run verificar:modulos`. Sale con código 1 si una empresa ACTIVE
 * que existía antes de la migración quedó sin registro (ver `diagnosticarRegistroDeModulos`), si una empresa tiene un rol «admin» sin la clave «admin»
 * (G1, `diagnosticarRolesDeSistema`), o si no se puede leer.
 */
import "dotenv/config";
import { Client } from "pg";
import { diagnosticarRegistroDeModulos, type DiagnosticoDelRegistro } from "../src/core/modulos/diagnostico-registro";
import { diagnosticarRolesDeSistema } from "../src/core/permisos/diagnostico-roles-de-sistema";

export const MIGRACION_DEL_REGISTRO = "20261004120000_registro_de_modulos_por_empresa";
const MIGRACION_DE_LA_CLAVE_DE_ROL = "20261006120000_clave_de_rol_de_sistema";

export type Consulta = (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

// `Empresa.creadoEn` es `timestamp` sin zona (Prisma lo guarda en UTC) y `finished_at` es `timestamptz`: se compara en SQL, con la zona dicha, para
// no depender de la zona de la sesión ni de cómo el driver interprete el `timestamp`.
const SQL_EMPRESAS = `
  SELECT e."id", e."slug", e."estado"::text AS "estado", (e."creadoEn" AT TIME ZONE 'UTC' < m.finished_at) AS "creadaAntesDeLaMigracion"
    FROM "Empresa" e CROSS JOIN (
      SELECT finished_at FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    ) m`;

async function exigirMigracionAplicada(consulta: Consulta, migracion: string): Promise<void> {
  const aplicada = await consulta(`SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`, [migracion]);
  if (aplicada.length === 0) throw new Error(`La migración ${migracion} no figura como aplicada en esta base.`);
}

export async function diagnosticarBase(consulta: Consulta): Promise<DiagnosticoDelRegistro> {
  await exigirMigracionAplicada(consulta, MIGRACION_DEL_REGISTRO);
  await exigirMigracionAplicada(consulta, MIGRACION_DE_LA_CLAVE_DE_ROL);
  const empresas = await consulta(SQL_EMPRESAS, [MIGRACION_DEL_REGISTRO]);
  const filas = await consulta(`SELECT "empresaId", "modulo" FROM "ModuloEmpresa"`);
  const roles = await consulta(`SELECT "empresaId", "nombre", "clave" FROM "Rol"`);
  const conUsuarios = new Set(
    (await consulta(`SELECT "empresaId" FROM "UsuarioEmpresa" UNION SELECT "empresaId" FROM "UsuarioSucursal"`)).map((f) => String(f.empresaId))
  );
  const modulos = diagnosticarRegistroDeModulos({
    empresas: empresas.map((e) => ({ id: String(e.id), slug: String(e.slug), estado: String(e.estado), creadaAntesDeLaMigracion: e.creadaAntesDeLaMigracion === true })),
    filas: filas.map((f) => ({ empresaId: String(f.empresaId), modulo: String(f.modulo) })),
  });
  const rolesDeSistema = diagnosticarRolesDeSistema({
    empresas: empresas.map((e) => ({ id: String(e.id), slug: String(e.slug), estado: String(e.estado), tieneUsuarios: conUsuarios.has(String(e.id)) })),
    roles: roles.map((r) => ({ empresaId: String(r.empresaId), nombre: String(r.nombre), clave: r.clave === null ? null : String(r.clave) })),
  });
  return { fallas: [...modulos.fallas, ...rolesDeSistema.fallas], avisos: [...modulos.avisos, ...rolesDeSistema.avisos] };
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error("[modulos] Falta DIRECT_URL: no se puede verificar el registro de módulos.");
    return 1;
  }
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    const { fallas, avisos } = await diagnosticarBase(async (sql, params) => (await cliente.query(sql, params)).rows);
    for (const a of avisos) console.warn(`[modulos] aviso: ${a}`);
    for (const f of fallas) console.error(`[modulos] FALLA: ${f}`);
    if (fallas.length > 0) {
      console.error("[modulos] El registro de módulos está incompleto: no se sigue. Revisar la migración del registro de módulos y su backfill antes de desplegar.");
      return 1;
    }
    console.log(`[modulos] Registro de módulos en orden (${avisos.length} aviso${avisos.length === 1 ? "" : "s"}).`);
    return 0;
  } finally {
    await cliente.end();
  }
}

if (process.argv[1] && /verificar-registro-de-modulos\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.error("[modulos] No se pudo leer el registro de módulos:", e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
