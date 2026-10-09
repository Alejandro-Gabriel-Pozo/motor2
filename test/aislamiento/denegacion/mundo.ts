import { createHash } from "node:crypto";
import { limpiarBaseDeTest, prismaAdmin, prismaSinEmpresa, sembrarBase, EMPRESA_POR_DEFECTO_ID } from "../../setup/test-db";
import { crearEmpresa } from "../../setup/crear-empresa";
import { crearMembresia } from "../../setup/membresia";
import { activarTodosLosModulos } from "../../setup/modulos";
import { enElPasado, HORA_MS, DIA_MS } from "../../setup/tiempo";

/**
 * El MUNDO de la matriz de denegación por defecto (GT-3b): lo que se siembra UNA vez por archivo de test (las puertas que se prueban no escriben nada, y la matriz lo verifica con la huella de toda la base)
 * y los ids que las puertas reciben en cada escenario.
 *
 *  - **E1** (`empresa_principal`, la de las pruebas): tres sucursales. **S1** es la del usuario que actúa (`u1`: administrador de sistema en S1 y gerente de E1, sin NINGUNA membresía en S2 ni en S3);
 *    **S2** es «la otra sucursal de la misma empresa»; **S3** es la vecina con la que S1 y S2 tienen traspasos.
 *  - **E2**: OTRA empresa (creada con el mismo `crearEmpresa` del alta), con su sucursal y su vecina. `u1` no pertenece a ella.
 *
 * Cada sucursal que se prueba (S1 como «lo propio» de control, S2 como «lo ajeno de la misma empresa», la de E2 como «lo ajeno de otra empresa») recibe el MISMO juego de filas (`sembrarContenido`): una mesa con su
 * cuenta, ítems enviados y sin enviar, una compra y una venta con sus movimientos, un conteo pendiente, un traspaso, la receta propia, la carta de la sucursal, un miembro, etc. Todas con id explícito y un
 * MARCADOR en un campo de texto (`ZZ-E2`, `ZZ-S2`, `ZZ-A1` para lo propio): si el marcador de lo ajeno aparece en lo que una puerta devuelve, esa puerta filtró una fila que no era de quien preguntó.
 */

export interface KitDeEmpresa {
  /** El marcador: forma parte de todos los ids y nombres. */
  marca: string;
  empresaId: string;
  usuarioId: string;
  productoId: string;
  productoPvId: string;
  productoMp2Id: string;
  insumoId: string;
  grupoId: string;
  categoriaId: string;
  unidadId: string;
  unidad2Id: string;
  presentacionId: string;
  proveedorId: string;
  clienteId: string;
  rolId: string;
  motivoId: string;
  destinoId: string;
  seccionCartaId: string;
  promoCartaId: string;
  recetaVersionId: string;
  recetaIngredienteId: string;
}

export interface KitDeSucursal {
  marca: string;
  sucursalId: string;
  vecinaId: string;
  seccionId: string;
  seccion2Id: string;
  seccionVecinaId: string;
  mesaId: string;
  /** La mesa de la cuenta cerrada (con su ticket emitido). */
  mesaCerradaId: string;
  cuentaId: string;
  cuentaItemId: string;
  cuentaItemEnviadoId: string;
  promoCuentaId: string;
  compraId: string;
  ventaId: string;
  conteoId: string;
  traspasoId: string;
  traspasoEnviadoId: string;
  pagoConsignanteId: string;
  precioLocalId: string;
  frecuenciaId: string;
  stockMinimoId: string;
  seccionHabitualId: string;
  generoCartaId: string;
  itemAgrupadoCartaId: string;
  opcionId: string;
  recetaIngredientePropioId: string;
  membresiaId: string;
  miembroId: string;
  /** Una invitación pendiente con acceso a esta sucursal (y el acceso mismo). */
  invitacionId: string;
  invitacionDeSucursalId: string;
}

/** Los campos que son de UNA sucursal (los demás del kit son de la empresa): en el escenario «otra sucursal de la misma empresa» solo estos son ajenos. Exhaustivo por construcción (`Record<keyof KitDeSucursal, true>`). */
const CAMPOS_DE_SUCURSAL_REGISTRO: Record<keyof KitDeSucursal, true> = {
  marca: true,
  sucursalId: true,
  vecinaId: true,
  seccionId: true,
  seccion2Id: true,
  seccionVecinaId: true,
  mesaId: true,
  mesaCerradaId: true,
  cuentaId: true,
  cuentaItemId: true,
  cuentaItemEnviadoId: true,
  promoCuentaId: true,
  compraId: true,
  ventaId: true,
  conteoId: true,
  traspasoId: true,
  traspasoEnviadoId: true,
  pagoConsignanteId: true,
  precioLocalId: true,
  frecuenciaId: true,
  stockMinimoId: true,
  seccionHabitualId: true,
  generoCartaId: true,
  itemAgrupadoCartaId: true,
  opcionId: true,
  recetaIngredientePropioId: true,
  membresiaId: true,
  miembroId: true,
  invitacionId: true,
  invitacionDeSucursalId: true,
};
export const CAMPOS_DE_SUCURSAL: ReadonlySet<string> = new Set(Object.keys(CAMPOS_DE_SUCURSAL_REGISTRO));

export interface Mundo {
  e1: KitDeEmpresa;
  e2: KitDeEmpresa;
  /** Lo PROPIO de S1 (control positivo: lo que el usuario sí puede ver). */
  s1: KitDeSucursal;
  /** La otra sucursal de E1 (el usuario no es miembro). */
  s2: KitDeSucursal;
  /** La sucursal de E2. */
  d2: KitDeSucursal;
  u1: { id: string; email: string };
  /** Una sucursal de E1 donde u1 también es administrador y que está VACÍA (sin carta, sin recetas): el destino de las copias entre sucursales, que solo se hacen sobre un destino vacío. */
  s4Id: string;
  /** Una cuenta con sesión sin ninguna pertenencia. */
  sinEmpresa: { id: string; email: string };
  rolAdminE1Id: string;
  rolOperadorE1Id: string;
}

async function sembrarEmpresaDeKit(marca: string, empresaId: string, usuarioId: string): Promise<KitDeEmpresa> {
  const db = prismaAdmin;
  const id = (n: string) => `${marca}-${n}`;
  const unidad = async (nombre: string, magnitud: "PESO" | "VOLUMEN" | "CANTIDAD", decimales: number) =>
    (await db.unidad.findFirst({ where: { empresaId, nombre } })) ?? (await db.unidad.create({ data: { empresaId, nombre, magnitud, decimales } }));
  const kg = await unidad("kg", "PESO", 2);
  const g = await unidad("g", "PESO", 0);
  // Una unidad con el marcador en el nombre: las de fábrica (kg, g…) son iguales en todas las empresas y no delatarían de dónde salió una lista.
  await db.unidad.create({ data: { id: id("unidad"), empresaId, nombre: `Unidad ${marca}`, magnitud: "CANTIDAD", decimales: 0 } });
  const categoria = await db.categoriaProducto.create({ data: { id: id("categoria"), empresaId, nombre: `Categoría ${marca}` } });
  const grupo = await db.grupo.create({ data: { id: id("grupo"), empresaId, nombre: `Grupo ${marca}` } });
  const insumo = await db.insumo.create({ data: { id: id("insumo"), empresaId, nombre: `Insumo ${marca}`, grupoId: grupo.id } });
  const producto = (sufijo: string, tipo: "MP" | "PV", extra: object = {}) =>
    db.producto.create({
      data: { id: id(sufijo), empresaId, codigo: id(`COD-${sufijo}`), nombre: `Producto ${sufijo} ${marca}`, tipo, unidadStockId: kg.id, categoriaId: categoria.id, precioVenta: 1000, ...extra },
    });
  const mp = await producto("mp", "MP", { insumoId: insumo.id, unidadCompraId: kg.id, observaciones: `observaciones ${marca}` });
  const pv = await producto("pv", "PV", { seProduce: true });
  const mp2 = await producto("mp2", "MP");
  const proveedor = await db.proveedor.create({ data: { id: id("proveedor"), empresaId, codigo: id("PRV"), nombre: `Proveedor ${marca}`, contacto: `contacto ${marca}`, email: `${marca.toLowerCase()}-prov@ajeno.test`, cuit: null } });
  await db.proveedorPorProducto.create({ data: { id: id("ppp"), empresaId, productoId: mp.id, proveedorId: proveedor.id, unidadCompraId: kg.id, precioUnitario: 100, precioPorUnidadStock: 100, referenciaProveedor: `ref ${marca}` } });
  const presentacion = await db.presentacion.create({ data: { id: id("presentacion"), empresaId, productoId: mp.id, unidadCompraId: g.id, factorConversion: 1000 } });
  const cliente = await db.cliente.create({ data: { id: id("cliente"), empresaId, nombre: `Cliente ${marca}`, descuentoPorcentaje: 10 } });
  const rol = await db.rol.create({ data: { id: id("rol"), empresaId, nombre: `Rol ${marca}`, clave: null } });
  const motivo = await db.motivoMerma.create({ data: { id: id("motivo"), empresaId, nombre: `Motivo ${marca}` } });
  const destino = await db.destinoConsumo.create({ data: { id: id("destino"), empresaId, nombre: `Destino ${marca}` } });
  const seccionCarta = await db.seccionCarta.create({ data: { id: id("seccion-carta"), empresaId, nombre: `Sección de carta ${marca}`, titulo: `Título ${marca}` } });
  const promo = await db.promoCarta.create({ data: { id: id("promo"), empresaId, seccionCartaId: seccionCarta.id, titulo: `Promo ${marca}`, precio: 5000 } });
  await db.promoCartaCupo.create({ data: { id: id("cupo"), empresaId, promoCartaId: promo.id, seccionCartaId: seccionCarta.id, cantidadMinima: 1, cantidadMaxima: 2 } });
  await db.portalCartaEmpresa.create({ data: { empresaId, valores: { titulo: `Portal ${marca}` } } });
  await db.margenObjetivo.create({ data: { id: id("margen"), empresaId, categoriaId: categoria.id, foodCostObjetivoPct: 30 } });
  const receta = await db.recetaVersion.create({ data: { id: id("receta"), empresaId, productoId: pv.id, version: 1, sucursalId: null, comentarios: `receta ${marca}` } });
  const ingrediente = await db.recetaIngrediente.create({ data: { id: id("ingrediente"), empresaId, recetaVersionId: receta.id, insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id, observaciones: `ingrediente ${marca}` } });
  await db.recetaPaso.create({ data: { id: id("paso"), empresaId, recetaVersionId: receta.id, orden: 1, nombre: `Paso ${marca}`, instruccion: `Mezclar ${marca}` } });
  await db.registroAuditoria.create({ data: { id: id("auditoria-empresa"), empresaId, entidad: "Producto", entidadId: mp.id, descripcion: `Auditoría de empresa ${marca}`, campo: "nombre", valorAnterior: "a", valorNuevo: "b", actorId: usuarioId } });
  return {
    marca,
    empresaId,
    usuarioId,
    productoId: mp.id,
    productoPvId: pv.id,
    productoMp2Id: mp2.id,
    insumoId: insumo.id,
    grupoId: grupo.id,
    categoriaId: categoria.id,
    unidadId: kg.id,
    unidad2Id: g.id,
    presentacionId: presentacion.id,
    proveedorId: proveedor.id,
    clienteId: cliente.id,
    rolId: rol.id,
    motivoId: motivo.id,
    destinoId: destino.id,
    seccionCartaId: seccionCarta.id,
    promoCartaId: promo.id,
    recetaVersionId: receta.id,
    recetaIngredienteId: ingrediente.id,
  };
}

/** El contenido de UNA sucursal (`sucursalId`, de `empresaId`), con la vecina `vecinaId` como contraparte de los traspasos. `usuarioId` es quien aparece como autor de lo que se siembra. */
async function sembrarContenido(marca: string, k: KitDeEmpresa, sucursalId: string, vecinaId: string, miembro: { id: string; rolId: string }): Promise<KitDeSucursal> {
  const db = prismaAdmin;
  const empresaId = k.empresaId;
  const id = (n: string) => `${marca}-${n}`;
  const seccion = await db.seccion.create({ data: { id: id("seccion"), empresaId, sucursalId, nombre: `Sección ${marca}` } });
  const seccion2 = await db.seccion.create({ data: { id: id("seccion-b"), empresaId, sucursalId, nombre: `Sección B ${marca}` } });
  const seccionVecina = await db.seccion.create({ data: { id: id("seccion-vecina"), empresaId, sucursalId: vecinaId, nombre: `Sección vecina de ${marca}` } });
  for (const productoId of [k.productoId, k.productoPvId, k.productoMp2Id]) {
    await db.disponibilidadProducto.create({ data: { empresaId, sucursalId, productoId, disponible: true } });
  }
  const membresia = await db.usuarioSucursal.create({ data: { id: id("membresia"), empresaId, usuarioId: miembro.id, sucursalId, rolId: miembro.rolId, notas: `Notas ${marca}` } });

  // POS: una mesa con una cuenta abierta (un ítem sin enviar, uno enviado y una promo), y una mesa con la cuenta cerrada y su ticket.
  const mesa = await db.mesa.create({ data: { id: id("mesa"), empresaId, sucursalId, numero: 1 } });
  const cuenta = await db.cuenta.create({ data: { id: id("cuenta"), empresaId, mesaId: mesa.id, abiertaPorId: miembro.id, comensales: 2, clienteId: k.clienteId } });
  const promoCuenta = await db.promoCuenta.create({ data: { id: id("promocuenta"), empresaId, cuentaId: cuenta.id, promoCartaId: k.promoCartaId, precio: 5000, titulo: `Promo en cuenta ${marca}`, creadoPorId: miembro.id } });
  const item = await db.cuentaItem.create({ data: { id: id("item"), empresaId, cuentaId: cuenta.id, productoId: k.productoPvId, cantidad: 1, precioUnitario: 1000, creadoPorId: miembro.id } });
  const itemEnviado = await db.cuentaItem.create({ data: { id: id("item-enviado"), empresaId, cuentaId: cuenta.id, productoId: k.productoPvId, cantidad: 2, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: miembro.id } });
  await db.cuentaItem.create({ data: { id: id("item-promo"), empresaId, cuentaId: cuenta.id, productoId: k.productoPvId, cantidad: 1, precioUnitario: 0, promoCuentaId: promoCuenta.id, creadoPorId: miembro.id } });
  const mesa2 = await db.mesa.create({ data: { id: id("mesa-b"), empresaId, sucursalId, numero: 2 } });
  const cuentaCerrada = await db.cuenta.create({ data: { id: id("cuenta-cerrada"), empresaId, mesaId: mesa2.id, abiertaPorId: miembro.id, cerradaEn: enElPasado(HORA_MS), cerradaPorId: miembro.id } });
  await db.ejemplarTicket.create({ data: { id: id("ticket"), empresaId, sucursalId, cuentaId: cuentaCerrada.id, numero: 1, ejemplar: 1, emitidoPorId: miembro.id } });

  // Kardex: una compra con lote (stock +10), una venta (−1) y un conteo pendiente.
  const compra = await db.operacion.create({
    data: { id: id("compra"), empresaId, sucursalId, proceso: "COMPRA", fecha: enElPasado(2 * DIA_MS), proveedorId: k.proveedorId, nroFactura: `F-${marca}`, usuarioId: miembro.id, detalleLibre: `Compra ${marca}` },
  });
  await db.movimientoStock.create({
    data: { id: id("mov-compra"), empresaId, operacionId: compra.id, productoId: k.productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad: 10, loteVencimiento: new Date(Date.now() + 30 * DIA_MS), detalle: `Compra ${marca}`, precioTotal: 1000, precioPorUnidadStock: 100 },
  });
  const venta = await db.operacion.create({ data: { id: id("venta"), empresaId, sucursalId, proceso: "VENTA", fecha: enElPasado(DIA_MS), usuarioId: miembro.id, clienteId: k.clienteId, detalleLibre: `Venta ${marca}` } });
  await db.movimientoStock.create({
    data: { id: id("mov-venta"), empresaId, operacionId: venta.id, productoId: k.productoId, seccionId: seccion.id, proceso: "VENTA", cantidad: -1, detalle: `Venta ${marca}`, precioTotal: 800, precioPorUnidadStock: 100, costoUnitarioVenta: 100, precioListaUnitario: 1000 },
  });
  // Pérdidas y devoluciones: lo que leen los reportes de merma/consumo y de devoluciones (cada movimiento lleva el marcador en el detalle, el motivo, el destino, el cliente y el proveedor).
  const movimientoSuelto = async (n: string, proceso: "MERMA" | "CONSUMO" | "DEVOLUCION_CLIENTE" | "DEVOLUCION_PROVEEDOR", cantidad: number, extra: object) => {
    const op = await db.operacion.create({ data: { id: id(n), empresaId, sucursalId, proceso, fecha: enElPasado(DIA_MS), usuarioId: miembro.id, detalleLibre: `${proceso} ${marca}`, ...extra } });
    await db.movimientoStock.create({ data: { id: id(`mov-${n}`), empresaId, operacionId: op.id, productoId: k.productoId, seccionId: seccion.id, proceso, cantidad, detalle: `${proceso} ${marca}`, precioTotal: 100, precioPorUnidadStock: 100 } });
  };
  await movimientoSuelto("merma", "MERMA", -1, { motivoId: k.motivoId });
  await movimientoSuelto("consumo", "CONSUMO", -1, { destinoId: k.destinoId });
  await movimientoSuelto("devolucion-cliente", "DEVOLUCION_CLIENTE", 1, { clienteId: k.clienteId });
  await movimientoSuelto("devolucion-proveedor", "DEVOLUCION_PROVEEDOR", -1, { proveedorId: k.proveedorId });
  const conteo = await db.conteoFisico.create({
    data: { id: id("conteo"), empresaId, sucursalId, fecha: enElPasado(HORA_MS), productoId: k.productoId, seccionId: seccion.id, saldoSistema: 9, conteoReal: 8, diferencia: -1, accion: "FALTA_MOVIMIENTO", estado: "PENDIENTE", detalle: `Conteo ${marca}`, usuarioId: miembro.id },
  });
  const traspaso = await db.traspasoSucursal.create({
    data: { id: id("traspaso"), empresaId, origenSucursalId: sucursalId, destinoSucursalId: vecinaId, productoId: k.productoId, cantidad: 1, iniciadoPor: "ORIGEN", estado: "SOLICITADA", creadoPorId: miembro.id, detalle: `Traspaso ${marca}` },
  });
  const traspasoEnviado = await db.traspasoSucursal.create({
    data: { id: id("traspaso-enviado"), empresaId, origenSucursalId: sucursalId, destinoSucursalId: vecinaId, productoId: k.productoId, cantidad: 1, seccionOrigenId: seccion.id, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: miembro.id, detalle: `Traspaso enviado ${marca}` },
  });
  const pago = await db.pagoConsignante.create({ data: { id: id("pago"), empresaId, sucursalId, proveedorId: k.proveedorId, importe: 500, fecha: enElPasado(DIA_MS), notas: `Pago ${marca}`, usuarioId: miembro.id } });

  // Configuración por sucursal.
  const precioLocal = await db.precioLocalProducto.create({ data: { id: id("precio-local"), empresaId, sucursalId, productoId: k.productoPvId, precio: 1234, habilitado: true } });
  const frecuencia = await db.frecuenciaConteoProducto.create({ data: { id: id("frecuencia"), empresaId, sucursalId, productoId: k.productoId, frecuenciaDias: 7 } });
  const stockMinimo = await db.stockMinimoProducto.create({ data: { id: id("minimo"), empresaId, sucursalId, productoId: k.productoId, seccionId: seccion.id, minimo: 50 } });
  const habitual = await db.seccionHabitualProducto.create({ data: { id: id("habitual"), empresaId, sucursalId, productoId: k.productoId, seccionId: seccion.id } });
  await db.descuentoProductoSucursal.create({ data: { id: id("descuento"), empresaId, sucursalId, productoId: k.productoPvId, porcentaje: 15 } });
  await db.promoCartaSucursal.create({ data: { id: id("promo-sucursal"), empresaId, promoCartaId: k.promoCartaId, sucursalId, activa: true, precioLocal: 4000 } });

  // Receta propia (con su rendimiento local) y carta de la sucursal.
  await db.recetaSucursal.create({ data: { id: id("receta-sucursal"), empresaId, sucursalId, productoId: k.productoPvId, habilitada: true } });
  const recetaPropia = await db.recetaVersion.create({ data: { id: id("receta-propia"), empresaId, productoId: k.productoPvId, version: 1, sucursalId, comentarios: `receta propia ${marca}` } });
  const ingredientePropio = await db.recetaIngrediente.create({ data: { id: id("ingrediente-propio"), empresaId, recetaVersionId: recetaPropia.id, insumoProductoId: k.productoId, cantidad: 2, unidadId: k.unidadId, observaciones: `ingrediente propio ${marca}` } });
  await db.rendimientoLocalIngrediente.create({ data: { id: id("rendimiento"), empresaId, recetaIngredienteId: k.recetaIngredienteId, sucursalId, cantidad: 3, mermaPorcentaje: 5 } });
  const genero = await db.generoCarta.create({ data: { id: id("genero"), empresaId, sucursalId, nombre: `Género ${marca}` } });
  const itemAgrupado = await db.itemAgrupadoCarta.create({ data: { id: id("agrupado"), empresaId, sucursalId, nombre: `Agrupado ${marca}`, seccionCartaId: k.seccionCartaId, generoCartaId: genero.id } });
  const opcion = await db.opcionItemAgrupadoCarta.create({ data: { id: id("opcion"), empresaId, sucursalId, itemAgrupadoCartaId: itemAgrupado.id, productoId: k.productoPvId } });
  await db.contenidoCartaProducto.create({ data: { id: id("contenido"), empresaId, sucursalId, productoId: k.productoMp2Id, visibleEnCarta: true, seccionCartaId: k.seccionCartaId, descripcion: `Contenido ${marca}`, generoCartaId: genero.id } });
  await db.sucursalPublica.create({ data: { id: id("publica"), empresaId, sucursalId, slug: id("slug").toLowerCase(), etiqueta: `Etiqueta ${marca}`, publicada: true } });
  await db.temaCartaSucursal.create({ data: { id: id("tema"), empresaId, sucursalId, valores: { marca }, aplicarEnCarta: false } });
  await db.capacidadSucursal.create({ data: { id: id("capacidad"), empresaId, accionClave: "carta_tema", sucursalId, habilitado: true } });

  // Una invitación con acceso a esta sucursal y un registro de auditoría de la sucursal.
  const invitacion = await db.invitacion.create({
    data: { id: id("invitacion"), empresaId, email: `${marca.toLowerCase()}-invitado@ajeno.test`, rolEmpresa: "usuario", hashToken: createHash("sha256").update(id("invitacion")).digest("hex"), venceEn: new Date(Date.now() + 7 * DIA_MS), invitadoPorId: miembro.id },
  });
  const invitacionSucursal = await db.invitacionSucursal.create({ data: { id: id("invitacion-sucursal"), empresaId, invitacionId: invitacion.id, sucursalId, rolId: miembro.rolId, notas: `Notas de invitación ${marca}`, invitadoPorId: miembro.id } });
  await db.registroAuditoria.create({ data: { id: id("auditoria"), empresaId, entidad: "Operacion", entidadId: compra.id, descripcion: `Auditoría de sucursal ${marca}`, campo: "detalleLibre", valorAnterior: "a", valorNuevo: "b", actorId: miembro.id, sucursalId } });

  return {
    marca,
    sucursalId,
    vecinaId,
    seccionId: seccion.id,
    seccion2Id: seccion2.id,
    seccionVecinaId: seccionVecina.id,
    mesaId: mesa.id,
    mesaCerradaId: mesa2.id,
    cuentaId: cuenta.id,
    cuentaItemId: item.id,
    cuentaItemEnviadoId: itemEnviado.id,
    promoCuentaId: promoCuenta.id,
    compraId: compra.id,
    ventaId: venta.id,
    conteoId: conteo.id,
    traspasoId: traspaso.id,
    traspasoEnviadoId: traspasoEnviado.id,
    pagoConsignanteId: pago.id,
    precioLocalId: precioLocal.id,
    frecuenciaId: frecuencia.id,
    stockMinimoId: stockMinimo.id,
    seccionHabitualId: habitual.id,
    generoCartaId: genero.id,
    itemAgrupadoCartaId: itemAgrupado.id,
    opcionId: opcion.id,
    recetaIngredientePropioId: ingredientePropio.id,
    membresiaId: membresia.id,
    miembroId: miembro.id,
    invitacionId: invitacion.id,
    invitacionDeSucursalId: invitacionSucursal.id,
  };
}

/**
 * Siembra el mundo (el llamador limpia la base antes, con `limpiarBaseDeTest`). Las puertas que se prueban no escriben nada: la matriz lo verifica con `huellaDeLaBase`.
 */
export async function sembrarMundo(): Promise<Mundo> {
  const base = await sembrarBase();
  const e1Id = EMPRESA_POR_DEFECTO_ID;
  const rolAdminE1Id = base.admin.id;
  const rolOperadorE1Id = base.operador.id;
  await activarTodosLosModulos(e1Id);
  const miembroDeLaEmpresa = (usuarioId: string, empresaId: string) => prismaAdmin.usuarioEmpresa.create({ data: { usuarioId, empresaId } });

  // E1: tres sucursales (S1 = «Central» de sembrarBase) y los usuarios.
  const s1Id = base.sucursal.id;
  await prismaAdmin.sucursal.update({ where: { id: s1Id }, data: { nombre: "Central ZZ-A1", maxMesasAbiertas: 7 } });
  await prismaAdmin.empresa.update({ where: { id: e1Id }, data: { nombre: "Empresa principal ZZ-A1" } });
  const s2 = await prismaAdmin.sucursal.create({ data: { id: "S2-sucursal-dos", empresaId: e1Id, nombre: "Sucursal Dos" } });
  const s3 = await prismaAdmin.sucursal.create({ data: { id: "S3-sucursal-tres", empresaId: e1Id, nombre: "Sucursal Tres" } });
  const u1 = await prismaAdmin.user.create({ data: { id: "u1-actor", email: "u1@e1.test", name: "Actor de E1" } });
  await crearMembresia({ usuarioId: u1.id, sucursalId: s1Id, rolId: rolAdminE1Id });
  const s4 = await prismaAdmin.sucursal.create({ data: { id: "S4-sucursal-cuatro", empresaId: e1Id, nombre: "Sucursal Cuatro" } });
  await crearMembresia({ usuarioId: u1.id, sucursalId: s4.id, rolId: rolAdminE1Id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: u1.id, empresaId: e1Id } }, data: { rolEmpresa: "gerente" } });
  const miembroS1 = await prismaAdmin.user.create({ data: { id: "ZZ-A1-miembro", email: "zz-a1-miembro@e1.test", name: "Miembro A1" } });
  await miembroDeLaEmpresa(miembroS1.id, e1Id);
  const miembroS2 = await prismaAdmin.user.create({ data: { id: "ZZ-S2-miembro", email: "zz-s2-miembro@e1.test", name: "Miembro S2" } });
  await miembroDeLaEmpresa(miembroS2.id, e1Id);
  const sinEmpresa = await prismaAdmin.user.create({ data: { id: "sin-empresa", email: "sin-empresa@dominio.test", name: "Sin empresa" } });

  const e1 = await sembrarEmpresaDeKit("ZZ-A1", e1Id, u1.id);
  const s1 = await sembrarContenido("ZZ-A1", e1, s1Id, s3.id, { id: miembroS1.id, rolId: rolOperadorE1Id });
  // S2 comparte el catálogo de E1 (es de la empresa): su kit de empresa es el de E1, y lo propio de S2 lleva su marca.
  const s2Kit = await sembrarContenido("ZZ-S2", e1, s2.id, s3.id, { id: miembroS2.id, rolId: rolOperadorE1Id });

  // E2: otra empresa, creada con el alta de pruebas (roles, unidades, motivos y su primera sucursal).
  const alta = await crearEmpresa(prismaSinEmpresa, { nombre: "ZZ-E2 Empresa", slug: "zz-e2", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", emailPrimerAdmin: "zz-e2-gerente@e2.test", nombreSucursal: "ZZ-E2 Central" }, []);
  await activarTodosLosModulos(alta.empresaId);
  const vecinaE2 = await prismaAdmin.sucursal.create({ data: { id: "ZZ-E2-vecina", empresaId: alta.empresaId, nombre: "ZZ-E2 Vecina" } });
  const rolOperadorE2 = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: alta.empresaId, clave: "operador" } });
  const miembroE2 = await prismaAdmin.user.create({ data: { id: "ZZ-E2-miembro", email: "zz-e2-miembro@e2.test", name: "Miembro E2" } });
  await miembroDeLaEmpresa(miembroE2.id, alta.empresaId);
  const e2 = await sembrarEmpresaDeKit("ZZ-E2", alta.empresaId, alta.usuarioId);
  const d2 = await sembrarContenido("ZZ-E2", e2, alta.sucursalId, vecinaE2.id, { id: miembroE2.id, rolId: rolOperadorE2.id });

  return { e1, e2, s1, s2: s2Kit, d2, u1: { id: u1.id, email: u1.email }, s4Id: s4.id, sinEmpresa: { id: sinEmpresa.id, email: sinEmpresa.email }, rolAdminE1Id, rolOperadorE1Id };
}

/** Deja la base como la dejan los demás tests: `limpiarBaseDeTest` más el nombre original de la empresa de pruebas (el mundo la renombra con un marcador y `limpiarBaseDeTest` no lo deshace). */
export async function limpiarMundo(): Promise<void> {
  await limpiarBaseDeTest();
  await prismaAdmin.empresa.update({ where: { id: EMPRESA_POR_DEFECTO_ID }, data: { nombre: "Empresa principal" } });
}

/**
 * La HUELLA de toda la base: un hash por tabla del contenido completo de sus filas (cada fila como texto, ordenadas). Si una puerta que debía negarse escribe algo —una fila nueva, una modificada o una borrada, en
 * la tabla que sea—, la huella de esa tabla cambia. Se lee como dueño (salta la RLS): ve las filas de todas las empresas. Es más fuerte que contar `Operacion`, `MovimientoStock` y `RegistroAuditoria` antes y después.
 */
export async function huellaDeLaBase(): Promise<Map<string, string>> {
  const filas = await prismaAdmin.$queryRawUnsafe<Array<{ tabla: string; h: string | null }>>(
    `SELECT t.table_name AS tabla,
            (xpath('/row/h/text()', query_to_xml(format('SELECT md5(coalesce(string_agg(x::text, %L ORDER BY x::text), %L)) AS h FROM %I.%I x', '|', '', t.table_schema, t.table_name), false, true, '')))[1]::text AS h
       FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
      ORDER BY 1`,
  );
  return new Map(filas.map((f) => [f.tabla, f.h ?? ""]));
}

/** Las tablas cuya huella cambió entre dos fotos (vacío = no se escribió nada). */
export function tablasCambiadas(antes: ReadonlyMap<string, string>, despues: ReadonlyMap<string, string>): string[] {
  const nombres = new Set([...antes.keys(), ...despues.keys()]);
  return [...nombres].filter((t) => antes.get(t) !== despues.get(t)).sort();
}
