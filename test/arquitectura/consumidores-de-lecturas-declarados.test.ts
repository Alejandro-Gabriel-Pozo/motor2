import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCION_POR_PROCESO } from "../../src/core/movimientos/transiciones";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Quién consume cada lectura de H8 y con qué clave (trabajo D.1 de `pureza-integracion`; mapa aprobado en `docs/plan-hito-3-pureza.md` §5).
 *
 * Regla del dueño (H8 D-1): una lectura exige el «Ver» de la pantalla que la consume; si la consumen pantallas con claves distintas, el «O» de esas claves (ni una
 * más, ni una menos). Para que eso no se desarme en silencio, este guardián fija TRES cosas:
 *  1. Los archivos de `src/app` y `src/components` que importan cada lectura son EXACTAMENTE los declarados acá (un consumidor nuevo obliga a declarar su clave,
 *     y con eso a decidir si la lectura la tiene que aceptar).
 *  2. Cada consumidor que es una página (`page.tsx`) pide de verdad la clave que se le declara (`requierePermisoVer*(…, "clave")` o, la página genérica de
 *     movimientos, la clave del proceso por `ACCION_POR_PROCESO`). Los componentes y ayudantes no tienen gate propio: la clave es la de las páginas que los
 *     muestran, dicha en `porque`.
 *  3. Si la lectura ya exige permiso (`requerirVer*`), sus claves literales son EXACTAMENTE la unión de las de sus consumidores. Mientras siga con solo sesión
 *     (`requerirSesion*`) no se compara: la vigila `lecturas-con-sesion-lista-cerrada.test.ts`.
 *
 * Se mira por AST: imports con alias `@/` o relativos; un comentario que nombre la lectura no cuenta.
 */
const SRC = join(__dirname, "../../src");

interface Consumo {
  claves: readonly AccionClave[];
  /** Para un componente o ayudante (sin gate propio): qué páginas lo muestran. */
  porque?: string;
}

interface LecturaDeclarada {
  /** Módulo de la Server Action, relativo a `src/` y sin extensión. */
  modulo: string;
  consumidores: Readonly<Record<string, Consumo>>;
}

const SELECTOR_DE_PRODUCTO: readonly AccionClave[] = [
  "proceso_compra",
  "proceso_produccion",
  "proceso_consumo",
  "proceso_ajuste",
  "proceso_transferencia",
  "proceso_merma",
  "proceso_devolucion_consignacion",
  "proceso_devolucion_cliente",
  "proceso_devolucion_proveedor",
  "proceso_venta",
  "proceso_control",
  "precio_local",
  "traspaso_solicitar",
  "traspaso_enviar_directo",
  "stock_minimo",
  "stock_seccion_habitual",
  "stock_reclasificar",
  "conteo_frecuencia",
  "reporte_conteos",
  "reporte_historial",
  "guardar_receta",
  "pos_mesas",
  "alta_producto",
  "producto_ver_catalogo",
];

const PROCESOS_DE_LA_PAGINA_GENERICA: readonly AccionClave[] = [
  "proceso_compra",
  "proceso_produccion",
  "proceso_consumo",
  "proceso_ajuste",
  "proceso_transferencia",
  "proceso_merma",
  "proceso_devolucion_consignacion",
  "proceso_devolucion_cliente",
  "proceso_devolucion_proveedor",
];

const FORMULARIO_DE_PRODUCTO = "el formulario de producto: alta (`catalogo/productos/nuevo`, alta_producto) y edición (`catalogo/productos/[id]/editar`, producto_ver_catalogo)";

const LECTURAS: Readonly<Record<string, LecturaDeclarada>> = {
  buscarProductosSelector: {
    modulo: "server/actions/catalogo/productos",
    consumidores: {
      "components/selector-producto.tsx": {
        claves: SELECTOR_DE_PRODUCTO,
        porque:
          "<SelectorProducto>: los 9 procesos de `movimientos/[proceso]`, venta, conteo físico, precio local, traspasos (solicitar y enviar), stock (mínimo, sección habitual, reclasificar, frecuencia de conteo), reportes de conteos e historial, nueva receta, agregar ítems del POS y el asistente de hermanar del formulario de producto",
      },
    },
  },
  obtenerProductoOpcion: {
    modulo: "server/actions/catalogo/productos",
    consumidores: {
      "app/(app)/movimientos/conteo-fisico/conteo-fisico-grid.tsx": { claves: ["proceso_control"], porque: "la grilla de `movimientos/conteo-fisico` (proceso_control)" },
      "app/(app)/reportes/conteos/page.tsx": { claves: ["reporte_conteos"] },
    },
  },
  obtenerInsumoDeProducto: {
    modulo: "server/actions/catalogo/productos",
    consumidores: { "components/catalogo/asistente-hermanar.tsx": { claves: ["alta_producto", "producto_ver_catalogo"], porque: FORMULARIO_DE_PRODUCTO } },
  },
  obtenerPrecioVentaProducto: {
    modulo: "server/actions/catalogo/productos",
    consumidores: { "app/(app)/movimientos/precio-local/precio-local-form.tsx": { claves: ["precio_local"], porque: "el formulario de `movimientos/precio-local` (precio_local)" } },
  },
  listarProductosPagina: {
    modulo: "server/actions/catalogo/productos",
    consumidores: { "app/(app)/catalogo/productos/page.tsx": { claves: ["producto_ver_catalogo"] } },
  },
  listarPresentaciones: {
    modulo: "server/actions/catalogo/productos",
    consumidores: {
      "app/(app)/catalogo/productos/[id]/page.tsx": { claves: ["producto_ver_catalogo"] },
      "app/(app)/catalogo/productos/[id]/editar/page.tsx": { claves: ["producto_ver_catalogo"] },
      "app/(app)/movimientos/[proceso]/panel-movimiento-form.tsx": {
        claves: ["proceso_compra", "proceso_devolucion_proveedor"],
        porque: "el formulario de `movimientos/[proceso]` las pide solo en los procesos tipo compra (`esCompraLike`: compra y devolución a proveedor)",
      },
      "components/catalogo/gestion-presentaciones.tsx": { claves: ["producto_ver_catalogo"], porque: "el formulario de producto solo al EDITAR una MP (`catalogo/productos/[id]/editar`, producto_ver_catalogo)" },
    },
  },
  listarInsumos: {
    modulo: "server/actions/catalogo/insumos",
    consumidores: {
      "app/(app)/catalogo/insumos-grupos/page.tsx": { claves: ["grupos_familia"] },
      "app/(app)/catalogo/productos/opciones-formulario.ts": { claves: ["alta_producto", "producto_ver_catalogo"], porque: FORMULARIO_DE_PRODUCTO },
    },
  },
  listarGrupos: {
    modulo: "server/actions/catalogo/insumos",
    consumidores: { "app/(app)/catalogo/insumos-grupos/page.tsx": { claves: ["grupos_familia"] } },
  },
  previsualizarFusionInsumo: {
    modulo: "server/actions/catalogo/insumos",
    consumidores: { "components/catalogo/form-renombrar-insumo.tsx": { claves: ["grupos_familia"], porque: "la tabla de `catalogo/insumos-grupos` (grupos_familia)" } },
  },
  listarMotivosMermaActivos: {
    modulo: "server/actions/movimientos/motivos",
    consumidores: { "app/(app)/movimientos/[proceso]/page.tsx": { claves: ["proceso_merma"], porque: "solo el proceso que pide motivo (`pideMotivo`: merma)" } },
  },
  listarDestinosConsumoActivos: {
    modulo: "server/actions/movimientos/motivos",
    consumidores: { "app/(app)/movimientos/[proceso]/page.tsx": { claves: ["proceso_consumo"], porque: "solo el proceso que pide destino (`pideDestino`: consumo)" } },
  },
  listarUnidadesParaPanel: {
    modulo: "server/actions/catalogo/unidades",
    consumidores: { "app/(app)/catalogo/unidades/page.tsx": { claves: ["unidades"] } },
  },
  listarUnidadesActivas: {
    modulo: "server/actions/catalogo/unidades",
    consumidores: {
      "app/(app)/movimientos/[proceso]/page.tsx": { claves: ["proceso_compra"], porque: "solo la compra (alta rápida de producto)" },
      "app/(app)/catalogo/recetas/[productoId]/page.tsx": { claves: ["guardar_receta"] },
      "app/(app)/catalogo/productos/opciones-formulario.ts": { claves: ["alta_producto", "producto_ver_catalogo"], porque: FORMULARIO_DE_PRODUCTO },
    },
  },
  obtenerSaldoDisponibleParaReclasificar: {
    modulo: "server/actions/stock/lecturas-reclasificacion",
    consumidores: { "app/(app)/stock/reclasificar/reclasificar-form.tsx": { claves: ["stock_reclasificar"], porque: "el formulario de `stock/reclasificar` (stock_reclasificar)" } },
  },
  listarSeccionesActivas: {
    modulo: "server/actions/movimientos/secciones",
    consumidores: {
      "app/(app)/movimientos/[proceso]/page.tsx": { claves: PROCESOS_DE_LA_PAGINA_GENERICA, porque: "los 9 procesos de la página genérica" },
      "app/(app)/movimientos/venta/page.tsx": { claves: ["proceso_venta"] },
      "app/(app)/movimientos/conteo-fisico/page.tsx": { claves: ["proceso_control"] },
      "app/(app)/reportes/conteos/page.tsx": { claves: ["reporte_conteos"] },
      "app/(app)/reportes/historial/page.tsx": { claves: ["reporte_historial"] },
      "app/(app)/stock/minimo/page.tsx": { claves: ["stock_minimo"] },
      "app/(app)/stock/reclasificar/page.tsx": { claves: ["stock_reclasificar"] },
      "app/(app)/stock/seccion-habitual/page.tsx": { claves: ["stock_seccion_habitual"] },
      "app/(app)/traspasos/page.tsx": { claves: ["traspaso_ver_bandeja"] },
      "app/(app)/traspasos/solicitar/page.tsx": { claves: ["traspaso_solicitar"] },
      "app/(app)/traspasos/enviar/page.tsx": { claves: ["traspaso_enviar_directo"] },
      "app/(pos)/mesas/[mesaId]/page.tsx": { claves: ["pos_mesas"] },
    },
  },
  // D-4: la ficha completa (contacto, CUIT, email, condiciones, notas) solo para la pantalla de Proveedores; los demás eligen con el selector.
  listarProveedores: {
    modulo: "server/actions/catalogo/proveedores",
    consumidores: { "app/(app)/catalogo/proveedores/page.tsx": { claves: ["proveedores"] } },
  },
  listarProveedoresParaSelector: {
    modulo: "server/actions/catalogo/proveedores",
    consumidores: {
      "app/(app)/movimientos/[proceso]/page.tsx": { claves: ["proceso_compra", "proceso_devolucion_proveedor"], porque: "los procesos que piden proveedor (`requiereProveedor`)" },
      "app/(app)/reportes/compras/page.tsx": { claves: ["reporte_compras"] },
      "app/(app)/catalogo/productos/opciones-formulario.ts": { claves: ["alta_producto", "producto_ver_catalogo"], porque: FORMULARIO_DE_PRODUCTO },
    },
  },
  listarCategoriasProducto: {
    modulo: "server/actions/catalogo/categorias-producto",
    consumidores: {
      "app/(app)/catalogo/categorias/page.tsx": { claves: ["categorias"] },
      "app/(app)/catalogo/productos/opciones-formulario.ts": { claves: ["alta_producto", "producto_ver_catalogo"], porque: FORMULARIO_DE_PRODUCTO },
    },
  },
  // D-3: el alta de producto (`catalogo/productos/nuevo`) ya no la consume; cuenta las sucursales con `contarSucursales` (server/consultas).
  listarSucursales: {
    modulo: "server/actions/auth/sucursales",
    consumidores: {
      "app/(app)/administracion/sucursales/page.tsx": { claves: ["alta_sucursal"] },
      "app/(app)/administracion/usuarios/page.tsx": { claves: ["gestion_usuarios"] },
    },
  },
};

/** Guarda de lectura → posición del argumento con la clave (`lista`: un arreglo literal). Las de solo sesión no llevan clave. */
const GUARDAS_DE_LECTURA: Readonly<Record<string, { indice: number; forma: "clave" | "lista" } | null>> = {
  requerirSesion: null,
  requerirSesionEnSucursal: null,
  requerirVer: { indice: 0, forma: "clave" },
  requerirVerDeEmpresa: { indice: 0, forma: "clave" },
  requerirVerEnSucursal: { indice: 1, forma: "clave" },
  requerirVerAlguna: { indice: 0, forma: "lista" },
  requerirVerAlgunaEnSucursal: { indice: 1, forma: "lista" },
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

const relativoASrc = (ruta: string) => relative(SRC, ruta).split(sep).join("/");

/** El módulo (relativo a `src/`, sin extensión) al que apunta un especificador de import, o `null` si es un paquete. */
function moduloDelEspecificador(especificador: string, archivo: string): string | null {
  if (especificador.startsWith("@/")) return especificador.slice(2);
  if (especificador.startsWith(".")) return relativoASrc(join(dirname(join(SRC, archivo)), especificador));
  return null;
}

/** `modulo|nombre importado` de cada import con nombre (de valor o de tipo) del fuente. */
function importsConNombre(archivo: string, fuente: string): string[] {
  const sf = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const salida: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const modulo = moduloDelEspecificador(stmt.moduleSpecifier.text, archivo);
    const enlaces = stmt.importClause?.namedBindings;
    if (!modulo || !enlaces || !ts.isNamedImports(enlaces)) continue;
    for (const el of enlaces.elements) salida.push(`${modulo}|${(el.propertyName ?? el.name).text}`);
  }
  return salida;
}

/** La primera guarda de lectura que llama la función exportada `nombre` del fuente, con sus claves literales (o `null` si no tiene ninguna). */
function guardaDeLaLectura(fuente: string, nombre: string): { funcion: string; claves: string[] } | null {
  const sf = ts.createSourceFile("x.ts", fuente, ts.ScriptTarget.Latest, true);
  const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === nombre);
  if (!fn?.body) return null;
  let hallada: { funcion: string; claves: string[] } | null = null;
  const visitar = (nodo: ts.Node): void => {
    if (hallada) return;
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && Object.hasOwn(GUARDAS_DE_LECTURA, nodo.expression.text)) {
      const forma = GUARDAS_DE_LECTURA[nodo.expression.text];
      const arg = forma ? nodo.arguments[forma.indice] : undefined;
      const elementos = !arg ? [] : forma?.forma === "lista" && ts.isArrayLiteralExpression(arg) ? [...arg.elements] : [arg];
      hallada = { funcion: nodo.expression.text, claves: elementos.map((e) => (ts.isStringLiteral(e) ? e.text : `<no literal: ${e.getText(sf)}>`)) };
      return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fn.body);
  return hallada;
}

const unionDeClaves = (lectura: LecturaDeclarada) => [...new Set(Object.values(lectura.consumidores).flatMap((c) => c.claves))].sort();

describe("consumidores de las lecturas de H8: declarados, con la clave de cada pantalla", () => {
  const importadores = new Map<string, string[]>();
  for (const ruta of [...archivos(join(SRC, "app")), ...archivos(join(SRC, "components"))]) {
    const archivo = relativoASrc(ruta);
    for (const imp of importsConNombre(archivo, readFileSync(ruta, "utf8"))) importadores.set(imp, [...(importadores.get(imp) ?? []), archivo]);
  }

  it.each(Object.entries(LECTURAS))("%s: los archivos de src/app y src/components que la importan son exactamente los declarados", (nombre, lectura) => {
    const reales = [...new Set(importadores.get(`${lectura.modulo}|${nombre}`) ?? [])].sort();
    expect(reales, `Consumidores de ${nombre} (${lectura.modulo}): declarar cada uno con la clave de su pantalla, o sacar los que ya no la importan`).toEqual(
      Object.keys(lectura.consumidores).sort(),
    );
  });

  const paginas = Object.entries(LECTURAS).flatMap(([nombre, l]) =>
    Object.entries(l.consumidores)
      .filter(([archivo]) => archivo.endsWith("/page.tsx"))
      .map(([archivo, c]) => ({ nombre, archivo, claves: c.claves })),
  );

  it.each(paginas)("$nombre: $archivo pide de verdad $claves", ({ archivo, claves }) => {
    const fuente = readFileSync(join(SRC, archivo), "utf8");
    for (const clave of claves) {
      if (fuente.includes("ACCION_POR_PROCESO[config.proceso]")) {
        expect(Object.values(ACCION_POR_PROCESO), `${clave} no es la clave de ningún proceso`).toContain(clave);
      } else {
        expect(fuente, `${archivo} no pide «${clave}»`).toMatch(new RegExp(`requierePermisoVer(?:DeEmpresa)?\\([^)]*"${clave}"`));
      }
    }
  });

  it.each(Object.entries(LECTURAS))("%s: si ya exige permiso, sus claves son exactamente las de sus consumidores", (nombre, lectura) => {
    const guarda = guardaDeLaLectura(readFileSync(join(SRC, `${lectura.modulo}.ts`), "utf8"), nombre);
    expect(guarda, `${nombre} no abre con ninguna guarda de lectura (con-sesion.ts)`).not.toBeNull();
    if (guarda!.funcion === "requerirSesion" || guarda!.funcion === "requerirSesionEnSucursal") return; // la vigila la lista cerrada
    expect([...guarda!.claves].sort(), `${nombre} (${guarda!.funcion}) no exige exactamente el «O» de las claves de sus pantallas`).toEqual(unionDeClaves(lectura));
  });

  it("el lector de guardas toma la lista literal y la clave suelta, y el de imports resuelve alias y rutas relativas", () => {
    const fuente = [
      'export async function a() { const ctx = await requerirVerAlguna(["proceso_compra", "alta_producto"]); return ctx; }',
      'export async function b(s: string) { return requerirVerAlgunaEnSucursal(s, ["pos_mesas"]); }',
      'export async function c() { return requerirVerDeEmpresa("unidades"); }',
      "export async function d() { return requerirSesion(); }",
      "export async function e() { return 1; }",
    ].join("\n");
    expect(guardaDeLaLectura(fuente, "a")).toEqual({ funcion: "requerirVerAlguna", claves: ["proceso_compra", "alta_producto"] });
    expect(guardaDeLaLectura(fuente, "b")).toEqual({ funcion: "requerirVerAlgunaEnSucursal", claves: ["pos_mesas"] });
    expect(guardaDeLaLectura(fuente, "c")).toEqual({ funcion: "requerirVerDeEmpresa", claves: ["unidades"] });
    expect(guardaDeLaLectura(fuente, "d")).toEqual({ funcion: "requerirSesion", claves: [] });
    expect(guardaDeLaLectura(fuente, "e")).toBeNull();
    expect(
      importsConNombre("app/(app)/x/page.tsx", ['import { a, b as c } from "@/server/actions/catalogo/productos";', 'import { d } from "../../../server/actions/auth/sucursales";'].join("\n")),
    ).toEqual(["server/actions/catalogo/productos|a", "server/actions/catalogo/productos|b", "server/actions/auth/sucursales|d"]);
  });
});
