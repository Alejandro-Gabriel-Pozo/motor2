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

import type { ModuloId } from "../modulos/catalogo";

/** Sobre qué opera la acción: la empresa entera (sus datos no tienen sucursal) o la sucursal activa. */
export type ContextoDeAccion = "empresa" | "sucursal";

/**
 * Nivel de quien puede llegar a tener la acción (RBAC con jerarquía, decisión del dueño 2026-09-30; cuarto escalón por ADR-027, 2026-10-08):
 * operario < administrador < administrador de sistema < gerente (rangos 1 a 4, en `RANGO_DE_PISO` de `jerarquia.ts`, el único lugar que los ordena).
 * Es un PISO y SE HACE CUMPLIR en dos puntos: `guardarPermisos` rechaza darle a un rol por debajo del piso el Ver/Editar de la acción, y el gate
 * (`gate.ts`) ignora la fila aunque exista (una migración o un dato viejo no la convierten en acceso). Los roles personalizados (mozo, cajero…)
 * y «operador» son de rango operario; el rol de clave «admin» es el administrador de sistema (alcanza los pisos administrador y administrador de
 * sistema); «gerente» no es un rol de sucursal sino `UsuarioEmpresa.rolEmpresa` (uno por empresa): una acción de piso gerente la tiene SOLO quien
 * es gerente, sin pasar por la matriz, y por eso es de contexto empresa.
 * - «administrador»: la autoridad operativa (anular, corregir, catálogos, carta, reportes de dinero). Es el piso que alcanzará un rol propio de la empresa
 *   de rango 2 («encargado», F3 de ADR-027, cuando exista `Rol.nivel`); hoy no lo tiene nadie más que el rol «admin».
 * - «administrador_sistema»: el gobierno de la empresa (las claves del módulo `administracion` que no son de gerente: usuarios, roles, matriz,
 *   sucursales, capacidades y la auditoría de la sucursal, D16). Un rango 2 nunca lo alcanza.
 */
export type NivelDeAccion = "operario" | "administrador" | "administrador_sistema" | "gerente";

export interface AccionSemilla {
  clave: string;
  /** Módulo al que pertenece (ADR-011/015, §11 de la nota de dependencias): el guard evalúa módulo → capacidad → rol. Obligatorio en cada acción. */
  modulo: ModuloId;
  descripcion: string;
  contexto: ContextoDeAccion;
  nivelMinimo: NivelDeAccion;
  /** Roles que pueden EDITAR esta acción desde el arranque (seed). */
  rolesEditarSemilla: readonly ("admin" | "operador")[];
}

// `satisfies` (no una anotación `: readonly AccionSemilla[]`): la anotación anula el `as const` y `AccionClave` degenera en `string`.
export const ACCIONES = [
  { clave: "alta_producto", modulo: "catalogo_basico", descripcion: "Dar de alta un producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_editar", modulo: "catalogo_basico", descripcion: "Editar un producto existente", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "guardar_receta", modulo: "recetas", descripcion: "Crear/editar una receta (Editor de Recetas)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "grupos_familia", modulo: "catalogo_basico", descripcion: "Administrar los Grupos de insumos, asignar cada insumo a su Grupo y activar o desactivar insumos", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "secciones", modulo: "stock", descripcion: "Administrar el catálogo de Secciones", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "unidades", modulo: "catalogo_basico", descripcion: "Administrar el catálogo de Unidades de medida", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proveedores", modulo: "proveedores_basico", descripcion: "Administrar el catálogo de Proveedores (activar/desactivar)", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "categorias", modulo: "catalogo_basico", descripcion: "Administrar el catálogo de Categorías", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Food cost objetivo (2026-10-01): lo fija SOLO administración (decisión del dueño), el de la empresa y el de cada categoría.
  { clave: "margen_objetivo_editar", modulo: "recetas", descripcion: "Fijar el food cost objetivo de la empresa y de cada categoría", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Los motivos de Consumo/Merma ya no vienen hardcodeados en un enum fijo (hallazgo real, 2026-09-23). Una clave por catálogo (decisión
  // del dueño, 2026-09-30: una clave por acción); `motivos_movimiento` (una sola para los dos) se retiró.
{ clave: "motivos_merma", modulo: "stock", descripcion: "Administrar el catálogo de Motivos de merma", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "motivos_destino_consumo", modulo: "stock", descripcion: "Administrar el catálogo de Destinos de consumo", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (docs/plan-carta-catalogo-2026-09-24.md, M8): administrar lo que la carta pública (restaurant-menu-design) lee de acá —
  // las secciones de carta, qué categoría cae en cada una, el contenido de cara al cliente de cada PV y las promos de la sucursal.
  // Solo admin: es lo que ve el público.
  // Carta pública: una clave por bloque de administración (decisión del dueño, 2026-09-30); `carta` (una sola para todo) se retiró.
  { clave: "carta_ver", modulo: "carta", descripcion: "Entrar a la pantalla Carta y ver sus secciones, géneros, contenido y promos", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_secciones", modulo: "carta", descripcion: "Administrar las secciones de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // S-10 / D1 (decisión del dueño, 2026-10-08; fila O.59): `carta_generos`, `carta_contenido_producto` y `carta_items_agrupados` ESCRIBEN solo en la carta de la sucursal ACTIVA (la carta es propia
  // de cada sucursal, ADR-009 C3), así que son de contexto SUCURSAL: se evalúan contra la membresía de la sucursal donde se escribe, no contra «alguna membresía de la empresa». Declararlas de
  // empresa (2026-09-30) fue un error. Las que de verdad son de la empresa entera (`carta_secciones`, `carta_portal`, `carta_promo_definir`) no cambian.
  { clave: "carta_generos", modulo: "carta", descripcion: "Administrar los géneros de la carta pública", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_contenido_producto", modulo: "carta", descripcion: "Editar el contenido de carta de cada producto de venta", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Producto con descuento (2026-10-01): el % es por sucursal; no es una promoción.
  { clave: "carta_producto_descuento", modulo: "carta", descripcion: "Fijar o sacar el descuento en porcentaje de un producto en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_items_agrupados", modulo: "carta", descripcion: "Administrar los ítems agrupados de la carta pública", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_portal", modulo: "carta", descripcion: "Administrar el portal de sucursales de la carta pública", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Una promo es de la empresa (decisión del dueño, 2026-10-01): definirla es de empresa; prenderla/apagarla y ponerle precio son de la sucursal.
  { clave: "carta_promo_definir", modulo: "promociones", descripcion: "Crear y editar las promos de la carta (de la empresa): datos, cupos y apagado general", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_promo_activar", modulo: "promociones", descripcion: "Prender o apagar una promo de la empresa en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_promo_precio_local", modulo: "promociones", descripcion: "Fijar el precio de una promo solo en la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_tema", modulo: "carta", descripcion: "Administrar el tema visual de la carta de la sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "stock_minimo", modulo: "stock", descripcion: "Fijar Stock Mínimo (global o por sección)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, porción Stock):
  // calcularStockConsolidado_/calcularStockPorFamilia_/calcularAlertasStock_
  // no tenían NINGÚN gate propio ahí (solo se ocultaban a nivel de menú de
  // Sheets, que no es una barrera real — la función seguía siendo
  // client-callable directo). Acá SÍ hay una capa de permisos real: se le
  // da una Accion propia, abierta a operador (ver stock es visibilidad
  // operativa del día a día, distinto de FIJAR el mínimo, que sigue
  // admin-only en 'stock_minimo').
  { clave: "ver_stock", modulo: "stock", descripcion: "Ver Stock consolidado, por familia y alertas", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "precio_local", modulo: "catalogo_basico", descripcion: "Fijar Precio Local por sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "comparar_precios", modulo: "compras", descripcion: "Comparar precios por proveedor", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "notificar_alertas", modulo: "stock", descripcion: "Notificar alertas de stock por mail", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "insumos_mezclados", modulo: "catalogo_basico", descripcion: "Revisar insumos con unidad mezclada", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // 'reconstruir_productos' NO se migra (ver plan, porción Catálogo): era
  // el parche de Apps Script para resincronizar Productos ↔ Hoja listado
  // (dos hojas, sin FKs). Acá Producto es una sola tabla — no hay nada que
  // reconstruir.
  // 'sincronizar_proveedores' y 'ejecutar_tests' se retiraron del catálogo (2026-10-01): nunca tuvieron una acción que las usara (la primera era
  // para importar un histórico externo; la segunda, la suite de tests de Apps Script) y una clave sin acción es una promesa falsa en la matriz.
  // Administración: una clave por acción. `gestion_usuarios` queda para agregar gente a la sucursal y cambiarle el rol (el resto de lo que
  // hacía se partió); `gestion_permisos`, para la matriz de permisos (la gestión de roles pasó a `gestion_roles`).
  { clave: "gestion_usuarios", modulo: "administracion", descripcion: "Agregar usuarios a la sucursal y cambiarles el rol", contexto: "sucursal", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "activar_usuario_sucursal", modulo: "administracion", descripcion: "Activar o desactivar a un usuario en la sucursal", contexto: "sucursal", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "notas_usuario_sucursal", modulo: "administracion", descripcion: "Editar las notas de un usuario en la sucursal", contexto: "sucursal", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "apagar_cuenta_empresa", modulo: "administracion", descripcion: "Apagar o reactivar la cuenta de un usuario en toda la empresa", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_permisos", modulo: "administracion", descripcion: "Gestionar la matriz de permisos de los roles", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_roles", modulo: "administracion", descripcion: "Crear, activar y desactivar roles", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "renombrar_rol", modulo: "administracion", descripcion: "Cambiar el nombre de un rol (nunca su clave técnica)", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_compra", modulo: "compras", descripcion: "Registrar una Compra", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_produccion", modulo: "produccion", descripcion: "Registrar una Producción", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_consumo", modulo: "stock", descripcion: "Registrar un Consumo", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_ajuste", modulo: "stock", descripcion: "Registrar un Ajuste (corrección de stock)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_control", modulo: "stock", descripcion: "Registrar un Conteo Físico", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_transferencia", modulo: "stock", descripcion: "Registrar una Transferencia entre secciones", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_merma", modulo: "stock", descripcion: "Registrar una Merma", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_venta", modulo: "salon", descripcion: "Registrar una Venta", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_consignacion", modulo: "consignacion", descripcion: "Devolver mercadería al consignante", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_cliente", modulo: "salon", descripcion: "Registrar una devolución de cliente (revendible)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_proveedor", modulo: "compras", descripcion: "Devolver mercadería a un proveedor", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  // Traspasos entre sucursales: una clave por acción y una para ver la bandeja (reemplazan a `proceso_transferencia_sucursal`, retirada).
  { clave: "traspaso_ver_bandeja", modulo: "traspasos", descripcion: "Ver la bandeja de traspasos con otras sucursales", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_solicitar", modulo: "traspasos", descripcion: "Solicitar a otra sucursal que nos envíe stock (traspaso)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_enviar_directo", modulo: "traspasos", descripcion: "Enviarle stock a otra sucursal sin que lo haya pedido (traspaso)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_aprobar", modulo: "traspasos", descripcion: "Aprobar y enviar una solicitud de traspaso que nos hicieron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_cancelar_solicitud", modulo: "traspasos", descripcion: "Cancelar una solicitud de traspaso propia", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_rechazar_solicitud", modulo: "traspasos", descripcion: "Rechazar una solicitud de traspaso que nos hicieron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_aceptar", modulo: "traspasos", descripcion: "Aceptar un envío de traspaso que nos mandaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_rechazar_envio", modulo: "traspasos", descripcion: "Rechazar un envío de traspaso que nos mandaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "traspaso_confirmar_reingreso", modulo: "traspasos", descripcion: "Confirmar el reingreso de un envío de traspaso que nos rechazaron", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "cancelar_conteo", modulo: "stock", descripcion: "Cancelar un conteo físico ya aplicado", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "anular_venta", modulo: "salon", descripcion: "Anular una venta ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Más restrictivo que `proceso_compra` (cargarla), a propósito y con el mismo criterio que `anular_venta`: deshacer una compra confirmada mueve el stock y el gasto.
  { clave: "anular_compra", modulo: "compras", descripcion: "Anular una compra ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Corregir solo la CABECERA de una compra ya confirmada (proveedor, N.º de factura, detalle); nunca sus líneas. Mismo criterio restrictivo que `anular_compra`.
  { clave: "corregir_compra", modulo: "compras", descripcion: "Corregir el proveedor, el N.º de factura o el detalle de una compra ya confirmada", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "capacidades_sucursal", modulo: "administracion", descripcion: "Habilitar/deshabilitar qué puede gestionar cada sucursal", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, "Bootstrap de admin"):
  // reemplaza el paso manual crear-contenedor.js por una acción real del
  // sistema, exclusiva de admin, que crea la sucursal y asigna su primer
  // admin en la misma transacción (nunca queda una sucursal sin admin).
  { clave: "alta_sucursal", modulo: "administracion", descripcion: "Dar de alta una sucursal nueva y asignar su primer admin", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "activar_sucursal", modulo: "administracion", descripcion: "Activar o desactivar una sucursal", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "renombrar_sucursal", modulo: "administracion", descripcion: "Renombrar una sucursal", contexto: "empresa", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  { clave: "pagar_consignante", modulo: "consignacion", descripcion: "Registrar un pago a un proveedor de consignación", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_auditoria", modulo: "administracion", descripcion: "Ver el registro de auditoría administrativa de la sucursal (precios y permisos)", contexto: "sucursal", nivelMinimo: "administrador_sistema", rolesEditarSemilla: ["admin"] },
  // Primera acción de piso gerente: la tiene solo el gerente de la empresa, sin pasar por la matriz (reemplaza el `esGerenteDeEmpresa` suelto de la
  // pantalla de Auditoría). No tiene padre: no existía como clave, así que la migración solo la da de alta y nadie la hereda.
  { clave: "ver_auditoria_empresa", modulo: "administracion", descripcion: "Ver las filas de auditoría de la empresa (las que no son de una sucursal)", contexto: "empresa", nivelMinimo: "gerente", rolesEditarSemilla: [] },
  // Segunda de piso gerente: reemplaza el `conGerenteDeEmpresa` suelto de la acción de traspaso. Sin padre, como la anterior.
  { clave: "traspasar_gerencia", modulo: "administracion", descripcion: "Traspasar la gerencia de la empresa a otro administrador", contexto: "empresa", nivelMinimo: "gerente", rolesEditarSemilla: [] },
  // Reportes: UNA clave por reporte (decisión del dueño, 2026-09-30; reemplaza la agrupación `ver_reportes_*` del 2026-09-19). Son claves de
  // «Ver»: no hay nada que editar. Los reportes de dinero y de control tienen piso de administrador (un operario nunca los recibe); los
  // operativos son de operario, así que un rol de depósito los puede recibir. Las pantallas de /reportes que además operan (consignación)
  // siguen con la clave de su acción: ver la pantalla y operarla es lo mismo ahí.
  { clave: "reporte_resumen", modulo: "stock", descripcion: "Ver el reporte «Resumen operativo»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_consolidado", modulo: "stock", descripcion: "Ver el reporte «Consolidado (mis sucursales)»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_periodo", modulo: "stock", descripcion: "Ver el reporte «Período»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_categorias", modulo: "stock", descripcion: "Ver el reporte «Por categoría»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_ventas_por_seccion", modulo: "salon", descripcion: "Ver el reporte «Por sección de carta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_costos", modulo: "recetas", descripcion: "Ver el reporte «Costos y márgenes»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_compras", modulo: "compras", descripcion: "Ver el reporte «Compras registradas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rendimiento_recetas", modulo: "recetas", descripcion: "Ver el reporte «Rendimiento real de recetas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rendimiento_sucursal", modulo: "recetas", descripcion: "Ver el reporte «Rendimiento por sucursal»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_valuacion", modulo: "stock", descripcion: "Ver el reporte «Valuación de inventario»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_tickets", modulo: "salon", descripcion: "Ver el reporte «Tickets emitidos»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_descuentos_clientes", modulo: "salon", descripcion: "Ver el reporte «Descuentos por cliente»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_descuentos_productos", modulo: "salon", descripcion: "Ver el reporte «Descuentos de productos»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_margen_promociones", modulo: "promociones", descripcion: "Ver el reporte «Margen de promociones»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_historial_importes", modulo: "stock", descripcion: "Ver los datos comerciales (precios de compra y de venta, proveedor y N.º de factura) dentro del reporte «Historial de un producto»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_perdidas", modulo: "stock", descripcion: "Ver el reporte «Pérdidas»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_devoluciones", modulo: "stock", descripcion: "Ver el reporte «Devoluciones»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_diferencias", modulo: "stock", descripcion: "Ver el reporte «Diferencias de ajuste»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_vencimientos", modulo: "stock", descripcion: "Ver el reporte «Vencimientos»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_salud", modulo: "stock", descripcion: "Ver el reporte «Salud por producto»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_historial", modulo: "stock", descripcion: "Ver el reporte «Historial de un producto»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_trazabilidad", modulo: "stock", descripcion: "Ver el reporte «Trazabilidad por ID»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_rotacion_mesas", modulo: "salon", descripcion: "Ver el reporte «Rotación de mesas»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_sin_receta", modulo: "recetas", descripcion: "Ver el reporte «Ventas sin receta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_insumos_sin_receta", modulo: "recetas", descripcion: "Ver el reporte «Insumos sin receta»", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "reporte_conteos", modulo: "stock", descripcion: "Ver el reporte «Conteos físicos»", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "reporte_huecos_catalogo", modulo: "catalogo_basico", descripcion: "Ver el reporte «Huecos de catálogo»", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Módulo POS (docs/plan-mapa-de-mesas-2026-09-24.md): Ver = abrir el mapa de mesas y entrar a una mesa; dar de alta mesas y fijar el límite de
  // mesas abiertas tienen su clave (`pos_alta_mesa`, `pos_limite_mesas_abiertas`). El operador de fábrica queda sin asignar, igual que
  // `anular_compra`; el rol «mozo» NO se crea en código: se crea desde /administracion/roles y se le dan las acciones desde la matriz de permisos.
  { clave: "pos_mesas", modulo: "salon", descripcion: "Ver el mapa de mesas del salón y entrar a la mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // «Tomar pedido» (docs/plan-tomar-pedido-2026-09-25.md, B4): claves separadas para poder armar un rol «mozo» que toma pedidos (con
  // `pos_mesas` Ver + `pos_abrir_cuenta` + `pos_tomar_pedido` + `pos_enviar_a_cocina`) sin poder anular lo que ya salió a cocina ni cobrar.
  // Todas arrancan solo en admin.
  { clave: "pos_tomar_pedido", modulo: "salon", descripcion: "Tomar pedidos en el salón: agregar y quitar ítems sin enviar (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_anular_item", modulo: "salon", descripcion: "Anular un ítem de una cuenta que ya se envió a cocina, con motivo (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_cerrar_cuenta", modulo: "salon", descripcion: "Cerrar la cuenta de una mesa: registra la venta en el stock y libera la mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // Rendimiento por sucursal (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, D5 — decisión del dueño, migración
  // de datos 20260926012600_permiso_calibrar_rendimiento_local): separada de `guardar_receta` a propósito — editar la
  // receta global es una decisión distinta de calibrar la sucursal propia.
  { clave: "calibrar_rendimiento_local", modulo: "recetas", descripcion: "Calibrar el rendimiento de las recetas en esta sucursal (cantidad y merma propias de cada ingrediente)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Receta propia por sucursal (decisión del dueño, 2026-10-02; ADR-009, familia override; migración de datos 20261002140000_permisos_receta_sucursal):
  // UNA clave por acción, todas de contexto sucursal (operan sobre la receta de la sucursal activa); `editar` es de nivel operario (el dueño decidió que un operador de la sucursal la pueda recibir tildándola), copiar y volver a la central son de administrador. Separadas de `guardar_receta`
  // (la receta central) y de `calibrar_rendimiento_local` a propósito: apagar la calibración no apaga la receta propia. Como toda acción de sucursal, la Central
  // puede deshabilitar cada una de las tres por sucursal desde la matriz de capacidades.
  { clave: "receta_sucursal_editar", modulo: "recetas", descripcion: "Crear o editar la receta propia de esta sucursal", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "receta_sucursal_copiar", modulo: "recetas", descripcion: "Copiar a esta sucursal la receta propia de otra sucursal", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "receta_sucursal_volver_central", modulo: "recetas", descripcion: "Volver la receta de esta sucursal a la central", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "carta_copiar_de_sucursal", modulo: "carta", descripcion: "Copiar a esta sucursal la carta propia de otra sucursal (solo sobre una carta vacía)", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // Cliente con descuento (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 9): 'clientes' administra el catálogo (alta,
  // edición del %, activar/desactivar), mismo criterio admin-only que el resto del catálogo (proveedores, categorías, ...).
  { clave: "clientes", modulo: "clientes_basico", descripcion: "Administrar el catálogo de Clientes y su % de descuento", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  // 'pos_asignar_cliente' (D3): CUALQUIER MOZO puede asignar un cliente con descuento a la cuenta de una mesa, no solo admin — mismo
  // criterio de seed que 'pos_tomar_pedido' arriba (arranca solo en admin; el rol «mozo» se arma desde /administracion/roles y la
  // matriz de permisos, que es donde se le da esta acción). La migración de datos (20260926190200_permiso_pos_asignar_cliente) hace
  // lo mismo que ESTE seed haría en una base nueva, más: en una base YA EXISTENTE con un rol «mozo» ya armado, le da la fila también
  // a ese rol (a cualquiera que ya edite 'pos_tomar_pedido'), no solo a admin — así no hace falta que un admin la vuelva a tocar.
  { clave: "pos_asignar_cliente", modulo: "salon", descripcion: "Asignar un cliente con descuento a la cuenta de una mesa (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  // Partición de claves de stock, conteo, promociones, POS y catálogo (decisión del dueño, 2026-09-30: una clave por acción; migración de datos
  // 20261001130000_particion_permisos_stock_pos_catalogo). Cada una nace con lo que ya tenía en la clave de la que se separó (el mapa
  // padre → hija está en la migración); el padre sigue existiendo hasta la fase de contracción.
  { clave: "stock_seccion_habitual", modulo: "stock", descripcion: "Fijar la Sección habitual de cada producto", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "pos_emitir_ticket_corregido", modulo: "salon", descripcion: "Emitir el ticket corregido de una cuenta ya cerrada (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "insumo_renombrar_fusionar", modulo: "catalogo_basico", descripcion: "Renombrar un insumo o fusionarlo con otro", contexto: "empresa", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "conteo_resolver_pendiente", modulo: "stock", descripcion: "Resolver un conteo físico pendiente de revisión", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "stock_reclasificar", modulo: "stock", descripcion: "Reclasificar stock: repartir el saldo de un producto entre otras secciones y lotes", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "conteo_frecuencia", modulo: "stock", descripcion: "Fijar cada cuántos días se cuenta cada producto (Frecuencia de conteo)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_ver_catalogo", modulo: "catalogo_basico", descripcion: "Ver el catálogo de productos y la ficha de cada uno", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_presentaciones", modulo: "catalogo_basico", descripcion: "Agregar y activar o desactivar presentaciones alternativas de un producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "insumo_alta", modulo: "catalogo_basico", descripcion: "Dar de alta un insumo", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "categoria_alta", modulo: "catalogo_basico", descripcion: "Dar de alta una categoría de producto", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proveedor_alta", modulo: "proveedores_basico", descripcion: "Dar de alta un proveedor", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_asignar_insumo", modulo: "catalogo_basico", descripcion: "Asignar un insumo a una materia prima ya existente (asistente de hermanar)", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "producto_sincronizar_precio_carta", modulo: "carta", descripcion: "Aplicar el mismo precio de venta a los productos de un ítem agrupado de la carta", contexto: "empresa", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "producto_disponibilidad", modulo: "catalogo_basico", descripcion: "Marcar un producto como disponible o no disponible", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "pos_alta_mesa", modulo: "salon", descripcion: "Dar de alta mesas en el salón (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_limite_mesas_abiertas", modulo: "salon", descripcion: "Fijar el límite de mesas abiertas a la vez (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_abrir_cuenta", modulo: "salon", descripcion: "Abrir la cuenta de una mesa y corregir sus comensales (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_enviar_a_cocina", modulo: "salon", descripcion: "Enviar a cocina los ítems de una cuenta (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
  { clave: "pos_liberar_mesa", modulo: "salon", descripcion: "Liberar una mesa abierta que no tuvo consumo (POS)", contexto: "sucursal", nivelMinimo: "operario", rolesEditarSemilla: ["admin"] },
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

export function moduloDeAccion(clave: AccionClave): ModuloId {
  return POR_CLAVE.get(clave)!.modulo;
}

export function contextoDeAccion(clave: AccionClave): ContextoDeAccion {
  return POR_CLAVE.get(clave)!.contexto;
}

export function nivelMinimoDeAccion(clave: AccionClave): NivelDeAccion {
  return POR_CLAVE.get(clave)!.nivelMinimo;
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
