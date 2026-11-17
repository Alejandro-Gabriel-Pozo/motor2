/**
 * Oráculo ÚNICO de las palabras del catálogo de textos (regla C6 del guardián `test/arquitectura/catalogo-de-textos.test.ts`; IT-7 del diseño `docs/diseno-textos-en-codigo-2026-11-16.md`: lo aprobado no cambia en
 * silencio). Una fila por clave: el texto EXACTO (los marcos con su plantilla `{…}` tal cual), escrito aparte del código. Cambiar una palabra del catálogo, sumar una clave o sacarla sin tocar acá pone el CI en rojo, así
 * que cada cambio de redacción queda a la vista en el diff con su DEC. Los textos de dinero, de permisos o fiscales los decide el dueño: una fila nueva o cambiada de esos temas lleva su cita en la DEC de la clave.
 * El texto queda escrito dos veces a propósito (catálogo y oráculo), como en `oraculo-de-permisos.ts`.
 */
export const ORACULO_DE_TEXTOS: Readonly<Record<string, string>> = {
  "rechazo.PRESENTACION_AMBIGUA": "hay más de una presentación activa en esa unidad",
  "aviso.no_se_puede_registrar_la_compra": "No se puede registrar la compra de \"{producto}\": {causa}.",
  "aviso.no_se_pudo_agregar_la_presentacion": "No se pudo agregar la presentación: {causa}.",
  "accion.ocultar": "Ocultar",
  "accion.volver_a_mostrar": "Volver a mostrar",
  "accion.ocultar_en_la_empresa": "Ocultar en toda la empresa",
  "aviso.oculto": "Oculto",
  "aviso.oculto_en_la_empresa": "Oculto en toda la empresa",
  "rechazo.TIENE_EXISTENCIA": "Primero dejá la existencia en 0.",
  "aviso.receta_guardada_calibraciones_descartadas_por_base": "Se guardó la versión {version} de «{producto}» (ahora cargada en bruto). Se descartaron {cantidad} ajustes de sucursal porque eran del valor «neto» y ya no coinciden con la receta: {detalle}. Si hace falta, volvé a ajustarlos desde el reporte de rendimiento.",
  "aviso.receta_guardada_calibracion_descartada_por_base": "Se guardó la versión {version} de «{producto}» (ahora cargada en bruto). Se descartó 1 ajuste de sucursal porque era del valor «neto» y ya no coincide con la receta: {detalle}. Si hace falta, volvé a ajustarlo desde el reporte de rendimiento.",
  "columna.importe": "Importe",
  "columna.cobrado": "Cobrado",
  "columna.margen": "Margen",
  "columna.food_cost": "Food cost %",
  "columna.costo_unitario": "Costo unitario",
  "columna.a_precio_de_lista": "A precio de lista",
  "columna.margen_real_cobrado": "Margen Real (cobrado)",
  "rotulo.plan_creado": "Plan creado",
  "rotulo.plan_borrador_guardado": "Borrador de plan guardado",
  "rotulo.plan_version_publicada": "Versión de plan publicada",
  "rotulo.plan_asignado": "Plan asignado a la empresa",
  "rechazo.NO_ENCONTRADO": "No se encontró {entidad}.",
  "columna.producto": "Producto",
  "columna.cantidad": "Cantidad",
  "columna.seccion": "Sección",
  "columna.proveedor": "Proveedor",
  "columna.insumo": "Insumo",
  "columna.categoria": "Categoría",
  "columna.unidades": "Unidades",
  "columna.origen": "Origen",
  "rechazo.NOMBRE_REPETIDO": "Ya existe {entidad:un} llamado «{nombre}». Elegí otro nombre.",
  "rechazo.ACCION_DE_GOBIERNO": "Esta acción es de gobierno de la empresa y no se delega.",
};
