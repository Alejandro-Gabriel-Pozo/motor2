import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { obtenerHistorialConteosFisicos } from "@/server/actions/movimientos/lecturas-conteo-fisico";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { obtenerProductoOpcion } from "@/server/actions/catalogo/productos";
import { TablaHistorialConteos, type FilaConteo } from "./tabla-conteos";
import { FiltrosConteos } from "./filtros-conteos";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/** Una fecha de la URL que no se puede leer se ignora (sin filtro), no rompe la pantalla con una excepción de Prisma. */
function fechaDeUrl(valor: string | undefined): Date | undefined {
  if (!valor) return undefined;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha;
}

export default async function ConteosPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"cursor" | "seccionId" | "productoId" | "desde" | "hasta">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_conteos", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  const [secciones, productoElegido] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    sp.productoId ? obtenerProductoOpcion(sp.productoId) : Promise.resolve(null),
  ]);
  const { items: conteos, nextCursor } = await obtenerHistorialConteosFisicos(ctx.sucursalId, {
    seccionId: sp.seccionId || undefined,
    productoId: sp.productoId || undefined,
    desde: fechaDeUrl(sp.desde),
    hasta: fechaDeUrl(sp.hasta),
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
        <p className="text-sm text-neutral-500">Más recientes primero. El orden y el export a Excel son de esta página — para exportar todo, avanzá página por página.</p>
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
