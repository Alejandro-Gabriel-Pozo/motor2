import type { AccionClave, ContextoDeAccion, NivelDeAccion } from "../../src/core/permisos/acciones";

/**
 * La matriz de fábrica ESPERADA de las acciones, escrita a mano y a propósito aparte del catálogo (`src/core/permisos/acciones.ts`): si
 * alguien cambia el contexto, el nivel mínimo o quién edita una acción en el catálogo, este archivo no cambia solo y
 * `matriz-de-fabrica.test.ts` falla — el cambio queda a la vista en el diff y hay que hacerlo dos veces, adrede. Es la forma barata de
 * que un permiso no se abra por descuido (por ejemplo, darle una acción de administrador a un rol de operario).
 */
export interface FilaEsperada {
  contexto: ContextoDeAccion;
  nivelMinimo: NivelDeAccion;
  /** Roles que EDITAN la acción desde el arranque (seed). */
  roles: readonly ("admin" | "operador")[];
}

export const MATRIZ_ESPERADA: Readonly<Record<AccionClave, FilaEsperada>> = {
  alta_producto: { contexto: "empresa", nivelMinimo: "operario", roles: ["admin", "operador"] },
  editar_producto: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  guardar_receta: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  grupos_familia: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  secciones: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  unidades: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  proveedores: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  categorias: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  motivos_movimiento: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  carta: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  stock_minimo: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_stock: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  precio_local: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  promociones_config: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  comparar_precios: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  notificar_alertas: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  insumos_mezclados: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  sincronizar_proveedores: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  ejecutar_tests: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  gestion_usuarios: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  gestion_permisos: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  proceso_compra: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_produccion: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_consumo: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_ajuste: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  proceso_control: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_transferencia: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_merma: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_venta: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_devolucion_consignacion: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_devolucion_cliente: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_devolucion_proveedor: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  proceso_transferencia_sucursal: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin", "operador"] },
  cancelar_conteo: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  anular_venta: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  anular_compra: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  corregir_compra: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  capacidades_sucursal: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  alta_sucursal: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  pagar_consignante: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_auditoria: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_reportes_dinero: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_reportes_control: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_reportes_operativos: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  ver_reportes_catalogo: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  pos_mesas: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin"] },
  pos_tomar_pedido: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin"] },
  pos_anular_item: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin"] },
  pos_cerrar_cuenta: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin"] },
  calibrar_rendimiento_local: { contexto: "sucursal", nivelMinimo: "administrador", roles: ["admin"] },
  clientes: { contexto: "empresa", nivelMinimo: "administrador", roles: ["admin"] },
  pos_asignar_cliente: { contexto: "sucursal", nivelMinimo: "operario", roles: ["admin"] },
};
