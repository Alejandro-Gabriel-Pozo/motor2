import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer, sucursalesVisiblesPara } from "@/server/acceso/gate";
import { MENSAJE_DEMASIADAS_LECTURAS, reportePesadoSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerResumenConsolidado } from "@/server/consultas/reportes/resumen-consolidado";
import { TablaConsolidado } from "./tabla-consolidado";
import { EnlaceInterno } from "@/components/enlace-interno";

export default async function ConsolidadoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_consolidado", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // El gate de arriba es de la sucursal activa: las otras se suman solo si allí el rol también puede ver el dinero.
  const sucursales = await sucursalesVisiblesPara(ctx, "reporte_consolidado");

  if (sucursales.length < 2) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen consolidado</h1>
        <p className="text-sm text-neutral-500">
          Solo podés ver el dinero de una sucursal ({ctx.sucursalNombre}) — no hay nada que consolidar todavía. Mirá{" "}
          <EnlaceInterno href="/reportes" className="underline">
            Resumen
          </EnlaceInterno>{" "}
          en vez de este.
        </p>
      </div>
    );
  }

  // S-28: reporte pesado (el período de TODAS las sucursales visibles): cupo por usuario antes de consultar nada (best effort, en memoria).
  const ahora = new Date();
  if (reportePesadoSinCupo(ctx.usuarioId, "resumen-consolidado", ahora.getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;
  const filas = await obtenerResumenConsolidado(sucursales, ctx.db, ahora);
  const totales = filas.reduce(
    (acc, f) => ({
      ventasTotal: acc.ventasTotal + f.ventasTotal,
      margenTotal: acc.margenTotal + f.margenTotal,
      gastadoTotal: acc.gastadoTotal + f.gastadoTotal,
    }),
    { ventasTotal: 0, margenTotal: 0, gastadoTotal: 0 }
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen consolidado</h1>
        <p className="text-sm text-neutral-500">Financiero del mes actual, una fila por cada sucursal donde tu rol puede ver el dinero.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Ventas del mes (las {filas.length} sucursales)</p>
          <p className="text-lg font-semibold">${totales.ventasTotal.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Margen del mes (las {filas.length} sucursales)</p>
          <p className="text-lg font-semibold">${totales.margenTotal.toLocaleString("es-AR")}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-neutral-500">Gastado en compras (las {filas.length} sucursales)</p>
          <p className="text-lg font-semibold">${totales.gastadoTotal.toLocaleString("es-AR")}</p>
        </div>
      </div>

      <TablaConsolidado filas={filas} />
    </div>
  );
}
