import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarSucursalesDisponibles } from "@/server/actions/traspasos/lecturas";
import { EnviarForm } from "./enviar-form";

export default async function EnviarTraspasoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_transferencia_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [sucursales, secciones] = await Promise.all([
    listarSucursalesDisponibles(ctx.sucursalId),
    listarSeccionesActivas(ctx.sucursalId),
  ]);

  return (
    <div className="max-w-xl">
      <h1 className="mb-1 text-xl font-semibold">Enviar una transferencia directo</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Le mandás stock a otra sucursal sin que te lo pida (PUSH) — el stock sale de tu sección YA, al enviar. Queda &quot;Enviada&quot; hasta
        que la sucursal destino la acepte o la rechace.
      </p>
      <EnviarForm sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))} secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
    </div>
  );
}
