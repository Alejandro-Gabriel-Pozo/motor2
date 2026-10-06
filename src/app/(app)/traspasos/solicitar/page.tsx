import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { listarSucursalesParaSolicitar } from "@/server/actions/traspasos/lecturas";
import { SolicitarForm } from "./solicitar-form";

export default async function SolicitarTraspasoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "traspaso_solicitar", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [sucursales, secciones] = await Promise.all([
    listarSucursalesParaSolicitar(ctx.sucursalId),
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
