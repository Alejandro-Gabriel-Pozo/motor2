import { obtenerContextoUsuario } from "@/server/sesion/contexto";
import { irAlLogin } from "@/server/sesion/ir-al-login";
import { MENSAJE_DEMASIADAS_LECTURAS, lecturaSinCupo } from "@/server/actions/limitador-de-lecturas";
import { obtenerMiNivelPermiso, requierePermisoVer } from "@/server/acceso/gate";
import { agregarPlatoDelDia, copiarMenuDelDiaAnterior, quitarPlatoDelDia } from "@/server/actions/carta/menu-del-dia";
import { cargarMenuDelDia } from "@/server/consultas/carta/menu-del-dia";
import { unicosDeUrl, type ParametrosDeUrl } from "@/core/datos/parametros-de-url";
import { AvisoConDeshacer } from "@/components/aviso-con-deshacer";
import { MenuDelDia } from "./menu-del-dia";

/**
 * «Menú del día» de la sucursal activa (GO-3b, ADR-032, F6 paso U2; clave `promo_menu_del_dia`: de sucursal, piso operario, delegable al encargado). Por día (de hoy a hoy + 13, en la zona de la
 * empresa), qué plato va en cada lugar del día de las promos («Plato del día» del «Menú del día»): elegir de los productos existentes, quitar y copiar lo del día anterior. Falla cerrado: un lugar sin
 * plato hoy no deja vender la promo (lo dice el POS). Entrar pide «Ver»; cambiar, «Editar» (cortesía: cada acción vuelve a exigirlo y compara la sucursal que vio la pantalla con la activa).
 */
export default async function MenuDelDiaPage({ searchParams }: { searchParams: Promise<ParametrosDeUrl<"fecha">> }) {
  const ctx = await obtenerContextoUsuario();
  if (!ctx) return irAlLogin();
  // S-28 (I-3, B31): cupo de lecturas por usuario, antes del gate y de la consulta.
  if (lecturaSinCupo(ctx.usuarioId, new Date().getTime())) return <p className="text-red-600">{MENSAJE_DEMASIADAS_LECTURAS}</p>;

  const gate = await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "promo_menu_del_dia", ctx.db);
  if (!gate.ok) return <p className="text-red-600">{gate.mensaje}</p>;
  const { fecha } = unicosDeUrl(await searchParams);
  const [{ editar: puedeCambiar }, datos] = await Promise.all([
    obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "promo_menu_del_dia", ctx.db),
    cargarMenuDelDia(ctx.db, { sucursalId: ctx.sucursalId, ahora: new Date(), zonaHoraria: ctx.empresaZonaHoraria, ...(fecha ? { fecha } : {}) }),
  ]);
  const sucursalId = ctx.sucursalId;

  return (
    <div className="flex max-w-3xl flex-col gap-6 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Menú del día en «{ctx.sucursalNombre}»</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Elegí qué plato va cada día en cada lugar del menú. Sin plato cargado, el salón no puede vender ese menú ese día (nunca se usa el de ayer sin que lo copies).
        </p>
      </div>
      {datos.lugares.length === 0 ? (
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">
          Todavía no hay promos con un lugar «del día». Se arman en Carta → Promociones (un lugar de tipo «del día»).
        </p>
      ) : (
        <AvisoConDeshacer>
          <MenuDelDia
            datos={datos}
            puedeCambiar={puedeCambiar}
            agregar={async (cupoId: string, productoId: string, dia: string) => {
              "use server";
              return agregarPlatoDelDia({ sucursalId, cupoId, fecha: dia, productoId });
            }}
            quitar={async (platoId: string) => {
              "use server";
              return quitarPlatoDelDia({ sucursalId, platoId });
            }}
            copiar={async (dia: string) => {
              "use server";
              return copiarMenuDelDiaAnterior({ sucursalId, fecha: dia });
            }}
          />
        </AvisoConDeshacer>
      )}
    </div>
  );
}
