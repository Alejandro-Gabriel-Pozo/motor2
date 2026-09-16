import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerHistorialConteosFisicos } from "@/server/actions/conteo-fisico";
import { listarSeccionesActivas } from "@/server/actions/secciones";
import { obtenerProductoOpcion } from "@/server/actions/productos";
import { TablaHistorialConteos, type FilaConteo } from "./tabla-conteos";
import { FiltrosConteos } from "./filtros-conteos";

export default async function ConteosPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; seccionId?: string; productoId?: string; desde?: string; hasta?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const sp = await searchParams;
  const [secciones, productoElegido] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    sp.productoId ? obtenerProductoOpcion(sp.productoId) : Promise.resolve(null),
  ]);
  const { items: conteos, nextCursor } = await obtenerHistorialConteosFisicos(ctx.sucursalId, {
    seccionId: sp.seccionId || undefined,
    productoId: sp.productoId || undefined,
    desde: sp.desde ? new Date(sp.desde) : undefined,
    hasta: sp.hasta ? new Date(sp.hasta) : undefined,
    cursor: sp.cursor,
  });

  const filas: FilaConteo[] = conteos.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    productoId: c.productoId,
    productoCodigo: c.producto.codigo,
    productoNombre: c.producto.nombre,
    seccionNombre: c.seccion.nombre,
    saldoSistema: Number(c.saldoSistema),
    conteoReal: Number(c.conteoReal),
    diferencia: Number(c.diferencia),
    accion: c.accion,
    estado: c.estado,
  }));

  const paramsPaginaSiguiente = new URLSearchParams();
  if (sp.seccionId) paramsPaginaSiguiente.set("seccionId", sp.seccionId);
  if (sp.productoId) paramsPaginaSiguiente.set("productoId", sp.productoId);
  if (sp.desde) paramsPaginaSiguiente.set("desde", sp.desde);
  if (sp.hasta) paramsPaginaSiguiente.set("hasta", sp.hasta);
  if (nextCursor) paramsPaginaSiguiente.set("cursor", nextCursor);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Historial de conteos físicos</h1>
        <p className="text-sm text-neutral-500">Más recientes primero. El orden y el export CSV son de esta página — para exportar todo, avanzá página por página.</p>
      </div>
      <FiltrosConteos
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
        seccionId={sp.seccionId ?? ""}
        productoId={sp.productoId ?? ""}
        productoEtiqueta={productoElegido ? `${productoElegido.codigo} — ${productoElegido.nombre}` : ""}
        desde={sp.desde ?? ""}
        hasta={sp.hasta ?? ""}
      />
      <TablaHistorialConteos filas={filas} />
      {nextCursor && (
        <Link href={`/reportes/conteos?${paramsPaginaSiguiente.toString()}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
