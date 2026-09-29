import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { obtenerResumenConsolidado } from "@/core/reportes/resumen-consolidado";
import { TablaConsolidado } from "./tabla-consolidado";

export default async function ConsolidadoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  if (ctx.membresias.length < 2) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold">Resumen consolidado</h1>
        <p className="text-sm text-neutral-500">
          Solo pertenecés a una sucursal ({ctx.sucursalNombre}) — no hay nada que consolidar todavía. Mirá{" "}
          <Link href="/reportes" className="underline">
            Resumen
          </Link>{" "}
          en vez de este.
        </p>
      </div>
    );
  }

  const filas = await obtenerResumenConsolidado(ctx.membresias.map((m) => ({ id: m.sucursalId, nombre: m.sucursalNombre })), ctx.db);
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
        <p className="text-sm text-neutral-500">Financiero del mes actual, una fila por cada sucursal a la que pertenecés.</p>
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
