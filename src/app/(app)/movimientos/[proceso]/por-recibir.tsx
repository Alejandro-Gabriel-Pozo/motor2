import type { ContextoUsuario } from "@/server/sesion/contexto";
import { obtenerMiNivelPermiso } from "@/server/acceso/gate";
import { listarComprasPorRecibir } from "@/server/consultas/movimientos/facturas-proveedor";
import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { BandejaPorRecibir } from "./bandeja-para-aceptar";

/**
 * Compras, recepción separada (N3-a y N3-b): «Por recibir» en la pantalla de Compra. SERVIDOR: lo ve (y solo se consulta para) quien tiene `compra_recibir` (gerente o administrador: confirma la recepción) o `compra_controlar_recepcion`
 * (quien recibe, el operador también: registra el control de cada línea) en esta sucursal, y con el módulo `recepcion_de_compras` encendido (con el módulo apagado el nivel da «ni ver» y no se lee nada). Cada permiso se vuelve a exigir en el
 * servidor al actuar: la pantalla solo muestra el control a quien puede controlar y el botón de confirmar a quien puede confirmar. La lista no muestra importes: identifica la compra por proveedor, número, fecha y renglones.
 */
export async function PorRecibir({ ctx, secciones }: { ctx: ContextoUsuario; secciones: { id: string; nombre: string }[] }) {
  const [recibir, controlar] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "compra_recibir", ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "compra_controlar_recepcion", ctx.db),
  ]);
  if (!recibir.editar && !controlar.editar) return null;
  const compras = await listarComprasPorRecibir(ctx.sucursalId, ctx.db);
  const dia = (f: Date) => diaDeCalendario(f, ZONA_ARGENTINA);
  const hoy = dia(new Date());
  const diasEntre = (desde: string, hasta: string) => Math.max(0, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000));
  return (
    <BandejaPorRecibir
      secciones={secciones}
      puedeConfirmar={recibir.editar}
      puedeControlar={controlar.editar}
      compras={compras.map((c) => ({
        facturaId: c.facturaId,
        proveedorNombre: c.proveedorNombre,
        nroFactura: c.nroFactura,
        diaFactura: dia(c.fechaFactura),
        cantidadDeRenglones: c.cantidadDeRenglones,
        antiguedadDias: diasEntre(dia(c.cargadaEn), hoy),
        renglones: c.renglones,
      }))}
    />
  );
}
