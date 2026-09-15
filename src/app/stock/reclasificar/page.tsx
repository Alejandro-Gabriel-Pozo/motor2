import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarProductos } from "@/server/actions/productos";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { ReclasificarForm } from "./reclasificar-form";

export default async function ReclasificarPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  // Mismo permiso que Conteo Físico (proceso_control) — reclasificarStock no tiene Accion propia, ver src/server/actions/reclasificacion.ts.
  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_control");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [productos, secciones] = await Promise.all([
    listarProductos({ soloActivos: true }),
    listarSeccionesActivas(ctx.sucursalId),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Reclasificar stock</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Repartí TODO el saldo disponible de un producto (en una sección/lote puntual) entre uno o más destinos — la suma de los destinos tiene que coincidir exacto con lo disponible.
      </p>
      <ReclasificarForm
        productos={productos.map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo }))}
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />
    </div>
  );
}
