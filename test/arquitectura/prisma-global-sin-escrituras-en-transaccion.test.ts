import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (Task #41, backlog post-cierre 2026-09-28, docs/pendientes-sesion-2026-09-27.md §2): un caso de uso que abre
 * `conTransaccionSerializable(async (tx) => { ... })` y, DENTRO de ese callback, escribe con el cliente GLOBAL `prisma` en vez de `tx`
 * queda fuera de la transacción SERIALIZABLE — esa escritura no participa del aislamiento ni del rollback si el resto falla, y
 * `conReintento` la ejecutaría de nuevo en cada reintento (efecto secundario duplicado, no solo una escritura sin aislar).
 *
 * A propósito NO prohíbe todo uso de `prisma` en un archivo que también usa `conTransaccionSerializable` — eso rompería el patrón
 * establecido de leer con el cliente global ANTES de abrir la transacción (`cargarUltimaVersionDeReceta(prisma, ...)` en
 * guardar-version-de-receta.ts, `prisma.mesa.findFirst(...)` en cuenta-apertura.ts, los `Promise.all([prisma.rol.findMany(...), ...])`
 * de permisos.ts) — todos intencionales, documentados en su propio docstring como "fuera de la transacción, cliente global". Tampoco
 * prohíbe LECTURAS con `prisma` dentro del callback (no es lo que rompe el aislamiento de una escritura) ni el cliente `tx` mismo.
 * Alcance a propósito acotado a ESCRITURAS (`create`/`update`/`upsert`/`delete`/sus variantes `Many`/`$executeRaw*`/`$transaction`)
 * llamadas sobre `prisma.` (no `tx.`) dentro del cuerpo `{ ... }` del callback — el precedente exacto que confirmó el usuario: "conviene
 * empezar con una regla estricta para prisma global [de escritura] y luego ampliar la propagación de tx" si hiciera falta después.
 *
 * DESCUBRE (no una lista a mano) todo archivo de `src/` que importa `{ prisma }` de `@/lib/db` Y llama `conTransaccionSerializable(` —
 * mismo esquema fail-closed que `idempotencia-i3-cobertura-concurrente.test.ts`: un archivo nuevo con este patrón queda cubierto solo
 * por existir, sin que nadie tenga que acordarse de agregarlo a una lista.
 */
const SRC = join(__dirname, "../../src");

/**
 * Excepciones con motivo — hoy vacía: los 4 archivos descubiertos (registrar-movimiento.ts, guardar-version-de-receta.ts,
 * cuenta-apertura.ts, permisos.ts) ya usan `prisma` global solo para lecturas antes/fuera de cada `conTransaccionSerializable`, nunca
 * para escribir dentro del callback.
 */
const EXCEPCIONES: Record<string, string> = {};

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function rutaRelativa(base: string, ruta: string): string {
  return relative(base, ruta).split(sep).join("/");
}

/** Saca comentarios de bloque y de línea antes de buscar patrones — mismo motivo que idempotencia-i3-cobertura-concurrente.test.ts: sin
 * esto, un docstring que mencione en prosa "prisma.cuenta.create" como ejemplo se autodetectaría como violación. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const RE_METODO_ESCRITURA = /\bprisma\.\w+\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/g;
const RE_RAW_O_TX_ANIDADA = /\bprisma\.(\$executeRaw\w*|\$transaction)\s*[(`]/g;

/**
 * Ubica, desde `desde` (el índice de un `conTransaccionSerializable(`), el cuerpo `{ ... }` del callback que le sigue — el primer
 * bloque después de la flecha `=>` más próxima. Cierra la llave contando profundidad, saltando el contenido de strings/template
 * literals como un bloque opaco (no le importa lo que haya adentro, solo encontrar la comilla/backtick de cierre sin escapar) — mismo
 * criterio "heurística simple, suficientemente buena" que el resto de los tests de arquitectura de este proyecto: no parsea JS de
 * verdad, pero alcanza para el estilo de este código (sin templates anidados).
 */
function cuerpoDelCallback(fuente: string, desde: string, desdeIndice: number): { inicio: number; fin: number } | null {
  const flecha = fuente.indexOf("=>", desdeIndice);
  if (flecha === -1) return null;
  let i = flecha + 2;
  while (i < fuente.length && /\s/.test(fuente[i])) i++;
  if (fuente[i] !== "{") return null; // cuerpo de expresión (sin bloque) — no se da en este proyecto, se ignora sin romper.

  let profundidad = 0;
  let enString: string | null = null;
  for (let j = i; j < fuente.length; j++) {
    const ch = fuente[j];
    if (enString) {
      if (ch === "\\") { j++; continue; }
      if (ch === enString) enString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { enString = ch; continue; }
    if (ch === "{") profundidad++;
    else if (ch === "}") {
      profundidad--;
      if (profundidad === 0) return { inicio: i, fin: j };
    }
  }
  return null;
}

interface Violacion {
  ruta: string;
  fragmento: string;
}

interface ArchivoConTransaccionYPrismaGlobal {
  ruta: string;
  violaciones: Violacion[];
}

/** Descubre TODO archivo que importa `{ prisma }` de `@/lib/db` y llama `conTransaccionSerializable(` — nunca una lista a mano. */
function descubrirArchivos(): ArchivoConTransaccionYPrismaGlobal[] {
  const archivos = archivosFuente(SRC);
  const resultado: ArchivoConTransaccionYPrismaGlobal[] = [];

  for (const archivo of archivos) {
    const original = readFileSync(archivo, "utf8");
    if (!/from\s+["']@\/lib\/db["']/.test(original) || !/\bconTransaccionSerializable\s*\(/.test(original)) continue;

    const fuente = sinComentarios(original);
    const violaciones: Violacion[] = [];

    for (const m of fuente.matchAll(/\bconTransaccionSerializable\s*\(/g)) {
      const cuerpo = cuerpoDelCallback(fuente, "conTransaccionSerializable(", m.index! + m[0].length);
      if (!cuerpo) continue;
      const texto = fuente.slice(cuerpo.inicio, cuerpo.fin + 1);

      for (const re of [RE_METODO_ESCRITURA, RE_RAW_O_TX_ANIDADA]) {
        for (const hallazgo of texto.matchAll(re)) {
          violaciones.push({ ruta: rutaRelativa(SRC, archivo), fragmento: hallazgo[0] });
        }
      }
    }

    resultado.push({ ruta: rutaRelativa(SRC, archivo), violaciones });
  }

  return resultado;
}

describe("arquitectura: dentro de un callback conTransaccionSerializable, ninguna escritura usa el cliente global `prisma` (tiene que ser `tx`)", () => {
  const archivos = descubrirArchivos();

  it("encuentra archivos que combinan `prisma` global y `conTransaccionSerializable` (si esto da 0, algo rompió el descubrimiento, no que ya no haya ninguno)", () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  it("ningún callback de conTransaccionSerializable escribe con el cliente global `prisma`, salvo excepción documentada en EXCEPCIONES", () => {
    const sinExcepcion = archivos.filter((a) => a.violaciones.length > 0 && !(a.ruta in EXCEPCIONES));

    expect(
      sinExcepcion,
      `Escritura(s) con el cliente global \`prisma\` DENTRO de un callback de \`conTransaccionSerializable\` — usá \`tx\` en su lugar, ` +
        `o documentá la excepción en EXCEPCIONES con motivo:\n` +
        sinExcepcion.map((a) => `  - ${a.ruta}: ${a.violaciones.map((v) => v.fragmento).join(", ")}`).join("\n")
    ).toEqual([]);
  });

  it("EXCEPCIONES no tiene entradas obsoletas (un archivo que ya no existe, o que ya no tiene ninguna violación)", () => {
    for (const ruta of Object.keys(EXCEPCIONES)) {
      const archivo = archivos.find((a) => a.ruta === ruta);
      expect(archivo, `${ruta} está en EXCEPCIONES pero ya no se descubre como archivo con \`prisma\` global + \`conTransaccionSerializable\` — sacala de la lista.`).toBeDefined();
      if (archivo) {
        expect(archivo.violaciones.length, `${ruta} está en EXCEPCIONES pero ya no tiene ninguna escritura con \`prisma\` global dentro de un callback — sacala de la lista, el hueco ya se cerró.`).toBeGreaterThan(0);
      }
    }
  });
});
