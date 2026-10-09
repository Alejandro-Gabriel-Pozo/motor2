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
export const PENDIENTES_DE_SUCURSAL: Readonly<Record<string, PendienteDeSucursal>> = {};

/**
 * Puertas que, con un id ajeno en un campo que no validan, dejan que la RESTRICCIÓN de la base (la clave foránea compuesta por empresa) lo rechace y lanzan una excepción de Prisma cruda en lugar de devolver `{ ok: false }`.
 * No cruza nada (la base lo impide y no se escribe una fila), pero el rechazo no es tipado: el cliente recibe un error genérico. Lista cerrada: una puerta nueva con ese comportamiento tiene que declararse (o validar el id).
 * `<puerta>|<escenario>` → qué id la dispara.
 */
export const RECHAZOS_CRUDOS_DE_LA_BASE: Readonly<Record<string, string>> = {
  "accion|actions/catalogo/insumos.ts|crearOActualizarGrupo|ajenaEmpresa": "`grupoPadreId` de otra empresa: la clave foránea compuesta `Grupo_empresaId_grupoPadreId_fkey` (P2003) lo rechaza al crear",
  "accion|actions/catalogo/productos.ts|actualizarProducto|ajenaEmpresa": "`proveedorConsignacionId` de otra empresa: la clave foránea compuesta de `Producto` (P2003) lo rechaza al actualizar (la categoría, el insumo y las unidades sí se validan)",
  "accion|actions/catalogo/productos.ts|darDeAltaProductoRapido|ajenaEmpresa": "`unidadStockId` de otra empresa: la clave foránea compuesta de `Producto` (P2003) lo rechaza al crear (el alta completa sí valida la unidad)",
  "accion|actions/movimientos/venta.ts|registrarVenta|ajenaEmpresa": "`proveedorId` («a quién se vende») de otra empresa: la clave foránea compuesta de `Operacion` (P2003) lo rechaza dentro de la transacción",
};

/**
 * Mutaciones que con ids ajenos responden `ok: true` POR DISEÑO sin hacer nada: ignoran los ids que no son de la cuenta/sucursal activa (idempotencia por estado) y contestan igual que ante un id inexistente (sin oráculo).
 * La matriz las sigue exigiendo sin escritura y sin filas ajenas; solo se tolera el `ok: true`. `<puerta>|<escenario>` → por qué.
 */
export const OK_SIN_EFECTO_POR_DISENO: Readonly<Record<string, string>> = {
  "accion|actions/pos/cuenta-pedido.ts|enviarACocina|ajenaEmpresa": "el envío acota los ítems por la cuenta de la sucursal activa (`UPDATE … WHERE cuentaId`): los ids de ítems que no son de ella se ignoran y responde «Esos ítems ya estaban enviados» (`numeroEnvio: null`), igual que con un id inexistente; no escribe nada",
  "accion|actions/pos/cuenta-pedido.ts|enviarACocina|ajenaSucursal": "ídem: los ítems de la cuenta de otra sucursal se ignoran (la respuesta es la de un id inexistente) y no se escribe nada",
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
