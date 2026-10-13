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

// GO-2b (la venta con opciones): el café del SALÓN, sembrado directo (todavía no existe la administración del catálogo, GO-2a) sobre el escenario de
// `test/pos/salon-fixture.ts`, para los tests de agregar ítems, enviar, cerrar, anular, el ticket y los reportes.

/** Lo que `sembrarCafeDelSalon` deja sembrado. Los nombres de las opciones van con su id y su versión 1. */
export interface CafeDelSalon {
  cafeId: string;
  lecheId: string;
  almendrasInsumoId: string;
  granoId: string;
  anclaDelShotId: string;
  grupoMedidaId: string;
  chicoId: string;
  medianoId: string;
  grandeId: string;
  grupoLecheId: string;
  vacaId: string;
  almendrasId: string;
  grupoExtrasId: string;
  shotId: string;
  /** La versión 1 de cada opción. */
  versionDe: Readonly<Record<string, string>>;
}

/**
 * Un «Café» (PV, 1000,00, disponible en la sucursal, con receta: 0,2 kg de Leche) que admite: MEDIDA «Tamaño» en DIFERENCIA (Chico -50,00 factor 0,5;
 * Mediano 0,00 factor 1; Grande +100,00 factor 1,5), VARIANTE «Leche» 0..1 (De vaca 0,00; Almendras +150,00 que REEMPLAZA la leche por 0,2 kg de bebida de
 * almendras) y ADICIONAL «Extras» 0..3 (Shot extra +200,00, respaldado por un producto ANCLA sin disponibilidad, que SUMA 0,01 kg de café en grano; tope 3 por
 * café). Las materias primas están disponibles en la sucursal. `extra.modoPrecioMedida` cambia el modo de la medida (por ejemplo ABSOLUTO, con
 * `precioAbsoluto` en cada medida del producto).
 */
export async function sembrarCafeDelSalon(
  s: { sucursalId: string; unidad: { id: string }; kg: { id: string }; admin: { id: string } },
  extra: { modoPrecioMedida?: "ABSOLUTO" | "DIFERENCIA" | null; precioAbsoluto?: Partial<Record<"chico" | "mediano" | "grande", string>> } = {}
): Promise<CafeDelSalon> {
  const mp = async (codigo: string, nombre: string) => {
    const insumo = await prisma.insumo.create({ data: { nombre } });
    const producto = await prisma.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: s.kg.id, insumoId: insumo.id } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: producto.id, disponible: true } });
    return producto.id;
  };
  const lecheId = await mp("MP_LECHE", "Leche");
  const almendrasInsumoId = await mp("MP_ALMENDRAS", "Bebida de almendras");
  const granoId = await mp("MP_GRANO", "Café en grano");
  const cafe = await prisma.producto.create({ data: { codigo: "PV_CAFE", nombre: "Café", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "1000.00" } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: cafe.id, disponible: true } });
  await prisma.recetaVersion.create({ data: { productoId: cafe.id, version: 1, ingredientes: { create: [{ insumoProductoId: lecheId, cantidad: 0.2, unidadId: s.kg.id, mermaPorcentaje: 0 }] } } });
  const anclaDelShotId = (await prisma.producto.create({ data: { codigo: "PV_SHOT", nombre: "Shot extra", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "0.00" } })).id;

  const grupo = async (nombre: string, tipo: string, cantidadMinima: number, cantidadMaxima: number) => (await prisma.grupoDeOpciones.create({ data: { nombre, tipo, cantidadMinima, cantidadMaxima } })).id;
  const grupoMedidaId = await grupo("Tamaño", "MEDIDA", 1, 1);
  const grupoLecheId = await grupo("Leche", "VARIANTE", 0, 1);
  const grupoExtrasId = await grupo("Extras", "ADICIONAL", 0, 3);
  const opcion = async (grupoId: string, nombre: string, orden: number, productoId?: string) => (await prisma.opcionDeGrupo.create({ data: { grupoId, nombre, orden, ...(productoId ? { productoId } : {}) } })).id;
  const chicoId = await opcion(grupoMedidaId, "Chico", 1);
  const medianoId = await opcion(grupoMedidaId, "Mediano", 2);
  const grandeId = await opcion(grupoMedidaId, "Grande", 3);
  const vacaId = await opcion(grupoLecheId, "De vaca", 1);
  const almendrasId = await opcion(grupoLecheId, "Almendras", 2);
  const shotId = await opcion(grupoExtrasId, "Shot extra", 1, anclaDelShotId);

  const versionDe: Record<string, string> = {};
  const version = async (opcionId: string, diferenciaPrecio: string, factorEscala: string | null = null) => {
    versionDe[opcionId] = (await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio, factorEscala, creadoPorId: s.admin.id } })).id;
  };
  await version(chicoId, "-50.00", "0.5000");
  await version(medianoId, "0.00", "1.0000");
  await version(grandeId, "100.00", "1.5000");
  await version(vacaId, "0.00");
  await version(almendrasId, "150.00");
  await version(shotId, "200.00");
  await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: versionDe[almendrasId]!, efecto: "REEMPLAZA", insumoProductoId: almendrasInsumoId, reemplazaAProductoId: lecheId, cantidad: "0.2000", unidadId: s.kg.id } });
  await prisma.consumoDeOpcion.create({ data: { versionDeOpcionId: versionDe[shotId]!, efecto: "SUMA", insumoProductoId: granoId, cantidad: "0.0100", unidadId: s.kg.id } });

  const modoPrecio = extra.modoPrecioMedida === undefined ? "DIFERENCIA" : extra.modoPrecioMedida;
  for (const [orden, grupoId] of [grupoMedidaId, grupoLecheId, grupoExtrasId].entries()) {
    await prisma.productoAdmiteGrupo.create({ data: { productoId: cafe.id, grupoId, orden, ...(grupoId === grupoMedidaId ? { modoPrecio } : {}) } });
  }
  const absoluto = extra.precioAbsoluto ?? {};
  for (const [clave, opcionId] of [["chico", chicoId], ["mediano", medianoId], ["grande", grandeId]] as const) {
    await prisma.productoAdmiteOpcion.create({ data: { productoId: cafe.id, opcionId, ...(absoluto[clave] ? { precioAbsoluto: absoluto[clave] } : {}) } });
  }
  for (const opcionId of [vacaId, almendrasId]) await prisma.productoAdmiteOpcion.create({ data: { productoId: cafe.id, opcionId } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: cafe.id, opcionId: shotId, cantidadMaxima: 3 } });

  return { cafeId: cafe.id, lecheId, almendrasInsumoId, granoId, anclaDelShotId, grupoMedidaId, chicoId, medianoId, grandeId, grupoLecheId, vacaId, almendrasId, grupoExtrasId, shotId, versionDe };
}

/** Una opción elegida tal como la manda la pantalla: con la versión que vio el mozo (la 1, salvo que se pase otra). */
export function elegida(c: Pick<CafeDelSalon, "versionDe">, opcionId: string, cantidad = 1, versionDeOpcionId?: string) {
  return { opcionId, cantidad, versionDeOpcionId: versionDeOpcionId ?? c.versionDe[opcionId]! };
}

/** GO-2b: un SEGUNDO adicional («Crema», +150,00, con su propio producto ancla y sin consumo) en el grupo «Extras» del café de `sembrarCafeDelSalon`. */
export async function sembrarCremaDelCafe(s: { unidad: { id: string }; admin: { id: string } }, c: Pick<CafeDelSalon, "cafeId" | "grupoExtrasId">) {
  const anclaId = (await prisma.producto.create({ data: { codigo: "PV_CREMA", nombre: "Crema", tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "0.00" } })).id;
  const cremaId = (await prisma.opcionDeGrupo.create({ data: { grupoId: c.grupoExtrasId, nombre: "Crema", orden: 2, productoId: anclaId } })).id;
  const versionId = (await prisma.versionDeOpcion.create({ data: { opcionId: cremaId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "150.00", creadoPorId: s.admin.id } })).id;
  await prisma.productoAdmiteOpcion.create({ data: { productoId: c.cafeId, opcionId: cremaId, cantidadMaxima: 2 } });
  return { anclaId, cremaId, versionId };
}
