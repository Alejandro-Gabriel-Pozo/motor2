import Link from "next/link";
import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { requierePermisoDeEmpresa, requierePermisoVerDeEmpresa } from "@/server/acceso/gate";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { archivarOpciones } from "@/server/actions/catalogo/opciones-de-venta";
import { listarCandidatosALimpiar } from "@/server/consultas/catalogo/limpieza-de-opciones";
import { AvisoConDeshacer } from "@/components/aviso-con-deshacer";
import { LimpiarOpciones } from "./limpiar-opciones";

/**
 * «Limpiar» las opciones de venta (OPCIONES-LIMPIEZA, G2; decisión del dueño: achicar la carta sin dejar ruido, desde el celular). Es una página de EDICIÓN de la familia de
 * `/catalogo/opciones` (`opciones_definir`): entrar pide el «Ver» y además el «Editar» en el servidor (lo único que hace es archivar). Lista los grupos y las opciones en uso que no
 * se usan (sin productos, o sin ventas en 30, 90 o 180 días), deja elegir varios y los archiva de una vez con `archivarOpciones` (todo o nada, una auditoría por elemento), con la
 * vista previa de los productos afectados y «Deshacer» para restaurar el lote. No borra nada (el borrado definitivo no existe todavía: fila O.492).
 *
 * Los datos se leen con la base de VERIFICACIÓN (`lecturaDeVerificacionEnLaEmpresa`): si un producto disponible en ALGUNA sucursal usa algo, o si se vendió en ALGUNA sucursal, no es
 * candidato (con la base de la sucursal activa se propondría archivar lo que se vende en otra). De las ventas solo llega un sí o no por período.
 *
 * El closure "use server" no captura nada: los ids los manda la pantalla y el servidor los vuelve a validar (formato en el guard; que sean de la empresa, en el caso de uso).
 */
export default async function LimpiarOpcionesPage() {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario (el mismo de las Server Actions de lectura), antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVerDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const gateEditar = await requierePermisoDeEmpresa(ctx.usuarioId, ctx.empresaId, "opciones_definir", ctx.db);
  if (!gateEditar.ok) return <p className="text-red-600">{gateEditar.mensaje}</p>;

  const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx);
  const datos = await listarCandidatosALimpiar(verificacion.db, new Date());

  return (
    <AvisoConDeshacer>
      <div className="flex max-w-2xl flex-col gap-5 pb-24">
        <div className="flex flex-col gap-1">
          <Link href="/catalogo/opciones" className="text-sm underline">
            ← Opciones de venta
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Limpiar opciones</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Lo que no se usa, archivado de una vez: deja de ofrecerse en la venta y en la carta, se restaura cuando quieras y lo ya vendido queda como se vendió. Nada se borra.
          </p>
        </div>
        <LimpiarOpciones
          grupos={datos.grupos}
          nombresDeProductos={datos.nombresDeProductos}
          accion={async (grupoIds: string[], opcionIds: string[], archivar: boolean) => {
            "use server";
            return archivarOpciones({ grupoIds, opcionIds, archivar });
          }}
        />
      </div>
    </AvisoConDeshacer>
  );
}
