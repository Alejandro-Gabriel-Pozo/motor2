import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envoltoriosDe, exportadasSinEnvoltorio, problemasSinEnvoltorio, type Envoltorio } from "./guardas/envoltorio-y-clave";

/**
 * Server Action de la pieza «carta, catálogo y stock» → envoltorio y clave (Hito 4, paso H4C-0.2 de `docs/plan-hito-4-pureza.md` §3; mismo guardián que
 * `gobierno-envoltorio-y-clave.test.ts` y `pos-envoltorio-y-clave.test.ts`, con el mismo analizador: `guardas/envoltorio-y-clave.ts`).
 *
 * Las 51 mutaciones de la pieza (los 17 archivos de la pieza en `escrituras-fuera-de-persistencia.ts`) y `guardarReceta` se mudan a casos de uso en los
 * bloques A, B y C. Lo que NO puede cambiar en esa mudanza es con qué envoltorio y con qué clave entra cada una: muchas claves del catálogo y de la carta son
 * del mismo tipo (`AccionDeSucursal` o `AccionDeEmpresa`), así que cambiar `"carta_promo_definir"` por `"carta_promo_activar"` en un `conPermiso…` del
 * mismo tipo compila y le abre la acción a quien solo prende promos en su sucursal; pasar un `conPermiso` a `conPermisoDeEmpresa` (con un `as`) deja pasar
 * a quien tiene la clave en OTRA sucursal; y un guard de formato puesto ANTES del envoltorio le contestaría a quien no tiene permiso. Por cada archivo se
 * exige: que las funciones exportadas que llaman a un envoltorio de mutación sean EXACTAMENTE las declaradas (lista cerrada: una mutación nueva se declara
 * acá), que su PRIMERA sentencia sea `return <envoltorio>("<clave>", …)` y que envoltorio y clave sean los declarados.
 *
 * Archivo completo: `receta-sucursal.ts` declara también sus 5 acciones de la receta propia que ya pasan por `guardar-version-de-receta` (no son de la pieza,
 * pero viven en el mismo archivo y el analizador las ve), y `recetas.ts` solo `guardarReceta` (las acciones puntuales del editor delegan en ella, no llaman a
 * ningún envoltorio). Son las 52 de `test/permisos/tramo-c-rechaza-sin-permiso.test.ts` más esas 5.
 *
 * Hito 5, bloque D (`docs/plan-hito-5-pureza.md` §6.1): se suman las 19 funciones de las 8 acciones de configuración de la carta (`secciones`, `generos`,
 * `contenido-producto`, `items-agrupados`, `portal-empresa`, `registro-publico`, `tema`, `copiar-carta`), ANTES de mudarlas a casos de uso: 16 entran por
 * `conPermisoDeEmpresa` y 3 (`copiarCartaDeSucursal`, `guardarTemaCarta`, `cambiarAplicacionTema`) por `conPermiso`.
 */
const RAIZ = join(__dirname, "../../src/server/actions");

const SUC = (clave: string) => ({ envoltorio: "conPermiso" as Envoltorio, clave });
const EMP = (clave: string) => ({ envoltorio: "conPermisoDeEmpresa" as Envoltorio, clave });

/** `archivo` (relativo a `src/server/actions`) → función exportada → envoltorio y clave. */
const DECLARADAS: Record<string, Record<string, { envoltorio: Envoltorio; clave: string }>> = {
  "carta/descuento-producto.ts": {
    guardarDescuentoProducto: SUC("carta_producto_descuento"),
  },
  "carta/promos.ts": {
    guardarPromoCarta: EMP("carta_promo_definir"),
    actualizarActivaPromoCarta: EMP("carta_promo_definir"),
    actualizarActivaPromoCartaEnSucursal: SUC("carta_promo_activar"),
    guardarPrecioLocalPromoCarta: SUC("carta_promo_precio_local"),
    guardarCuposPromoCarta: EMP("carta_promo_definir"),
  },
  "movimientos/precio-local.ts": {
    setPrecioLocalProducto: SUC("precio_local"),
    sincronizarPrecioLocalGrupoCarta: SUC("precio_local"),
  },
  "catalogo/rendimiento-local.ts": {
    fijarRendimientoLocal: SUC("calibrar_rendimiento_local"),
    volverAlRendimientoCentral: SUC("calibrar_rendimiento_local"),
  },
  "catalogo/receta-sucursal.ts": {
    crearRecetaPropiaDesdeLaCentral: SUC("receta_sucursal_editar"),
    agregarIngredienteARecetaPropia: SUC("receta_sucursal_editar"),
    actualizarIngredienteDeRecetaPropia: SUC("receta_sucursal_editar"),
    quitarIngredienteDeRecetaPropia: SUC("receta_sucursal_editar"),
    copiarRecetaPropiaDeOtraSucursal: SUC("receta_sucursal_copiar"),
    volverALaRecetaCentral: SUC("receta_sucursal_volver_central"),
  },
  "catalogo/categorias-producto.ts": {
    crearCategoriaProducto: EMP("categoria_alta"),
    actualizarActivaCategoriaProducto: EMP("categorias"),
  },
  "catalogo/insumos.ts": {
    crearInsumo: EMP("insumo_alta"),
    actualizarActivoInsumo: EMP("grupos_familia"),
    actualizarGrupoDeInsumo: EMP("grupos_familia"),
    renombrarOFusionarInsumo: EMP("insumo_renombrar_fusionar"),
    crearOActualizarGrupo: EMP("grupos_familia"),
    actualizarActivoGrupo: EMP("grupos_familia"),
  },
  "catalogo/productos.ts": {
    asignarInsumoAProducto: EMP("producto_asignar_insumo"),
    darDeAltaProductoRapido: EMP("alta_producto"),
    darDeAltaProducto: EMP("alta_producto"),
    actualizarProducto: EMP("producto_editar"),
    sincronizarPrecioGrupoCarta: EMP("producto_sincronizar_precio_carta"),
    actualizarDisponibilidadProducto: SUC("producto_disponibilidad"),
    agregarPresentacionAlternativa: EMP("producto_presentaciones"),
    actualizarActivaPresentacion: EMP("producto_presentaciones"),
  },
  "catalogo/unidades.ts": {
    crearUnidad: EMP("unidades"),
    actualizarActivaUnidad: EMP("unidades"),
    actualizarDecimalesUnidad: EMP("unidades"),
  },
  "catalogo/proveedores.ts": {
    altaProveedor: EMP("proveedor_alta"),
    actualizarActivaProveedor: EMP("proveedores"),
    actualizarProveedor: EMP("proveedores"),
  },
  "clientes/cliente.ts": {
    altaCliente: EMP("clientes"),
    actualizarCliente: EMP("clientes"),
    actualizarActivoCliente: EMP("clientes"),
  },
  "reportes/margen-objetivo.ts": {
    guardarMargenObjetivo: EMP("margen_objetivo_editar"),
  },
  "movimientos/motivos.ts": {
    crearMotivoMerma: EMP("motivos_merma"),
    crearDestinoConsumo: EMP("motivos_destino_consumo"),
    actualizarActivoMotivoMerma: EMP("motivos_merma"),
    actualizarActivoDestinoConsumo: EMP("motivos_destino_consumo"),
  },
  "movimientos/secciones.ts": {
    crearSeccion: SUC("secciones"),
    renombrarSeccion: SUC("secciones"),
    actualizarActivaSeccion: SUC("secciones"),
    actualizarRespaldoSeccion: SUC("secciones"),
  },
  "stock/frecuencia-conteo.ts": {
    setFrecuenciaConteo: SUC("conteo_frecuencia"),
    eliminarFrecuenciaConteo: SUC("conteo_frecuencia"),
  },
  "stock/seccion-habitual.ts": {
    setSeccionHabitual: SUC("stock_seccion_habitual"),
    eliminarSeccionHabitual: SUC("stock_seccion_habitual"),
  },
  "stock/stock-minimo.ts": {
    setStockMinimoProducto: SUC("stock_minimo"),
    eliminarStockMinimo: SUC("stock_minimo"),
  },
  "catalogo/recetas.ts": {
    guardarReceta: EMP("guardar_receta"),
  },
  // Hito 5, bloque D (5.4-D): las 8 acciones de configuración de la carta (19 funciones; solo `copiar-carta` y `tema` son de contexto sucursal).
  "carta/secciones.ts": {
    guardarSeccionCarta: EMP("carta_secciones"),
    actualizarActivaSeccionCarta: EMP("carta_secciones"),
  },
  // S-10/D1 (O.59): géneros, contenido y ítems agrupados escriben en la carta de la sucursal ACTIVA: entran por `conPermiso` (clave de contexto sucursal), ya no por `conPermisoDeEmpresa`.
  "carta/generos.ts": {
    guardarGeneroCarta: SUC("carta_generos"),
    actualizarActivoGeneroCarta: SUC("carta_generos"),
  },
  "carta/contenido-producto.ts": {
    guardarContenidoCartaProducto: SUC("carta_contenido_producto"),
    actualizarVisibleEnCarta: SUC("carta_contenido_producto"),
  },
  "carta/items-agrupados.ts": {
    guardarItemAgrupadoCarta: SUC("carta_items_agrupados"),
    actualizarActivoItemAgrupadoCarta: SUC("carta_items_agrupados"),
    agregarOpcionItemAgrupadoCarta: SUC("carta_items_agrupados"),
    actualizarOrdenOpcionItemAgrupadoCarta: SUC("carta_items_agrupados"),
    quitarOpcionItemAgrupadoCarta: SUC("carta_items_agrupados"),
  },
  "carta/portal-empresa.ts": {
    guardarPortalEmpresa: EMP("carta_portal"),
  },
  "carta/registro-publico.ts": {
    agregarSucursalAlPortal: EMP("carta_portal"),
    guardarSucursalPublica: EMP("carta_portal"),
    quitarSucursalDelPortal: EMP("carta_portal"),
    moverSucursalEnMapa: EMP("carta_portal"),
  },
  "carta/tema.ts": {
    guardarTemaCarta: SUC("carta_tema"),
    cambiarAplicacionTema: SUC("carta_tema"),
  },
  "carta/copiar-carta.ts": {
    copiarCartaDeSucursal: SUC("carta_copiar_de_sucursal"),
  },
};

/**
 * Sin punto ciego (cierre del Hito 4, observación menor 3 de la auditoría independiente): `envoltoriosDe` no ve una función exportada que no llame a un
 * envoltorio de mutación, así que una mutación NUEVA abierta con un `requerirVer*` (solo el «Ver» de la pantalla) o declarada como `export const … = async …`
 * pasaba por al lado de este guardián (`acciones-con-guarda` solo exige que tenga ALGUNA guarda). Lista CERRADA, por archivo de DECLARADAS, de las exportadas
 * sin envoltorio: función → `"<guarda> — <motivo>"` (`exportadasSinEnvoltorio`/`problemasSinEnvoltorio`, `guardas/envoltorio-y-clave.ts`). Una exportada nueva
 * sin envoltorio, una que cambia de guarda o una de la lista que ya no existe → rojo.
 */
const LECTURA_H8 = "lectura (H8): pide el «Ver» de las pantallas que la consumen (con-sesion.ts); la clave la fijan lecturas-con-permiso-de-ver y lecturas-con-alguna-pantalla";
const lectura = (guarda: string) => `${guarda} — ${LECTURA_H8}`;
/** Las puntuales del editor de la receta central: leen la vigente con `obtenerRecetaVigente` (su «Ver») y GUARDAN delegando en `guardarReceta`. */
const DELEGA_EN_GUARDAR_RECETA =
  "requerirVerDeEmpresa — mutación puntual del editor de la receta central: lee la vigente con obtenerRecetaVigente y guarda delegando en guardarReceta (conPermisoDeEmpresa guardar_receta, declarada arriba); la delegación la exige acciones-con-guarda";
const SIN_ENVOLTORIO: Record<string, Readonly<Record<string, string>>> = {
  "movimientos/precio-local.ts": { obtenerPrecioLocalProducto: lectura("requerirVerEnSucursal"), listarPreciosLocales: lectura("requerirVerEnSucursal") },
  "catalogo/categorias-producto.ts": { listarCategoriasProducto: lectura("requerirVerAlguna") },
  "catalogo/insumos.ts": {
    listarInsumos: lectura("requerirVerAlguna"),
    listarGrupos: lectura("requerirVerDeEmpresa"),
    previsualizarFusionInsumo: lectura("requerirVerDeEmpresa"),
  },
  "catalogo/productos.ts": {
    buscarProductosSelector: lectura("requerirVerAlguna"),
    obtenerProductoOpcion: lectura("requerirVerAlguna"),
    obtenerInsumoDeProducto: lectura("requerirVerAlguna"),
    obtenerPrecioVentaProducto: lectura("requerirVer"),
    listarProductosPagina: lectura("requerirVerDeEmpresa"),
    listarPresentaciones: lectura("requerirVerAlguna"),
  },
  "catalogo/unidades.ts": {
    listarUnidadesParaPanel: lectura("requerirVerDeEmpresa"),
    listarUnidadesActivas: lectura("requerirVerAlguna"),
    detectarInsumosConUnidadMezclada:
      "obtenerContextoUsuario — lectura con el gate inline de insumos_mezclados (requierePermisoDeEmpresa) porque devuelve datos y no un ResultadoAccion; anotada en GUARDAS_A_MANO de acciones-con-guarda",
  },
  "catalogo/proveedores.ts": { listarProveedores: lectura("requerirVerDeEmpresa"), listarProveedoresParaSelector: lectura("requerirVerAlguna") },
  "clientes/cliente.ts": { listarClientes: lectura("requerirVerDeEmpresa"), listarClientesParaCuenta: lectura("requerirVer") },
  "movimientos/motivos.ts": {
    listarMotivosMermaActivos: lectura("requerirVer"),
    listarDestinosConsumoActivos: lectura("requerirVer"),
    listarMotivosMermaParaPanel: lectura("requerirVerDeEmpresa"),
    listarDestinosConsumoParaPanel: lectura("requerirVerDeEmpresa"),
  },
  "movimientos/secciones.ts": { listarSeccionesActivas: lectura("requerirVerAlgunaEnSucursal"), listarSeccionesParaPanel: lectura("requerirVerEnSucursal") },
  "stock/frecuencia-conteo.ts": { listarFrecuenciasConteo: lectura("requerirVerEnSucursal") },
  "stock/seccion-habitual.ts": { listarSeccionesHabituales: lectura("requerirVerEnSucursal") },
  "stock/stock-minimo.ts": { listarStockMinimo: lectura("requerirVerEnSucursal") },
  "catalogo/recetas.ts": {
    obtenerRecetaVigente: lectura("requerirVerDeEmpresa"),
    listarVersionesDeReceta: lectura("requerirVerDeEmpresa"),
    agregarIngredienteAReceta: DELEGA_EN_GUARDAR_RECETA,
    actualizarIngredienteDeReceta: DELEGA_EN_GUARDAR_RECETA,
    quitarIngredienteDeReceta: DELEGA_EN_GUARDAR_RECETA,
    agregarPasoAReceta: DELEGA_EN_GUARDAR_RECETA,
    actualizarPasoDeReceta: DELEGA_EN_GUARDAR_RECETA,
    quitarPasoDeReceta: DELEGA_EN_GUARDAR_RECETA,
    reordenarPasosDeReceta: DELEGA_EN_GUARDAR_RECETA,
    insertarPasoEnReceta: DELEGA_EN_GUARDAR_RECETA,
    actualizarCabeceraDeReceta: DELEGA_EN_GUARDAR_RECETA,
  },
};

/** Las 5 de la receta propia que ya pasaban por un caso de uso antes de esta pieza (están declaradas porque viven en un archivo de la pieza). */
const RECETA_PROPIA_YA_MIGRADAS = ["crearRecetaPropiaDesdeLaCentral", "agregarIngredienteARecetaPropia", "actualizarIngredienteDeRecetaPropia", "quitarIngredienteDeRecetaPropia", "copiarRecetaPropiaDeOtraSucursal"];

describe("tramo C (carta, catálogo y stock): cada Server Action entra por su envoltorio y su clave", () => {
  it.each(Object.keys(DECLARADAS))("%s: las mutaciones son las declaradas, con su envoltorio y su clave como primera sentencia", (archivo) => {
    const encontradas = Object.fromEntries(Object.entries(envoltoriosDe(readFileSync(join(RAIZ, archivo), "utf8"))).map(([f, e]) => [f, e.entrada]));
    const esperadas = Object.fromEntries(Object.entries(DECLARADAS[archivo]).map(([f, d]) => [f, `${d.envoltorio}:${d.clave}`]));
    expect(
      encontradas,
      `${archivo}: una mutación cambió de envoltorio o de clave, hay una sentencia antes del envoltorio, o hay una mutación nueva sin declarar. Si el cambio es a propósito, declaralo acá.`
    ).toEqual(esperadas);
  });

  it("son las 51 mutaciones de la pieza en 17 archivos, más guardarReceta (y las 5 de la receta propia que comparten archivo), más las 19 de configuración de la carta en 8 archivos", () => {
    const total = Object.values(DECLARADAS).reduce((n, fs) => n + Object.keys(fs).length, 0);
    expect(total).toBe(51 + 1 + RECETA_PROPIA_YA_MIGRADAS.length + 19);
    expect(Object.keys(DECLARADAS).filter((a) => a !== "catalogo/recetas.ts")).toHaveLength(17 + 8);
    for (const f of RECETA_PROPIA_YA_MIGRADAS) expect(DECLARADAS["catalogo/receta-sucursal.ts"][f], f).toBeDefined();
    // Bloque D: de las 19, 7 son de empresa (secciones, portal y registro público) y 12 de sucursal: copiar la carta y las dos del tema, y desde S-10/D1 (O.59) las 9 de géneros, contenido e ítems agrupados.
    const delBloqueD = ["carta/secciones.ts", "carta/generos.ts", "carta/contenido-producto.ts", "carta/items-agrupados.ts", "carta/portal-empresa.ts", "carta/registro-publico.ts", "carta/tema.ts", "carta/copiar-carta.ts"].flatMap((a) => Object.values(DECLARADAS[a]));
    expect(delBloqueD).toHaveLength(19);
    expect(delBloqueD.filter((d) => d.envoltorio === "conPermiso")).toHaveLength(12);
  });
});

describe("tramo C: ninguna función exportada queda fuera del guardián de envoltorio y clave", () => {
  it.each(Object.keys(DECLARADAS))("%s: las exportadas sin envoltorio de mutación son las declaradas, con su guarda", (archivo) => {
    const problemas = problemasSinEnvoltorio(exportadasSinEnvoltorio(readFileSync(join(RAIZ, archivo), "utf8")), SIN_ENVOLTORIO[archivo] ?? {});
    expect(problemas, `${archivo}:\n${problemas.join("\n")}`).toEqual([]);
  });

  it("la lista de exportadas sin envoltorio solo nombra archivos del guardián", () => {
    expect(Object.keys(SIN_ENVOLTORIO).filter((a) => !(a in DECLARADAS))).toEqual([]);
  });

  it("el detector del punto ciego: sin envoltorio ni entrada → rojo; con su guarda declarada → verde; guarda cambiada, entrada vieja o `export const` → rojo", () => {
    const fuente = [
      '"use server";',
      'import { conPermiso } from "../con-permiso";',
      'import { requerirVerAlguna, requerirVer } from "../con-sesion";',
      'export async function mutacion() { return conPermiso("secciones", async () => ok("")); }',
      'export async function lectura() { const ctx = await requerirVerAlguna(["a", "b"]); return ctx; }',
      'export async function borrarConSoloVer(id: string) { const ctx = await requerirVer("secciones"); await ctx.db.seccion.delete({ where: { id } }); }',
      'export const mutacionComoConst = async () => conPermiso("secciones", async () => ok(""));',
    ].join("\n");
    const encontradas = exportadasSinEnvoltorio(fuente);
    expect(encontradas).toEqual({ lectura: "requerirVerAlguna", borrarConSoloVer: "requerirVer", mutacionComoConst: "conPermiso" });
    // La lectura declarada con su guarda → verde; la mutación abierta con solo el «Ver» y la `export const` (que envoltoriosDe no mira) sin declarar → rojo.
    expect(problemasSinEnvoltorio(encontradas, { lectura: "requerirVerAlguna — lectura" })).toEqual([
      "borrarConSoloVer: exportada sin envoltorio de mutación y sin declarar (abre con requerirVer); si es una mutación, abrila con su envoltorio y su clave; si no, declarala con su motivo",
      "mutacionComoConst: exportada sin envoltorio de mutación y sin declarar (abre con conPermiso); si es una mutación, abrila con su envoltorio y su clave; si no, declarala con su motivo",
    ]);
    expect(problemasSinEnvoltorio({ lectura: "requerirVerAlguna" }, { lectura: "requerirVerAlguna — lectura" })).toEqual([]);
    // La guarda cambió, o la entrada quedó vieja → rojo.
    expect(problemasSinEnvoltorio({ lectura: "requerirVer" }, { lectura: "requerirVerAlguna — lectura" })).toEqual(['lectura: la guarda cambió (ahora requerirVer; anotada: «requerirVerAlguna — lectura»)']);
    expect(problemasSinEnvoltorio({}, { lectura: "requerirVerAlguna — lectura" })).toEqual([
      "lectura: declarada sin envoltorio pero ya no está así (no existe o ahora llama a un envoltorio): sacala de la lista",
    ]);
    // Una exportada sin ninguna guarda también aparece (con su estado), para que nunca se saltee en silencio.
    expect(exportadasSinEnvoltorio('"use server";\nexport async function abierta() { return 1; }')).toEqual({ abierta: "sin-guarda" });
  });
});
