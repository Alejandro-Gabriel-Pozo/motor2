import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { VentaForm } from "./venta-form";

export default async function VentaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_venta");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const secciones = await listarSeccionesActivas(ctx.sucursalId);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Venta</h1>
      <VentaForm secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
    </div>
  );
}
