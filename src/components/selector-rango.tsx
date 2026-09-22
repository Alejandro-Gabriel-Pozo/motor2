import type { OpcionRango } from "@/core/reportes/rango-por-defecto";

/**
 * Selector de rango de fechas de los reportes — reemplaza el `<form>` con dos `<input type="date">` que había, copiado y pegado
 * en cinco pantallas (Resumen operativo, Período, Categorías, Promociones, Rendimiento de recetas). Decisión del usuario
 * (2026-09-21, docs/planes-demo-y-claridad-reportes-2026-09-21.md §1): el default pasa de "mes en curso" a "Últimos 30 días",
 * con "Mes en curso" y "Fechas personalizadas" como alternativas.
 *
 * Los `<input type="date" name="desde"/"hasta">` SOLO se renderizan cuando `opcion === "personalizado"`. Si se mostraran
 * siempre (aunque sea de forma oculta o deshabilitada), un value obsoleto de una carga anterior viajaría igual en el próximo
 * submit y pisaría en el server una elección fresca de "rango" — no hay JS acá para mantenerlos sincronizados, es un server
 * component. Mientras la opción no es "personalizado" se muestra el rango vigente como texto de solo lectura.
 *
 * El `<label>` del `<select>` va AL LADO del control (`htmlFor`), no envolviéndolo: un label que envuelve un `<select>` suma a
 * su nombre accesible el texto de la opción vigente (ej. "Rango Últimos 30 días" en vez de "Rango"), lo que rompe
 * `getByLabel("Rango")` — mismo motivo documentado en `FormularioCorregirCompra`.
 */
export function SelectorRango({
  opcion,
  desdeISO,
  hastaISO,
  camposOcultos,
}: {
  opcion: OpcionRango;
  desdeISO: string;
  hastaISO: string;
  camposOcultos?: Record<string, string>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3 text-sm">
      {camposOcultos &&
        Object.entries(camposOcultos).map(([nombre, valor]) => <input key={nombre} type="hidden" name={nombre} value={valor} />)}
      <div className="flex flex-col gap-1">
        <label htmlFor="rango">Rango</label>
        <select id="rango" name="rango" defaultValue={opcion} className="rounded border px-3 py-2">
          <option value="30d">Últimos 30 días</option>
          <option value="mes">Mes en curso</option>
          <option value="personalizado">Fechas personalizadas</option>
        </select>
      </div>
      {opcion === "personalizado" ? (
        <>
          <label className="flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desdeISO} className="rounded border px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hastaISO} className="rounded border px-3 py-2" />
          </label>
        </>
      ) : (
        <p className="pb-2 text-xs text-neutral-500">
          Del {desdeISO} al {hastaISO}
        </p>
      )}
      <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
        Actualizar
      </button>
    </form>
  );
}
