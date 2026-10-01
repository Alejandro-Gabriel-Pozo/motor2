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
  { clave: "producto_editar", descripcion: "Editar un producto existente", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "guardar_receta", descripcion: "Crear/editar una receta (Editor de Recetas)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "grupos_familia", descripcion: "Administrar los Grupos de insumos, asignar cada insumo a su Grupo y activar o desactivar insumos", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "secciones", descripcion: "Administrar el catálogo de Secciones", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "unidades", descripcion: "Administrar el catálogo de Unidades de medida", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proveedores", descripcion: "Administrar el catálogo de Proveedores (activar/desactivar)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "categorias", descripcion: "Administrar el catálogo de Categorías", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Los motivos de Consumo/Merma ya no vienen hardcodeados en un enum fijo (hallazgo real, 2026-09-23). Una clave por catálogo (decisión
  // del dueño, 2026-09-30: una clave por acción); `motivos_movimiento` (una sola para los dos) se retiró.
{ clave: "motivos_merma", descripcion: "Administrar el catálogo de Motivos de merma", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "motivos_destino_consumo", descripcion: "Administrar el catálogo de Destinos de consumo", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (docs/plan-carta-catalogo-2026-09-24.md, M8): administrar lo que la carta pública (restaurant-menu-design) lee de acá —
  // las secciones de carta, qué categoría cae en cada una, el contenido de cara al cliente de cada PV y las promos de la sucursal.
  // Solo admin: es lo que ve el público.
  // Carta pública: una clave por bloque de administración (decisión del dueño, 2026-09-30); `carta` (una sola para todo) se retiró.
  { clave: "carta_ver", descripcion: "Entrar a la pantalla Carta y ver sus secciones, géneros, contenido y promos", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_secciones", descripcion: "Administrar las secciones de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_generos", descripcion: "Administrar los géneros de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_contenido_producto", descripcion: "Editar el contenido de carta de cada producto de venta", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_items_agrupados", descripcion: "Administrar los ítems agrupados de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_portal", descripcion: "Administrar el portal de sucursales de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_promos", descripcion: "Administrar las promos de la carta de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_tema", descripcion: "Administrar el tema visual de la carta de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
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
  { clave: "promociones_config", descripcion: "Ver la pantalla de Promociones", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "comparar_precios", descripcion: "Comparar precios por proveedor", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "notificar_alertas", descripcion: "Notificar alertas de stock por mail", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "insumos_mezclados", descripcion: "Revisar insumos con unidad mezclada", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // 'reconstruir_productos' NO se migra (ver plan, porción Catálogo): era
  // el parche de Apps Script para resincronizar Productos ↔ Hoja listado
  // (dos hojas, sin FKs). Acá Producto es una sola tabla — no hay nada que
  // reconstruir.
  // 'sincronizar_proveedores' y 'ejecutar_tests' se retiraron del catálogo (2026-10-01): nunca tuvieron una acción que las usara (la primera era
  // para importar un histórico externo; la segunda, la suite de tests de Apps Script) y una clave sin acción es una promesa falsa en la matriz.
  // Administración: una clave por acción. `gestion_usuarios` queda para agregar gente a la sucursal y cambiarle el rol (el resto de lo que
  // hacía se partió); `gestion_permisos`, para la matriz de permisos (la gestión de roles pasó a `gestion_roles`).
  { clave: "gestion_usuarios", descripcion: "Agregar usuarios a la sucursal y cambiarles el rol", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "activar_usuario_sucursal", descripcion: "Activar o desactivar a un usuario en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "notas_usuario_sucursal", descripcion: "Editar las notas de un usuario en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "apagar_cuenta_empresa", descripcion: "Apagar o reactivar la cuenta de un usuario en toda la empresa", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_permisos", descripcion: "Gestionar la matriz de permisos de los roles", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_roles", descripcion: "Crear, activar y desactivar roles", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
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
  // Traspasos entre sucursales: una clave por acción y una para ver la bandeja (reemplazan a `proceso_transferencia_sucursal`, retirada).
  { clave: "traspaso_ver_bandeja", descripcion: "Ver la bandeja de traspasos con otras sucursales", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_solicitar", descripcion: "Solicitar a otra sucursal que nos envíe stock (traspaso)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_enviar_directo", descripcion: "Enviarle stock a otra sucursal sin que lo haya pedido (traspaso)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_aprobar", descripcion: "Aprobar y enviar una solicitud de traspaso que nos hicieron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_cancelar_solicitud", descripcion: "Cancelar una solicitud de traspaso propia", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_rechazar_solicitud", descripcion: "Rechazar una solicitud de traspaso que nos hicieron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_aceptar", descripcion: "Aceptar un envío de traspaso que nos mandaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_rechazar_envio", descripcion: "Rechazar un envío de traspaso que nos mandaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_confirmar_reingreso", descripcion: "Confirmar el reingreso de un envío de traspaso que nos rechazaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
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
  { clave: "activar_sucursal", descripcion: "Activar o desactivar una sucursal", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "renombrar_sucursal", descripcion: "Renombrar una sucursal", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "pagar_consignante", descripcion: "Registrar un pago a un proveedor de consignación", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_auditoria", descripcion: "Ver el registro de auditoría administrativa de la sucursal (precios y permisos)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Primera acción de piso gerente: la tiene solo el gerente de la empresa, sin pasar por la matriz (reemplaza el `esGerenteDeEmpresa` suelto de la
  // pantalla de Auditoría). No tiene padre: no existía como clave, así que la migración solo la da de alta y nadie la hereda.
  { clave: "ver_auditoria_empresa", descripcion: "Ver las filas de auditoría de la empresa (las que no son de una sucursal)", contexto: "empresa", nivelMinimo: "gerente", rolesEditarSemilla: [] },
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
  // Módulo POS (docs/plan-mapa-de-mesas-2026-09-24.md): Ver = abrir el mapa de mesas y entrar a una mesa; dar de alta mesas y fijar el límite de
  // mesas abiertas tienen su clave (`pos_alta_mesa`, `pos_limite_mesas_abiertas`). El operador de fábrica queda sin asignar, igual que
  // `anular_compra`; el rol «mozo» NO se crea en código: se crea desde /administracion/roles y se le dan las acciones desde la matriz de permisos.
  { clave: "pos_mesas", descripcion: "Ver el mapa de mesas del salón y entrar a la mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // «Tomar pedido» (docs/plan-tomar-pedido-2026-09-25.md, B4): claves separadas para poder armar un rol «mozo» que toma pedidos (con
  // `pos_mesas` Ver + `pos_abrir_cuenta` + `pos_tomar_pedido` + `pos_enviar_a_cocina`) sin poder anular lo que ya salió a cocina ni cobrar.
  // Todas arrancan solo en admin.
  { clave: "pos_tomar_pedido", descripcion: "Tomar pedidos en el salón: agregar y quitar ítems sin enviar (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
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
  // Partición de claves de stock, conteo, promociones, POS y catálogo (decisión del dueño, 2026-09-30: una clave por acción; migración de datos
  // 20261001130000_particion_permisos_stock_pos_catalogo). Cada una nace con lo que ya tenía en la clave de la que se separó (el mapa
  // padre → hija está en la migración); el padre sigue existiendo hasta la fase de contracción.
  { clave: "stock_seccion_habitual", descripcion: "Fijar la Sección habitual de cada producto", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "pos_emitir_boleta_corregida", descripcion: "Emitir la boleta corregida de una cuenta ya cerrada (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "insumo_renombrar_fusionar", descripcion: "Renombrar un insumo o fusionarlo con otro", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "conteo_resolver_pendiente", descripcion: "Resolver un conteo físico pendiente de revisión", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "stock_reclasificar", descripcion: "Reclasificar stock: repartir el saldo de un producto entre otras secciones y lotes", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "conteo_frecuencia", descripcion: "Fijar cada cuántos días se cuenta cada producto (Frecuencia de conteo)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "promociones_activar", descripcion: "Activar o desactivar las Promociones de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "promociones_marcar_combo", descripcion: "Marcar un producto como Combo", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "producto_ver_catalogo", descripcion: "Ver el catálogo de productos y la ficha de cada uno", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_presentaciones", descripcion: "Agregar y activar o desactivar presentaciones alternativas de un producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "insumo_alta", descripcion: "Dar de alta un insumo", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "categoria_alta", descripcion: "Dar de alta una categoría de producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proveedor_alta", descripcion: "Dar de alta un proveedor", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_asignar_insumo", descripcion: "Asignar un insumo a una materia prima ya existente (asistente de hermanar)", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_sincronizar_precio_carta", descripcion: "Aplicar el mismo precio de venta a los productos de un ítem agrupado de la carta", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_disponibilidad", descripcion: "Marcar un producto como disponible o no disponible", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "pos_alta_mesa", descripcion: "Dar de alta mesas en el salón (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_limite_mesas_abiertas", descripcion: "Fijar el límite de mesas abiertas a la vez (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_abrir_cuenta", descripcion: "Abrir la cuenta de una mesa y corregir sus comensales (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_enviar_a_cocina", descripcion: "Enviar a cocina los ítems de una cuenta (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_liberar_mesa", descripcion: "Liberar una mesa abierta que no tuvo consumo (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
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
 * volver a entrar a corregirlo. Las claves en que se partieron (roles, activar
 * o anotar usuarios, apagar cuentas) siguen igual: perder cualquiera de ellas
 * deja a la empresa sin quien pueda ordenar su propia gente.
 */
export const ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE: readonly AccionClave[] = [
  "gestion_permisos",
  "gestion_roles",
  "gestion_usuarios",
  "activar_usuario_sucursal",
  "notas_usuario_sucursal",
  "apagar_cuenta_empresa",
];
