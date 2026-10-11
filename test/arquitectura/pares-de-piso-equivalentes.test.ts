import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCIONES, nivelMinimoDeAccion, type AccionClave, type NivelDeAccion } from "../../src/core/permisos/acciones";
import { nivelAlcanzaElPiso } from "../../src/core/permisos/jerarquia";

/**
 * GT-2 (plan de endurecimiento de seguridad, tanda T5), el tramo «pares de acción equivalente»: cuando DOS caminos llegan al mismo efecto, el piso del camino hermano no puede ser menor
 * que el del principal, y el camino que lo evita tiene que exigir la clave del hermano. Hoy hay un par, el que cerró S-09 (D3, defecto del orquestador, pendiente de confirmar):
 *
 *   `proceso_control` (registrar un Conteo Físico, piso operario)  ⇒  `proceso_ajuste` (registrar un Ajuste, piso administrador)
 *
 * La acción AJUSTAR del conteo (y «ajustar» al resolver un pendiente) escribe en el Kardex la misma corrección que un Ajuste. Si solo se pidiera la clave del conteo, el piso del Ajuste se
 * saltearía por el costado: un operario con `conteo_resolver_pendiente` o `proceso_control` pondría `conteoReal: 0` sobre 60 productos y dejaría la sección en cero.
 *
 * M.2 suma el par `producto_editar` ⇒ `producto_campos_sensibles` (piso mínimo operario; la clave fina se SUMA a la de editar, no la reemplaza): `actualizarProducto` calcula el dato con el ayudante compartido
 * `puedeEditarCamposSensiblesDelProducto` (`src/server/acceso/campos-sensibles-de-producto.ts`, fuente única desde M.2-A4; consulta la clave con `obtenerMiNivelPermisoDeEmpresa`) y lo pasa al caso de uso; P3, P4 y P5 suman sus puertas. Este guardián exige,
 * por cada par declarado (lista cerrada: un par nuevo se declara acá, con su motivo):
 *  1. que el piso del equivalente sea al menos el declarado (`pisoMinimo`) y al menos el del principal (bajar `proceso_ajuste` a operario → rojo);
 *  2. que cada puerta declarada (una función exportada de una Server Action) llame al ayudante que consulta la clave del equivalente, y que ese ayudante consulte `requierePermiso(…, "<equivalente>", …)`
 *     (sacar la llamada de una puerta, o cambiar la clave del ayudante → rojo).
 * Por AST: un comentario no cuenta.
 */
interface Puerta {
  /** Relativo a la raíz del repo. */
  archivo: string;
  /** Funciones exportadas que aplican el efecto y por eso tienen que pedir la clave del equivalente. */
  funciones: string[];
  /** Función que consulta el permiso (`CONSULTAS_DE_PERMISO`) con la clave del equivalente: local del mismo archivo, o la que ese archivo importa de `archivoDelAyudante`. */
  ayudante: string;
  /** Relativo a la raíz del repo: donde vive el ayudante cuando es una fuente compartida (M.2-A4: `puedeEditarCamposSensiblesDelProducto`); ausente = el mismo archivo de la puerta. */
  archivoDelAyudante?: string;
}
interface ParDePiso {
  principal: AccionClave;
  equivalente: AccionClave;
  pisoMinimo: NivelDeAccion;
  motivo: string;
  puertas: Puerta[];
}

/** M.2-A4 (C): la consulta de `producto_campos_sensibles` vive en un solo archivo, compartido por las acciones y las pantallas. */
const ARCHIVO_DEL_AYUDANTE_M2 = "src/server/acceso/campos-sensibles-de-producto.ts";

const PARES: ParDePiso[] = [
  {
    principal: "proceso_control",
    equivalente: "proceso_ajuste",
    pisoMinimo: "administrador",
    motivo:
      "Aplicar la diferencia de un conteo al stock (AJUSTAR en la grilla, «ajustar» al resolver un pendiente) es un Ajuste: sin la clave de Ajuste, un operario con la clave del conteo vaciaba el stock de la sucursal (S-09).",
    puertas: [
      {
        archivo: "src/server/actions/movimientos/conteo-fisico.ts",
        funciones: ["registrarConteoFisico", "registrarConteosFisicos", "resolverConteoPendiente"],
        ayudante: "puedeAjustar",
      },
    ],
  },
  {
    principal: "producto_editar",
    equivalente: "producto_campos_sensibles",
    pisoMinimo: "operario",
    motivo:
      "Cambiar el precio de venta, el factor de conversión o las unidades de un producto es lo que da significado al dinero y a las cantidades: sin la clave fina, quien tiene la clave de editar el producto los cambiaba (M.2).",
    puertas: [
      {
        archivo: "src/server/actions/catalogo/productos.ts",
        funciones: ["actualizarProducto"],
        ayudante: "puedeEditarCamposSensiblesDelProducto",
        archivoDelAyudante: ARCHIVO_DEL_AYUDANTE_M2,
      },
    ],
  },
  {
    principal: "producto_presentaciones",
    equivalente: "producto_campos_sensibles",
    pisoMinimo: "operario",
    motivo:
      "Definir el factor de una presentación de compra mueve el stock que entra y el costo por unidad de todo lo que se compre con ella: sin la clave fina, quien tiene la clave de presentaciones creaba una con el factor que quisiera (M.2).",
    puertas: [
      {
        archivo: "src/server/actions/catalogo/productos.ts",
        funciones: ["agregarPresentacionAlternativa"],
        ayudante: "puedeEditarCamposSensiblesDelProducto",
        archivoDelAyudante: ARCHIVO_DEL_AYUDANTE_M2,
      },
    ],
  },
  {
    principal: "alta_producto",
    equivalente: "producto_campos_sensibles",
    pisoMinimo: "operario",
    motivo:
      "Dar de alta un producto con precio de venta, factor de conversión o unidad de compra es fijar justo lo que la edición protege: sin la clave fina, quien no puede editar el precio lo fijaba creando un producto nuevo (M.2, D-2).",
    puertas: [
      {
        archivo: "src/server/actions/catalogo/productos.ts",
        funciones: ["darDeAltaProducto"],
        ayudante: "puedeEditarCamposSensiblesDelProducto",
        archivoDelAyudante: ARCHIVO_DEL_AYUDANTE_M2,
      },
    ],
  },
  {
    principal: "producto_sincronizar_precio_carta",
    equivalente: "producto_campos_sensibles",
    pisoMinimo: "operario",
    motivo:
      "Sincronizar el precio de un ítem agrupado de la carta ES cambiar el precio de venta de varios productos a la vez: sin la clave fina, quien tiene solo la de sincronizar fijaba precios que la edición le niega (M.2, D-3).",
    puertas: [
      {
        archivo: "src/server/actions/catalogo/productos.ts",
        funciones: ["sincronizarPrecioGrupoCarta"],
        ayudante: "puedeEditarCamposSensiblesDelProducto",
        archivoDelAyudante: ARCHIVO_DEL_AYUDANTE_M2,
      },
    ],
  },
];

const RAIZ = join(__dirname, "../..");

function fuente(codigo: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", codigo, ts.ScriptTarget.Latest, true);
}

function funcionNombrada(sf: ts.SourceFile, nombre: string): ts.FunctionDeclaration | null {
  return sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre) ?? null;
}

/** Los nombres que el cuerpo de la función llama como `nombre(...)` (a cualquier profundidad). */
function llamadasDe(nodo: ts.Node): Set<string> {
  const nombres = new Set<string>();
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) nombres.add(n.expression.text);
    ts.forEachChild(n, visitar);
  };
  visitar(nodo);
  return nombres;
}

/** Las consultas de permiso del gate que reciben la clave como argumento (las de sucursal y las de empresa): M.2 suma las de empresa, que usa la clave fina del producto. */
const CONSULTAS_DE_PERMISO: ReadonlySet<string> = new Set(["requierePermiso", "requierePermisoDeEmpresa", "obtenerMiNivelPermiso", "obtenerMiNivelPermisoDeEmpresa"]);

/** ¿El cuerpo de la función llama a una consulta de permiso (`CONSULTAS_DE_PERMISO`) con la clave `clave` como literal de texto entre sus argumentos? */
function consultaLaClave(funcion: ts.FunctionDeclaration, clave: string): boolean {
  let encontrado = false;
  const visitar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && CONSULTAS_DE_PERMISO.has(n.expression.text)) {
      if (n.arguments.some((a) => ts.isStringLiteralLike(a) && a.text === clave)) encontrado = true;
    }
    ts.forEachChild(n, visitar);
  };
  visitar(funcion);
  return encontrado;
}

/** Problemas de una puerta respecto del par: vacío si todas las funciones piden el ayudante y el ayudante consulta la clave. */
export function problemasDeLaPuerta(codigo: string, puerta: Pick<Puerta, "funciones" | "ayudante">, equivalente: string, codigoDelAyudante: string = codigo): string[] {
  const sf = fuente(codigo);
  const problemas: string[] = [];
  const ayudante = funcionNombrada(fuente(codigoDelAyudante), puerta.ayudante);
  if (!ayudante) problemas.push(`no existe el ayudante «${puerta.ayudante}»`);
  else if (!consultaLaClave(ayudante, equivalente)) problemas.push(`«${puerta.ayudante}» no consulta el permiso (requierePermiso, obtenerMiNivelPermiso, …) con la clave "${equivalente}"`);
  for (const nombre of puerta.funciones) {
    const f = funcionNombrada(sf, nombre);
    if (!f) problemas.push(`no existe la función «${nombre}»`);
    else if (!llamadasDe(f).has(puerta.ayudante)) problemas.push(`«${nombre}» no llama a «${puerta.ayudante}»: aplica el efecto sin la clave "${equivalente}"`);
  }
  return problemas;
}

describe("el detector de puertas ve las llamadas reales (un comentario no cuenta)", () => {
  const puerta = { funciones: ["a"], ayudante: "puede" };
  const bueno = `async function puede(ctx) { return (await requierePermiso(ctx.u, ctx.s, "proceso_ajuste", ctx.db)).ok; }
    export async function a(ctx) { if (!(await puede(ctx))) return 1; return 2; }`;
  it("completa / sin llamar al ayudante / ayudante con otra clave / ayudante ausente / función ausente", () => {
    expect(problemasDeLaPuerta(bueno, puerta, "proceso_ajuste")).toEqual([]);
    expect(problemasDeLaPuerta(bueno.replace("if (!(await puede(ctx))) return 1;", "// puede(ctx)"), puerta, "proceso_ajuste")).toHaveLength(1);
    expect(problemasDeLaPuerta(bueno.replace('"proceso_ajuste"', '"proceso_control"'), puerta, "proceso_ajuste")).toHaveLength(1);
    expect(problemasDeLaPuerta("export async function a() {}", puerta, "proceso_ajuste")).toHaveLength(2);
    expect(problemasDeLaPuerta(bueno, { funciones: ["b"], ayudante: "puede" }, "proceso_ajuste")).toHaveLength(1);
  });

  // M.2-A4 (C): el ayudante puede vivir en OTRO archivo (la fuente única que comparten las acciones y las pantallas): se busca ahí, y la puerta tiene que seguir llamándolo.
  it("con el ayudante en otro archivo: ve la clave en el ayudante y la llamada en la puerta", () => {
    const puertaBuena = `export async function a(ctx) { if (!(await puede(ctx))) return 1; return 2; }`;
    const ayudanteAparte = `export async function puede(ctx) { return (await obtenerMiNivelPermisoDeEmpresa(ctx.u, ctx.e, "producto_campos_sensibles", ctx.db)).editar; }`;
    expect(problemasDeLaPuerta(puertaBuena, puerta, "producto_campos_sensibles", ayudanteAparte)).toEqual([]);
    expect(problemasDeLaPuerta(puertaBuena, puerta, "producto_campos_sensibles", ayudanteAparte.replace("producto_campos_sensibles", "producto_editar"))).toHaveLength(1);
    expect(problemasDeLaPuerta(puertaBuena.replace("if (!(await puede(ctx))) return 1;", ""), puerta, "producto_campos_sensibles", ayudanteAparte)).toHaveLength(1);
    expect(problemasDeLaPuerta(puertaBuena, puerta, "producto_campos_sensibles", "export const x = 1;")).toHaveLength(1);
  });

  // M.2: las claves de empresa se consultan con `obtenerMiNivelPermisoDeEmpresa` o `requierePermisoDeEmpresa`, y las de sucursal también con `obtenerMiNivelPermiso`: el detector tiene que verlas todas.
  it("ve las consultas de la clave por obtenerMiNivelPermisoDeEmpresa, requierePermisoDeEmpresa y obtenerMiNivelPermiso", () => {
    const con = (consulta: string, clave: string) =>
      `async function puede(ctx) { return (await ${consulta}(ctx.u, ctx.e, "${clave}", ctx.db)).editar; }
       export async function a(ctx) { if (!(await puede(ctx))) return 1; return 2; }`;
    for (const consulta of ["obtenerMiNivelPermisoDeEmpresa", "requierePermisoDeEmpresa", "obtenerMiNivelPermiso", "requierePermiso"]) {
      expect(problemasDeLaPuerta(con(consulta, "producto_campos_sensibles"), puerta, "producto_campos_sensibles"), consulta).toEqual([]);
      expect(problemasDeLaPuerta(con(consulta, "producto_editar"), puerta, "producto_campos_sensibles"), `${consulta} con otra clave`).toHaveLength(1);
    }
    // Una función que NO es una consulta de permisos no cuenta, aunque lleve la clave como texto.
    expect(problemasDeLaPuerta(con("registrarAlgo", "producto_campos_sensibles"), puerta, "producto_campos_sensibles")).toHaveLength(1);
  });
});

/**
 * Pares cuyo camino hermano YA es de un piso al menos igual (sin puertas que vigilar): lo que se fija es que el piso del hermano no baje (M-28 de la auditoría intermedia: `cancelar_conteo`
 * revierte stock, igual que un Ajuste, y no figuraba como par). Bajar `cancelar_conteo` a operario le daría a quien cuenta una forma de sacar o meter stock sin la clave de Ajuste.
 */
const PARES_DE_PISO_IGUAL: readonly { hermana: AccionClave; ajuste: AccionClave; motivo: string }[] = [
  { hermana: "cancelar_conteo", ajuste: "proceso_ajuste", motivo: "Cancelar un conteo revierte en el Kardex lo que el conteo aplicó (S-04): es un Ajuste con otro nombre." },
];

describe("pares de piso igual (GT-2, M-28): el camino hermano no baja del piso del Ajuste", () => {
  it.each(PARES_DE_PISO_IGUAL)("$hermana es al menos de piso $ajuste", ({ hermana, ajuste, motivo }) => {
    expect(nivelAlcanzaElPiso(nivelMinimoDeAccion(hermana), nivelMinimoDeAccion(ajuste)), `${hermana} (piso ${nivelMinimoDeAccion(hermana)}) no puede ser menos que ${ajuste} (piso ${nivelMinimoDeAccion(ajuste)}): ${motivo}`).toBe(true);
  });
});

describe("pares de acción equivalente (GT-2): el camino hermano no baja el piso", () => {
  const clavesDelCatalogo = new Set<string>(ACCIONES.map((a) => a.clave));

  for (const par of PARES) {
    describe(`${par.principal} ⇒ ${par.equivalente}`, () => {
      it("las dos claves existen en el catálogo", () => {
        expect(clavesDelCatalogo.has(par.principal), par.principal).toBe(true);
        expect(clavesDelCatalogo.has(par.equivalente), par.equivalente).toBe(true);
      });

      it(`el piso del equivalente es al menos «${par.pisoMinimo}» y al menos el del principal`, () => {
        const pisoEquivalente = nivelMinimoDeAccion(par.equivalente);
        expect(nivelAlcanzaElPiso(pisoEquivalente, par.pisoMinimo), `${par.equivalente} bajó a ${pisoEquivalente}: ${par.motivo}`).toBe(true);
        expect(nivelAlcanzaElPiso(pisoEquivalente, nivelMinimoDeAccion(par.principal)), `${par.equivalente} (${pisoEquivalente}) no puede ser menos que ${par.principal}`).toBe(true);
      });

      it.each(par.puertas.map((p) => [p.archivo, p] as const))("%s: cada puerta pide la clave del equivalente", (archivo, puerta) => {
        const codigo = readFileSync(join(RAIZ, archivo), "utf8");
        const codigoDelAyudante = puerta.archivoDelAyudante ? readFileSync(join(RAIZ, puerta.archivoDelAyudante), "utf8") : codigo;
        expect(problemasDeLaPuerta(codigo, puerta, par.equivalente, codigoDelAyudante)).toEqual([]);
      });
    });
  }
});

/**
 * M.2-A4 (C): la pregunta «¿puede quien mira cambiar el precio, el factor y las unidades?» tiene UNA sola fuente. La pantalla y las acciones la calculaban cada una por su lado (`opciones-formulario.ts` y un ayudante local de
 * `productos.ts`): si una cambiaba la clave o el nivel y la otra no, la pantalla ofrecía lo que el servidor rechazaba (o al revés). Ahora la consulta vive en `src/server/acceso/campos-sensibles-de-producto.ts` y los demás la
 * importan. Por AST: ningún otro archivo de `src/` llama a una consulta de permiso con la clave `producto_campos_sensibles` (un comentario no cuenta).
 */
describe("la clave producto_campos_sensibles se consulta en un solo lugar", () => {
  const FUENTE_UNICA = "server/acceso/campos-sensibles-de-producto.ts";
  const SRC = join(RAIZ, "src");
  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
    });
  /** ¿Algún llamado a una consulta de permiso lleva la clave como texto? */
  const consultaLaClaveEnAlgunLugar = (codigo: string, clave: string): boolean => {
    let encontrado = false;
    const visitar = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && CONSULTAS_DE_PERMISO.has(n.expression.text) && n.arguments.some((a) => ts.isStringLiteralLike(a) && a.text === clave)) encontrado = true;
      ts.forEachChild(n, visitar);
    };
    visitar(fuente(codigo));
    return encontrado;
  };

  it("solo la fuente única la consulta", () => {
    const quienes = archivos(SRC)
      .filter((ruta) => consultaLaClaveEnAlgunLugar(readFileSync(ruta, "utf8"), "producto_campos_sensibles"))
      .map((ruta) => relative(SRC, ruta).split(sep).join("/"));
    expect(quienes, "La pantalla y las acciones tienen que importar `puedeEditarCamposSensiblesDelProducto` en vez de consultar la clave por su cuenta").toEqual([FUENTE_UNICA]);
  });

  it("el detector ve una consulta duplicada (fuente sintética)", () => {
    const copia = `export async function puede(ctx) { return (await obtenerMiNivelPermisoDeEmpresa(ctx.u, ctx.e, "producto_campos_sensibles", ctx.db)).editar; }`;
    expect(consultaLaClaveEnAlgunLugar(copia, "producto_campos_sensibles")).toBe(true);
    expect(consultaLaClaveEnAlgunLugar(`// obtenerMiNivelPermisoDeEmpresa(u, e, "producto_campos_sensibles", db)`, "producto_campos_sensibles")).toBe(false);
  });
});
