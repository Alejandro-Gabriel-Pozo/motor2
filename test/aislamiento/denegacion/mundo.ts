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
 * Las sucursales S2 y S3 también llevan marcador en su nombre (`ZZ-S2`, `ZZ-S3`) y los saldos de S2 y de E2 llevan una HUELLA numérica (7777 y 8888): una lectura que devuelve solo un número (un saldo, un total)
 * no tiene ningún texto donde buscar el marcador, y el número inconfundible sí se reconoce (hallazgo I-3 de la auditoría final, fila O.177).
 */

export interface KitDeEmpresa {
  /** El marcador: forma parte de todos los ids y nombres. */
  marca: string;
  empresaId: string;
  usuarioId: string;
  productoId: string;
  productoPvId: string;
  productoMp2Id: string;
  /** Una materia prima que NO está en ninguna receta (la que se agrega en el control positivo de «agregar ingrediente»). */
  productoMp3Id: string;
  /** Un PV con receta central y SIN receta propia en ninguna sucursal, fuera de todo ítem agrupado de la carta (los controles positivos de crear la receta propia y de agregar una opción a un ítem). */
  productoPv2Id: string;
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
  /** La cuenta ya cerrada (con su ticket emitido). */
  cuentaCerradaId: string;
  /** Una cuenta abierta sin ítems (la mesa se puede liberar). */
  cuentaVaciaId: string;
  /** Una cuenta abierta con todo enviado a cocina (se puede cerrar), con una promo enviada. */
  cuentaEnviadaId: string;
  promoCuentaEnviadaId: string;
  cuentaItemId: string;
  cuentaItemEnviadoId: string;
  promoCuentaId: string;
  compraId: string;
  /** Una compra de una materia prima sin consumos posteriores (la única que se puede anular). */
  compraAnulableId: string;
  ventaId: string;
  conteoId: string;
  /** Un conteo ya RESUELTO (el único que se puede cancelar). */
  conteoResueltoId: string;
  traspasoId: string;
  traspasoEnviadoId: string;
  /** Un envío ENVIADO desde la vecina HACIA esta sucursal (el destino lo acepta o lo rechaza). */
  traspasoEntranteId: string;
  /** Un envío de esta sucursal que el destino RECHAZÓ (espera el reingreso). */
  traspasoRechazadoId: string;
  /** Una solicitud pedida POR esta sucursal (destino) a la vecina (la sucursal que pidió la puede cancelar). */
  traspasoPedidoId: string;
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
  cuentaCerradaId: true,
  cuentaVaciaId: true,
  cuentaEnviadaId: true,
  promoCuentaEnviadaId: true,
  cuentaItemId: true,
  cuentaItemEnviadoId: true,
  promoCuentaId: true,
  compraId: true,
  compraAnulableId: true,
  ventaId: true,
  conteoId: true,
  conteoResueltoId: true,
  traspasoId: true,
  traspasoEnviadoId: true,
  traspasoEntranteId: true,
  traspasoRechazadoId: true,
  traspasoPedidoId: true,
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

/** La HUELLA numérica del saldo de S2 (otra sucursal de E1) y de la sucursal de E2 (otra empresa): números que ningún dato normal del mundo produce. */
export const HUELLA_DE_S2 = 7777;
export const HUELLA_DE_E2 = 8888;
/** Los nombres de las sucursales S2 y S3 de E1: llevan marcador para delatar de dónde salió una fila de `Sucursal`. */
export const NOMBRE_DE_S2 = "Sucursal Dos ZZ-S2";
export const NOMBRE_DE_S3 = "Sucursal Tres ZZ-S3";

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
  const mp3 = await producto("mp3", "MP");
  // Con el mismo precio que `pv` en las sucursales (1234): un ítem agrupado solo admite opciones del mismo precio.
  const pv2 = await producto("pv2", "PV", { seProduce: true, precioVenta: 1234 });
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
  const recetaPv2 = await db.recetaVersion.create({ data: { id: id("receta-pv2"), empresaId, productoId: pv2.id, version: 1, sucursalId: null, comentarios: `receta pv2 ${marca}` } });
  await db.recetaIngrediente.create({ data: { id: id("ingrediente-pv2"), empresaId, recetaVersionId: recetaPv2.id, insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id, observaciones: `ingrediente pv2 ${marca}` } });
  // Dos ingredientes: sacar uno solo se rechaza («la receta necesita al menos un ingrediente») y el control positivo de «quitar ingrediente» necesita poder sacar uno.
  await db.recetaIngrediente.create({ data: { id: id("ingrediente-2"), empresaId, recetaVersionId: receta.id, insumoProductoId: mp2.id, cantidad: 1, unidadId: kg.id, observaciones: `ingrediente 2 ${marca}` } });
  await db.recetaPaso.create({ data: { id: id("paso"), empresaId, recetaVersionId: receta.id, orden: 1, nombre: `Paso ${marca}`, instruccion: `Mezclar ${marca}` } });
  await db.registroAuditoria.create({ data: { id: id("auditoria-empresa"), empresaId, entidad: "Producto", entidadId: mp.id, descripcion: `Auditoría de empresa ${marca}`, campo: "nombre", valorAnterior: "a", valorNuevo: "b", actorId: usuarioId } });
  return {
    marca,
    empresaId,
    usuarioId,
    productoId: mp.id,
    productoPvId: pv.id,
    productoMp2Id: mp2.id,
    productoMp3Id: mp3.id,
    productoPv2Id: pv2.id,
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
async function sembrarContenido(marca: string, k: KitDeEmpresa, sucursalId: string, vecinaId: string, miembro: { id: string; rolId: string }, huella = 0): Promise<KitDeSucursal> {
  const db = prismaAdmin;
  const empresaId = k.empresaId;
  const id = (n: string) => `${marca}-${n}`;
  const seccion = await db.seccion.create({ data: { id: id("seccion"), empresaId, sucursalId, nombre: `Sección ${marca}` } });
  const seccion2 = await db.seccion.create({ data: { id: id("seccion-b"), empresaId, sucursalId, nombre: `Sección B ${marca}` } });
  const seccionVecina = await db.seccion.create({ data: { id: id("seccion-vecina"), empresaId, sucursalId: vecinaId, nombre: `Sección vecina de ${marca}` } });
  for (const productoId of [k.productoId, k.productoPvId, k.productoMp2Id, k.productoMp3Id, k.productoPv2Id]) {
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
  await db.ejemplarTicket.create({ data: { id: id("ticket"), empresaId, sucursalId, cuentaId: cuentaCerrada.id, numero: 1, ejemplar: 1, emitidoEn: enElPasado(HORA_MS), emitidoPorId: miembro.id } });
  // El estado que necesita el control positivo de `emitirTicketCorregido` (hallazgo O.177): dos líneas vendidas (una Operacion VENTA por línea, enlazada a su ítem) y UNA de ellas anulada DESPUÉS de emitido el
  // ticket (`Operacion.anuladaEn` posterior al ejemplar): el ticket queda «desactualizada» y queda otra línea vigente (si se anularan todas sería «la venta se anuló entera»). Sin movimientos de stock a
  // propósito: es solo el rastro de la venta de la cuenta, y la venta propia del mundo (`venta`, abajo) sigue siendo la única que el Kardex ve.
  const ventaDelTicket = await db.operacion.create({ data: { id: id("venta-ticket"), empresaId, sucursalId, proceso: "VENTA", fecha: enElPasado(HORA_MS), usuarioId: miembro.id, detalleLibre: `Venta del ticket ${marca}` } });
  const ventaDelTicketAnulada = await db.operacion.create({
    data: { id: id("venta-ticket-anulada"), empresaId, sucursalId, proceso: "VENTA", fecha: enElPasado(HORA_MS), anuladaEn: enElPasado(HORA_MS / 2), usuarioId: miembro.id, detalleLibre: `Venta anulada del ticket ${marca}` },
  });
  await db.cuentaItem.create({ data: { id: id("item-cerrada"), empresaId, cuentaId: cuentaCerrada.id, productoId: k.productoPvId, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1, operacionId: ventaDelTicket.id, creadoPorId: miembro.id } });
  await db.cuentaItem.create({ data: { id: id("item-cerrada-anulado"), empresaId, cuentaId: cuentaCerrada.id, productoId: k.productoPv2Id, cantidad: 1, precioUnitario: 1234, numeroEnvio: 1, operacionId: ventaDelTicketAnulada.id, creadoPorId: miembro.id } });
  // Una cuenta abierta SIN ítems (se puede liberar la mesa) y otra con todo ENVIADO a cocina, ítems y promo (se puede cerrar y se puede anular lo enviado): los controles positivos del POS necesitan estos estados.
  const mesa3 = await db.mesa.create({ data: { id: id("mesa-c"), empresaId, sucursalId, numero: 3 } });
  const cuentaVacia = await db.cuenta.create({ data: { id: id("cuenta-vacia"), empresaId, mesaId: mesa3.id, abiertaPorId: miembro.id, comensales: 1 } });
  const mesa4 = await db.mesa.create({ data: { id: id("mesa-d"), empresaId, sucursalId, numero: 4 } });
  const cuentaEnviada = await db.cuenta.create({ data: { id: id("cuenta-enviada"), empresaId, mesaId: mesa4.id, abiertaPorId: miembro.id, comensales: 1 } });
  const promoCuentaEnviada = await db.promoCuenta.create({ data: { id: id("promocuenta-enviada"), empresaId, cuentaId: cuentaEnviada.id, promoCartaId: k.promoCartaId, precio: 5000, titulo: `Promo enviada ${marca}`, creadoPorId: miembro.id } });
  await db.cuentaItem.create({ data: { id: id("item-de-cuenta-enviada"), empresaId, cuentaId: cuentaEnviada.id, productoId: k.productoPvId, cantidad: 1, precioUnitario: 1000, numeroEnvio: 1, creadoPorId: miembro.id } });
  await db.cuentaItem.create({ data: { id: id("item-promo-enviada"), empresaId, cuentaId: cuentaEnviada.id, productoId: k.productoPvId, cantidad: 1, precioUnitario: 0, numeroEnvio: 1, promoCuentaId: promoCuentaEnviada.id, creadoPorId: miembro.id } });

  // Kardex: una compra con lote (stock +10), una venta (−1) y un conteo pendiente.
  const compra = await db.operacion.create({
    data: { id: id("compra"), empresaId, sucursalId, proceso: "COMPRA", fecha: enElPasado(2 * DIA_MS), proveedorId: k.proveedorId, nroFactura: `F-${marca}`, usuarioId: miembro.id, detalleLibre: `Compra ${marca}` },
  });
  await db.movimientoStock.create({
    data: { id: id("mov-compra"), empresaId, operacionId: compra.id, productoId: k.productoId, seccionId: seccion.id, proceso: "COMPRA", cantidad: 10, loteVencimiento: new Date(Date.now() + 30 * DIA_MS), detalle: `Compra ${marca}`, precioTotal: 1000, precioPorUnidadStock: 100 },
  });
  // Una compra que SÍ se puede anular: de una materia prima que no se consumió ni se movió (la compra principal ya tiene consumos posteriores y «no se puede anular»).
  const compraAnulable = await db.operacion.create({
    data: { id: id("compra-anulable"), empresaId, sucursalId, proceso: "COMPRA", fecha: enElPasado(DIA_MS), proveedorId: k.proveedorId, nroFactura: `F2-${marca}`, usuarioId: miembro.id, detalleLibre: `Compra anulable ${marca}` },
  });
  await db.movimientoStock.create({
    data: { id: id("mov-compra-anulable"), empresaId, operacionId: compraAnulable.id, productoId: k.productoMp3Id, seccionId: seccion2.id, proceso: "COMPRA", cantidad: 4, detalle: `Compra anulable ${marca}`, precioTotal: 400, precioPorUnidadStock: 100 },
  });
  // Los dos conteos de la sección (uno pendiente y uno ya resuelto) se escriben ANTES de la venta: desde I-1 (D7 / S-03) una venta no se anula si hubo un conteo físico del mismo producto y sección
  // escrito DESDE ella (`creadoEn` del conteo >= `creadoEn` de la venta; `gte`, no `gt`), y el control positivo de `anularVenta` necesita que la venta del mundo se pueda anular. Con el reloj congelado de
  // la matriz (`vi.setSystemTime`) dos filas sembradas una tras otra llevan el MISMO `creadoEn`, y `gte` las ve como simultáneas: por eso el `creadoEn` de los conteos se fija explícito, dos días atrás.
  const conteo = await db.conteoFisico.create({
    data: { id: id("conteo"), empresaId, sucursalId, fecha: enElPasado(HORA_MS), creadoEn: enElPasado(2 * DIA_MS), productoId: k.productoId, seccionId: seccion.id, saldoSistema: 9, conteoReal: 8, diferencia: -1, accion: "FALTA_MOVIMIENTO", estado: "PENDIENTE", detalle: `Conteo ${marca}`, usuarioId: miembro.id },
  });
  const conteoResuelto = await db.conteoFisico.create({
    data: { id: id("conteo-resuelto"), empresaId, sucursalId, fecha: enElPasado(HORA_MS), creadoEn: enElPasado(2 * DIA_MS), productoId: k.productoId, seccionId: seccion.id, saldoSistema: 9, conteoReal: 9, diferencia: 0, accion: "FALTA_MOVIMIENTO", estado: "RESUELTO", detalle: `Conteo resuelto ${marca}`, usuarioId: miembro.id },
  });
  const venta = await db.operacion.create({ data: { id: id("venta"), empresaId, sucursalId, proceso: "VENTA", fecha: enElPasado(DIA_MS), usuarioId: miembro.id, clienteId: k.clienteId, detalleLibre: `Venta ${marca}` } });
  await db.movimientoStock.create({
    data: { id: id("mov-venta"), empresaId, operacionId: venta.id, productoId: k.productoId, seccionId: seccion.id, proceso: "VENTA", cantidad: -1, detalle: `Venta ${marca}`, precioTotal: 800, precioPorUnidadStock: 100, costoUnitarioVenta: 100, precioListaUnitario: 1000 },
  });
  // Pérdidas y devoluciones: lo que leen los reportes de merma/consumo y de devoluciones (cada movimiento lleva el marcador en el detalle, el motivo, el destino, el cliente y el proveedor).
  const movimientoSuelto = async (n: string, proceso: "MERMA" | "CONSUMO" | "DEVOLUCION_CLIENTE" | "DEVOLUCION_PROVEEDOR" | "AJUSTE", cantidad: number, extra: object, productoId: string = k.productoId) => {
    const op = await db.operacion.create({ data: { id: id(n), empresaId, sucursalId, proceso, fecha: enElPasado(DIA_MS), usuarioId: miembro.id, detalleLibre: `${proceso} ${marca}`, ...extra } });
    await db.movimientoStock.create({ data: { id: id(`mov-${n}`), empresaId, operacionId: op.id, productoId, seccionId: seccion.id, proceso, cantidad, detalle: `${proceso} ${marca}`, precioTotal: 100, precioPorUnidadStock: 100 } });
  };
  await movimientoSuelto("merma", "MERMA", -1, { motivoId: k.motivoId });
  await movimientoSuelto("consumo", "CONSUMO", -1, { destinoId: k.destinoId });
  await movimientoSuelto("devolucion-cliente", "DEVOLUCION_CLIENTE", 1, { clienteId: k.clienteId });
  await movimientoSuelto("devolucion-proveedor", "DEVOLUCION_PROVEEDOR", -1, { proveedorId: k.proveedorId });
  // La HUELLA numérica: un ajuste de 7777 en S2 (8888 en E2; S1 no lleva) que deja los saldos de la sección en un número inconfundible de la familia 77xx (el total da 7784, el disponible 7774). Una lectura que
  // devuelve solo un número (un saldo, un total) no lleva ningún marcador de texto: sin esta huella, devolver el saldo de la sucursal ajena pasaba por «no filtró nada».
  if (huella > 0) await movimientoSuelto("ajuste-huella", "AJUSTE", huella, {});
  // Un saldo disponible POSITIVO de otra materia prima en la sección (las mutaciones de stock —reclasificar— necesitan saldo para moverlo): +5 sin lote de `mp2`.
  await movimientoSuelto("ajuste-mp2", "AJUSTE", 5, {}, k.productoMp2Id);
  const traspaso =await db.traspasoSucursal.create({
    data: { id: id("traspaso"), empresaId, origenSucursalId: sucursalId, destinoSucursalId: vecinaId, productoId: k.productoId, cantidad: 1, iniciadoPor: "ORIGEN", estado: "SOLICITADA", creadoPorId: miembro.id, detalle: `Traspaso ${marca}` },
  });
  const traspasoEnviado = await db.traspasoSucursal.create({
    data: { id: id("traspaso-enviado"), empresaId, origenSucursalId: sucursalId, destinoSucursalId: vecinaId, productoId: k.productoId, cantidad: 1, seccionOrigenId: seccion.id, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: miembro.id, detalle: `Traspaso enviado ${marca}` },
  });
  // Los dos traspasos con la vecina como contraparte donde ESTA sucursal es el DESTINO: el envío entrante (lo acepta o lo rechaza) y la solicitud que ella misma pidió (la puede cancelar).
  const traspasoEntrante = await db.traspasoSucursal.create({
    data: { id: id("traspaso-entrante"), empresaId, origenSucursalId: vecinaId, destinoSucursalId: sucursalId, productoId: k.productoId, cantidad: 1, seccionOrigenId: seccionVecina.id, iniciadoPor: "ORIGEN", estado: "ENVIADA", creadoPorId: miembro.id, detalle: `Traspaso entrante ${marca}` },
  });
  const traspasoPedido = await db.traspasoSucursal.create({
    data: { id: id("traspaso-pedido"), empresaId, origenSucursalId: vecinaId, destinoSucursalId: sucursalId, productoId: k.productoId, cantidad: 1, iniciadoPor: "DESTINO", estado: "SOLICITADA", creadoPorId: miembro.id, detalle: `Traspaso pedido ${marca}` },
  });
  // Un envío que el destino RECHAZÓ y espera el reingreso del origen (esta sucursal): lo confirma `confirmarReingresoTransferencia`.
  const traspasoRechazado = await db.traspasoSucursal.create({
    data: { id: id("traspaso-rechazado"), empresaId, origenSucursalId: sucursalId, destinoSucursalId: vecinaId, productoId: k.productoId, cantidad: 1, seccionOrigenId: seccion.id, iniciadoPor: "ORIGEN", estado: "RECHAZADA_DESTINO", creadoPorId: miembro.id, detalle: `Traspaso rechazado ${marca}` },
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
  await db.recetaIngrediente.create({ data: { id: id("ingrediente-propio-2"), empresaId, recetaVersionId: recetaPropia.id, insumoProductoId: k.productoMp2Id, cantidad: 1, unidadId: k.unidadId, observaciones: `ingrediente propio 2 ${marca}` } });
  await db.rendimientoLocalIngrediente.create({ data: { id: id("rendimiento"), empresaId, recetaIngredienteId: k.recetaIngredienteId, sucursalId, cantidad: 3, mermaPorcentaje: 5 } });
  const genero = await db.generoCarta.create({ data: { id: id("genero"), empresaId, sucursalId, nombre: `Género ${marca}` } });
  const itemAgrupado = await db.itemAgrupadoCarta.create({ data: { id: id("agrupado"), empresaId, sucursalId, nombre: `Agrupado ${marca}`, seccionCartaId: k.seccionCartaId, generoCartaId: genero.id } });
  const opcion = await db.opcionItemAgrupadoCarta.create({ data: { id: id("opcion"), empresaId, sucursalId, itemAgrupadoCartaId: itemAgrupado.id, productoId: k.productoPvId } });
  await db.contenidoCartaProducto.create({ data: { id: id("contenido"), empresaId, sucursalId, productoId: k.productoMp2Id, visibleEnCarta: true, seccionCartaId: k.seccionCartaId, descripcion: `Contenido ${marca}`, generoCartaId: genero.id } });
  // Contenido de carta del PV (oculto: el control positivo de «mostrar en la carta» lo muestra), posición en el mapa del portal y un tema con una clave válida (un tema vacío no se puede aplicar).
  await db.contenidoCartaProducto.create({ data: { id: id("contenido-pv"), empresaId, sucursalId, productoId: k.productoPvId, visibleEnCarta: false, seccionCartaId: k.seccionCartaId, descripcion: `Contenido PV ${marca}`, generoCartaId: genero.id } });
  await db.sucursalPublica.create({ data: { id: id("publica"), empresaId, sucursalId, slug: id("slug").toLowerCase(), etiqueta: `Etiqueta ${marca}`, publicada: true, posX: 50, posY: 50, posW: 10, posH: 5 } });
  await db.temaCartaSucursal.create({ data: { id: id("tema"), empresaId, sucursalId, valores: { restaurante_nombre: `Restaurante ${marca}` }, aplicarEnCarta: false } });
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
    cuentaCerradaId: cuentaCerrada.id,
    cuentaVaciaId: cuentaVacia.id,
    cuentaEnviadaId: cuentaEnviada.id,
    promoCuentaEnviadaId: promoCuentaEnviada.id,
    cuentaItemId: item.id,
    cuentaItemEnviadoId: itemEnviado.id,
    promoCuentaId: promoCuenta.id,
    compraId: compra.id,
    compraAnulableId: compraAnulable.id,
    ventaId: venta.id,
    conteoId: conteo.id,
    conteoResueltoId: conteoResuelto.id,
    traspasoId: traspaso.id,
    traspasoEnviadoId: traspasoEnviado.id,
    traspasoEntranteId: traspasoEntrante.id,
    traspasoRechazadoId: traspasoRechazado.id,
    traspasoPedidoId: traspasoPedido.id,
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
  const s2 = await prismaAdmin.sucursal.create({ data: { id: "S2-sucursal-dos", empresaId: e1Id, nombre: NOMBRE_DE_S2 } });
  const s3 = await prismaAdmin.sucursal.create({ data: { id: "S3-sucursal-tres", empresaId: e1Id, nombre: NOMBRE_DE_S3 } });
  const u1 = await prismaAdmin.user.create({ data: { id: "u1-actor", email: "u1@e1.test", name: "Actor de E1" } });
  await crearMembresia({ usuarioId: u1.id, sucursalId: s1Id, rolId: rolAdminE1Id });
  const s4 = await prismaAdmin.sucursal.create({ data: { id: "S4-sucursal-cuatro", empresaId: e1Id, nombre: "Sucursal Cuatro" } });
  await crearMembresia({ usuarioId: u1.id, sucursalId: s4.id, rolId: rolAdminE1Id });
  await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: u1.id, empresaId: e1Id } }, data: { rolEmpresa: "gerente" } });
  const miembroS1 = await prismaAdmin.user.create({ data: { id: "ZZ-A1-miembro", email: "zz-a1-miembro@e1.test", name: "Miembro A1" } });
  await miembroDeLaEmpresa(miembroS1.id, e1Id);
  // Para recibir la gerencia hay que ser administrador activo en alguna sucursal: el miembro de S1 (operador allá) es administrador de la sucursal vacía (el control positivo de «traspasar la gerencia»).
  await crearMembresia({ usuarioId: miembroS1.id, sucursalId: s4.id, rolId: rolAdminE1Id });
  const miembroS2 = await prismaAdmin.user.create({ data: { id: "ZZ-S2-miembro", email: "zz-s2-miembro@e1.test", name: "Miembro S2" } });
  await miembroDeLaEmpresa(miembroS2.id, e1Id);
  const sinEmpresa = await prismaAdmin.user.create({ data: { id: "sin-empresa", email: "sin-empresa@dominio.test", name: "Sin empresa" } });

  const e1 = await sembrarEmpresaDeKit("ZZ-A1", e1Id, u1.id);
  const s1 = await sembrarContenido("ZZ-A1", e1, s1Id, s3.id, { id: miembroS1.id, rolId: rolOperadorE1Id });
  // S2 comparte el catálogo de E1 (es de la empresa): su kit de empresa es el de E1, y lo propio de S2 lleva su marca.
  // La sucursal vacía (S4, donde u1 es administrador) tiene UNA receta propia del PV: el origen válido del control positivo de «copiar la receta propia de otra sucursal» (u1 tiene membresía y «Ver» allá).
  await prismaAdmin.recetaSucursal.create({ data: { id: "ZZ-S4-receta-sucursal", empresaId: e1Id, sucursalId: s4.id, productoId: e1.productoPvId, habilitada: true } });
  const recetaS4 = await prismaAdmin.recetaVersion.create({ data: { id: "ZZ-S4-receta-propia", empresaId: e1Id, productoId: e1.productoPvId, version: 1, sucursalId: s4.id, comentarios: "receta propia de la sucursal vacía" } });
  await prismaAdmin.recetaIngrediente.create({ data: { id: "ZZ-S4-ingrediente-propio", empresaId: e1Id, recetaVersionId: recetaS4.id, insumoProductoId: e1.productoId, cantidad: 3, unidadId: e1.unidadId, observaciones: "ingrediente de la sucursal vacía" } });
  const s2Kit = await sembrarContenido("ZZ-S2", e1, s2.id, s3.id, { id: miembroS2.id, rolId: rolOperadorE1Id }, HUELLA_DE_S2);

  // E2: otra empresa, creada con el alta de pruebas (roles, unidades, motivos y su primera sucursal).
  const alta = await crearEmpresa(prismaSinEmpresa, { nombre: "ZZ-E2 Empresa", slug: "zz-e2", zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", emailPrimerAdmin: "zz-e2-gerente@e2.test", nombreSucursal: "ZZ-E2 Central" }, []);
  await activarTodosLosModulos(alta.empresaId);
  const vecinaE2 = await prismaAdmin.sucursal.create({ data: { id: "ZZ-E2-vecina", empresaId: alta.empresaId, nombre: "ZZ-E2 Vecina" } });
  const rolOperadorE2 = await prismaAdmin.rol.findFirstOrThrow({ where: { empresaId: alta.empresaId, clave: "operador" } });
  const miembroE2 = await prismaAdmin.user.create({ data: { id: "ZZ-E2-miembro", email: "zz-e2-miembro@e2.test", name: "Miembro E2" } });
  await miembroDeLaEmpresa(miembroE2.id, alta.empresaId);
  const e2 = await sembrarEmpresaDeKit("ZZ-E2", alta.empresaId, alta.usuarioId);
  const d2 = await sembrarContenido("ZZ-E2", e2, alta.sucursalId, vecinaE2.id, { id: miembroE2.id, rolId: rolOperadorE2.id }, HUELLA_DE_E2);

  // Las vecinas (la contraparte de los traspasos) tienen los productos disponibles: enviar o pedir un producto a una sucursal donde no está activo se rechaza («activalo allá antes de enviar»), y ese rechazo taparía
  // el control positivo de los traspasos.
  for (const [sucursalId, kit] of [[s3.id, e1], [vecinaE2.id, e2]] as const) {
    for (const productoId of [kit.productoId, kit.productoPvId, kit.productoMp2Id, kit.productoMp3Id, kit.productoPv2Id]) {
      await prismaAdmin.disponibilidadProducto.create({ data: { empresaId: kit.empresaId, sucursalId, productoId, disponible: true } });
    }
  }

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
