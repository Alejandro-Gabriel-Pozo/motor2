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
 * Es un PISO (DECLARADO, todavía NO se hace cumplir: `guardarPermisos` y el gate no lo leen; lo comprueba solo `matriz-de-fabrica.test.ts`
 * contra la matriz de fábrica): la idea es que ningún rol por debajo lo alcance por más que se le marque en la matriz. Los roles personalizados (mozo, cajero…) son nivel
 * operario; el rol «admin» es nivel administrador; «gerente» no es un rol de sucursal sino `UsuarioEmpresa.rolEmpresa` (uno por empresa).
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
  // Reportes, agrupados por sensibilidad (decisión del usuario, 2026-09-19: ~5 claves y no una por reporte, y el rol
  // «operador» arranca SIN asignar). Antes, 18 de las 19 páginas de /reportes no tenían ningún permiso. Los reportes que ya
  // tienen una acción propia se protegen con esa (`promociones_config`, `pagar_consignante`, `proceso_control`,
  // `insumos_mezclados`); estas cuatro cubren el resto. Son claves de «Ver»: no hay nada que editar.
  { clave: "ver_reportes_dinero", descripcion: "Ver los reportes de dinero: resumen, consolidado, período, por categoría, costos y márgenes, valuación y rendimiento de recetas", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_reportes_control", descripcion: "Ver los reportes de control: pérdidas y consumo interno, devoluciones y diferencias de ajuste", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_reportes_operativos", descripcion: "Ver los reportes operativos: vencimientos, salud por producto, historial de un producto, trazabilidad y rotación de mesas", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
  { clave: "ver_reportes_catalogo", descripcion: "Ver los reportes de calidad del catálogo: insumos sin receta y ventas sin receta", contexto: "sucursal", nivelMinimo: "administrador", rolesEditarSemilla: ["admin"] },
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
 * volver a entrar a corregirlo.
 */
export const ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE: readonly AccionClave[] = [
  "gestion_permisos",
  "gestion_usuarios",
];
