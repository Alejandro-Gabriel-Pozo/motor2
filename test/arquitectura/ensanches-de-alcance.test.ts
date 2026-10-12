import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENSANCHES_DEL_ALCANCE, ENSANCHE_DE_VERIFICACION, ensancheDespuesDelGate, ensanchesUsados, fuentesDe, funcionesDelArchivo, llamadasAEnsanches, usosDeLaBaseDeVerificacion } from "./guardas/ensanches";

/**
 * ENSANCHES DEL ALCANCE POR SUCURSAL (M.3-A4; plan `plan-m3-rls-por-sucursal`). El contexto del usuario arranca con alcance = la sucursal activa; lo único que lo agranda son las cinco funciones
 * de `src/server/acceso/alcance.ts` (cuatro hasta P2, que sumó `lecturaDeVerificacionEnLaEmpresa`) y el ayudante `permisoYAlcanceEnSucursal` de `src/server/actions/con-permiso.ts`. Este guardián fija lo que ninguna de las dos mitades de GT-4 ve sola:
 *  1. el CATÁLOGO de ensanches es cerrado: `alcance.ts` exporta exactamente esas funciones (una nueva sin declarar acá falla, una que ya no existe también);
 *  2. los envoltorios de «Ver» en otra sucursal (`requerirVerEnSucursal`, `requerirVerAlgunaEnSucursal`, forma `SUCURSAL_CON_GATE`) ensanchan la LECTURA y solo DESPUÉS del gate de esa sucursal;
 *  3. `permisoYAlcanceEnSucursal` (forma `GATE_EN_ESA_SUCURSAL`) ensancha lectura y escritura solo si `requierePermiso` en ESA sucursal dio ok;
 *  4. `lecturaEnSucursalesVisibles` se llama siempre con la clave como texto literal (de ella sale qué sucursales se ven);
 *  5. ningún otro archivo de `src/` llama a `conAlcanceEnSucursal` / `permisoYAlcanceEnSucursal` sin estar declarado en su forma de GT-4 (esa dirección la verifica `ids-de-sucursal-declaran-a-que-se-atan.test.ts`)
 *     y ningún archivo llama a los ensanches de escritura de empresa entera sin estar declarado (`escrituras-en-sucursal-desde-empresa.test.ts`).
 *  6. P2: `lecturaDeVerificacionEnLaEmpresa` ensancha SOLO la lectura (la escritura sale tal cual) y su lista de usos es CERRADA (`VERIFICACION`): los archivos que la llaman, a qué lectores les pasan su base (`<variable>.db` en la posición
 *     declarada), qué consultas directas arman con ella (`<variable>.db.<modelo>.<operación>`) y si abren la transacción con ella. Cada lector devuelve un sí/no, un mensaje, una cuenta o filas de tablas de la empresa (Producto, Insumo), nunca
 *     datos de otra sucursal; pasar la variable entera, desestructurarla o guardar su `.db` en otra variable es rojo. En las dos direcciones: un archivo no declarado que la llame falla, y una declaración que ya no se cumple también.
 * Mutaciones (rojo → revertido editando → verde): mover `conAlcanceEnSucursal` por encima de `exigirVer` en `requerirVerEnSucursal` (ensanche sin gate previo); cambiar `"LECTURA"` por
 * `"LECTURA_Y_ESCRITURA"` en un envoltorio de «Ver»; sacar el `if (!gate.ok)` de `permisoYAlcanceEnSucursal`; agregar una función exportada a `alcance.ts`; hacer que `lecturaDeVerificacionEnLaEmpresa` ensanche también la escritura; llamarla desde un archivo no
 * declarado; pasarle su base a un lector que no figura en `VERIFICACION`. Y los casos sintéticos de abajo.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** Las funciones que exporta `alcance.ts` y que ensanchan (el tipo `ModoDeAlcance` no cuenta). */
function exportadasComoFunciones(codigo: string): string[] {
  return [...codigo.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]!).sort();
}

describe("ensanches del alcance por sucursal: el catálogo es cerrado", () => {
  it("alcance.ts exporta exactamente cinco ensanches, y con el ayudante de con-permiso son los seis del guardián", () => {
    expect(exportadasComoFunciones(leer("src/server/acceso/alcance.ts"))).toEqual(["conAlcanceEnSucursal", "conEscrituraEnLaEmpresa", "incluirSucursalCreadaEnLaTransaccion", "lecturaDeVerificacionEnLaEmpresa", "lecturaEnSucursalesVisibles"]);
    expect(exportadasComoFunciones(leer("src/server/actions/con-permiso.ts"))).toContain("permisoYAlcanceEnSucursal");
    expect([...ENSANCHES_DEL_ALCANCE].sort()).toEqual(["conAlcanceEnSucursal", "conEscrituraEnLaEmpresa", "incluirSucursalCreadaEnLaTransaccion", "lecturaDeVerificacionEnLaEmpresa", "lecturaEnSucursalesVisibles", "permisoYAlcanceEnSucursal"]);
  });

  it("no hay un valor «todas»: ninguna función de alcance.ts recibe ni arma una lista con comodín", () => {
    const codigo = leer("src/server/acceso/alcance.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codigo).not.toMatch(/["'`]\*["'`]|["'`]todas["'`]/i);
  });
});

describe("SUCURSAL_CON_GATE: los envoltorios de «Ver» en otra sucursal ensanchan la lectura, y solo después del gate", () => {
  const conSesion = leer("src/server/actions/con-sesion.ts");
  const ENVOLTORIOS: Array<[string, string]> = [
    ["requerirVerEnSucursal", "exigirVer"],
    ["requerirVerAlgunaEnSucursal", "exigirVerAlguna"],
  ];

  it.each(ENVOLTORIOS)("%s llama a conAlcanceEnSucursal(ctx, sucursalId, \"LECTURA\") DESPUÉS de %s", (funcion, gate) => {
    expect(ensancheDespuesDelGate(conSesion, funcion, "conAlcanceEnSucursal", [gate])).toBe(true);
    const propias = llamadasAEnsanches(conSesion).filter((l) => l.funcion === funcion);
    expect(propias.map((l) => [l.ensanche, ...l.argumentos])).toEqual([["conAlcanceEnSucursal", "ctx", "sucursalId", '"LECTURA"']]);
  });

  it("ninguna otra función de con-sesion.ts ensancha nada (las lecturas de la sucursal activa no tocan el alcance)", () => {
    const ajenas = llamadasAEnsanches(conSesion).filter((l) => !ENVOLTORIOS.some(([f]) => f === l.funcion));
    expect(ajenas).toEqual([]);
  });
});

describe("GATE_EN_ESA_SUCURSAL: permisoYAlcanceEnSucursal ensancha lectura y escritura solo si el permiso EN esa sucursal dio ok", () => {
  const conPermiso = leer("src/server/actions/con-permiso.ts");

  it("pide requierePermiso antes, devuelve el rechazo del gate sin ensanchar y ensancha en modo LECTURA_Y_ESCRITURA", () => {
    expect(ensancheDespuesDelGate(conPermiso, "permisoYAlcanceEnSucursal", "conAlcanceEnSucursal", ["requierePermiso"])).toBe(true);
    const texto = funcionesDelArchivo(conPermiso).get("permisoYAlcanceEnSucursal")!.getText();
    expect(texto).toMatch(/requierePermiso\(\s*ctx\.usuarioId\s*,\s*sucursalId\s*,\s*accionClave\s*,/);
    // el rechazo del gate sale ANTES de la línea que ensancha
    expect(texto.indexOf("if (!gate.ok)")).toBeGreaterThan(-1);
    expect(texto.indexOf("if (!gate.ok)")).toBeLessThan(texto.indexOf("conAlcanceEnSucursal("));
    const propias = llamadasAEnsanches(conPermiso).filter((l) => l.funcion === "permisoYAlcanceEnSucursal");
    expect(propias.map((l) => [l.ensanche, ...l.argumentos])).toEqual([["conAlcanceEnSucursal", "ctx", "sucursalId", '"LECTURA_Y_ESCRITURA"']]);
  });

  it("ninguna otra función de con-permiso.ts ensancha nada (las acciones de la sucursal activa y de empresa no tocan el alcance)", () => {
    expect(llamadasAEnsanches(conPermiso).filter((l) => l.funcion !== "permisoYAlcanceEnSucursal")).toEqual([]);
  });
});

describe("lecturaEnSucursalesVisibles: la clave va como texto literal", () => {
  it("toda llamada de src/ le pasa la clave como literal (de ella sale qué sucursales se ven)", () => {
    const problemas: string[] = [];
    for (const [ruta, codigo] of fuentesDe(RAIZ, "src")) {
      if (ruta === "src/server/acceso/alcance.ts") continue;
      for (const l of llamadasAEnsanches(codigo, ["lecturaEnSucursalesVisibles"])) {
        if (!/^["'`][a-z_]+["'`]$/.test(l.argumentos[1] ?? "")) problemas.push(`${ruta}: lecturaEnSucursalesVisibles(${l.argumentos.join(", ")}) no lleva la clave como texto literal`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

/** Qué devuelve un lector de verificación: nunca datos de otra sucursal. */
type Devuelve = "SI_NO" | "MENSAJE" | "CONTEO" | "FILAS_DE_EMPRESA";
const DEVUELVE: readonly Devuelve[] = ["SI_NO", "MENSAJE", "CONTEO", "FILAS_DE_EMPRESA"];

interface UsoDeVerificacion {
  /** Los lectores a los que el archivo le pasa la base ampliada: nombre de la función → posición del argumento de base (desde 0). */
  lectores: Readonly<Record<string, number>>;
  /** Las consultas directas que arma con la base ampliada, como `db.<modelo>.<operación>`. */
  directos: readonly string[];
  /** El archivo abre la transacción con el contexto ampliado (`<variable>.transaccion(...)`). */
  transaccion?: true;
  /** La transacción ampliada se le pasa a una función que la abre: nombre → posición del argumento (`conTransaccionSerializable(<variable>.transaccion, …)`). */
  transaccionA?: Readonly<Record<string, number>>;
  /** El contexto ampliado entero se le pasa a una función que solo usa su `transaccion`: nombre → posición (`conGobierno(<variable>, …)`). */
  contextoA?: Readonly<Record<string, number>>;
  /** Qué sale de esos usos hacia quien llama o hacia la pantalla. */
  devuelve: Devuelve;
  motivo: string;
}

/**
 * LISTA CERRADA de los archivos que pueden llamar a `lecturaDeVerificacionEnLaEmpresa` (P2 del Paquete 1): los controles que preguntan «¿hay algo en ALGUNA sucursal?» y que, cuando rija la RLS por sucursal (Fase B),
 * verían solo la sucursal activa y darían un «no hay» equivocado. Es de SOLO LECTURA: la base ampliada solo se le pasa a los lectores declarados acá y solo se arman las consultas directas declaradas. Cada archivo dice qué devuelve.
 */
const VERIFICACION: Readonly<Record<string, UsoDeVerificacion>> = {
  // ── Catálogo: nombre repetido, unidad de stock de un insumo, ingrediente disponible ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts": {
    lectores: { validarDatosDeProducto: 0 },
    directos: [],
    devuelve: "MENSAJE",
    motivo: "alta de producto: «ya existe un producto disponible con ese nombre» y la unidad mezclada del insumo (`whereDisponibleEnAlguna`); devuelve el mensaje de rechazo",
  },
  "src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto-rapido.ts": {
    lectores: {},
    directos: ["db.producto.findFirst"],
    devuelve: "SI_NO",
    motivo: "alta rápida: ¿hay un producto disponible con ese nombre? (`findFirst` con `select: { id }`, solo se usa que exista)",
  },
  "src/server/actions/catalogo/casos-de-uso/actualizar-producto.ts": {
    lectores: {},
    directos: [],
    transaccion: true,
    devuelve: "MENSAJE",
    motivo: "edición: la transacción corre con la lectura en toda la empresa para el nombre repetido, la unidad del insumo y CAT-1 (`productoTieneHistoria`, `productoTieneLiquidaciones`: historia en cualquier sucursal); la escritura NO se ensancha. Sale un mensaje de rechazo",
  },
  "src/server/actions/catalogo/casos-de-uso/asignar-insumo-a-producto.ts": {
    lectores: { validarUnidadInsumo: 3 },
    directos: [],
    devuelve: "MENSAJE",
    motivo: "asignar el insumo: ¿otro producto disponible del insumo tiene otra unidad de stock? (la mezcla de unidades no tiene restricción en la base); devuelve el mensaje de rechazo",
  },
  "src/server/actions/catalogo/casos-de-uso/renombrar-o-fusionar-insumo.ts": {
    lectores: { validarFusionInsumos: 2 },
    directos: [],
    devuelve: "MENSAJE",
    motivo: "fusión de insumos: las unidades de stock de los productos disponibles del origen contra el destino; devuelve el mensaje de rechazo",
  },
  "src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts": {
    lectores: { cargarDatosParaValidarReceta: 0 },
    directos: [],
    devuelve: "FILAS_DE_EMPRESA",
    motivo: "guardar la receta: ¿cada ingrediente está disponible en alguna sucursal? y la unidad de los sustitutos; devuelve productos, insumos y unidades de la empresa y mensajes. Va ANTES del ensanche de escritura (`conEscrituraEnLaEmpresa`)",
  },
  "src/server/actions/catalogo/productos.ts": {
    lectores: {},
    directos: ["db.producto.findMany", "db.disponibilidadProducto.groupBy"],
    devuelve: "CONTEO",
    motivo: "el selector de producto con `soloDisponiblesEnAlguna` (filas de `Producto`: id, código y nombre) y el contador «Sucursales N de M» del listado (E3: una cuenta por producto; la disponibilidad ya es pública por la carta)",
  },
  "src/server/actions/catalogo/unidades.ts": {
    lectores: {},
    directos: ["db.insumo.findMany"],
    devuelve: "FILAS_DE_EMPRESA",
    motivo: "«insumos con unidad mezclada»: insumos con sus productos disponibles en alguna sucursal; sale el nombre del insumo, los nombres de las unidades y una cuenta",
  },
  "src/app/(app)/catalogo/recetas/page.tsx": {
    lectores: { listarProductosConReceta: 0 },
    directos: [],
    devuelve: "FILAS_DE_EMPRESA",
    motivo: "lista de recetas: productos disponibles en alguna sucursal con receta central (id, nombre, tipo, versión vigente)",
  },
  "src/app/(app)/catalogo/recetas/[productoId]/page.tsx": {
    lectores: { listarMpDisponiblesEnAlguna: 0, listarOpcionesDeSustituto: 1 },
    directos: [],
    devuelve: "FILAS_DE_EMPRESA",
    motivo: "editor de receta: las materias primas disponibles en alguna sucursal y las opciones de sustituto (insumos con un producto MP disponible); lo que muestra de cada sucursal sigue limitado por `lecturaEnSucursalesVisibles`",
  },
  "src/app/(app)/reportes/sin-receta/page.tsx": {
    lectores: { generarReporteVentasSinReceta: 2 },
    directos: [],
    devuelve: "FILAS_DE_EMPRESA",
    motivo: "ventas sin receta: el catálogo de productos del reporte (`construirMapaProductos(undefined, …)` marca «disponible en alguna sucursal»); recibe la base ampliada solo como `dbDelCatalogo`, las ventas se leen con la base de siempre",
  },
  // ── Traspasos y apagado de una sucursal: controles de la OTRA sucursal ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso.ts": {
    lectores: {},
    directos: [],
    transaccionA: { conTransaccionSerializable: 0 },
    devuelve: "SI_NO",
    motivo: "envío directo: ¿el producto está disponible en la sucursal DESTINO? (`verificarProductoTransferible`, un sí/no cuyo mensaje nombra solo la sucursal); la transacción SERIALIZABLE lee toda la empresa y escribe solo en la activa",
  },
  "src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso.ts": {
    lectores: {},
    directos: [],
    transaccionA: { conTransaccionSerializable: 0 },
    devuelve: "SI_NO",
    motivo: "solicitud: ¿el producto está disponible en la sucursal ORIGEN? (`verificarProductoTransferible`); misma transacción ampliada de solo lectura; el orden I3 → transición → chequeo de sección dada de baja no cambia",
  },
  "src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso.ts": {
    lectores: {},
    directos: [],
    transaccionA: { conTransaccionSerializable: 0 },
    devuelve: "SI_NO",
    motivo: "aprobar y enviar: ¿el producto está disponible en la sucursal DESTINO? (`verificarProductoTransferible`); misma transacción ampliada de solo lectura",
  },
  "src/server/actions/auth/casos-de-uso/actualizar-activo-sucursal.ts": {
    lectores: {},
    directos: [],
    contextoA: { conGobierno: 0 },
    devuelve: "MENSAJE",
    motivo: "P15, apagar una sucursal: los traspasos en camino y las mesas abiertas de la sucursal que se APAGA (que no es la activa de quien la apaga) se miran con toda la empresa; sigue siendo la MISMA transacción SERIALIZABLE de gobierno (`conGobierno` solo usa su `transaccion`) y la escritura de `Sucursal` es de gobierno. Sale un mensaje que nombra la sucursal y qué falta, como antes",
  },
  // ── Compras: aviso C25 de posible factura repetida ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  "src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts": {
    lectores: { cargarComprasParaAvisoDeDuplicado: 0 },
    directos: [],
    devuelve: "MENSAJE",
    motivo: "C25: las compras candidatas de TODA la empresa para el aviso; el texto da el día solo de las sucursales que quien carga ve (`avisoDePosibleDuplicado`) y nunca el importe ni el N.º de factura; no bloquea",
  },
};

describe("lecturaDeVerificacionEnLaEmpresa (P2): solo lectura y lista cerrada de usos", () => {
  it("ensancha SOLO la lectura: la escritura sale tal cual, nunca se une con las sucursales de la empresa", () => {
    const funcion = funcionesDelArchivo(leer("src/server/acceso/alcance.ts")).get(ENSANCHE_DE_VERIFICACION);
    expect(funcion, "alcance.ts tiene que definir lecturaDeVerificacionEnLaEmpresa").toBeDefined();
    const cuerpo = funcion!.getText();
    expect(cuerpo).toMatch(/escritura:\s*alcance\.escritura/);
    expect(cuerpo).not.toMatch(/unir\(\s*alcance\.escritura/);
    expect(cuerpo).toMatch(/unir\(\s*alcance\.lectura/);
    // las sucursales salen de la empresa del contexto
    expect(cuerpo).toMatch(/where:\s*\{\s*empresaId:\s*ctx\.empresaId\s*\}/);
  });

  it("cada archivo declarado la llama, guarda la base en una variable y la usa solo como declara", () => {
    const problemas: string[] = [];
    for (const [ruta, uso] of Object.entries(VERIFICACION)) {
      const codigo = leer(ruta);
      const r = usosDeLaBaseDeVerificacion(codigo);
      if (r.llamadas === 0) problemas.push(`${ruta}: declara usar ${ENSANCHE_DE_VERIFICACION} y ya no la llama (sacalo de VERIFICACION)`);
      if (r.sinVariable > 0) problemas.push(`${ruta}: ${r.sinVariable} llamada(s) no guardan la base ampliada en una variable (const x = await ${ENSANCHE_DE_VERIFICACION}(…))`);
      const permitidos = new Set<string>([...Object.entries(uso.lectores).map(([f, i]) => `lector:${f}@${i}`), ...uso.directos.map((d) => `directo:${d}`), ...(uso.transaccion ? ["transaccion"] : []), ...Object.entries(uso.transaccionA ?? {}).map(([f, i]) => `transaccion-a:${f}@${i}`), ...Object.entries(uso.contextoA ?? {}).map(([f, i]) => `contexto:${f}@${i}`)]);
      for (const u of new Set(r.usos)) if (!permitidos.has(u)) problemas.push(`${ruta}: usa la base ampliada como \`${u}\` y no está declarado (lectores, directos o transacción de VERIFICACION)`);
      for (const p of permitidos) if (!r.usos.includes(p)) problemas.push(`${ruta}: declara \`${p}\` y ya no lo usa (sacalo de VERIFICACION)`);
    }
    expect(problemas).toEqual([]);
  });

  it("la otra dirección: ningún archivo de src/ (fuera de alcance.ts) la llama sin estar en VERIFICACION", () => {
    const sinDeclarar: string[] = [];
    for (const [ruta, codigo] of fuentesDe(RAIZ, "src")) {
      if (ruta === "src/server/acceso/alcance.ts") continue;
      if (llamadasAEnsanches(codigo, [ENSANCHE_DE_VERIFICACION]).length > 0 && !(ruta in VERIFICACION)) sinDeclarar.push(ruta);
    }
    expect(sinDeclarar, "estos archivos llaman a lecturaDeVerificacionEnLaEmpresa y no figuran en VERIFICACION: declaralos con sus lectores y lo que devuelven, o usá otro ensanche").toEqual([]);
  });

  it("cada declaración tiene motivo, dice qué devuelve (sí/no, mensaje, cuenta o filas de la empresa) y usa algo", () => {
    for (const [ruta, uso] of Object.entries(VERIFICACION)) {
      expect(uso.motivo.trim().length, ruta).toBeGreaterThan(30);
      expect(DEVUELVE, ruta).toContain(uso.devuelve);
      expect(Object.keys(uso.lectores).length + uso.directos.length + (uso.transaccion ? 1 : 0) + Object.keys(uso.transaccionA ?? {}).length + Object.keys(uso.contextoA ?? {}).length, ruta).toBeGreaterThan(0);
    }
  });

  it("el detector sigue la base ampliada y rechaza lo que no esté declarado (casos sintéticos)", () => {
    const ARCHIVO = (cuerpo: string) => `import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";\nexport async function f(ctx: C) {\n${cuerpo}\n}\n`;
    const BIEN = ARCHIVO("  const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  const dup = await verificacion.db.producto.findFirst({});\n  return validarUnidadInsumo(a, b, c, verificacion.db);");
    expect(usosDeLaBaseDeVerificacion(BIEN)).toEqual({ llamadas: 1, sinVariable: 0, usos: ["directo:db.producto.findFirst", "lector:validarUnidadInsumo@3"] });
    // dentro de un condicional (el selector) y con la transacción
    expect(usosDeLaBaseDeVerificacion(ARCHIVO("  const v = filtro ? await lecturaDeVerificacionEnLaEmpresa(ctx) : ctx;\n  return v.transaccion(async (tx) => tx);"))).toEqual({ llamadas: 1, sinVariable: 0, usos: ["transaccion"] });
    // lo que NO está permitido: la variable entera, desestructurada, su .db en otra variable, otra consulta, el alcance
    for (const mala of [
      "  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  const { db } = v;\n  return db;",
      "  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  const base = v.db;\n  return base.movimientoStock.findMany({});",
      "  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  return v.alcance;",
      "  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  return { v };",
      "  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  return v.db.movimientoStock;",
    ]) {
      const r = usosDeLaBaseDeVerificacion(ARCHIVO(mala));
      expect(r.usos.some((u) => u.startsWith("otro:")), mala).toBe(true);
    }
    // la variable entera o su transacción como argumento de una función con nombre: se reconocen (y solo valen si VERIFICACION declara esa función y posición)
    expect(usosDeLaBaseDeVerificacion(ARCHIVO("  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  return conGobierno(v, async (tx) => tx);")).usos).toEqual(["contexto:conGobierno@0"]);
    expect(usosDeLaBaseDeVerificacion(ARCHIVO("  const v = await lecturaDeVerificacionEnLaEmpresa(ctx);\n  return conTransaccionSerializable(v.transaccion, async (tx) => tx);")).usos).toEqual(["transaccion-a:conTransaccionSerializable@0"]);
    // sin variable: la llamada se usa en el aire
    expect(usosDeLaBaseDeVerificacion(ARCHIVO("  return (await lecturaDeVerificacionEnLaEmpresa(ctx)).db.producto.findMany({});")).sinVariable).toBe(1);
    // los comentarios y las cadenas no cuentan
    expect(usosDeLaBaseDeVerificacion("// lecturaDeVerificacionEnLaEmpresa(ctx)\nconst a = \"lecturaDeVerificacionEnLaEmpresa(ctx)\";\nexport const x = 1;")).toEqual({ llamadas: 0, sinVariable: 0, usos: [] });
  });
});

describe("ningún ensanche se esconde detrás de un alias ni de un reexport", () => {
  it("todo archivo que importa un ensanche lo llama con su nombre (sin `as`, sin `export { … } from`, sin `import * as alcance`)", () => {
    const problemas: string[] = [];
    for (const [ruta, codigo] of fuentesDe(RAIZ, "src")) {
      if (ruta === "src/server/acceso/alcance.ts") continue;
      const llamados = new Set(llamadasAEnsanches(codigo).map((l) => l.ensanche as string));
      for (const usado of ensanchesUsados(codigo)) if (!llamados.has(usado)) problemas.push(`${ruta}: trae \`${usado}\` sin llamarlo con ese nombre (alias, reexport o import de espacio de nombres): los guardianes de GT-4 solo ven las llamadas directas`);
    }
    expect(problemas).toEqual([]);
  });

  it("el detector ve el alias, el reexport y el import de espacio de nombres (caso sintético)", () => {
    expect(ensanchesUsados('import { conEscrituraEnLaEmpresa as zz } from "@/server/acceso/alcance";\nexport const f = (c) => zz(c);')).toEqual(["conEscrituraEnLaEmpresa"]);
    expect(ensanchesUsados('export { conAlcanceEnSucursal } from "@/server/acceso/alcance";')).toEqual(["conAlcanceEnSucursal"]);
    expect(ensanchesUsados('import * as alcance from "@/server/acceso/alcance";\nexport const f = (c) => alcance.conEscrituraEnLaEmpresa(c);')).toEqual(["alcance(*)"]);
    expect(ensanchesUsados('import { gate } from "@/server/acceso/gate";')).toEqual([]);
  });
});

describe("el guardián en sí (casos sintéticos)", () => {
  const ENVOLTORIO = (cuerpo: string) => `export async function requerirVerEnSucursal(sucursalId: string, accion: string) {\n${cuerpo}\n}\n`;

  it("el ensanche DESPUÉS del gate pasa; antes del gate (la mutación), sin gate o sin ensanche, falla", () => {
    const bien = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nawait exigirVer(ctx, sucursalId, accion);\nreturn conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");');
    const antes = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nconst ampliado = conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");\nawait exigirVer(ctx, sucursalId, accion);\nreturn ampliado;');
    const sinGate = ENVOLTORIO('const ctx = await requerirSesionEnSucursal(sucursalId);\nreturn conAlcanceEnSucursal(ctx, sucursalId, "LECTURA");');
    const sinEnsanche = ENVOLTORIO("const ctx = await requerirSesionEnSucursal(sucursalId);\nawait exigirVer(ctx, sucursalId, accion);\nreturn ctx;");
    expect(ensancheDespuesDelGate(bien, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(true);
    expect(ensancheDespuesDelGate(antes, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(sinGate, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(sinEnsanche, "requerirVerEnSucursal", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
    expect(ensancheDespuesDelGate(bien, "otraFuncion", "conAlcanceEnSucursal", ["exigirVer"])).toBe(false);
  });

  it("encuentra las llamadas con su función, argumentos y sentencia; ignora comentarios y cadenas", () => {
    const codigo = `// conEscrituraEnLaEmpresa(ctx)\nconst nota = "conEscrituraEnLaEmpresa(ctx)";\nexport async function f(ctx) {\n  const a = 1;\n  const b = await conEscrituraEnLaEmpresa(ctx);\n  return b;\n}\nexport const g = async (tx) => {\n  await incluirSucursalCreadaEnLaTransaccion(tx, id);\n};\n`;
    expect(llamadasAEnsanches(codigo)).toEqual([
      { ensanche: "conEscrituraEnLaEmpresa", funcion: "f", argumentos: ["ctx"], sentencia: 1 },
      { ensanche: "incluirSucursalCreadaEnLaTransaccion", funcion: "g", argumentos: ["tx", "id"], sentencia: 0 },
    ]);
  });
});
