import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { generarReporteInsumosSinRecetaVinculada } from "@/core/reportes/insumos-sin-receta";
import { TablaInsumosSinReceta } from "./tabla-insumos-sin-receta";

export default async function InsumosSinRecetaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_catalogo", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const filas = await generarReporteInsumosSinRecetaVinculada(ctx.sucursalId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Insumos sin vincular a receta</h1>
        <p className="text-sm text-neutral-500">Una MP disponible acá que no aparece en ninguna receta vigente se compra pero nada la consume ni la revende todavía.</p>
      </div>
      <TablaInsumosSinReceta filas={filas} />
    </div>
  );
}
