import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCIONES, type AccionClave } from "../../src/core/permisos/acciones";
import { envoltoriosDe } from "./guardas/envoltorio-y-clave";
import { funcionDeInicializador } from "./guardas/analizador";

/**
 * GT-4, SEGUNDA MITAD (plan de endurecimiento de seguridad, tanda T6; fila O.59 de `docs/pureza-integracion.md`; decisión D1 del dueño): **toda Server Action de contexto EMPRESA que termina
 * escribiendo una fila de una sucursal declara la sucursal y su clave**. La RLS separa empresas, no sucursales, y el gate de una clave de empresa aprueba si CUALQUIER membresía de la
 * empresa la tiene: una acción así que escribe en la sucursal ACTIVA (o en la del id que le llega) le abre esa sucursal a quien solo tiene la clave en OTRA. Fue exactamente S-10: géneros,
 * contenido e ítems agrupados de la carta, declarados «de empresa» y escribiendo en la carta de la sucursal activa; y el alta de una promo, que dejaba PRENDIDA la fila de la sucursal activa
 * sin mirar `carta_promo_activar`. Lo que el defecto repetiría mañana con otra clave, este guardián lo hace aparecer: hay que decidir, y dejar escrito, a qué se ata la escritura.
 *
 * Cómo lo encuentra (por AST, sin base; fuera de los comentarios):
 *  1. Las ESCRITURAS CON SUCURSAL de `src/server/persistencia/`: toda llamada `<x>.<modelo>.<create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany>` cuyo modelo tiene
 *     un campo `sucursalId` en `prisma/schema.prisma` (se lee del schema: un modelo nuevo con `sucursalId` entra solo), o cuyos argumentos mencionan `sucursalId` (una escritura anidada, como la
 *     `PromoCartaSucursal` que crea `promoCarta.create({ data: { sucursales: { create: { sucursalId } } } })`). Una función de persistencia hereda las de las funciones del mismo archivo que llama.
 *  2. Las PUERTAS DE EMPRESA: las funciones exportadas de `src/server/actions/**` (sin `casos-de-uso/`) cuya primera sentencia es `return conPermisoDeEmpresa(…)` o `conEdicionDePermisos(…)`.
 *  3. De cada puerta se sigue lo que llama (los nombres importados de otros archivos de `src/server/actions` y de `src/server/persistencia`, y las funciones del mismo archivo) hasta llegar a
 *     una función de persistencia con escrituras con sucursal. El ARCHIVO que la importa (el caso de uso, o la acción misma si escribe directo) es la unidad que se declara.
 *
 * Cada archivo hallado figura en la lista cerrada `DECLARADAS` (`archivo desde src/server/actions` → forma de atarlo, puertas que llegan y motivo), verificada en las DOS direcciones: una
 * escritura nueva sin declarar falla, una puerta nueva que llega a un archivo ya declarado falla, y una declaración que ya no corresponde a nada falla. Formas, cada una con su evidencia:
 *  - `CLAVE_DE_SUCURSAL`: el archivo lee, con `requierePermiso(…, "<clave>", …)`, una clave de contexto SUCURSAL en la sucursal donde escribe (la sucursal activa) y decide con ella.
 *  - `EMPRESA_ENTERA`: la fila de sucursal es parte de un objeto de la empresa entera (el mapa del portal, las capacidades por sucursal, la alta de una sucursal, una semilla para todas): la
 *    autoridad es la clave de empresa y escribir ahí es el propósito de la acción. No hay evidencia en el código más que el motivo y las puertas declaradas, así que cada una es una decisión
 *    a la vista en la revisión: la lista de puertas hace que una acción nueva que llega a ese archivo vuelva a pasar por acá.
 *
 * Mutaciones (rojo → revertido editando → verde): volver `guardarGeneroCarta` a `conPermisoDeEmpresa` (su caso de uso escribe `GeneroCarta` y aparece sin declarar), sacar el
 * `requierePermiso("carta_promo_activar")` del alta de la promo (la evidencia de `CLAVE_DE_SUCURSAL` desaparece) y los casos sintéticos del propio guardián (abajo).
 */
const RAIZ = join(__dirname, "../..");
const ESCRITURAS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const ENVOLTORIOS_DE_EMPRESA = new Set(["conPermisoDeEmpresa", "conEdicionDePermisos"]);
const ZONA_DE_ACCIONES = "src/server/actions/";
const ZONA_DE_PERSISTENCIA = "src/server/persistencia/";

type Ata = "CLAVE_DE_SUCURSAL" | "EMPRESA_ENTERA";
interface Declaracion {
  ata: Ata;
  /** Las puertas de empresa (`archivo desde src/server/actions|función`) que llegan a este archivo. Lista cerrada. */
  puertas: readonly string[];
  motivo: string;
  /** Solo `CLAVE_DE_SUCURSAL`: la clave de contexto sucursal que el archivo lee con `requierePermiso` antes de escribir. */
  clave?: AccionClave;
}

/**
 * Los casos de uso (o acciones) que llegan a una escritura con sucursal desde una puerta de empresa, con a qué se atan. Lista CERRADA, desde `src/server/actions`.
 * Ver el encabezado: `CLAVE_DE_SUCURSAL` tiene evidencia en el código; `EMPRESA_ENTERA` es una decisión escrita con su motivo.
 */
const DECLARADAS: Readonly<Record<string, Declaracion>> = {
  // ── La carta ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "carta/casos-de-uso/guardar-promo-carta.ts": {
    ata: "CLAVE_DE_SUCURSAL",
    clave: "carta_promo_activar",
    puertas: ["carta/promos.ts|guardarPromoCarta"],
    motivo:
      "S-10/D1 (O.59): definir una promo es de la empresa (`carta_promo_definir`), pero el alta crea la fila `PromoCartaSucursal` de la sucursal ACTIVA: nace prendida solo si quien la crea tiene `carta_promo_activar` ALLÍ (si no, apagada)",
  },
  // El portal de sucursales (D1: `carta_portal` es de la empresa entera y NO cambia de contexto). El registro público (`SucursalPublica`) tiene una fila por sucursal y estas cuatro acciones la administran
  // para TODAS desde una sola pantalla (el mapa del portal es entre sucursales; las cuatro reciben el id de la sucursal y no dependen de la activa). Pendiente de confirmar con el dueño si prefiere atar cada
  // fila a la membresía de esa sucursal (quien publica la sucursal B debería tener algo en B): hoy un administrador con `carta_portal` en cualquiera de sus sucursales puede publicar o quitar a otra.
  "carta/casos-de-uso/agregar-sucursal-al-portal.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["carta/registro-publico.ts|agregarSucursalAlPortal"],
    motivo: "el portal es de la empresa entera (`carta_portal`, D1: clave de empresa que no cambia de contexto): el registro público de TODAS las sucursales se administra desde una sola pantalla, sin depender de la activa",
  },
  "carta/casos-de-uso/guardar-sucursal-publica.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["carta/registro-publico.ts|guardarSucursalPublica"],
    motivo: "el portal es de la empresa entera (`carta_portal`, D1: clave de empresa que no cambia de contexto): el registro público de TODAS las sucursales se administra desde una sola pantalla, sin depender de la activa",
  },
  "carta/casos-de-uso/mover-sucursal-en-mapa.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["carta/registro-publico.ts|moverSucursalEnMapa"],
    motivo: "el portal es de la empresa entera (`carta_portal`, D1: clave de empresa que no cambia de contexto): la posición de cada tarjeta se arrastra sobre el mapa de todas las sucursales",
  },
  "carta/casos-de-uso/quitar-sucursal-del-portal.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["carta/registro-publico.ts|quitarSucursalDelPortal"],
    motivo: "el portal es de la empresa entera (`carta_portal`, D1: clave de empresa que no cambia de contexto): sacar una sucursal del registro público es la vuelta atrás de agregarla",
  },
  // ── Gobierno de las sucursales (claves `administrador_sistema` de empresa) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "auth/casos-de-uso/actualizar-activo-sucursal.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["auth/sucursales.ts|actualizarActivoSucursal"],
    motivo: "`activar_sucursal` es gobierno de la empresa (piso administrador de sistema, inmutable): alta y baja de sucursales; el caso de uso mide el id contra las sucursales de la empresa",
  },
  "auth/casos-de-uso/crear-sucursal-con-admin.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["auth/sucursales.ts|crearSucursalConAdmin"],
    motivo: "`alta_sucursal` es gobierno de la empresa: crea una sucursal NUEVA (todavía sin carta ni membresías) y le siembra la disponibilidad de los productos y la membresía de quien la crea",
  },
  "auth/casos-de-uso/renombrar-sucursal.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["auth/sucursales.ts|renombrarSucursal"],
    motivo: "`renombrar_sucursal` es gobierno de la empresa (piso administrador de sistema, inmutable): el nombre de una sucursal lo cambia quien gobierna la empresa; el id solo alcanza sucursales de la empresa",
  },
  "permisos/casos-de-uso/actualizar-capacidad.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["permisos/capacidades-sucursal.ts|actualizarCapacidad"],
    motivo: "`capacidades_sucursal` es gobierno de la empresa y el caso de uso la limita al gerente (O.41): prender o apagar una capacidad de UNA sucursal (o la fila por defecto, `null`) es la función de la acción",
  },
  // ── El catálogo central ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "catalogo/casos-de-uso/dar-de-alta-producto.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["catalogo/productos.ts|darDeAltaProducto"],
    motivo: "el producto es del catálogo central de la empresa: su alta siembra la disponibilidad (`DisponibilidadProducto`, disponible) en las sucursales activas; no elige ni cambia datos de una sucursal",
  },
  "catalogo/casos-de-uso/dar-de-alta-producto-rapido.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["catalogo/productos.ts|darDeAltaProductoRapido"],
    motivo: "el producto es del catálogo central de la empresa: su alta siembra la disponibilidad (`DisponibilidadProducto`, disponible) en las sucursales activas; no elige ni cambia datos de una sucursal",
  },
  "catalogo/casos-de-uso/guardar-version-de-receta.ts": {
    ata: "EMPRESA_ENTERA",
    puertas: ["catalogo/receta-a-ciegas.ts|guardarRecetaACiegas", "catalogo/recetas.ts|guardarReceta"],
    motivo:
      "las dos puertas de empresa guardan la receta CENTRAL (`sucursalId` null): el caso de uso solo arrastra a la versión nueva las calibraciones locales que cada sucursal YA tenía (D3), sin elegir ni cambiar ninguna; la rama de receta PROPIA de una sucursal (`destino.sucursalId`) la alcanzan solo las puertas de sucursal (`receta_sucursal_*`)",
  },
};

interface Hallazgo {
  /** El archivo (desde la raíz del repo) que importa la función de persistencia que escribe con sucursal. */
  archivo: string;
  /** Las puertas de empresa que llegan, como `archivo desde src/server/actions|función`. */
  puertas: Set<string>;
  /** Las escrituras con sucursal que alcanza (`modelo.operación`), para el mensaje. */
  escrituras: Set<string>;
}

interface Funcion {
  nombre: string;
  exportada: boolean;
  cuerpo: ts.Node;
}

interface Modulo {
  ruta: string;
  fuente: ts.SourceFile;
  funciones: Map<string, Funcion>;
  /** nombre local → archivo (desde la raíz) y nombre exportado, de los imports que resuelven a un archivo de la zona. */
  importados: Map<string, { archivo: string; nombre: string }>;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Los delegados (`generoCarta`…) de los modelos del schema con un campo de sucursal: `sucursalId` o cualquier `<algo>SucursalId` (`origenSucursalId`/`destinoSucursalId` de un traspaso: M-9 de la
 * auditoría intermedia, antes solo se miraba el nombre literal `sucursalId`, y `TraspasoSucursal` no entraba).
 */
function modelosConSucursalId(schemaPrisma: string): Set<string> {
  const modelos = new Set<string>();
  for (const m of schemaPrisma.replace(/\r\n/g, "\n").matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (/^\s+(?:\w*[sS])?ucursalId\s+String/m.test(m[2]!)) modelos.add(lowerFirst(m[1]!));
  }
  for (const m of MODELOS_QUE_CUELGAN_DE_UNA_SUCURSAL) modelos.add(m);
  return modelos;
}

/**
 * Los modelos que no llevan `sucursalId` propio pero SON de una sucursal porque cuelgan de otra tabla que sí la tiene (plan, sección 6.3 iv): una escritura sobre ellos desde una acción de empresa
 * es una escritura en una sucursal igual (M-9 de la auditoría intermedia). `MovimientoStock` cuelga de `Seccion`; las cuentas del POS, de `Mesa`.
 */
const MODELOS_QUE_CUELGAN_DE_UNA_SUCURSAL = ["movimientoStock", "cuenta", "cuentaItem", "promoCuenta"];

function resolver(desde: string, especificador: string, existe: (ruta: string) => boolean): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = `src/${especificador.slice(2)}`;
  else if (especificador.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(desde), especificador));
  else return null;
  for (const candidato of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (existe(candidato)) return candidato;
  return null;
}

function analizarModulo(ruta: string, codigo: string, existe: (ruta: string) => boolean): Modulo {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const funciones = new Map<string, Funcion>();
  const importados = new Map<string, { archivo: string; nombre: string }>();
  const esExportada = (s: ts.Statement) => ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const s of fuente.statements) {
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) {
      const archivo = resolver(ruta, s.moduleSpecifier.text, existe);
      if (!archivo || !(archivo.startsWith(ZONA_DE_ACCIONES) || archivo.startsWith(ZONA_DE_PERSISTENCIA))) continue;
      for (const e of s.importClause.namedBindings.elements) importados.set(e.name.text, { archivo, nombre: (e.propertyName ?? e.name).text });
    }
    if (ts.isFunctionDeclaration(s) && s.name && s.body) funciones.set(s.name.text, { nombre: s.name.text, exportada: esExportada(s), cuerpo: s.body });
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        // I-2 de la auditoría final: también la acción exportada como constante con envoltorio o `as`.
        const funcion = ts.isIdentifier(d.name) && d.initializer ? funcionDeInicializador(d.initializer) : undefined;
        if (funcion && ts.isIdentifier(d.name)) funciones.set(d.name.text, { nombre: d.name.text, exportada: esExportada(s), cuerpo: funcion.body });
      }
    }
  }
  return { ruta, fuente, funciones, importados };
}

/** Los identificadores que una función USA como valor o llamada (no los nombres de propiedad), sin repetir. */
function identificadoresDe(cuerpo: ts.Node): Set<string> {
  const ids = new Set<string>();
  const visitar = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const esNombreDePropiedad = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
      if (!esNombreDePropiedad) ids.add(n.text);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(cuerpo);
  return ids;
}

/** ¿Algún identificador `sucursalId` (clave de propiedad, atajo o miembro como `args.sucursalId`) en los argumentos de la llamada? */
function mencionaSucursalId(nodo: ts.Node): boolean {
  let encontro = false;
  const visitar = (n: ts.Node): void => {
    if (encontro) return;
    if (ts.isIdentifier(n) && n.text === "sucursalId") encontro = true;
    else ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return encontro;
}

/** Las escrituras con sucursal del CUERPO de una función (sin seguir llamadas), como `modelo.operación`. */
function escriturasPropias(cuerpo: ts.Node, modelosDeSucursal: ReadonlySet<string>): string[] {
  const halladas: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ESCRITURAS.has(n.expression.name.text)) {
      // `x.<modelo>.<op>(…)` y el delegado suelto (`const { generoCarta } = tx; generoCarta.create(…)`).
      const delegado = n.expression.expression;
      const modelo = ts.isPropertyAccessExpression(delegado) ? delegado.name.text : ts.isIdentifier(delegado) ? delegado.text : null;
      if (modelo !== null && (modelosDeSucursal.has(modelo) || (ts.isPropertyAccessExpression(delegado) && n.arguments.some((a) => mencionaSucursalId(a))))) {
        halladas.push(`${modelo}.${n.expression.name.text}`);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(cuerpo);
  return halladas;
}

/**
 * Todos los hallazgos del código dado (`archivo desde la raíz` → texto). Recibe todo por parámetro para poder probarse con fuentes sintéticas.
 */
function hallazgosDe(fuentes: ReadonlyMap<string, string>, modelosDeSucursal: ReadonlySet<string>): Hallazgo[] {
  const existe = (ruta: string) => fuentes.has(ruta);
  const modulos = new Map<string, Modulo>();
  for (const [ruta, codigo] of fuentes) if (ruta.startsWith(ZONA_DE_ACCIONES) || ruta.startsWith(ZONA_DE_PERSISTENCIA)) modulos.set(ruta, analizarModulo(ruta, codigo, existe));

  /** Las escrituras con sucursal que alcanza una función de persistencia (las suyas y las de las funciones del mismo archivo que llama). */
  const escriturasDePersistencia = (archivo: string, nombre: string, visitadas = new Set<string>()): string[] => {
    const clave = `${archivo}|${nombre}`;
    const modulo = modulos.get(archivo);
    const f = modulo?.funciones.get(nombre);
    if (!modulo || !f || visitadas.has(clave)) return [];
    visitadas.add(clave);
    const propias = escriturasPropias(f.cuerpo, modelosDeSucursal);
    const delMismoArchivo = [...identificadoresDe(f.cuerpo)].filter((id) => id !== nombre && modulo.funciones.has(id)).flatMap((id) => escriturasDePersistencia(archivo, id, visitadas));
    // M-9 (auditoría intermedia): una función de persistencia que llama a otra de OTRO archivo de persistencia (`escribir-anulacion-de-compra.ts` importa a su hermana) también hereda sus escrituras.
    const deOtroArchivoDePersistencia = [...identificadoresDe(f.cuerpo)].flatMap((id) => {
      const importado = modulo.importados.get(id);
      return importado?.archivo.startsWith(ZONA_DE_PERSISTENCIA) ? escriturasDePersistencia(importado.archivo, importado.nombre, visitadas) : [];
    });
    return [...propias, ...delMismoArchivo, ...deOtroArchivoDePersistencia];
  };

  const porArchivo = new Map<string, Hallazgo>();
  const registrar = (archivo: string, puerta: string, escrituras: readonly string[]) => {
    if (!escrituras.length) return;
    const h = porArchivo.get(archivo) ?? { archivo, puertas: new Set<string>(), escrituras: new Set<string>() };
    h.puertas.add(puerta);
    for (const e of escrituras) h.escrituras.add(e);
    porArchivo.set(archivo, h);
  };

  /** Sigue lo que llama una función de acciones: las de acciones (recursivo) y las de persistencia (aquí se registra el archivo que las importa). */
  const seguir = (archivo: string, nombre: string, puerta: string, visitadas: Set<string>): void => {
    const clave = `${archivo}|${nombre}`;
    const modulo = modulos.get(archivo);
    const f = modulo?.funciones.get(nombre);
    if (!modulo || !f || visitadas.has(clave)) return;
    visitadas.add(clave);
    // Escrituras del propio cuerpo si el archivo es de persistencia (no debería pasar acá) o la acción escribe directo (heredado, no permitido hoy pero se vería).
    registrar(archivo, puerta, archivo.startsWith(ZONA_DE_ACCIONES) ? escriturasPropias(f.cuerpo, modelosDeSucursal) : []);
    for (const id of identificadoresDe(f.cuerpo)) {
      if (id === nombre) continue;
      const importado = modulo.importados.get(id);
      if (importado) {
        if (importado.archivo.startsWith(ZONA_DE_PERSISTENCIA)) registrar(archivo, puerta, escriturasDePersistencia(importado.archivo, importado.nombre));
        else seguir(importado.archivo, importado.nombre, puerta, visitadas);
      } else if (modulo.funciones.has(id)) {
        seguir(archivo, id, puerta, visitadas);
      }
    }
  };

  for (const [archivo, modulo] of modulos) {
    if (!archivo.startsWith(ZONA_DE_ACCIONES) || archivo.includes("/casos-de-uso/")) continue;
    const codigo = fuentes.get(archivo)!;
    for (const [nombre, { entrada }] of Object.entries(envoltoriosDe(codigo))) {
      const envoltorio = entrada.split(":")[0];
      if (!ENVOLTORIOS_DE_EMPRESA.has(envoltorio) || !modulo.funciones.get(nombre)?.exportada) continue;
      seguir(archivo, nombre, `${archivo.slice(ZONA_DE_ACCIONES.length)}|${nombre}`, new Set());
    }
  }
  return [...porArchivo.values()].sort((a, b) => a.archivo.localeCompare(b.archivo));
}

/** ¿El archivo llama a `requierePermiso(…, "<clave>", …)` (el gate de la sucursal activa)? */
function leeLaClaveDeSucursal(codigo: string, clave: string): boolean {
  const sf = ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
  let encontro = false;
  const visitar = (n: ts.Node): void => {
    if (encontro) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "requierePermiso" && n.arguments.some((a) => ts.isStringLiteral(a) && a.text === clave)) encontro = true;
    else ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return encontro;
}

/** Compara los hallazgos con la lista cerrada, en las dos direcciones, y comprueba la evidencia de cada forma. Un problema por cada discrepancia. */
function problemasDe(
  hallazgos: readonly Hallazgo[],
  declaradas: Readonly<Record<string, Declaracion>>,
  leer: (archivo: string) => string,
  contextoDe: (clave: string) => string | undefined,
): string[] {
  const problemas: string[] = [];
  const encontrados = new Set(hallazgos.map((h) => h.archivo));
  for (const h of hallazgos) {
    const clave = h.archivo.slice(ZONA_DE_ACCIONES.length);
    const d = declaradas[clave];
    const puertas = [...h.puertas].sort();
    if (!d) {
      problemas.push(
        `${clave}: lo alcanzan las puertas de empresa [${puertas.join(", ")}] y escribe filas de una sucursal (${[...h.escrituras].sort().join(", ")}) sin declarar a qué se ata (agregalo a DECLARADAS: CLAVE_DE_SUCURSAL con la clave que lee, o EMPRESA_ENTERA con su motivo; o pasá la acción a \`conPermiso\` con una clave de contexto sucursal)`,
      );
      continue;
    }
    if (d.motivo.trim().length < 20) problemas.push(`${clave}: la declaración no tiene un motivo escrito`);
    if (JSON.stringify([...d.puertas].sort()) !== JSON.stringify(puertas)) {
      problemas.push(`${clave}: las puertas de empresa que llegan son [${puertas.join(", ")}] y la declaración dice [${[...d.puertas].sort().join(", ")}]`);
    }
    if (d.ata === "CLAVE_DE_SUCURSAL") {
      if (!d.clave) problemas.push(`${clave}: CLAVE_DE_SUCURSAL sin la clave`);
      else {
        if (contextoDe(d.clave) !== "sucursal") problemas.push(`${clave}: declara CLAVE_DE_SUCURSAL con \`${d.clave}\` y esa clave no es de contexto sucursal`);
        if (!leeLaClaveDeSucursal(leer(h.archivo), d.clave)) problemas.push(`${clave}: declara CLAVE_DE_SUCURSAL con \`${d.clave}\` y el archivo no llama a \`requierePermiso(…, "${d.clave}", …)\``);
      }
    }
  }
  for (const k of Object.keys(declaradas)) {
    if (!encontrados.has(`${ZONA_DE_ACCIONES}${k}`)) problemas.push(`${k}: está declarada y ninguna puerta de empresa llega ya a una escritura con sucursal por ahí (o el archivo no existe): sacala de DECLARADAS`);
  }
  return problemas;
}

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosTs(ruta);
    return /\.tsx?$/.test(nombre) && !nombre.endsWith(".d.ts") ? [ruta] : [];
  });
}

function fuentesDelRepo(): Map<string, string> {
  const fuentes = new Map<string, string>();
  for (const zona of [ZONA_DE_ACCIONES, ZONA_DE_PERSISTENCIA]) {
    for (const ruta of archivosTs(join(RAIZ, zona))) fuentes.set(relative(RAIZ, ruta).replace(/\\/g, "/"), readFileSync(ruta, "utf8"));
  }
  return fuentes;
}

const MODELOS = modelosConSucursalId(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
const contextoDelCatalogo = (clave: string) => ACCIONES.find((a) => a.clave === clave)?.contexto;

describe("GT-4 (segunda mitad): toda acción de empresa que escribe filas de una sucursal declara la sucursal y su clave", () => {
  const fuentes = fuentesDelRepo();

  it("el código y la lista cerrada DECLARADAS coinciden, en las dos direcciones, y cada atado tiene su evidencia", () => {
    const problemas = problemasDe(hallazgosDe(fuentes, MODELOS), DECLARADAS, (archivo) => fuentes.get(archivo)!, contextoDelCatalogo);
    expect(problemas).toEqual([]);
  });

  it("lee del schema los modelos con sucursal (la carta propia de cada sucursal entre ellos)", () => {
    for (const m of ["generoCarta", "contenidoCartaProducto", "itemAgrupadoCarta", "opcionItemAgrupadoCarta", "promoCartaSucursal", "sucursalPublica"]) expect(MODELOS.has(m), m).toBe(true);
    expect(MODELOS.has("promoCarta")).toBe(false);
    expect(MODELOS.has("seccionCarta")).toBe(false);
  });

  it("ve también los modelos de traspaso (`origenSucursalId`/`destinoSucursalId`) y los que cuelgan de una sucursal (M-9 de la auditoría intermedia)", () => {
    for (const m of ["traspasoSucursal", "movimientoStock", "cuenta", "cuentaItem", "promoCuenta", "operacion", "mesa"]) expect(MODELOS.has(m), m).toBe(true);
    // los que cuelgan existen de verdad en el schema (si se renombra uno, la lista no queda apuntando a nada)
    const schema = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
    for (const m of MODELOS_QUE_CUELGAN_DE_UNA_SUCURSAL) expect(schema, m).toMatch(new RegExp(`^model ${m.charAt(0).toUpperCase()}${m.slice(1)} \\{`, "m"));
    // el schema normalizado a LF y a CRLF da lo mismo
    expect([...modelosConSucursalId(schema.replace(/\n/g, "\r\n"))].sort()).toEqual([...modelosConSucursalId(schema)].sort());
  });

  describe("el guardián en sí (casos sintéticos)", () => {
    const MODELOS_SINTETICOS = new Set(["generoCarta"]);
    const PERSISTENCIA = `import type { Prisma } from "@prisma/client";
export async function crearGenero(db: Prisma.TransactionClient, args: { sucursalId: string; nombre: string }) {
  return db.generoCarta.create({ data: { sucursalId: args.sucursalId, nombre: args.nombre } });
}
export async function renombrarGenero(db: Prisma.TransactionClient, args: { id: string; nombre: string }) {
  return db.generoCarta.update({ where: { id: args.id }, data: { nombre: args.nombre } });
}
export async function leerGenero(db: Prisma.TransactionClient, id: string) {
  return db.generoCarta.findUnique({ where: { id } });
}`;
    const CASO_DE_USO = `import { crearGenero } from "@/server/persistencia/carta/generos";
export async function guardarGeneroCasoDeUso(actor: { db: unknown; sucursalId: string }) {
  return crearGenero(actor.db as never, { sucursalId: actor.sucursalId, nombre: "x" });
}`;
    const ACCION = (envoltorio: string) => `"use server";
import { ${envoltorio} } from "../con-permiso";
import { guardarGeneroCasoDeUso } from "./casos-de-uso/guardar-genero";
export async function guardarGenero() {
  return ${envoltorio}("carta_generos", async (ctx) => guardarGeneroCasoDeUso(ctx));
}`;
    const fuentesSinteticas = (envoltorio: string, casoDeUso = CASO_DE_USO) =>
      new Map([
        ["src/server/persistencia/carta/generos.ts", PERSISTENCIA],
        ["src/server/actions/carta/casos-de-uso/guardar-genero.ts", casoDeUso],
        ["src/server/actions/carta/generos.ts", ACCION(envoltorio)],
      ]);
    const CLAVE = "carta/casos-de-uso/guardar-genero.ts";
    const CLAVE_DECLARADA = (extra: Partial<Declaracion> = {}): Record<string, Declaracion> => ({
      [CLAVE]: { ata: "EMPRESA_ENTERA", puertas: ["carta/generos.ts|guardarGenero"], motivo: "el género es un objeto de la empresa entera (caso sintético)", ...extra },
    });
    const leerDe = (f: Map<string, string>) => (archivo: string) => f.get(archivo)!;
    const juzgar = (f: Map<string, string>, declaradas: Record<string, Declaracion>) => problemasDe(hallazgosDe(f, MODELOS_SINTETICOS), declaradas, leerDe(f), () => "sucursal");

    it("una acción de EMPRESA que llega a una escritura con sucursal y no la declara falla (S-10)", () => {
      const f = fuentesSinteticas("conPermisoDeEmpresa");
      const problemas = juzgar(f, {});
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain(CLAVE);
      expect(problemas[0]).toContain("carta/generos.ts|guardarGenero");
    });

    it("la misma acción con `conPermiso` (clave de sucursal) no es una puerta de empresa: nada que declarar", () => {
      expect(juzgar(fuentesSinteticas("conPermiso"), {})).toEqual([]);
    });

    it("declarada con su forma y sus puertas, pasa; con otras puertas, o sin motivo, falla", () => {
      const f = fuentesSinteticas("conPermisoDeEmpresa");
      expect(juzgar(f, CLAVE_DECLARADA())).toEqual([]);
      expect(juzgar(f, CLAVE_DECLARADA({ puertas: ["carta/generos.ts|otra"] }))).toHaveLength(1);
      expect(juzgar(f, CLAVE_DECLARADA({ motivo: "" }))).toHaveLength(1);
    });

    it("una declaración que ya no corresponde a ninguna escritura falla (lista cerrada en las dos direcciones)", () => {
      expect(juzgar(fuentesSinteticas("conPermiso"), CLAVE_DECLARADA())).toHaveLength(1);
    });

    it("la escritura en una función de persistencia que solo LEE no cuenta, y la que edita por id (sin `sucursalId` en los argumentos) sí, por el modelo", () => {
      const soloLee = fuentesSinteticas("conPermisoDeEmpresa", CASO_DE_USO.replaceAll("crearGenero", "leerGenero"));
      expect(juzgar(soloLee, {})).toEqual([]);
      const editaPorId = fuentesSinteticas("conPermisoDeEmpresa", CASO_DE_USO.replaceAll("crearGenero", "renombrarGenero"));
      expect(juzgar(editaPorId, {})).toHaveLength(1);
    });

    it("una escritura ANIDADA que menciona `sucursalId` en un modelo sin ese campo también cuenta", () => {
      const f = fuentesSinteticas("conPermisoDeEmpresa");
      f.set(
        "src/server/persistencia/carta/generos.ts",
        `export async function crearGenero(db: any, args: { sucursalId: string }) { return db.promoCarta.create({ data: { sucursales: { create: { sucursalId: args.sucursalId } } } }); }`,
      );
      expect(juzgar(f, {})).toHaveLength(1);
    });

    it("una escritura de OTRO archivo de persistencia que la primera llama también se sigue (M-9: `escribir-anulacion-de-compra` importa a su hermana)", () => {
      const f = fuentesSinteticas("conPermisoDeEmpresa");
      f.set(
        "src/server/persistencia/carta/generos.ts",
        `import { escribirDeVerdad } from "./escribir-de-verdad";
export async function crearGenero(db: any, args: { sucursalId: string }) { return escribirDeVerdad(db, args.sucursalId); }`,
      );
      f.set("src/server/persistencia/carta/escribir-de-verdad.ts", `export async function escribirDeVerdad(db: any, sucursalId: string) { return db.generoCarta.create({ data: { sucursalId } }); }`);
      const problemas = juzgar(f, {});
      expect(problemas).toHaveLength(1);
      expect(problemas[0]).toContain("generoCarta.create");
      f.set("src/server/persistencia/carta/escribir-de-verdad.ts", `export async function escribirDeVerdad(db: any, sucursalId: string) { return db.generoCarta.findMany({ where: { sucursalId } }); }`);
      expect(juzgar(f, {})).toEqual([]);
    });

    it("la helper no exportada del mismo archivo de persistencia se sigue", () => {
      const f = fuentesSinteticas("conPermisoDeEmpresa");
      f.set(
        "src/server/persistencia/carta/generos.ts",
        `async function interna(db: any, sucursalId: string) { return db.generoCarta.create({ data: { sucursalId } }); }
export async function crearGenero(db: any, args: { sucursalId: string }) { return interna(db, args.sucursalId); }`,
      );
      expect(juzgar(f, {})).toHaveLength(1);
    });

    it("CLAVE_DE_SUCURSAL sin la lectura de la clave en el archivo (la mutación de la promo) falla; con ella, pasa", () => {
      const sin = fuentesSinteticas("conPermisoDeEmpresa");
      const con = fuentesSinteticas(
        "conPermisoDeEmpresa",
        `import { requierePermiso } from "@/server/acceso/gate";
import { crearGenero } from "@/server/persistencia/carta/generos";
export async function guardarGeneroCasoDeUso(actor: { db: unknown; sucursalId: string; usuarioId: string }) {
  const prendida = (await requierePermiso(actor.usuarioId, actor.sucursalId, "carta_promo_activar", actor.db as never)).ok;
  return crearGenero(actor.db as never, { sucursalId: actor.sucursalId, nombre: prendida ? "x" : "y" });
}`,
      );
      const d = CLAVE_DECLARADA({ ata: "CLAVE_DE_SUCURSAL", clave: "carta_promo_activar" });
      expect(juzgar(sin, d)).toHaveLength(1);
      expect(juzgar(con, d)).toEqual([]);
    });

    it("CLAVE_DE_SUCURSAL con una clave que no es de contexto sucursal falla", () => {
      const f = fuentesSinteticas(
        "conPermisoDeEmpresa",
        `import { requierePermiso } from "@/server/acceso/gate";
import { crearGenero } from "@/server/persistencia/carta/generos";
export async function guardarGeneroCasoDeUso(actor: { db: unknown; sucursalId: string; usuarioId: string }) {
  await requierePermiso(actor.usuarioId, actor.sucursalId, "carta_portal", actor.db as never);
  return crearGenero(actor.db as never, { sucursalId: actor.sucursalId, nombre: "x" });
}`,
      );
      const problemas = problemasDe(hallazgosDe(f, MODELOS_SINTETICOS), CLAVE_DECLARADA({ ata: "CLAVE_DE_SUCURSAL", clave: "carta_portal" }), leerDe(f), () => "empresa");
      expect(problemas).toHaveLength(1);
    });
  });
});
