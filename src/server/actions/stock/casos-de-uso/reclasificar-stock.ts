import "server-only";
import type { Prisma } from "@prisma/client";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { texto } from "@/core/texto";
import { validarCantidad } from "@/core/datos/cantidad";
import { conTransaccionSerializable, calcularPayloadHash, MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/core/movimientos/public-servidor";
import { calcularSaldoPorLote, obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { chequearIdempotencia, registrarResultadoIdempotente } from "@/server/persistencia/movimientos/idempotencia";
import { productoDisponibleEn } from "@/server/lecturas/catalogo/disponibilidad";
import { exito, fracaso } from "@/core/resultado-caso";
import type { ComandoReclasificarStock, ResultadoReclasificarStock } from "@/core/features/movimientos/reclasificacion.schema";
import { cargarProductoConUnidadDeStock } from "@/server/persistencia/movimientos/cargar-producto-con-unidad-de-stock";
import { escribirOperacionDeStock, escribirLineasDeMovimientoStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";

/**
 * Caso de uso «reclasificar stock» — port de dividirClasificacionStock_ (Stock.js:1899-1991, wrapper público reclasificarStock, Task #41,
 * Fase M, M13d — docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que antes vivía en línea en la Server Action
 * `reclasificarStock` (src/server/actions/stock/reclasificacion.ts), en el MISMO orden y con los MISMOS textos; la Server Action quedó
 * como adaptador fino (permiso → guard de comando → este caso de uso → `aResultadoAccion`).
 *
 * Caso de uso PROPIO, no el motor genérico de M13a-c: entrada (un producto, un origen, N destinos), permiso (`stock_reclasificar`, propio
 * y no pasa por `ACCION_POR_PROCESO`), validación (la regla "la suma de destinos es
 * exactamente el saldo disponible", sin equivalente en `registrarMovimiento`) y escritura (un origen + N destinos en una sola
 * Operación) son todos distintos de los 9 procesos de `ProcesoGenerico`; RECLASIFICACION está excluida de ese tipo a propósito
 * (`core/features/movimientos/movimiento.schema.ts`). Sí REUTILIZA de M13b las dos escrituras de persistencia
 * (`escribirOperacionDeStock`/`escribirLineasDeMovimientoStock`) y de I3 `registrarResultadoIdempotente`.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("stock_reclasificar")`)
 * ni el formato del comando (`guardComandoReclasificarStock`, core/features/movimientos/reclasificacion.guard.ts: producto, sección de
 * origen, destinos vacío, clave I3, sección de cada destino en blanco): recibe `comando` ya pasado por esa.
 *
 * Orden, igual que antes:
 *  1. sección de origen propia y, para CADA destino, sección propia (fuera de la transacción, con el cliente global) — Fase 6
 *     (auditoría de seguridad/contratos): `conPermiso` ya validó el permiso en LA SUCURSAL DEL QUE LLAMA, nunca que las secciones que
 *     mandó el cliente sean realmente de esa sucursal;
 *  2. "único destino idéntico al origen" (misma sección + mismo lote): con un solo destino que no reparte nada, la reclasificación es
 *     un par de movimientos que se cancelan entre sí — no aporta nada al Kardex, solo ruido. Corre DESPUÉS de (1) a propósito, por el
 *     orden de mensajes (una sección inválida se reporta antes que este chequeo, que sí es puramente lógico);
 *  3. `conTransaccionSerializable`: I3, carga del producto (`cargarProductoConUnidadDeStock`), disponibilidad en la sucursal,
 *     `validarCantidad` de cada destino (se RECHAZA el exceso de decimales para la unidad de stock del producto, hallazgo del pendiente
 *     #32 — antes no había NINGÚN chequeo acá), cálculo del saldo disponible en origen (leído DENTRO de la transacción: Serializable
 *     aborta si otra escritura concurrente lo cambia mientras tanto) y de la diferencia contra la suma de destinos (tiene que ser
 *     EXACTAMENTE cero — ni de más ni de menos), escritura de la Operación + líneas del Kardex (un origen negativo + N destinos
 *     positivos) y el mensaje final.
 *
 * @contract Reparte el saldo íntegro de un producto en un origen entre N destinos, exigiendo que la suma coincida EXACTAMENTE con lo disponible.
 * @idempotency I3 (claveIdempotencia + payloadHash), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento) — el saldo disponible se lee DENTRO de la transacción.
 * @sideEffects Ninguno además de la escritura del Kardex (un origen negativo + N destinos positivos) — sin auditoría de permisos propia.
 * @ficha permiso=stock_reclasificar transaccion=SERIALIZABLE idempotencia=I3 auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function reclasificarStockCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion">,
  comando: ComandoReclasificarStock
): Promise<ResultadoReclasificarStock> {
  // Fase 6 (auditoría de seguridad/contratos): ver el mismo chequeo en
  // registrarMovimiento — conPermiso no valida que las secciones sean
  // de ESTA sucursal, solo el permiso de quien llama.
  if (!(await obtenerSeccionPropia(comando.seccionOrigenId, actor.sucursalId, actor.db))) {
    return fracaso("SECCION_ORIGEN_NO_ENCONTRADA", "No se encontró la sección de origen.");
  }
  const seccionesDestino = new Map<string, { id: string; nombre: string }>();
  for (const d of comando.destinos) {
    const seccion = await obtenerSeccionPropia(d.seccionId, actor.sucursalId, actor.db);
    if (!seccion) return fracaso("SECCION_DESTINO_NO_ENCONTRADA", "No se encontró una de las secciones de destino.");
    seccionesDestino.set(d.seccionId, seccion);
  }

  // Con un único destino idéntico al origen (misma sección+lote), la
  // "reclasificación" es un par de movimientos que se cancelan entre sí
  // — no reparte nada, solo agrega ruido a la trazabilidad del Kardex.
  if (comando.destinos.length === 1) {
    const unico = comando.destinos[0];
    const mismoLote = (comando.loteOrigen ?? null)?.getTime() === (unico.loteVencimiento ?? null)?.getTime();
    if (unico.seccionId === comando.seccionOrigenId && mismoLote) {
      return fracaso("DESTINO_IDENTICO_AL_ORIGEN", "El único destino es idéntico al origen (misma sección y lote) — no hay nada para reclasificar.");
    }
  }

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoReclasificarStock> => {
    // I3 — idempotencia: chequeo antes de cualquier lógica de negocio.
    const payloadHash = comando.claveIdempotencia
      ? calcularPayloadHash("RECLASIFICACION", actor.sucursalId, { ...comando, claveIdempotencia: undefined })
      : "";
    const chequeo = await chequearIdempotencia(tx, comando.claveIdempotencia, payloadHash);
    if (chequeo.estado === "duplicado") {
      return exito(chequeo.mensaje, { operacionId: null, disponible: null, destinosCantidad: null, repetida: true });
    }
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const producto = await cargarProductoConUnidadDeStock(tx, comando.productoId);
    if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "El producto no existe.");
    if (!(await productoDisponibleEn(actor.sucursalId, producto.id, tx))) {
      return fracaso("PRODUCTO_NO_DISPONIBLE", `«${producto.nombre}» no está disponible en «${actor.sucursalNombre}».`);
    }

    // Cantidad de ENTRADA de cada destino: se rechaza el exceso de decimales para la unidad de stock del producto, no se
    // redondea ni se guarda tal cual (hallazgo del pendiente #32 — Reclasificación no tenía NINGÚN chequeo de decimales acá,
    // a diferencia de Traspasos/Conteo Físico/Compra). Recién acá se conoce `producto.unidadStock`.
    const destinosValidados: { seccionId: string; loteVencimiento: Date | null; cantidad: number }[] = [];
    for (const d of comando.destinos) {
      const nombreSeccion = seccionesDestino.get(d.seccionId)?.nombre ?? d.seccionId;
      const resCantidad = validarCantidad(d.cantidad, producto.unidadStock, {
        etiqueta: `La cantidad de "${producto.nombre}" hacia "${nombreSeccion}"`,
        obligatorio: true,
      });
      if (!resCantidad.ok) return fracaso("CANTIDAD_INVALIDA", resCantidad.mensaje);
      destinosValidados.push({ seccionId: d.seccionId, loteVencimiento: d.loteVencimiento ?? null, cantidad: resCantidad.valor! });
    }
    const totalDestinos = destinosValidados.reduce((acc, d) => acc + d.cantidad, 0);

    // El saldo disponible se lee DENTRO de la transacción (Serializable
    // aborta si otra escritura concurrente lo cambia mientras tanto) —
    // mismo criterio "leer→decidir→escribir sin que se cuele otra
    // escritura" que conLock_ en Apps Script.
    const disponible = await calcularSaldoPorLote(comando.productoId, comando.seccionOrigenId, comando.loteOrigen ?? null, tx);
    const diff = Math.round((totalDestinos - disponible) * 1000) / 1000;
    if (diff !== 0) {
      return fracaso(
        "SUMA_NO_COINCIDE",
        `La suma de los destinos (${totalDestinos}) tiene que ser exactamente igual al saldo disponible en origen (${disponible}) — ni de más ni de menos.`
      );
    }
    if (!(disponible > 0)) return fracaso("SIN_SALDO", "No hay saldo disponible para reclasificar en esa sección/lote.");

    const operacion = await escribirOperacionDeStock(tx, {
      sucursalId: actor.sucursalId,
      proceso: "RECLASIFICACION",
      fecha: comando.fecha,
      proveedorId: null,
      nroFactura: null,
      seccionDestinoId: null,
      motivoId: null,
      destinoId: null,
      detalleLibre: texto(comando.detalle) || null,
      usuarioId: actor.usuarioId,
      claveIdempotencia: comando.claveIdempotencia ?? null,
      payloadHash: comando.claveIdempotencia ? payloadHash : null,
    });

    const filas: Prisma.MovimientoStockCreateManyInput[] = [
      {
        operacionId: operacion.id,
        productoId: comando.productoId,
        seccionId: comando.seccionOrigenId,
        proceso: "RECLASIFICACION",
        cantidad: -disponible,
        loteVencimiento: comando.loteOrigen ?? null,
        detalle: `Reclasificación: sale hacia ${comando.destinos.length} destino(s).`,
        precioTotal: 0,
        precioPorUnidadStock: 0,
      },
      ...destinosValidados.map(
        (d): Prisma.MovimientoStockCreateManyInput => ({
          operacionId: operacion.id,
          productoId: comando.productoId,
          seccionId: d.seccionId,
          proceso: "RECLASIFICACION",
          cantidad: d.cantidad,
          loteVencimiento: d.loteVencimiento,
          detalle: "Reclasificación: entra desde otra sección/lote.",
          precioTotal: 0,
          precioPorUnidadStock: 0,
        })
      ),
    ];

    await escribirLineasDeMovimientoStock(tx, filas);

    const mensaje = `"${producto.nombre}" reclasificado: ${disponible} repartido en ${comando.destinos.length} destino(s).`;
    if (comando.claveIdempotencia) {
      await registrarResultadoIdempotente(tx, operacion.id, mensaje);
    }

    return exito(mensaje, { operacionId: operacion.id, disponible, destinosCantidad: comando.destinos.length, repetida: false });
  });
}
