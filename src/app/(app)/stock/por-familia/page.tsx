import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoVer } from "@/server/acceso/gate";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_EXISTENCIAS } from "@/core/stock/public";
import type { AccionClave } from "@/core/permisos/acciones";
import { calcularStockPorFamilia } from "@/server/consultas/stock/por-familia";

const VER_STOCK: ReadonlySet<AccionClave> = new Set<AccionClave>(["ver_stock"]);

export default async function StockPorFamiliaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const filas = await calcularStockPorFamilia(ctx.sucursalId, ctx.db);

  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">Existencias · Por familia</h1>
      {/* DEC-27: las tres pestañas de Existencias se ven con ver_stock, que la guarda de arriba ya aprobó. */}
      <div className="mb-4">
        <FilaDeStock ctx={ctx} etiqueta="Qué existencias ver" pestanas={PESTANAS_DE_EXISTENCIAS} ruta="/stock/por-familia" visibles={VER_STOCK} />
      </div>
      <p className="mb-4 text-sm text-tinta-tenue">
        Agrupa el stock de todos los productos (distintos proveedores/presentaciones) que comparten el mismo Insumo — solo MP con Insumo asignado.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-tinta-tenue">
            <th className="py-2">Grupo</th>
            <th>Insumo</th>
            <th>Sección</th>
            <th>Saldo</th>
            <th>Productos incluidos</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.insumoId}-${f.seccionId}-${i}`} className="border-b">
              <td className="py-2">{f.grupoCadena || "Sin grupo"}</td>
              <td>{f.insumoNombre}</td>
              <td>{f.seccionNombre}</td>
              <td>
                {f.unidadesMezcladas ? (
                  <span className="text-aviso-tinta" title="Unidades de stock distintas entre los productos de este Insumo — total no confiable">
                    Unidades mezcladas
                  </span>
                ) : (
                  `${f.saldo} ${f.unidadStockNombre ?? ""}`
                )}
              </td>
              <td className="text-tinta-tenue">{f.productos.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filas.length && <p className="text-sm text-tinta-tenue">Ningún producto con movimientos tiene un Insumo asignado todavía.</p>}
    </div>
  );
}
