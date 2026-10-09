import { intento, variantes, type Generadores, type Kit, type Valor } from "./argumentos";

/**
 * Los GENERADORES de argumentos de la matriz de denegación por defecto (GT-3b), solo para lo que `argumentos.ts` no deriva por nombre de parámetro: puertas con un objeto de entrada
 * (`completos`, el arreglo entero o `variantes(...)`), puertas con un parámetro ambiguo (`parametros`: `id`, `operacionId`…) y parámetros que significan lo mismo en todo un archivo (`porArchivo`).
 *
 * Cada objeto de entrada lleva ids AJENOS del kit y el resto de los campos válidos de forma, para que la llamada llegue a la lógica de la puerta y no se rechace por validación (lo que daría un
 * verde que no prueba nada). Cuando una acción recibe VARIOS ids ajenos por caminos distintos (editar por id ajeno, dar de alta con referencias ajenas, mover a una sección ajena), cada camino es una
 * variante: si la primera se rechaza antes de mirar el resto, las demás igual se ejercen. Una variante solo existe si lleva al menos un id AJENO en ese escenario (`intento`): con ids propios y
 * válidos escribiría de verdad. Los ids de EMPRESA (catálogo, roles, secciones de carta) son ajenos solo en el escenario de otra empresa; los de SUCURSAL (secciones, mesas, cuentas…) en los dos.
 * `k` trae lo ajeno del escenario y `c.propio` lo propio de u1 (E1 y S1).
 */
const lista = (...v: Array<unknown[] | false>): unknown[][] => v.filter((x): x is unknown[] => x !== false);
const hoy = () => new Date();
const ingrediente = (k: Kit, insumoProductoId: string = k.productoId) => ({ insumoProductoId, cantidad: 1, unidadId: k.unidadId });
const conVariantes = (...v: Array<unknown[] | false>) => variantes(...lista(...v));

const completos: Record<string, Valor> = {
  // --- gobierno ---
  "accion|actions/auth/sucursales.ts|crearSucursalConAdmin": () => [{ nombre: "Sucursal nueva", emailPrimerAdmin: "nuevo-admin@ajeno.test" }],
  "accion|actions/auth/usuarios.ts|agregarOActualizarUsuario": (k, c) =>
    conVariantes(
      intento(c, ["sucursalId"], [{ email: "nuevo@ajeno.test", sucursalId: k.sucursalId, rolId: k.rolId, notas: "notas" }]),
      intento(c, ["rolId"], [{ email: "nuevo@ajeno.test", sucursalId: c.propio.sucursalId, rolId: k.rolId }]),
    ),
  "accion|actions/permisos/capacidades-sucursal.ts|actualizarCapacidad": (k) => ["carta_tema", k.sucursalId, false],
  "accion|actions/permisos/permisos.ts|guardarPermisos": (k) => [[{ rolId: k.rolId, accionClave: "carta_tema", anterior: { puedeVer: false, puedeEditar: false }, nuevo: { puedeVer: true, puedeEditar: true } }]],

  // --- carta ---
  "accion|actions/carta/contenido-producto.ts|guardarContenidoCartaProducto": (k, c) =>
    conVariantes(
      intento(c, ["productoPvId", "seccionCartaId", "generoCartaId"], [k.productoPvId, { visibleEnCarta: true, seccionCartaId: k.seccionCartaId, generoCartaId: k.generoCartaId, descripcion: "texto" }]),
      intento(c, ["seccionCartaId"], [c.propio.productoPvId, { visibleEnCarta: true, seccionCartaId: k.seccionCartaId, generoCartaId: c.propio.generoCartaId, descripcion: "texto" }]),
      intento(c, ["generoCartaId"], [c.propio.productoPvId, { visibleEnCarta: true, seccionCartaId: c.propio.seccionCartaId, generoCartaId: k.generoCartaId, descripcion: "texto" }]),
    ),
  "accion|actions/carta/generos.ts|guardarGeneroCarta": (k) => [{ id: k.generoCartaId, nombre: "Nombre nuevo" }],
  "accion|actions/carta/items-agrupados.ts|guardarItemAgrupadoCarta": (k, c) =>
    conVariantes(
      intento(c, ["itemAgrupadoCartaId"], [{ id: k.itemAgrupadoCartaId, nombre: "Nombre nuevo", seccionCartaId: c.propio.seccionCartaId }]),
      intento(c, ["seccionCartaId"], [{ nombre: "Agrupado nuevo", seccionCartaId: k.seccionCartaId, generoCartaId: c.propio.generoCartaId, productoIds: [c.propio.productoPvId] }]),
      intento(c, ["generoCartaId"], [{ nombre: "Agrupado nuevo", seccionCartaId: c.propio.seccionCartaId, generoCartaId: k.generoCartaId, productoIds: [c.propio.productoPvId] }]),
      // (Un alta con un producto ajeno en `productoIds` NO es una variante: el ítem se crea igual, con 0 productos, y el aviso lo dice. Es una escritura propia legítima.)
    ),
  "accion|actions/carta/promos.ts|guardarPromoCarta": (k, c) =>
    conVariantes(
      intento(c, ["promoCartaId"], [{ id: k.promoCartaId, seccionCartaId: c.propio.seccionCartaId, titulo: "Titulo", precio: 100 }]),
      intento(c, ["seccionCartaId"], [{ seccionCartaId: k.seccionCartaId, titulo: "Titulo", precio: 100 }]),
    ),
  "accion|actions/carta/promos.ts|guardarCuposPromoCarta": (k, c) =>
    conVariantes(
      intento(c, ["promoCartaId"], [k.promoCartaId, [{ seccionCartaId: c.propio.seccionCartaId, cantidadMaxima: 2 }]]),
      intento(c, ["seccionCartaId"], [c.propio.promoCartaId, [{ seccionCartaId: k.seccionCartaId, cantidadMaxima: 2 }]]),
    ),
  "accion|actions/carta/registro-publico.ts|guardarSucursalPublica": (k) => [k.sucursalId, { slug: "slug-nuevo", publicada: true }],
  "accion|actions/carta/secciones.ts|guardarSeccionCarta": (k) => [{ id: k.seccionCartaId, nombre: "Nombre nuevo" }],

  // --- catálogo ---
  "accion|actions/catalogo/productos.ts|actualizarProducto": (k, c) =>
    conVariantes(
      intento(c, ["productoId"], [k.productoId, { nombre: "Nombre nuevo", tipo: "MP", unidadStockId: c.propio.unidadId, factorConversion: 1 }]),
      intento(c, ["categoriaId", "insumoId", "unidad2Id", "unidadId"], [c.propio.productoId, { nombre: "Nombre nuevo", tipo: "MP", unidadStockId: k.unidadId, factorConversion: 1, categoriaId: k.categoriaId, insumoId: k.insumoId, unidadCompraId: k.unidad2Id }]),
      intento(c, ["proveedorId"], [c.propio.productoId, { nombre: "Nombre nuevo", tipo: "MP", unidadStockId: c.propio.unidadId, factorConversion: 1, esConsignacion: true, proveedorConsignacionId: k.proveedorId, precioConsignacion: 10 }]),
    ),
  "accion|actions/catalogo/productos.ts|darDeAltaProducto": (k, c) =>
    conVariantes(intento(c, ["unidadId", "categoriaId", "insumoId", "unidad2Id"], [{ nombre: "Producto nuevo", tipo: "MP", unidadStockId: k.unidadId, factorConversion: 1, categoriaId: k.categoriaId, insumoId: k.insumoId, unidadCompraId: k.unidad2Id }])),
  "accion|actions/catalogo/proveedores.ts|altaProveedor": () => [{ nombre: "Proveedor nuevo" }],
  "accion|actions/catalogo/proveedores.ts|actualizarProveedor": (k) => [k.proveedorId, { contacto: "contacto nuevo" }],
  "accion|actions/catalogo/unidades.ts|crearUnidad": () => [{ nombre: "Unidad nueva", magnitud: "PESO" }],
  "accion|actions/catalogo/recetas.ts|guardarReceta": (k, c) =>
    conVariantes(
      intento(c, ["productoPvId"], [k.productoPvId, [ingrediente(k, c.propio.productoId)], [{ orden: 1, instruccion: "Mezclar" }], {}, 1]),
      intento(c, ["productoId", "unidadId"], [c.propio.productoPvId, [ingrediente(k)], [{ orden: 1, instruccion: "Mezclar" }], {}, 1]),
    ),
  "accion|actions/catalogo/recetas.ts|agregarIngredienteAReceta": (k, c) =>
    conVariantes(intento(c, ["productoPvId"], [k.productoPvId, ingrediente(k, c.propio.productoId), 1]), intento(c, ["productoId", "unidadId"], [c.propio.productoPvId, ingrediente(k), 1])),
  "accion|actions/catalogo/recetas.ts|actualizarIngredienteDeReceta": (k) => [k.productoPvId, k.productoId, { cantidad: 2, unidadId: k.unidadId }, 1],
  "accion|actions/catalogo/recetas.ts|agregarPasoAReceta": (k) => [k.productoPvId, { orden: 2, instruccion: "Hornear" }, 1],
  "accion|actions/catalogo/recetas.ts|actualizarPasoDeReceta": (k) => [k.productoPvId, 1, { instruccion: "Hornear" }, 1],
  "accion|actions/catalogo/recetas.ts|reordenarPasosDeReceta": (k) => [k.productoPvId, [1], 1],
  "accion|actions/catalogo/recetas.ts|insertarPasoEnReceta": (k) => [k.productoPvId, 1, { instruccion: "Hornear" }, 1],
  "accion|actions/catalogo/recetas.ts|actualizarCabeceraDeReceta": (k) => [k.productoPvId, { comentarios: "nuevo" }, 1],
  "accion|actions/catalogo/receta-sucursal.ts|agregarIngredienteARecetaPropia": (k, c) =>
    conVariantes(intento(c, ["productoPvId"], [k.productoPvId, ingrediente(k, c.propio.productoId), 1, true]), intento(c, ["productoId", "unidadId"], [c.propio.productoPvId, ingrediente(k), 1, true])),
  "accion|actions/catalogo/receta-sucursal.ts|actualizarIngredienteDeRecetaPropia": (k) => [k.productoPvId, k.productoId, { cantidad: 2, unidadId: k.unidadId }, 1, true],
  "accion|actions/catalogo/rendimiento-local.ts|fijarRendimientoLocal": (k) => [k.recetaIngredienteId, { cantidad: 2, mermaPorcentaje: 3 }],

  // --- movimientos, stock, traspasos ---
  "accion|actions/movimientos/compras.ts|corregirCompra": (k, c) =>
    conVariantes(
      intento(c, ["compraId"], [k.compraId, { proveedorId: c.propio.proveedorId, nroFactura: "F-NUEVA", detalleLibre: "texto" }, { proveedorId: null, nroFactura: null, detalleLibre: null }]),
      intento(c, ["proveedorId"], [c.propio.compraId, { proveedorId: k.proveedorId, nroFactura: "F-NUEVA", detalleLibre: "texto" }, { proveedorId: c.propio.proveedorId, nroFactura: `F-${c.propio.marca}`, detalleLibre: `Compra ${c.propio.marca}` }]),
    ),
  "accion|actions/movimientos/conteo-fisico.ts|registrarConteoFisico": (k, c) =>
    conVariantes(
      intento(c, ["productoId"], [{ productoId: k.productoId, seccionId: c.propio.seccionId, conteoReal: 5, fechaConteo: hoy(), accion: "AJUSTAR", detalle: "texto" }]),
      intento(c, ["seccionId"], [{ productoId: c.propio.productoId, seccionId: k.seccionId, conteoReal: 5, fechaConteo: hoy(), accion: "AJUSTAR", detalle: "texto" }]),
    ),
  "accion|actions/movimientos/conteo-fisico.ts|registrarConteosFisicos": (k, c) =>
    conVariantes(
      intento(c, ["productoId"], [[{ productoId: k.productoId, seccionId: c.propio.seccionId, conteoReal: 5, fechaConteo: hoy(), accion: "AJUSTAR" }]]),
      intento(c, ["seccionId"], [[{ productoId: c.propio.productoId, seccionId: k.seccionId, conteoReal: 5, fechaConteo: hoy(), accion: "AJUSTAR" }]]),
    ),
  "accion|actions/movimientos/movimientos.ts|registrarMovimiento": (k, c) =>
    conVariantes(
      // Compra con la sección ajena, y (de otra empresa) con el proveedor o el producto ajenos.
      intento(c, ["seccionId", "proveedorId"], [{ proceso: "COMPRA", fecha: hoy(), seccionId: k.seccionId, proveedorId: k.proveedorId, items: [{ productoId: c.propio.productoId, cantidad: 1, precioTotal: 100 }] }]),
      intento(c, ["proveedorId"], [{ proceso: "COMPRA", fecha: hoy(), seccionId: c.propio.seccionId, proveedorId: k.proveedorId, items: [{ productoId: c.propio.productoId, cantidad: 1, precioTotal: 100 }] }]),
      intento(c, ["productoId"], [{ proceso: "COMPRA", fecha: hoy(), seccionId: c.propio.seccionId, items: [{ productoId: k.productoId, cantidad: 1, precioTotal: 100 }] }]),
      // Merma con el motivo ajeno; consumo con el destino ajeno (son de la empresa).
      intento(c, ["motivoId"], [{ proceso: "MERMA", fecha: hoy(), seccionId: c.propio.seccionId, motivoId: k.motivoId, items: [{ productoId: c.propio.productoId, cantidad: 1 }] }]),
      intento(c, ["destinoId"], [{ proceso: "CONSUMO", fecha: hoy(), seccionId: c.propio.seccionId, destinoId: k.destinoId, items: [{ productoId: c.propio.productoId, cantidad: 1 }] }]),
      // Transferencia hacia una sección ajena; ajuste desde una sección ajena.
      intento(c, ["seccionId"], [{ proceso: "TRANSFERENCIA", fecha: hoy(), seccionId: c.propio.seccionId, seccionDestinoId: k.seccionId, items: [{ productoId: c.propio.productoId, cantidad: 1 }] }]),
      intento(c, ["seccionId"], [{ proceso: "AJUSTE", fecha: hoy(), seccionId: k.seccionId, items: [{ productoId: c.propio.productoId, cantidad: -1 }] }]),
    ),
  "accion|actions/movimientos/venta.ts|registrarVenta": (k, c) =>
    conVariantes(
      intento(c, ["seccionId"], [{ fecha: hoy(), seccionId: k.seccionId, ventas: [{ productoId: c.propio.productoPvId, cantidadVendida: 1 }] }]),
      intento(c, ["productoPvId"], [{ fecha: hoy(), seccionId: c.propio.seccionId, ventas: [{ productoId: k.productoPvId, cantidadVendida: 1 }] }]),
      intento(c, ["proveedorId"], [{ fecha: hoy(), seccionId: c.propio.seccionId, proveedorId: k.proveedorId, ventas: [{ productoId: c.propio.productoPvId, cantidadVendida: 1 }] }]),
    ),
  "accion|actions/stock/reclasificacion.ts|reclasificarStock": (k, c) =>
    conVariantes(
      intento(c, ["seccionId"], [{ productoId: c.propio.productoId, seccionOrigenId: k.seccionId, destinos: [{ seccionId: c.propio.seccion2Id, cantidad: 1 }], fecha: hoy() }]),
      intento(c, ["seccion2Id"], [{ productoId: c.propio.productoId, seccionOrigenId: c.propio.seccionId, destinos: [{ seccionId: k.seccion2Id, cantidad: 1 }], fecha: hoy() }]),
      intento(c, ["productoId"], [{ productoId: k.productoId, seccionOrigenId: c.propio.seccionId, destinos: [{ seccionId: c.propio.seccion2Id, cantidad: 1 }], fecha: hoy() }]),
    ),
  "accion|actions/traspasos/traspasos.ts|crearSolicitudTransferencia": (k, c) =>
    conVariantes(
      // Pedirle a OTRA sucursal de la misma empresa es el propósito (el origen decide): solo es ajeno si la sucursal es de otra empresa.
      c.escenario === "ajenaEmpresa" ? [{ origenSucursalId: k.sucursalId, productoId: c.propio.productoId, cantidad: 1, seccionDestinoId: c.propio.seccionId }] : intento(c, [], [{ origenSucursalId: c.propio.vecinaId, productoId: c.propio.productoId, cantidad: 1, seccionDestinoId: c.propio.seccionId }]),
      intento(c, ["seccionId"], [{ origenSucursalId: c.propio.vecinaId, productoId: c.propio.productoId, cantidad: 1, seccionDestinoId: k.seccionId }]),
      intento(c, ["productoId"], [{ origenSucursalId: c.propio.vecinaId, productoId: k.productoId, cantidad: 1, seccionDestinoId: c.propio.seccionId }]),
    ),
  "accion|actions/traspasos/traspasos.ts|crearEnvioDirectoTransferencia": (k, c) =>
    conVariantes(
      c.escenario === "ajenaEmpresa" ? [{ destinoSucursalId: k.sucursalId, productoId: c.propio.productoId, cantidad: 1, seccionOrigenId: c.propio.seccionId }] : intento(c, [], [{ destinoSucursalId: c.propio.vecinaId, productoId: c.propio.productoId, cantidad: 1, seccionOrigenId: c.propio.seccionId }]),
      intento(c, ["seccionId"], [{ destinoSucursalId: c.propio.vecinaId, productoId: c.propio.productoId, cantidad: 1, seccionOrigenId: k.seccionId }]),
      intento(c, ["productoId"], [{ destinoSucursalId: c.propio.vecinaId, productoId: k.productoId, cantidad: 1, seccionOrigenId: c.propio.seccionId }]),
    ),

  "accion|actions/traspasos/traspasos.ts|aprobarYEnviarTransferencia": (k, c) =>
    conVariantes(intento(c, ["traspasoId"], [k.traspasoId, c.propio.seccionId]), intento(c, ["seccionId"], [c.propio.traspasoId, k.seccionId])),
  "accion|actions/traspasos/traspasos.ts|aceptarTransferencia": (k, c) =>
    conVariantes(intento(c, ["traspasoEnviadoId"], [k.traspasoEnviadoId, c.propio.seccionId]), intento(c, ["seccionId"], [c.propio.traspasoEnviadoId, k.seccionId])),

  // --- consultas de las páginas y lecturas (el contexto —sucursal activa, empresa, usuario, hora, db— es el propio; los ids del cliente, los ajenos) ---
  // Las candidatas son las sucursales con carta propia; la consulta tiene que dejar afuera las que u1 no ve (S2, S3, las de otra empresa).
  "consulta|consultas/carta/admin.ts|origenesDeCopiaVisibles": (k, c) => [c.mundo.u1.id, [{ id: k.sucursalId, nombre: "Sucursal candidata", cantidadProductos: 1 }, { id: k.vecinaId, nombre: "Sucursal vecina", cantidadProductos: 1 }], c.db],
  "consulta|consultas/catalogo/grupos.ts|cadenasDeGrupos": (k, c) => [[k.grupoId], c.db],
  "consulta|consultas/catalogo/recetas.ts|listarCalibracionesDeIngredientes": (k, c) => [[k.recetaIngredienteId, k.recetaIngredientePropioId], c.db],
  "consulta|consultas/catalogo/recetas.ts|listarOpcionesDeSustituto": (k, c) => [{ insumoIdExcluido: k.insumoId, unidadId: k.unidadId }, c.db],
  "consulta|consultas/permisos/auditoria.ts|listarRegistrosAuditoria": (_k, c) => [{ sucursalIds: [c.propio.sucursalId], incluirFilasDeEmpresa: true }, c.db],
  "consulta|consultas/reportes/costo-historico.ts|reconstruirCostosDeVenta": (k, c) => [c.propio.sucursalId, [{ productoId: k.productoId, fecha: hoy() }], c.db],
  "consulta|consultas/reportes/costos.ts|cargarCostosYMargenes": (_k, c) => [c.propio.sucursalId, c.db, { empresaPct: null, porCategoria: new Map() }],
  "consulta|consultas/reportes/rendimiento-por-sucursal.ts|compararRendimientosDeSucursales": (k, c) => [[{ id: c.propio.sucursalId, nombre: "Central ZZ-A1" }], { productoId: k.productoPvId, todas: true }, c.db],
  "consulta|consultas/reportes/rendimiento-por-sucursal.ts|compararRendimientosPorSucursal": (k, c) => [[{ id: c.propio.sucursalId, nombre: "Central ZZ-A1" }], { productoId: k.productoPvId, todas: true }, c.db],
  "lectura|lecturas/auth/cupo-de-correo.ts|cupoDeCorreoDeEmpresa": (k, c) => [c.db, { empresaId: c.propio.empresaId, destinatario: `${k.marca.toLowerCase()}-invitado@ajeno.test`, ahora: hoy() }],
  "lectura|lecturas/movimientos/receta-para-vender.ts|cargarRecetaVigenteParaVender": (k, c) => [c.db, { productoId: k.productoPvId, sucursalId: c.propio.sucursalId }],
  "lectura|lecturas/permisos/gobierno.ts|invarianteRolSinUsuariosActivos": (k, c) => [c.db, { id: k.rolId, nombre: "Rol de prueba" }],

  // --- POS ---
  "accion|actions/pos/cuenta-pedido.ts|agregarItems": (k, c) =>
    conVariantes(
      intento(c, ["cuentaId"], [k.cuentaId, [{ productoId: c.propio.productoPvId, cantidad: 1 }]]),
      intento(c, ["productoPvId"], [c.propio.cuentaId, [{ productoId: k.productoPvId, cantidad: 1 }]]),
      intento(c, ["promoCartaId"], [c.propio.cuentaId, [], [{ promoCartaId: k.promoCartaId, elecciones: [{ seccionCartaId: c.propio.seccionCartaId, elegidos: [{ productoId: c.propio.productoPvId, cantidad: 1 }] }] }]]),
      intento(c, ["seccionCartaId", "productoPvId"], [c.propio.cuentaId, [], [{ promoCartaId: c.propio.promoCartaId, elecciones: [{ seccionCartaId: k.seccionCartaId, elegidos: [{ productoId: k.productoPvId, cantidad: 1 }] }] }]]),
    ),
};

const parametros: Record<string, Record<string, Valor>> = {
  // `operacionId` por defecto es la compra; la venta lleva la suya.
  "accion|actions/movimientos/venta.ts|anularVenta": { operacionId: (k) => k.ventaId },
  "consulta|consultas/pos/tickets.ts|obtenerTicketsRecientes": { mesaId: (k) => k.mesaCerradaId },
  "consulta|consultas/catalogo/productos.ts|obtenerFichaProducto": { id: (k) => k.productoId },
  "consulta|consultas/catalogo/productos.ts|obtenerProductoOpcion": { id: (k) => k.productoId },
  "consulta|consultas/catalogo/productos.ts|obtenerProductoPorId": { id: (k) => k.productoId },
  "consulta|consultas/catalogo/proveedores.ts|obtenerFichaProveedor": { id: (k) => k.proveedorId },
  "consulta|consultas/catalogo/proveedores.ts|obtenerProveedorPorId": { id: (k) => k.proveedorId },
  // Estos ayudantes de gobierno reciben el usuario OBJETIVO (el que el cliente eligió), no el actor: en la matriz es el de otra empresa.
  "lectura|lecturas/permisos/gestion-de-usuarios.ts|objetivoEnSucursal": { usuarioId: (k) => k.usuarioId },
  "lectura|lecturas/permisos/gestion-de-usuarios.ts|objetivoEnLaEmpresa": { usuarioId: (k) => k.usuarioId },
  "lectura|lecturas/permisos/gestion-de-usuarios.ts|reactivaAUnAdmin": { usuarioId: (k) => k.usuarioId },
  "lectura|lecturas/permisos/gerencia.ts|tuvoRolAdminEnLaEmpresa": { usuarioId: (k) => k.usuarioId },
  "lectura|lecturas/permisos/gobierno.ts|esAdminEfectivoEnAlgunaSucursal": { usuarioId: (k) => k.usuarioId },
  "consulta|consultas/reportes/historial-producto.ts|obtenerIngredientesRecetaVigente": { productoId: (k) => k.productoPvId },
  "accion|actions/movimientos/conteo-fisico.ts|resolverConteoPendiente": { comoResolver: () => "ajustar" },
  "accion|actions/stock/frecuencia-conteo.ts|eliminarFrecuenciaConteo": { id: (k) => k.frecuenciaId },
  "accion|actions/stock/seccion-habitual.ts|eliminarSeccionHabitual": { id: (k) => k.seccionHabitualId },
  "accion|actions/stock/stock-minimo.ts|eliminarStockMinimo": { id: (k) => k.stockMinimoId },
  "accion|actions/traspasos/traspasos.ts|cancelarSolicitudTransferencia": { id: (k) => k.traspasoId },
  "accion|actions/traspasos/traspasos.ts|rechazarSolicitudTransferencia": { id: (k) => k.traspasoId },
  "accion|actions/traspasos/traspasos.ts|rechazarTransferencia": { id: (k) => k.traspasoEnviadoId },
  "accion|actions/traspasos/traspasos.ts|confirmarReingresoTransferencia": { id: (k) => k.traspasoEnviadoId },
};

const porArchivo: Record<string, Record<string, Valor>> = {
  // En las recetas, `productoId` es el producto CON receta: un PV; el ingrediente es una MP (`insumoProductoId`).
  "actions/catalogo/recetas.ts": { productoId: (k) => k.productoPvId },
  "actions/catalogo/receta-sucursal.ts": { productoId: (k) => k.productoPvId },
  // La sección habitual, el precio local y el contenido de la carta son de un PV.
  "actions/stock/seccion-habitual.ts": { productoId: (k) => k.productoPvId },
  "actions/carta/contenido-producto.ts": { productoId: (k) => k.productoPvId },
  "actions/movimientos/precio-local.ts": { productoId: (k) => k.productoPvId },
};

export const GENERADORES: Generadores = { completos, parametros, porArchivo };

/**
 * Las puertas que NO se pueden invocar en la matriz, con el motivo. Lista CERRADA que solo se achica (`MAXIMO_SIN_GENERADOR` en la cobertura): una puerta nueva que no se pueda derivar ni escribir
 * a mano obliga a declararse acá, con motivo y fecha.
 */
const CALCULO_SOBRE_DATOS_CARGADOS =
  "cálculo que recibe los datos YA cargados por la consulta de la página que lo llama (estructuras internas: items, mapas de productos, índices de recetas), sin ids del cliente: su aislamiento es el del `db` y el de esa consulta, que sí está en la matriz";
const AYUDANTE_DE_RECETAS =
  "ayudante genérico de recetas que recibe el alcance (central o de una sucursal) y los argumentos de Prisma del que lo llama: se ejerce a través de las acciones y consultas de recetas, que sí están en la matriz";
const CARTA_PUBLICA = "carta pública: anónima POR DISEÑO (lo que la empresa publica a propósito, con lista cerrada de campos: GT-13, `test/arquitectura/carta-publica-lista-cerrada.test.ts` y `test/carta/`)";

/**
 * Las puertas que NO se pueden invocar en la matriz, con el motivo. Lista CERRADA que solo se achica (`MAXIMO_SIN_GENERADOR` en la cobertura): una puerta nueva que no se pueda derivar ni escribir
 * a mano obliga a declararse acá, con motivo y fecha (2026-10-09, T15).
 */
export const SIN_GENERADOR: Readonly<Record<string, string>> = {
  "accion|actions/auth/invitacion.ts|abrirInvitacion": "puerta anónima POR DISEÑO (GT-10: la autoridad es el token de la invitación); su cupo y su postura están en `puertas-sin-permiso-anonimo-y-sin-empresa.test.ts`",
  "accion|actions/auth/invitacion.ts|aceptarMiInvitacion": "recibe un `FormData` con el token de la cookie de invitación (GT-10, cubierta en `puertas-sin-permiso-anonimo-y-sin-empresa.test.ts`)",
  "consulta|consultas/carta/ventas-por-seccion.ts|reagruparPorSeccion": "función PURA (agrupa datos que se le pasan), no lee la base",
  "consulta|consultas/reportes/margen-real.ts|calcularMargenRealDelPeriodo": CALCULO_SOBRE_DATOS_CARGADOS,
  "consulta|consultas/reportes/periodo-margen.ts|calcularMargenDelPeriodo": CALCULO_SOBRE_DATOS_CARGADOS,
  "consulta|consultas/reportes/periodo-precios.ts|calcularComparativaPreciosDelPeriodo": CALCULO_SOBRE_DATOS_CARGADOS,
  "consulta|consultas/reportes/periodo-precios.ts|calcularTendenciaPreciosDelPeriodo": CALCULO_SOBRE_DATOS_CARGADOS,
  "consulta|consultas/reportes/periodo-ratio.ts|calcularRatioGastoVentas": CALCULO_SOBRE_DATOS_CARGADOS,
  "lectura|lecturas/carta/publica.ts|resolverCartaPublica": CARTA_PUBLICA,
  "lectura|lecturas/carta/publica.ts|resolverConfigPortal": CARTA_PUBLICA,
  "lectura|lecturas/carta/publica.ts|resolverPortalCarta": CARTA_PUBLICA,
  "lectura|lecturas/catalogo/datos-de-producto.ts|datosParaGuardar": "función PURA de armado de los datos de un producto, no lee la base",
  "lectura|lecturas/catalogo/datos-de-producto.ts|validarDatosDeProducto": "valida la entrada completa de un alta o edición de producto: se ejerce a través de `darDeAltaProducto` y `actualizarProducto`, que sí están en la matriz con ids ajenos en cada campo",
  "lectura|lecturas/catalogo/recetas-vigentes.ts|cargarHistorialDeVersiones": AYUDANTE_DE_RECETAS,
  "lectura|lecturas/catalogo/recetas-vigentes.ts|cargarRecetaVigente": AYUDANTE_DE_RECETAS,
  "lectura|lecturas/catalogo/recetas-vigentes.ts|cargarRecetasVigentes": AYUDANTE_DE_RECETAS,
  "lectura|lecturas/catalogo/recetas-vigentes.ts|versionVigentePorProducto": AYUDANTE_DE_RECETAS,
};
