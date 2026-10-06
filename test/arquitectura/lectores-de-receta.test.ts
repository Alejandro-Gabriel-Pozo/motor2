import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 5 — molde de
 * `disponibilidad-en-un-solo-lugar.test.ts`), en DOS capas:
 *
 * 1. EMBUDO: elegir "la receta vigente" (la de mayor `version` de cada plato) o listar el historial de versiones pasa SOLO por
 *    `core/catalogo/recetas-vigentes.ts`. Ningún otro archivo de `src/` puede tocar el modelo `RecetaVersion` con una lectura
 *    (`recetaVersion.find*`/`groupBy`/`count`/`aggregate`), pedir sus versiones anidadas (`recetaVersiones: ...`), ordenar o agrupar por
 *    `version`, ni nombrarlo en SQL crudo. Antes cada lector decidía por su cuenta (un `findMany` ascendente + Map que pisa, un `findFirst`
 *    descendente, un `take: 1` anidado, un `groupBy _max`): cinco formas de la misma regla.
 *
 * 2. CLASIFICACIÓN: todo archivo que CONSUME el embudo, o lee `recetaIngrediente.find*` directo, tiene que estar en la lista explícita de
 *    abajo, clasificado `efectivo` (resuelve la receta EFECTIVA de una sucursal — la propia si la tiene habilitada, si no la central con
 *    `rendimientoEfectivo`: cantidad/merma DE LA SUCURSAL), `central` (lee SOLO la serie central: es el editor central, o solo mira la
 *    estructura — existe la receta, quién referencia qué — sin leer cantidad/merma) o `series` (lee las DOS series por separado, la central
 *    y la propia de una sucursal: el estado de la receta propia, que tiene que compararlas — nunca resuelve una receta efectiva). Un
 *    archivo nuevo que empiece a leer la receta y se olvide de pasar `sucursalId`/incluir `rendimientosLocales` reintroduciría en
 *    silencio el bug que motivó todo el plan (el botón "Usar este valor" escribiendo en la sucursal equivocada): este test lo obliga a
 *    declararse acá primero, con motivo.
 *
 * Los comentarios se descartan sobre el archivo ENTERO (no línea por línea: un `/* ... *\/` de varias líneas con código de ejemplo no
 * cuenta) y los patrones se buscan también a través de saltos de línea. A propósito NO se detecta el texto suelto `"RecetaVersion"`: es
 * legítimo como nombre de entidad en la auditoría (`core/permisos/auditoria.ts`, `guardar-version-de-receta.ts`).
 *
 * Verificado en las DOS direcciones, mismo criterio que `toda-accion-se-usa.test.ts`: un archivo listado que ya no consume el embudo ni
 * lee la receta (se refactorizó) también es una desincronización a corregir, y el embudo mismo tiene que seguir leyendo `RecetaVersion`.
 */
const SRC = join(__dirname, "../../src");
const EMBUDO = "core/catalogo/recetas-vigentes.ts";
const FACHADA = "core/catalogo/public.ts";

interface ArchivoClasificado {
  ruta: string;
  clase: "efectivo" | "central" | "series";
  motivo: string;
}

const ARCHIVOS_CLASIFICADOS: readonly ArchivoClasificado[] = [
  {
    ruta: "core/reportes/comun.ts",
    clase: "efectivo",
    motivo: "construirIndiceRecetas: la fuente única (R1) — efectivo cuando recibe sucursalId, central sin ella (quien solo usa la estructura).",
  },
  {
    ruta: "core/movimientos/registrar-venta.ts",
    clase: "efectivo",
    motivo: "C1: el consumo de receta al vender se resuelve con rendimientoEfectivo de la sucursal del actor.",
  },
  {
    ruta: "server/persistencia/movimientos/cargar-linea-de-movimiento.ts",
    clase: "efectivo",
    motivo:
      "cargarRecetaVigenteParaProducir (Task #41, M13a — antes en línea en calcularConsumosProduccion de movimientos.ts): trae las calibraciones locales (rendimientosLocales) DE LA SUCURSAL que produce; el caso de uso (armar-linea-de-movimiento.ts) resuelve rendimientoEfectivo con ellas — C2 (el consumo de receta al producir se resuelve con rendimientoEfectivo de ctx.sucursalId).",
  },
  {
    ruta: "core/reportes/rendimiento-recetas.ts",
    clase: "efectivo",
    motivo: "R2 (construirPools): cantidad/mermaPorcentaje de cada uso salen efectivos; el RÓTULO sigue usando los valores centrales a propósito.",
  },
  {
    ruta: "core/reportes/historial-producto.ts",
    clase: "efectivo",
    motivo: "R3 (obtenerIngredientesRecetaVigente): cantidad efectiva de la sucursal en el cartel de 'producto de reventa'.",
  },
  {
    ruta: "core/reportes/rendimiento-por-sucursal.ts",
    clase: "central",
    motivo:
      "D8 (compararRendimientosPorSucursal) + R3: compara el rendimiento (calibraciones por sucursal) sobre la estructura de la receta CENTRAL; donde una sucursal tiene receta PROPIA habilitada (cargarRecetasPropiasHabilitadas) no hay calibración que mostrar y la celda se marca como 'receta propia' en vez de mezclar series.",
  },
  {
    ruta: "server/actions/catalogo/recetas.ts",
    clase: "central",
    motivo: "El editor de la receta CENTRAL (obtenerRecetaVigente/listarVersionesDeReceta) — nunca resuelve por sucursal, es lo que se calibra contra. guardarReceta ya no lee la receta acá: delega en su caso de uso (Task #41, P1).",
  },
  {
    ruta: "server/persistencia/catalogo/guardar-version-de-receta.ts",
    clase: "series",
    motivo:
      "cargarUltimaVersionDeReceta (Task #41, P1) / cargarIdDeVersionCentralVigente (R3): la última versión de UNA serie —la central o la propia de una sucursal— para calcular MAX(version)+1 de ESA serie, y la central vigente en la que se basa una propia; el arrastre de D3 es solo de la central — lee las series por separado, nunca resuelve ningún efectivo.",
  },
  {
    ruta: "server/actions/catalogo/rendimiento-local.ts",
    clase: "central",
    motivo: "fijarRendimientoLocal/volverAlRendimientoCentral leen la línea (RecetaIngrediente) y la versión vigente para VALIDAR que la calibración apunte a la versión actual — no resuelven ningún rendimiento efectivo, escriben el override tal cual.",
  },
  {
    ruta: "server/consultas/catalogo/recetas.ts",
    clase: "central",
    motivo:
      "listarProductosConReceta (lista /catalogo/recetas, Task #41 D3 — antes vivía en la página): filtra que el producto TENGA alguna receta (whereConReceta) y trae la última versión con el CONTEO de ingredientes — no lee cantidad ni merma.",
  },
  {
    ruta: "core/catalogo/desactivar-producto.ts",
    clase: "efectivo",
    motivo:
      "Chequea si algún RecetaIngrediente referencia el producto a desactivar (dependencias): cuenta como referencia solo la versión VIGENTE de cada plato EN LA SUCURSAL del actor (la propia si la tiene habilitada, si no la central) — no resuelve ningún rendimiento.",
  },
  {
    ruta: "server/actions/catalogo/receta-sucursal.ts",
    clase: "central",
    motivo:
      "R3/R4: las acciones de la receta PROPIA de la sucursal activa. De la receta central solo lee la vigente para partir de ella (crear desde la central); el estado de la propia lo resuelve receta-propia-estado.ts (series) y la escritura el caso de uso — nunca resuelve una receta efectiva.",
  },
  {
    ruta: "core/catalogo/receta-propia-estado.ts",
    clase: "series",
    motivo:
      "R3/R4 (obtenerEstadoDeRecetaPropia): lee la serie PROPIA de la sucursal (alcanceDeSucursal) y la central vigente (ALCANCE_CENTRAL) por separado, para decidir 'habilitada' y 'la central cambió' — compara las series, no resuelve una efectiva.",
  },
] as const;

const RUTAS_CLASIFICADAS = new Set(ARCHIVOS_CLASIFICADOS.map((a) => a.ruta));

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/**
 * El archivo entero sin comentarios (`//` y `/* *\/`, de varias líneas también), conservando los saltos de línea y TODO lo que está
 * dentro de un string o una plantilla (el SQL crudo va en una plantilla y se tiene que ver). Un `/*` o un `//` dentro de un string
 * (`"src/**\/*.ts"`, `"https://…"`) no abre un comentario. Un string de comillas simples o dobles no cruza una línea.
 */
function sinComentarios(fuente: string): string {
  const s = fuente.replace(/\r\n/g, "\n");
  let salida = "";
  let modo: '"' | "'" | "`" | null = null;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const siguiente = s[i + 1];
    if (modo) {
      salida += c;
      if (c === "\\") {
        salida += siguiente ?? "";
        i += 2;
        continue;
      }
      if (c === modo || (c === "\n" && modo !== "`")) modo = null;
      i++;
      continue;
    }
    if (c === "/" && siguiente === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && siguiente === "*") {
      const fin = s.indexOf("*/", i + 2);
      const bloque = fin === -1 ? s.slice(i) : s.slice(i, fin + 2);
      salida += bloque.replace(/[^\n]/g, " ");
      i += bloque.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") modo = c;
    salida += c;
    i++;
  }
  return salida;
}

/** Las formas de leer, elegir o agrupar `RecetaVersion` que SOLO el embudo puede escribir. */
const PATRONES_DEL_EMBUDO: readonly RegExp[] = [
  /\brecetaVersion\s*\.\s*(find\w*|groupBy|count|aggregate)/,
  /\brecetaVersiones\s*:/,
  /\borderBy\s*:\s*\{\s*version\b/,
  /\b_max\s*:\s*\{\s*version\b/,
  /\b(FROM|JOIN)\s+"RecetaVersion"/i,
  /\[\s*["']recetaVersion["']\s*\]/,
];

/** true si el archivo elige/lee/agrupa `RecetaVersion` por su cuenta (fuera de un comentario, también a través de saltos de línea). */
function leeVersionesDeRecetaPorSuCuenta(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return PATRONES_DEL_EMBUDO.some((re) => re.test(limpia));
}

const USO_DEL_EMBUDO = /\b(cargarRecetasVigentes|cargarRecetaVigente|cargarHistorialDeVersiones|versionVigentePorProducto|incluirRecetaVigente|whereConReceta|quedarseConLaVigente)\b/;
const LECTURA_DE_INGREDIENTES = /\brecetaIngrediente\s*\.\s*find\w*/;

/** true si el archivo consume el embudo, o lee `RecetaIngrediente` directo: tiene que estar clasificado efectivo/central. */
function necesitaClasificacion(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return USO_DEL_EMBUDO.test(limpia) || LECTURA_DE_INGREDIENTES.test(limpia);
}

describe("lectores de receta: el embudo es el único que elige la versión vigente", () => {
  const rutas = archivosFuente(SRC).map((ruta) => ({ nombre: relative(SRC, ruta).split(sep).join("/"), ruta }));
  const fuentes = new Map(rutas.map(({ nombre, ruta }) => [nombre, readFileSync(ruta, "utf8")]));

  it("encuentra archivos de src/", () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it("ningún archivo fuera del embudo lee, ordena o agrupa RecetaVersion por su cuenta", () => {
    const sueltos = [...fuentes].filter(([nombre, fuente]) => nombre !== EMBUDO && leeVersionesDeRecetaPorSuCuenta(fuente)).map(([nombre]) => nombre);
    expect(
      sueltos,
      `Estos archivos eligen o leen versiones de receta sin pasar por core/catalogo/recetas-vigentes.ts (usá cargarRecetasVigentes / cargarRecetaVigente / cargarHistorialDeVersiones / versionVigentePorProducto / incluirRecetaVigente / whereConReceta):\n${sueltos.join("\n")}`
    ).toEqual([]);
  });

  it("el embudo existe y es el que lee RecetaVersion (el guardián no quedó apuntando a la nada)", () => {
    const fuente = fuentes.get(EMBUDO);
    expect(fuente, `${EMBUDO} no existe: actualizá EMBUDO`).toBeDefined();
    expect(leeVersionesDeRecetaPorSuCuenta(fuente!), `${EMBUDO} ya no lee RecetaVersion`).toBe(true);
  });
});

describe("lectores de receta: todo archivo que consume el embudo o lee RecetaIngrediente está clasificado efectivo/central", () => {
  const fuentes = new Map(archivosFuente(SRC).map((ruta) => [relative(SRC, ruta).split(sep).join("/"), readFileSync(ruta, "utf8")]));

  it("todo consumidor está en la lista, y ninguno de la lista dejó de serlo", () => {
    const encontrados = new Set([...fuentes].filter(([nombre, fuente]) => nombre !== EMBUDO && nombre !== FACHADA && necesitaClasificacion(fuente)).map(([nombre]) => nombre));

    const sinClasificar = [...encontrados].filter((n) => !RUTAS_CLASIFICADAS.has(n));
    expect(
      sinClasificar,
      `Estos archivos consumen el embudo de recetas o leen RecetaIngrediente directo pero no están en ARCHIVOS_CLASIFICADOS (clasificalos efectivo/central con motivo):\n${sinClasificar.join("\n")}`
    ).toEqual([]);

    const yaNoLeen = [...RUTAS_CLASIFICADAS].filter((n) => !encontrados.has(n));
    expect(yaNoLeen, `Estos ya no consumen el embudo ni leen RecetaIngrediente: sacalos de ARCHIVOS_CLASIFICADOS:\n${yaNoLeen.join("\n")}`).toEqual([]);
  });

  it("la fachada del dominio reexporta el embudo sin consumirlo (no entra en la clasificación)", () => {
    expect(fuentes.get(FACHADA)).toMatch(/recetas-vigentes/);
  });
});

/**
 * ALCANCE (ADR-009, R2): cada lector declara desde qué sucursal lee la receta. Un lector "efectivo" arma su alcance con
 * `alcanceDeSucursal(...)`; uno "central" usa `ALCANCE_CENTRAL`. Mezclarlos (un editor central que lee "como una sucursal", o un
 * reporte efectivo que se declara central) es justo el error que R3 volvería real cuando la receta pueda ser propia de una sucursal.
 * Devuelve el problema, o null si el archivo declara el alcance que le corresponde a su clase.
 */
function problemaDeAlcance(clase: ArchivoClasificado["clase"], fuente: string): string | null {
  const limpia = sinComentarios(fuente);
  const usaCentral = /\bALCANCE_CENTRAL\b/.test(limpia);
  const usaSucursal = /\balcanceDeSucursal\s*\(/.test(limpia);
  if (clase === "series") {
    if (!usaCentral || !usaSucursal) return "es series pero no declara las DOS series (ALCANCE_CENTRAL y alcanceDeSucursal)";
    return null;
  }
  if (clase === "central") {
    if (!usaCentral) return "es central pero no usa ALCANCE_CENTRAL";
    if (usaSucursal) return "es central pero arma un alcance de sucursal (alcanceDeSucursal)";
    return null;
  }
  if (!usaSucursal) return "es efectivo pero no arma su alcance con alcanceDeSucursal";
  if (usaCentral) return "es efectivo pero usa ALCANCE_CENTRAL";
  return null;
}

describe("lectores de receta: cada archivo declara el alcance que le corresponde a su clase", () => {
  const fuentes = new Map(archivosFuente(SRC).map((ruta) => [relative(SRC, ruta).split(sep).join("/"), readFileSync(ruta, "utf8")]));

  it("los efectivos usan alcanceDeSucursal, los centrales ALCANCE_CENTRAL y los de series las dos", () => {
    const problemas = ARCHIVOS_CLASIFICADOS.flatMap((a) => {
      const fuente = fuentes.get(a.ruta);
      const problema = fuente === undefined ? "no existe" : problemaDeAlcance(a.clase, fuente);
      return problema ? [`${a.ruta}: ${problema}`] : [];
    });
    expect(problemas, `Alcance de lectura de receta inconsistente con la clasificación:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("el detector (con fuentes sintéticas)", () => {
    expect(problemaDeAlcance("central", "cargarRecetaVigente(db, ALCANCE_CENTRAL, id, {})")).toBeNull();
    expect(problemaDeAlcance("efectivo", "cargarRecetaVigente(tx, alcanceDeSucursal(sucursalId), id, {})")).toBeNull();
    expect(problemaDeAlcance("central", "cargarRecetaVigente(db, alcanceDeSucursal(s), id, {})")).toMatch(/central pero/);
    expect(problemaDeAlcance("efectivo", "cargarRecetaVigente(db, ALCANCE_CENTRAL, id, {})")).toMatch(/efectivo pero/);
    expect(problemaDeAlcance("efectivo", "cargarRecetaVigente(db, alcanceDeSucursal(s), id, {}); x(ALCANCE_CENTRAL)")).toMatch(/usa ALCANCE_CENTRAL/);
    expect(problemaDeAlcance("central", "// ALCANCE_CENTRAL\nconst x = 1;")).toMatch(/no usa ALCANCE_CENTRAL/);
    expect(problemaDeAlcance("series", "cargarRecetaVigente(db, ALCANCE_CENTRAL, id, {}); cargarHistorialDeVersiones(db, alcanceDeSucursal(s), id, {})")).toBeNull();
    expect(problemaDeAlcance("series", "cargarRecetaVigente(db, ALCANCE_CENTRAL, id, {})")).toMatch(/DOS series/);
    expect(problemaDeAlcance("series", "cargarRecetaVigente(db, alcanceDeSucursal(s), id, {})")).toMatch(/DOS series/);
  });
});

describe("el detector del embudo (con fuentes sintéticas)", () => {
  it("marca cada forma de leer RecetaVersion por su cuenta", () => {
    expect(leeVersionesDeRecetaPorSuCuenta("const v = await tx.recetaVersion.findFirst({ where: { productoId } });")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("await db.recetaVersion.findMany({});")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("await db.recetaVersion.groupBy({ by: ['productoId'] });")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("await db.recetaVersion.count({});")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("await db.recetaVersion.aggregate({ _max: { version: true } });")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("where: { recetaVersiones: { some: {} } },")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("include: { recetaVersiones : { take: 1 } }")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("orderBy: { version: 'desc' },")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("const r = { _max: { version: true } };")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta('const x = db["recetaVersion"].findMany({});')).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta('const x = prisma["recetaVersion"];')).toBe(true);
  });

  it("marca una lectura partida en varias líneas", () => {
    expect(leeVersionesDeRecetaPorSuCuenta("await db.recetaVersion\n  .findMany({});")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("await db\n  .recetaVersion\n  .\n  groupBy({});")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("const q = {\n  orderBy:\n    {\n      version: 'asc',\n    },\n};")).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("const a = { _max:\n { version: true } };")).toBe(true);
  });

  it("marca SQL crudo sobre la tabla de versiones, en una plantilla de varias líneas", () => {
    expect(leeVersionesDeRecetaPorSuCuenta('await db.$queryRaw`SELECT MAX(version) FROM "RecetaVersion" WHERE "productoId" = ${id}`;')).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta('await db.$queryRaw`\n  SELECT *\n  FROM\n  "RecetaVersion" rv\n`;')).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta('await db.$queryRaw`SELECT 1 FROM "Producto" p JOIN "RecetaVersion" rv ON rv."productoId" = p.id`;')).toBe(true);
  });

  it("un comentario que hable del código no cuenta, tampoco uno de varias líneas", () => {
    expect(leeVersionesDeRecetaPorSuCuenta("// ver recetaVersion.findMany en otro lado")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("/** 3 `recetaVersion.findMany` por reporte */")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("/**\n * Antes:\n *   await db.recetaVersion.groupBy({ _max: { version: true } });\n *   where: { recetaVersiones: { some: {} } }\n */\nexport const x = 1;")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("/* orderBy: { version: 'desc' } */ const y = 2;")).toBe(false);
  });

  it("un comentario no tapa el código que está en la misma línea después de un string con barras", () => {
    expect(leeVersionesDeRecetaPorSuCuenta('const g = "src/**/*.ts"; await db.recetaVersion.findMany({});')).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta('const u = "https://ejemplo.com"; await tx.recetaVersion.findFirst({});')).toBe(true);
    expect(leeVersionesDeRecetaPorSuCuenta("const m = `a//b`;\nawait db.recetaVersion.count({});")).toBe(true);
  });

  it("no marca lo que NO es una lectura: el nombre suelto de la entidad, escrituras, ni la relación de una línea", () => {
    expect(leeVersionesDeRecetaPorSuCuenta('const entidad = "RecetaVersion";')).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta('registrarCambioAuditado(tx, { entidad: "RecetaVersion", id });')).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("await tx.recetaVersion.create({ data: {} });")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("const p = ing.recetaVersion.productoId;")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("const productos = await db.producto.findMany({});")).toBe(false);
    expect(leeVersionesDeRecetaPorSuCuenta("orderBy: { nombre: 'asc' },")).toBe(false);
  });
});

describe("el detector de consumidores (con fuentes sintéticas)", () => {
  it("marca el uso de cualquier función del embudo y la lectura directa de recetaIngrediente", () => {
    expect(necesitaClasificacion("const v = await cargarRecetaVigente(db, id, { include: {} });")).toBe(true);
    expect(necesitaClasificacion("const m = await cargarRecetasVigentes(db, { include });")).toBe(true);
    expect(necesitaClasificacion("const h = await cargarHistorialDeVersiones(db, id, inc);")).toBe(true);
    expect(necesitaClasificacion("const n = await versionVigentePorProducto(db, ids);")).toBe(true);
    expect(necesitaClasificacion("include: incluirRecetaVigente({ ingredientes: true })")).toBe(true);
    expect(necesitaClasificacion("where: { ...whereConReceta() }")).toBe(true);
    expect(necesitaClasificacion("const usos = await db.recetaIngrediente.findMany({ where: { insumoProductoId } });")).toBe(true);
    expect(necesitaClasificacion("await db.recetaIngrediente\n  .findFirst({});")).toBe(true);
  });

  it("no marca un comentario, una función de otro nombre ni una escritura", () => {
    expect(necesitaClasificacion("// antes: cargarRecetaVigente(db, id)")).toBe(false);
    expect(necesitaClasificacion("/**\n * usa whereConReceta\n */\nexport const z = 1;")).toBe(false);
    expect(necesitaClasificacion("const l = await cargarRecetaVigenteParaProducir(tx, args);")).toBe(false);
    expect(necesitaClasificacion("const i = await obtenerIngredientesRecetaVigente(id, db);")).toBe(false);
    expect(necesitaClasificacion("await tx.recetaIngrediente.create({ data: {} });")).toBe(false);
  });
});

describe("sinComentarios", () => {
  it("saca los comentarios, conserva los saltos de línea y lo que está dentro de strings y plantillas", () => {
    expect(sinComentarios("a // x\nb")).toBe("a \nb");
    expect(sinComentarios("a /* x\n y */ b")).toBe("a     \n      b");
    expect(sinComentarios('const s = "// no es comentario";')).toBe('const s = "// no es comentario";');
    expect(sinComentarios("const t = `/* tampoco */`;")).toBe("const t = `/* tampoco */`;");
  });

  it("un apóstrofe suelto no se traga el resto del archivo: el string simple termina con la línea", () => {
    expect(sinComentarios("// no es comentario real: it's\nx // y")).toBe("\nx ");
    expect(sinComentarios("<p>don't</p>\n// chau\nx")).toBe("<p>don't</p>\n\nx");
  });
});
