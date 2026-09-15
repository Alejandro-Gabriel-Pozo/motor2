import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { generarReporteSaludPorProducto } from "@/core/reportes/salud-por-producto";
import { TablaSaludPorProducto } from "./tabla-salud";

export default async function SaludPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const filas = await generarReporteSaludPorProducto(ctx.sucursalId);
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
