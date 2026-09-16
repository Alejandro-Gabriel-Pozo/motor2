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

export interface AccionSemilla {
  clave: string;
  descripcion: string;
  /** Roles que pueden EDITAR esta acción desde el arranque (seed). */
  rolesEditarSemilla: Array<"admin" | "operador">;
}

export const ACCIONES: readonly AccionSemilla[] = [
  { clave: "alta_producto", descripcion: "Dar de alta un producto", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "editar_producto", descripcion: "Editar un producto existente", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "guardar_receta", descripcion: "Crear/editar una receta (Editor de Recetas)", rolesEditarSemilla: ["admin"] },
  { clave: "grupos_familia", descripcion: "Renombrar/fusionar Familias y asignar Grupos", rolesEditarSemilla: ["admin"] },
  { clave: "secciones", descripcion: "Administrar el catálogo de Secciones", rolesEditarSemilla: ["admin"] },
  { clave: "unidades", descripcion: "Administrar el catálogo de Unidades de medida", rolesEditarSemilla: ["admin"] },
  { clave: "proveedores", descripcion: "Administrar el catálogo de Proveedores (activar/desactivar)", rolesEditarSemilla: ["admin"] },
  { clave: "categorias", descripcion: "Administrar el catálogo de Categorías", rolesEditarSemilla: ["admin"] },
  { clave: "stock_minimo", descripcion: "Fijar Stock Mínimo (global o por sección)", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, porción Stock):
  // calcularStockConsolidado_/calcularStockPorFamilia_/calcularAlertasStock_
  // no tenían NINGÚN gate propio ahí (solo se ocultaban a nivel de menú de
  // Sheets, que no es una barrera real — la función seguía siendo
  // client-callable directo). Acá SÍ hay una capa de permisos real: se le
  // da una Accion propia, abierta a operador (ver stock es visibilidad
  // operativa del día a día, distinto de FIJAR el mínimo, que sigue
  // admin-only en 'stock_minimo').
  { clave: "ver_stock", descripcion: "Ver Stock consolidado, por familia y alertas", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "precio_local", descripcion: "Fijar Precio Local por sucursal", rolesEditarSemilla: ["admin"] },
  { clave: "promociones_config", descripcion: "Activar Promociones y marcar productos como Combo", rolesEditarSemilla: ["admin"] },
  { clave: "comparar_precios", descripcion: "Comparar precios por proveedor", rolesEditarSemilla: ["admin"] },
  { clave: "notificar_alertas", descripcion: "Notificar alertas de stock por mail", rolesEditarSemilla: ["admin"] },
  { clave: "insumos_mezclados", descripcion: "Revisar insumos con unidad mezclada", rolesEditarSemilla: ["admin"] },
  // 'reconstruir_productos' NO se migra (ver plan, porción Catálogo): era
  // el parche de Apps Script para resincronizar Productos ↔ Hoja listado
  // (dos hojas, sin FKs). Acá Producto es una sola tabla — no hay nada que
  // reconstruir.
  // 'sincronizar_proveedores' queda reservada sin server action propia:
  // ver plan, porción Catálogo — solo tendría sentido para importar un
  // histórico externo con nombres de proveedor sueltos, no para esta porción.
  { clave: "sincronizar_proveedores", descripcion: "Sincronizar Proveedores desde el historial", rolesEditarSemilla: ["admin"] },
  { clave: "ejecutar_tests", descripcion: "Ejecutar la suite de tests", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_usuarios", descripcion: "Gestionar usuarios y roles", rolesEditarSemilla: ["admin"] },
  { clave: "gestion_permisos", descripcion: "Gestionar qué rol puede hacer cada acción", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_compra", descripcion: "Registrar una Compra", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_produccion", descripcion: "Registrar una Producción", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_consumo", descripcion: "Registrar un Consumo", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_ajuste", descripcion: "Registrar un Ajuste (corrección de stock)", rolesEditarSemilla: ["admin"] },
  { clave: "proceso_control", descripcion: "Registrar un Conteo Físico", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_transferencia", descripcion: "Registrar una Transferencia entre secciones", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_merma", descripcion: "Registrar una Merma", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_venta", descripcion: "Registrar una Venta", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_consignacion", descripcion: "Devolver mercadería al consignante", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_cliente", descripcion: "Registrar una devolución de cliente (revendible)", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_devolucion_proveedor", descripcion: "Devolver mercadería a un proveedor", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "proceso_transferencia_sucursal", descripcion: "Solicitar/aprobar/aceptar transferencias con otra sucursal", rolesEditarSemilla: ["admin", "operador"] },
  { clave: "cancelar_conteo", descripcion: "Cancelar un conteo físico ya aplicado", rolesEditarSemilla: ["admin"] },
  { clave: "anular_venta", descripcion: "Anular una venta ya confirmada", rolesEditarSemilla: ["admin"] },
  { clave: "capacidades_sucursal", descripcion: "Habilitar/deshabilitar qué puede gestionar cada sucursal", rolesEditarSemilla: ["admin"] },
  // Nueva (no existía en Apps Script — ver plan, "Bootstrap de admin"):
  // reemplaza el paso manual crear-contenedor.js por una acción real del
  // sistema, exclusiva de admin, que crea la sucursal y asigna su primer
  // admin en la misma transacción (nunca queda una sucursal sin admin).
  { clave: "alta_sucursal", descripcion: "Dar de alta una sucursal nueva y asignar su primer admin", rolesEditarSemilla: ["admin"] },
] as const;

export type AccionClave = (typeof ACCIONES)[number]["clave"];

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
