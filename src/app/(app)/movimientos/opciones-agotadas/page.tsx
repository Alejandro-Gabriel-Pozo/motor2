import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { PESTANAS_DE_CARTA } from "@/core/carta/public";
import { FilaDeCarta } from "@/components/fila-de-carta";
import { EnlaceInterno } from "@/components/enlace-interno";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { apagarOpcionEnSucursal } from "@/server/actions/catalogo/opciones-por-sucursal";
import { cargarOpcionesDeLaSucursal } from "@/server/consultas/catalogo/opciones-por-sucursal";
import { OpcionesAgotadas } from "./opciones-agotadas";
import { Aviso } from "@/ui/primitivas/aviso";

/**
 * «Opciones agotadas» de la sucursal activa (GO-2d; ADR-030 §5, clave `opcion_apagar_en_sucursal`: de sucursal, piso operario, delegable al encargado del turno). Lo que se acabó
 * hoy: una opción agotada no se ofrece en el POS ni en la carta pública de ESTA sucursal (en las otras sigue igual). Queda agotada hasta que alguien la vuelva a prender: no se prende
 * sola al terminar el día (decisión del dueño; hacerlo cambiaría el esquema). Entrar pide «Ver»; cambiar, «Editar» (cortesía: la acción vuelve a exigirlo).
 *
 * El closure "use server" recibe el id de la opción y el estado nuevo, y le pasa a la acción el ECO de la sucursal que vio la pantalla (la acción la compara con la activa).
 */
export default async function OpcionesAgotadasPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-error">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "opcion_apagar_en_sucursal", ctx.db);
  if (!gate.ok) return <p className="text-error">{gate.mensaje}</p>;
  const [{ editar: puedeCambiar }, datos] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "opcion_apagar_en_sucursal", ctx.db),
    cargarOpcionesDeLaSucursal(ctx.db, ctx.sucursalId),
  ]);
  const sucursalId = ctx.sucursalId;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <FilaDeCarta ctx={ctx} etiqueta="Carta" pestanas={PESTANAS_DE_CARTA} ruta="/movimientos/opciones-agotadas" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Opciones agotadas en «{ctx.sucursalNombre}»</h1>
        <p className="text-sm text-tinta-suave">
          Lo que se acabó hoy: tocá una opción para marcarla agotada. No se ofrece en el salón ni en la carta de esta sucursal hasta que la vuelvas a prender (no se prende sola). Un plato entero se agota en{" "}
          <EnlaceInterno href="/carta" className="underline">
            Carta › Hoy
          </EnlaceInterno>
          .
        </p>
        <Aviso variante="informacion" forma="en-linea" data-agotadas-ahora>
          <span className="font-medium text-tinta">Agotadas ahora: {datos.agotadasAhora}</span>
        </Aviso>
      </div>

      {datos.sinPoderVenderse.length > 0 && (
        <section aria-labelledby="titulo-sin-vender" className="rounded border border-aviso-tinta p-3 text-sm text-aviso-tinta">
          <h2 id="titulo-sin-vender" className="font-medium">
            Con esto, hoy no se pueden vender en «{ctx.sucursalNombre}»:
          </h2>
          <ul className="list-disc pl-5" data-sin-vender>
            {datos.sinPoderVenderse.map((p) => (
              <li key={p.productoId}>
                «{p.nombre}»: no queda ninguna opción de {p.grupos.map((g) => `«${g}»`).join(" ni de ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos.grupos.length === 0 ? (
        <Aviso variante="informacion" forma="en-linea">
          La empresa todavía no tiene opciones de venta.
        </Aviso>
      ) : (
        <OpcionesAgotadas
          grupos={datos.grupos}
          puedeCambiar={puedeCambiar}
          accion={async (opcionId: string, apagada: boolean) => {
            "use server";
            return apagarOpcionEnSucursal({ sucursalId, opcionId, apagada });
          }}
        />
      )}
    </div>
  );
}
