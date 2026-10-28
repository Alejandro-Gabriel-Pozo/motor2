import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { esChoqueDeIndiceUnico } from "@/core/datos/errores-de-base";
import type { EstadoDeLaBase, PermisosDelActor, ProductoExistente, SucursalDelImportador } from "@/core/features/catalogo/importacion/estado";
import { coincideLaHuella, huellaDeLaImportacion, LARGO_DE_LA_HUELLA_VISIBLE } from "@/core/features/catalogo/importacion/huella";
import { planificarCarta, type PlanDeCarta } from "@/core/features/catalogo/importacion/planificar-carta";
import { planificarProductos, type PlanDeProductos } from "@/core/features/catalogo/importacion/planificar-productos";
import { conteosDeLaImportacion, erroresDeLaImportacion, type ConteosDeLaImportacion } from "@/core/features/catalogo/importacion/resumen";
import { LOCALES_DEL_IMPORTADOR, type AvisoDeImportacion, type CatalogoNormalizado, type ErrorDeImportacion, type LocalDelImportador } from "@/core/features/catalogo/importacion/tipos";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conAlcanceEnSucursal } from "@/server/acceso/alcance";
import { puedeEditarCamposSensiblesDelProducto } from "@/server/acceso/campos-sensibles-de-producto";
import { requierePermiso, requierePermisoDeEmpresa } from "@/server/acceso/gate";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { escribirImportacionDeCatalogoEnTx, type EscriturasDeLaImportacion } from "./escribir-importacion-de-catalogo-en-tx";

/**
 * Caso de uso «importar el catálogo unificado» (docs/diseno-importador-de-catalogo-2026-10-28.md con su ADENDA v2; E1.5). Lo corre SOLO el comando de un solo uso
 * `scripts/importar-catalogo.ts` (decisión D1 del dueño: carga única, sin pantalla), con el actor que arma `server/sesion/contexto-de-comando.ts`. Dos modos:
 *  - C1 VISTA PREVIA: lee y planifica, NO escribe nada; devuelve el plan, los errores, los avisos y la HUELLA (12 caracteres para el dueño). Con errores, «NO CONFIRMABLE».
 *  - C2 CONFIRMAR con la huella vista: recalcula TODO dentro de UNA transacción SERIALIZABLE (gate previo → leer el estado → plan → huella → comparar → escribir → auditar). Si la huella no
 *    es la vista, `VERSION_DESACTUALIZADA` y no escribe nada (I2); con errores, `NO_CONFIRMABLE`; si otro proceso cargó a la vez un código, un nombre o un contenido (P2002), se rechaza todo.
 *
 * GATE (A.6, sin clave nueva, falla cerrado): `alta_producto` y `producto_campos_sensibles` (empresa) y, en CADA una de las 5 sucursales, `producto_disponibilidad` y `carta_contenido_producto`.
 * El alcance se ensancha sucursal por sucursal (`conAlcanceEnSucursal`, forma `GATE_EN_ESA_SUCURSAL`: el gate EN esa sucursal y después el ensanche) solo si la sucursal aprobó LAS DOS claves; nunca
 * `conEscrituraEnLaEmpresa` (nunca «todas»: la lista cerrada de las 5, ADR-028; Oficinas NQNTUR no entra). Al confirmar, si falta una clave en UNA sola sucursal, se rechaza todo y se listan
 * las que faltan. El gate corre en cada llamada, inmediatamente ANTES de abrir la transacción (como el resto de los casos de uso: el alcance de la transacción se fija al abrirla).
 *
 * @contract Vista previa: el plan y su huella, sin escribir. Confirmar: si la huella es la vista y no hay errores, crea los productos (un precio por empresa, sin precios locales), su
 *   disponibilidad en las 5 sucursales y la carta mínima por secciones, con una auditoría por producto y por contenido; si no, no escribe nada.
 * @idempotency Por estado — repetir la confirmación con la misma huella da `VERSION_DESACTUALIZADA` (el estado ya cambió) y una vista previa nueva da todo «sin cambios»: nunca duplica.
 * @transaction conTransaccionSerializable (SERIALIZABLE, con reintento): lectura del estado, plan, huella, escrituras y auditoría, juntas.
 * @sideEffects La auditoría por lotes (`registrarCambioAuditado`) en la misma transacción, desde `escribir-importacion-de-catalogo-en-tx.ts`.
 * @ficha permiso=alta_producto+producto_campos_sensibles transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */

export type ModoDeImportacion = { tipo: "VISTA_PREVIA" } | { tipo: "CONFIRMAR"; huella: string };

export interface EntradaDeImportacion {
  /** SHA-256 (hex) de los bytes del archivo .xlsx. */
  shaDelArchivo: string;
  catalogo: CatalogoNormalizado;
  modo: ModoDeImportacion;
}

export interface InformeDeImportacion {
  huella: string;
  huellaVisible: string;
  confirmable: boolean;
  productos: PlanDeProductos;
  carta: PlanDeCarta;
  errores: readonly ErrorDeImportacion[];
  avisos: readonly AvisoDeImportacion[];
  conteos: ConteosDeLaImportacion;
  /** Las sucursales tal como las leyó (para el reporte). */
  sucursales: Readonly<Partial<Record<LocalDelImportador, SucursalDelImportador>>>;
  /** En la confirmación: lo que escribió. */
  escrituras: EscriturasDeLaImportacion | null;
}

export type CodigoDeImportacion = "SIN_PERMISO" | "NO_CONFIRMABLE" | "VERSION_DESACTUALIZADA" | "CHOQUE_DE_UNICIDAD";
export type ResultadoImportarCatalogo = ResultadoCaso<InformeDeImportacion, CodigoDeImportacion>;

type Actor = ContextoUsuario;

/** Las sucursales de la empresa con el nombre EXACTO de uno de los 5 locales (`Sucursal` no depende del alcance: se leen todas las de la empresa con ese nombre). */
async function leerLasSucursalesDelImportador(db: PrismaClient | Prisma.TransactionClient, empresaId: string): Promise<Partial<Record<LocalDelImportador, SucursalDelImportador>>> {
  const filas = await db.sucursal.findMany({ where: { empresaId, nombre: { in: [...LOCALES_DEL_IMPORTADOR] } }, select: { id: true, nombre: true, activo: true }, orderBy: { id: "asc" } });
  return Object.fromEntries(filas.map((s) => [s.nombre, { id: s.id, nombre: s.nombre, activa: s.activo }]));
}

/**
 * El gate de A.6: las dos claves de empresa y, en cada sucursal, las dos de sucursal (`requierePermiso` EN esa sucursal: membresía, módulo, capacidad y rol allí). El alcance se ensancha a una
 * sucursal (`conAlcanceEnSucursal`, lectura y escritura) SOLO después de que aprobó LAS DOS claves; una sucursal sin una de ellas queda fuera del alcance. Usa el gate y el ensanche
 * directamente (no `permisoYAlcanceEnSucursal` de `con-permiso.ts`, que arrastra la sesión de Next y no carga en el comando con tsx); la forma la vigila
 * `ids-de-sucursal-declaran-a-que-se-atan.test.ts` (`ENSANCHES_POR_DATO_DE_LA_BASE`, forma `GATE_Y_ALCANCE`).
 */
async function gateDelImportador(actor: Actor): Promise<{ ctx: Actor; permisos: PermisosDelActor; faltan: string[] }> {
  const faltan: string[] = [];
  const alta = await requierePermisoDeEmpresa(actor.usuarioId, actor.empresaId, "alta_producto", actor.db);
  if (!alta.ok) faltan.push(`empresa: «alta_producto» (${alta.mensaje})`);
  const camposSensibles = await puedeEditarCamposSensiblesDelProducto(actor);
  if (!camposSensibles) faltan.push("empresa: «producto_campos_sensibles»");
  const sucursales = await leerLasSucursalesDelImportador(actor.db, actor.empresaId);
  const porLocal: Partial<Record<LocalDelImportador, { disponibilidad: boolean; carta: boolean }>> = {};
  let ctx = actor;
  for (const local of LOCALES_DEL_IMPORTADOR) {
    const sucursal = sucursales[local];
    if (!sucursal) {
      faltan.push(`${local}: la sucursal no existe`);
      continue;
    }
    const disponibilidad = await requierePermiso(actor.usuarioId, sucursal.id, "producto_disponibilidad", actor.db);
    const carta = await requierePermiso(actor.usuarioId, sucursal.id, "carta_contenido_producto", actor.db);
    if (!disponibilidad.ok) faltan.push(`${local}: «producto_disponibilidad» (${disponibilidad.mensaje})`);
    if (!carta.ok) faltan.push(`${local}: «carta_contenido_producto» (${carta.mensaje})`);
    porLocal[local] = { disponibilidad: disponibilidad.ok, carta: carta.ok };
    if (disponibilidad.ok && carta.ok) ctx = conAlcanceEnSucursal(ctx, sucursal.id, "LECTURA_Y_ESCRITURA");
  }
  return { ctx, permisos: { altaProducto: alta.ok, camposSensibles, porLocal }, faltan };
}

/** El estado de la base que decide el plan, leído con el `tx` (dentro de la transacción en la confirmación). Solo lo de las 5 sucursales y los productos que tocan el archivo. */
async function leerElEstado(tx: Prisma.TransactionClient, empresaId: string, catalogo: CatalogoNormalizado): Promise<EstadoDeLaBase> {
  const sucursales = await leerLasSucursalesDelImportador(tx, empresaId);
  const ids = Object.values(sucursales).map((s) => s!.id);
  const nombresDeSeccion = [...new Set(Object.values(catalogo.correcciones.mapeoDeSecciones).filter((s): s is string => s !== null))];
  const [unidad, secciones, todos] = await Promise.all([
    tx.unidad.findFirst({ where: { nombre: "unidad" }, select: { id: true } }),
    tx.seccionCarta.findMany({ where: { nombre: { in: nombresDeSeccion } }, select: { id: true, nombre: true, activa: true } }),
    tx.producto.findMany({ select: { id: true, codigo: true, nombre: true, tipo: true, precioVenta: true, modoDeVenta: true, seProduce: true, factorConversion: true, unidadStockId: true } }),
  ]);
  const codigos = new Set(catalogo.productos.map((p) => p.sku));
  const nombres = new Set(catalogo.productos.map((p) => p.nombre.toLowerCase()));
  const relevantes = todos.filter((p) => codigos.has(p.codigo) || nombres.has(p.nombre.toLowerCase()));
  const productoIds = relevantes.map((p) => p.id);
  const enLasCinco = { productoId: { in: productoIds }, sucursalId: { in: ids } };
  // Sin productos del archivo en la base (la primera carga), no hay nada más que leer.
  const hayExistentes = productoIds.length > 0;
  const [disponibles, locales, anclas, deLaCarta] = await Promise.all([
    hayExistentes ? tx.disponibilidadProducto.findMany({ where: enLasCinco, select: { productoId: true, sucursalId: true, disponible: true } }) : [],
    hayExistentes ? tx.precioLocalProducto.findMany({ where: enLasCinco, select: { productoId: true, sucursalId: true, precio: true } }) : [],
    hayExistentes ? tx.opcionDeGrupo.findMany({ where: { productoId: { in: productoIds } }, select: { productoId: true } }) : [],
    // La carta es propia de cada sucursal (C3): se lee sucursal por sucursal, con su filtro.
    Promise.all(
      (hayExistentes ? ids : []).map(async (sucursalId) => ({
        contenidos: await tx.contenidoCartaProducto.findMany({
          where: { ...whereCartaDeSucursal(sucursalId), productoId: { in: productoIds } },
          select: { productoId: true, sucursalId: true, visibleEnCarta: true, seccionCartaId: true, descripcion: true, orden: true, especial: true, tags: true, generoCartaId: true, mostrarNombreArriba: true },
        }),
        agrupados: await tx.opcionItemAgrupadoCarta.findMany({ where: { ...whereCartaDeSucursal(sucursalId), productoId: { in: productoIds } }, select: { productoId: true, sucursalId: true } }),
      })),
    ),
  ]);
  const contenidos = deLaCarta.flatMap((c) => c.contenidos);
  const agrupados = deLaCarta.flatMap((c) => c.agrupados);
  const productos = relevantes.map(
    (p): ProductoExistente => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      tipo: p.tipo,
      precioVenta: p.precioVenta.toFixed(2),
      modoDeVenta: p.modoDeVenta,
      seProduce: p.seProduce,
      factorConversion: p.factorConversion.toString(),
      unidadStockId: p.unidadStockId,
      filasDeDisponibilidad: disponibles.filter((d) => d.productoId === p.id).map((d) => ({ sucursalId: d.sucursalId, disponible: d.disponible })),
      preciosLocales: locales.filter((d) => d.productoId === p.id).map((d) => ({ sucursalId: d.sucursalId, precio: d.precio.toFixed(2) })),
      contenidos: contenidos
        .filter((c) => c.productoId === p.id)
        .map((c) => ({ sucursalId: c.sucursalId, visibleEnCarta: c.visibleEnCarta, seccionCartaId: c.seccionCartaId, descripcion: c.descripcion, orden: c.orden, especial: c.especial, tags: c.tags, generoCartaId: c.generoCartaId, mostrarNombreArriba: c.mostrarNombreArriba })),
      agrupadoEn: agrupados.filter((a) => a.productoId === p.id).map((a) => a.sucursalId),
      esAnclaDeAdicional: anclas.some((a) => a.productoId === p.id),
    }),
  );
  return { sucursales, unidadId: unidad?.id ?? null, secciones, productos };
}

export async function importarCatalogoCasoDeUso(actor: Actor, entrada: EntradaDeImportacion): Promise<ResultadoImportarCatalogo> {
  const { ctx, permisos, faltan } = await gateDelImportador(actor);
  if (entrada.modo.tipo === "CONFIRMAR" && faltan.length > 0) {
    return fracaso("SIN_PERMISO", `No se importó nada: al actor le falta permiso (se exige en las 5 sucursales, falla cerrado): ${faltan.join("; ")}.`);
  }
  const modo = entrada.modo;
  try {
    return await conTransaccionSerializable(ctx.transaccion, async (tx): Promise<ResultadoImportarCatalogo> => {
      const estado = await leerElEstado(tx, ctx.empresaId, entrada.catalogo);
      const productos = planificarProductos(entrada.catalogo, estado, permisos);
      const carta = planificarCarta(entrada.catalogo, productos, estado, permisos);
      const errores = erroresDeLaImportacion(entrada.catalogo, productos, carta);
      const huella = huellaDeLaImportacion({ shaDelArchivo: entrada.shaDelArchivo, correcciones: entrada.catalogo.correcciones, estado });
      const informe: InformeDeImportacion = {
        huella,
        huellaVisible: huella.slice(0, LARGO_DE_LA_HUELLA_VISIBLE),
        confirmable: errores.length === 0,
        productos,
        carta,
        errores,
        avisos: entrada.catalogo.avisos,
        conteos: conteosDeLaImportacion(productos, carta),
        sucursales: estado.sucursales,
        escrituras: null,
      };
      if (modo.tipo === "VISTA_PREVIA") {
        return exito(informe.confirmable ? `Vista previa CONFIRMABLE, huella ${informe.huellaVisible}.` : `Vista previa NO CONFIRMABLE: ${errores.length} error(es).`, informe);
      }
      if (!informe.confirmable) return fracaso("NO_CONFIRMABLE", `No se importó nada: la importación tiene ${errores.length} error(es); corregilos y volvé a mirar la vista previa.`);
      if (!coincideLaHuella(modo.huella, huella)) {
        return fracaso("VERSION_DESACTUALIZADA", `No se importó nada: la base, el archivo o las correcciones cambiaron desde la vista previa (huella ${informe.huellaVisible}, la vista era ${modo.huella.trim().slice(0, LARGO_DE_LA_HUELLA_VISIBLE)}). Volvé a mirar la vista previa.`);
      }
      const escrituras = await escribirImportacionDeCatalogoEnTx(tx, { productos, carta, unidadId: estado.unidadId!, actorId: ctx.usuarioId, huellaVisible: informe.huellaVisible });
      return exito(`Importación confirmada (huella ${informe.huellaVisible}): ${escrituras.productos} productos, ${escrituras.filasDeDisponibilidad} disponibilidades, ${escrituras.contenidos} contenidos de carta, ${escrituras.auditorias} auditorías.`, { ...informe, escrituras });
    });
  } catch (e) {
    if (esChoqueDeIndiceUnico(e)) return fracaso("CHOQUE_DE_UNICIDAD", "No se importó nada: otro proceso cargó estos códigos, nombres o contenidos de carta a la vez. Volvé a mirar la vista previa.");
    throw e;
  }
}
