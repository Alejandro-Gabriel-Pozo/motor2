import "server-only";
import { texto } from "@/core/texto";
import { normalizarNumeroDeComprobante, repartirFactura, type RepartoDeFactura } from "@/core/compras/public";
import type { DatosMovimientoInput } from "@/core/features/movimientos/movimiento.schema";
import type { DatosFacturaProveedorInput, ResultadoRegistrarFacturaProveedor } from "@/core/features/compras/factura-proveedor.schema";
import { mensajeSeccionDesactivada } from "@/core/features/movimientos/secciones.guard";
import {
  calcularPayloadHash,
  decidirIdempotencia,
  esChoqueDeClaveIdempotenciaDeFactura,
  esChoqueDeFacturaDeProveedorUnica,
  esChoqueDeFacturaUnica,
  MENSAJE_CONFLICTO_IDEMPOTENCIA,
  MENSAJE_FACTURA_DE_PROVEEDOR_DUPLICADA,
  MENSAJE_FACTURA_DUPLICADA,
} from "@/core/movimientos/public-servidor";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { obtenerSeccionPropia } from "@/server/lecturas/movimientos/saldos";
import { cargarProveedor, existeCompraVigenteConFactura } from "@/server/persistencia/movimientos/cargar-validaciones-de-movimiento";
import { escribirLineasDeMovimientoStock, escribirOperacionDeStock } from "@/server/persistencia/movimientos/escribir-movimiento-de-stock";
import { chequearIdempotencia } from "@/server/persistencia/movimientos/idempotencia";
import { crearCacheProducto } from "@/server/persistencia/movimientos/producto-cache";
import { cargarFacturaPorClaveIdempotencia, cargarSucursalesDelReparto, existeFacturaVigenteConNumero } from "@/server/persistencia/compras/cargar-factura-proveedor";
import {
  escribirCabeceraDeFactura,
  escribirParteRecibida,
  escribirPropuesta,
  escribirRenglonesDeFactura,
  registrarResultadoDeFactura,
} from "@/server/persistencia/compras/escribir-factura-proveedor";
import { registrarVinculoDeCompraEnTx } from "@/server/actions/catalogo/casos-de-uso/registrar-vinculo-de-compra-en-tx";
import { armarLineaMovimiento, type LineaCalculada } from "./armar-linea-de-movimiento";

/**
 * Caso de uso «cargar una factura de proveedor» (E3a, ADR-041; docs/diseno-factura-de-proveedor-e3a-2026-10-27.md). Modo «una sola sucursal» (una parte del 100 % en la sucursal que carga) y modo «reparto»
 * (la parte propia, si tiene, entra al stock en el acto; la de cada otra sucursal nace como PROPUESTA pendiente que esa sucursal acepta después).
 *
 * `import "server-only"` y SIN `"use server"`: no chequea permisos (la Server Action pidió `proceso_compra` en la sucursal activa y, si hay partes de otras sucursales, también `compra_repartir`) ni el formato
 * (`guardComandoRegistrarFacturaProveedor`).
 *
 * Pasos:
 *  1. (fuera de la transacción) la sección de la parte propia es de esta sucursal; el número normalizado; caminos rápidos de factura repetida (en la empresa, y como compra en esta sucursal);
 *  2. dentro de UNA transacción SERIALIZABLE: I3 (la clave y la huella viven en la cabecera); proveedor activo; sección activa; las sucursales destino existen en la empresa y están activas; cada renglón se arma como
 *     una línea de compra (`armarLineaMovimiento`: producto, conversión, precio y referencia del proveedor); el reparto exacto (`repartirFactura`, los importes tipeados son los pesos) y sus sumas verificadas;
 *  3. escribe la cabecera CONFIRMADA, los renglones, la compra de la parte propia (Operacion + Kardex con el renglón) y su parte RECIBIDA, una propuesta PENDIENTE con sus renglones por cada otra sucursal, el
 *     vínculo proveedor↔producto (comando de Catálogo) y la auditoría; guarda el mensaje para la idempotencia.
 *  Choques: el número repetido en la empresa (`FacturaProveedor_unica_vigente_key`) o como compra en esta sucursal → «factura duplicada»; la clave tomada por otro pedido → conflicto o repetida.
 *
 * @contract Carga una factura de proveedor de mercadería y la reparte exactamente entre sucursales: la parte propia entra al stock y las ajenas quedan propuestas para aceptar.
 * @idempotency I3 (claveIdempotencia + payloadHash en la cabecera de la factura), dentro de la misma transacción.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento), con `.catch` de la factura duplicada y de la clave tomada.
 * @sideEffects registrarVinculoDeCompraEnTx (comando de Catálogo, dentro de la transacción) y registrarCambioAuditado (el reparto).
 * @ficha permiso=compra_repartir+proceso_compra transaccion=SERIALIZABLE idempotencia=I3 auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function registrarFacturaProveedorCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "db" | "transaccion" | "empresaId" | "alcance" | "ahora">,
  datos: DatosFacturaProveedorInput
): Promise<ResultadoRegistrarFacturaProveedor> {
  const partes = datos.reparto.partes;
  const propia = partes.find((p) => p.sucursalId === actor.sucursalId) ?? null;
  const ajenas = partes.filter((p) => p.sucursalId !== actor.sucursalId);

  const seccion = propia ? await obtenerSeccionPropia(datos.seccionId as string, actor.sucursalId, actor.db) : null;
  if (propia && !seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección.");

  const payloadHash = calcularPayloadHash("FACTURA_PROVEEDOR", actor.sucursalId, { ...datos, claveIdempotencia: undefined });
  // Un reenvío de una carga que YA se hizo tiene que devolver su mensaje, no el «ya hay una factura con ese número» del camino rápido (la factura repetida es ella misma). El chequeo que vale es el de adentro de la
  // transacción; este solo evita el falso rechazo.
  const previa = decidirIdempotencia(await cargarFacturaPorClaveIdempotencia(actor.db, datos.claveIdempotencia), payloadHash);
  if (previa.estado === "duplicado") return exito(previa.mensaje, { repetida: true, facturaId: null });
  if (previa.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

  const nroFactura = texto(datos.nroFactura) || null;
  const nroFacturaNormalizado = nroFactura ? normalizarNumeroDeComprobante(nroFactura) : null;
  if (nroFacturaNormalizado && (await existeFacturaVigenteConNumero(actor.db, { proveedorId: datos.proveedorId, nroFacturaNormalizado }))) {
    return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DE_PROVEEDOR_DUPLICADA);
  }
  if (propia && nroFactura && (await existeCompraVigenteConFactura(actor.db, { sucursalId: actor.sucursalId, proveedorId: datos.proveedorId, nroFactura }))) {
    return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
  }

  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoRegistrarFacturaProveedor> => {
    const chequeo = await chequearIdempotencia(tx, datos.claveIdempotencia, payloadHash, cargarFacturaPorClaveIdempotencia);
    if (chequeo.estado === "duplicado") return exito(chequeo.mensaje, { repetida: true, facturaId: null });
    if (chequeo.estado === "conflicto") return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);

    const proveedor = await cargarProveedor(tx, datos.proveedorId);
    if (!proveedor?.activo) return fracaso("PROVEEDOR_NO_DISPONIBLE", "El proveedor elegido ya no está disponible.");
    if (seccion && !seccion.activa) return fracaso("SECCION_INACTIVA", mensajeSeccionDesactivada(seccion.nombre));

    const sucursales = await cargarSucursalesDelReparto(tx, ajenas.map((p) => p.sucursalId));
    for (const p of ajenas) {
      const s = sucursales.find((x) => x.id === p.sucursalId);
      if (!s) return fracaso("SUCURSAL_NO_DISPONIBLE", "No se encontró una de las sucursales del reparto.");
      if (!s.activo) return fracaso("SUCURSAL_NO_DISPONIBLE", `La sucursal «${s.nombre}» está desactivada: sacala del reparto.`);
    }

    // Cada renglón es una línea de compra (mismas reglas que la compra simple: producto habilitado en esta sucursal, conversión de unidad, precio, referencia del proveedor).
    const comoCompra: DatosMovimientoInput = { proceso: "COMPRA", fecha: datos.fecha, seccionId: datos.seccionId ?? "", proveedorId: datos.proveedorId, items: datos.items, claveIdempotencia: datos.claveIdempotencia };
    const obtenerProducto = crearCacheProducto(tx);
    const lineas: { linea: LineaCalculada; nombre: string; decimales: number }[] = [];
    for (const item of datos.items) {
      const armado = await armarLineaMovimiento(item, comoCompra, tx, obtenerProducto, actor.sucursalId, actor.sucursalNombre);
      if (!armado.ok) return fracaso("LINEA_INVALIDA", armado.mensaje);
      if (!armado.linea) continue;
      const producto = await obtenerProducto(armado.linea.productoId);
      lineas.push({ linea: armado.linea, nombre: producto?.nombre ?? "", decimales: producto?.unidadStock.decimales ?? 0 });
    }
    if (!lineas.length) return fracaso("LINEA_INVALIDA", "Ninguna línea tiene una cantidad válida.");

    const reparto = repartirFactura(
      lineas.map((l) => ({ nombre: l.nombre, precioTotal: l.linea.precioTotal, cantidadStock: l.linea.cantidadIngresada, decimales: l.decimales })),
      datos.reparto.modo,
      partes.map((p) => p.valor)
    );
    if (!reparto.ok) return fracaso("REPARTO_INVALIDO", reparto.mensaje);
    verificarSumas(reparto, lineas.map((l) => ({ precioTotal: l.linea.precioTotal, cantidadStock: l.linea.cantidadIngresada })));

    const factura = await escribirCabeceraDeFactura(tx, {
      proveedorId: datos.proveedorId,
      nroFactura,
      nroFacturaNormalizado,
      fecha: datos.fecha,
      importeTotal: reparto.total,
      detalleLibre: texto(datos.detalleLibre) || null,
      usuarioId: actor.usuarioId,
      ahora: actor.ahora,
      claveIdempotencia: datos.claveIdempotencia,
      payloadHash,
    });
    const renglonIds = await escribirRenglonesDeFactura(
      tx,
      factura.id,
      lineas.map(({ linea }) => ({
        productoId: linea.productoId,
        cantidadStock: linea.cantidadIngresada,
        precioPorUnidadStock: Number(linea.precioPorUnidadStock.toFixed(4)),
        loteVencimiento: linea.loteVencimiento,
        detalle: linea.detalle,
        precioTotal: linea.precioTotal,
      }))
    );

    let movimientosPropios = 0;
    for (const [j, parte] of partes.entries()) {
      const celdas = reparto.celdas.map((fila, i) => ({ i, celda: fila[j]! })).filter(({ celda }) => celda.cantidadStock > 0);
      if (parte.sucursalId === actor.sucursalId) {
        const operacion = await escribirOperacionDeStock(tx, {
          sucursalId: actor.sucursalId,
          proceso: "COMPRA",
          fecha: datos.fecha,
          proveedorId: datos.proveedorId,
          nroFactura,
          seccionDestinoId: null,
          motivoId: null,
          destinoId: null,
          detalleLibre: texto(datos.detalleLibre) || null,
          usuarioId: actor.usuarioId,
          claveIdempotencia: null,
          payloadHash: null,
        });
        const escritas = await escribirLineasDeMovimientoStock(
          tx,
          celdas.map(({ i, celda }) => ({
            operacionId: operacion.id,
            productoId: lineas[i]!.linea.productoId,
            seccionId: seccion!.id,
            proceso: "COMPRA",
            cantidad: celda.cantidadStock,
            loteVencimiento: lineas[i]!.linea.loteVencimiento,
            detalle: lineas[i]!.linea.detalle,
            precioTotal: celda.precioTotal,
            precioPorUnidadStock: Number(lineas[i]!.linea.precioPorUnidadStock.toFixed(4)),
            facturaProveedorRenglonId: renglonIds[i]!,
          }))
        );
        movimientosPropios = escritas.movimientos;
        await escribirParteRecibida(tx, {
          facturaProveedorId: factura.id,
          sucursalId: actor.sucursalId,
          porcentajeDeclaradoBp: reparto.partes[j]!.porcentajeDeclaradoBp,
          operacionId: operacion.id,
          recibidaEn: datos.fecha,
          recibidaPorId: actor.usuarioId,
        });
      } else {
        await escribirPropuesta(tx, {
          facturaProveedorId: factura.id,
          origenSucursalId: actor.sucursalId,
          destinoSucursalId: parte.sucursalId,
          porcentajeDeclaradoBp: reparto.partes[j]!.porcentajeDeclaradoBp,
          creadoPorId: actor.usuarioId,
          renglones: celdas.map(({ i, celda }) => ({ facturaProveedorRenglonId: renglonIds[i]!, cantidadStock: celda.cantidadStock, precioTotal: celda.precioTotal })),
        });
      }
    }

    // El vínculo proveedor↔producto (comparativa de precios, ficha del proveedor y la referencia con que el proveedor llama al producto), una vez por renglón, como en la compra simple.
    for (const { linea } of lineas) {
      if (!linea.unidadCompraId) continue;
      await registrarVinculoDeCompraEnTx(tx, actor, {
        productoId: linea.productoId,
        proveedorId: datos.proveedorId,
        unidadCompraId: linea.unidadCompraId,
        precioUnitario: linea.precioUnitario,
        precioPorUnidadStock: linea.precioPorUnidadStock,
        fechaCompra: datos.fecha,
        referenciaProveedor: linea.referenciaProveedor,
      });
    }

    const nombres = new Map([[actor.sucursalId, actor.sucursalNombre], ...sucursales.map((s) => [s.id, s.nombre] as const)]);
    await registrarCambioAuditado(tx, {
      entidad: "FacturaProveedor",
      entidadId: factura.id,
      descripcion: `Factura de proveedor${nroFactura ? ` ${nroFactura}` : ""} cargada en «${actor.sucursalNombre}» y repartida`,
      campo: "reparto",
      valorAnterior: null,
      valorNuevo: partes.map((p, j) => ({ sucursal: nombres.get(p.sucursalId) ?? p.sucursalId, importe: reparto.partes[j]!.importe, porcentajeDeclaradoBp: reparto.partes[j]!.porcentajeDeclaradoBp, estado: p.sucursalId === actor.sucursalId ? "RECIBIDA" : "PROPUESTA" })),
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });

    const mensaje = mensajeDeCarga(movimientosPropios, ajenas.map((p) => nombres.get(p.sucursalId) ?? ""));
    await registrarResultadoDeFactura(tx, factura.id, mensaje);
    return exito(mensaje, { repetida: false, facturaId: factura.id });
  }, undefined, undefined, true).catch(async (e): Promise<ResultadoRegistrarFacturaProveedor> => {
    if (esChoqueDeFacturaDeProveedorUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DE_PROVEEDOR_DUPLICADA);
    if (esChoqueDeFacturaUnica(e)) return fracaso("FACTURA_DUPLICADA", MENSAJE_FACTURA_DUPLICADA);
    if (esChoqueDeClaveIdempotenciaDeFactura(e)) {
      const ganador = await cargarFacturaPorClaveIdempotencia(actor.db, datos.claveIdempotencia);
      if (ganador && ganador.payloadHash === payloadHash && ganador.resultadoMensaje !== null) return exito(ganador.resultadoMensaje, { repetida: true, facturaId: null });
      return fracaso("CONFLICTO_IDEMPOTENCIA", MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    throw e;
  });
}

/** Las sumas que la base no puede verificar (ADR-041): cada renglón suma su importe y su cantidad, y las partes suman 10000 puntos básicos. Si no, es un error de programación: no se escribe nada. */
function verificarSumas(reparto: Extract<RepartoDeFactura, { ok: true }>, renglones: readonly { precioTotal: number; cantidadStock: number }[]): void {
  const centavos = (n: number) => Math.round(n * 100);
  const pasos = (n: number) => Math.round(n * 10000);
  const bp = reparto.partes.reduce((s, p) => s + p.porcentajeDeclaradoBp, 0);
  const renglonesOk = reparto.celdas.every(
    (fila, i) => fila.reduce((s, c) => s + centavos(c.precioTotal), 0) === centavos(renglones[i]!.precioTotal) && fila.reduce((s, c) => s + pasos(c.cantidadStock), 0) === pasos(renglones[i]!.cantidadStock)
  );
  if (bp !== 10000 || !renglonesOk) throw new Error("registrarFacturaProveedor: el reparto no cierra (puntos básicos o sumas por renglón); no se escribe nada.");
}

function mensajeDeCarga(movimientosPropios: number, destinos: readonly string[]): string {
  const propia = movimientosPropios ? `Factura cargada: ${movimientosPropios} movimiento(s) entraron al stock de esta sucursal.` : "Factura cargada.";
  if (!destinos.length) return propia;
  return `${propia} Quedan para aceptar las partes de: ${destinos.map((d) => `«${d}»`).join(", ")} (cada sucursal la acepta desde su Compra; hasta entonces no cuenta en su stock ni en su gasto).`;
}
