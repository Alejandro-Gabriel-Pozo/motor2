import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { listarRegistrosAuditoria, type CambioAuditable } from "@/core/permisos/auditoria";
import { TablaAuditoria, type FilaAuditoria } from "./tabla-auditoria";

const ENTIDADES: CambioAuditable["entidad"][] = ["Producto", "PrecioLocalProducto", "PermisoRol", "CapacidadSucursal", "Rol", "Operacion"];

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ entidad?: string; cursor?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_auditoria");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const entidad = ENTIDADES.includes(sp.entidad as CambioAuditable["entidad"]) ? (sp.entidad as CambioAuditable["entidad"]) : undefined;
  const { items, nextCursor } = await listarRegistrosAuditoria({ entidad, cursor: sp.cursor });

  const filas: FilaAuditoria[] = items.map((r) => ({
    id: r.id,
    fecha: r.creadoEn,
    entidad: r.entidad,
    descripcion: r.descripcion,
    valorAnterior: r.valorAnterior,
    valorNuevo: r.valorNuevo,
    actorNombre: r.actor.name || r.actor.email,
    sucursalNombre: r.sucursal?.nombre ?? null,
  }));

  const paramsPaginaSiguiente = new URLSearchParams();
  if (entidad) paramsPaginaSiguiente.set("entidad", entidad);
  if (nextCursor) paramsPaginaSiguiente.set("cursor", nextCursor);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Auditoría administrativa</h1>
        <p className="text-sm text-neutral-500">
          Cambios de precios y permisos, con quién y cuándo — catálogo/precios/permisos no pasan por el Kardex, así que este es su propio rastro (hallazgo de auditoría, Pivote 6).
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/administracion/auditoria" className={!entidad ? "font-semibold underline" : "text-neutral-500 hover:underline"}>
          Todas
        </Link>
        {ENTIDADES.map((e) => (
          <Link key={e} href={`/administracion/auditoria?entidad=${e}`} className={entidad === e ? "font-semibold underline" : "text-neutral-500 hover:underline"}>
            {e}
          </Link>
        ))}
      </div>
      <TablaAuditoria filas={filas} />
      {nextCursor && (
        <Link href={`/administracion/auditoria?${paramsPaginaSiguiente.toString()}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
