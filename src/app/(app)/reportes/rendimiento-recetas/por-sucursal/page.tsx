import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { requierePermisoVer } from "@/core/permisos/gate";
import { prisma } from "@/lib/db";
import { compararRendimientosPorSucursal } from "@/core/reportes/rendimiento-por-sucursal";
import { TablaPorSucursal, type FilaComparacionPlana } from "./tabla-por-sucursal";

/**
 * D8 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 8): compara el rendimiento CALIBRADO de cada línea de
 * receta entre las sucursales de `ctx.membresias` — mismo precedente de alcance que `/reportes/consolidado` (gate
 * `ver_reportes_dinero`, solo las sucursales del usuario, nunca todo el negocio).
 */
export default async function RendimientoPorSucursalPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string; todas?: string }>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return null;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero");
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = await searchParams;
  const sucursales = ctx.membresias.map((m) => ({ id: m.sucursalId, nombre: m.sucursalNombre }));
  const todas = sp.todas === "1";

  const filas = await compararRendimientosPorSucursal(sucursales, { productoId: sp.productoId, todas }, prisma);
  const filasPlanas: FilaComparacionPlana[] = filas.map((f) => ({
    productoId: f.productoId,
    productoNombre: f.productoNombre,
    recetaIngredienteId: f.recetaIngredienteId,
    insumoNombre: f.insumoNombre,
    unidadNombre: f.unidadNombre,
    central: f.central,
    porSucursal: Object.fromEntries(f.porSucursal),
  }));

  const paramsSinTodas = new URLSearchParams();
  if (sp.productoId) paramsSinTodas.set("productoId", sp.productoId);
  const paramsConTodas = new URLSearchParams(paramsSinTodas);
  paramsConTodas.set("todas", "1");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Rendimiento por sucursal</h1>
        <p className="text-sm text-neutral-500">
          El rendimiento CALIBRADO de cada línea de receta (bruto: cantidad × (1 + merma %)), lado a lado entre las sucursales a las
          que pertenecés. La receta central es una sola; lo que varía es la calibración de cada sucursal.
        </p>
      </div>

      {sucursales.length < 2 && (
        <p className="text-sm text-neutral-500">
          Solo pertenecés a una sucursal ({ctx.sucursalNombre}) — igual se muestra su calibración contra la receta central.
        </p>
      )}

      <div className="text-sm">
        {todas ? (
          <a href={`/reportes/rendimiento-recetas/por-sucursal${paramsSinTodas.toString() ? `?${paramsSinTodas}` : ""}`} className="underline">
            Ver solo las líneas calibradas
          </a>
        ) : (
          <a href={`/reportes/rendimiento-recetas/por-sucursal?${paramsConTodas}`} className="underline">
            Ver todas las líneas (no solo las calibradas)
          </a>
        )}
      </div>

      <TablaPorSucursal filas={filasPlanas} sucursales={sucursales} />
    </div>
  );
}
