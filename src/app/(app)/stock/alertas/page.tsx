import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { listarStockMinimo } from "@/server/actions/stock/stock-minimo";
import { Enlace } from "@/ui/primitivas/enlace";
import { FilaDeStock } from "@/components/fila-de-stock";
import { PESTANAS_DE_EXISTENCIAS, filaDeMinimoQueRige } from "@/core/stock/public";
import type { AccionClave } from "@/core/permisos/acciones";
import { calcularAlertasStock } from "@/server/consultas/stock/alertas";
import { diaDeCalendario } from "@/core/tiempo/zona-horaria";

const VER_STOCK: ReadonlySet<AccionClave> = new Set<AccionClave>(["ver_stock"]);

export default async function AlertasStockPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "ver_stock", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  // DEC-27, atajo «Cambiar mínimo»: solo para quien puede EDITAR el mínimo (DEC-33); abre el editor sobre la fila que rige la alerta (la del depósito, si no la global), que guarda con el valor visto.
  const [alertas, { editar: cambiaMinimo }] = await Promise.all([
    calcularAlertasStock(ctx.sucursalId, ctx.db),
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "stock_minimo", ctx.db),
  ]);
  const minimos = cambiaMinimo && alertas.length > 0 ? await listarStockMinimo(ctx.sucursalId) : [];
  const criticos = alertas.filter((a) => a.estado === "CRITICO").length;
  const bajos = alertas.filter((a) => a.estado === "BAJO").length;

  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">Existencias · Alertas</h1>
      {/* DEC-27: las tres pestañas de Existencias se ven con ver_stock, que la guarda de arriba ya aprobó. */}
      <div className="mb-4">
        <FilaDeStock ctx={ctx} etiqueta="Qué existencias ver" pestanas={PESTANAS_DE_EXISTENCIAS} ruta="/stock/alertas" visibles={VER_STOCK} />
      </div>
      <p className="mb-4 text-sm text-tinta-tenue">
        {alertas.length ? `${criticos} crítico(s), ${bajos} bajo(s).` : "Sin alertas — todo por encima de su Stock Mínimo configurado."}
      </p>
      {alertas.length > 0 && !cambiaMinimo && (
        <p className="mb-3 text-sm text-tinta-suave">Cambiar un mínimo pide el permiso de edición de «Stock mínimo»: tu rol solo puede ver las alertas.</p>
      )}
      <div role="region" aria-label="Alertas de stock" tabIndex={0} className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-tinta-tenue">
              <th className="py-2">Insumo</th>
              <th>Depósito</th>
              <th>Saldo actual</th>
              <th>Mínimo</th>
              <th>Diferencia</th>
              <th>Estado</th>
              <th>Último movimiento</th>
              {cambiaMinimo && (
                <th>
                  <span className="sr-only">Acción</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {alertas.map((a) => {
              const fila = cambiaMinimo ? filaDeMinimoQueRige(minimos, a.productoId, a.seccionId) : null;
              return (
                <tr key={`${a.productoId}-${a.seccionId}`} className="border-b">
                  <td className="py-2">
                    {a.productoCodigo} — {a.productoNombre}
                  </td>
                  <td>{a.seccionNombre}</td>
                  <td>{a.saldoActual}</td>
                  <td>{a.stockMinimo}</td>
                  <td>{a.diferencia}</td>
                  <td className={a.estado === "CRITICO" ? "text-error font-medium" : "text-aviso-tinta"}>{a.estado === "CRITICO" ? "Crítico" : "Bajo"}</td>
                  <td className="text-tinta-tenue">{a.ultimaFecha ? diaDeCalendario(a.ultimaFecha, ctx.empresaZonaHoraria) : "—"}</td>
                  {cambiaMinimo && (
                    <td className="whitespace-nowrap">
                      {fila && (
                        <Enlace href={`/stock/minimo?editar=${fila.id}`} aria-label={`Cambiar mínimo de ${a.productoNombre} en ${a.seccionNombre}`}>
                          Cambiar mínimo
                        </Enlace>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
