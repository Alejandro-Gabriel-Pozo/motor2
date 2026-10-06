import { obtenerContextoUsuario } from "@/core/auth/contexto";
import { irAlLogin } from "@/core/auth/ir-al-login";
import { requierePermisoVerDeEmpresa } from "@/core/permisos/gate";
import { FOOD_COST_OBJETIVO_PCT, resolverObjetivoFoodCost } from "@/core/reportes/margen-objetivo";
import { cargarObjetivosDeMargen } from "@/core/reportes/margen-objetivo-consulta";
import { guardarMargenObjetivo } from "@/server/actions/reportes/margen-objetivo";
import { listarCategoriasActivas } from "@/server/consultas/catalogo/categorias";
import { FormConResultado } from "@/components/form-con-resultado";

export default async function MargenObjetivoPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "margen_objetivo_editar", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;

  const [objetivos, categorias] = await Promise.all([cargarObjetivosDeMargen(ctx.db), listarCategoriasActivas(ctx.db)]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Margen objetivo (food cost)</h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          El food cost objetivo es el porcentaje del precio de venta (neto, sin IVA) que puede irse en comida y bebida, sin contar el packaging ni la limpieza.
          Con él, el reporte de Costos marca «Food cost alto» y calcula el precio mínimo de cada plato. Rige el de la categoría del producto; si la categoría no
          tiene uno, el de la empresa; y si la empresa tampoco, {FOOD_COST_OBJETIVO_PCT} %. Dejá el campo vacío para volver al objetivo que corresponde.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">De toda la empresa</h2>
        <FormConResultado
          accion={async (formData: FormData) => {
            "use server";
            return guardarMargenObjetivo(null, String(formData.get("porcentaje") ?? ""));
          }}
          className="max-w-md space-y-1"
        >
          <div className="flex items-center gap-2">
            <label htmlFor="objetivo-empresa" className="text-sm">
              Food cost objetivo (%)
            </label>
            <input
              id="objetivo-empresa"
              name="porcentaje"
              inputMode="decimal"
              defaultValue={objetivos.empresaPct ?? ""}
              placeholder={`${FOOD_COST_OBJETIVO_PCT} (por defecto)`}
              className="w-40 rounded border px-3 py-2"
            />
            <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
              Guardar
            </button>
          </div>
        </FormConResultado>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Por categoría</h2>
        {categorias.length === 0 ? (
          <p className="text-sm text-neutral-500">Todavía no hay categorías activas.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-neutral-500">
                <th className="py-2">Categoría</th>
                <th>Rige</th>
                <th>Objetivo propio (%)</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-2">{c.nombre}</td>
                  <td>{resolverObjetivoFoodCost(objetivos, c.id)} %</td>
                  <td>
                    <FormConResultado
                      accion={async (formData: FormData) => {
                        "use server";
                        return guardarMargenObjetivo(c.id, String(formData.get("porcentaje") ?? ""));
                      }}
                    >
                      <div className="flex items-center gap-2 py-1">
                        <input
                          name="porcentaje"
                          aria-label={`Food cost objetivo de ${c.nombre} (%)`}
                          inputMode="decimal"
                          defaultValue={objetivos.porCategoria.get(c.id) ?? ""}
                          placeholder="el de la empresa"
                          className="w-40 rounded border px-3 py-1"
                        />
                        <button type="submit" className="text-sm underline">
                          Guardar
                        </button>
                      </div>
                    </FormConResultado>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
