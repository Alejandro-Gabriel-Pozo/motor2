/**
 * DECLARACIONES A MANO del guardián de columnas de significado (etapa E2 del arnés de matrices, `docs/diseno-arnes-de-matrices-2026-11-03.md`; regla «Combinaciones» de AGENTS.md).
 *
 * Una columna de significado (Boolean, fecha de estado, enum o columna con CHECK; la definición exacta está en `esColumnaDeSignificado`) de un modelo que toca DINERO, VISIBILIDAD o
 * STOCK tiene que decir si afecta o no y por qué. Esto es el oráculo de «qué dimensiones hay»: se escribe a mano, nunca se genera del esquema (convención E0, I1).
 *
 * Cómo se declara una columna nueva (lo que pide el test cuando falla):
 *  1. Agregá una línea a `DECLARACIONES` con la clave `Modelo.columna`, `afecta` (`dinero`, `visibilidad`, `stock` o `ninguna`) y un `motivo` de verdad (≥ 20 caracteres:
 *     qué decide la columna, no «es un booleano»). `ninguna` también necesita motivo: es la declaración «miré y no cambia plata, carta ni stock».
 *  2. Si la columna es de significado pero NO tiene combinaciones propias que probar, igual se declara; si cambia dinero/visibilidad/stock, además va su fila en la matriz
 *     que corresponda (`docs/mapa-cobertura-de-combinaciones-2026-10-28.md`).
 *  3. Si la columna estaba en la línea de base (deuda), corré `BAJAR_CERCOS=1 npx vitest run test/arquitectura/cerco-columnas-de-significado.test.ts` para fijar que bajó.
 *
 * Lo que está SIN declarar hoy no está acá: vive en `cercos/linea-de-base/columnas-de-significado.json` como deuda con nombre, y esa cuenta solo puede bajar. No se inventan
 * motivos: una columna de la que no hay certeza de qué afecta se deja en la línea de base hasta que el dueño o quien la conozca la declare.
 */

export type Afecta = "dinero" | "visibilidad" | "stock" | "ninguna";
export const AFECTA_VALIDOS: readonly Afecta[] = ["dinero", "visibilidad", "stock", "ninguna"];

export interface Declaracion {
  afecta: Afecta;
  motivo: string;
}

type Clase = Exclude<Afecta, "ninguna">;

/**
 * Los modelos EN ALCANCE, por la clase de cosa que tocan (un modelo está en un solo grupo: el que más lo define). Lista propuesta, el dueño puede sacar o agregar.
 * Quedan fuera a propósito: identidad y sesiones (User, Account, Session, Invitacion, UsuarioEmpresa, UsuarioSucursal, Rol, PermisoRol: permisos, no dinero/visibilidad/stock), la consola de
 * plataforma, los índices externos (IndicePrecio, CotizacionDolar), y los diccionarios sin efecto propio (Grupo, CategoriaProducto, Presentacion, MotivoMerma, DestinoConsumo, Mesa).
 */
export const MODELOS_EN_ALCANCE: Readonly<Record<Clase, { motivo: string; modelos: readonly string[] }>> = {
  dinero: {
    motivo: "Compras, notas de crédito, costos, ventas cobradas y precios: cada columna puede cambiar un importe, un IVA o un precio que se cobra o se paga.",
    modelos: [
      "Venta", "Cuenta", "CuentaItem", "PromoCuenta", "OpcionElegidaEnLinea", "CombinacionEnLinea",
      "FacturaProveedor", "FacturaProveedorRenglon", "FacturaProveedorSucursal", "FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon", "AnulacionDeFacturaProveedor", "FacturaProveedorTributo",
      "NotaCreditoProveedor", "NotaCreditoProveedorLinea", "NotaCreditoProveedorImputacion", "NotaCreditoProveedorTributo",
      "ImputacionDeGasto", "ReclasificacionRenglon", "ConceptoDeGasto", "PlanDeCostos", "PlanDeCostosSucursal", "CentroDeCostos", "DistribucionCostoVersion", "DistribucionCostoLinea",
      "Proveedor", "ProveedorPorProducto", "PagoConsignante", "PuntoDeVentaDeProveedor", "Cliente", "Empresa",
      "PrecioLocalProducto", "PrecioLocalDeOpcion", "PrecioLocalDeCombinacion", "GrupoDePrecio", "DescuentoProductoSucursal",
    ],
  },
  visibilidad: {
    motivo: "Carta, opciones de venta y disponibilidad: cada columna puede cambiar qué se ofrece, qué se ve en la carta pública o en el POS, o qué se puede elegir.",
    modelos: [
      "Producto", "DisponibilidadProducto",
      "GrupoDeOpciones", "OpcionDeGrupo", "VersionDeOpcion", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion", "OpcionApagadaEnSucursal", "CombinacionDeProducto",
      "SeccionCarta", "ContenidoCartaProducto", "ItemAgrupadoCarta", "OpcionItemAgrupadoCarta", "GeneroCarta", "SucursalPublica", "TemaCartaSucursal",
      "PromoCarta", "PromoCartaSucursal", "PromoCartaCupo", "EntradaDeCupo", "OpcionDeEntradaDeCupo", "EntradaDelDiaDeCupo",
    ],
  },
  stock: {
    motivo: "Kardex, conteos, traspasos, recetas y secciones: cada columna puede cambiar cuánto stock hay, dónde está o qué se descuenta.",
    modelos: ["Operacion", "MovimientoStock", "ConteoFisico", "TraspasoSucursal", "Seccion", "RecetaSucursal", "RecetaVersion", "ConsumoDeOpcion", "RecetaDeCombinacionVersion", "Unidad", "Insumo"],
  },
};

/** Todos los modelos en alcance, ordenados. */
export const TODOS_LOS_MODELOS_EN_ALCANCE: readonly string[] = Object.values(MODELOS_EN_ALCANCE)
  .flatMap((g) => g.modelos)
  .sort();

const d = (afecta: Afecta, motivo: string): Declaracion => ({ afecta, motivo });
const CONTROL_OPTIMISTA = "Control optimista de la edición (>= 1, CHECK): es concurrencia, no cambia lo que se cobra ni lo que se ve.";
const IMPORTE_DE_NOTA = "Importe con IVA incluido de un comprobante de proveedor (CHECK de signo): es plata que se paga o se acredita.";

/** `Modelo.columna` → qué afecta y por qué. Cada motivo sale del comentario del esquema o de un guardián existente; lo que no tiene certeza no está acá. */
export const DECLARACIONES: Readonly<Record<string, Declaracion>> = {
  // Producto y disponibilidad
  "Producto.seProduce": d("stock", "Elegibilidad de receta: una materia prima solo se puede producir si seProduce = true (decide qué se fabrica y qué insumos se descuentan)."),
  "Producto.esConsignacion": d("dinero", "Marca el producto como de consignación: cambia el significado de la deuda con el consignante (columna de significado en escrituras-auditadas)."),
  "Producto.modoDeVenta": d("dinero", "Decide si se cobra el precio guardado del producto (DIRECTO) o el de cada opción (BASE_CONFIGURABLE), ADR-035."),
  "Producto.alicuotaIvaVenta": d("dinero", "Alícuota de IVA con la que se vende el producto y la que trae la factura de proveedor al comprarlo."),
  "DisponibilidadProducto.disponible": d("visibilidad", "Si el producto se usa en la sucursal (fila ausente = no disponible): lo saca de la carta y del POS."),
  // Compras etapa 2a: la unidad en que se compró (y cuántas, en cantidadCompra) es un dato informativo de la línea.
  "MovimientoStock.unidadCompraId": d("ninguna", "Unidad en que se compró la línea (solo COMPRA simple); NO decide stock ni dinero: la cantidad de stock y el importe se calculan antes (oráculo de Compras 2a)."),
  "FacturaProveedorRenglon.unidadCompraId": d("ninguna", "Unidad en que se compró el renglón de la factura; NO decide stock ni dinero: la cantidad de stock y el importe se calculan antes (oráculo de Compras 2a)."),
  // Precio local
  "PrecioLocalProducto.habilitado": d("dinero", "El precio local rige solo si está cargado y habilitado; si no, rige el precio de lista del producto."),
  "PrecioLocalDeOpcion.habilitado": d("dinero", "Sin fila habilitada rige el precio de la empresa, el de ProductoAdmiteOpcion o el de la versión de la opción."),
  "PrecioLocalDeOpcion.precio": d("dinero", "Precio de la opción en la sucursal (0,01 o más, CHECK): es lo que se cobra."),
  "PrecioLocalDeCombinacion.habilitado": d("dinero", "Sin fila habilitada (o con la capacidad precio_local apagada) rige el precio de la empresa."),
  "PrecioLocalDeCombinacion.precio": d("dinero", "Precio de la combinación o del grupo de precio en la sucursal (0,01 o más, CHECK): es lo que se cobra."),
  // Opciones de venta
  "GrupoDeOpciones.activo": d("visibilidad", "Si el grupo está activo cambia qué opciones se pueden elegir al vender (columna de significado en escrituras-auditadas)."),
  "OpcionDeGrupo.activa": d("visibilidad", "Si la opción está activa cambia qué se puede elegir al vender (columna de significado en escrituras-auditadas)."),
  "OpcionDeGrupo.descripcionEnCarta": d("visibilidad", "Carta B, E3 (2026-11-04): el texto que la carta le muestra al cliente bajo «Ver detalle» de la opción; decide qué lee el cliente, no toca precio ni stock, y no sale en ticket, comanda, POS ni reportes."),
  "ProductoAdmiteGrupo.activo": d("visibilidad", "Qué grupos admite un producto: cualquier escritura cambia qué se ofrece al vender (escrituras-auditadas)."),
  "ProductoAdmiteGrupo.seMuestraEnCarta": d("visibilidad", "«Mostrar este grupo en la carta» (decisión del dueño 2026-10-29): false = la carta no lee este grupo en este plato."),
  "ProductoAdmiteGrupo.modoPrecio": d("dinero", "ABSOLUTO o DIFERENCIA para una MEDIDA: decide si el precio de la medida reemplaza o ajusta el del producto."),
  "ProductoAdmiteOpcion.activo": d("visibilidad", "Qué opciones admite un producto: cualquier escritura cambia qué se ofrece al vender (escrituras-auditadas)."),
  "ProductoAdmiteOpcion.tipoDeDiferencia": d("dinero", "MONTO o PORCENTAJE: cómo se calcula la diferencia de precio de la opción para este producto."),
  "VersionDeOpcion.tipoDeDiferencia": d("dinero", "MONTO o PORCENTAJE: cómo se calcula la diferencia de precio de la opción (la vigente es la versión de número mayor)."),
  "OpcionApagadaEnSucursal.apagada": d("visibilidad", "true saca la opción de la venta en esa sucursal (se acabó el ingrediente); sin fila = prendida."),
  "OpcionElegidaEnLinea.tipoDeDiferencia": d("dinero", "Foto de lo cobrado: cómo se calculó la diferencia de la opción elegida en la línea (MONTO o PORCENTAJE)."),
  "OpcionElegidaEnLinea.modoPrecio": d("dinero", "Foto de lo cobrado: ABSOLUTO o DIFERENCIA de la medida elegida en la línea."),
  "OpcionElegidaEnLinea.precioDeSucursal": d("dinero", "Foto de lo cobrado: el importe de la opción salió de la grilla de la sucursal (PrecioLocalDeOpcion)."),
  "ConsumoDeOpcion.efecto": d("stock", "SUMA o REEMPLAZA: si la opción agrega un insumo o reemplaza un ingrediente de la receta, y por lo tanto qué se descuenta."),
  "ConsumoDeOpcion.escalaConLaMedida": d("stock", "Si el consumo se multiplica por el factor de la MEDIDA elegida: cambia cuánto se descuenta."),
  "CombinacionDeProducto.activa": d("visibilidad", "Con activa = false esa combinación no se vende (COMBINACION_NO_DISPONIBLE)."),
  "GrupoDeOpciones.version": d("ninguna", CONTROL_OPTIMISTA),
  "OpcionDeGrupo.version": d("ninguna", CONTROL_OPTIMISTA),
  "ProductoAdmiteGrupo.version": d("ninguna", CONTROL_OPTIMISTA),
  "ProductoAdmiteOpcion.version": d("ninguna", CONTROL_OPTIMISTA),
  "GrupoDePrecio.version": d("ninguna", CONTROL_OPTIMISTA),
  "CombinacionDeProducto.version": d("ninguna", CONTROL_OPTIMISTA),
  "PromoCarta.version": d("ninguna", CONTROL_OPTIMISTA),
  // Carta y promos
  "SeccionCarta.activa": d("visibilidad", "Nunca se borra una sección de la carta: se apaga, y apagada deja de mostrarse."),
  "ContenidoCartaProducto.visibleEnCarta": d("visibilidad", "Decide si el producto aparece en la carta pública."),
  "ContenidoCartaProducto.mostrarNombreArriba": d("visibilidad", "Decide cómo se lee un producto base en la carta (nombre como encabezado u oculto), DEC-11."),
  "PromoCarta.soloSalon": d("visibilidad", "La promo se vende desde el POS pero no aparece en la carta pública (web, QR ni impresa)."),
  "PromoCarta.vigenteDesde": d("dinero", "Vigencia de la promo (días de la zona de la empresa): fuera de ella no rige su precio. Se evalúa al agregar la promo a la cuenta."),
  "PromoCarta.vigenteHasta": d("dinero", "Vigencia de la promo (días de la zona de la empresa): fuera de ella no rige su precio. Se evalúa al agregar la promo a la cuenta."),
  "PromoCarta.diasDeSemana": d("dinero", "Máscara de los días de la semana en que vale la promo (bit 0 = lunes … bit 6 = domingo; 1 a 127, CHECK): fuera de esos días no rige su precio."),
  "PromoCartaSucursal.activa": d("visibilidad", "Prende o apaga la promo en la sucursal; apagada no va en la carta ni en el POS."),
  "PromoCartaCupo.activo": d("dinero", "Baja lógica de un cupo: cambia cuántas unidades de cada lugar entran en el combo por su precio (escrituras-auditadas)."),
  "PromoCartaCupo.tipo": d("dinero", "SECCION, LISTA o DEL_DIA (CHECK): de dónde sale lo que entra en el combo por su precio."),
  "EntradaDeCupo.activa": d("dinero", "Qué entra en un combo por su precio (las opciones de un lugar LISTA): cualquier escritura se audita (escrituras-auditadas)."),
  "EntradaDelDiaDeCupo.activa": d("dinero", "Qué entra en un combo por su precio (el plato del día): cualquier escritura se audita (escrituras-auditadas)."),
  "EntradaDelDiaDeCupo.fecha": d("dinero", "El día de calendario en que vale el plato del día dentro del combo (escrituras-auditadas)."),
  "SucursalPublica.publicada": d("visibilidad", "Si la sucursal está en el portal público de cartas (fila ausente = no está)."),
  "TemaCartaSucursal.aplicarEnCarta": d("ninguna", "Solo el estilo visual: false = la carta usa el estilo por defecto; no cambia qué se muestra ni qué se cobra."),
  // Stock
  "Seccion.sirveDeRespaldoEnVentas": d("stock", "Si el cierre de cuenta del POS puede descontar de esta sección cuando la habitual de un producto no alcanza."),
  "RecetaSucursal.habilitada": d("stock", "Decide si rige la receta propia de la sucursal o la central, y por lo tanto qué insumos se descuentan."),
  "Operacion.proceso": d("stock", "Clase de operación del Kardex (COMPRA, VENTA, MERMA, AJUSTE, TRANSFERENCIA…): fija el signo de la cantidad y cómo mueve el stock."),
  "MovimientoStock.proceso": d("stock", "Clase de la línea del Kardex (COMPRA, VENTA, MERMA, AJUSTE, TRANSFERENCIA…): fija el signo de la cantidad y cómo mueve el stock."),
  "Operacion.anuladaEn": d("dinero", "Una venta o compra anulada «no existió y se revirtió»: sale de los reportes de ventas y compras (y su stock se revierte con filas nuevas)."),
  "Operacion.revierteAOperacionId": d("stock", "En un AJUSTE que es la reversión por anulación de una venta o compra, la operación que revierte."),
  "Operacion.mermaPorAnulacionDeId": d("stock", "En una MERMA, la venta anulada cuyo género no se recuperó (la merma sale de esa anulación)."),
  "MovimientoStock.loteVencimiento": d("stock", "Lote (vencimiento) del movimiento: manda el FEFO simplificado al descontar."),
  "MovimientoStock.devuelveAMovimientoId": d("stock", "En una DEVOLUCION_PROVEEDOR, la línea de COMPRA del Kardex que se devuelve."),
  "ConteoFisico.loteVencimiento": d("stock", "El lote contado (puede quedar vacío: total sin lote puntual)."),
  "ConteoFisico.accion": d("stock", "Qué se hace con la diferencia contada: AJUSTAR, FALTA_MOVIMIENTO o DESCARTAR."),
  "ConteoFisico.estado": d("stock", "Estado del conteo físico (RESUELTO, PENDIENTE, DESCARTADO o CANCELADO): decide si la diferencia contada llegó a tocar el stock."),
  "ConteoFisico.motivoCancelacion": d("ninguna", "Solo el texto del motivo de la cancelación (CHECK: solo si el estado es CANCELADO); lo que cambia el stock es el estado."),
  "TraspasoSucursal.estado": d("stock", "Estado del traspaso entre sucursales: decide en qué momento el stock sale del origen y entra al destino."),
  "TraspasoSucursal.fechaDecisionOrigen": d("ninguna", "Instante de la decisión de Origen; lo que mueve el stock es el estado, la fecha es solo registro."),
  "TraspasoSucursal.fechaDecisionDestino": d("ninguna", "Instante de la decisión de Destino; lo que mueve el stock es el estado, la fecha es solo registro."),
  "TraspasoSucursal.fechaCierre": d("ninguna", "Instante en que Origen confirmó el reingreso; el estado ya lo dice, la fecha es solo registro."),
  "TraspasoSucursal.costoUnitarioOrigen": d("dinero", "Copia del costo de reposición del origen al enviar, por unidad de stock (ADR-040): el costo viaja con el traspaso."),
  // Ventas
  "Venta.importeTotal": d("dinero", "Copia del total cobrado (suma de las líneas al confirmar); no negativo (CHECK)."),
  "Cuenta.cerradaEn": d("dinero", "Una cuenta con cerradaEn nulo está abierta; cerrarla registra la venta."),
  // Compras
  "FacturaProveedor.importeTotal": d("dinero", IMPORTE_DE_NOTA),
  "FacturaProveedor.importeNeto": d("dinero", "Neto del comprobante (NULL = no se desglosó; va junto con el IVA, CHECK): base del IVA computable."),
  "FacturaProveedor.condicionIvaEmpresa": d("dinero", "Condición de la empresa frente al IVA al momento de la carga (copia): decide cómo se computa el IVA de la factura."),
  "FacturaProveedor.condicionPago": d("dinero", "Condición de pago de la factura (hoy solo CONTADO_PAGADA, CHECK)."),
  "FacturaProveedor.estado": d("stock", "PENDIENTE_DE_REPARTO (su mercadería todavía no entró al stock) o CONFIRMADA (CHECK)."),
  "FacturaProveedor.anuladaEn": d("dinero", "Una factura anulada deja de ser vigente y libera su número (índice único de las no anuladas)."),
  "FacturaProveedorSucursal.estadoRecepcion": d("stock", "El stock de una factura entra recién cuando está repartida y la parte de la sucursal fue recibida (decisión del dueño, 2026-10-12)."),
  "FacturaProveedorRenglon.precioTotal": d("dinero", "Lo pagado por el renglón, con IVA incluido (no negativo, CHECK)."),
  "FacturaProveedorRenglon.alicuotaIva": d("dinero", "Alícuota de IVA del renglón (CHECK en la base): base del IVA computable."),
  "NotaCreditoProveedor.importeTotal": d("dinero", IMPORTE_DE_NOTA),
  "NotaCreditoProveedor.fecha": d("dinero", "El día del crédito (mediodía argentino del día elegido, UTC): manda el período."),
  "NotaCreditoProveedor.tipo": d("dinero", "SOBRE_FACTURA o SUELTA (CHECK): en pareo con la factura, decide a qué se acredita."),
  "NotaCreditoProveedor.anuladaEn": d("dinero", "Una nota anulada deja de ser vigente y libera su número (las tres columnas de anulación van juntas o ninguna, CHECK)."),
  "NotaCreditoProveedorLinea.importe": d("dinero", "Lo acreditado por la línea, con IVA incluido (mayor que cero, CHECK)."),
  "NotaCreditoProveedorLinea.admiteDevolucion": d("stock", "Si la línea admite devolución de mercadería (SOBRE_FACTURA y MERCADERIA): la devolución mueve stock."),
  "NotaCreditoProveedorImputacion.importe": d("dinero", "Lo que le toca a la sucursal, con IVA incluido (mayor que cero, CHECK)."),
  "NotaCreditoProveedorImputacion.importeIvaComputable": d("dinero", "La parte de la imputación que es IVA computable (entre 0 y el importe, CHECK)."),
  "NotaCreditoProveedorImputacion.cantidadStock": d("stock", "Lo devuelto, en unidad de stock, solo con una devolución (CHECK)."),
  "NotaCreditoProveedorImputacion.lineaAdmiteDevolucion": d("stock", "Copia de NotaCreditoProveedorLinea.admiteDevolucion: tercera columna de la clave foránea hacia la línea."),
  "ImputacionDeGasto.importe": d("dinero", "Lo que le toca a la sucursal de un gasto, con IVA incluido (mayor que cero, CHECK)."),
  "ImputacionDeGasto.importeIvaComputable": d("dinero", "La parte de la imputación que es IVA computable (entre 0 y el importe, CHECK)."),
  "ReclasificacionRenglon.tipoDeCosto": d("dinero", "COSTO_DE_VENTAS, GASTO_OPERATIVO, EXTRAORDINARIO, INVERSION o RESULTADO_FINANCIERO (CHECK): dónde cae el renglón en el resultado."),
  "DistribucionCostoLinea.importe": d("dinero", "Lo que le toca al centro de costos, con IVA incluido (cero o más, CHECK)."),
  "DistribucionCostoLinea.importeIvaComputable": d("dinero", "La parte de la línea que es IVA computable (entre 0 y el importe, CHECK)."),
  "DistribucionCostoLinea.porcentajeBp": d("dinero", "Puntos básicos enteros (1 a 10000, CHECK) con que se reparte el costo entre centros."),
  "PlanDeCostosSucursal.aplica": d("dinero", "Sin fila o con aplica = false el plan no aplica en la sucursal y sus gastos quedan «no aplica», no «sin asignar»."),
  "Proveedor.condicionIva": d("dinero", "Condición del proveedor frente al IVA (CHECK): quien la lea falla cerrado si es NULL."),
  "Empresa.llevaIvaDeCompras": d("dinero", "Perilla de IVA de las compras (ADR-029): apagada, la factura no exige neto, IVA ni alícuota; prendida, se exigen según la letra."),
  "Empresa.condicionIva": d("dinero", "Condición de la empresa frente al IVA (CHECK): decide cómo se computa el IVA de las compras."),
  "Empresa.permisosEditables": d("ninguna", "Política de permisos de plataforma (ADR-008/ADR-010); no toca dinero, carta ni stock."),
};
