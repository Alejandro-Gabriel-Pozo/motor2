import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../setup/next-headers-stub";
import { textoDeDenegacion } from "../../src/core/permisos/motivos";
import { ACCIONES, type AccionDeEmpresa, type AccionDeSucursal } from "../../src/core/permisos/acciones";
import type { ResultadoAccion } from "../../src/server/actions/tipos";
import { guardarDescuentoProducto } from "../../src/server/actions/carta/descuento-producto";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarCuposPromoCarta,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
} from "../../src/server/actions/carta/promos";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../src/server/actions/movimientos/precio-local";
import { fijarRendimientoLocal, volverAlRendimientoCentral } from "../../src/server/actions/catalogo/rendimiento-local";
import { volverALaRecetaCentral } from "../../src/server/actions/catalogo/receta-sucursal";
import { actualizarActivaCategoriaProducto, crearCategoriaProducto } from "../../src/server/actions/catalogo/categorias-producto";
import {
  actualizarActivoGrupo,
  actualizarActivoInsumo,
  actualizarGrupoDeInsumo,
  crearInsumo,
  crearOActualizarGrupo,
  renombrarOFusionarInsumo,
} from "../../src/server/actions/catalogo/insumos";
import {
  actualizarActivaPresentacion,
  actualizarDisponibilidadProducto,
  actualizarProducto,
  agregarPresentacionAlternativa,
  asignarInsumoAProducto,
  darDeAltaProducto,
  darDeAltaProductoRapido,
  sincronizarPrecioGrupoCarta,
} from "../../src/server/actions/catalogo/productos";
import { actualizarActivaUnidad, actualizarDecimalesUnidad, crearUnidad } from "../../src/server/actions/catalogo/unidades";
import { actualizarActivaProveedor, actualizarProveedor, altaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { actualizarActivoCliente, actualizarCliente, altaCliente } from "../../src/server/actions/clientes/cliente";
import { guardarMargenObjetivo } from "../../src/server/actions/reportes/margen-objetivo";
import { actualizarActivoDestinoConsumo, actualizarActivoMotivoMerma, crearDestinoConsumo, crearMotivoMerma } from "../../src/server/actions/movimientos/motivos";
import { actualizarActivaSeccion, actualizarRespaldoSeccion, crearSeccion, renombrarSeccion } from "../../src/server/actions/movimientos/secciones";
import { eliminarFrecuenciaConteo, setFrecuenciaConteo } from "../../src/server/actions/stock/frecuencia-conteo";
import { eliminarSeccionHabitual, setSeccionHabitual } from "../../src/server/actions/stock/seccion-habitual";
import { eliminarStockMinimo, setStockMinimoProducto } from "../../src/server/actions/stock/stock-minimo";
import { guardarReceta } from "../../src/server/actions/catalogo/recetas";
import { actualizarActivaSeccionCarta, guardarSeccionCarta } from "../../src/server/actions/carta/secciones";
import { actualizarActivoGeneroCarta, guardarGeneroCarta } from "../../src/server/actions/carta/generos";
import { actualizarVisibleEnCarta, guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import {
  actualizarActivoItemAgrupadoCarta,
  actualizarOrdenOpcionItemAgrupadoCarta,
  agregarOpcionItemAgrupadoCarta,
  guardarItemAgrupadoCarta,
  quitarOpcionItemAgrupadoCarta,
} from "../../src/server/actions/carta/items-agrupados";
import { guardarPortalEmpresa } from "../../src/server/actions/carta/portal-empresa";
import { agregarSucursalAlPortal, guardarSucursalPublica, moverSucursalEnMapa, quitarSucursalDelPortal } from "../../src/server/actions/carta/registro-publico";
import { cambiarAplicacionTema, guardarTemaCarta } from "../../src/server/actions/carta/tema";
import { copiarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";

/**
 * Red del Hito 4, pieza «carta, catálogo y stock» (paso H4C-0.1 de `docs/plan-hito-4-pureza.md` §3), ANTES de mover ninguna de sus acciones a un caso de uso:
 * cada una de las 51 mutaciones de la pieza (17 archivos de `src/server/actions`, las 17 entradas «Fase 4» de esta pieza en `escrituras-fuera-de-persistencia.ts`)
 * más `guardarReceta` (O.1) rechaza a quien no tiene su permiso, con el texto EXACTO del guard (`core/permisos/motivos.ts`), y al rechazar no cambia NINGUNA
 * tabla de lo que la pieza toca (la foto de 27 tablas, la auditoría incluida, queda idéntica y `registroAuditoria.count` no se mueve). Tres actores:
 *   - un rol PROPIO sin ninguna fila de la matriz (`vacio`): rechaza todo;
 *   - un rol propio (sin clave: nivel operario) con la fila Ver+Editar de las 52 claves (`encargado`): el piso manda sobre la fila
 *     (`decision-de-acceso.ts`), así que rechaza las de piso «administrador» (las de piso «operario» —altas rápidas, disponibilidad, frecuencia de conteo,
 *     presentaciones…— sí las tiene, y no entran en este caso);
 *   - para las 19 de contexto SUCURSAL, alguien que tiene la clave en OTRA sucursal (admin en Norte) y está parado en Central con el rol `vacio`: el permiso de
 *     una sucursal no se presta a otra. Un `conPermiso` cambiado por `conPermisoDeEmpresa` lo dejaría pasar (la empresa mira todas sus membresías).
 *
 * Antes de este test, ~38 de las 52 no tenían ningún test de rechazo (entre ellas las 5 de promos y `setPrecioLocalProducto`, que son dinero).
 *
 * Hito 5, bloque D (`docs/plan-hito-5-pureza.md` §6.1): se suman las 19 funciones de las 8 acciones de configuración de la carta (`secciones`, `generos`,
 * `contenido-producto`, `items-agrupados`, `portal-empresa`, `registro-publico`, `tema`, `copiar-carta`), con su red ANTES de mudarlas: 71 en total. 16 son de
 * contexto empresa y 3 de sucursal (`copiarCartaDeSucursal`, `guardarTemaCarta`, `cambiarAplicacionTema`). La foto suma las 8 tablas de la carta que escriben
 * (`seccionCarta`, `generoCarta`, `contenidoCartaProducto`, `itemAgrupadoCarta`, `opcionItemAgrupadoCarta`, `portalCartaEmpresa`, `sucursalPublica`,
 * `temaCartaSucursal`). `copiarCartaDeSucursal` tiene un `preparar`: solo escribe sobre una carta VACÍA, así que antes de la foto se vacía la carta de Central y se
 * le da una carta propia a Norte (si no, sin el guard igual terminaría en «ya tiene carta propia» sin escribir y la foto no distinguiría nada).
 *
 * Los argumentos apuntan a filas REALES en el estado en que cada acción escribe (un producto en un ítem agrupado de la carta para las sincronizaciones, una
 * línea de la receta vigente con su calibración, una receta propia habilitada, filas de frecuencia, sección habitual y stock mínimo para borrar…): sin el
 * guard, cada llamada escribiría. Por eso un envoltorio que se cae, o una clave cambiada por otra, pone este test en rojo por dos lados: el mensaje deja de
 * ser el del guard y la foto cambia (las dos aserciones son `expect.soft`: se ven las dos).
 */

interface Escenario {
  centralId: string;
  flanId: string;
  pizzaId: string;
  fainaId: string;
  empanadaId: string;
  harina000Id: string;
  quesoCremosoId: string;
  kgId: string;
  uId: string;
  cajaId: string;
  categoriaId: string;
  insumoHarinaId: string;
  insumoQuesoId: string;
  grupoId: string;
  presentacionId: string;
  proveedorId: string;
  clienteId: string;
  motivoId: string;
  destinoId: string;
  depositoId: string;
  frecuenciaId: string;
  seccionHabitualId: string;
  stockMinimoId: string;
  seccionCartaId: string;
  promoId: string;
  lineaDeRecetaId: string;
  // Bloque D (configuración de la carta).
  norteId: string;
  generoId: string;
  itemVacioId: string;
  opcionPizzaId: string;
  opcionFainaId: string;
}

type Contexto = "sucursal" | "empresa";

interface Mutacion {
  nombre: string;
  clave: AccionDeSucursal | AccionDeEmpresa;
  /** Con qué envoltorio entra: `sucursal` = `conPermiso` (mira la sucursal activa), `empresa` = `conPermisoDeEmpresa` (alguna membresía de la empresa). */
  contexto: Contexto;
  llamar: (e: Escenario) => Promise<ResultadoAccion>;
  /** Deja la base en el estado en que la mutación ESCRIBIRÍA sin el guard; corre antes de la foto. */
  preparar?: (e: Escenario) => Promise<void>;
}

const linea = (e: Escenario, cantidad: number) => ({ insumoProductoId: e.harina000Id, cantidad, unidadId: e.kgId, mermaPorcentaje: 0 });

const MUTACIONES: Mutacion[] = [
  // Dinero de carta (4.2).
  { nombre: "guardarDescuentoProducto", clave: "carta_producto_descuento", contexto: "sucursal", llamar: (e) => guardarDescuentoProducto(e.flanId, 15) },
  { nombre: "guardarPromoCarta", clave: "carta_promo_definir", contexto: "empresa", llamar: (e) => guardarPromoCarta({ seccionCartaId: e.seccionCartaId, titulo: "Promo nueva", precio: 8000 }) },
  { nombre: "actualizarActivaPromoCarta", clave: "carta_promo_definir", contexto: "empresa", llamar: (e) => actualizarActivaPromoCarta(e.promoId, false) },
  { nombre: "actualizarActivaPromoCartaEnSucursal", clave: "carta_promo_activar", contexto: "sucursal", llamar: (e) => actualizarActivaPromoCartaEnSucursal(e.promoId, false) },
  { nombre: "guardarPrecioLocalPromoCarta", clave: "carta_promo_precio_local", contexto: "sucursal", llamar: (e) => guardarPrecioLocalPromoCarta(e.promoId, 9000) },
  {
    nombre: "guardarCuposPromoCarta",
    clave: "carta_promo_definir",
    contexto: "empresa",
    llamar: (e) => guardarCuposPromoCarta(e.promoId, [{ seccionCartaId: e.seccionCartaId, cantidadMaxima: 1 }]),
  },
  { nombre: "setPrecioLocalProducto", clave: "precio_local", contexto: "sucursal", llamar: (e) => setPrecioLocalProducto(e.pizzaId, 13000, true) },
  {
    nombre: "sincronizarPrecioLocalGrupoCarta",
    clave: "precio_local",
    contexto: "sucursal",
    llamar: (e) => sincronizarPrecioLocalGrupoCarta(e.centralId, [e.pizzaId, e.fainaId], 13000, true),
  },
  {
    nombre: "fijarRendimientoLocal",
    clave: "calibrar_rendimiento_local",
    contexto: "sucursal",
    llamar: (e) => fijarRendimientoLocal(e.lineaDeRecetaId, { cantidad: 0.3, mermaPorcentaje: null }),
  },
  { nombre: "volverAlRendimientoCentral", clave: "calibrar_rendimiento_local", contexto: "sucursal", llamar: (e) => volverAlRendimientoCentral(e.lineaDeRecetaId) },
  { nombre: "volverALaRecetaCentral", clave: "receta_sucursal_volver_central", contexto: "sucursal", llamar: (e) => volverALaRecetaCentral(e.empanadaId, true) },
  // Catálogo (4.3).
  { nombre: "crearCategoriaProducto", clave: "categoria_alta", contexto: "empresa", llamar: () => crearCategoriaProducto("Bebidas") },
  { nombre: "actualizarActivaCategoriaProducto", clave: "categorias", contexto: "empresa", llamar: (e) => actualizarActivaCategoriaProducto(e.categoriaId, false) },
  { nombre: "crearInsumo", clave: "insumo_alta", contexto: "empresa", llamar: () => crearInsumo("Azúcar") },
  { nombre: "actualizarActivoInsumo", clave: "grupos_familia", contexto: "empresa", llamar: (e) => actualizarActivoInsumo(e.insumoHarinaId, false) },
  { nombre: "actualizarGrupoDeInsumo", clave: "grupos_familia", contexto: "empresa", llamar: (e) => actualizarGrupoDeInsumo(e.insumoHarinaId, e.grupoId) },
  { nombre: "renombrarOFusionarInsumo", clave: "insumo_renombrar_fusionar", contexto: "empresa", llamar: (e) => renombrarOFusionarInsumo(e.insumoQuesoId, "Queso duro") },
  { nombre: "crearOActualizarGrupo", clave: "grupos_familia", contexto: "empresa", llamar: () => crearOActualizarGrupo("Lácteos", null) },
  { nombre: "actualizarActivoGrupo", clave: "grupos_familia", contexto: "empresa", llamar: (e) => actualizarActivoGrupo(e.grupoId, false) },
  { nombre: "asignarInsumoAProducto", clave: "producto_asignar_insumo", contexto: "empresa", llamar: (e) => asignarInsumoAProducto(e.quesoCremosoId, e.insumoQuesoId) },
  { nombre: "darDeAltaProductoRapido", clave: "alta_producto", contexto: "empresa", llamar: (e) => darDeAltaProductoRapido("Sal", e.uId) },
  {
    nombre: "darDeAltaProducto",
    clave: "alta_producto",
    contexto: "empresa",
    llamar: (e) => darDeAltaProducto({ codigo: "PV_TARTA", nombre: "Tarta", tipo: "PV", unidadStockId: e.uId, factorConversion: 1, precioVenta: 7000 }),
  },
  {
    nombre: "actualizarProducto",
    clave: "producto_editar",
    contexto: "empresa",
    llamar: (e) => actualizarProducto(e.fainaId, { nombre: "Fainá", tipo: "PV", unidadStockId: e.uId, factorConversion: 1, precioVenta: 5500 }),
  },
  { nombre: "sincronizarPrecioGrupoCarta", clave: "producto_sincronizar_precio_carta", contexto: "empresa", llamar: (e) => sincronizarPrecioGrupoCarta([e.pizzaId, e.fainaId], 11000) },
  { nombre: "actualizarDisponibilidadProducto", clave: "producto_disponibilidad", contexto: "sucursal", llamar: (e) => actualizarDisponibilidadProducto(e.fainaId, false) },
  { nombre: "agregarPresentacionAlternativa", clave: "producto_presentaciones", contexto: "empresa", llamar: (e) => agregarPresentacionAlternativa(e.harina000Id, e.uId, 25) },
  { nombre: "actualizarActivaPresentacion", clave: "producto_presentaciones", contexto: "empresa", llamar: (e) => actualizarActivaPresentacion(e.presentacionId, false) },
  { nombre: "crearUnidad", clave: "unidades", contexto: "empresa", llamar: () => crearUnidad({ nombre: "litro", magnitud: "VOLUMEN" }) },
  { nombre: "actualizarActivaUnidad", clave: "unidades", contexto: "empresa", llamar: (e) => actualizarActivaUnidad(e.cajaId, false) },
  { nombre: "actualizarDecimalesUnidad", clave: "unidades", contexto: "empresa", llamar: (e) => actualizarDecimalesUnidad(e.kgId, 3) },
  // Restos (proveedores, clientes, margen objetivo).
  { nombre: "altaProveedor", clave: "proveedor_alta", contexto: "empresa", llamar: () => altaProveedor({ nombre: "Otro proveedor" }) },
  { nombre: "actualizarActivaProveedor", clave: "proveedores", contexto: "empresa", llamar: (e) => actualizarActivaProveedor(e.proveedorId, false) },
  { nombre: "actualizarProveedor", clave: "proveedores", contexto: "empresa", llamar: (e) => actualizarProveedor(e.proveedorId, { contacto: "Ana" }) },
  { nombre: "altaCliente", clave: "clientes", contexto: "empresa", llamar: () => altaCliente("Mengano", 5) },
  { nombre: "actualizarCliente", clave: "clientes", contexto: "empresa", llamar: (e) => actualizarCliente(e.clienteId, "Fulano", 12) },
  { nombre: "actualizarActivoCliente", clave: "clientes", contexto: "empresa", llamar: (e) => actualizarActivoCliente(e.clienteId, false) },
  { nombre: "guardarMargenObjetivo", clave: "margen_objetivo_editar", contexto: "empresa", llamar: () => guardarMargenObjetivo(null, 30) },
  // Stock (motivos, secciones, frecuencia de conteo, sección habitual, stock mínimo).
  { nombre: "crearMotivoMerma", clave: "motivos_merma", contexto: "empresa", llamar: () => crearMotivoMerma("Roto") },
  { nombre: "crearDestinoConsumo", clave: "motivos_destino_consumo", contexto: "empresa", llamar: () => crearDestinoConsumo("Degustación") },
  { nombre: "actualizarActivoMotivoMerma", clave: "motivos_merma", contexto: "empresa", llamar: (e) => actualizarActivoMotivoMerma(e.motivoId, false) },
  { nombre: "actualizarActivoDestinoConsumo", clave: "motivos_destino_consumo", contexto: "empresa", llamar: (e) => actualizarActivoDestinoConsumo(e.destinoId, false) },
  { nombre: "crearSeccion", clave: "secciones", contexto: "sucursal", llamar: () => crearSeccion("Cámara") },
  { nombre: "renombrarSeccion", clave: "secciones", contexto: "sucursal", llamar: (e) => renombrarSeccion(e.depositoId, "Depósito 2") },
  { nombre: "actualizarActivaSeccion", clave: "secciones", contexto: "sucursal", llamar: (e) => actualizarActivaSeccion(e.depositoId, false) },
  { nombre: "actualizarRespaldoSeccion", clave: "secciones", contexto: "sucursal", llamar: (e) => actualizarRespaldoSeccion(e.depositoId, true) },
  { nombre: "setFrecuenciaConteo", clave: "conteo_frecuencia", contexto: "sucursal", llamar: (e) => setFrecuenciaConteo(e.harina000Id, 7) },
  { nombre: "eliminarFrecuenciaConteo", clave: "conteo_frecuencia", contexto: "sucursal", llamar: (e) => eliminarFrecuenciaConteo(e.frecuenciaId) },
  { nombre: "setSeccionHabitual", clave: "stock_seccion_habitual", contexto: "sucursal", llamar: (e) => setSeccionHabitual(e.fainaId, e.depositoId) },
  { nombre: "eliminarSeccionHabitual", clave: "stock_seccion_habitual", contexto: "sucursal", llamar: (e) => eliminarSeccionHabitual(e.seccionHabitualId) },
  { nombre: "setStockMinimoProducto", clave: "stock_minimo", contexto: "sucursal", llamar: (e) => setStockMinimoProducto(e.harina000Id, 5) },
  { nombre: "eliminarStockMinimo", clave: "stock_minimo", contexto: "sucursal", llamar: (e) => eliminarStockMinimo(e.stockMinimoId) },
  // O.1: la receta central.
  { nombre: "guardarReceta", clave: "guardar_receta", contexto: "empresa", llamar: (e) => guardarReceta(e.fainaId, [linea(e, 0.1)], [], {}, 0) },
  // Hito 5, bloque D: la configuración de la carta (las 8 acciones que siguen sin caso de uso al arrancar el bloque).
  { nombre: "guardarSeccionCarta", clave: "carta_secciones", contexto: "empresa", llamar: () => guardarSeccionCarta({ nombre: "Postres" }) },
  { nombre: "actualizarActivaSeccionCarta", clave: "carta_secciones", contexto: "empresa", llamar: (e) => actualizarActivaSeccionCarta(e.seccionCartaId, false) },
  { nombre: "guardarGeneroCarta", clave: "carta_generos", contexto: "empresa", llamar: () => guardarGeneroCarta({ nombre: "Cervezas" }) },
  { nombre: "actualizarActivoGeneroCarta", clave: "carta_generos", contexto: "empresa", llamar: (e) => actualizarActivoGeneroCarta(e.generoId, false) },
  {
    nombre: "guardarContenidoCartaProducto",
    clave: "carta_contenido_producto",
    contexto: "empresa",
    llamar: (e) => guardarContenidoCartaProducto(e.flanId, { visibleEnCarta: true, seccionCartaId: e.seccionCartaId, descripcion: "Con dulce de leche" }),
  },
  { nombre: "actualizarVisibleEnCarta", clave: "carta_contenido_producto", contexto: "empresa", llamar: (e) => actualizarVisibleEnCarta(e.flanId, false) },
  {
    nombre: "guardarItemAgrupadoCarta",
    clave: "carta_items_agrupados",
    contexto: "empresa",
    llamar: (e) => guardarItemAgrupadoCarta({ nombre: "Gaseosas", seccionCartaId: e.seccionCartaId }),
  },
  { nombre: "actualizarActivoItemAgrupadoCarta", clave: "carta_items_agrupados", contexto: "empresa", llamar: (e) => actualizarActivoItemAgrupadoCarta(e.itemVacioId, false) },
  { nombre: "agregarOpcionItemAgrupadoCarta", clave: "carta_items_agrupados", contexto: "empresa", llamar: (e) => agregarOpcionItemAgrupadoCarta(e.itemVacioId, e.flanId) },
  { nombre: "actualizarOrdenOpcionItemAgrupadoCarta", clave: "carta_items_agrupados", contexto: "empresa", llamar: (e) => actualizarOrdenOpcionItemAgrupadoCarta(e.opcionPizzaId, 7) },
  { nombre: "quitarOpcionItemAgrupadoCarta", clave: "carta_items_agrupados", contexto: "empresa", llamar: (e) => quitarOpcionItemAgrupadoCarta(e.opcionFainaId) },
  { nombre: "guardarPortalEmpresa", clave: "carta_portal", contexto: "empresa", llamar: () => guardarPortalEmpresa({ portal_titulo: "Nuestras sucursales" }) },
  { nombre: "agregarSucursalAlPortal", clave: "carta_portal", contexto: "empresa", llamar: (e) => agregarSucursalAlPortal(e.norteId) },
  {
    nombre: "guardarSucursalPublica",
    clave: "carta_portal",
    contexto: "empresa",
    llamar: (e) => guardarSucursalPublica(e.centralId, { slug: "central-nueva", etiqueta: "Casa central", publicada: true }),
  },
  { nombre: "quitarSucursalDelPortal", clave: "carta_portal", contexto: "empresa", llamar: (e) => quitarSucursalDelPortal(e.centralId) },
  { nombre: "moverSucursalEnMapa", clave: "carta_portal", contexto: "empresa", llamar: (e) => moverSucursalEnMapa(e.centralId, 30, 40) },
  { nombre: "guardarTemaCarta", clave: "carta_tema", contexto: "sucursal", llamar: (e) => guardarTemaCarta(e.centralId, { restaurante_nombre: "La Esquina" }) },
  { nombre: "cambiarAplicacionTema", clave: "carta_tema", contexto: "sucursal", llamar: (e) => cambiarAplicacionTema(e.centralId, false) },
  {
    nombre: "copiarCartaDeSucursal",
    clave: "carta_copiar_de_sucursal",
    contexto: "sucursal",
    llamar: (e) => copiarCartaDeSucursal(e.norteId, true),
    // Solo copia sobre una carta vacía: se vacía la de Central (sus ítems agrupados, sus opciones y sus géneros) y Norte tiene una propia.
    preparar: async (e) => {
      await prisma.opcionItemAgrupadoCarta.deleteMany({ where: { sucursalId: e.centralId } });
      await prisma.itemAgrupadoCarta.deleteMany({ where: { sucursalId: e.centralId } });
      await prisma.generoCarta.deleteMany({ where: { sucursalId: e.centralId } });
      await prisma.generoCarta.create({ data: { sucursalId: e.norteId, nombre: "Carta de Norte" } });
    },
  },
];

/** El piso de cada clave, del catálogo (`core/permisos/acciones.ts`). */
const PISO = new Map<string, string>(ACCIONES.map((a) => [a.clave, a.nivelMinimo]));
const CONTEXTO = new Map<string, string>(ACCIONES.map((a) => [a.clave, a.contexto]));
const CLAVES = [...new Set(MUTACIONES.map((m) => m.clave))];

const ROL_VACIO = "vacio";
const ROL_ENCARGADO = "encargado";

/** El texto exacto del guard para un rol sin la acción (o bajo su piso): el rechazo viene del envoltorio, no de una validación posterior. */
function mensajeDelGuard(m: Mutacion, rol: string): string {
  return m.contexto === "sucursal"
    ? textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "ROL_SIN_LA_ACCION", para: "editar", accion: m.clave, rol })
    : textoDeDenegacion({ motivo: "SIN_PERMISO", caso: "ROLES_SIN_LA_ACCION", para: "editar", accion: m.clave, roles: [rol] });
}

/** Foto completa de lo que tocan las 52 (catálogo, carta, stock, recetas y auditoría), por id: una actualización que no cambia conteos también se ve. */
async function fotoDeLaPieza() {
  const porId = { orderBy: { id: "asc" as const } };
  return {
    producto: await prismaAdmin.producto.findMany(porId),
    disponibilidadProducto: await prismaAdmin.disponibilidadProducto.findMany(porId),
    presentacion: await prismaAdmin.presentacion.findMany(porId),
    unidad: await prismaAdmin.unidad.findMany(porId),
    categoriaProducto: await prismaAdmin.categoriaProducto.findMany(porId),
    insumo: await prismaAdmin.insumo.findMany(porId),
    grupo: await prismaAdmin.grupo.findMany(porId),
    sustitutoRecetaIngrediente: await prismaAdmin.sustitutoRecetaIngrediente.findMany(porId),
    proveedor: await prismaAdmin.proveedor.findMany(porId),
    cliente: await prismaAdmin.cliente.findMany(porId),
    margenObjetivo: await prismaAdmin.margenObjetivo.findMany(porId),
    motivoMerma: await prismaAdmin.motivoMerma.findMany(porId),
    destinoConsumo: await prismaAdmin.destinoConsumo.findMany(porId),
    seccion: await prismaAdmin.seccion.findMany(porId),
    frecuenciaConteoProducto: await prismaAdmin.frecuenciaConteoProducto.findMany(porId),
    seccionHabitualProducto: await prismaAdmin.seccionHabitualProducto.findMany(porId),
    stockMinimoProducto: await prismaAdmin.stockMinimoProducto.findMany(porId),
    precioLocalProducto: await prismaAdmin.precioLocalProducto.findMany(porId),
    descuentoProductoSucursal: await prismaAdmin.descuentoProductoSucursal.findMany(porId),
    promoCarta: await prismaAdmin.promoCarta.findMany(porId),
    promoCartaSucursal: await prismaAdmin.promoCartaSucursal.findMany(porId),
    promoCartaCupo: await prismaAdmin.promoCartaCupo.findMany(porId),
    rendimientoLocalIngrediente: await prismaAdmin.rendimientoLocalIngrediente.findMany(porId),
    recetaSucursal: await prismaAdmin.recetaSucursal.findMany(porId),
    recetaVersion: await prismaAdmin.recetaVersion.findMany(porId),
    recetaIngrediente: await prismaAdmin.recetaIngrediente.findMany(porId),
    // Bloque D: las tablas de la configuración de la carta.
    seccionCarta: await prismaAdmin.seccionCarta.findMany(porId),
    generoCarta: await prismaAdmin.generoCarta.findMany(porId),
    contenidoCartaProducto: await prismaAdmin.contenidoCartaProducto.findMany(porId),
    itemAgrupadoCarta: await prismaAdmin.itemAgrupadoCarta.findMany(porId),
    opcionItemAgrupadoCarta: await prismaAdmin.opcionItemAgrupadoCarta.findMany(porId),
    portalCartaEmpresa: await prismaAdmin.portalCartaEmpresa.findMany(porId),
    sucursalPublica: await prismaAdmin.sucursalPublica.findMany(porId),
    temaCartaSucursal: await prismaAdmin.temaCartaSucursal.findMany(porId),
    registroAuditoria: await prismaAdmin.registroAuditoria.findMany(porId),
  };
}

let e: Escenario;
let sinFilas: { id: string; email: string };
let bajoElPiso: { id: string; email: string };
let enOtraSucursal: { id: string; email: string };

beforeEach(async () => {
  await limpiarBaseDeTest();
  __setCookieDeTestParaSucursal(undefined);
  const base = await sembrarBase();
  const centralId = base.sucursal.id;
  const norteId = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;

  // Los tres actores. `vacio`: ninguna fila. `encargado` (sin clave: nivel operario): la fila Ver+Editar de las 52 claves. El de otra sucursal: `vacio` en
  // Central (la membresía más antigua: la activa) y admin en Norte.
  const rolVacio = await prisma.rol.create({ data: { nombre: ROL_VACIO } });
  const rolEncargado = await prisma.rol.create({ data: { nombre: ROL_ENCARGADO } });
  await prisma.permisoRol.createMany({ data: CLAVES.map((accionClave) => ({ rolId: rolEncargado.id, accionClave, puedeVer: true, puedeEditar: true })) });
  sinFilas = await crearUsuarioConMembresia({ email: "vacio@test.com", sucursalId: centralId, rolId: rolVacio.id });
  bajoElPiso = await crearUsuarioConMembresia({ email: "encargado@test.com", sucursalId: centralId, rolId: rolEncargado.id });
  enOtraSucursal = await crearUsuarioConMembresia({ email: "norte@test.com", sucursalId: centralId, rolId: rolVacio.id });
  await crearMembresia({ usuarioId: enOtraSucursal.id, sucursalId: norteId, rolId: base.admin.id });

  // Catálogo.
  const u = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
  const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
  const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Almacén" } });
  const insumoHarina = await prisma.insumo.create({ data: { nombre: "Harina" } });
  const insumoQueso = await prisma.insumo.create({ data: { nombre: "Queso" } });
  const grupo = await prisma.grupo.create({ data: { nombre: "Secos" } });
  const harina000 = await sembrarProductoDisponible({ codigo: "MP_H000", nombre: "Harina 000", tipo: "MP", unidadStockId: kg.id, insumoId: insumoHarina.id }, centralId);
  const quesoCremoso = await sembrarProductoDisponible({ codigo: "MP_QC", nombre: "Queso cremoso", tipo: "MP", unidadStockId: kg.id }, centralId);
  const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: u.id, precioVenta: 12000 }, centralId);
  const faina = await sembrarProductoDisponible({ codigo: "PV_FAINA", nombre: "Fainá", tipo: "PV", unidadStockId: u.id, precioVenta: 5000 }, centralId);
  const flan = await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: u.id, precioVenta: 3000 }, centralId);
  const empanada = await sembrarProductoDisponible({ codigo: "PV_EMP", nombre: "Empanada", tipo: "PV", unidadStockId: u.id, precioVenta: 1500 }, centralId);
  const presentacion = await prisma.presentacion.create({ data: { productoId: harina000.id, unidadCompraId: caja.id, factorConversion: 10 } });

  // Receta central de la Pizza (0,25 kg de Harina 000) con su calibración en Central; receta propia HABILITADA de la Empanada en Central.
  const recetaPizza = await prisma.recetaVersion.create({
    data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina000.id, cantidad: 0.25, unidadId: kg.id, mermaPorcentaje: 0 }] } },
    include: { ingredientes: true },
  });
  const lineaDeRecetaId = recetaPizza.ingredientes[0].id;
  await prisma.rendimientoLocalIngrediente.create({ data: { recetaIngredienteId: lineaDeRecetaId, sucursalId: centralId, cantidad: 0.2, mermaPorcentaje: 5 } });
  await prisma.recetaVersion.create({
    data: { productoId: empanada.id, sucursalId: centralId, version: 1, ingredientes: { create: [{ insumoProductoId: harina000.id, cantidad: 0.05, unidadId: kg.id, mermaPorcentaje: 0 }] } },
  });
  await prisma.recetaSucursal.create({ data: { sucursalId: centralId, productoId: empanada.id, habilitada: true } });

  // Carta: la Pizza y la Fainá son opciones del mismo ítem agrupado en Central (las dos sincronizaciones de precio); una promo de la empresa prendida en Central.
  const seccionCarta = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
  const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: centralId, nombre: "Para picar", seccionCartaId: seccionCarta.id } });
  await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: centralId, itemAgrupadoCartaId: item.id, productoId: pizza.id, orden: 1 } });
  await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: centralId, itemAgrupadoCartaId: item.id, productoId: faina.id, orden: 2 } });
  const promo = await prisma.promoCarta.create({ data: { seccionCartaId: seccionCarta.id, titulo: "Menú del día", precio: 10000, sucursales: { create: { sucursalId: centralId } } } });
  // Bloque D: un género, un ítem agrupado vacío (para agregarle una opción), las opciones que se reordenan y se quitan, la sucursal en el portal (con su posición en
  // el mapa) y un tema aplicado en Central. Norte no tiene nada: el alta en el portal y la copia de carta parten de ahí.
  const genero = await prisma.generoCarta.create({ data: { sucursalId: centralId, nombre: "Gaseosas" } });
  const itemVacio = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: centralId, nombre: "Vacío", seccionCartaId: seccionCarta.id } });
  const opcionPizza = await prisma.opcionItemAgrupadoCarta.findFirstOrThrow({ where: { sucursalId: centralId, productoId: pizza.id } });
  const opcionFaina = await prisma.opcionItemAgrupadoCarta.findFirstOrThrow({ where: { sucursalId: centralId, productoId: faina.id } });
  await prisma.sucursalPublica.create({ data: { sucursalId: centralId, slug: "central", posX: 10, posY: 10, posW: 20, posH: 20 } });
  await prisma.temaCartaSucursal.create({ data: { sucursalId: centralId, valores: { restaurante_nombre: "Central" }, aplicarEnCarta: true } });

  // Restos y stock.
  const proveedor = await prisma.proveedor.create({ data: { codigo: "PRV-0001", nombre: "Distribuidora" } });
  const cliente = await prisma.cliente.create({ data: { nombre: "Fulano", descuentoPorcentaje: 10 } });
  const motivo = await prisma.motivoMerma.create({ data: { nombre: "Vencido" } });
  const destino = await prisma.destinoConsumo.create({ data: { nombre: "Personal" } });
  const deposito = await prisma.seccion.create({ data: { sucursalId: centralId, nombre: "Depósito" } });
  const frecuencia = await prisma.frecuenciaConteoProducto.create({ data: { sucursalId: centralId, productoId: quesoCremoso.id, frecuenciaDias: 3 } });
  const seccionHabitual = await prisma.seccionHabitualProducto.create({ data: { sucursalId: centralId, productoId: pizza.id, seccionId: deposito.id } });
  const stockMinimo = await prisma.stockMinimoProducto.create({ data: { sucursalId: centralId, productoId: quesoCremoso.id, minimo: 2 } });

  e = {
    centralId,
    flanId: flan.id,
    pizzaId: pizza.id,
    fainaId: faina.id,
    empanadaId: empanada.id,
    harina000Id: harina000.id,
    quesoCremosoId: quesoCremoso.id,
    kgId: kg.id,
    uId: u.id,
    cajaId: caja.id,
    categoriaId: categoria.id,
    insumoHarinaId: insumoHarina.id,
    insumoQuesoId: insumoQueso.id,
    grupoId: grupo.id,
    presentacionId: presentacion.id,
    proveedorId: proveedor.id,
    clienteId: cliente.id,
    motivoId: motivo.id,
    destinoId: destino.id,
    depositoId: deposito.id,
    frecuenciaId: frecuencia.id,
    seccionHabitualId: seccionHabitual.id,
    stockMinimoId: stockMinimo.id,
    seccionCartaId: seccionCarta.id,
    promoId: promo.id,
    lineaDeRecetaId,
    norteId,
    generoId: genero.id,
    itemVacioId: itemVacio.id,
    opcionPizzaId: opcionPizza.id,
    opcionFainaId: opcionFaina.id,
  };
});

afterAll(() => {
  __setCookieDeTestParaSucursal(undefined);
});

/** Llama a la mutación como `actor` y comprueba el texto del guard y que la foto de la pieza (y el conteo de la auditoría) no cambie. */
async function rechazaSinTocarNada(actor: { id: string; email: string }, m: Mutacion, rol: string) {
  await mockearUsuarioActual({ id: actor.id, email: actor.email, nombre: null });
  await m.preparar?.(e);
  const antes = await fotoDeLaPieza();
  const auditoriaAntes = await prismaAdmin.registroAuditoria.count();
  const resultado = await m.llamar(e);
  expect.soft(resultado, `${m.nombre}: el mensaje no es el del guard`).toEqual({ ok: false, mensaje: mensajeDelGuard(m, rol) });
  expect.soft(await fotoDeLaPieza(), `${m.nombre}: la foto cambió (la acción escribió)`).toEqual(antes);
  expect(await prismaAdmin.registroAuditoria.count()).toBe(auditoriaAntes);
}

const BAJO_EL_PISO = MUTACIONES.filter((m) => PISO.get(m.clave) === "administrador");
const DE_SUCURSAL = MUTACIONES.filter((m) => m.contexto === "sucursal");

describe("tramo C (carta, catálogo y stock): las 71 mutaciones rechazan sin el permiso y no cambian ninguna tabla", () => {
  it("la lista son las 71 (las 51 de la pieza, guardarReceta y las 19 de configuración de la carta), con el contexto del catálogo y los pisos esperados", () => {
    expect(MUTACIONES).toHaveLength(71);
    expect(new Set(MUTACIONES.map((m) => m.nombre)).size).toBe(71);
    for (const m of MUTACIONES) expect(m.contexto, `${m.nombre}: el contexto declarado no es el del catálogo`).toBe(CONTEXTO.get(m.clave));
    expect(BAJO_EL_PISO.length).toBe(39 + 19);
    expect(DE_SUCURSAL.length).toBe(19 + 3);
  });

  it.each(MUTACIONES.map((m) => [m.nombre, m] as const))("un rol sin ninguna fila: %s rechaza con el texto del guard", async (_n, m) => {
    await rechazaSinTocarNada(sinFilas, m, ROL_VACIO);
  });

  it.each(BAJO_EL_PISO.map((m) => [m.nombre, m] as const))("un rol con la fila pero bajo el piso administrador: %s rechaza (el piso manda sobre la fila)", async (_n, m) => {
    await rechazaSinTocarNada(bajoElPiso, m, ROL_ENCARGADO);
  });

  it.each(DE_SUCURSAL.map((m) => [m.nombre, m] as const))("con la clave en OTRA sucursal (admin en Norte, parado en Central): %s rechaza", async (_n, m) => {
    __setCookieDeTestParaSucursal(e.centralId);
    await rechazaSinTocarNada(enOtraSucursal, m, ROL_VACIO);
  });
});
