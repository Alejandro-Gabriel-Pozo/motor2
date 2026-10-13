import { randomUUID } from "node:crypto";
import { sentenciaDeInsercion } from "./centros-de-costos";
import { sembrarEscenarioDeFactura, type EscenarioDeFactura } from "./factura-proveedor";
import { prisma } from "./test-db";

/**
 * Ayudas de los tests de los GRUPOS DE OPCIONES DE VENTA (GO-1, el «elemento configurable»): el escenario de siempre (empresa con dos sucursales, un usuario y un producto) más un catálogo de CAFÉ
 * (una MEDIDA con tres tamaños, una VARIANTE, una INCLUIDA y un ADICIONAL con su producto ancla) con la versión 1 de cada opción, y las sentencias `pg` de cada tabla del catálogo (para escribir como `motor2_app`,
 * sujeto a la RLS, o como dueño). Las usan `migracion-grupos-de-opciones`, `migracion-opciones-por-sucursal`, `migracion-linea-con-opciones`, `opciones-rls`, `opciones-concurrencia` y `opciones-dinero`. Más una mesa con su cuenta por sucursal y las ayudas de la línea con opciones (el padre con su huella, el adicional que cuelga de él y la foto de lo elegido).
 */

export interface EscenarioDeOpciones extends EscenarioDeFactura {
  /** La unidad de stock de todos los productos del escenario. */
  unidadId: string;
  /** El producto de venta «Café» (el que admite los grupos). */
  cafeId: string;
  /** Un insumo (materia prima) que consumen las opciones. */
  lecheId: string;
  /** El insumo que REEMPLAZA a la leche en la opción «Almendras». */
  almendrasInsumoId: string;
  /** El producto ANCLA del adicional «Shot extra». */
  anclaDelShotId: string;
  grupoMedidaId: string;
  chicoId: string;
  medianoId: string;
  grandeId: string;
  grupoVarianteId: string;
  vacaId: string;
  almendrasId: string;
  grupoIncluidaId: string;
  azucarId: string;
  grupoAdicionalId: string;
  shotId: string;
  /** Las versiones 1 de cada opción, por opción. */
  versionDe: Readonly<Record<string, string>>;
  /** Una mesa por sucursal, con su cuenta abierta. La sucursal A tiene además una segunda mesa con su cuenta (`cuentaAOtraId`): una mesa admite una sola cuenta abierta. */
  mesaAId: string;
  mesaBId: string;
  cuentaAId: string;
  cuentaAOtraId: string;
  cuentaBId: string;
}

/**
 * Un catálogo de café: MEDIDA «Tamaño» (Chico -50,00 con factor 0,5; Mediano 0,00; Grande 100,00 con factor 1,5), VARIANTE «Leche» (De vaca 0,00; Almendras 150,00, que reemplaza a la leche), INCLUIDA «Viene con» (Azúcar 0,00)
 * y ADICIONAL «Extras» (Shot extra 200,00, respaldado por un producto ancla). Cada opción lleva su versión 1 y el café admite los cuatro grupos y todas las opciones.
 */
export async function sembrarEscenarioDeOpciones(): Promise<EscenarioDeOpciones> {
  const e = await sembrarEscenarioDeFactura();
  const unidadId = (await prisma.producto.findUniqueOrThrow({ where: { id: e.productoId } })).unidadStockId;
  const producto = async (codigo: string, nombre: string, tipo: "MP" | "PV", precioVenta = "0.00") =>
    (await prisma.producto.create({ data: { codigo, nombre, tipo, unidadStockId: unidadId, precioVenta } })).id;
  const cafeId = await producto("PV_CAFE", "Café", "PV", "1000.00");
  const lecheId = await producto("MP_LECHE", "Leche", "MP");
  const almendrasInsumoId = await producto("MP_ALMENDRAS", "Bebida de almendras", "MP");
  const anclaDelShotId = await producto("PV_SHOT", "Shot extra (ancla)", "PV");

  const grupo = async (nombre: string, tipo: string, cantidadMinima: number, cantidadMaxima: number) => (await prisma.grupoDeOpciones.create({ data: { nombre, tipo, cantidadMinima, cantidadMaxima } })).id;
  const grupoMedidaId = await grupo("Tamaño", "MEDIDA", 1, 1);
  const grupoVarianteId = await grupo("Leche", "VARIANTE", 0, 1);
  const grupoIncluidaId = await grupo("Viene con", "INCLUIDA", 1, 1);
  const grupoAdicionalId = await grupo("Extras", "ADICIONAL", 0, 3);

  const opcion = async (grupoId: string, nombre: string, orden: number, extra: { esNinguna?: boolean; productoId?: string } = {}) =>
    (await prisma.opcionDeGrupo.create({ data: { grupoId, nombre, orden, ...extra } })).id;
  const chicoId = await opcion(grupoMedidaId, "Chico", 1);
  const medianoId = await opcion(grupoMedidaId, "Mediano", 2);
  const grandeId = await opcion(grupoMedidaId, "Grande", 3);
  const vacaId = await opcion(grupoVarianteId, "De vaca", 1);
  const almendrasId = await opcion(grupoVarianteId, "Almendras", 2);
  const azucarId = await opcion(grupoIncluidaId, "Azúcar", 1);
  const shotId = await opcion(grupoAdicionalId, "Shot extra", 1, { productoId: anclaDelShotId });

  const versionDe: Record<string, string> = {};
  const version = async (opcionId: string, diferenciaPrecio: string, factorEscala: string | null = null) => {
    versionDe[opcionId] = (await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio, factorEscala, creadoPorId: e.usuarioId } })).id;
  };
  await version(chicoId, "-50.00", "0.5000");
  await version(medianoId, "0.00", "1.0000");
  await version(grandeId, "100.00", "1.5000");
  await version(vacaId, "0.00");
  await version(almendrasId, "150.00");
  await version(azucarId, "0.00");
  await version(shotId, "200.00");
  await prisma.consumoDeOpcion.create({
    data: { versionDeOpcionId: versionDe[almendrasId]!, efecto: "REEMPLAZA", insumoProductoId: almendrasInsumoId, reemplazaAProductoId: lecheId, cantidad: "0.2000", unidadId },
  });

  for (const [orden, grupoId] of [grupoMedidaId, grupoVarianteId, grupoIncluidaId, grupoAdicionalId].entries()) {
    await prisma.productoAdmiteGrupo.create({ data: { productoId: cafeId, grupoId, orden } });
  }
  for (const opcionId of [chicoId, medianoId, grandeId, vacaId, almendrasId, azucarId, shotId]) {
    await prisma.productoAdmiteOpcion.create({ data: { productoId: cafeId, opcionId } });
  }

  const mesaAId = (await prisma.mesa.create({ data: { sucursalId: e.sucursalA, numero: 1 } })).id;
  const mesaBId = (await prisma.mesa.create({ data: { sucursalId: e.sucursalB, numero: 1 } })).id;
  const cuenta = async (mesaId: string) => (await prisma.cuenta.create({ data: { mesaId, abiertaPorId: e.usuarioId } })).id;
  const cuentaAId = await cuenta(mesaAId);
  const mesaAOtraId = (await prisma.mesa.create({ data: { sucursalId: e.sucursalA, numero: 2 } })).id;
  const cuentaAOtraId = await cuenta(mesaAOtraId);
  const cuentaBId = await cuenta(mesaBId);

  return { ...e, mesaAId, mesaBId, cuentaAId, cuentaAOtraId, cuentaBId, unidadId, cafeId, lecheId, almendrasInsumoId, anclaDelShotId, grupoMedidaId, chicoId, medianoId, grandeId, grupoVarianteId, vacaId, almendrasId, grupoIncluidaId, azucarId, grupoAdicionalId, shotId, versionDe };
}

interface SentenciaPg {
  texto: string;
  params: unknown[];
}

/** Un grupo válido (VARIANTE, 0 a 1) para un cliente `pg`. `extra` pisa o agrega columnas (por ejemplo `empresaId`). */
export function sentenciaDeGrupo(extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), nombre: `Grupo ${randomUUID().slice(0, 8)}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("GrupoDeOpciones", datos) };
}

/** Una opción válida de un grupo para un cliente `pg`. */
export function sentenciaDeOpcion(e: { grupoId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), grupoId: e.grupoId, nombre: `Opción ${randomUUID().slice(0, 8)}`, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("OpcionDeGrupo", datos) };
}

/** Una versión válida (MONTO 10,00) de una opción para un cliente `pg`. */
export function sentenciaDeVersionDeOpcion(e: { opcionId: string; usuarioId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), opcionId: e.opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "10.00", creadoPorId: e.usuarioId, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("VersionDeOpcion", datos) };
}

/** Un consumo válido (SUMA de 1 unidad) de una versión para un cliente `pg`. */
export function sentenciaDeConsumo(e: { versionDeOpcionId: string; insumoProductoId: string; unidadId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("ConsumoDeOpcion", { id: randomUUID(), versionDeOpcionId: e.versionDeOpcionId, efecto: "SUMA", insumoProductoId: e.insumoProductoId, cantidad: "1.0000", unidadId: e.unidadId, ...extra });
}

/** Qué grupo admite un producto, para un cliente `pg`. */
export function sentenciaDeAdmiteGrupo(e: { productoId: string; grupoId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("ProductoAdmiteGrupo", { id: randomUUID(), productoId: e.productoId, grupoId: e.grupoId, ...extra });
}

/** Qué opción admite un producto, para un cliente `pg`. */
export function sentenciaDeAdmiteOpcion(e: { productoId: string; opcionId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("ProductoAdmiteOpcion", { id: randomUUID(), productoId: e.productoId, opcionId: e.opcionId, ...extra });
}

/** El precio de una opción de un producto en una sucursal (120,00 por defecto) para un cliente `pg`. */
export function sentenciaDePrecioLocal(e: { sucursalId: string; productoId: string; opcionId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("PrecioLocalDeOpcion", { id: randomUUID(), sucursalId: e.sucursalId, productoId: e.productoId, opcionId: e.opcionId, precio: "120.00", ...extra });
}

/** Una opción apagada en una sucursal para un cliente `pg`. */
export function sentenciaDeApagado(e: { sucursalId: string; opcionId: string; usuarioId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("OpcionApagadaEnSucursal", { id: randomUUID(), sucursalId: e.sucursalId, opcionId: e.opcionId, apagada: true, actualizadoPorId: e.usuarioId, ...extra });
}

/** Una huella válida (64 caracteres hexadecimales en minúscula) para sembrar una línea con opciones. */
export const HUELLA_DE_PRUEBA = "0123456789abcdef".repeat(4);

/** Una línea del café con opciones (la padre): con huella, 1 unidad a 1000,00. Se siembra como dueño de pruebas (sin RLS). */
export async function sembrarLineaConOpciones(cuentaId: string, e: Pick<EscenarioDeOpciones, "cafeId" | "usuarioId">, extra: Record<string, unknown> = {}) {
  return prisma.cuentaItem.create({
    data: { cuentaId, productoId: e.cafeId, cantidad: 1, precioUnitario: "1000.00", creadoPorId: e.usuarioId, huellaOpciones: HUELLA_DE_PRUEBA, ...extra } as never,
  });
}

/** El adicional «Shot extra» colgado de una línea padre: su producto es el ancla de la opción, 1 unidad a 200,00, sin huella. */
export async function sembrarAdicional(cuentaId: string, lineaPadreId: string, e: Pick<EscenarioDeOpciones, "anclaDelShotId" | "usuarioId">, extra: Record<string, unknown> = {}) {
  return prisma.cuentaItem.create({
    data: { cuentaId, productoId: e.anclaDelShotId, cantidad: 1, precioUnitario: "200.00", creadoPorId: e.usuarioId, lineaPadreId, ...extra } as never,
  });
}

/** Un INSERT de una línea para un cliente `pg` (1 unidad a 1000,00 del café por defecto). `extra` pisa o agrega columnas (por ejemplo `empresaId`, `huellaOpciones`, `lineaPadreId`). */
export function sentenciaDeLinea(e: { cuentaId: string; productoId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), cuentaId: e.cuentaId, productoId: e.productoId, cantidad: 1, precioUnitario: "1000.00", ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("CuentaItem", datos) };
}

/** Un INSERT de la foto de una opción elegida para un cliente `pg`: por defecto la VARIANTE «De vaca» sin diferencia (importe 0,00). `extra` pisa o agrega columnas. */
export function sentenciaDeFoto(e: Pick<EscenarioDeOpciones, "grupoVarianteId" | "vacaId" | "versionDe"> & { cuentaItemId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = {
    id: randomUUID(),
    cuentaItemId: e.cuentaItemId,
    grupoId: e.grupoVarianteId,
    opcionId: e.vacaId,
    versionDeOpcionId: e.versionDe[e.vacaId]!,
    tipoGrupo: "VARIANTE",
    nombreGrupo: "Leche",
    nombreOpcion: "De vaca",
    importeUnitario: "0.00",
    ...extra,
  };
  return { id: datos.id as string, ...sentenciaDeInsercion("OpcionElegidaEnLinea", datos) };
}

// GO-3 (ADR-032): combos y menú del día. El escenario de las opciones más una sección de carta, una promo de la empresa con un cupo de SECCIÓN (el de siempre), un cupo LISTA
// («Entrada») y un cupo DEL_DIA («Plato del día»), y un producto de venta más («Milanesa»). Lo usan `migracion-go3d` y `paquete-go3-subir-bajar-subir`.

export interface EscenarioDeCombos extends EscenarioDeOpciones {
  seccionCartaId: string;
  promoId: string;
  cupoSeccionId: string;
  cupoListaId: string;
  cupoDelDiaId: string;
  milanesaId: string;
}

export async function sembrarEscenarioDeCombos(): Promise<EscenarioDeCombos> {
  const e = await sembrarEscenarioDeOpciones();
  const seccionCartaId = (await prisma.seccionCarta.create({ data: { nombre: "Menú" } })).id;
  const promoId = (await prisma.promoCarta.create({ data: { seccionCartaId, titulo: "Menú del día", precio: "9500.00" } })).id;
  const cupo = async (data: Record<string, unknown>) => (await prisma.promoCartaCupo.create({ data: { promoCartaId: promoId, cantidadMinima: 1, cantidadMaxima: 1, ...data } as never })).id;
  const cupoSeccionId = await cupo({ seccionCartaId, orden: 1 });
  const cupoListaId = await cupo({ tipo: "LISTA", nombre: "Entrada", orden: 2 });
  const cupoDelDiaId = await cupo({ tipo: "DEL_DIA", nombre: "Plato del día", orden: 3 });
  const milanesaId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa con puré", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "8000.00" } })).id;
  return { ...e, seccionCartaId, promoId, cupoSeccionId, cupoListaId, cupoDelDiaId, milanesaId };
}

/** Un cupo de una promo para un cliente `pg` (LISTA «Postre» por defecto). */
export function sentenciaDeCupo(e: { promoId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), promoCartaId: e.promoId, tipo: "LISTA", nombre: `Postre ${randomUUID().slice(0, 8)}`, cantidadMinima: 1, cantidadMaxima: 1, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("PromoCartaCupo", datos) };
}

/** Una entrada de un cupo LISTA para un cliente `pg` (el café sin configuración por defecto). */
export function sentenciaDeEntrada(e: { cupoId: string; productoId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), cupoId: e.cupoId, productoId: e.productoId, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("EntradaDeCupo", datos) };
}

/** Una opción de la configuración fija de una entrada para un cliente `pg`. */
export function sentenciaDeOpcionDeEntrada(e: { entradaId: string; opcionId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), entradaId: e.entradaId, opcionId: e.opcionId, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("OpcionDeEntradaDeCupo", datos) };
}

/** Un plato del día de un cupo DEL_DIA en una sucursal y una fecha («AAAA-MM-DD») para un cliente `pg`. */
export function sentenciaDePlatoDelDia(e: { cupoId: string; sucursalId: string; productoId: string; usuarioId: string; fecha: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), cupoId: e.cupoId, sucursalId: e.sucursalId, fecha: e.fecha, productoId: e.productoId, actualizadoPorId: e.usuarioId, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("EntradaDelDiaDeCupo", datos) };
}

// GO-3 (ADR-032): las sentencias `pg` de las combinaciones (GO-3a). Las usan `migracion-go3a` y `paquete-go3-subir-bajar-subir`.

/** Un grupo de precio (la tarifa compartida, 3300,00 por defecto) para un cliente `pg`. */
export function sentenciaDeGrupoDePrecio(extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), nombre: `Tarifa ${randomUUID().slice(0, 8)}`, precio: "3300.00", ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("GrupoDePrecio", datos) };
}

/** Una combinación de un producto (eje 1 y, si se pide, eje 2), sin precio por defecto, para un cliente `pg`. */
export function sentenciaDeCombinacion(e: { productoId: string; opcionEje1Id: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), productoId: e.productoId, opcionEje1Id: e.opcionEje1Id, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("CombinacionDeProducto", datos) };
}

/** El precio local de una combinación o de un grupo (4000,00 por defecto) para un cliente `pg`: `extra` lleva `combinacionId` o `grupoDePrecioId`. */
export function sentenciaDePrecioLocalDeCombinacion(e: { sucursalId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), sucursalId: e.sucursalId, precio: "4000.00", ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("PrecioLocalDeCombinacion", datos) };
}

/** Una versión de la receta propia de una combinación (número 1 por defecto) para un cliente `pg`. */
export function sentenciaDeRecetaDeCombinacion(e: { combinacionId: string; usuarioId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), combinacionId: e.combinacionId, numero: 1, creadoPorId: e.usuarioId, ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("RecetaDeCombinacionVersion", datos) };
}

/** Un ingrediente de una versión de receta de combinación (0,0360 por defecto) para un cliente `pg`. */
export function sentenciaDeIngredienteDeCombinacion(e: { versionId: string; insumoProductoId: string; unidadId: string }, extra: Record<string, unknown> = {}): SentenciaPg {
  return sentenciaDeInsercion("RecetaDeCombinacionIngrediente", { id: randomUUID(), versionId: e.versionId, insumoProductoId: e.insumoProductoId, cantidad: "0.0360", unidadId: e.unidadId, ...extra });
}

/** La foto de la combinación vendida en una línea (ADITIVO por defecto) para un cliente `pg`. */
export function sentenciaDeCombinacionEnLinea(e: { cuentaItemId: string; combinacionId: string }, extra: Record<string, unknown> = {}): SentenciaPg & { id: string } {
  const datos: Record<string, unknown> = { id: randomUUID(), cuentaItemId: e.cuentaItemId, combinacionId: e.combinacionId, origenPrecio: "ADITIVO", ...extra };
  return { id: datos.id as string, ...sentenciaDeInsercion("CombinacionEnLinea", datos) };
}
