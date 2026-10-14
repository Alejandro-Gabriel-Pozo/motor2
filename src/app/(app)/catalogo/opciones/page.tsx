import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { archivarOpciones, crearGrupoDeOpciones } from "@/server/actions/catalogo/opciones-de-venta";
import { listarGruposDelPanel, type GrupoDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { nombreDelTipoDeGrupo, textoDeLimites } from "@/core/opciones/public";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { AvisoConDeshacer, BotonConDeshacer } from "@/components/aviso-con-deshacer";
import { TablaDeDatos, type ColumnaDeTabla } from "@/ui/componentes/datos/tabla-de-datos";
import { AltaDeGrupo } from "./alta-de-grupo";

/**
 * «Opciones de venta» (GO-2d; ADR-030): los grupos de opciones de la empresa (tamaños, variantes, lo incluido sin costo y los adicionales con recargo). Entrar pide el «Ver»
 * de `opciones_definir`; el alta se dibuja solo con «Editar» (cortesía de la interfaz: la acción vuelve a exigir el permiso). El detalle de cada grupo (sus opciones y sus
 * cambios de precio) está en `/catalogo/opciones/[grupoId]`, de la misma familia y con la misma clave.
 *
 * OPCIONES-LIMPIEZA: la tabla muestra solo los grupos en uso; los ARCHIVADOS van aparte, con «Restaurar» de un toque (y su «Deshacer»). Archivar un grupo se hace en su pantalla.
 *
 * Los closures "use server" capturan solo textos y ids: lo que captura viaja al cliente.
 */
export default async function OpcionesDeVentaPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const [{ editar: puedeEditar }, grupos] = await Promise.all([obtenerMiNivelPermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db), listarGruposDelPanel(ctx.db)]);

  const columnas: ColumnaDeTabla<GrupoDelPanel>[] = [
    {
      id: "nombre",
      encabezado: "Grupo",
      titulo: true,
      celda: (g) => (
        <Link href={`/catalogo/opciones/${g.id}`} className="font-medium underline">
          {g.nombre}
        </Link>
      ),
    },
    { id: "tipo", encabezado: "Tipo", celda: (g) => nombreDelTipoDeGrupo(g.tipo) },
    { id: "limites", encabezado: "Cuántas se eligen", celda: (g) => textoDeLimites(g.cantidadMinima, g.cantidadMaxima) },
    { id: "opciones", encabezado: "Opciones", alinear: "derecha", celda: (g) => g.opcionesActivas },
    { id: "productos", encabezado: "Productos que lo usan", alinear: "derecha", celda: (g) => g.productosQueLoAdmiten },
  ];
  const enUso = grupos.filter((g) => g.activo);
  const archivados = grupos.filter((g) => !g.activo);

  return (
    <AvisoConDeshacer>
      <div className="flex max-w-4xl flex-col gap-6 pb-24">
        <div>
          <h1 className="text-xl font-semibold">Opciones de venta</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Los tamaños, las variantes, lo que viene incluido y los adicionales que se pueden elegir al vender un producto. Acá se arman los grupos; qué grupos usa cada producto
            se elige en su ficha.
          </p>
        </div>

        <TablaDeDatos
          titulo="Grupos de opciones"
          columnas={columnas}
          filas={enUso}
          claveDeFila={(g) => g.id}
          vacio={
            archivados.length > 0
              ? "No hay grupos en uso: los que había están archivados (abajo)."
              : puedeEditar
                ? "Todavía no hay grupos de opciones. Creá el primero con «Nuevo grupo»."
                : "Todavía no hay grupos de opciones."
          }
        />

        {archivados.length > 0 && (
          <section aria-labelledby="titulo-archivados" className="flex flex-col gap-2">
            <h2 id="titulo-archivados" className="font-medium">
              Archivados ({archivados.length})
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">No se ofrecen en ningún producto ni en la carta. Lo ya vendido queda como se vendió. Restaurar los vuelve a ofrecer donde estaban.</p>
            <ul aria-label="Grupos archivados" className="flex flex-col gap-2">
              {archivados.map((g) => {
                const grupoId = g.id;
                return (
                  <li key={g.id} data-grupo-archivado={g.nombre} className="flex flex-wrap items-center gap-3 border border-[#cdd5dd] bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
                    <div className="min-w-0 flex-1">
                      <Link href={`/catalogo/opciones/${g.id}`} className="font-medium underline [overflow-wrap:anywhere]">
                        {g.nombre}
                      </Link>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400">
                        {nombreDelTipoDeGrupo(g.tipo)} · {g.opcionesActivas === 1 ? "1 opción" : `${g.opcionesActivas} opciones`}
                      </p>
                    </div>
                    {puedeEditar && (
                      <BotonConDeshacer
                        valor={false}
                        etiquetaAccesible={`Restaurar ${g.nombre}`}
                        accion={async (archivar: boolean) => {
                          "use server";
                          return archivarOpciones({ grupoIds: [grupoId], opcionIds: [], archivar });
                        }}
                      >
                        Restaurar
                      </BotonConDeshacer>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {puedeEditar && (
          <section aria-labelledby="titulo-nuevo-grupo" className="flex flex-col gap-2">
            <h2 id="titulo-nuevo-grupo" className="font-medium">
              Nuevo grupo
            </h2>
            <AgregarColapsable etiqueta="Nuevo grupo">
              <AltaDeGrupo
                accion={async (formData: FormData) => {
                  "use server";
                  return crearGrupoDeOpciones({
                    nombre: String(formData.get("nombre") ?? ""),
                    tipo: String(formData.get("tipo") ?? ""),
                    // numeroDelCampo (no Number(...) a secas): un texto inválido llega como NaN y el servidor lo rechaza con su mensaje, nunca un 0 falso.
                    cantidadMinima: numeroDelCampo(String(formData.get("cantidadMinima") ?? "")),
                    cantidadMaxima: numeroDelCampo(String(formData.get("cantidadMaxima") ?? "")),
                  });
                }}
              />
            </AgregarColapsable>
          </section>
        )}
      </div>
    </AvisoConDeshacer>
  );
}
