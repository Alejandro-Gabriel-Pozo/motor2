import { notFound } from "next/navigation";
import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { ACCION_POR_PROCESO } from "@/core/movimientos/transiciones";
import { obtenerConfigProceso } from "@/core/movimientos/ui-config";
import { listarProveedores } from "@/server/actions/catalogo/proveedores";
import { listarUnidadesActivas } from "@/server/actions/catalogo/unidades";
import { listarSeccionesActivas } from "@/server/actions/movimientos/secciones";
import { prisma } from "@/lib/db";
import { PanelMovimientoForm } from "./panel-movimiento-form";

export default async function MovimientoPage({
  params,
  searchParams,
}: {
  params: Promise<{ proceso: string }>;
  searchParams: Promise<{ productoId?: string }>;
}) {
  const { proceso: slug } = await params;
  const config = obtenerConfigProceso(slug);
  if (!config) notFound();

  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const accionClave = ACCION_POR_PROCESO[config.proceso];
  if (!accionClave) notFound();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, accionClave);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const { productoId } = await searchParams;

  const [secciones, proveedores, unidades, productoInicial] = await Promise.all([
    listarSeccionesActivas(ctx.sucursalId),
    config.requiereProveedor ? listarProveedores(true) : Promise.resolve([]),
    // Alta rápida de producto inline (solo Compra, ver QuickCrearProducto)
    // — no Devolución a proveedor pese a ser también `esCompraLike`: no
    // tiene sentido devolver algo que nunca se compró.
    config.proceso === "COMPRA" ? listarUnidadesActivas() : Promise.resolve([]),
    // Deep-link accionable desde un reporte (ej. "Costo incompleto" ->
    // "cargale precio a este insumo") — resuelto server-side así el form
    // cliente no tiene que pedirlo aparte.
    productoId ? prisma.producto.findUnique({ where: { id: productoId }, select: { id: true, codigo: true, nombre: true } }) : Promise.resolve(null),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">{config.titulo}</h1>
      <PanelMovimientoForm
        config={config}
        secciones={secciones.map((s) => ({ id: s.id, nombre: s.nombre }))}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        unidades={unidades.map((u) => ({ id: u.id, nombre: u.nombre }))}
        productoInicial={productoInicial ? { id: productoInicial.id, etiqueta: `${productoInicial.codigo} — ${productoInicial.nombre}` } : undefined}
      />
    </div>
  );
}
