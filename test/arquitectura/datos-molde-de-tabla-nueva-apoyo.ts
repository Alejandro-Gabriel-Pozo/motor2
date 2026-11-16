/**
 * APOYO DEL GUARDIÁN «MOLDE DE TABLA NUEVA» (frente 3, etapa E-0; docs/diseno-datos-paridad-pedernal-2026-11-16.md §4).
 *
 * Qué mira: las migraciones de `prisma/migrations` desde `PRIMERA_MIGRACION_CON_MOLDE` en adelante. Toda tabla que una de ellas CREA tiene que cumplir tres reglas, que son la forma de
 * Pedernal (ADR-012) y la regla del dueño «También las viejas» / «Sí, copiar a Pedernal en esas cinco» (2026-11-15 y 2026-11-16, `motor2-docs`, seguimiento-de-pedernal):
 *  - ID_UUID: la columna `id` existe y es `UUID` (el id lo manda la aplicación con `azar.uuid()`; decisión del orquestador general 2026-11-16: `@db.Uuid` nativo, como `Parte`).
 *  - INSTANTE_CON_ZONA: ninguna columna es `TIMESTAMP` sin zona; los instantes son `TIMESTAMPTZ`.
 *  - SIN_DELETE: alguna migración del conjunto hace `REVOKE` de `ALL` o de `DELETE` sobre la tabla a `motor2_app` (el script del rol da `DELETE` por defecto a toda tabla nueva) y ninguna
 *    migración da `DELETE`, `TRUNCATE` ni `ALL` sobre ella a nadie, ni hace un `GRANT` masivo `ON ALL TABLES`.
 *
 * LÍMITES (una alarma para errores honestos, no un límite de seguridad):
 *  - Lee el TEXTO de las migraciones: no ejecuta SQL ni mira una base viva (los privilegios reales de producción siguen NO VERIFICADOS).
 *  - Un `GRANT` armado con SQL dinámico (`EXECUTE format(...)`) o con `FOREACH` sobre una lista de tablas no se ve.
 *  - No exige `version`, historial que solo agrega, clave de reintento ni función de texto en la base: son parte del molde del diseño pero dependen de qué hace la tabla; las revisa quien
 *    revisa el diseño de la etapa.
 *  - Un `CREATE TABLE` escrito con un nombre sin comillas se normaliza a como figura (Prisma siempre usa comillas).
 *  - No mira `schema.prisma`: la migración es la verdad de la base.
 *
 * Una tabla que no cumple y tiene motivo escrito va en `EXCEPCIONES` (con la regla y el motivo); una excepción que ya no hace falta hace fallar la prueba, para que la lista solo baje.
 */

export const PRIMERA_MIGRACION_CON_MOLDE = "20261115000000";

export type Regla = "ID_UUID" | "INSTANTE_CON_ZONA" | "SIN_DELETE";

export type Violacion = { tabla: string; regla: Regla; detalle: string };

export type Migracion = { carpeta: string; sql: string };

export type Excepcion = { tabla: string; regla: Regla; motivo: string };

export const EXCEPCIONES: readonly Excepcion[] = [
  {
    tabla: "OcultamientoProducto",
    regla: "ID_UUID",
    motivo:
      "Su id es TEXT con CHECK de forma uuid (migración 20261115120000). Decisión técnica del orquestador general (2026-11-16, motor2-docs «Fase 1 de los frentes»): se alinea a @db.Uuid antes de aplicarse a ninguna base real; sale de esta lista en ese cambio.",
  },
];

/** Saca los comentarios de línea (`--`) y los de bloque, respetando las comillas simples (un `--` dentro de un literal no es comentario). */
export function sinComentarios(sql: string): string {
  let salida = "";
  let i = 0;
  let enLiteral = false;
  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];
    if (enLiteral) {
      salida += c;
      if (c === "'") {
        if (d === "'") {
          salida += d;
          i += 2;
          continue;
        }
        enLiteral = false;
      }
      i++;
      continue;
    }
    if (c === "'") {
      enLiteral = true;
      salida += c;
      i++;
      continue;
    }
    if (c === "-" && d === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const fin = sql.indexOf("*/", i + 2);
      i = fin === -1 ? sql.length : fin + 2;
      continue;
    }
    salida += c;
    i++;
  }
  return salida;
}

export type Columna = { nombre: string; tipo: string };
export type TablaCreada = { nombre: string; columnas: Columna[]; migracion: string };

/** Parte `texto` en las comas de nivel superior (fuera de paréntesis y de literales). */
function partirPorComas(texto: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let enLiteral = false;
  let actual = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enLiteral) {
      actual += c;
      if (c === "'") {
        if (texto[i + 1] === "'") {
          actual += "'";
          i++;
        } else enLiteral = false;
      }
      continue;
    }
    if (c === "'") {
      enLiteral = true;
      actual += c;
    } else if (c === "(") {
      nivel++;
      actual += c;
    } else if (c === ")") {
      nivel--;
      actual += c;
    } else if (c === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  if (actual.trim() !== "") partes.push(actual);
  return partes;
}

const INICIO_DE_RESTRICCION = /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b/i;
const COLUMNA = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+([A-Za-z]+(?:\s+(?:WITH|WITHOUT)\s+TIME\s+ZONE)?(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/i;

/** El cuerpo entre paréntesis que empieza en `desde` (el índice del `(`): devuelve el texto de adentro, o null si no cierra. */
function cuerpoEntreParentesis(sql: string, desde: number): string | null {
  let nivel = 0;
  let enLiteral = false;
  for (let i = desde; i < sql.length; i++) {
    const c = sql[i];
    if (enLiteral) {
      if (c === "'") {
        if (sql[i + 1] === "'") i++;
        else enLiteral = false;
      }
      continue;
    }
    if (c === "'") enLiteral = true;
    else if (c === "(") nivel++;
    else if (c === ")") {
      nivel--;
      if (nivel === 0) return sql.slice(desde + 1, i);
    }
  }
  return null;
}

/** Las tablas que crea el SQL (ya sin comentarios), con el nombre y el tipo de cada columna. */
export function tablasCreadas(sql: string, migracion: string): TablaCreada[] {
  const limpio = sinComentarios(sql);
  const tablas: TablaCreada[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;
  for (const m of limpio.matchAll(re)) {
    const abre = (m.index ?? 0) + m[0].length - 1;
    const cuerpo = cuerpoEntreParentesis(limpio, abre);
    if (cuerpo === null) continue;
    const columnas: Columna[] = [];
    for (const parte of partirPorComas(cuerpo)) {
      const t = parte.trim();
      if (t === "" || INICIO_DE_RESTRICCION.test(t)) continue;
      const c = COLUMNA.exec(t);
      if (c) columnas.push({ nombre: c[1], tipo: c[2].replace(/\s+/g, " ").toUpperCase() });
    }
    tablas.push({ nombre: m[1], columnas, migracion });
  }
  return tablas;
}

/** Los nombres de tabla de una lista `"A", "B"` o `public."A"`. */
function nombresDeTablas(lista: string): string[] {
  return [...lista.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]);
}

export type Privilegios = {
  /** Tablas con un `REVOKE` de ALL o DELETE a `motor2_app`. */
  revocadas: Set<string>;
  /** Tablas a las que algún `GRANT` da DELETE, TRUNCATE o ALL a quien sea. */
  conBorradoDado: Set<string>;
  /** ¿Algún `GRANT ... ON ALL TABLES`? */
  masivo: boolean;
};

/** Lee los `GRANT` y `REVOKE` de una migración (sin comentarios). */
export function privilegiosDe(sql: string): Privilegios {
  const limpio = sinComentarios(sql);
  const revocadas = new Set<string>();
  const conBorradoDado = new Set<string>();
  let masivo = false;
  for (const m of limpio.matchAll(/REVOKE\s+([^;]*?)\s+ON\s+([^;]*?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const privilegios = m[1].toUpperCase();
    const esDeLaApp = m[3].toLowerCase() === "motor2_app";
    if (esDeLaApp && /\b(?:ALL|DELETE)\b/.test(privilegios) && !/\(/.test(privilegios)) for (const t of nombresDeTablas(m[2])) revocadas.add(t);
  }
  for (const m of limpio.matchAll(/GRANT\s+([^;]*?)\s+ON\s+([^;]*?)\s+TO\s+[A-Za-z_"]/gi)) {
    const privilegios = m[1].toUpperCase();
    const objetos = m[2].toUpperCase();
    if (/\bALL\s+TABLES\b/.test(objetos)) {
      masivo = true;
      continue;
    }
    if (/\b(?:DELETE|TRUNCATE|ALL)\b/.test(privilegios)) for (const t of nombresDeTablas(m[2])) conBorradoDado.add(t);
  }
  return { revocadas, conBorradoDado, masivo };
}

const ES_TIMESTAMP = /^TIMESTAMP\b/;
const ES_TIMESTAMP_CON_ZONA = /^TIMESTAMPTZ\b|^TIMESTAMP\s+WITH\s+TIME\s+ZONE\b/;

/** Las carpetas que entran en el control: las posteriores o iguales al corte, en orden. */
export function migracionesConMolde(todas: readonly Migracion[], corte: string = PRIMERA_MIGRACION_CON_MOLDE): Migracion[] {
  return todas.filter((m) => m.carpeta >= corte).sort((a, b) => (a.carpeta < b.carpeta ? -1 : a.carpeta > b.carpeta ? 1 : 0));
}

/** Todas las violaciones del molde, sin aplicar excepciones. */
export function violacionesDeMolde(migraciones: readonly Migracion[]): Violacion[] {
  const violaciones: Violacion[] = [];
  const revocadas = new Set<string>();
  const conBorradoDado = new Set<string>();
  let masivo: string | null = null;
  for (const m of migraciones) {
    const p = privilegiosDe(m.sql);
    for (const t of p.revocadas) revocadas.add(t);
    for (const t of p.conBorradoDado) conBorradoDado.add(t);
    if (p.masivo && masivo === null) masivo = m.carpeta;
  }
  for (const m of migraciones) {
    for (const tabla of tablasCreadas(m.sql, m.carpeta)) {
      const id = tabla.columnas.find((c) => c.nombre === "id");
      if (!id) violaciones.push({ tabla: tabla.nombre, regla: "ID_UUID", detalle: `${m.carpeta}: no tiene columna id` });
      else if (id.tipo !== "UUID") violaciones.push({ tabla: tabla.nombre, regla: "ID_UUID", detalle: `${m.carpeta}: id es ${id.tipo}, tiene que ser UUID` });
      for (const c of tabla.columnas) {
        if (ES_TIMESTAMP.test(c.tipo) && !ES_TIMESTAMP_CON_ZONA.test(c.tipo)) {
          violaciones.push({ tabla: tabla.nombre, regla: "INSTANTE_CON_ZONA", detalle: `${m.carpeta}: ${c.nombre} es ${c.tipo}, tiene que ser TIMESTAMPTZ` });
        }
      }
      if (!revocadas.has(tabla.nombre)) {
        violaciones.push({ tabla: tabla.nombre, regla: "SIN_DELETE", detalle: `${m.carpeta}: falta REVOKE ALL (o DELETE) sobre la tabla a motor2_app` });
      }
      if (conBorradoDado.has(tabla.nombre)) {
        violaciones.push({ tabla: tabla.nombre, regla: "SIN_DELETE", detalle: `${m.carpeta}: algún GRANT le da DELETE, TRUNCATE o ALL` });
      }
      if (masivo !== null) {
        violaciones.push({ tabla: tabla.nombre, regla: "SIN_DELETE", detalle: `${masivo}: un GRANT ON ALL TABLES le da DELETE a todo` });
      }
    }
  }
  return violaciones;
}

export type ResultadoDelMolde = {
  /** Violaciones que no tienen excepción: hacen fallar la prueba. */
  sinExcepcion: Violacion[];
  /** Excepciones sin motivo o que ya no hacen falta (o de una tabla que no existe): hacen fallar la prueba. */
  excepcionesInvalidas: string[];
};

export function aplicarExcepciones(violaciones: readonly Violacion[], excepciones: readonly Excepcion[]): ResultadoDelMolde {
  const claves = new Set(excepciones.map((e) => `${e.tabla}|${e.regla}`));
  const sinExcepcion = violaciones.filter((v) => !claves.has(`${v.tabla}|${v.regla}`));
  const excepcionesInvalidas: string[] = [];
  for (const e of excepciones) {
    if (e.motivo.trim().length < 40) excepcionesInvalidas.push(`${e.tabla} (${e.regla}): el motivo es demasiado corto`);
    if (!violaciones.some((v) => v.tabla === e.tabla && v.regla === e.regla)) {
      excepcionesInvalidas.push(`${e.tabla} (${e.regla}): ya no viola esa regla (o la tabla no existe); sacala de EXCEPCIONES`);
    }
  }
  return { sinExcepcion, excepcionesInvalidas };
}
