import "server-only";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { rechazoDeComponenteDeCombo } from "@/core/pos/public";
import { diaDeCalendario, fechaDeColumnaDate, sumarDias } from "@/core/tiempo/zona-horaria";
import { cargarProductosComoComponentes } from "@/server/lecturas/carta/componentes-de-promo";
import { DIAS_DE_ANTICIPACION_DEL_MENU, seleccionDeSucursalDePromo, type CandidatoAPlato, type MenuDelDiaDeLaSucursal } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * La CONSULTA de la pantalla «Menú del día» (GO-3b, ADR-032, F6 paso U2): para la sucursal ACTIVA y un día (de hoy a hoy + 13, en la zona de la empresa), los lugares del día de las promos
 * activas de la empresa (cupos DEL_DIA activos) con los platos cargados ese día, y los productos que se pueden elegir (PV disponibles en la sucursal), cada uno con el aviso de por qué no podría
 * ser plato (sin receta, sin precio: la misma regla que valida el servidor al cargarlo, `rechazoDeComponenteDeCombo`). Lo decide y lo escribe el servidor; esto solo muestra. Sin guarda de
 * permiso adentro: la página la pone antes (`promo_menu_del_dia`). La RLS por sucursal deja ver solo los platos de la activa.
 */

export async function cargarMenuDelDia(db: Db, args: { sucursalId: string; ahora: Date; zonaHoraria: string; fecha?: string }): Promise<MenuDelDiaDeLaSucursal> {
  const hoy = diaDeCalendario(args.ahora, args.zonaHoraria);
  const dias = Array.from({ length: DIAS_DE_ANTICIPACION_DEL_MENU + 1 }, (_x, i) => sumarDias(hoy, i));
  const fecha = args.fecha && dias.includes(args.fecha) ? args.fecha : hoy;
  const cupos = await db.promoCartaCupo.findMany({
    where: { tipo: "DEL_DIA", activo: true, promoCarta: { activa: true } },
    orderBy: [{ promoCarta: { titulo: "asc" } }, { orden: "asc" }, { id: "asc" }],
    select: { id: true, nombre: true, promoCarta: { select: { id: true, titulo: true, sucursales: seleccionDeSucursalDePromo(args.sucursalId) } } },
  });
  const cupoIds = cupos.map((c) => c.id);
  const [platos, delDiaAnterior, disponibles] = await Promise.all([
    cupoIds.length
      ? db.entradaDelDiaDeCupo.findMany({
          where: { cupoId: { in: cupoIds }, sucursalId: args.sucursalId, fecha: fechaDeColumnaDate(fecha), activa: true },
          orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
          select: { id: true, cupoId: true, productoId: true, producto: { select: { nombre: true } } },
        })
      : Promise.resolve([]),
    cupoIds.length ? db.entradaDelDiaDeCupo.count({ where: { cupoId: { in: cupoIds }, sucursalId: args.sucursalId, fecha: fechaDeColumnaDate(sumarDias(fecha, -1)), activa: true } }) : Promise.resolve(0),
    db.producto.findMany({ where: { tipo: "PV", ...whereDisponibleEn(args.sucursalId) }, orderBy: [{ nombre: "asc" }, { id: "asc" }], select: { id: true, nombre: true } }),
  ]);
  const comoComponentes = await cargarProductosComoComponentes(db, { sucursalId: args.sucursalId, productoIds: disponibles.map((p) => p.id) });
  const candidatos = disponibles.map((p): CandidatoAPlato => {
    const leido = comoComponentes.get(p.id);
    const rechazo = leido ? rechazoDeComponenteDeCombo({ ...leido, precioDeReferencia: leido.precioVenta }) : null;
    // Un plato del día no lleva opciones (D-6): un producto con un grupo obligatorio no se puede elegir.
    const conObligatorio = leido?.opciones.grupos.some((g) => g.admitido && g.activo && g.cantidadMinima > 0) ?? false;
    return { productoId: p.id, nombre: p.nombre, aviso: rechazo?.mensaje ?? (conObligatorio ? `«${p.nombre}» se pide con opciones: no puede ser plato del día.` : null) };
  });
  return {
    hoy,
    fecha,
    dias,
    lugares: cupos.map((c) => ({
      cupoId: c.id,
      nombre: c.nombre ?? "Plato del día",
      promoCartaId: c.promoCarta.id,
      promoTitulo: c.promoCarta.titulo,
      ofrecidaAca: c.promoCarta.sucursales[0]?.activa ?? false,
      platos: platos.filter((p) => p.cupoId === c.id).map((p) => ({ platoId: p.id, productoId: p.productoId, nombre: p.producto.nombre })),
    })),
    candidatos,
    hayDiaAnterior: delDiaAnterior > 0,
  };
}
