import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * GT-3a y GT-25 (tanda T7 del endurecimiento de seguridad; S-15): NADA DE FILAS ENTERAS en los modelos con un campo sensible, y `select` obligatorio en las lecturas que se exportan.
 *
 * El problema: `include: { producto: true }` o un `findMany` sin `select` sobre `Producto` devuelven la fila ENTERA, con el costo de consignación, el consignante y lo que se agregue
 * mañana a la tabla. Si esa lectura es una Server Action exportada de un archivo "use server" (una puerta HTTP: quien tiene la clave de «Ver» la invoca a mano y recibe todo lo que
 * devuelve), o si su resultado llega como prop a un componente de cliente, el dato sensible sale a quien no tiene la clave que le corresponde. Método del dueño: el último punto donde se
 * decide es el `select` de la consulta, y devuelve solo lo que la pantalla dibuja.
 *
 * Los modelos con campo sensible son los de GT-1 (`SENSIBLES`): `Producto` (costo de consignación y consignante), `Proveedor` (CUIT, correo, condiciones de pago), `User` (correo, foto,
 * cuenta), `Operacion` (factura, proveedor), `MovimientoStock` (importes), `PagoConsignante` (importe), `Invitacion`, `Account` y `Session` (tokens). Las relaciones que apuntan a
 * ellos salen del `schema.prisma` (no se mantienen a mano).
 *
 * Qué se vigila, por AST (un comentario o un string no cuenta):
 *  1. FILA ENTERA: un `findMany`/`findFirst`/`findUnique` sobre un modelo sensible sin `select`, o un `include`/`select` que pide una relación a un modelo sensible sin un `select` propio:
 *     `{ rel: true }`, `{ rel: { include: … } }`, `{ rel: { where: … } }`, `{ rel: {} }` o `{ rel: <variable> }` (M-24 de la auditoría intermedia: antes solo se veía `true` y el `include`
 *     anidado —como `insumo.findMany({ include: { productos: { include: { unidadStock: true } } } })` de `catalogo/unidades.ts`, que este mismo commit reduce con `select`— pasaba).
 *     `_count: { select: { rel: true } }` cuenta filas y no las trae, así que no se marca.
 *     - En los archivos "use server" de `src/server/actions`: CERO excepciones (son puertas HTTP).
 *     - En `src/server/consultas` y `src/server/lecturas`: solo las de `FILAS_ENTERAS_EN_EL_SERVIDOR`, cada una con su clase y su motivo. La fila se queda en el servidor porque la función
 *       devuelve un tipo propio armado campo a campo (clase `DTO`, y el test exige que la función DECLARE su tipo de retorno), o porque es la ficha que su pantalla dibuja entera con su
 *       clave (clase `FICHA`). La lista SOLO se achica: una lectura nueva con fila entera falla hasta que alguien la reduzca con `select` o la anote acá con su motivo; una entrada que
 *       ya no existe también falla.
 *  2. GT-25, `select` obligatorio: en los archivos "use server", toda lectura de una función `listar*`/`obtener*` lleva `select` (o está en `SIN_SELECT`, con su motivo).
 *
 * Mutaciones (cada una pone un caso en rojo): `include: { creadoPor: true }` en la Bandeja de traspasos; sacar el `select` de `listarSucursales`; una lectura nueva de `Producto` sin `select` en
 * una consulta; una entrada de más en la lista.
 */
const RAIZ = join(__dirname, "../..");
const SENSIBLES = ["Producto", "Proveedor", "User", "Operacion", "MovimientoStock", "PagoConsignante", "Invitacion", "Account", "Session"];
const LECTURAS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow"]);

type Clase = "DTO" | "FICHA" | "INTERNO";

const DTO = (que: string) => ({ clase: "DTO" as Clase, motivo: `Devuelve un tipo propio, armado campo a campo (${que}): la fila entera no sale de la función.` });

/**
 * Las lecturas de `server/consultas` y `server/lecturas` que hoy leen una fila entera de un modelo sensible. Clave: `archivo|descripción|función`. Solo se achica.
 */
const FILAS_ENTERAS_EN_EL_SERVIDOR: Record<string, { clase: Clase; motivo: string }> = {
  "src/server/consultas/catalogo/productos.ts|producto.findUnique sin select|obtenerFichaProducto": {
    clase: "FICHA",
    motivo: "La ficha del producto dibuja casi todos sus campos. El costo de consignación y el consignante se anulan en la consulta salvo `conCostoDeConsignacion` (S-12, D8; test/consultas/catalogo/productos.test.ts).",
  },
  "src/server/consultas/catalogo/productos.ts|producto.findUnique sin select|obtenerProductoPorId": {
    clase: "FICHA",
    motivo: "El formulario de edición necesita los campos del producto. El costo de consignación y el consignante se anulan en la consulta salvo `conCostoDeConsignacion` (S-12, D8).",
  },
  "src/server/consultas/movimientos/stock-para-conteo.ts|producto.findMany sin select|listarStockParaConteo": DTO("FilaStockParaConteo"),
  "src/server/consultas/reportes/compras-registradas.ts|operacion.findMany sin select|listarComprasRegistradas": DTO("PaginaCompras, para `reporte_compras`"),
  // M-24: las dos de abajo ya estaban a la vista pero el detector solo veía `rel: true`; ahora ve `rel: { include/where }` (la fila entera ANIDADA). Misma función, mismo DTO.
  "src/server/consultas/reportes/compras-registradas.ts|include: { movimientos: { sin select } }|listarComprasRegistradas": DTO("PaginaCompras, para `reporte_compras`: las líneas se mapean campo a campo"),
  "src/server/consultas/reportes/historial-producto.ts|producto.findMany sin select|buscarProductoParaHistorial": DTO("FilaBusquedaProducto"),
  "src/server/consultas/reportes/historial-producto.ts|producto.findUnique sin select|obtenerHistorialProducto": DTO("HistorialProducto; el dinero se saca en la página con `reporte_historial_importes`"),
  "src/server/consultas/reportes/huecos-catalogo.ts|producto.findMany sin select|obtenerProblemasUnidadMezclada": DTO("ProblemaUnidadMezclada"),
  "src/server/consultas/reportes/rendimiento-recetas.ts|producto.findMany sin select|construirPools": DTO("Pool, interno del reporte de rendimiento"),
  "src/server/consultas/reportes/rendimiento-recetas.ts|include: { insumoProducto: { sin select } }|construirPools": DTO("Pool, interno del reporte de rendimiento: el ingrediente se reduce a lo que el pool usa"),
  "src/server/consultas/reportes/resumen-operativo.ts|producto.findMany sin select|obtenerResumenOperativo": DTO("ResumenOperativo"),
  "src/server/consultas/reportes/valuacion.ts|producto.findMany sin select|calcularValuacionInventario": DTO("ReporteValuacionInventario"),
  "src/server/consultas/reportes/vencimientos.ts|producto.findMany sin select|generarReporteLotesProximosAVencer": DTO("FilaLoteProximoAVencer"),
  "src/server/consultas/reportes/vencimientos.ts|include: { producto: true }|generarConciliacionVencimientos": DTO("FilaConciliacionVencimiento"),
  "src/server/consultas/stock/alertas.ts|producto.findMany sin select|calcularAlertasStock": DTO("alertas de stock"),
  "src/server/consultas/stock/consolidado.ts|producto.findMany sin select|calcularStockConsolidado": DTO("filas del consolidado"),
  "src/server/consultas/stock/por-familia.ts|producto.findMany sin select|calcularStockPorFamilia": DTO("FilaStockPorFamilia"),
  "src/server/lecturas/catalogo/datos-de-producto.ts|producto.findFirst sin select|validarDatosDeProducto": DTO("resultado de validación `{ error } | { numeros }`"),
  "src/server/lecturas/catalogo/ofertas-de-proveedor.ts|producto.findMany sin select|cargarProductosDeProveedorParaElCarrito": DTO("ProductoDeProveedor"),
  "src/server/lecturas/movimientos/saldos.ts|producto.findUnique sin select|resolverConsumoPorFamilia": DTO("el consumo resuelto"),
  "src/server/lecturas/reportes/comun.ts|producto.findMany sin select|cargarCatalogoDeProductos": {
    clase: "INTERNO",
    motivo: "El catálogo crudo en memoria de los reportes (`CatalogoDeProductos`; los importes de consignación hacen falta para costear): lo consumen las consultas de reportes, que devuelven sus propios tipos. No llega a una página ni a un cliente.",
  },
  "src/server/lecturas/reportes/comun.ts|include: { proveedorConsignacion: true }|cargarCatalogoDeProductos": {
    clase: "INTERNO",
    motivo: "Idem: el consignante entero queda en el catálogo en memoria de los reportes; PENDIENTE reducirlo a `{ id, nombre }` cuando se toque esa carga (cambia el tipo `CatalogoDeProductos`).",
  },
  "src/server/lecturas/reportes/comun.ts|include: { insumoProducto: true }|construirIndiceRecetas": DTO("el índice de recetas de los reportes"),
};

/**
 * GT-25: las lecturas `listar*`/`obtener*` de archivos "use server" que HOY no declaran `select`. Ninguna es de un modelo con campo sensible (eso lo prohíbe la primera regla, sin
 * excepciones): son tablas de catálogo o de configuración que su pantalla dibuja entera (nombre, estado, orden). Solo se achica: al reducir una con `select`, sale de la lista.
 */
const TABLA_DE_CATALOGO = "Tabla de catálogo o de configuración sin campo sensible: su pantalla dibuja la fila entera.";
const SIN_SELECT: Record<string, string> = {
  "src/server/actions/catalogo/categorias-producto.ts|categoriaProducto.findMany sin select|listarCategoriasProducto": TABLA_DE_CATALOGO,
  "src/server/actions/catalogo/insumos.ts|grupo.findMany sin select|listarGrupos": TABLA_DE_CATALOGO,
  "src/server/actions/catalogo/insumos.ts|insumo.findMany sin select|listarInsumos": TABLA_DE_CATALOGO,
  "src/server/actions/catalogo/productos.ts|presentacion.findMany sin select|listarPresentaciones": TABLA_DE_CATALOGO,
  "src/server/actions/catalogo/unidades.ts|unidad.findMany sin select|listarUnidadesActivas": TABLA_DE_CATALOGO,
  "src/server/actions/catalogo/unidades.ts|unidad.findMany sin select|listarUnidadesParaPanel": TABLA_DE_CATALOGO,
  "src/server/actions/clientes/cliente.ts|cliente.findMany sin select|listarClientes": "Cliente es nombre, % de descuento y estado: la pantalla «Clientes» (`clientes`, piso administrador) los dibuja enteros.",
  "src/server/actions/movimientos/motivos.ts|destinoConsumo.findMany sin select|listarDestinosConsumoActivos": TABLA_DE_CATALOGO,
  "src/server/actions/movimientos/motivos.ts|destinoConsumo.findMany sin select|listarDestinosConsumoParaPanel": TABLA_DE_CATALOGO,
  "src/server/actions/movimientos/motivos.ts|motivoMerma.findMany sin select|listarMotivosMermaActivos": TABLA_DE_CATALOGO,
  "src/server/actions/movimientos/motivos.ts|motivoMerma.findMany sin select|listarMotivosMermaParaPanel": TABLA_DE_CATALOGO,
  "src/server/actions/movimientos/precio-local.ts|precioLocalProducto.findUnique sin select|obtenerPrecioLocalProducto": "El precio local de un producto en la sucursal (precio, habilitado): lo dibuja el formulario de `precio_local`.",
  "src/server/actions/movimientos/secciones.ts|seccion.findMany sin select|listarSeccionesActivas": TABLA_DE_CATALOGO,
  "src/server/actions/movimientos/secciones.ts|seccion.findMany sin select|listarSeccionesParaPanel": TABLA_DE_CATALOGO,
  "src/server/actions/permisos/capacidades-sucursal.ts|accion.findMany sin select|listarCapacidades": "Catálogo de acciones y capacidades de la pantalla de gobierno (`capacidades_sucursal`, administrador de sistema).",
  "src/server/actions/permisos/capacidades-sucursal.ts|capacidadSucursal.findMany sin select|listarCapacidades": "Catálogo de acciones y capacidades de la pantalla de gobierno (`capacidades_sucursal`, administrador de sistema).",
  "src/server/actions/permisos/capacidades-sucursal.ts|sucursal.findMany sin select|listarCapacidades": "Catálogo de acciones y capacidades de la pantalla de gobierno (`capacidades_sucursal`, administrador de sistema).",
  "src/server/actions/permisos/permisos.ts|accion.findMany sin select|listarMatrizPermisos": "La matriz de permisos que dibuja la pantalla de gobierno (`gestion_permisos`, administrador de sistema).",
  "src/server/actions/permisos/permisos.ts|permisoRol.findMany sin select|listarMatrizPermisos": "La matriz de permisos que dibuja la pantalla de gobierno (`gestion_permisos`, administrador de sistema).",
  "src/server/actions/permisos/permisos.ts|rol.findMany sin select|listarMatrizPermisos": "La matriz de permisos que dibuja la pantalla de gobierno (`gestion_permisos`, administrador de sistema).",
  "src/server/actions/permisos/roles.ts|rol.findMany sin select|listarRoles": "Los roles de la empresa que dibuja la pantalla de gobierno (`gestion_roles`, administrador de sistema).",
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(n) ? [ruta] : [];
  });
}

const aRutaRelativa = (f: string) => relative(RAIZ, f).split(sep).join("/");

/** Los nombres de relación (campos de otros modelos) que apuntan a un modelo sensible, leídos del texto de un `schema.prisma` (recibe el texto: el guard se prueba con LF y con CRLF). */
function relacionesSensibles(schema: string): Set<string> {
  const modelos = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const nombres = new Set(modelos.map((m) => m[1]!));
  const salida = new Set<string>();
  for (const [, , cuerpo] of modelos) {
    for (const linea of cuerpo!.split("\n")) {
      // Después del tipo puede venir un blanco (atributos, comentario), un `\r` (CRLF) o NADA (LF: una relación de lista sin atributos termina la línea en `[]`): `(?:\s|$)`.
      const m = /^\s+(\w+)\s+(\w+)(\[\])?\??(?:\s|$)/.exec(linea);
      if (m && nombres.has(m[2]!) && SENSIBLES.includes(m[2]!)) salida.add(m[1]!);
    }
  }
  return salida;
}

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const MODELOS_SENSIBLES = new Set(SENSIBLES.map(minuscula));

function funcionQueContiene(nodo: ts.Node): { nombre: string; tipada: boolean } {
  let nombre = "(módulo)";
  let tipada = false;
  for (let p: ts.Node | undefined = nodo.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return { nombre: p.name.text, tipada: p.type !== undefined };
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) {
      nombre = p.name.text;
      tipada = p.initializer.type !== undefined;
    }
  }
  return { nombre, tipada };
}

const tienePropiedad = (o: ts.ObjectLiteralExpression, nombre: string) =>
  o.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === nombre);

/**
 * El objeto que dice QUÉ relaciones se piden: el de una propiedad `include`/`select`, o el de una constante cuyo nombre lo dice (`SELECT_BANDEJA`, `INCLUDE_BANDEJA`: así estaba la Bandeja de
 * traspasos, que un detector que mirara solo propiedades no veía).
 */
function objetoDeSeleccion(n: ts.Node): { etiqueta: string; objeto: ts.ObjectLiteralExpression } | undefined {
  const sinEnvoltorios = (e: ts.Expression): ts.Expression => (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e) ? sinEnvoltorios(e.expression) : e);
  if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && (n.name.text === "include" || n.name.text === "select")) {
    const valor = sinEnvoltorios(n.initializer);
    if (ts.isObjectLiteralExpression(valor)) return { etiqueta: n.name.text, objeto: valor };
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /select|include/i.test(n.name.text) && n.initializer) {
    const valor = sinEnvoltorios(n.initializer);
    if (ts.isObjectLiteralExpression(valor)) return { etiqueta: `const ${n.name.text}`, objeto: valor };
  }
  return undefined;
}

interface Hallazgo {
  clave: string;
  funcionTipada: boolean;
}

/**
 * Cómo se pide una relación sensible dentro de un `include`/`select`, si NO es con un `select` propio (M-24 de la auditoría intermedia: antes solo se veía `rel: true`, y
 * `rel: { include: … }`, `rel: { where: … }` o `rel: {}` traían la fila entera igual y pasaban). Devuelve `undefined` si la relación va con su `select` literal (o con `false`), y la forma
 * hallada si no: `rel: true`, `rel: { sin select }` (un objeto sin `select`) o `rel: <no literal>` (una variable, una condicional, un spread del que no se puede decir qué trae: falla cerrado).
 */
function formaDeFilaEntera(p: ts.ObjectLiteralElementLike, relaciones: ReadonlySet<string>): string | undefined {
  if (ts.isSpreadAssignment(p)) return undefined; // un spread de un `select` ajeno: lo vigila el `select` de su origen
  if (!ts.isIdentifier(p.name) || !relaciones.has(p.name.text)) return undefined;
  const nombre = p.name.text;
  if (ts.isShorthandPropertyAssignment(p)) return `${nombre}: <no literal>`;
  if (!ts.isPropertyAssignment(p)) return undefined;
  const valor = p.initializer;
  if (valor.kind === ts.SyntaxKind.FalseKeyword) return undefined;
  if (valor.kind === ts.SyntaxKind.TrueKeyword) return `${nombre}: true`;
  if (ts.isObjectLiteralExpression(valor)) return tienePropiedad(valor, "select") ? undefined : `${nombre}: { sin select }`;
  return `${nombre}: <no literal>`;
}

/** FILA ENTERA: lecturas de un modelo sensible sin `select` y relaciones sensibles pedidas con `true`, con un objeto sin `select` o con algo que no se puede leer. */
function filasEnteras(codigo: string, ruta: string, relaciones: ReadonlySet<string>): Hallazgo[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const salida: Hallazgo[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LECTURAS.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const modelo = n.expression.expression.name.text;
      if (MODELOS_SENSIBLES.has(modelo)) {
        const args = n.arguments[0];
        if (!args || !ts.isObjectLiteralExpression(args) || !tienePropiedad(args, "select")) {
          const f = funcionQueContiene(n);
          salida.push({ clave: `${ruta}|${modelo}.${n.expression.name.text} sin select|${f.nombre}`, funcionTipada: f.tipada });
        }
      }
    }
    const seleccion = objetoDeSeleccion(n);
    // `_count: { select: { movimientos: true } }` cuenta filas, no las trae: no es una fila entera.
    const esConteo = ts.isPropertyAssignment(n) && ts.isPropertyAssignment(n.parent.parent) && ts.isIdentifier(n.parent.parent.name) && n.parent.parent.name.text === "_count";
    if (seleccion && !esConteo) {
      for (const p of seleccion.objeto.properties) {
        const forma = formaDeFilaEntera(p, relaciones);
        if (forma) {
          const f = funcionQueContiene(n);
          salida.push({ clave: `${ruta}|${seleccion.etiqueta}: { ${forma} }|${f.nombre}`, funcionTipada: f.tipada });
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return salida;
}

/** GT-25: en las funciones `listar*`/`obtener*`, toda lectura (de cualquier modelo) sin `select`. */
function lecturasSinSelect(codigo: string, ruta: string): string[] {
  const fuente = ts.createSourceFile(ruta, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const salida: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LECTURAS.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const f = funcionQueContiene(n);
      if (/^(listar|obtener)/.test(f.nombre)) {
        const args = n.arguments[0];
        if (!args || !ts.isObjectLiteralExpression(args) || !tienePropiedad(args, "select")) salida.push(`${ruta}|${n.expression.expression.name.text}.${n.expression.name.text} sin select|${f.nombre}`);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return salida;
}

const esUseServer = (codigo: string) => /^\s*["']use server["']/.test(codigo);
const SCHEMA = readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8");
// Siempre con LF, como lo lee el CI de Linux: el guard ve lo mismo en cualquier sistema (I-4: con la regla vieja, en Windows —CRLF— veía relaciones que en Linux —LF— no).
const relaciones = relacionesSensibles(SCHEMA.replace(/\r\n/g, "\n"));

const deAcciones = archivos(join(RAIZ, "src/server/actions"))
  .map((f) => ({ ruta: aRutaRelativa(f), codigo: readFileSync(f, "utf8") }))
  .filter((a) => !a.ruta.includes("/casos-de-uso/") && esUseServer(a.codigo));
const deConsultasYLecturas = [...archivos(join(RAIZ, "src/server/consultas")), ...archivos(join(RAIZ, "src/server/lecturas"))].map((f) => ({
  ruta: aRutaRelativa(f),
  codigo: readFileSync(f, "utf8"),
}));

describe("GT-3a — nada de filas enteras de modelos con un campo sensible", () => {
  it("sanidad: el recorrido ve archivos y el schema da relaciones sensibles (no pasa en vacío)", () => {
    expect(deAcciones.length).toBeGreaterThan(20);
    expect(deConsultasYLecturas.length).toBeGreaterThan(50);
    for (const r of ["producto", "proveedor", "proveedorConsignacion", "creadoPor", "anuladaPor", "usuario"]) expect(relaciones.has(r), r).toBe(true);
    // Las relaciones de LISTA sin atributos (`movimientos MovimientoStock[]`) terminan la línea en `[]`: son las que la regla vieja perdía con LF (I-4 de la auditoría intermedia).
    for (const r of ["movimientos", "productos", "operaciones", "pagosConsignante", "accounts", "sessions"]) expect(relaciones.has(r), `${r} (relación de lista al final de la línea)`).toBe(true);
    expect(relaciones.has("sucursal")).toBe(false);
    expect(relaciones.has("seccion")).toBe(false);
  });

  describe("el guard ve las MISMAS relaciones con fin de línea LF (CI de Linux) y CRLF (Windows) — I-4 de la auditoría intermedia", () => {
    // Un schema mínimo con cada forma que importa: lista y opcional SIN atributos al final de la línea, y con atributos.
    const LINEAS = [
      "model Producto {",
      "  id String @id",
      "}",
      "",
      "model MovimientoStock {",
      "  id String @id",
      "}",
      "",
      "model Deposito {",
      "  id          String          @id",
      "  movimientos MovimientoStock[]",
      "  productos   Producto[]      @relation(\"x\")",
      "  principal   Producto?",
      "  otro        Producto        @relation(fields: [otroId], references: [id])",
      "  nombre      String",
      "}",
    ];
    const ESPERADAS = ["movimientos", "otro", "principal", "productos"];
    const conFin = (fin: string) => LINEAS.join(fin) + fin;

    it("sintético: LF, CRLF y sin salto final dan las cuatro relaciones", () => {
      expect([...relacionesSensibles(conFin("\n"))].sort()).toEqual(ESPERADAS);
      expect([...relacionesSensibles(conFin("\r\n"))].sort()).toEqual(ESPERADAS);
      expect([...relacionesSensibles(LINEAS.join("\n"))].sort()).toEqual(ESPERADAS);
    });

    it("el schema real: LF y CRLF dan exactamente el mismo conjunto", () => {
      const lf = SCHEMA.replace(/\r\n/g, "\n");
      const crlf = lf.replace(/\n/g, "\r\n");
      expect([...relacionesSensibles(lf)].sort()).toEqual([...relacionesSensibles(crlf)].sort());
    });
  });

  it("el detector (con fuentes sintéticas)", () => {
    const claves = (c: string) => filasEnteras(c, "x.ts", relaciones).map((h) => h.clave);
    expect(claves("export async function f(db) { return db.producto.findMany({ where: {} }); }")).toEqual(["x.ts|producto.findMany sin select|f"]);
    expect(claves("export async function f(db) { return db.producto.findMany({ where: {}, select: { id: true } }); }")).toEqual([]);
    expect(claves("export async function g(db) { return db.traspasoSucursal.findMany({ include: { creadoPor: true } }); }")).toEqual(["x.ts|include: { creadoPor: true }|g"]);
    expect(claves("export async function g(db) { return db.traspasoSucursal.findMany({ select: { creadoPor: { select: { email: true } } } }); }")).toEqual([]);
    expect(claves("export async function h(db) { return db.sucursal.findMany({ include: { seccion: true } }); }")).toEqual([]);
    // la Bandeja de traspasos guardaba el pedido en una constante (`INCLUDE_BANDEJA`): también se mira
    expect(claves("const SELECT_BANDEJA = { creadoPor: true } satisfies X;")).toEqual(["x.ts|const SELECT_BANDEJA: { creadoPor: true }|(módulo)"]);
    expect(claves("const SELECT_BANDEJA = { creadoPor: { select: { email: true } } } as const;")).toEqual([]);
    expect(claves("const ORDEN = { producto: true };")).toEqual([]);
    expect(claves("export const k = (db): X => db.proveedor.findUnique({ where: { id } });")).toEqual(["x.ts|proveedor.findUnique sin select|k"]);
    expect(filasEnteras("export const k = (db): X => db.proveedor.findUnique({ where: { id } });", "x.ts", relaciones)[0]!.funcionTipada).toBe(true);
    expect(claves("// db.producto.findMany({})\nexport const s = 'db.producto.findMany({})';")).toEqual([]);
  });

  it("el detector ve la fila entera ANIDADA: `rel: { include }`, `rel: { where }`, `rel: {}` y lo que no se puede leer (M-24 de la auditoría intermedia)", () => {
    const claves = (c: string) => filasEnteras(c, "x.ts", relaciones).map((h) => h.clave);
    // el caso real que la forma vieja no veía: `src/server/actions/catalogo/unidades.ts` (`insumo.findMany({ include: { productos: { where, include } } })`)
    expect(claves("export async function g(db) { return db.insumo.findMany({ include: { productos: { where: {}, include: { unidadStock: true } } } }); }")).toEqual(["x.ts|include: { productos: { sin select } }|g"]);
    expect(claves("export async function g(db) { return db.x.findMany({ include: { producto: { where: {} } } }); }")).toEqual(["x.ts|include: { producto: { sin select } }|g"]);
    expect(claves("export async function g(db) { return db.x.findMany({ include: { producto: {} } }); }")).toEqual(["x.ts|include: { producto: { sin select } }|g"]);
    // una relación pedida con una variable, una condicional o abreviada: no se puede decir qué trae → falla cerrado
    expect(claves("export async function g(db, v) { return db.x.findMany({ include: { producto: v } }); }")).toEqual(["x.ts|include: { producto: <no literal> }|g"]);
    expect(claves("export async function g(db, v) { return db.x.findMany({ include: { producto: v ? true : false } }); }")).toEqual(["x.ts|include: { producto: <no literal> }|g"]);
    expect(claves("export async function g(db, producto) { return db.x.findMany({ include: { producto } }); }")).toEqual(["x.ts|include: { producto: <no literal> }|g"]);
    // lo que NO es una fila entera: con su `select`, apagada con `false`, o un conteo (`_count` cuenta filas, no las trae)
    expect(claves("export async function g(db) { return db.x.findMany({ include: { producto: { select: { id: true } } } }); }")).toEqual([]);
    expect(claves("export async function g(db) { return db.x.findMany({ include: { producto: false } }); }")).toEqual([]);
    expect(claves("export async function g(db) { return db.x.findMany({ select: { _count: { select: { movimientos: true } } } }); }")).toEqual([]);
    // anidado dentro de un `select` de otra relación que sí lleva el suyo: se mira igual
    expect(claves("export async function g(db) { return db.x.findMany({ select: { sucursal: { select: { productos: true } } } }); }")).toEqual(["x.ts|select: { productos: true }|g"]);
  });

  it("las Server Actions de lectura (archivos «use server») no devuelven ninguna fila entera de un modelo sensible", () => {
    const halladas = deAcciones.flatMap((a) => filasEnteras(a.codigo, a.ruta, relaciones).map((h) => h.clave)).sort();
    expect(halladas, "una Server Action exportada es una puerta HTTP: pedí solo lo que la pantalla dibuja con `select`").toEqual([]);
  });

  it("las filas enteras de consultas y lecturas son exactamente las de FILAS_ENTERAS_EN_EL_SERVIDOR", () => {
    const halladas = deConsultasYLecturas.flatMap((a) => filasEnteras(a.codigo, a.ruta, relaciones));
    expect(
      halladas.map((h) => h.clave).sort(),
      "una lectura nueva con fila entera de un modelo sensible lleva `select` (o se anota con su motivo); una entrada que ya no existe sale de la lista",
    ).toEqual(Object.keys(FILAS_ENTERAS_EN_EL_SERVIDOR).sort());
  });

  it("cada entrada tiene su motivo, y las de clase DTO viven en una función que declara su tipo de retorno", () => {
    const halladas = new Map(deConsultasYLecturas.flatMap((a) => filasEnteras(a.codigo, a.ruta, relaciones)).map((h) => [h.clave, h]));
    for (const [clave, { clase, motivo }] of Object.entries(FILAS_ENTERAS_EN_EL_SERVIDOR)) {
      expect(motivo.length, clave).toBeGreaterThan(30);
      if (clase === "DTO") expect(halladas.get(clave)?.funcionTipada, `${clave}: la función tiene que declarar el tipo que devuelve (si no, nada impide devolver la fila)`).toBe(true);
    }
  });
});

describe("GT-25 — select obligatorio en las lecturas listar*/obtener* de las Server Actions", () => {
  it("el detector (con fuentes sintéticas)", () => {
    expect(lecturasSinSelect("export async function listarX(db) { return db.sucursal.findMany({ orderBy: {} }); }", "x.ts")).toEqual(["x.ts|sucursal.findMany sin select|listarX"]);
    expect(lecturasSinSelect("export async function listarX(db) { return db.sucursal.findMany({ select: { id: true } }); }", "x.ts")).toEqual([]);
    expect(lecturasSinSelect("export async function crearX(db) { return db.sucursal.findMany({}); }", "x.ts")).toEqual([]);
    expect(lecturasSinSelect("export async function obtenerX(db) { return db.sucursal.findUnique({ where: {} }); }", "x.ts")).toEqual(["x.ts|sucursal.findUnique sin select|obtenerX"]);
  });

  it("las lecturas sin select son exactamente las de SIN_SELECT", () => {
    const halladas = deAcciones.flatMap((a) => lecturasSinSelect(a.codigo, a.ruta)).sort();
    expect(halladas, "toda lectura exportada declara su `select` (o se anota en SIN_SELECT con su motivo)").toEqual(Object.keys(SIN_SELECT).sort());
  });

  it("ninguna lectura de SIN_SELECT es de un modelo con campo sensible, y cada una tiene su motivo", () => {
    for (const [clave, motivo] of Object.entries(SIN_SELECT)) {
      const modelo = clave.split("|")[1]!.split(".")[0]!;
      expect(MODELOS_SENSIBLES.has(modelo), `${clave}: un modelo sensible nunca va sin select`).toBe(false);
      expect(motivo.length, clave).toBeGreaterThan(30);
    }
  });
});
