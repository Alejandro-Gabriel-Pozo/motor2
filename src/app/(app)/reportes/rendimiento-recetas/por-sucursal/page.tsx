import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVer, sucursalesVisiblesPara } from "@/server/acceso/gate";
import { compararRendimientosDeSucursales } from "@/server/consultas/reportes/rendimiento-por-sucursal";
import { TablaPorSucursal, type FilaComparacionPlana } from "./tabla-por-sucursal";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";

/**
 * D8 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 8): compara el rendimiento CALIBRADO de cada línea de
 * receta entre las sucursales de `ctx.membresias` — mismo precedente de alcance que `/reportes/consolidado` (gate
 * `reporte_rendimiento_sucursal`, solo las sucursales del usuario, nunca todo el negocio).
 */
export default async function RendimientoPorSucursalPage({
  searchParams,
}: {
  searchParams: Promise<ParametrosDeUrl<"productoId" | "todas">>;
}) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "reporte_rendimiento_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const sp = unicosDeUrl(await searchParams);
  // El gate de arriba es de la sucursal activa: las otras se comparan solo si allí el rol también puede ver el dinero.
  const sucursales = await sucursalesVisiblesPara(ctx, "reporte_rendimiento_sucursal");
  const todas = sp.todas === "1";

  const filas = await compararRendimientosDeSucursales(sucursales, { productoId: sp.productoId, todas }, ctx.db);
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
          El rendimiento CALIBRADO de cada línea de receta (bruto: cantidad × (1 + merma %)), lado a lado entre las sucursales donde
          tu rol puede ver el dinero. La receta central es una sola; lo que varía es la calibración de cada sucursal.
        </p>
      </div>

      {sucursales.length < 2 && (
        <p className="text-sm text-neutral-500">
          Solo podés ver el dinero de una sucursal ({ctx.sucursalNombre}) — igual se muestra su calibración contra la receta central.
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
