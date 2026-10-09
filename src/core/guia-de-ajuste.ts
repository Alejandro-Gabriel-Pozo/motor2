/**
 * Qué se le dice al operario cuando una anulación o una cancelación se rechaza porque después hubo un conteo o un ajuste (D7): el historial no se reescribe y la diferencia se corrige con un
 * Ajuste de stock. Un solo texto para los tres rechazos (cancelar un conteo, anular una compra, anular una venta), para que no se desparejen. Dónde se carga (`/movimientos/ajuste`, la clave
 * `proceso_ajuste`) y para qué lado va el signo: lo que el operario necesita para resolverlo sin preguntar.
 */
export const GUIA_PARA_CORREGIR_CON_UN_AJUSTE =
  "Para corregirlo, cargá un Ajuste de stock (Movimientos → Ajuste) por la diferencia: suma si en el sistema falta mercadería y resta si sobra. Si no ves esa opción, pedile a un administrador que lo cargue.";
