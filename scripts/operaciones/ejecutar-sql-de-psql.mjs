// Ejecuta un script SQL escrito para `psql` SIN tener psql (por ejemplo en Windows): scripts/operaciones/crear-rol-motor2-plataforma.sql.
// Soporta SOLO lo que esos scripts usan: \set, `... \gset`, \if / \else / \endif, y las variables :'x' (literal), :"x" (identificador), :{?x} (¿está definida?) y :x.
// Todo va en UNA transacción: si algo falla no queda nada a medias, y con --simular se hace ROLLBACK al final (se ve lo que pasaría sin cambiar nada).
//
// Uso (raíz del repo):
//   node scripts/operaciones/ejecutar-sql-de-psql.mjs <archivo.env> <script.sql> [--simular] [--host-esperado <host>] [--var nombre=ENV_QUE_TIENE_EL_VALOR]...
// El archivo .env aporta `DIRECT_URL` (el DUEÑO de la base). Los valores de las variables NUNCA se pasan por la línea de comandos: --var clave=CLAVE_PLATAFORMA lee el valor de la
// variable de ENTORNO CLAVE_PLATAFORMA. No imprime URLs ni claves.
// M.1-C6: `--host-esperado <host>` es OBLIGATORIO salvo con `--simular`: si el host de DIRECT_URL es otro, se niega ANTES de conectarse (la guarda contra usar el .env equivocado). Con `--simular` se
// puede omitir (no escribe nada); si se pasa, también tiene que coincidir. Una opción desconocida es un error.
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
 * @param {(sentencia: string, resultado: { rows?: unknown[] }) => void} [alResultado]
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

/**
 * Los argumentos de la línea de comandos. `--host-esperado <host>` (o `--host-esperado=<host>`) lleva un valor; `--var nombre=VARIABLE` también. Una opción que no existe es un error (antes se ignoraba
 * en silencio: un `--simulr` mal escrito corría de verdad).
 */
export function leerArgumentos(args) {
  const posicionales = [];
  const vars = [];
  let simular = false;
  let hostEsperado;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--simular") simular = true;
    else if (a === "--var") {
      const v = args[++i];
      if (v === undefined || !/^\w+=\w+$/.test(v)) throw new Error("--var necesita nombre=VARIABLE_DE_ENTORNO");
      vars.push(v.split("="));
    } else if (a === "--host-esperado" || a.startsWith("--host-esperado=")) {
      const valor = a === "--host-esperado" ? args[++i] : a.slice("--host-esperado=".length);
      if (valor === undefined || valor.trim() === "" || valor.startsWith("--")) throw new Error("--host-esperado necesita el host de la base (por ejemplo: --host-esperado ep-algo-123.neon.tech)");
      hostEsperado = valor.trim();
    } else if (a.startsWith("--")) throw new Error(`opción desconocida: ${a}`);
    else posicionales.push(a);
  }
  const [archivoEnv, archivoSql] = posicionales;
  return { archivoEnv, archivoSql, simular, hostEsperado, vars };
}

/**
 * M.1-C6: la última barrera contra correr contra la base equivocada (un `.env` de producción en lugar de uno de ensayo). Con ejecución REAL el host esperado es OBLIGATORIO y tiene que ser el de
 * `DIRECT_URL`; con `--simular` es opcional (no escribe nada), pero si se pasa, también tiene que coincidir. Se llama ANTES de crear el cliente: si falla no hay ninguna conexión.
 */
export function verificarHostDeDestino(hostDeLaUrl, hostEsperado, simular) {
  if (hostEsperado === undefined) {
    if (!simular) throw new Error("falta --host-esperado <host>: en la ejecución real hay que decir a qué host se espera conectar (con --simular es opcional). No se conectó a nada.");
    return;
  }
  if (hostDeLaUrl.toLowerCase() !== hostEsperado.toLowerCase()) {
    throw new Error(`el host de DIRECT_URL (${hostDeLaUrl}) no es el esperado (${hostEsperado}): no se conectó a nada.`);
  }
}

/**
 * Corre el ejecutor y devuelve el código de salida (0 bien, 1 si el script falló y se deshizo). Las dependencias se pueden reemplazar en los tests (cliente de base, entorno, lectura de archivos y salida)
 * para probarlo sin conectarse a ninguna parte; los errores de uso y de destino (falta o no coincide el host) se lanzan, antes de crear el cliente.
 */
export async function principal(args = process.argv.slice(2), dependencias = {}) {
  const {
    entorno = process.env,
    leerArchivo = (ruta) => readFileSync(ruta, "utf8"),
    log = console.log,
    logError = console.error,
    tabla = console.table,
    crearCliente = async (config) => {
      const { default: pg } = await import("pg");
      return new pg.Client(config);
    },
  } = dependencias;
  const { archivoEnv, archivoSql, simular, hostEsperado, vars: pedidas } = leerArgumentos(args);
  const vars = {};
  for (const [nombre, deEntorno] of pedidas) {
    const valor = entorno[deEntorno];
    if (valor === undefined || valor === "") throw new Error(`la variable de entorno ${deEntorno} (para :'${nombre}') está vacía`);
    vars[nombre] = valor;
  }
  if (!archivoEnv || !archivoSql) throw new Error("uso: ejecutar-sql-de-psql.mjs <archivo.env> <script.sql> [--simular] [--host-esperado <host>] [--var nombre=VARIABLE_DE_ENTORNO]");

  const kv = Object.fromEntries(
    leerArchivo(archivoEnv).split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2")]),
  );
  if (!kv.DIRECT_URL) throw new Error(`${archivoEnv} no tiene DIRECT_URL (la conexión del dueño)`);
  const u = new URL(kv.DIRECT_URL);
  const host = u.hostname;
  verificarHostDeDestino(host, hostEsperado, simular);
  const necesitaSsl = ["require", "verify-ca", "verify-full"].includes(u.searchParams.get("sslmode") ?? "");
  const cliente = await crearCliente({
    host,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ssl: necesitaSsl ? { rejectUnauthorized: true } : undefined,
  });
  await cliente.connect();
  log(`${simular ? "SIMULACIÓN (ROLLBACK al final)" : "EJECUCIÓN REAL"} en ${host} como el dueño de la base.`);
  const escapar = { literal: (v) => cliente.escapeLiteral(v), identificador: (v) => cliente.escapeIdentifier(v) };
  let codigo = 0;
  try {
    await cliente.query("BEGIN");
    const n = await ejecutarScript(leerArchivo(archivoSql), cliente, vars, escapar, (sentencia, r) => {
      if (/^\s*SELECT\b/i.test(sentencia) && r.rows?.length) {
        log(`\n${sentencia.replace(/\s+/g, " ").slice(0, 110)}…`);
        tabla(r.rows);
      }
    });
    if (simular) {
      await cliente.query("ROLLBACK");
      log(`\nSimulación terminada: ${n} sentencias, TODO deshecho (ROLLBACK).`);
    } else {
      await cliente.query("COMMIT");
      log(`\nListo: ${n} sentencias aplicadas y confirmadas (COMMIT).`);
    }
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    logError(`\nFALLÓ y se deshizo todo (ROLLBACK): ${e instanceof Error ? e.message.replace(/PASSWORD\s+'[^']*'/gi, "PASSWORD '***'") : e}`);
    codigo = 1;
  } finally {
    await cliente.end();
  }
  return codigo;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await principal();
  } catch (e) {
    console.error(`\nNO SE EJECUTÓ NADA: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
