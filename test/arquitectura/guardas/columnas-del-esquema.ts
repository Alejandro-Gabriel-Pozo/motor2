/**
 * Lector de COLUMNAS de `prisma/schema.prisma` con su comentario `///`, para el guardián de columnas de significado (E2 del arnés de matrices,
 * `docs/diseno-arnes-de-matrices-2026-11-03.md`). Distinto de `modelosDelSchema` (lectores-de-campos.ts) a propósito: acá importan el comentario de documentación
 * de cada columna (donde el esquema anota los CHECK que Prisma no modela) y si la columna es opcional. Recibe el TEXTO del esquema (se prueba con LF y con CRLF).
 */

export interface ColumnaDelEsquema {
  modelo: string;
  columna: string;
  /** Tipo escalar o enum tal cual está escrito (`Boolean`, `DateTime`, `Decimal`, `EstadoTraspaso`, …) o el nombre de otro modelo si es una relación. */
  tipo: string;
  opcional: boolean;
  lista: boolean;
  /** El bloque `///` inmediatamente anterior más el comentario `//` o `///` de la misma línea, unido con espacios. Vacío si no hay. */
  comentario: string;
  /** El tipo es un `enum` del esquema. */
  esEnum: boolean;
  /** El tipo es otro modelo (relación): no es una columna de la tabla. */
  esRelacion: boolean;
}

export function columnasDelEsquema(esquema: string): ColumnaDelEsquema[] {
  const texto = esquema.replace(/\r\n/g, "\n");
  const modelos = [...texto.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const nombresDeModelos = new Set(modelos.map((m) => m[1]!));
  const enums = new Set([...texto.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]!));
  const salida: ColumnaDelEsquema[] = [];
  for (const [, modelo, cuerpo] of modelos) {
    let bloque: string[] = [];
    for (const linea of cuerpo!.split("\n")) {
      const recortada = linea.trim();
      if (recortada.startsWith("///")) {
        bloque.push(recortada.slice(3).trim());
        continue;
      }
      if (recortada === "" || recortada.startsWith("//") || recortada.startsWith("@@")) {
        // Una línea en blanco, un comentario `//` común o un `@@` corta el bloque de documentación (no es de la columna que sigue).
        bloque = [];
        continue;
      }
      const m = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(recortada);
      if (!m) {
        bloque = [];
        continue;
      }
      const [, columna, tipo, lista, opcional, resto] = m;
      const enLinea = /\/\/\/?(.*)$/.exec(resto!)?.[1]?.trim() ?? "";
      salida.push({
        modelo: modelo!,
        columna: columna!,
        tipo: tipo!,
        opcional: opcional !== undefined,
        lista: lista !== undefined,
        comentario: [...bloque, enLinea].filter((s) => s !== "").join(" "),
        esEnum: enums.has(tipo!),
        esRelacion: nombresDeModelos.has(tipo!),
      });
      bloque = [];
    }
  }
  return salida;
}

/** Las columnas de auditoría TÉCNICA (cuándo se creó o se tocó la fila): no cambian dinero, visibilidad ni stock. Las demás fechas (`anuladaEn`, `cerradaEn`, `vigenteHasta`…) sí pueden. */
const FECHAS_DE_AUDITORIA_TECNICA: ReadonlySet<string> = new Set(["creadoEn", "creadaEn", "actualizadoEn"]);

/**
 * ¿Es una «columna de significado»? Las que pueden cambiar QUÉ se cobra, QUÉ se ve o CUÁNTO stock hay sin ser un `Decimal` (los `Decimal` los cubre `escrituras-auditadas`):
 *  - `Boolean`: un interruptor (activo, habilitado, soloSalon…).
 *  - `DateTime` que no es de auditoría técnica: un instante que decide un estado o una vigencia (anuladaEn, cerradaEn, vigenteDesde…).
 *  - tipo `enum` de Prisma: una clase o un estado (proceso, estado de un traspaso…).
 *  - cualquier columna cuyo comentario `///` menciona `CHECK`: Prisma no modela los CHECK, así que el esquema los anota a mano (límite: un CHECK que solo vive en la
 *    migración y no está anotado en el comentario de su columna no se ve; ver el diseño, etapa E2).
 * Se excluyen las relaciones y las listas (no son columnas de la tabla).
 */
export function esColumnaDeSignificado(c: ColumnaDelEsquema): boolean {
  if (c.esRelacion || c.lista) return false;
  if (c.tipo === "Boolean" || c.esEnum) return true;
  if (c.tipo === "DateTime" && !FECHAS_DE_AUDITORIA_TECNICA.has(c.columna)) return true;
  return /\bCHECK\b/.test(c.comentario);
}
