// Ejecuta un script SQL escrito para `psql` SIN tener psql (por ejemplo en Windows): scripts/operaciones/crear-rol-motor2-plataforma.sql.
// Soporta SOLO lo que esos scripts usan: \set, `... \gset`, \if / \else / \endif, y las variables :'x' (literal), :"x" (identificador), :{?x} (¿está definida?) y :x.
// Todo va en UNA transacción: si algo falla no queda nada a medias, y con --simular se hace ROLLBACK al final (se ve lo que pasaría sin cambiar nada).
//
// Uso (raíz del repo):
//   node scripts/operaciones/ejecutar-sql-de-psql.mjs <archivo.env> <script.sql> [--simular] [--var nombre=ENV_QUE_TIENE_EL_VALOR]...
// El archivo .env aporta `DIRECT_URL` (el DUEÑO de la base). Los valores de las variables NUNCA se pasan por la línea de comandos: --var clave=CLAVE_PLATAFORMA lee el valor de la
// variable de ENTORNO CLAVE_PLATAFORMA. No imprime URLs ni claves.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const VERDADERO = new Set(["t", "true", "on", "yes", "1"]);

/** Interpola las variables de psql en un texto. Un nombre no definido en :'x' / :"x" / :x es un error (psql lo dejaría literal y rompería el SQL). */
export function interpolar(texto, vars, escapar) {
  return texto
    .replace(/:\{\?(\w+)\}/g, (_, n) => (n in vars ? "TRUE" : "FALSE"))
    .replace(/(?<!:):'(\w+)'/g, (_, n) => {
      if (!(n in vars)) throw new Error(`falta la variable :'${n}' (pasala con --var ${n}=<NOMBRE_DE_LA_VARIABLE_DE_ENTORNO>)`);
      return escapar.literal(vars[n]);
    })
    .replace(/(?<!:):"(\w+)"/g, (_, n) => {
      if (!(n in vars)) throw new Error(`falta la variable :"${n}"`);
      return escapar.identificador(vars[n]);
    })
    .replace(/(?<![:\w]):([A-Za-z_]\w*)\b/g, (_, n) => {
      if (!(n in vars)) throw new Error(`falta la variable :${n}`);
      return String(vars[n]);
    });
}

/**
 * Corre el script contra `cliente` (`query(texto)` y, para interpolar, `escapar`). `alResultado(texto, resultado)` recibe cada sentencia ejecutada y su resultado.
 * Devuelve la cantidad de sentencias ejecutadas.
 */
export async function ejecutarScript(texto, cliente, vars, escapar, alResultado = () => {}) {
  const pila = []; // un true por cada \if en curso: la rama activa
  const activo = () => pila.every(Boolean);
  let acumulado = "";
  let enDolares = false;
  let ejecutadas = 0;

  const correr = async (sentencia, gset) => {
    const resultado = await cliente.query(interpolar(sentencia, vars, escapar));
    ejecutadas += 1;
    if (gset) {
      const fila = resultado.rows?.[0];
      if (!fila) throw new Error(`\\gset: la consulta no devolvió ninguna fila: ${sentencia.slice(0, 80)}`);
      for (const [columna, valor] of Object.entries(fila)) vars[columna] = typeof valor === "boolean" ? (valor ? "t" : "f") : String(valor);
    } else {
      alResultado(sentencia, resultado);
    }
  };

  for (const lineaCruda of texto.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (acumulado === "") {
      if (linea === "" || linea.startsWith("--")) continue;
      if (linea.startsWith("\\")) {
        const [orden, ...resto] = linea.split(/\s+/);
        if (orden === "\\set") {
          if (activo()) vars[resto[0]] = resto.slice(1).join(" ");
        } else if (orden === "\\if") {
          const valor = interpolar(resto.join(" "), vars, escapar);
          pila.push(VERDADERO.has(valor.toLowerCase()));
        } else if (orden === "\\else") {
          if (pila.length === 0) throw new Error("\\else sin \\if");
          pila[pila.length - 1] = !pila[pila.length - 1];
        } else if (orden === "\\endif") {
          if (pila.length === 0) throw new Error("\\endif sin \\if");
          pila.pop();
        } else {
          throw new Error(`comando de psql no soportado: ${orden}`);
        }
        continue;
      }
    }
    // Sentencia SQL: se acumula hasta un `;` al final de línea fuera de un bloque $$ … $$.
    const conGset = /\s\\gset\s*$/.test(linea);
    const texto1 = conGset ? lineaCruda.replace(/\s\\gset\s*$/, "") : lineaCruda;
    acumulado += (acumulado ? "\n" : "") + texto1;
    if ((texto1.match(/\$\$/g) ?? []).length % 2 === 1) enDolares = !enDolares;
    if (!enDolares && (/;\s*$/.test(texto1) || conGset)) {
      if (activo()) await correr(acumulado, conGset);
      acumulado = "";
    }
  }
  if (acumulado.trim() !== "") throw new Error("el script termina con una sentencia sin cerrar");
  if (pila.length) throw new Error("falta un \\endif");
  return ejecutadas;
}

async function principal() {
  const { default: pg } = await import("pg");
  const args = process.argv.slice(2);
  const [archivoEnv, archivoSql] = args.filter((a) => !a.startsWith("--") && !/^\w+=/.test(a));
  const simular = args.includes("--simular");
  const vars = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--var") continue;
    const [nombre, deEntorno] = String(args[i + 1]).split("=");
    const valor = process.env[deEntorno];
    if (valor === undefined || valor === "") throw new Error(`la variable de entorno ${deEntorno} (para :'${nombre}') está vacía`);
    vars[nombre] = valor;
  }
  if (!archivoEnv || !archivoSql) throw new Error("uso: ejecutar-sql-de-psql.mjs <archivo.env> <script.sql> [--simular] [--var nombre=VARIABLE_DE_ENTORNO]");

  const kv = Object.fromEntries(
    readFileSync(archivoEnv, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2")]),
  );
  if (!kv.DIRECT_URL) throw new Error(`${archivoEnv} no tiene DIRECT_URL (la conexión del dueño)`);
  const u = new URL(kv.DIRECT_URL);
  const necesitaSsl = ["require", "verify-ca", "verify-full"].includes(u.searchParams.get("sslmode") ?? "");
  const cliente = new pg.Client({
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ssl: necesitaSsl ? { rejectUnauthorized: true } : undefined,
  });
  await cliente.connect();
  const host = new URL(kv.DIRECT_URL).hostname;
  console.log(`${simular ? "SIMULACIÓN (ROLLBACK al final)" : "EJECUCIÓN REAL"} en ${host} como el dueño de la base.`);
  const escapar = { literal: (v) => cliente.escapeLiteral(v), identificador: (v) => cliente.escapeIdentifier(v) };
  try {
    await cliente.query("BEGIN");
    const n = await ejecutarScript(readFileSync(archivoSql, "utf8"), cliente, vars, escapar, (sentencia, r) => {
      if (/^\s*SELECT\b/i.test(sentencia) && r.rows?.length) {
        console.log(`\n${sentencia.replace(/\s+/g, " ").slice(0, 110)}…`);
        console.table(r.rows);
      }
    });
    if (simular) {
      await cliente.query("ROLLBACK");
      console.log(`\nSimulación terminada: ${n} sentencias, TODO deshecho (ROLLBACK).`);
    } else {
      await cliente.query("COMMIT");
      console.log(`\nListo: ${n} sentencias aplicadas y confirmadas (COMMIT).`);
    }
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    console.error(`\nFALLÓ y se deshizo todo (ROLLBACK): ${e instanceof Error ? e.message.replace(/PASSWORD\s+'[^']*'/gi, "PASSWORD '***'") : e}`);
    process.exitCode = 1;
  } finally {
    await cliente.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await principal();
