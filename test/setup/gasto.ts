import { Client } from "pg";
import { EMPRESA_DE_PRUEBA_ID, opcionesDeConexionConEmpresa } from "./empresa-de-prueba";
import { prismaAdmin } from "./test-db";

/**
 * Ayudas de los tests de los GASTOS (Paquete 3, M4): conexiones reales `pg` como `motor2_app` (el rol de la app, sujeto a la RLS) con la empresa fijada y, si se pide, el alcance por sucursal; el chequeo de que una sesión
 * quedó esperando un bloqueo (la prueba de que el segundo INSERT espera al primero en vez de adivinar); y el código de error de Postgres con que se rechazó una sentencia. Las usan las pruebas de concurrencia, de privilegios y de
 * aislamiento de `migracion-concepto-de-gasto`, `migracion-renglon-sin-stock`, `migracion-imputacion-de-gasto` y `imputacion-de-gasto-rls`.
 */
export const TIPOS_DE_COSTO = ["COSTO_DE_VENTAS", "GASTO_OPERATIVO", "EXTRAORDINARIO", "INVERSION", "RESULTADO_FINANCIERO"] as const;

/** Las conexiones abiertas por un archivo de test: `cerrarConexiones()` en el `afterEach`. */
const abiertas: Client[] = [];

/** Una conexión como `motor2_app` con la empresa fijada en el arranque (igual que `src/lib/db`). Con `alcance`, además las sucursales de lectura y de escritura (lo que fija `conAlcanceEnSucursal` en cada transacción). */
export async function conexionComoApp(empresaId: string = EMPRESA_DE_PRUEBA_ID, alcance?: { lectura: readonly string[]; escritura: readonly string[] }): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_URL as string, options: opcionesDeConexionConEmpresa(empresaId, alcance) });
  await c.connect();
  abiertas.push(c);
  return c;
}

export async function cerrarConexiones() {
  await Promise.all(abiertas.splice(0).map((c) => c.end().catch(() => undefined)));
}

export const pidDe = async (c: Client) => Number((await c.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);

/** Espera (hasta 10 s) a que la sesión `pid` esté bloqueada esperando a otra transacción: la prueba de que su INSERT quedó detrás del primero. */
export async function esperarBloqueo(pid: number) {
  for (let i = 0; i < 200; i++) {
    const r = await prismaAdmin.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
    if (r[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`la sesión ${pid} nunca quedó esperando el bloqueo del índice único`);
}

export interface ErrorDePostgres {
  codigo: string;
  restriccion: string;
}

/** Corre una sentencia dentro de su propia transacción y devuelve `null` si anduvo, o el código SQLSTATE y la restricción con que Postgres la rechazó. */
export async function intentar(c: Client, texto: string, params: unknown[] = []): Promise<ErrorDePostgres | null> {
  try {
    await c.query("BEGIN");
    await c.query(texto, params);
    await c.query("COMMIT");
    return null;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    const pg = error as { code?: string; constraint?: string };
    return { codigo: pg.code ?? "otro", restriccion: pg.constraint ?? "" };
  }
}

/** Una conexión como el DUEÑO de las tablas (`DIRECT_URL`, sin RLS): para probar lo que ni siquiera el dueño puede violar (claves foráneas, CHECK) y para sembrar con una empresa explícita. */
export async function conexionDelDuenio(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DIRECT_URL as string });
  await c.connect();
  abiertas.push(c);
  return c;
}

/** Un concepto de gasto válido (para `prisma.conceptoDeGasto.create`). */
export function datosDeConcepto(extra: Record<string, unknown> = {}) {
  return { codigo: "ALQUILER", nombre: "Alquiler", tipoDeCostoPorDefecto: "GASTO_OPERATIVO", ...extra };
}

/** Un renglón SIN_STOCK válido: concepto y tipo de costo, sin ningún campo de mercadería, 100,00 con IVA incluido. */
export function datosDeRenglonSinStock(e: { facturaProveedorId: string; conceptoGastoId: string }, extra: Record<string, unknown> = {}) {
  return {
    facturaProveedorId: e.facturaProveedorId,
    orden: 1,
    naturaleza: "SIN_STOCK",
    conceptoGastoId: e.conceptoGastoId,
    tipoDeCosto: "GASTO_OPERATIVO",
    descripcion: "Alquiler de octubre",
    precioTotal: "100.00",
    ...extra,
  };
}
