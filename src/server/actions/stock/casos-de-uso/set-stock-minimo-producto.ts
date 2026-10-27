import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoSetStockMinimo, ResultadoSetStockMinimo } from "@/core/features/stock/stock-minimo.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarMinimoSiSigueComoSeVio, guardarMinimoDeSeccion, guardarMinimoGlobal, leerMinimo } from "@/server/persistencia/stock/stock-minimo";
import { decidirCambioDeMinimo } from "@/core/stock/public";

/**
 * Caso de uso «fijar el stock mínimo de un producto en la sucursal activa, global o de una sección» (port de setStockMinimoProducto_, Catalogo.js:1982-2008; Hito 4
 * de la pureza, bloque C de la pieza carta/catálogo/stock, paso H4C-21 — `docs/plan-hito-4-pureza.md` §3). Es el cuerpo que antes vivía en línea en la Server
 * Action `setStockMinimoProducto` (`src/server/actions/stock/stock-minimo.ts`), con las lecturas TAL CUAL y en el MISMO orden, con la base del contexto: el
 * producto («No se encontró el producto.») y, con sección, que sea de ESTA sucursal («No se encontró la sección.»). Con sección se da de alta o se cambia su fila
 * (`guardarMinimoDeSeccion`); sin sección (`null`, omitida o vacía), la fila GLOBAL de la sucursal (`guardarMinimoGlobal`), que aplica salvo que haya una más
 * específica. La Server Action quedó como adaptador (`conPermiso("stock_minimo")` → `guardComandoSetStockMinimo` → este caso de uso → `aResultadoAccion`).
 *
 * 4.4 (decisión del dueño, 2026-10-07; paso H4C-22, CAMBIA COMPORTAMIENTO): la escritura y su fila de auditoría van en UNA transacción simple (entidad
 * «StockMinimoProducto», `entidadId` el id de la fila, `campo: "minimo"`, del mínimo anterior —`null` si la fila no existía— al nuevo, con la sucursal, y la
 * descripción `Stock mínimo de "<producto>" (global)` o `… en "<sección>"`). Repetir el mismo valor no deja fila. Antes el mínimo no se auditaba (era la excepción
 * «stockMinimoProducto.minimo» de `escrituras-auditadas`, que se quitó).
 *
 * Fase 7 (DEC-27, «Cambiar mínimo»; I8 de `docs/diseno-modulo-stock-2026-10-27.md`, CAMBIA COMPORTAMIENTO solo con `minimoVisto`): si el comando trae el mínimo que la persona VIO, el cambio no pisa en
 * silencio el de otra persona. Dentro de la transacción se lee la fila de ese producto y depósito (`leerMinimo`) y decide `decidirCambioDeMinimo` (core/stock): ya tiene el valor pedido → éxito sin escribir
 * ni auditar (doble clic); no tiene el valor visto (otra persona lo cambió o lo borró) → `MINIMO_CAMBIO` con el valor de hoy, sin escribir; sigue como se vio → `UPDATE … WHERE minimo = visto`
 * (`cambiarMinimoSiSigueComoSeVio`) y, si no cambió ninguna fila (otro ganó entre la lectura y la escritura), se vuelve a leer y a decidir. La auditoría va en la misma transacción. Sin `minimoVisto`, el
 * alta/cambio de siempre (upsert).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del mínimo (el guard).
 *
 * @contract Deja el stock mínimo del producto en la sucursal activa (global o de la sección) y el cambio en la auditoría, salvo que el producto o la sección no existan, o que (con el valor visto) otra persona lo haya cambiado.
 * @idempotency Por estado — repetir el pedido encuentra el mínimo pedido y no escribe (sin duplicar la fila ni dejar otra fila de auditoría); con el valor visto, un cambio ajeno se rechaza (MINIMO_CAMBIO).
 * @transaction Transacción simple (`actor.transaccion`): la escritura y su auditoría juntas. Las lecturas del producto y la sección, antes, con `actor.db`.
 * @sideEffects registrarCambioAuditado (StockMinimoProducto.minimo, del anterior al nuevo).
 * @ficha permiso=stock_minimo transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function setStockMinimoProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId" | "transaccion" | "usuarioId">,
  comando: ComandoSetStockMinimo,
): Promise<ResultadoSetStockMinimo> {
  const { productoId, minimo, seccionId } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

  if (seccionId) {
    const seccion = await actor.db.seccion.findUnique({ where: { id: seccionId } });
    if (!seccion || seccion.sucursalId !== actor.sucursalId) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");
    if (comando.minimoVisto !== undefined) {
      return cambiarConElValorVisto(actor, { productoId, seccionId, minimo, visto: comando.minimoVisto }, `Stock mínimo de "${producto.nombre}" en "${seccion.nombre}"`);
    }

    await actor.transaccion(async (tx) => {
      const escrito = await guardarMinimoDeSeccion(tx, { sucursalId: actor.sucursalId, productoId, seccionId, minimo });
      await registrarCambioAuditado(tx, {
        entidad: "StockMinimoProducto",
        entidadId: escrito.id,
        campo: "minimo",
        descripcion: `Stock mínimo de "${producto.nombre}" en "${seccion.nombre}"`,
        valorAnterior: escrito.anterior,
        valorNuevo: minimo,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    });
    return exito(`Stock mínimo de "${producto.nombre}" en "${seccion.nombre}" actualizado.`, null);
  }

  if (comando.minimoVisto !== undefined) {
    return cambiarConElValorVisto(actor, { productoId, seccionId: null, minimo, visto: comando.minimoVisto }, `Stock mínimo de "${producto.nombre}" (global)`);
  }
  await actor.transaccion(async (tx) => {
    const escrito = await guardarMinimoGlobal(tx, { sucursalId: actor.sucursalId, productoId, minimo });
    await registrarCambioAuditado(tx, {
      entidad: "StockMinimoProducto",
      entidadId: escrito.id,
      campo: "minimo",
      descripcion: `Stock mínimo de "${producto.nombre}" (global)`,
      valorAnterior: escrito.anterior,
      valorNuevo: minimo,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
  });
  return exito(`Stock mínimo (global) de "${producto.nombre}" actualizado.`, null);
}

/** Cómo se lee un mínimo en un mensaje: «12» o «1,5» (es-AR), o «sin cargar» si la fila ya no existe. */
const textoDelMinimo = (valor: number | null) => (valor === null ? "sin cargar" : valor.toLocaleString("es-AR", { maximumFractionDigits: 4 }));

type ResultadoDelCambio = { tipo: "CAMBIADO" | "SIN_CAMBIO" } | { tipo: "CAMBIO_AJENO"; actual: number | null };

/** «Cambiar mínimo» con el valor visto (ver el comentario de arriba): una transacción simple con la lectura, la decisión, el `UPDATE` condicionado y la auditoría. */
async function cambiarConElValorVisto(
  actor: Pick<ContextoUsuario, "sucursalId" | "transaccion" | "usuarioId">,
  pedido: { productoId: string; seccionId: string | null; minimo: number; visto: number },
  descripcion: string,
): Promise<ResultadoSetStockMinimo> {
  const resultado = await actor.transaccion(async (tx): Promise<ResultadoDelCambio> => {
    const clave = { sucursalId: actor.sucursalId, productoId: pedido.productoId, seccionId: pedido.seccionId };
    const decidir = async (): Promise<ResultadoDelCambio | { tipo: "CAMBIAR"; id: string; anterior: number }> => {
      const fila = await leerMinimo(tx, clave);
      const decision = decidirCambioDeMinimo({ actual: fila?.minimo ?? null, visto: pedido.visto, nuevo: pedido.minimo });
      if (decision === "SIN_CAMBIO") return { tipo: "SIN_CAMBIO" };
      if (decision === "CAMBIO_AJENO" || !fila) return { tipo: "CAMBIO_AJENO", actual: fila?.minimo ?? null };
      return { tipo: "CAMBIAR", id: fila.id, anterior: fila.minimo };
    };
    const primera = await decidir();
    if (primera.tipo !== "CAMBIAR") return primera;
    // El UPDATE vuelve a exigir el valor visto: si otro ganó entre la lectura y la escritura, no cambia nada y se decide otra vez con lo que dejó el otro.
    if ((await cambiarMinimoSiSigueComoSeVio(tx, { id: primera.id, visto: pedido.visto, minimo: pedido.minimo })) === 0) {
      const segunda = await decidir();
      return segunda.tipo === "CAMBIAR" ? { tipo: "CAMBIO_AJENO", actual: segunda.anterior } : segunda;
    }
    await registrarCambioAuditado(tx, {
      entidad: "StockMinimoProducto",
      entidadId: primera.id,
      campo: "minimo",
      descripcion,
      valorAnterior: primera.anterior,
      valorNuevo: pedido.minimo,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return { tipo: "CAMBIADO" };
  });
  if (resultado.tipo === "CAMBIO_AJENO") {
    return fracaso(
      "MINIMO_CAMBIO",
      `${descripcion} cambió mientras lo editabas: ahora es ${textoDelMinimo(resultado.actual)}. No se guardó nada: revisalo y volvé a guardar.`,
    );
  }
  return exito(`${descripcion} actualizado: ${textoDelMinimo(pedido.minimo)}.`, null);
}
