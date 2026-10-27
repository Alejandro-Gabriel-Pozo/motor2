import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVerDeAlgunaDelMenu } from "@/server/acceso/gate";
import { listarStockMinimo } from "@/server/actions/stock/stock-minimo";
import { listarSeccionesHabituales } from "@/server/actions/stock/seccion-habitual";
import { listarFrecuenciasConteo } from "@/server/actions/stock/frecuencia-conteo";
import { EDITORES_DE_PARAMETROS, PESTANAS_DE_CONFIGURACION, RUTA_CONFIGURACION, armarParametrosPorInsumo, type ParametrosDeUnInsumo } from "@/core/stock/public";
import { FilaDeStock } from "@/components/fila-de-stock";
import { Enlace } from "@/ui/primitivas/enlace";

/**
 * Stock › Configuración (Fase 7, DEC-27; diseño en `docs/diseno-modulo-stock-2026-10-27.md`): la entrada del menú y su primera pestaña, «Parámetros por insumo». La entrada reúne pantallas de los dos
 * contextos (parámetros y depósitos de la sucursal; motivos y destinos de la empresa), así que la guarda es la de «alguna de» con el cálculo del menú (cada clave en su contexto); las claves son las del
 * `algunaDe` del ítem del menú (un test lo comprueba).
 *
 * La tabla es de LECTURA: junta, por producto, lo que muestran los tres editores (mínimo, depósito habitual y frecuencia de conteo) en la sucursal activa. Cada columna se muestra solo si el rol tiene el
 * «Ver» de su clave, y el enlace «Cambiar» solo si tiene el «Editar» (DEC-33); cada editor se protege igual con su propia clave. Cambiar los tres en una sola ventana (la emulación) queda PENDIENTE (P-1).
 */
export default async function ConfiguracionDeStockPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeAlgunaDelMenu(
    ctx.usuarioId,
    ctx.empresaId,
    ctx.sucursalId,
    ["stock_minimo", "stock_seccion_habitual", "conteo_frecuencia", "secciones", "motivos_merma", "motivos_destino_consumo"],
    ctx.db,
  );
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;

  const ve = { minimo: gate.visibles.has("stock_minimo"), habitual: gate.visibles.has("stock_seccion_habitual"), frecuencia: gate.visibles.has("conteo_frecuencia") };
  const veAlguno = ve.minimo || ve.habitual || ve.frecuencia;
  const [minimos, habituales, frecuencias, nivelMinimo, nivelHabitual, nivelFrecuencia] = await Promise.all([
    ve.minimo ? listarStockMinimo(ctx.sucursalId) : undefined,
    ve.habitual ? listarSeccionesHabituales(ctx.sucursalId) : undefined,
    ve.frecuencia ? listarFrecuenciasConteo(ctx.sucursalId) : undefined,
    ve.minimo ? obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "stock_minimo", ctx.db) : undefined,
    ve.habitual ? obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "stock_seccion_habitual", ctx.db) : undefined,
    ve.frecuencia ? obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "conteo_frecuencia", ctx.db) : undefined,
  ]);
  const edita = { minimo: Boolean(nivelMinimo?.editar), habitual: Boolean(nivelHabitual?.editar), frecuencia: Boolean(nivelFrecuencia?.editar) };
  const filas = armarParametrosPorInsumo({
    minimos: minimos?.map((m) => ({ ...m, minimo: Number(m.minimo) })),
    habituales,
    frecuencias,
  });
  const editores = EDITORES_DE_PARAMETROS.filter((e) => gate.visibles.has(e.accion));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold">{veAlguno ? "Configuración · Parámetros por insumo" : "Configuración de stock"}</h1>
        <p className="text-sm text-tinta-tenue">Depósitos, motivos de merma, destinos de consumo y los parámetros de cada insumo en «{ctx.sucursalNombre}».</p>
      </div>
      <FilaDeStock ctx={ctx} etiqueta="Qué configurar" pestanas={PESTANAS_DE_CONFIGURACION} ruta={RUTA_CONFIGURACION} visibles={gate.visibles} />

      {!veAlguno ? (
        <p className="text-sm text-tinta-suave">Tu rol no ve los parámetros por insumo de esta sucursal. Elegí arriba qué configurar.</p>
      ) : (
        <section aria-label="Parámetros por insumo" className="flex flex-col gap-3">
          <p className="max-w-prose text-sm text-tinta-suave">
            Una fila por insumo con algo configurado en «{ctx.sucursalNombre}». Cada dato se cambia en su editor, con su propio permiso.
          </p>
          {editores.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {editores.map((e) => (
                <li key={e.href}>
                  <Enlace href={e.href}>{e.texto}</Enlace>
                </li>
              ))}
            </ul>
          )}
          {filas.length === 0 ? (
            <p className="text-sm text-tinta-suave">Ningún insumo tiene parámetros cargados en «{ctx.sucursalNombre}» todavía.</p>
          ) : (
            <div role="region" aria-label="Parámetros por insumo" tabIndex={0} className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-tinta-tenue">
                    <th scope="col" className="py-2">
                      Insumo
                    </th>
                    {ve.minimo && <th scope="col">Stock mínimo</th>}
                    {ve.minimo && <th scope="col">Mínimo por depósito</th>}
                    {ve.habitual && <th scope="col">Depósito habitual</th>}
                    {ve.frecuencia && <th scope="col">Frecuencia de conteo</th>}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <FilaDeParametros key={f.productoId} fila={f} ve={ve} edita={edita} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const SIN_CARGAR = <span className="text-tinta-tenue">Sin cargar</span>;

/** Un enlace «Cambiar» al editor, con el nombre del dato y del insumo para el lector de pantalla; solo para quien puede editarlo. */
function Cambiar({ href, dato, insumo }: { href: string; dato: string; insumo: string }) {
  return (
    <Enlace href={href} aria-label={`Cambiar ${dato} de ${insumo}`} className="ml-2">
      Cambiar
    </Enlace>
  );
}

function FilaDeParametros({
  fila: f,
  ve,
  edita,
}: {
  fila: ParametrosDeUnInsumo;
  ve: { minimo: boolean; habitual: boolean; frecuencia: boolean };
  edita: { minimo: boolean; habitual: boolean; frecuencia: boolean };
}) {
  return (
    <tr className="border-b align-top">
      <td className="py-2">{f.productoNombre}</td>
      {ve.minimo && (
        <td className="py-2">
          {f.minimoGlobal ? (
            <>
              {f.minimoGlobal.minimo.toLocaleString("es-AR")}
              {edita.minimo && <Cambiar href={`/stock/minimo?editar=${f.minimoGlobal.id}`} dato="el stock mínimo" insumo={f.productoNombre} />}
            </>
          ) : (
            SIN_CARGAR
          )}
        </td>
      )}
      {ve.minimo && (
        <td className="py-2">
          {f.minimosPorDeposito.length === 0 ? (
            SIN_CARGAR
          ) : (
            <ul className="flex flex-col gap-0.5">
              {f.minimosPorDeposito.map((m) => (
                <li key={m.id}>
                  {m.deposito}: {m.minimo.toLocaleString("es-AR")}
                  {edita.minimo && <Cambiar href={`/stock/minimo?editar=${m.id}`} dato={`el mínimo en ${m.deposito}`} insumo={f.productoNombre} />}
                </li>
              ))}
            </ul>
          )}
        </td>
      )}
      {ve.habitual && (
        <td className="py-2">
          {f.depositoHabitual ? (
            <>
              {f.depositoHabitual.deposito}
              {edita.habitual && <Cambiar href={`/stock/seccion-habitual?editar=${f.depositoHabitual.id}`} dato="el depósito habitual" insumo={f.productoNombre} />}
            </>
          ) : (
            SIN_CARGAR
          )}
        </td>
      )}
      {ve.frecuencia && (
        <td className="py-2">
          {f.frecuencia ? (
            <>
              {f.frecuencia.dias === 0 ? "Desactivada" : `Cada ${f.frecuencia.dias} día(s)`}
              {edita.frecuencia && <Cambiar href={`/stock/conteo-frecuencia?editar=${f.frecuencia.id}`} dato="la frecuencia de conteo" insumo={f.productoNombre} />}
            </>
          ) : (
            SIN_CARGAR
          )}
        </td>
      )}
    </tr>
  );
}
