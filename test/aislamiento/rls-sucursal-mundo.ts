import { isDeepStrictEqual } from "node:util";
import { Client } from "pg";
import { TABLAS_CON_POLITICA_DE_SUCURSAL } from "../setup/clasificacion-de-tablas";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { sqlDeAlcanceDeSucursal, sqlDeReversaDeAlcanceDeSucursal } from "../setup/politicas-de-alcance-de-sucursal";

/**
 * M.3, Fase A, paso A10: el MUNDO y los ESCENARIOS de la prueba de la RLS por sucursal contra Postgres REAL. Lo usan `rls-sucursal.test.ts` (el comportamiento que el plan promete, con el SQL que genera el
 * paso A9) y `rls-sucursal-mutaciones.test.ts` (el mismo catálogo contra un SQL a propósito roto y contra la base sin políticas: tiene que ponerse en rojo donde corresponde).
 *
 * Cada escenario es una función que DEVUELVE los problemas que encuentra (lista vacía = el comportamiento esperado): así el mismo catálogo sirve para afirmar que no hay problemas (con el SQL bueno) y para
 * afirmar que los hay (con un mutante). Todo corre como el rol REAL de la app (`motor2_app`, NOBYPASSRLS, sujeto a la RLS) en una base TEMPORAL con todas las migraciones (`crearBaseTemporalMigrada`); el SQL de las
 * políticas se aplica en ESA base y nunca llega a `prisma/migrations`.
 *
 * El alcance se fija con la misma forma que `baseDeEmpresa` (A2, `src/core/auth/base.ts`): UN solo `SELECT set_config('app.empresa_id', …, true), set_config('app.sucursales_lectura', …, true),
 * set_config('app.sucursales_escritura', …, true)` dentro de la transacción (el `true` lo hace local a ella). Una variable que NO se fija (`undefined`) es la del código anterior a A2: solo `app.empresa_id`.
 */

export const EMPRESA_A = "empA";
export const EMPRESA_B = "empB";
export const SUC = { a1: "sucA1", a2: "sucA2", a3: "sucA3", b1: "sucB1" } as const;

/** Las tablas del mundo que el catálogo de escenarios mira (una por cada forma de alcance y por cada nivel de la cadena de padres). */
const TABLAS_DEL_MUNDO = [
  "Seccion", "Mesa", "Cuenta", "CuentaItem", "Operacion", "MovimientoStock", "DisponibilidadProducto", "RegistroAuditoria",
  "RecetaVersion", "RecetaIngrediente", "RecetaPaso", "RecetaPasoIngrediente", "SustitutoRecetaIngrediente", "TraspasoSucursal",
] as const;
type TablaDelMundo = (typeof TABLAS_DEL_MUNDO)[number];

export interface Alcance {
  /** La empresa de la transacción; por defecto A. */
  empresa?: string;
  /** `undefined` = la variable NO se fija (el código anterior a A2); `[]` = se fija vacía (lo que hace `dbDeEmpresa` sin alcance). */
  lectura?: readonly string[];
  escritura?: readonly string[];
}

export interface MundoDeSucursales {
  base: BaseTemporalMigrada;
  /** `false` = el Postgres no tiene el rol `motor2_app` (un CI sin el paso de roles): el archivo omite sus casos con motivo. */
  hayRol: boolean;
  /** Corre `fn` en UNA transacción como `motor2_app` con el alcance fijado, y siempre hace ROLLBACK (nada de lo que escribe queda). */
  sesion<T>(alcance: Alcance, fn: (c: Client) => Promise<T>): Promise<T>;
  /** La URL de la base temporal para conectarse como `motor2_app` (para armar un cliente de Prisma con el código real). */
  urlComoApp(): string;
  /** Aplica `sql` como dueño (alta de políticas, mutantes). */
  aplicar(sql: string): Promise<void>;
  /** Quita las políticas y las funciones del alcance (la reversa del generador); deja la base como antes de la Fase B. */
  quitarPoliticas(): Promise<void>;
  /** Borra los datos que un escenario haya dejado confirmados (COMMIT) y cierra todo. */
  cerrar(): Promise<void>;
}

const unicas =(lista: readonly string[]) => [...new Set(lista)].sort();

/** Los ids de una tabla, ordenados. `donde` es SQL libre (sin parámetros). */
async function ids(c: Client, tabla: string, donde = "TRUE"): Promise<string[]> {
  return (await c.query<{ id: string }>(`SELECT "id" FROM "${tabla}" WHERE ${donde} ORDER BY "id"`)).rows.map((r) => r.id);
}

/** El SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT para no abortar la transacción), o `null` si anduvo. */
async function falla(c: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string }).code ?? "sin código";
  }
}

/** Las filas que una escritura tocó (0 = la RLS no la dejó ver; es lo que Prisma convierte en P2025 para un `update`/`delete` por id). */
async function tocadas(c: Client, sql: string, params: unknown[] = []): Promise<number> {
  return (await c.query(sql, params)).rowCount ?? 0;
}

/** Compara y, si no coincide, suma el problema a la lista (`real` y `esperado` se comparan en profundidad). */
function esperar(problemas: string[], que: string, real: unknown, esperado: unknown): void {
  if (!isDeepStrictEqual(real, esperado)) problemas.push(`${que}: esperaba ${JSON.stringify(esperado)} y fue ${JSON.stringify(real)}`);
}

async function existeElRol(cliente: Client): Promise<boolean> {
  return (await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
}

/** INSERT parametrizado como dueño (los datos del mundo llevan `empresaId` explícito: el dueño no tiene contexto de empresa). */
async function insertar(c: Client, tabla: string, fila: Record<string, unknown>): Promise<void> {
  const columnas = Object.keys(fila);
  await c.query(`INSERT INTO "${tabla}" (${columnas.map((k) => `"${k}"`).join(",")}) VALUES (${columnas.map((_, i) => `$${i + 1}`).join(",")})`, columnas.map((k) => fila[k]));
}

/**
 * Siembra: DOS empresas; la A con TRES sucursales (a1, a2, a3) y la B con una (b1) que se llama igual que a1 («Centro») y tiene las mismas secciones y mesas por nombre y número. En cada sucursal de la empresa A
 * (a1, a2) hay: sección, mesa, cuenta e ítem (cadena de tres niveles), operación con su movimiento, disponibilidad de un producto, auditoría y una receta PROPIA con ingrediente, paso, paso-ingrediente y sustituto
 * (cadena de hasta cuatro niveles). Además: una receta CENTRAL (`sucursalId` NULL) con ingrediente, una auditoría de empresa (NULL), un traspaso a1 → a2 y un movimiento «incoherente» (sección de a1, operación de a2).
 */
async function sembrar(c: Client): Promise<void> {
  const emp = async (id: string) => insertar(c, "Empresa", { id, nombre: id, slug: id, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE" });
  await emp(EMPRESA_A);
  await emp(EMPRESA_B);
  await insertar(c, "User", { id: "u1", email: "u1@ejemplo.test" });
  const sucursales: [string, string, string][] = [[SUC.a1, EMPRESA_A, "Centro"], [SUC.a2, EMPRESA_A, "Norte"], [SUC.a3, EMPRESA_A, "Sur"], [SUC.b1, EMPRESA_B, "Centro"]];
  for (const [id, empresaId, nombre] of sucursales) await insertar(c, "Sucursal", { id, empresaId, nombre });
  const porEmpresa: [string, string][] = [[EMPRESA_A, "A"], [EMPRESA_B, "B"]];
  for (const [e, k] of porEmpresa) {
    await insertar(c, "Unidad", { id: `uni${k}`, empresaId: e, nombre: "Unidad", magnitud: "CANTIDAD" });
    await insertar(c, "Producto", { id: `pro${k}`, empresaId: e, codigo: "P1", nombre: "Producto", tipo: "PV", unidadStockId: `uni${k}` });
    await insertar(c, "Producto", { id: `ing${k}`, empresaId: e, codigo: "M1", nombre: "Materia prima", tipo: "MP", unidadStockId: `uni${k}` });
    await insertar(c, "Insumo", { id: `ins${k}`, empresaId: e, nombre: "Insumo" });
    await insertar(c, "Insumo", { id: `ins${k}2`, empresaId: e, nombre: "Insumo 2" });
  }
  // Una cadena completa por sucursal. El sufijo es el de la sucursal (A1, A2, B1).
  const porSucursal: [string, string, string, string][] = [[SUC.a1, EMPRESA_A, "A1", "A"], [SUC.a2, EMPRESA_A, "A2", "A"], [SUC.b1, EMPRESA_B, "B1", "B"]];
  for (const [suc, e, k, ke] of porSucursal) {
    await insertar(c, "Seccion", { id: `sec${k}`, empresaId: e, sucursalId: suc, nombre: "Barra" });
    await insertar(c, "Mesa", { id: `mesa${k}`, empresaId: e, sucursalId: suc, numero: 1 });
    await insertar(c, "Cuenta", { id: `cuenta${k}`, empresaId: e, mesaId: `mesa${k}`, abiertaPorId: "u1" });
    await insertar(c, "CuentaItem", { id: `item${k}`, empresaId: e, cuentaId: `cuenta${k}`, productoId: `pro${ke}`, cantidad: 1, precioUnitario: 10 });
    await insertar(c, "Operacion", { id: `op${k}`, empresaId: e, sucursalId: suc, proceso: "COMPRA", fecha: new Date("2026-01-01T12:00:00Z"), usuarioId: "u1", claveIdempotencia: `clave-${k}` });
    await insertar(c, "MovimientoStock", { id: `mov${k}`, empresaId: e, operacionId: `op${k}`, productoId: `ing${ke}`, seccionId: `sec${k}`, proceso: "COMPRA", cantidad: 5, detalle: "d" });
    await insertar(c, "DisponibilidadProducto", { id: `disp${k}`, empresaId: e, sucursalId: suc, productoId: `pro${ke}`, disponible: true });
    await insertar(c, "RegistroAuditoria", { id: `aud${k}`, empresaId: e, sucursalId: suc, entidad: "x", entidadId: "x", descripcion: "d", campo: "c", actorId: "u1" });
    await insertar(c, "RecetaVersion", { id: `rv${k}`, empresaId: e, productoId: `pro${ke}`, version: 1, sucursalId: suc });
    await insertar(c, "RecetaIngrediente", { id: `ri${k}`, empresaId: e, recetaVersionId: `rv${k}`, insumoProductoId: `ing${ke}`, cantidad: 1, unidadId: `uni${ke}` });
    await insertar(c, "RecetaPaso", { id: `rp${k}`, empresaId: e, recetaVersionId: `rv${k}`, orden: 1, instruccion: "mezclar" });
    await insertar(c, "RecetaPasoIngrediente", { id: `rpi${k}`, empresaId: e, recetaPasoId: `rp${k}`, recetaIngredienteId: `ri${k}` });
    await insertar(c, "SustitutoRecetaIngrediente", { id: `su${k}`, empresaId: e, recetaIngredienteId: `ri${k}`, insumoSustitutoId: `ins${ke}`, orden: 1 });
  }
  // De la empresa entera (sucursalId NULL): una auditoría y una receta central con su ingrediente.
  await insertar(c, "RegistroAuditoria", { id: "audNula", empresaId: EMPRESA_A, sucursalId: null, entidad: "x", entidadId: "x", descripcion: "d", campo: "c", actorId: "u1" });
  await insertar(c, "RecetaVersion", { id: "rvCentral", empresaId: EMPRESA_A, productoId: "proA", version: 2, sucursalId: null });
  await insertar(c, "RecetaIngrediente", { id: "riCentral", empresaId: EMPRESA_A, recetaVersionId: "rvCentral", insumoProductoId: "ingA", cantidad: 1, unidadId: "uniA" });
  // Un traspaso de a1 a a2, con la sección de cada lado.
  await insertar(c, "TraspasoSucursal", {
    id: "tr12", empresaId: EMPRESA_A, origenSucursalId: SUC.a1, destinoSucursalId: SUC.a2, productoId: "ingA", cantidad: 1, seccionOrigenId: "secA1", seccionDestinoId: "secA2",
    iniciadoPor: "ORIGEN", estado: "SOLICITADA", creadoPorId: "u1",
  });
  // El movimiento «incoherente»: su sección es de a1 y su operación es de a2 (la política de MovimientoStock solo mira la sección).
  await insertar(c, "MovimientoStock", { id: "movCruzado", empresaId: EMPRESA_A, operacionId: "opA2", productoId: "ingA", seccionId: "secA1", proceso: "COMPRA", cantidad: 1, detalle: "cruzado" });
}

export async function crearMundoDeSucursales(): Promise<MundoDeSucursales> {
  const base = await crearBaseTemporalMigrada();
  let app: Client | null = null;
  let cerrado = false;
  const cerrar = async () => {
    if (cerrado) return;
    cerrado = true;
    await app?.end().catch(() => undefined);
    await base.eliminar();
  };
  try {
    await base.aplicarRestantes();
    const hayRol = await existeElRol(base.cliente);
    if (hayRol) {
      // Los privilegios por defecto del script de roles son por base y la temporal nace sin ellos; se van con la base.
      await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
      await sembrar(base.cliente);
    }

    const credenciales = new URL(process.env.DATABASE_URL as string);
    const destino = new URL(base.url);
    const urlDeApp = new URL(base.url);
    urlDeApp.username = credenciales.username;
    urlDeApp.password = credenciales.password;
    const conectar = async () => {
      const cliente = new Client({
        host: destino.hostname,
        port: destino.port ? Number(destino.port) : 5432,
        user: decodeURIComponent(credenciales.username),
        password: decodeURIComponent(credenciales.password),
        database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
      });
      await cliente.connect();
      return cliente;
    };

    return {
      base,
      hayRol,
      urlComoApp: () => urlDeApp.toString(),
      async sesion(alcance, fn) {
        app ??= await conectar();
        await app.query("BEGIN");
        try {
          const partes: [string, string][] = [["app.empresa_id", alcance.empresa ?? EMPRESA_A]];
          if (alcance.lectura !== undefined) partes.push(["app.sucursales_lectura", alcance.lectura.join(",")]);
          if (alcance.escritura !== undefined) partes.push(["app.sucursales_escritura", alcance.escritura.join(",")]);
          await app.query(`SELECT ${partes.map((_, i) => `set_config($${2 * i + 1}, $${2 * i + 2}, true)`).join(", ")}`, partes.flat());
          return await fn(app);
        } finally {
          await app.query("ROLLBACK");
        }
      },
      async aplicar(sql) {
        await base.cliente.query(sql);
      },
      async quitarPoliticas() {
        await base.cliente.query(sqlDeReversaDeAlcanceDeSucursal());
      },
      cerrar,
    };
  } catch (e) {
    await cerrar();
    throw e;
  }
}

/** El SQL bueno del alta (funciones y políticas, las que genera el paso A9). */
export const sqlBueno = (): string => sqlDeAlcanceDeSucursal();

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// LOS ESCENARIOS
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface Escenario {
  id: string;
  titulo: string;
  correr(m: MundoDeSucursales): Promise<string[]>;
}

/** Lo que una sesión con `alcance` ve de cada tabla del mundo. */
async function verTodo(m: MundoDeSucursales, alcance: Alcance): Promise<Record<TablaDelMundo, string[]>> {
  return m.sesion(alcance, async (c) => {
    const salida = {} as Record<TablaDelMundo, string[]>;
    for (const t of TABLAS_DEL_MUNDO) salida[t] = await ids(c, t);
    return salida;
  });
}

/** Lo que la empresa A tiene de la cadena de la sucursal `k` (A1 o A2): todas las tablas que cuelgan de ella. */
const cadenaDe = (k: "A1" | "A2") => ({
  Seccion: [`sec${k}`],
  Mesa: [`mesa${k}`],
  Cuenta: [`cuenta${k}`],
  CuentaItem: [`item${k}`],
  Operacion: [`op${k}`],
  MovimientoStock: [`mov${k}`],
  DisponibilidadProducto: [`disp${k}`],
  RecetaPaso: [`rp${k}`],
  RecetaPasoIngrediente: [`rpi${k}`],
  SustitutoRecetaIngrediente: [`su${k}`],
});

/** Lo que se ve con alcance en las sucursales dadas: la cadena de cada una, más lo de la empresa entera (NULL) que se ve con cualquier alcance fijado. */
function esperadoCon(sucursales: readonly ("A1" | "A2")[]): Record<TablaDelMundo, string[]> {
  const unir = (tabla: keyof ReturnType<typeof cadenaDe>) => unicas(sucursales.flatMap((k) => cadenaDe(k)[tabla]));
  const conTraspaso = sucursales.length > 0 ? ["tr12"] : [];
  const movimientos = unir("MovimientoStock");
  return {
    Seccion: unir("Seccion"),
    Mesa: unir("Mesa"),
    Cuenta: unir("Cuenta"),
    CuentaItem: unir("CuentaItem"),
    Operacion: unir("Operacion"),
    // El movimiento «incoherente» cuelga de la sección de a1: lo ve quien ve a1, aunque su operación sea de a2.
    MovimientoStock: unicas([...movimientos, ...(sucursales.includes("A1") ? ["movCruzado"] : [])]),
    DisponibilidadProducto: unir("DisponibilidadProducto"),
    RegistroAuditoria: unicas([...sucursales.map((k) => `aud${k}`), "audNula"]),
    RecetaVersion: unicas([...sucursales.map((k) => `rv${k}`), "rvCentral"]),
    RecetaIngrediente: unicas([...sucursales.map((k) => `ri${k}`), "riCentral"]),
    RecetaPaso: unir("RecetaPaso"),
    RecetaPasoIngrediente: unir("RecetaPasoIngrediente"),
    SustitutoRecetaIngrediente: unir("SustitutoRecetaIngrediente"),
    // a1 → a2: se ve desde cualquiera de las dos puntas.
    TraspasoSucursal: conTraspaso,
  };
}

function compararTodo(problemas: string[], etiqueta: string, real: Record<TablaDelMundo, string[]>, esperado: Record<TablaDelMundo, string[]>): void {
  for (const t of TABLAS_DEL_MUNDO) esperar(problemas, `${etiqueta} · ${t}`, real[t], esperado[t]);
}

const insertSeccion = (id: string, suc: string) => `INSERT INTO "Seccion" ("id","sucursalId","nombre") VALUES ('${id}','${suc}','${id}')`;
const insertOperacion = (id: string, suc: string, clave: string | null = null) =>
  `INSERT INTO "Operacion" ("id","sucursalId","proceso","fecha","usuarioId","claveIdempotencia") VALUES ('${id}','${suc}','COMPRA',now(),'u1',${clave === null ? "NULL" : `'${clave}'`})`;

export const ESCENARIOS: readonly Escenario[] = [
  {
    id: "E1",
    titulo: "(1) dos sucursales de una empresa: desde A1 no se lee nada de A2 (ni por id, ni por sucursal, ni en la cadena de hijas)",
    async correr(m) {
      const p: string[] = [];
      compararTodo(p, "A1", await verTodo(m, { lectura: [SUC.a1], escritura: [SUC.a1] }), esperadoCon(["A1"]));
      compararTodo(p, "A2", await verTodo(m, { lectura: [SUC.a2], escritura: [SUC.a2] }), esperadoCon(["A2"]));
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        esperar(p, "una sección de A2 pedida por id", await ids(c, "Seccion", `"id" = 'secA2'`), []);
        esperar(p, "las secciones de A2 pedidas por sucursal", await ids(c, "Seccion", `"sucursalId" = '${SUC.a2}'`), []);
        esperar(p, "la cuenta de A2 pedida por id", await ids(c, "Cuenta", `"id" = 'cuentaA2'`), []);
        esperar(p, "count(*) de Seccion", Number((await c.query(`SELECT count(*) AS n FROM "Seccion"`)).rows[0].n), 1);
        esperar(p, "el JOIN de ítems con cuentas no trae lo de A2", (await c.query(`SELECT i."id" FROM "CuentaItem" i JOIN "Cuenta" cu ON cu."id" = i."cuentaId" ORDER BY 1`)).rows.map((r) => r.id), ["itemA1"]);
        esperar(p, "un IN con ids de A2 tampoco los trae", await ids(c, "Operacion", `"id" IN ('opA1','opA2')`), ["opA1"]);
      });
      return p;
    },
  },
  {
    id: "E2",
    titulo: "(2) escrituras cruzadas: INSERT ⇒ 42501, UPDATE/DELETE ⇒ 0 filas, mover una fila a otra sucursal ⇒ 42501",
    async correr(m) {
      const p: string[] = [];
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        esperar(p, "INSERT en la propia", await falla(c, insertSeccion("nueva", SUC.a1)), null);
        esperar(p, "INSERT cruzado en Seccion", await falla(c, insertSeccion("ajena", SUC.a2)), "42501");
        esperar(p, "INSERT cruzado en Operacion", await falla(c, insertOperacion("opAjena", SUC.a2)), "42501");
        esperar(p, "INSERT cruzado en Mesa", await falla(c, `INSERT INTO "Mesa" ("id","sucursalId","numero") VALUES ('mesaAjena','${SUC.a2}',9)`), "42501");
        esperar(p, "INSERT cruzado en DisponibilidadProducto", await falla(c, `INSERT INTO "DisponibilidadProducto" ("id","sucursalId","productoId","disponible") VALUES ('dAjena','${SUC.a2}','proA',true)`), "42501");
        esperar(p, "UPDATE de una fila ajena", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secA2'`), 0);
        esperar(p, "UPDATE de una fila propia", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secA1'`), 1);
        esperar(p, "UPDATE masivo: solo toca lo propio", await tocadas(c, `UPDATE "Mesa" SET "numero" = "numero" + 100`), 1);
        esperar(p, "DELETE de una fila ajena", await tocadas(c, `DELETE FROM "Operacion" WHERE "id" = 'opA2'`), 0);
        esperar(p, "DELETE masivo de DisponibilidadProducto: solo borra lo propio", await tocadas(c, `DELETE FROM "DisponibilidadProducto"`), 1);
        esperar(p, "mover una fila propia a otra sucursal", await falla(c, `UPDATE "Seccion" SET "sucursalId" = '${SUC.a2}' WHERE "id" = 'secA1'`), "42501");
        esperar(p, "mover una operación propia a otra sucursal", await falla(c, `UPDATE "Operacion" SET "sucursalId" = '${SUC.a2}' WHERE "id" = 'opA1'`), "42501");
        esperar(p, "traer una fila ajena a la propia sucursal (UPDATE de una ajena)", await tocadas(c, `UPDATE "Seccion" SET "sucursalId" = '${SUC.a1}' WHERE "id" = 'secA2'`), 0);
      });
      return p;
    },
  },
  {
    id: "E3",
    titulo: "(3) usuario con varias sucursales (lectura en A1 y A2, escritura solo en A1): ve las dos, escribe solo en A1; con solo escritura la lectura la incluye",
    async correr(m) {
      const p: string[] = [];
      const alcance = { lectura: [SUC.a1, SUC.a2], escritura: [SUC.a1] };
      compararTodo(p, "lectura A1+A2", await verTodo(m, alcance), esperadoCon(["A1", "A2"]));
      await m.sesion(alcance, async (c) => {
        esperar(p, "no ve A3 (sin filas) ni B1", await ids(c, "Seccion", `"sucursalId" IN ('${SUC.a3}','${SUC.b1}')`), []);
        esperar(p, "INSERT en A1 (escritura)", await falla(c, insertSeccion("nuevaA1", SUC.a1)), null);
        esperar(p, "INSERT en A2 (solo lectura)", await falla(c, insertSeccion("nuevaA2", SUC.a2)), "42501");
        esperar(p, "UPDATE en A2 (solo lectura)", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secA2'`), 0);
        esperar(p, "DELETE en A2 (solo lectura)", await tocadas(c, `DELETE FROM "Seccion" WHERE "id" = 'secA2'`), 0);
        // Mover una fila propia a una sucursal que SÍ se ve pero no se escribe: la política de SELECT (lectura) no lo frena, solo el WITH CHECK de escritura del UPDATE.
        esperar(p, "mover una fila propia a una sucursal de solo lectura", await falla(c, `UPDATE "Seccion" SET "sucursalId" = '${SUC.a2}' WHERE "id" = 'secA1'`), "42501");
        esperar(p, "mover un ítem (hija) a la cuenta de una sucursal de solo lectura", await falla(c, `UPDATE "CuentaItem" SET "cuentaId" = 'cuentaA2' WHERE "id" = 'itemA1'`), "42501");
        esperar(p, "UPDATE de la hija en A2 (solo lectura)", await tocadas(c, `UPDATE "CuentaItem" SET "cantidad" = 2 WHERE "id" = 'itemA2'`), 0);
        esperar(p, "UPDATE de la hija en A1 (escritura)", await tocadas(c, `UPDATE "CuentaItem" SET "cantidad" = 2 WHERE "id" = 'itemA1'`), 1);
      });
      // Solo escritura en A2: la lectura efectiva la incluye (lectura = lectura ∪ escritura).
      compararTodo(p, "solo escritura en A2", await verTodo(m, { lectura: [], escritura: [SUC.a2] }), esperadoCon(["A2"]));
      compararTodo(p, "escritura en A2 sin la variable de lectura", await verTodo(m, { escritura: [SUC.a2] }), esperadoCon(["A2"]));
      // Solo lectura en A1: ve, no escribe.
      await m.sesion({ lectura: [SUC.a1], escritura: [] }, async (c) => {
        esperar(p, "solo lectura: ve", await ids(c, "Seccion"), ["secA1"]);
        esperar(p, "solo lectura: INSERT", await falla(c, insertSeccion("x", SUC.a1)), "42501");
        esperar(p, "solo lectura: UPDATE", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'o' WHERE "id" = 'secA1'`), 0);
      });
      return p;
    },
  },
  {
    id: "E4",
    titulo: "(4) gerente con una sola membresía (A2): no ve A1; ve su auditoría y lo de la empresa entera",
    async correr(m) {
      const p: string[] = [];
      compararTodo(p, "gerente de A2", await verTodo(m, { lectura: [SUC.a2], escritura: [SUC.a2] }), esperadoCon(["A2"]));
      await m.sesion({ lectura: [SUC.a2], escritura: [SUC.a2] }, async (c) => {
        esperar(p, "no ve la sección de A1", await ids(c, "Seccion", `"id" = 'secA1'`), []);
        esperar(p, "no ve la auditoría de A1", await ids(c, "RegistroAuditoria", `"id" = 'audA1'`), []);
        esperar(p, "no escribe en A1", await falla(c, insertSeccion("x", SUC.a1)), "42501");
      });
      return p;
    },
  },
  {
    id: "E5",
    titulo: "(5) sin variables (o con listas vacías) no se ve ni se escribe nada: falla cerrado, también las filas de empresa con sucursalId NULL y sus hijas",
    async correr(m) {
      const p: string[] = [];
      const vacio = Object.fromEntries(TABLAS_DEL_MUNDO.map((t) => [t, []])) as unknown as Record<TablaDelMundo, string[]>;
      // El código anterior a A2: solo `app.empresa_id`, ninguna variable de sucursal.
      compararTodo(p, "sin variables", await verTodo(m, {}), vacio);
      // `dbDeEmpresa` sin alcance: las dos variables fijadas y vacías.
      compararTodo(p, "listas vacías", await verTodo(m, { lectura: [], escritura: [] }), vacio);
      compararTodo(p, "solo la de escritura vacía", await verTodo(m, { escritura: [] }), vacio);
      for (const [etiqueta, alcance] of [["sin variables", {}], ["listas vacías", { lectura: [], escritura: [] }]] as const) {
        await m.sesion(alcance, async (c) => {
          esperar(p, `${etiqueta}: INSERT en Seccion`, await falla(c, insertSeccion("x", SUC.a1)), "42501");
          esperar(p, `${etiqueta}: INSERT en Operacion`, await falla(c, insertOperacion("opX", SUC.a1)), "42501");
          esperar(p, `${etiqueta}: INSERT de auditoría de empresa (sucursalId NULL)`, await falla(c, `INSERT INTO "RegistroAuditoria" ("id","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ('aX',NULL,'x','x','d','c','u1')`), "42501");
          esperar(p, `${etiqueta}: INSERT de receta central (sucursalId NULL)`, await falla(c, `INSERT INTO "RecetaVersion" ("id","productoId","version","sucursalId") VALUES ('rvX','proA',9,NULL)`), "42501");
          esperar(p, `${etiqueta}: UPDATE`, await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'o'`), 0);
          esperar(p, `${etiqueta}: UPDATE de la auditoría de empresa`, await tocadas(c, `UPDATE "RegistroAuditoria" SET "descripcion" = 'o' WHERE "id" = 'audNula'`), 0);
          esperar(p, `${etiqueta}: DELETE`, await tocadas(c, `DELETE FROM "Operacion"`), 0);
        });
      }
      // Con alcance fijado, lo de la empresa entera SÍ se ve (y se escribe con escritura).
      await m.sesion({ lectura: [SUC.a3], escritura: [] }, async (c) => {
        esperar(p, "con alcance (A3, sin filas propias) se ve la auditoría de empresa", await ids(c, "RegistroAuditoria"), ["audNula"]);
        esperar(p, "con alcance se ve la receta central y su ingrediente", [await ids(c, "RecetaVersion"), await ids(c, "RecetaIngrediente")], [["rvCentral"], ["riCentral"]]);
        esperar(p, "sin escritura no escribe lo de empresa", await falla(c, `INSERT INTO "RegistroAuditoria" ("id","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ('aY',NULL,'x','x','d','c','u1')`), "42501");
      });
      await m.sesion({ lectura: [], escritura: [SUC.a3] }, async (c) => {
        esperar(p, "con escritura (A3) se escribe lo de empresa", await falla(c, `INSERT INTO "RegistroAuditoria" ("id","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ('aZ',NULL,'x','x','d','c','u1')`), null);
        esperar(p, "con escritura (A3) se escribe el ingrediente de la receta central", await falla(c, `INSERT INTO "RecetaIngrediente" ("id","recetaVersionId","insumoProductoId","cantidad","unidadId") VALUES ('riZ','rvCentral','ingA',1,'uniA')`), null);
      });
      return p;
    },
  },
  {
    id: "E6",
    titulo: "(6) hijas por la cadena de padres: una hija en un padre ajeno ⇒ 42501 (en uno, dos y tres niveles), y el JOIN a un padre invisible no lo trae",
    async correr(m) {
      const p: string[] = [];
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        // Cuentas CERRADAS: la mesa ya tiene una abierta y solo puede haber una.
        const cuenta = (id: string, mesa: string) => `INSERT INTO "Cuenta" ("id","mesaId","abiertaPorId","cerradaEn","cerradaPorId") VALUES ('${id}','${mesa}','u1',now(),'u1')`;
        esperar(p, "Cuenta en el padre propio", await falla(c, cuenta("cNueva", "mesaA1")), null);
        esperar(p, "Cuenta en el padre ajeno", await falla(c, cuenta("cAjena", "mesaA2")), "42501");
        const item = (id: string, cuenta: string) => `INSERT INTO "CuentaItem" ("id","cuentaId","productoId","cantidad","precioUnitario") VALUES ('${id}','${cuenta}','proA',1,1)`;
        esperar(p, "CuentaItem (dos niveles) en la cuenta propia", await falla(c, item("iNuevo", "cuentaA1")), null);
        esperar(p, "CuentaItem (dos niveles) en la cuenta de otra sucursal", await falla(c, item("iAjeno", "cuentaA2")), "42501");
        const movimiento = (id: string, seccion: string) => `INSERT INTO "MovimientoStock" ("id","operacionId","productoId","seccionId","proceso","cantidad","detalle") VALUES ('${id}','opA1','ingA','${seccion}','COMPRA',1,'d')`;
        esperar(p, "MovimientoStock en la sección propia", await falla(c, movimiento("mNuevo", "secA1")), null);
        esperar(p, "MovimientoStock en la sección de otra sucursal", await falla(c, movimiento("mAjeno", "secA2")), "42501");
        const ingrediente = (id: string, version: string) => `INSERT INTO "RecetaIngrediente" ("id","recetaVersionId","insumoProductoId","cantidad","unidadId") VALUES ('${id}','${version}','ingA',1,'uniA')`;
        esperar(p, "RecetaIngrediente en la receta propia", await falla(c, ingrediente("riNuevo", "rvA1")), null);
        esperar(p, "RecetaIngrediente en la receta central", await falla(c, ingrediente("riNuevoC", "rvCentral")), null);
        esperar(p, "RecetaIngrediente en la receta de otra sucursal", await falla(c, ingrediente("riAjeno", "rvA2")), "42501");
        esperar(p, "RecetaPaso en la receta de otra sucursal", await falla(c, `INSERT INTO "RecetaPaso" ("id","recetaVersionId","orden","instruccion") VALUES ('rpAjeno','rvA2',5,'x')`), "42501");
        esperar(p, "RecetaPasoIngrediente (tres niveles) en un paso ajeno", await falla(c, `INSERT INTO "RecetaPasoIngrediente" ("id","recetaPasoId","recetaIngredienteId") VALUES ('rpiAjeno','rpA2','riA1')`), "42501");
        esperar(p, "SustitutoRecetaIngrediente (tres niveles) en un ingrediente ajeno", await falla(c, `INSERT INTO "SustitutoRecetaIngrediente" ("id","recetaIngredienteId","insumoSustitutoId","orden") VALUES ('suAjeno','riA2','insA2',7)`), "42501");
        esperar(p, "SustitutoRecetaIngrediente en un ingrediente propio", await falla(c, `INSERT INTO "SustitutoRecetaIngrediente" ("id","recetaIngredienteId","insumoSustitutoId","orden") VALUES ('suNuevo','riA1','insA2',7)`), null);
        // Mover una hija a un padre ajeno (UPDATE de la FK) también se frena.
        esperar(p, "mover un ítem a la cuenta de otra sucursal", await falla(c, `UPDATE "CuentaItem" SET "cuentaId" = 'cuentaA2' WHERE "id" = 'itemA1'`), "42501");
        esperar(p, "mover un movimiento a la sección de otra sucursal", await falla(c, `UPDATE "MovimientoStock" SET "seccionId" = 'secA2' WHERE "id" = 'movA1'`), "42501");
        // El JOIN a un padre invisible: el movimiento «incoherente» (sección de A1, operación de A2) se ve, pero su operación no.
        const j = (await c.query<{ mov: string; op: string | null }>(`SELECT m."id" AS mov, o."id" AS op FROM "MovimientoStock" m LEFT JOIN "Operacion" o ON o."id" = m."operacionId" WHERE m."id" IN ('movA1','movCruzado') ORDER BY 1`)).rows;
        esperar(p, "LEFT JOIN a la operación: el padre ajeno no aparece", j, [{ mov: "movA1", op: "opA1" }, { mov: "movCruzado", op: null }]);
        esperar(p, "INNER JOIN a la operación: la fila con padre invisible se cae", (await c.query(`SELECT m."id" FROM "MovimientoStock" m JOIN "Operacion" o ON o."id" = m."operacionId" WHERE m."id" = 'movCruzado'`)).rows, []);
        // LIMITACIÓN DOCUMENTADA (ADR de alcance por sucursal): la política de MovimientoStock solo mira la FK a Sección; la FK a Operación, ConteoFisico y TraspasoSucursal no la valida ninguna.
        esperar(p, "LIMITACIÓN: un movimiento de la sección propia con la operación de OTRA sucursal pasa la RLS", await falla(c, `INSERT INTO "MovimientoStock" ("id","operacionId","productoId","seccionId","proceso","cantidad","detalle") VALUES ('mLimite','opA2','ingA','secA1','COMPRA',1,'d')`), null);
      });
      return p;
    },
  },
  {
    id: "E7",
    titulo: "(7) TraspasoSucursal: visible y escribible desde el origen o desde el destino; ni lo uno ni lo otro ⇒ nada",
    async correr(m) {
      const p: string[] = [];
      const ver = (alcance: Alcance) => m.sesion(alcance, (c) => ids(c, "TraspasoSucursal"));
      esperar(p, "desde el origen", await ver({ lectura: [SUC.a1], escritura: [] }), ["tr12"]);
      esperar(p, "desde el destino", await ver({ lectura: [SUC.a2], escritura: [] }), ["tr12"]);
      esperar(p, "desde un tercero (A3)", await ver({ lectura: [SUC.a3], escritura: [SUC.a3] }), []);
      esperar(p, "con las dos puntas", await ver({ lectura: [SUC.a1, SUC.a2], escritura: [] }), ["tr12"]);
      const actualizar = `UPDATE "TraspasoSucursal" SET "detalle" = 'x' WHERE "id" = 'tr12'`;
      for (const [etiqueta, escritura, filas] of [["origen", [SUC.a1], 1], ["destino", [SUC.a2], 1], ["un tercero", [SUC.a3], 0], ["nadie", [], 0]] as const) {
        await m.sesion({ lectura: [SUC.a1, SUC.a2], escritura }, async (c) => {
          esperar(p, `UPDATE desde ${etiqueta}`, await tocadas(c, actualizar), filas);
        });
      }
      await m.sesion({ lectura: [SUC.a1, SUC.a2], escritura: [SUC.a3] }, async (c) => {
        esperar(p, "DELETE desde un tercero que solo escribe en A3", await tocadas(c, `DELETE FROM "TraspasoSucursal" WHERE "id" = 'tr12'`), 0);
      });
      await m.sesion({ lectura: [SUC.a1, SUC.a2], escritura: [SUC.a2] }, async (c) => {
        esperar(p, "DELETE desde el destino", await tocadas(c, `DELETE FROM "TraspasoSucursal" WHERE "id" = 'tr12'`), 1);
      });
      const nuevo = (id: string, origen: string, destino: string) =>
        `INSERT INTO "TraspasoSucursal" ("id","origenSucursalId","destinoSucursalId","productoId","cantidad","iniciadoPor","estado","creadoPorId") VALUES ('${id}','${origen}','${destino}','ingA',1,'ORIGEN','SOLICITADA','u1')`;
      await m.sesion({ lectura: [SUC.a1, SUC.a2, SUC.a3], escritura: [SUC.a3] }, async (c) => {
        esperar(p, "INSERT con el origen en la escritura", await falla(c, nuevo("trO", SUC.a3, SUC.a2)), null);
        esperar(p, "INSERT con el destino en la escritura", await falla(c, nuevo("trD", SUC.a2, SUC.a3)), null);
        esperar(p, "INSERT sin ninguna de las dos puntas en la escritura", await falla(c, nuevo("trN", SUC.a1, SUC.a2)), "42501");
      });
      // D7: quien ve el traspaso desde un lado NO ve la sección del otro lado.
      await m.sesion({ lectura: [SUC.a2], escritura: [] }, async (c) => {
        const r = (await c.query<{ id: string; sec: string | null }>(`SELECT t."id", s."id" AS sec FROM "TraspasoSucursal" t LEFT JOIN "Seccion" s ON s."id" = t."seccionOrigenId"`)).rows;
        esperar(p, "D7: el destino ve el traspaso pero no la sección del origen", r, [{ id: "tr12", sec: null }]);
      });
      return p;
    },
  },
  {
    id: "E8",
    titulo: "(8) consolidado: ampliar la lectura a varias sucursales no ensancha la escritura",
    async correr(m) {
      const p: string[] = [];
      const alcance = { lectura: [SUC.a1, SUC.a2, SUC.a3], escritura: [SUC.a1] };
      compararTodo(p, "consolidado", await verTodo(m, alcance), esperadoCon(["A1", "A2"]));
      await m.sesion(alcance, async (c) => {
        for (const suc of [SUC.a2, SUC.a3]) esperar(p, `INSERT en ${suc} con lectura ampliada`, await falla(c, insertSeccion(`x${suc}`, suc)), "42501");
        esperar(p, "UPDATE masivo con lectura ampliada: solo lo escribible", await tocadas(c, `UPDATE "Seccion" SET "nombre" = "nombre" || '!'`), 1);
        esperar(p, "DELETE masivo con lectura ampliada: solo lo escribible", await tocadas(c, `DELETE FROM "DisponibilidadProducto"`), 1);
        esperar(p, "UPDATE de la hija con lectura ampliada: solo la escribible", await tocadas(c, `UPDATE "CuentaItem" SET "cantidad" = 5`), 1);
      });
      // Lectura en las tres y escritura en ninguna: se ve todo y no se toca nada.
      await m.sesion({ lectura: [SUC.a1, SUC.a2, SUC.a3], escritura: [] }, async (c) => {
        esperar(p, "solo lectura: ve las dos cadenas", await ids(c, "Seccion"), ["secA1", "secA2"]);
        esperar(p, "solo lectura: UPDATE masivo", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'x'`), 0);
        esperar(p, "solo lectura: INSERT", await falla(c, insertSeccion("y", SUC.a1)), "42501");
      });
      return p;
    },
  },
  {
    id: "E9",
    titulo: "(9) dos empresas no se ven entre sí aunque compartan el nombre de la sucursal, de la sección y el número de mesa, ni aunque el alcance nombre la sucursal de la otra",
    async correr(m) {
      const p: string[] = [];
      await m.sesion({ empresa: EMPRESA_B, lectura: [SUC.b1], escritura: [SUC.b1] }, async (c) => {
        esperar(p, "B ve solo lo suyo (Seccion)", await ids(c, "Seccion"), ["secB1"]);
        esperar(p, "B ve solo lo suyo (cadena de hijas)", [await ids(c, "Cuenta"), await ids(c, "CuentaItem"), await ids(c, "MovimientoStock")], [["cuentaB1"], ["itemB1"], ["movB1"]]);
        esperar(p, "B no ve el traspaso ni la auditoría de A", [await ids(c, "TraspasoSucursal"), await ids(c, "RegistroAuditoria")], [[], ["audB1"]]);
        esperar(p, "B ve su sucursal «Centro» (la de A se llama igual)", (await c.query(`SELECT "id" FROM "Sucursal" WHERE "nombre" = 'Centro'`)).rows.map((r) => r.id), [SUC.b1]);
        esperar(p, "B no escribe en una sucursal de A", await falla(c, insertSeccion("x", SUC.a1)), "42501");
      });
      // El alcance de B nombra la sucursal de A (un error del que arma el alcance): la RLS por empresa sigue cortando.
      await m.sesion({ empresa: EMPRESA_B, lectura: [SUC.a1, SUC.b1], escritura: [SUC.a1, SUC.b1] }, async (c) => {
        esperar(p, "B con A1 en el alcance no ve a A", await ids(c, "Seccion"), ["secB1"]);
        esperar(p, "B con A1 en el alcance no escribe en A (la FK compuesta o la RLS lo frenan)", ["42501", "23503"].includes((await falla(c, insertSeccion("x", SUC.a1))) ?? "ok"), true);
        esperar(p, "B con A1 en el alcance no actualiza lo de A", await tocadas(c, `UPDATE "Seccion" SET "nombre" = 'o' WHERE "id" = 'secA1'`), 0);
      });
      // Y al revés: A con la sucursal de B en el alcance.
      await m.sesion({ empresa: EMPRESA_A, lectura: [SUC.a1, SUC.b1], escritura: [SUC.a1, SUC.b1] }, async (c) => {
        esperar(p, "A con B1 en el alcance no ve a B", await ids(c, "Seccion"), ["secA1"]);
        esperar(p, "A con B1 en el alcance no ve la auditoría de B", await ids(c, "RegistroAuditoria"), ["audA1", "audNula"]);
      });
      // Una empresa que no existe: nada.
      await m.sesion({ empresa: "empInexistente", lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        esperar(p, "empresa inexistente con el alcance de A", await ids(c, "Seccion"), []);
      });
      return p;
    },
  },
  {
    id: "E0",
    titulo: "(barrido) las 31 tablas con política responden sin error, y sin alcance no devuelven una sola fila",
    async correr(m) {
      const p: string[] = [];
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        for (const t of TABLAS_CON_POLITICA_DE_SUCURSAL) {
          const codigo = await falla(c, `SELECT count(*) FROM "${t}"`);
          if (codigo !== null) p.push(`${t}: la lectura con alcance falló (${codigo})`);
        }
      });
      await m.sesion({}, async (c) => {
        for (const t of TABLAS_CON_POLITICA_DE_SUCURSAL) {
          const n = Number((await c.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
          if (n !== 0) p.push(`${t}: sin alcance devolvió ${n} fila(s)`);
        }
      });
      return p;
    },
  },
  {
    id: "E11",
    titulo: "(11) idempotencia I3: la misma clave en la misma sucursal no duplica; desde otra sucursal la fila no se ve y el INSERT choca con la clave ÚNICA GLOBAL (P2002)",
    async correr(m) {
      const p: string[] = [];
      const clave = "clave-i3-prueba";
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        const buscar = async () => (await c.query<{ id: string }>(`SELECT "id" FROM "Operacion" WHERE "claveIdempotencia" = $1`, [clave])).rows.map((r) => r.id);
        esperar(p, "la primera vez no hay nada", await buscar(), []);
        esperar(p, "la primera vez se inserta", await falla(c, insertOperacion("opI3", SUC.a1, clave)), null);
        // El caso de uso (`chequearIdempotencia`) busca por clave ANTES de insertar: ve la fila propia ⇒ «duplicado» y no inserta de nuevo.
        esperar(p, "el reintento en la misma sucursal VE la operación (el caso de uso la reconoce como duplicada)", await buscar(), ["opI3"]);
        // Aun si alguien insertara igual, la clave única lo frena: no hay dos filas.
        esperar(p, "insertar de nuevo la misma clave en la misma sucursal choca (23505)", await falla(c, insertOperacion("opI3b", SUC.a1, clave)), "23505");
        esperar(p, "sigue habiendo una sola", Number((await c.query(`SELECT count(*) AS n FROM "Operacion" WHERE "claveIdempotencia" = $1`, [clave])).rows[0].n), 1);
      });
      // LIMITACIÓN DOCUMENTADA (no se arregla acá): `Operacion.claveIdempotencia` es única GLOBAL. Una clave usada en A1 no la ve quien solo tiene A2 (la RLS la oculta: `chequearIdempotencia`
      // diría «nueva») y su INSERT choca con el índice único (P2002 / 23505), que no mira la RLS. El efecto es un error genérico, no una duplicación.
      await m.sesion({ lectura: [SUC.a1], escritura: [SUC.a1] }, async (c) => {
        await c.query(insertOperacion("opI3", SUC.a1, clave));
        await c.query("SELECT set_config('app.sucursales_lectura', $1, true), set_config('app.sucursales_escritura', $1, true)", [SUC.a2]);
        esperar(p, "desde A2 la operación de A1 con esa clave NO se ve", (await c.query(`SELECT "id" FROM "Operacion" WHERE "claveIdempotencia" = $1`, [clave])).rows, []);
        esperar(p, "desde A2 el INSERT con la misma clave choca con la clave única global (23505)", await falla(c, insertOperacion("opI3c", SUC.a2, clave)), "23505");
      });
      return p;
    },
  },
];
