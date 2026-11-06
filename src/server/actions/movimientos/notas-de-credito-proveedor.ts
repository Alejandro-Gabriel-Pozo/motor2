"use server";

import { randomUUID } from "node:crypto";
import { armarNumeroDeComprobante } from "@/core/datos/numero-comprobante";
import { normalizarNumeroDeComprobante } from "@/core/compras/public";
import { calcularPayloadHash, esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { conPermiso } from "../con-permiso";
import { error, type ResultadoAccion } from "../tipos";

/**
 * MAQUETA (rama temporal, no se mergea): carga una NOTA DE CRÉDITO SUELTA de proveedor sobre una compra de la sucursal (NC0 «solo dinero» de docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md,
 * CU3: la compra simple no es un documento, así que la nota va suelta con el número de la factura en el motivo). Escribe las tablas que ya existen (cabecera, línea e imputación); NO toca el stock, el costo
 * ni los pagos. Atajos de la maqueta, declarados: el permiso es `corregir_compra` (los propios `nota_credito_proveedor` todavía no están en el catálogo de acciones), no registra auditoría aparte (la nota
 * lleva quién, cuándo y motivo) y el tope es por renglón (lo que costó), sin sumar notas anteriores de la misma compra (la suelta no está atada a ella).
 */
export interface EntradaNotaSuelta {
  operacionId: string;
  nota: { letra: string; puntoDeVenta: string; numero: string };
  /** AAAA-MM-DD */
  dia: string;
  motivo: string;
  renglones: Array<{ movimientoId: string; cantidad: string; importe: string }>;
  claveIdempotencia: string;
}

const exito = (mensaje: string): ResultadoAccion => ({ ok: true, mensaje });
const CENTAVOS = /^\d{1,10}([.,]\d{1,2})?$/;
const aCentavos = (texto: string): number => Math.round(Number(texto.replace(",", ".")) * 100);
const aDecimal = (centavos: number): string => `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;

export async function registrarNotaSueltaDeProveedor(entrada: EntradaNotaSuelta): Promise<ResultadoAccion> {
  return conPermiso("corregir_compra", async (ctx) => {
    const numero = armarNumeroDeComprobante(entrada.nota);
    if (!numero.ok) return error(numero.mensaje);
    if (!esDiaISOReal(entrada.dia)) return error("Elegí la fecha de la nota.");
    const motivo = (entrada.motivo ?? "").trim();
    if (!motivo || motivo.length > 200) return error("Escribí el motivo de la nota (hasta 200 caracteres).");
    const pedidos = (entrada.renglones ?? []).filter((r) => r.importe.trim() !== "");
    if (!pedidos.length) return error("Cargá el importe que acredita al menos un renglón.");
    for (const r of pedidos) {
      if (!CENTAVOS.test(r.importe.trim()) || aCentavos(r.importe.trim()) <= 0) return error("Los importes se escriben en pesos, con hasta dos decimales, y mayores que cero.");
      if (r.cantidad.trim() !== "" && !/^\d{1,6}([.,]\d{1,4})?$/.test(r.cantidad.trim())) return error("La cantidad devuelta se escribe con números.");
    }
    const clave = /^[0-9a-f-]{36}$/i.test(entrada.claveIdempotencia ?? "") ? entrada.claveIdempotencia : randomUUID();
    const hash = calcularPayloadHash("NOTA_CREDITO_SUELTA", ctx.sucursalId, { ...entrada, claveIdempotencia: undefined });

    return conTransaccionSerializable(ctx.transaccion, async (tx): Promise<ResultadoAccion> => {
      const repetida = await tx.notaCreditoProveedor.findUnique({ where: { claveIdempotencia: clave }, select: { payloadHash: true, resultadoMensaje: true } });
      if (repetida) return repetida.payloadHash === hash ? exito(repetida.resultadoMensaje) : error("Esta nota ya se había enviado con datos distintos — recargá la página.");

      const compra = await tx.operacion.findFirst({
        where: { id: entrada.operacionId, sucursalId: ctx.sucursalId, proceso: "COMPRA" },
        select: { proveedorId: true, anuladaEn: true, movimientos: { where: { proceso: "COMPRA" }, select: { id: true, precioTotal: true, producto: { select: { nombre: true } } } } },
      });
      if (!compra) return error("No encontramos esa compra en esta sucursal.");
      if (compra.anuladaEn) return error("La compra está anulada: no se le carga una nota de crédito.");
      if (!compra.proveedorId) return error("La compra no tiene proveedor: corregila antes de cargarle una nota.");

      let totalCentavos = 0;
      const lineas = pedidos.map((p, i) => {
        const renglon = compra.movimientos.find((m) => m.id === p.movimientoId);
        if (!renglon) throw new Error("RENGLON_AJENO");
        const centavos = aCentavos(p.importe.trim());
        if (centavos > Math.round(Number(renglon.precioTotal) * 100)) throw new Error(`TOPE:${renglon.producto.nombre}`);
        totalCentavos += centavos;
        const cantidad = p.cantidad.trim();
        return { orden: i + 1, centavos, descripcion: `${cantidad ? `${cantidad} × ` : ""}${renglon.producto.nombre}` };
      });

      const mensaje = `Nota de crédito ${numero.valor} registrada por $${aDecimal(totalCentavos)}.`;
      const nota = await tx.notaCreditoProveedor.create({
        data: {
          proveedorId: compra.proveedorId,
          tipo: "SUELTA",
          nroComprobante: numero.valor,
          nroComprobanteNormalizado: normalizarNumeroDeComprobante(numero.valor),
          letra: entrada.nota.letra.trim().toUpperCase(),
          fecha: new Date(`${entrada.dia}T15:00:00.000Z`),
          importeTotal: aDecimal(totalCentavos),
          motivo,
          claveIdempotencia: clave,
          payloadHash: hash,
          resultadoMensaje: mensaje,
          creadoPorId: ctx.usuarioId,
        },
      });
      for (const l of lineas) {
        const linea = await tx.notaCreditoProveedorLinea.create({
          data: {
            notaCreditoProveedorId: nota.id,
            tipoNota: "SUELTA",
            orden: l.orden,
            naturaleza: "MERCADERIA",
            admiteDevolucion: false,
            origenImporte: "SIN_FACTURA",
            descripcion: l.descripcion,
            importe: aDecimal(l.centavos),
          },
        });
        await tx.notaCreditoProveedorImputacion.create({ data: { notaCreditoProveedorLineaId: linea.id, lineaAdmiteDevolucion: false, sucursalId: ctx.sucursalId, importe: aDecimal(l.centavos) } });
      }
      return exito(mensaje);
    }).catch((e): ResultadoAccion => {
      if (e instanceof Error && e.message === "RENGLON_AJENO") return error("Uno de los renglones no es de esta compra.");
      if (e instanceof Error && e.message.startsWith("TOPE:")) return error(`No se puede acreditar más de lo que costó «${e.message.slice(5)}» en la factura.`);
      if (esChoqueDeIndiceUnico(e)) return error("Ya hay una nota de crédito de este proveedor con ese número.");
      throw e;
    });
  });
}
