import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer } from "@/server/acceso/gate";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { ReclasificarForm } from "./reclasificar-form";

export default async function ReclasificarPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  // Clave propia `stock_reclasificar` (antes compartía `proceso_control` con Conteo Físico), ver src/server/actions/stock/reclasificacion.ts.
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "stock_reclasificar", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const secciones = await listarSeccionesActivas(ctx.sucursalId);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Reclasificar stock</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Repartí TODO el saldo disponible de un producto (en una sección/lote puntual) entre uno o más destinos — la suma de los destinos tiene que coincidir exacto con lo disponible.
      </p>
      <ReclasificarForm secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))} />
    </div>
  );
}
