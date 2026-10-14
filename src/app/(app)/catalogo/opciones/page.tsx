import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { crearGrupoDeOpciones } from "@/server/actions/catalogo/opciones-de-venta";
import { listarGruposDelPanel, type GrupoDelPanel } from "@/server/consultas/catalogo/opciones-de-venta";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { nombreDelTipoDeGrupo, textoDeLimites } from "@/core/opciones/public";
import { AgregarColapsable } from "@/components/agregar-colapsable";
import { TablaDeDatos, type ColumnaDeTabla } from "@/ui/componentes/datos/tabla-de-datos";
import { AltaDeGrupo } from "./alta-de-grupo";

/**
 * «Opciones de venta» (GO-2d; ADR-030): los grupos de opciones de la empresa (tamaños, variantes, lo incluido sin costo y los adicionales con recargo). Entrar pide el «Ver»
 * de `opciones_definir`; el alta se dibuja solo con «Editar» (cortesía de la interfaz: la acción vuelve a exigir el permiso). El detalle de cada grupo (sus opciones y sus
 * cambios de precio) está en `/catalogo/opciones/[grupoId]`, de la misma familia y con la misma clave.
 *
 * El closure "use server" del alta captura solo textos: lo que captura viaja al cliente.
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
    { id: "estado", encabezado: "Estado", celda: (g) => (g.activo ? "Prendido" : "Apagado") },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
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
        filas={grupos}
        claveDeFila={(g) => g.id}
        vacio={puedeEditar ? "Todavía no hay grupos de opciones. Creá el primero con «Nuevo grupo»." : "Todavía no hay grupos de opciones."}
      />

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
  );
}
