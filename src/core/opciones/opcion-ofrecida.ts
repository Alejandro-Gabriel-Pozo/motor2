/**
 * Las dos reglas de «qué cuenta» de un grupo y de una opción de un producto, escritas UNA vez (lote 3b de «bajar la deuda»; antes cada sitio repetía `activa && admitida` / `admitido && activo`).
 * Puras, sobre la forma mínima: sirven a cualquier lectura que traiga esos campos (`GrupoParaVender`, `OpcionParaVender`, las del selector y de la carta).
 *
 * - OPCIÓN OFRECIDA: prendida para toda la empresa (`activa`) Y admitida por el producto (`admitida`). NO mira si está agotada hoy en la sucursal: eso es `opcionDisponible` (`core/pos`), que agrega
 *   «no apagada en la sucursal». Quien muestra o cuenta lo ofrecido aunque se haya agotado (la carta, el combo, el origen de stock) usa ESTA; quien deja elegir hoy usa `opcionDisponible`.
 * - GRUPO VIGENTE: el producto lo admite (la fila de `ProductoAdmiteGrupo` está activa: `admitido`) Y está prendido para la empresa (`activo`).
 */
export function opcionOfrecida(opcion: { activa: boolean; admitida: boolean }): boolean {
  return opcion.activa && opcion.admitida;
}

export function grupoVigente(grupo: { admitido: boolean; activo: boolean }): boolean {
  return grupo.admitido && grupo.activo;
}
