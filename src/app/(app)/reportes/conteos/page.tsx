import Link from "next/link";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { obtenerHistorialConteosFisicos } from "@/server/actions/conteo-fisico";
import { TablaHistorialConteos, type FilaConteo } from "./tabla-conteos";

export default async function ConteosPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const { cursor } = await searchParams;
  const { items: conteos, nextCursor } = await obtenerHistorialConteosFisicos(ctx.sucursalId, undefined, cursor);

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Historial de conteos físicos</h1>
        <p className="text-sm text-neutral-500">Más recientes primero. El orden y el export CSV son de esta página — para exportar todo, avanzá página por página.</p>
      </div>
      <TablaHistorialConteos filas={filas} />
      {nextCursor && (
        <Link href={`/reportes/conteos?cursor=${nextCursor}`} className="text-sm underline">
          Página siguiente →
        </Link>
      )}
    </div>
  );
}
