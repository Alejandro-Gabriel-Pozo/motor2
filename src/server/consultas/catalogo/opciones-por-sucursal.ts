import "server-only";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { opcionDisponible } from "@/core/pos/public";
import { filasDePrecioLocalDeOpcionesEnSucursal } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { listarGruposDeOpciones, opcionesApagadasEnSucursal } from "@/server/lecturas/catalogo/opciones-de-venta";
import { cargarOpcionesParaVender } from "@/server/lecturas/opciones/opciones-para-vender";
import { saldosTeoricosEnSucursal } from "@/server/consultas/stock/stock-teorico";
import type { Db } from "@/lib/db-tipos";

/**
 * Las CONSULTAS de lo que decide cada SUCURSAL sobre las opciones de venta (GO-2d; ADR-030 §5): la grilla del precio de un tamaño con precio propio y qué opciones están agotadas.
 * Las páginas leen por acá (regla `paginas-solo-consultas`); sin guarda de permiso adentro: la página la pone antes (`precio_local`, `opcion_apagar_en_sucursal`). Todo se lee para
 * la sucursal ACTIVA que recibe (la RLS por sucursal no deja ver otra).
 */

/** Una celda de la grilla: un tamaño que un producto cobra con precio propio, con el precio de la empresa y lo cargado en la sucursal (`null` = nada cargado: rige el de la empresa). */
export interface CeldaDeGrilla {
  productoId: string;
  productoNombre: string;
  grupoNombre: string;
  opcionId: string;
  opcionNombre: string;
  /** `ProductoAdmiteOpcion.precioAbsoluto`: el precio de la empresa en ese tamaño. */
  precioDeLaEmpresa: number | null;
  enLaSucursal: { precio: number; habilitado: boolean } | null;
}

/**
 * «Precios por tamaño en esta sucursal»: los tamaños que cada producto DISPONIBLE en la sucursal cobra con precio propio (grupo MEDIDA en ABSOLUTO, admitido y prendido; opción
 * admitida y prendida), con el precio de la empresa y la fila de la grilla de la sucursal (leída por el lector único, `precio-local-de-opciones.ts`). Dos consultas.
 */
export async function cargarGrillaDeTamanosDeLaSucursal(db: Db, sucursalId: string): Promise<CeldaDeGrilla[]> {
  const [admisiones, filas] = await Promise.all([
    db.productoAdmiteGrupo.findMany({
      where: { activo: true, modoPrecio: "ABSOLUTO", grupo: { tipo: "MEDIDA", activo: true }, producto: { tipo: "PV", ...whereDisponibleEn(sucursalId) } },
      orderBy: [{ producto: { nombre: "asc" } }, { orden: "asc" }],
      select: {
        productoId: true,
        producto: { select: { nombre: true, opcionesAdmitidas: { where: { activo: true, opcion: { activa: true } }, select: { opcionId: true, precioAbsoluto: true } } } },
        grupo: { select: { nombre: true, opciones: { where: { activa: true }, orderBy: [{ orden: "asc" }, { nombre: "asc" }], select: { id: true, nombre: true } } } },
      },
    }),
    filasDePrecioLocalDeOpcionesEnSucursal(db, sucursalId),
  ]);
  const cargada = new Map(filas.map((f) => [`${f.productoId}|${f.opcionId}`, f]));
  return admisiones.flatMap((a) => {
    const admitidas = new Map(a.producto.opcionesAdmitidas.map((o) => [o.opcionId, o]));
    return a.grupo.opciones.flatMap((o) => {
      const admitida = admitidas.get(o.id);
      if (!admitida) return [];
      const f = cargada.get(`${a.productoId}|${o.id}`);
      return [
        {
          productoId: a.productoId,
          productoNombre: a.producto.nombre,
          grupoNombre: a.grupo.nombre,
          opcionId: o.id,
          opcionNombre: o.nombre,
          precioDeLaEmpresa: admitida.precioAbsoluto === null ? null : Number(admitida.precioAbsoluto),
          enLaSucursal: f ? { precio: f.precio, habilitado: f.habilitado } : null,
        },
      ];
    });
  });
}

/** Un insumo de una opción que el sistema registra en 0 o menos en la sucursal (aviso, nunca bloqueo). */
export interface InsumoSinStock {
  productoId: string;
  nombre: string;
  unidadNombre: string;
  saldo: number;
}

export interface OpcionDeLaSucursal {
  opcionId: string;
  nombre: string;
  esNinguna: boolean;
  agotada: boolean;
  /** Solo si está DISPONIBLE: los insumos de su consumo (de lo que rige hoy) que el sistema registra en 0 o menos acá. */
  sinStockEnElSistema: InsumoSinStock[];
}

export interface OpcionesDeLaSucursal {
  grupos: { grupoId: string; nombre: string; opciones: OpcionDeLaSucursal[] }[];
  /** Los productos disponibles acá que hoy NO se pueden vender: un grupo obligatorio se quedó sin ninguna opción disponible (con los nombres de esos grupos). */
  sinPoderVenderse: { productoId: string; nombre: string; grupos: string[] }[];
  agotadasAhora: number;
}

/**
 * «Opciones agotadas» de la sucursal activa: las opciones prendidas de la empresa por grupo, si están agotadas ACÁ (la lectura de GO-2a, `opcionesApagadasEnSucursal`), qué productos
 * de la sucursal se quedaron sin poder venderse por eso (con la lectura de la venta, `cargarOpcionesParaVender`: la misma regla que aplica el POS) y, de cada opción disponible, los
 * insumos que el sistema registra en 0 o menos (`saldosTeoricosEnSucursal`: avisa, no bloquea). Sin N+1: cinco consultas en total.
 */
export async function cargarOpcionesDeLaSucursal(db: Db, sucursalId: string): Promise<OpcionesDeLaSucursal> {
  const [grupos, apagadas, conGrupos] = await Promise.all([
    listarGruposDeOpciones(db, { incluirInactivos: false }),
    opcionesApagadasEnSucursal(db, sucursalId),
    db.producto.findMany({ where: { tipo: "PV", ...whereDisponibleEn(sucursalId), gruposAdmitidos: { some: { activo: true } } }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
  ]);
  const agotada = new Set(apagadas.map((a) => a.opcionId));
  const insumoIds = grupos.flatMap((g) => g.opciones.flatMap((o) => (o.vigente?.consumos ?? []).map((c) => c.insumoProductoId)));
  const [paraVender, saldos, insumos] = await Promise.all([
    cargarOpcionesParaVender(db, { sucursalId, productoIds: conGrupos.map((p) => p.id) }),
    saldosTeoricosEnSucursal(sucursalId, insumoIds, db),
    insumoIds.length ? db.producto.findMany({ where: { id: { in: [...new Set(insumoIds)] } }, select: { id: true, nombre: true, unidadStock: { select: { nombre: true } } } }) : Promise.resolve([]),
  ]);
  const insumoPorId = new Map(insumos.map((i) => [i.id, i]));

  const sinPoderVenderse = conGrupos.flatMap((p) => {
    const vacios = (paraVender.get(p.id)?.grupos ?? []).filter((g) => g.admitido && g.activo && g.cantidadMinima > 0 && !g.opciones.some(opcionDisponible)).map((g) => g.nombre);
    return vacios.length ? [{ productoId: p.id, nombre: p.nombre, grupos: vacios }] : [];
  });

  return {
    grupos: grupos
      .filter((g) => g.opciones.length > 0)
      .map((g) => ({
        grupoId: g.id,
        nombre: g.nombre,
        opciones: g.opciones.map((o) => {
          const estaAgotada = agotada.has(o.id);
          const sinStock = estaAgotada
            ? []
            : [...new Set((o.vigente?.consumos ?? []).map((c) => c.insumoProductoId))].flatMap((id) => {
                const saldo = saldos.get(id) ?? 0;
                const insumo = insumoPorId.get(id);
                return saldo <= 0 && insumo ? [{ productoId: id, nombre: insumo.nombre, unidadNombre: insumo.unidadStock.nombre, saldo }] : [];
              });
          return { opcionId: o.id, nombre: o.nombre, esNinguna: o.esNinguna, agotada: estaAgotada, sinStockEnElSistema: sinStock };
        }),
      })),
    sinPoderVenderse,
    agotadasAhora: grupos.reduce((n, g) => n + g.opciones.filter((o) => agotada.has(o.id)).length, 0),
  };
}
