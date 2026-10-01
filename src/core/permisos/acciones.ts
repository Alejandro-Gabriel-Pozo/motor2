// Catálogo de acciones gateables — migrado 1:1 desde las semillas de
// inicializarHojaPermisosSiFalta (Core.js:1293-1356), más 'alta_sucursal'
// (nueva: reemplaza el paso manual de hoy, crear-contenedor.js — ver plan,
// sección "Bootstrap de admin"). `rolesEditarSemilla` reproduce exactamente
// el estado inicial de cada fila en Apps Script, para que prisma/seed.ts no
// tenga que duplicar esta lista.
//
// Única fuente de verdad: no declarar una acción nueva en otro lugar — el
// mismo criterio que ya usa este proyecto (Core.js:1366-1377: agregar acá
// una acción faltante es justamente el bug que ya se corrigió una vez).

/** Sobre qué opera la acción: la empresa entera (sus datos no tienen sucursal) o la sucursal activa. */
export type ContextoDeAccion = "empresa" | "sucursal";

/**
 * Nivel de quien puede llegar a tener la acción (RBAC con jerarquía, decisión del dueño 2026-09-30): operario < administrador < gerente.
 * Es un PISO y SE HACE CUMPLIR en dos puntos: `guardarPermisos` rechaza darle a un rol por debajo del piso el Ver/Editar de la acción, y el gate
 * (`gate.ts`) ignora la fila aunque exista (una migración o un dato viejo no la convierten en acceso). Los roles personalizados (mozo, cajero…)
 * y «operador» son nivel operario; el rol «admin» es nivel administrador; «gerente» no es un rol de sucursal sino `UsuarioEmpresa.rolEmpresa`
 * (uno por empresa): una acción de piso gerente la tiene SOLO quien es gerente, sin pasar por la matriz, y por eso es de contexto empresa.
 */
export type NivelDeAccion = "operario" | "administrador" | "gerente";

export interface AccionSemilla {
  clave: string;
  descripcion: string;
  contexto: ContextoDeAccion;
  nivelMinimo: NivelDeAccion;
  /** Roles que pueden EDITAR esta acción desde el arranque (seed). */
  rolesEditarSemilla: readonly ("admin" | "operador")[];
}

// `satisfies` (no una anotación `: readonly AccionSemilla[]`): la anotación anula el `as const` y `AccionClave` degenera en `string`.
export const ACCIONES = [
  { clave: "alta_producto", descripcion: "Dar de alta un producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "editar_producto", descripcion: "Editar un producto existente", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "guardar_receta", descripcion: "Crear/editar una receta (Editor de Recetas)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "grupos_familia", descripcion: "Renombrar/fusionar Familias y asignar Grupos", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "secciones", descripcion: "Administrar el catálogo de Secciones", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "unidades", descripcion: "Administrar el catálogo de Unidades de medida", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proveedores", descripcion: "Administrar el catálogo de Proveedores (activar/desactivar)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "categorias", descripcion: "Administrar el catálogo de Categorías", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (hallazgo real, 2026-09-23: el dueño marcó que los motivos de Consumo/Merma vienen hardcodeados en un enum fijo
  // — sin forma de agregar uno nuevo sin tocar código). Una sola clave para los dos catálogos (mismo criterio que ya fijó
  // el dueño el 2026-09-19 para los reportes: "~5 claves y no una por reporte").
  { clave: "motivos_movimiento", descripcion: "Administrar los catálogos de Motivos de merma y Destinos de consumo", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (docs/plan-carta-catalogo-2026-09-24.md, M8): administrar lo que la carta pública (restaurant-menu-design) lee de acá —
  // las secciones de carta, qué categoría cae en cada una, el contenido de cara al cliente de cada PV y las promos de la sucursal.
  // Solo admin: es lo que ve el público.
  { clave: "carta", descripcion: "Administrar la carta pública: secciones de carta, contenido de cada producto de venta y promos de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "stock_minimo", descripcion: "Fijar Stock Mínimo (global o por sección)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, porción Stock):
  // calcularStockConsolidado_/calcularStockPorFamilia_/calcularAlertasStock_
  // no tenían NINGÚN gate propio ahí (solo se ocultaban a nivel de menú de
  // Sheets, que no es una barrera real — la función seguía siendo
  // client-callable directo). Acá SÍ hay una capa de permisos real: se le
  // da una Accion propia, abierta a operador (ver stock es visibilidad
  // operativa del día a día, distinto de FIJAR el mínimo, que sigue
  // admin-only en 'stock_minimo').
  { clave: "ver_stock", descripcion: "Ver Stock consolidado, por familia y alertas", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "precio_local", descripcion: "Fijar Precio Local por sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "promociones_config", descripcion: "Activar Promociones y marcar productos como Combo", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "comparar_precios", descripcion: "Comparar precios por proveedor", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "notificar_alertas", descripcion: "Notificar alertas de stock por mail", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "insumos_mezclados", descripcion: "Revisar insumos con unidad mezclada", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // 'reconstruir_productos' NO se migra (ver plan, porción Catálogo): era
  // el parche de Apps Script para resincronizar Productos ↔ Hoja listado
  // (dos hojas, sin FKs). Acá Producto es una sola tabla — no hay nada que
  // reconstruir.
  // 'sincronizar_proveedores' queda reservada sin server action propia:
  // ver plan, porción Catálogo — solo tendría sentido para importar un
  // histórico externo con nombres de proveedor sueltos, no para esta porción.
  { clave: "sincronizar_proveedores", descripcion: "Sincronizar Proveedores desde el historial", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ejecutar_tests", descripcion: "Ejecutar la suite de tests", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_usuarios", descripcion: "Gestionar usuarios y roles", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_permisos", descripcion: "Gestionar qué rol puede hacer cada acción", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_compra", descripcion: "Registrar una Compra", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_produccion", descripcion: "Registrar una Producción", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_consumo", descripcion: "Registrar un Consumo", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_ajuste", descripcion: "Registrar un Ajuste (corrección de stock)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_control", descripcion: "Registrar un Conteo Físico", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_transferencia", descripcion: "Registrar una Transferencia entre secciones", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_merma", descripcion: "Registrar una Merma", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_venta", descripcion: "Registrar una Venta", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_consignacion", descripcion: "Devolver mercadería al consignante", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_cliente", descripcion: "Registrar una devolución de cliente (revendible)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_proveedor", descripcion: "Devolver mercadería a un proveedor", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_transferencia_sucursal", descripcion: "Solicitar/aprobar/aceptar transferencias con otra sucursal", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "cancelar_conteo", descripcion: "Cancelar un conteo físico ya aplicado", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "anular_venta", descripcion: "Anular una venta ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Más restrictivo que `proceso_compra` (cargarla), a propósito y con el mismo criterio que `anular_venta`: deshacer una compra confirmada mueve el stock y el gasto.
  { clave: "anular_compra", descripcion: "Anular una compra ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Corregir solo la CABECERA de una compra ya confirmada (proveedor, N.º de factura, detalle); nunca sus líneas. Mismo criterio restrictivo que `anular_compra`.
  { clave: "corregir_compra", descripcion: "Corregir el proveedor, el N.º de factura o el detalle de una compra ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "capacidades_sucursal", descripcion: "Habilitar/deshabilitar qué puede gestionar cada sucursal", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, "Bootstrap de admin"):
  // reemplaza el paso manual crear-contenedor.js por una acción real del
  // sistema, exclusiva de admin, que crea la sucursal y asigna su primer
  // admin en la misma transacción (nunca queda una sucursal sin admin).
  { clave: "alta_sucursal", descripcion: "Dar de alta una sucursal nueva y asignar su primer admin", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "pagar_consignante", descripcion: "Registrar un pago a un proveedor de consignación", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_auditoria", descripcion: "Ver el registro de auditoría administrativa (precios y permisos)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Reportes: UNA clave por reporte (decisión del dueño, 2026-09-30; reemplaza la agrupación `ver_reportes_*` del 2026-09-19). Son claves de
  // «Ver»: no hay nada que editar. Los reportes de dinero y de control tienen piso de administrador (un operario nunca los recibe); los
  // operativos son de operario, así que un rol de depósito los puede recibir. Las pantallas de /reportes que además operan (consignación,
  // promociones) siguen con la clave de su acción: ver la pantalla y operarla es lo mismo ahí.
  { clave: "reporte_resumen", descripcion: "Ver el reporte «Resumen operativo»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_consolidado", descripcion: "Ver el reporte «Consolidado (mis sucursales)»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_periodo", descripcion: "Ver el reporte «Período»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_categorias", descripcion: "Ver el reporte «Por categoría»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_ventas_por_seccion", descripcion: "Ver el reporte «Por sección de carta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_costos", descripcion: "Ver el reporte «Costos y márgenes»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_compras", descripcion: "Ver el reporte «Compras registradas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rendimiento_recetas", descripcion: "Ver el reporte «Rendimiento real de recetas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rendimiento_sucursal", descripcion: "Ver el reporte «Rendimiento por sucursal»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_valuacion", descripcion: "Ver el reporte «Valuación de inventario»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_boletas", descripcion: "Ver el reporte «Boletas emitidas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_descuentos_clientes", descripcion: "Ver el reporte «Descuentos por cliente»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_margen_promociones", descripcion: "Ver el reporte «Margen de promociones»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_historial_importes", descripcion: "Ver los importes (precios de compra y de venta) dentro del reporte «Historial de un producto»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_perdidas", descripcion: "Ver el reporte «Pérdidas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_devoluciones", descripcion: "Ver el reporte «Devoluciones»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_diferencias", descripcion: "Ver el reporte «Diferencias de ajuste»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_vencimientos", descripcion: "Ver el reporte «Vencimientos»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_salud", descripcion: "Ver el reporte «Salud por producto»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_historial", descripcion: "Ver el reporte «Historial de un producto»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_trazabilidad", descripcion: "Ver el reporte «Trazabilidad por ID»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rotacion_mesas", descripcion: "Ver el reporte «Rotación de mesas»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_sin_receta", descripcion: "Ver el reporte «Ventas sin receta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_insumos_sin_receta", descripcion: "Ver el reporte «Insumos sin receta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_conteos", descripcion: "Ver el reporte «Conteos físicos»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "reporte_huecos_catalogo", descripcion: "Ver el reporte «Huecos de catálogo»", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Módulo POS (docs/plan-mapa-de-mesas-2026-09-24.md): Ver = abrir el mapa de mesas; Editar = dar de alta mesas. Ninguna acción existente
  // servía (reusar `proceso_venta` daría de más). El operador de fábrica queda sin asignar, igual que `anular_compra`; el rol «mozo» NO se
  // crea en código: se crea desde /administracion/roles y se le da esta acción desde la matriz de permisos.
  // La descripción NO cambia con el límite de mesas abiertas nuevo (mismo permiso, ver actualizarMaxMesasAbiertas en
  // src/server/actions/pos/mesas.ts): test/permisos/migracion-permiso-pos-mesas.test.ts exige que coincida con el literal
  // ya escrito en la migración de datos 20260924151000_permiso_pos_mesas — cambiarla exigiría, además, una migración nueva
  // que la actualice en cualquier base ya sembrada, y no es necesario: la acción (`pos_mesas`) es la fuente de verdad, no su texto.
  { clave: "pos_mesas", descripcion: "Ver el mapa de mesas del salón y dar de alta mesas (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // «Tomar pedido» (docs/plan-tomar-pedido-2026-09-25.md, B4): tres claves separadas para poder armar un rol «mozo» que toma pedidos
  // (con `pos_mesas` Ver + `pos_tomar_pedido` Editar) sin poder anular lo que ya salió a cocina ni cobrar. Todas arrancan solo en admin.
  { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos en el salón: abrir la cuenta de una mesa, agregar y quitar ítems sin enviar, enviarlos a cocina y liberar una mesa sin consumo (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_anular_item", descripcion: "Anular un ítem de una cuenta que ya se envió a cocina, con motivo (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_cerrar_cuenta", descripcion: "Cerrar la cuenta de una mesa: registra la venta en el stock y libera la mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // Rendimiento por sucursal (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, D5 — decisión del dueño, migración
  // de datos 20260926012600_permiso_calibrar_rendimiento_local): separada de `guardar_receta` a propósito — editar la
  // receta global es una decisión distinta de calibrar la sucursal propia.
  { clave: "calibrar_rendimiento_local", descripcion: "Calibrar el rendimiento de las recetas en esta sucursal (cantidad y merma propias de cada ingrediente)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 9): 'clientes' administra el catálogo (alta,
  // edición del %, activar/desactivar), mismo criterio admin-only que el resto del catálogo (proveedores, categorías, ...).
  { clave: "clientes", descripcion: "Administrar el catálogo de Clientes y su % de descuento", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // 'pos_asignar_cliente' (D3): CUALQUIER MOZO puede asignar un cliente con descuento a la cuenta de una mesa, no solo admin — mismo
  // criterio de seed que 'pos_tomar_pedido' arriba (arranca solo en admin; el rol «mozo» se arma desde /administracion/roles y la
  // matriz de permisos, que es donde se le da esta acción). La migración de datos (20260926190200_permiso_pos_asignar_cliente) hace
  // lo mismo que ESTE seed haría en una base nueva, más: en una base YA EXISTENTE con un rol «mozo» ya armado, le da la fila también
  // a ese rol (a cualquiera que ya edite 'pos_tomar_pedido'), no solo a admin — así no hace falta que un admin la vuelva a tocar.
  { clave: "pos_asignar_cliente", descripcion: "Asignar un cliente con descuento a la cuenta de una mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
] as const satisfies readonly AccionSemilla[];

export type AccionClave = (typeof ACCIONES)[number]["clave"];

/** Las claves de contexto empresa / de contexto sucursal: el tipo de parámetro de los gates de cada contexto (`conPermisoDeEmpresa`, …). */
export type AccionDeEmpresa = Extract<(typeof ACCIONES)[number], { contexto: "empresa" }>["clave"];
export type AccionDeSucursal = Extract<(typeof ACCIONES)[number], { contexto: "sucursal" }>["clave"];

const POR_CLAVE: ReadonlyMap<string, AccionSemilla> = new Map(ACCIONES.map((a) => [a.clave, a]));

/**
 * ¿La clave está en el catálogo vigente? La base puede tener filas `Accion` de claves retiradas (las `ver_reportes_*` y demás padres
 * quedan hasta la fase de contracción de la partición): no se muestran en la matriz ni se pueden editar.
 */
export function claveEnCatalogo(clave: string): clave is AccionClave {
  return POR_CLAVE.has(clave);
}

export function contextoDeAccion(clave: AccionClave): ContextoDeAccion {
  return POR_CLAVE.get(clave)!.contexto;
}

export function nivelMinimoDeAccion(clave: AccionClave): NivelDeAccion {
  return POR_CLAVE.get(clave)!.nivelMinimo;
}

const ORDEN_DE_NIVEL: Record<NivelDeAccion, number> = { operario: 0, administrador: 1, gerente: 2 };

/**
 * El nivel de un ROL de sucursal, por su nombre (igual que `esCeldaFija`): «admin» es administrador y todo lo demás —«operador» y los roles
 * personalizados— es operario. Ningún rol es gerente: eso es `UsuarioEmpresa.rolEmpresa`.
 */
export function nivelDeRol(rolNombre: string): NivelDeAccion {
  return rolNombre === "admin" ? "administrador" : "operario";
}

/** ¿El rol llega al piso de la acción? Si no, ninguna fila de `PermisoRol` le da acceso: el piso manda sobre la matriz. */
export function rolAlcanzaLaAccion(rolNombre: string, clave: AccionClave): boolean {
  return ORDEN_DE_NIVEL[nivelDeRol(rolNombre)] >= ORDEN_DE_NIVEL[nivelMinimoDeAccion(clave)];
}

/**
 * Acciones que SIEMPRE deben conservar 'admin' entre sus roles de Editar —
 * mismo criterio que Core.js:1507-1511 (actualizarPermisoDesdePanel):
 * si se le pudiera sacar 'admin' a 'gestion_permisos'/'gestion_usuarios',
 * un admin podría desconfigurar esto y dejar a todo el mundo sin forma de
 * volver a entrar a corregirlo.
 */
export const ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE: readonly AccionClave[] = [
  "gestion_permisos",
  "gestion_usuarios",
];
