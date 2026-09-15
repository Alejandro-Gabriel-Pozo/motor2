import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { listarSucursalesDisponibles } from "@/server/actions/traspasos";
import { SolicitarForm } from "./solicitar-form";

export default async function SolicitarTraspasoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_transferencia_sucursal");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [sucursales, secciones] = await Promise.all([
    listarSucursalesDisponibles(ctx.sucursalId),
    listarSeccionesActivas(ctx.sucursalId),
  ]);

  return (
    <div className="max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">Solicitar una transferencia</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Le pedís stock a otra sucursal (PULL) — no toca ningún stock todavía: queda &quot;Solicitada&quot; hasta que la sucursal origen la
        apruebe y la envíe.
      </p>
      <SolicitarForm sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))} secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
    </div>
  );
}
