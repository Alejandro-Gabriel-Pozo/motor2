import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { generarReporteSaludPorProducto } from "@/server/consultas/reportes/salud-por-producto";
import { TablaSaludPorProducto } from "./tabla-salud";

export default async function SaludPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_salud", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  // La hora se fija acá, en el borde (D.3a): el reporte la recibe por parámetro.
  const ahora = new Date();
  const filas = await generarReporteSaludPorProducto(ctx.sucursalId, ctx.db, ahora);
  const conAtencion = filas.filter((f) => f.resumen === "Atención").length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Salud por producto</h1>
        <p className="text-sm text-neutral-500">
          Cruce de Stock Consolidado, Alertas, Diferencias de Ajuste e Insumos sin receta — no reemplaza a ninguno, resume si algún eje tiene algo
          para revisar. {conAtencion} de {filas.length} fila(s) necesitan atención.
        </p>
      </div>
      <TablaSaludPorProducto filas={filas} />
    </div>
  );
}
