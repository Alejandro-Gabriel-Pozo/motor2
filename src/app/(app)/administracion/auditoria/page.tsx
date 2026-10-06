import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVer } from "@/core/permisos/gate";
import { ENTIDADES_AUDITABLES, descripcionParaMostrar, listarRegistrosAuditoria, sucursalesVisiblesDeAuditoria, type CambioAuditable } from "@/core/permisos/auditoria";
import { TablaAuditoria, type FilaAuditoria } from "./tabla-auditoria";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"entidad" | "cursor">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_auditoria", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const entidad = (ENTIDADES_AUDITABLES as readonly string[]).includes(sp.entidad as string) ? (sp.entidad as CambioAuditable["entidad"]) : undefined;
  // El gate de arriba es de la sucursal activa: las filas de las otras se muestran solo si allí el rol también puede ver la auditoría.
  const sucursalIds = await sucursalesVisiblesDeAuditoria(ctx.usuarioId, ctx.membresias.map((m) => m.sucursalId), ctx.db);
  // Las filas sin sucursal (cambios de la empresa entera) no las cubre un permiso por sucursal: las ve solo quien tiene `ver_auditoria_empresa`
  // (acción de piso gerente: el gerente de la empresa, sin pasar por la matriz).
  const { ver: incluirFilasDeEmpresa } = await obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "ver_auditoria_empresa", ctx.db);
  const { items, nextCursor } = await listarRegistrosAuditoria({ entidad, cursor: sp.cursor, sucursalIds, incluirFilasDeEmpresa }, ctx.db);

  const filas: FilaAuditoria[] = items.map((r) => ({
    id: r.id,
    fecha: r.creadoEn,
    entidad: r.entidad,
    descripcion: descripcionParaMostrar(r.descripcion),
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
        {ENTIDADES_AUDITABLES.map((e) => (
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
