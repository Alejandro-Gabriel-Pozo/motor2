/**
 * Las EXCEPCIONES de la matriz de denegación por defecto (GT-3b), todas listas CERRADAS con motivo. Las tres solo se achican: una entrada que ya no hace falta (la puerta dejó de existir, o el pendiente se
 * arregló) pone la cobertura en rojo y pide sacarla.
 *
 * Las claves de puerta son `<tipo>|<archivo desde src/server>|<función>` (ver `inventario-de-puertas.ts`); las de escenario, `<puerta>|<escenario>`.
 */

/**
 * El CONTEXTO de una consulta o lectura cuando no sale solo de las claves de las páginas que la llaman (una página puede pedir claves de empresa y de sucursal a la vez). `empresa` = la devuelve por diseño
 * con lo que la empresa tiene en todas sus sucursales; `sucursal` = solo la sucursal activa. Puerta → contexto con motivo.
 */
export const CONTEXTO_DECLARADO: Readonly<Record<string, { contexto: "empresa" | "sucursal"; motivo: string }>> = {
  "consulta|consultas/catalogo/recetas.ts|listarCalibracionesDeIngredientes": {
    contexto: "empresa",
    motivo: "el editor de la receta CENTRAL (de empresa) anota en qué sucursales está calibrado cada ingrediente («Calibrado en N sucursales»): la consulta devuelve las calibraciones de todas por diseño (la página solo usa el nombre de la sucursal)",
  },
};

/**
 * Puertas que se ejercen PARADOS en la sucursal vacía (S4, donde u1 también es administrador) y no en S1: su precondición sobre el destino (copiar una carta solo se puede sobre una carta vacía) rechazaría la
 * llamada antes de llegar a mirar el ORIGEN, y un chequeo de pertenencia del origen que se saque no se notaría (un verde que no prueba nada: lo mostró la mutación de `leerOrigenDeCopia`). Puerta → por qué.
 */
export const EN_LA_SUCURSAL_VACIA: Readonly<Record<string, string>> = {
  "accion|actions/carta/copiar-carta.ts|copiarCartaDeSucursal": "solo se copia sobre una carta vacía: en S1 (que tiene carta) rechaza por «ya tiene carta propia» antes de mirar el origen",
};

/** Escenarios que no aplican a una puerta, con el motivo. `<puerta>|<escenario>` → por qué. */
const EMPRESA_SIN_RLS =
  "lee `Empresa`, una tabla GLOBAL sin RLS (la empresa se resuelve por slug en la carta pública y por id en el contexto): devuelve la fila de la empresa cuyo id se le pasa, que sale del contexto ya resuelto de la página y nunca del cliente";
export const ESCENARIOS_QUE_NO_APLICAN: Readonly<Record<string, string>> = {
  "consulta|consultas/empresa/perfil.ts|obtenerPerfilDeEmpresa|anonimo": EMPRESA_SIN_RLS,
  "consulta|consultas/empresa/perfil.ts|obtenerPerfilDeEmpresa|sinEmpresa": EMPRESA_SIN_RLS,
};

export interface PendienteDeSucursal {
  motivo: string;
  /** Dónde se arregla: la pista de contención por sucursal (plan de endurecimiento §6), fase (a) o (b). */
  destino: string;
}

/**
 * Lo que cruza de OTRA SUCURSAL de la misma empresa (escenario `ajenaSucursal`) y todavía no se defiende. La política del plan: se declara acá y NO se arregla en esta tanda (la defensa por sucursal es la
 * «RLS contenedor» [MIG] que el dueño pidió como pista aparte). La matriz EJECUTA estos casos y exige que sigan fallando: cuando la pista los cierre, el test pide sacar la entrada.
 */
export const PENDIENTES_DE_SUCURSAL: Readonly<Record<string, PendienteDeSucursal>> = {
  // Vacía desde que los lectores de saldo y la precarga del conteo fallan cerrado por sucursal (hallazgo O.177 cerrado): `calcularSaldoTotal`,
  // `calcularSaldoPorLote`, `validarStockSuficiente` y `listarStockParaConteo` reciben la `sucursalId` del contexto y exigen `seccion.sucursalId` en su `where`.
};

/**
 * Puertas que, con un id ajeno en un campo que no validan, dejan que la RESTRICCIÓN de la base (la clave foránea compuesta por empresa) lo rechace y lanzan una excepción de Prisma cruda en lugar de devolver `{ ok: false }`.
 * No cruza nada (la base lo impide y no se escribe una fila), pero el rechazo no es tipado: el cliente recibe un error genérico. Lista cerrada: una puerta nueva con ese comportamiento tiene que declararse (o validar el id).
 * `<puerta>|<escenario>` → qué id la dispara.
 */
export const RECHAZOS_CRUDOS_DE_LA_BASE: Readonly<Record<string, string>> = {
  // Vacía desde que los casos de uso traducen la violación de clave foránea (`P2003`) a «No se encontró …» en su borde (hallazgo O.175 cerrado): `crearOActualizarGrupo` (`grupoPadreId`),
  // `actualizarProducto` y `darDeAltaProducto` (categoría, insumo, unidades, proveedor de consignación), `darDeAltaProductoRapido` (`unidadStockId`) y `registrarVenta` (`proveedorId`).
};

/**
 * Mutaciones que con ids ajenos responden `ok: true` POR DISEÑO sin hacer nada: ignoran los ids que no son de la cuenta/sucursal activa (idempotencia por estado) y contestan igual que ante un id inexistente (sin oráculo).
 * La matriz las sigue exigiendo sin escritura y sin filas ajenas; solo se tolera el `ok: true`. `<puerta>|<escenario>` → por qué.
 */
export const OK_SIN_EFECTO_POR_DISENO: Readonly<Record<string, string>> = {
  "accion|actions/pos/cuenta-pedido.ts|enviarACocina|ajenaEmpresa": "el envío acota los ítems por la cuenta de la sucursal activa (`UPDATE … WHERE cuentaId`): los ids de ítems que no son de ella se ignoran y responde «Esos ítems ya estaban enviados» (`numeroEnvio: null`), igual que con un id inexistente; no escribe nada",
  "accion|actions/pos/cuenta-pedido.ts|enviarACocina|ajenaSucursal": "ídem: los ítems de la cuenta de otra sucursal se ignoran (la respuesta es la de un id inexistente) y no se escribe nada",
};

/**
 * Parámetros OPCIONALES que la matriz deja en `undefined` a propósito (hallazgo I-3 de la auditoría final, fila O.177): un opcional sin mapear salteaba en silencio el camino que abre (un filtro por id, un cursor).
 * Ahora un opcional sin mapa es un error de cobertura; solo se declara acá el que de verdad no lleva nada del cliente que probar. `<puerta>|<parámetro>` → por qué. Lista cerrada: solo se achica.
 */
const PRECARGA =
  "dato PRECARGADO por quien llama (una optimización: el índice de recetas, los productos o los costos que la consulta ya leyó); sin él el ayudante lo carga solo con el `db`, que es el camino que ejercen estas pruebas. No lleva ids del cliente";
export const OPCIONALES_SIN_MAPEAR: Readonly<Record<string, string>> = {
  "consulta|consultas/reportes/diferencias-ajustes.ts|generarReporteDiferenciasAjustes|productosCargados": PRECARGA,
  "consulta|consultas/reportes/insumos-sin-receta.ts|generarReporteInsumosSinRecetaVinculada|productosCargados": PRECARGA,
  "consulta|consultas/reportes/periodo.ts|cargarLineasDelPeriodo|cargado": PRECARGA,
  "consulta|consultas/reportes/periodo.ts|cargarLineasDelPeriodoDeSucursales|cargado": PRECARGA,
  "consulta|consultas/stock/alertas.ts|calcularAlertasStock|cargado": PRECARGA,
  "consulta|consultas/stock/consolidado.ts|calcularStockConsolidado|seccionesCargadas": PRECARGA,
  "lectura|lecturas/carta/descuentos.ts|descuentosDeProductoEnSucursal|precioLocalActivoCargado": PRECARGA,
  "lectura|lecturas/carta/menu.ts|resolverMenuCarta|precioLocalActivoCargado": PRECARGA,
  "lectura|lecturas/carta/menu.ts|resolverMenuCartaConDiagnostico|precioLocalActivoCargado": PRECARGA,
  "lectura|lecturas/catalogo/precio-local.ts|preciosLocalesVigentes|precioLocalActivo": PRECARGA,
  "lectura|lecturas/movimientos/saldos.ts|resolverConsumoPorFamilia|obtenerProducto": "función de búsqueda que inyecta quien llama (para no releer productos ya cargados); sin ella el ayudante lee con el `db`",
  "lectura|lecturas/pos/promo-para-agregar.ts|cargarPromoCartaParaAgregar|modulosCargados": PRECARGA,
  "lectura|lecturas/pos/selector-carta.ts|cargarSelectorCartaPos|precioLocalActivoCargado": PRECARGA,
  "lectura|lecturas/pos/selector-carta.ts|cargarSelectorCartaPos|modulosCargados": PRECARGA,
  "lectura|lecturas/reportes/comun.ts|construirMapaProductos|clasificacionCargada": PRECARGA,
  "lectura|lecturas/reportes/comun.ts|construirMapaProductos|cargado": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularCostosYMargenes|productosCargados": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularCostosYMargenes|indiceRecetas": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularCostosYMargenes|objetivos": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularCostosYMargenes|costosCargados": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularCostosYMargenesEImpactoInsumos|objetivos": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularImpactoRecetasPorPeriodo|productosCargados": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularImpactoRecetasPorPeriodo|indiceRecetas": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularImpactoRecetasPorPeriodo|clasificacion": PRECARGA,
  "lectura|lecturas/reportes/costos.ts|calcularImpactoRecetasPorPeriodo|costosActualesCargados": PRECARGA,
};

/**
 * Mutaciones cuyo CONTROL POSITIVO no se puede armar: con ids PROPIOS y válidos la llamada no termina en `ok: true` (precondición de estado que el mundo no reúne, un efecto externo que no se puede repetir).
 * Para ellas «rechazó con ids ajenos» sigue sin probar que el motivo fuera la pertenencia; el control (b) —solo cuentan los rechazos de pertenencia— sigue vigente. Lista cerrada: solo se achica.
 * `<puerta>` → por qué.
 */
export const SIN_CONTROL_POSITIVO: Readonly<Record<string, string>> = {
  "accion|actions/pos/cuenta-cierre.ts|emitirTicketCorregido":
    "solo emite el ejemplar corregido de una cuenta cerrada cuya VENTA se anuló parcialmente DESPUÉS de emitir el ticket (`Operacion.anuladaEn` posterior al ejemplar, con ítems vinculados a la operación); el mundo siembra una cuenta cerrada con su ticket vigente y la acción rechaza con «ya refleja las anulaciones». Armar el estado exige sembrar un cierre de cuenta con la venta anulada después del ticket",
};

/** Un rechazo admitido: el mensaje exacto (patrón) y por qué, aun sin decir «no se encontró», es el chequeo de pertenencia. */
export interface RechazoAdmitido {
  mensaje: RegExp;
  motivo: string;
}

/**
 * Rechazos que NO dicen «no se encontró / no existe / no tenés acceso…» pero SON el chequeo de pertenencia de la puerta: el mismo mensaje sirve para el id vacío y para el id que la base no deja ver. Solo se admite
 * ESE mensaje (no cualquier rechazo de la puerta), y solo porque el control positivo de la mutación (ids propios y válidos → `ok: true`) prueba que con el id propio la puerta no lo dice: un rechazo con el id
 * ajeno es entonces de pertenencia. `<puerta>|<escenario>` → mensaje y por qué. Lista cerrada: solo se achica.
 */
export const RECHAZOS_DE_ESTADO_ADMITIDOS: Readonly<Record<string, RechazoAdmitido>> = {
  "accion|actions/catalogo/productos.ts|actualizarProducto|ajenaEmpresa": {
    mensaje: /La unidad de stock es obligatoria/,
    motivo: "la validación lee la unidad de stock con la base de la empresa; si el id es de otra empresa no la ve y contesta con el mismo texto que para el id vacío (`validarDatosDeProducto`): es el chequeo de pertenencia de la unidad",
  },
  "accion|actions/catalogo/productos.ts|darDeAltaProducto|ajenaEmpresa": {
    mensaje: /La unidad de stock es obligatoria/,
    motivo: "ídem `actualizarProducto`: la unidad de stock de otra empresa no se ve y contesta «obligatoria»; cada id ajeno restante (categoría, insumo, unidad de compra) tiene su propia variante con su propio mensaje de «no se encontró»",
  },
  "accion|actions/catalogo/productos.ts|sincronizarPrecioGrupoCarta|ajenaEmpresa": {
    mensaje: /no están todos en el mismo ítem agrupado/,
    motivo: "el ítem agrupado se resuelve desde el primer producto con la base de la empresa (`resolverGrupoDeProducto`): un producto de otra empresa no tiene ítem y el mensaje es el de «no son del mismo ítem». El control positivo usa los productos de un ítem propio",
  },
  "accion|actions/catalogo/recetas.ts|actualizarCabeceraDeReceta|ajenaEmpresa": {
    mensaje: /Todavía no hay ninguna receta/,
    motivo: "la receta vigente se lee con la base de la empresa: el producto de otra empresa no tiene ninguna visible y la acción contesta «todavía no hay ninguna receta»; con el PV propio el control positivo termina en ok: true",
  },
  "accion|actions/catalogo/recetas.ts|actualizarIngredienteDeReceta|ajenaEmpresa": {
    mensaje: /Ese insumo no está en la receta vigente/,
    motivo: "ídem: la receta de otra empresa no se ve, así que el insumo «no está en la receta vigente»",
  },
  "accion|actions/catalogo/recetas.ts|actualizarPasoDeReceta|ajenaEmpresa": {
    mensaje: /Ese paso no está en la receta vigente/,
    motivo: "ídem: la receta de otra empresa no se ve, así que el paso «no está en la receta vigente»",
  },
  "accion|actions/catalogo/recetas.ts|reordenarPasosDeReceta|ajenaEmpresa": {
    mensaje: /secuencia de pasos no es válida/,
    motivo: "ídem: la secuencia se compara con los pasos de la receta vigente y la de otra empresa no se ve (queda vacía); la secuencia `[1]` es válida para la receta propia (el control positivo lo prueba)",
  },
  "accion|actions/catalogo/receta-sucursal.ts|crearRecetaPropiaDesdeLaCentral|ajenaEmpresa": {
    mensaje: /no tiene receta central de la que partir/,
    motivo: "la receta central del producto de otra empresa no se ve: «no tiene receta central»; con el PV propio sin receta propia el control positivo termina en ok: true",
  },
  "accion|actions/movimientos/precio-local.ts|sincronizarPrecioLocalGrupoCarta|ajenaEmpresa": {
    mensaje: /no están todos en el mismo ítem agrupado/,
    motivo: "ídem `sincronizarPrecioGrupoCarta` (ítem agrupado de la sucursal activa resuelto desde el primer producto)",
  },
};

/**
 * Puertas que devuelven, por diseño, los NOMBRES de las otras sucursales de la empresa (el selector de contraparte de un traspaso, el comparativo de sucursales): el nombre de S2 y de S3 lleva marcador
 * (`ZZ-S2`, `ZZ-S3`) y no es una fuga. La matriz borra esos dos nombres exactos de lo devuelto antes de buscar marcadores, así que cualquier OTRO dato de S2 en la respuesta sí cuenta. `<puerta>` → por qué.
 */
export const SUCURSALES_LISTADAS_POR_DISENO: Readonly<Record<string, string>> = {
  "accion|actions/auth/sucursales.ts|listarSucursales": "la lista de sucursales de la empresa (administración de sucursales): S2 y S3 son sucursales de E1 y sus nombres salen por diseño",
  "consulta|consultas/carta/admin.ts|cargarAdminCarta": "la administración de la carta lista las sucursales de la empresa (con su carta o sin ella, para copiar): los nombres de S2 y S3 salen por diseño",
  "consulta|consultas/catalogo/disponibilidad.ts|disponibilidadPorSucursalDeProducto": "la disponibilidad de un producto se muestra por CADA sucursal de la empresa (tabla de la ficha): los nombres de S2 y S3 salen por diseño",
  "accion|actions/traspasos/lecturas.ts|listarSucursalesParaEnviar": "lista las OTRAS sucursales activas de la empresa (id y nombre) para elegir a quién enviar: S2 y S3 son sucursales de E1 y sus nombres salen por diseño",
  "accion|actions/traspasos/lecturas.ts|listarSucursalesParaSolicitar": "lista las OTRAS sucursales activas de la empresa (id y nombre) para elegir a quién pedirle: S2 y S3 son sucursales de E1 y sus nombres salen por diseño",
};

/**
 * Funciones que un módulo del servidor exporta por un `export { x }` de algo que YA es una puerta inventariada en su archivo de origen (un alias, no una puerta nueva): el cruce en ejecución del inventario (`cruce-en-runtime.ts`)
 * las ve como exportaciones que el AST no reconoce. `<archivo desde src/server>|<nombre>` → la clave de la puerta inventariada de la que es alias. Lista cerrada: solo se achica.
 */
export const REEXPORTS_DE_PUERTAS_INVENTARIADAS: Readonly<Record<string, string>> = {
  "consultas/catalogo/receta-propia.ts|obtenerEstadoDeRecetaPropia": "lectura|lecturas/catalogo/receta-propia.ts|obtenerEstadoDeRecetaPropia",
};

/** Lecturas que devuelven solo agregados (números, textos sin fila identificable): el control positivo no puede buscar el marcador propio. Puerta → por qué. */
export const SIN_MARCA_PROPIA: Readonly<Record<string, string>> = {
  "accion|actions/catalogo/insumos.ts|previsualizarFusionInsumo": "devuelve `null` salvo que el nombre nuevo sea el de OTRO insumo de la empresa (la vista previa de una fusión); la matriz no siembra ese choque",
  "accion|actions/catalogo/productos.ts|obtenerPrecioVentaProducto": "devuelve solo el precio de venta (un número), sin ninguna fila identificable",
  "accion|actions/stock/lecturas-reclasificacion.ts|obtenerSaldoDisponibleParaReclasificar": "devuelve solo un saldo (un número), sin ninguna fila identificable",
  "accion|actions/traspasos/lecturas.ts|listarSucursalesParaEnviar": "lista las OTRAS sucursales de la empresa (id y nombre) para elegir contraparte: por diseño no llevan el marcador de la sucursal propia",
  "accion|actions/traspasos/lecturas.ts|listarSucursalesParaSolicitar": "lista las OTRAS sucursales de la empresa (id y nombre) para elegir contraparte: por diseño no llevan el marcador de la sucursal propia",
  // Consultas de las páginas.
  "consulta|consultas/carta/admin.ts|cargarPortalEmpresaAdmin": "devuelve solo los valores de una lista cerrada de claves del portal (colores, tipografías…), sin texto libre donde ponerle el marcador",
  "consulta|consultas/carta/admin.ts|origenesDeCopiaVisibles": "devuelve las sucursales candidatas que se le pasan, filtradas por la membresía y el «Ver» de la carta (S-07); con la propia devuelve la que recibió (no es una fila con marcador propio). Los escenarios ajenos le pasan sucursales a las que u1 no pertenece y exigen que no vuelva ninguna",
  "consulta|consultas/catalogo/productos.ts|contarSucursales": "devuelve solo un número",
  "consulta|consultas/catalogo/recetas.ts|listarOpcionesDeSustituto": "opciones de MP con otro insumo y la misma unidad: el mundo tiene un solo insumo con producto, así que no hay opciones",
  "consulta|consultas/reportes/costo-historico.ts|reconstruirCostosDeVenta": "devuelve el costo reconstruido por producto y día, y repite los ids que se le pasan (que no cuentan como propios)",
  "consulta|consultas/reportes/rotacion-mesas.ts|generarReporteRotacionMesas": "devuelve solo conteos y promedios de la rotación de mesas",
  "consulta|consultas/catalogo/receta-propia.ts|listarSucursalesConRecetaPropia": "lista las OTRAS sucursales con receta propia donde el usuario tiene membresía y «Ver» (origen de una copia): u1 solo es miembro de S1, así que es vacío por diseño (y no debe traer S2)",
  "consulta|consultas/permisos/auditoria.ts|sucursalesVisiblesDeAuditoria": "devuelve solo ids de sucursal",
  "consulta|consultas/permisos/gerencia.ts|listarCandidatosAGerente": "candidatos a recibir la gerencia: administradores efectivos distintos del gerente; el mundo no siembra otro, así que es vacío por diseño",
  "consulta|consultas/pos/mesas.ts|obtenerLimiteMesasAbiertas": "devuelve solo un número (el tope de mesas)",
  "consulta|consultas/pos/tickets.ts|obtenerTicketsRecientes": "tickets de una ventana de tiempo reciente respecto de `ahora`; el reloj de la matriz avanza 61 s por llamada y el ticket sembrado queda fuera de la ventana",
  "consulta|consultas/reportes/cotizacion-dolar.ts|obtenerUltimaCotizacion": "lee `CotizacionDolar`, una tabla global del sistema (no es de ninguna empresa): no hay fila propia con marcador",
  "consulta|consultas/reportes/cotizacion-dolar.ts|obtenerUltimaCotizacionSinRomper": "lee `CotizacionDolar`, una tabla global del sistema (no es de ninguna empresa): no hay fila propia con marcador",
  "consulta|consultas/reportes/descuentos-productos.ts|obtenerReporteDescuentosProductos": "agrega ventas de cuentas con descuento de producto; el mundo no siembra cuentas cerradas con descuento, así que el reporte es vacío",
  "consulta|consultas/reportes/huecos-catalogo.ts|obtenerProblemasUnidadMezclada": "lista insumos con unidades mezcladas; el catálogo del mundo no tiene ninguno, así que es vacío por diseño",
  "consulta|consultas/reportes/margen-promociones.ts|obtenerReporteMargenPromociones": "agrega instancias de promo vendidas; el mundo no siembra promos cobradas, así que el reporte es vacío",
  "consulta|consultas/reportes/rendimiento-recetas.ts|calcularRendimientoRecetasCompartidas": "necesita ventas de recetas que comparten ingredientes; el mundo no las siembra",
  "consulta|consultas/reportes/resumen-consolidado.ts|obtenerResumenConsolidado": "devuelve cifras por sucursal y repite el nombre que se le pasó (el marcador que se le da de entrada no cuenta como propio)",
  "consulta|consultas/reportes/tickets-emitidos.ts|obtenerNumeroDeMesa": "devuelve solo el número de la mesa",
  "consulta|consultas/reportes/vencimientos.ts|generarConciliacionVencimientos": "concilia lotes vencidos o por vencer; el mundo no siembra un lote vencido, así que es vacío",
  "consulta|consultas/reportes/ventas-sin-receta.ts|generarReporteVentasSinReceta": "lista PV vendidos sin receta; el mundo vende una MP, así que es vacío",
  "consulta|consultas/stock/stock-minimo.ts|resolverStockMinimo": "devuelve solo el mínimo (un número)",
};
