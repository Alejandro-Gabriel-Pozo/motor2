import type { ContextoUsuario } from "@/server/sesion/contexto";
import { obtenerMiNivelPermiso } from "@/server/acceso/gate";
import { listarComprasPorRecibir } from "@/server/consultas/movimientos/facturas-proveedor";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { BandejaPorRecibir } from "./bandeja-para-aceptar";

/**
 * Compras, recepción separada (N3-a): «Por recibir» en la pantalla de Compra. SERVIDOR: solo lo ve (y solo se consulta para) quien tiene `compra_recibir` en esta sucursal: gerente o administrador, y con el módulo
 * `recepcion_de_compras` encendido (con el módulo apagado el nivel da «ni ver» y no se lee nada). El permiso se vuelve a exigir en el servidor al confirmar. La lista no muestra importes: identifica la compra por proveedor, número
 * y fecha (los importes de las compras son del reporte de compras).
 */
export async function PorRecibir({ ctx, secciones }: { ctx: ContextoUsuario; secciones: { id: string; nombre: string }[] }) {
  const nivel = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "compra_recibir", ctx.db);
  if (!nivel.editar) return null;
  const compras = await listarComprasPorRecibir(ctx.sucursalId, ctx.db);
  const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);
  const hoy = dia(new Date());
  const diasEntre = (desde: string, hasta: string) => Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000));
  return (
    <BandejaPorRecibir
      secciones={secciones}
      compras={compras.map((c) => ({
        facturaId: c.facturaId,
        proveedorNombre: c.proveedorNombre,
        nroFactura: c.nroFactura,
        diaFactura: dia(c.fechaFactura),
        cantidadDeRenglones: c.cantidadDeRenglones,
        antiguedadDias: diasEntre(dia(c.cargadaEn), hoy),
      }))}
    />
  );
}
