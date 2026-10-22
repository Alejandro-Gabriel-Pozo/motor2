import "server-only";
import { esBaseConfigurable, type DiferenciaDePrecio, type ModoDePrecioDeMedida, type TipoDeGrupoDeOpciones } from "@/core/opciones/public";
import type { IngredienteDeBase } from "@/core/movimientos/public";
import { resumenDePrecios, type ResumenDePrecios } from "@/core/pos/public";
import { cargarAdmisionDeProducto, cargarGrupoDeOpciones, listarGruposDeOpciones } from "@/server/lecturas/catalogo/opciones-de-venta";
import { precioLocalGuardadoDe, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { cargarRecetaVigenteParaVender } from "@/server/lecturas/movimientos/receta-para-vender";
import { cargarOpcionesParaVender, completarPreciosDeSucursal } from "@/server/lecturas/opciones/opciones-para-vender";
import type { Db } from "@/lib/db-tipos";

/**
 * Las CONSULTAS de las pantallas del catálogo de opciones de venta (GO-2d; ADR-030 «Pantallas»). Las páginas leen por acá y no por `server/lecturas` (regla
 * `paginas-solo-consultas`, ADR-026): la lectura de GO-2a (`server/lecturas/catalogo/opciones-de-venta.ts`) es la misma que usan los casos de uso y los tests; esta capa solo le
 * da a cada pantalla la forma que dibuja. Sin guarda de permiso adentro: la página la pone antes (`opciones_definir`). Ningún precio se decide acá.
 */

export interface GrupoDelPanel {
  id: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  cantidadMinima: number;
  cantidadMaxima: number;
  activo: boolean;
  /** Cuántas opciones prendidas tiene. */
  opcionesActivas: number;
  /** Cuántos productos lo admiten (filas activas). */
  productosQueLoAdmiten: number;
}

/** La tabla de «Opciones de venta»: todos los grupos de la empresa (prendidos o no), por nombre. Las mismas tres consultas de la lectura de GO-2a. */
export async function listarGruposDelPanel(db: Db): Promise<GrupoDelPanel[]> {
  const grupos = await listarGruposDeOpciones(db, { incluirInactivos: true });
  return grupos.map((g) => ({
    id: g.id,
    nombre: g.nombre,
    tipo: g.tipo as TipoDeGrupoDeOpciones,
    cantidadMinima: g.cantidadMinima,
    cantidadMaxima: g.cantidadMaxima,
    activo: g.activo,
    opcionesActivas: g.opciones.filter((o) => o.activa).length,
    productosQueLoAdmiten: g.productosQueLoAdmiten,
  }));
}

/** Un consumo de una versión, con los nombres que la pantalla muestra (el insumo, el reemplazado y la unidad de stock). */
export interface ConsumoDelPanel {
  efecto: "SUMA" | "REEMPLAZA";
  insumoProductoId: string;
  insumoNombre: string;
  reemplazaAProductoId: string | null;
  reemplazaNombre: string | null;
  cantidad: number;
  unidadNombre: string;
  mermaPorcentaje: number;
  escalaConLaMedida: boolean;
}

/** Un cambio de precio o de consumo de una opción (una VERSIÓN, en la base), con quién la cargó y desde cuándo rige. */
export interface CambioDeOpcionDelPanel {
  numero: number;
  diferencia: DiferenciaDePrecio;
  factorEscala: number | null;
  consumos: ConsumoDelPanel[];
  creadoEn: Date;
  creadoPor: string;
}

export interface OpcionDelPanel {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  esNinguna: boolean;
  /** La `version` de la fila (la esperada de la próxima edición del nombre, el orden o el estado). */
  version: number;
  /** El producto interno que respalda el stock de un adicional (solo para leer). */
  anclaNombre: string | null;
  /** Del más nuevo al más viejo: `cambios[0]` es el que rige. */
  cambios: CambioDeOpcionDelPanel[];
}

export interface GrupoDetalleDelPanel {
  /** `prefijoEnCarta` (Fase 4, ADR-035): «se lee en la carta como» (`null` = sin prefijo). */
  grupo: { id: string; nombre: string; tipo: TipoDeGrupoDeOpciones; cantidadMinima: number; cantidadMaxima: number; activo: boolean; version: number; prefijoEnCarta: string | null };
  opciones: OpcionDelPanel[];
  /** Los productos que lo admiten (filas activas), por nombre. */
  productos: { id: string; nombre: string }[];
  /** El precio base del primer producto que lo usa, en la sucursal activa: la REFERENCIA del espejo de una diferencia (`null` si ningún producto lo usa). */
  referencia: { productoNombre: string; precio: number } | null;
  /**
   * OPCIONES-FACTOR: la receta de ESE MISMO producto de referencia, la que la venta usa en la sucursal activa (`cargarRecetaVigenteParaVender`: la propia si está habilitada, si no la
   * central, con las calibraciones de ESTA sucursal), para mostrar al lado del factor de un tamaño cuánto descuenta antes y después. Solo se lee si la página lo pide (quien mira tiene
   * el «Ver» de las recetas y la empresa tiene el módulo Recetas) y el grupo es de tamaños; `null` si no, o si ningún producto usa el grupo. Los sustitutos no viajan: no cambian la cantidad.
   */
  recetaDeReferencia: {
    productoNombre: string;
    /** Se produce por lote: al venderlo no descuenta su receta (y todavía no se vende con opciones). */
    seProduce: boolean;
    sucursalId: string;
    /** Vacía si el producto no tiene receta vigente en la sucursal. */
    ingredientes: { insumoNombre: string; unidadNombre: string; base: IngredienteDeBase }[];
  } | null;
  /** Las materias primas de la empresa, para elegir el insumo de un consumo (el consumo va siempre en su unidad de stock, U7). */
  insumos: { id: string; nombre: string; unidadNombre: string; decimales: number }[];
  /** Las unidades activas, para la unidad de stock del producto interno de un adicional nuevo. */
  unidades: { id: string; nombre: string }[];
}

/**
 * La pantalla de UN grupo (`/catalogo/opciones/[grupoId]`): el grupo, sus opciones con su historial de cambios (la lectura de GO-2a, `cargarGrupoDeOpciones`) y lo que la pantalla
 * necesita para nombrar cada cosa. Sin N+1: una lectura del grupo y seis consultas más en paralelo (productos que lo usan, nombres de insumos, de quienes cargaron y de las unidades, materias
 * primas y unidades activas), más el precio de referencia y, con `conRecetaDeReferencia`, la receta de ese producto en la sucursal (OPCIONES-FACTOR). `null` si el grupo no existe o es de
 * otra empresa (la RLS no lo deja ver).
 */
export async function cargarGrupoDelPanel(db: Db, grupoId: string, sucursalId: string, conRecetaDeReferencia: boolean): Promise<GrupoDetalleDelPanel | null> {
  const g = await cargarGrupoDeOpciones(db, grupoId);
  if (!g) return null;
  const versiones = g.opciones.flatMap((o) => o.versiones);
  const idsDeProductos = [...new Set(versiones.flatMap((v) => v.consumos.flatMap((c) => [c.insumoProductoId, ...(c.reemplazaAProductoId ? [c.reemplazaAProductoId] : [])])))];
  const idsDeUsuarios = [...new Set(versiones.map((v) => v.creadoPorId))];
  const idsDeUnidades = [...new Set(versiones.flatMap((v) => v.consumos.map((c) => c.unidadId)))];
  const [admisiones, nombresDeProductos, usuarios, insumos, unidades, unidadesDeConsumos] = await Promise.all([
    db.productoAdmiteGrupo.findMany({ where: { grupoId, activo: true }, select: { producto: { select: { id: true, nombre: true, precioVenta: true, seProduce: true } } } }),
    idsDeProductos.length ? db.producto.findMany({ where: { id: { in: idsDeProductos } }, select: { id: true, nombre: true } }) : Promise.resolve([]),
    idsDeUsuarios.length ? db.user.findMany({ where: { id: { in: idsDeUsuarios } }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.producto.findMany({ where: { tipo: "MP" }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, unidadStockId: true, unidadStock: { select: { nombre: true, decimales: true } } } }),
    db.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
    idsDeUnidades.length ? db.unidad.findMany({ where: { id: { in: idsDeUnidades } }, select: { id: true, nombre: true } }) : Promise.resolve([]),
  ]);
  const unidadesPorId = new Map(unidadesDeConsumos.map((u) => [u.id, u.nombre]));
  const nombreDe = new Map(nombresDeProductos.map((p) => [p.id, p.nombre]));
  // Solo el nombre (el correo es un dato sensible, GT-1): sin nombre cargado se dice «alguien sin nombre cargado».
  const quien = new Map(usuarios.map((u) => [u.id, u.name?.trim() || SIN_NOMBRE]));
  const productos = admisiones.map((a) => a.producto).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  let referencia: GrupoDetalleDelPanel["referencia"] = null;
  let recetaDeReferencia: GrupoDetalleDelPanel["recetaDeReferencia"] = null;
  const primero = productos[0];
  if (primero) {
    const local = (await preciosLocalesVigentes(sucursalId, db, [primero.id])).get(primero.id);
    referencia = { productoNombre: primero.nombre, precio: local?.precio ?? Number(primero.precioVenta) };
    // Solo un tamaño tiene factor: en los demás grupos la receta no se lee.
    if (conRecetaDeReferencia && g.tipo === "MEDIDA") {
      // La MISMA lectura de la receta que la venta (y por eso la misma receta efectiva); los nombres y la unidad de stock salen de las materias primas ya leídas arriba (la venta
      // exige que cada ingrediente sea una MP: uno que no lo es no se muestra, porque esa venta se rechaza).
      const mp = new Map(insumos.map((i) => [i.id, i]));
      const receta = primero.seProduce ? [] : await cargarRecetaVigenteParaVender(db, { productoId: primero.id, sucursalId });
      recetaDeReferencia = {
        productoNombre: primero.nombre,
        seProduce: primero.seProduce,
        sucursalId,
        ingredientes: receta.flatMap((ing) => {
          const insumo = mp.get(ing.insumoProductoId);
          if (!insumo) return [];
          return [{ insumoNombre: insumo.nombre, unidadNombre: insumo.unidadStock.nombre, base: { ingrediente: { ...ing, insumoSustitutoIds: [] }, unidadStockId: insumo.unidadStockId } }];
        }),
      };
    }
  }

  return {
    grupo: { id: g.id, nombre: g.nombre, tipo: g.tipo as TipoDeGrupoDeOpciones, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima, activo: g.activo, version: g.version, prefijoEnCarta: g.prefijoEnCarta },
    opciones: g.opciones.map((o) => ({
      id: o.id,
      nombre: o.nombre,
      orden: o.orden,
      activa: o.activa,
      esNinguna: o.esNinguna,
      version: o.version,
      anclaNombre: o.producto?.nombre ?? null,
      cambios: o.versiones.map((v) => ({
        numero: v.numero,
        diferencia: diferenciaDe(v),
        factorEscala: v.factorEscala,
        creadoEn: v.creadoEn,
        creadoPor: quien.get(v.creadoPorId) ?? SIN_NOMBRE,
        consumos: v.consumos.map((c) => ({
          efecto: c.efecto as ConsumoDelPanel["efecto"],
          insumoProductoId: c.insumoProductoId,
          insumoNombre: nombreDe.get(c.insumoProductoId) ?? "un insumo",
          reemplazaAProductoId: c.reemplazaAProductoId,
          reemplazaNombre: c.reemplazaAProductoId ? (nombreDe.get(c.reemplazaAProductoId) ?? "un insumo") : null,
          cantidad: c.cantidad,
          unidadNombre: unidadesPorId.get(c.unidadId) ?? "",
          mermaPorcentaje: c.mermaPorcentaje,
          escalaConLaMedida: c.escalaConLaMedida,
        })),
      })),
    })),
    productos: productos.map((p) => ({ id: p.id, nombre: p.nombre })),
    referencia,
    recetaDeReferencia,
    insumos: insumos.map((i) => ({ id: i.id, nombre: i.nombre, unidadNombre: i.unidadStock.nombre, decimales: i.unidadStock.decimales })),
    unidades,
  };
}

/** Quién cargó un cambio, cuando la cuenta no tiene nombre (nunca se muestra el correo). */
const SIN_NOMBRE = "alguien sin nombre cargado";

/** La diferencia de una versión leída (MONTO o PORCENTAJE; la base guarda uno solo, el otro en NULL). */
function diferenciaDe(v: { tipoDeDiferencia: string; diferenciaPrecio: number | null; porcentaje: number | null }): DiferenciaDePrecio {
  return v.tipoDeDiferencia === "PORCENTAJE" ? { tipo: "PORCENTAJE", porcentaje: v.porcentaje ?? 0 } : { tipo: "MONTO", monto: v.diferenciaPrecio ?? 0 };
}

// ───────────────────────────── GO-2d paso 4: lo que admite un producto ─────────────────────────────

/** Una opción de un grupo vista desde un producto: su fila de admisión (o `null` si el producto todavía no la admite) y la diferencia de la opción, la que rige si el producto no pone la suya. */
export interface OpcionAdmitidaDelPanel {
  opcionId: string;
  nombre: string;
  activaEnEmpresa: boolean;
  esNinguna: boolean;
  /** La diferencia del cambio de precio vigente de la opción (`null` si no tiene ninguno cargado). */
  diferenciaDeLaOpcion: DiferenciaDePrecio | null;
  fila: { version: number; cantidadMaxima: number; precioAbsoluto: number | null; diferencia: DiferenciaDePrecio | null; activo: boolean } | null;
}

export interface GrupoAdmitidoDelPanel {
  grupoId: string;
  nombre: string;
  tipo: TipoDeGrupoDeOpciones;
  activoEnEmpresa: boolean;
  cantidadMinimaDelGrupo: number;
  cantidadMaximaDelGrupo: number;
  /** La fila de `ProductoAdmiteGrupo` (con su `version`, la esperada de la próxima edición). */
  fila: { version: number; orden: number; cantidadMinima: number | null; cantidadMaxima: number | null; modoPrecio: ModoDePrecioDeMedida | null; activo: boolean };
  opciones: OpcionAdmitidaDelPanel[];
}

export interface OpcionesDelProductoDelPanel {
  /** `esBase`: se vende por opción (`modoDeVenta = BASE_CONFIGURABLE`): su precio guardado no se cobra, rige el precio final de sus opciones. */
  producto: { id: string; nombre: string; tipo: "MP" | "PV"; esAnclaDeAdicional: boolean; esBase: boolean };
  /** Los grupos que el producto tiene asignados (activos o no en el producto), en su orden. */
  admitidos: GrupoAdmitidoDelPanel[];
  /** Los grupos prendidos de la empresa que el producto todavía no tiene: los que ofrece «Agregar grupo», con sus opciones prendidas y el máximo del grupo. */
  paraAgregar: { grupoId: string; nombre: string; tipo: TipoDeGrupoDeOpciones; cantidadMaxima: number; opcionIds: string[] }[];
  /** «Así se cobra en la sucursal»: el resumen de precios calculado por el servidor con la misma regla que la venta (precio de lista, sin descuentos). */
  vistaPrevia: ResumenDePrecios;
  /** El precio base del producto en la sucursal activa (precio local vigente o el de venta). */
  precioBase: number;
  /** El precio GLOBAL (`Producto.precioVenta`), el que rige donde no hay precio local habilitado. */
  precioGlobal: number;
  /** Las unidades activas, para el producto de respaldo de un extra nuevo («+ Extra» en un grupo de adicionales). */
  unidades: { id: string; nombre: string }[];
  /** El precio local del producto en la sucursal activa tal como está guardado (habilitado o no) y si la sucursal usa precio propio: lo que vio quien lo edita. Solo lo dibuja quien tiene `precio_local`. */
  precioLocal: { guardado: { precio: number; habilitado: boolean } | null; capacidadActiva: boolean };
}

const diferenciaDeFila = (tipo: string | null, monto: number | null, porcentaje: number | null): DiferenciaDePrecio | null =>
  tipo === "MONTO" && monto !== null ? { tipo: "MONTO", monto } : tipo === "PORCENTAJE" && porcentaje !== null ? { tipo: "PORCENTAJE", porcentaje } : null;

/**
 * Lo que admite UN producto, para su ficha (solo leer) y para `/catalogo/productos/[id]/opciones` (editar): sus filas de admisión con su `version` (la lectura de GO-2a,
 * `cargarAdmisionDeProducto`), el catálogo de grupos de la empresa (para ofrecer los que faltan y mostrar la diferencia de cada opción) y la VISTA PREVIA de precios en la sucursal
 * activa, que calcula el servidor con la lectura de la venta (`cargarOpcionesParaVender` y la grilla de la sucursal) y `resumenDePrecios`. `null` si el producto no existe o es de
 * otra empresa (la RLS no lo deja ver).
 */
export async function cargarOpcionesDelProducto(db: Db, productoId: string, sucursalId: string): Promise<OpcionesDelProductoDelPanel | null> {
  const producto = await db.producto.findFirst({ where: { id: productoId }, select: { id: true, nombre: true, tipo: true, precioVenta: true, modoDeVenta: true, opcionQueRespalda: { select: { id: true } } } });
  if (!producto) return null;
  const [filas, catalogo, paraVender, locales, precioLocal, unidades] = await Promise.all([
    cargarAdmisionDeProducto(db, productoId),
    listarGruposDeOpciones(db, { incluirInactivos: true }),
    cargarOpcionesParaVender(db, { sucursalId, productoIds: [productoId] }),
    preciosLocalesVigentes(sucursalId, db, [productoId]),
    precioLocalGuardadoDe(sucursalId, db, productoId),
    db.unidad.findMany({ where: { activa: true }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true } }),
  ]);
  const precioBase = locales.get(productoId)?.precio ?? Number(producto.precioVenta);
  // La grilla de la sucursal, para TODAS las medidas en precio propio del producto (la vista previa muestra cada tamaño).
  const delProducto = paraVender.get(productoId);
  const medidas = (delProducto?.grupos ?? []).filter((g) => g.tipo === "MEDIDA" && g.modoPrecio === "ABSOLUTO").flatMap((g) => g.opciones.map((o) => o.opcionId));
  const conGrilla = delProducto && medidas.length ? await completarPreciosDeSucursal(db, sucursalId, paraVender, [{ productoId, opcionIds: medidas }]) : paraVender;
  const vistaPrevia = resumenDePrecios({ grupos: conGrilla.get(productoId)?.grupos ?? [], precioBase, descuentoDeProducto: null, esBase: delProducto?.esBase ?? false });

  const porGrupo = new Map(catalogo.map((g) => [g.id, g]));
  const admitidos: GrupoAdmitidoDelPanel[] = filas.flatMap((f) => {
    const g = porGrupo.get(f.grupoId);
    if (!g) return [];
    const filaDeOpcion = new Map(f.opciones.map((o) => [o.opcionId, o]));
    return [
      {
        grupoId: g.id,
        nombre: g.nombre,
        tipo: g.tipo as TipoDeGrupoDeOpciones,
        activoEnEmpresa: g.activo,
        cantidadMinimaDelGrupo: g.cantidadMinima,
        cantidadMaximaDelGrupo: g.cantidadMaxima,
        fila: { version: f.version, orden: f.orden, cantidadMinima: f.cantidadMinima, cantidadMaxima: f.cantidadMaxima, modoPrecio: f.modoPrecio as ModoDePrecioDeMedida | null, activo: f.activo },
        opciones: g.opciones.map((o) => {
          const fo = filaDeOpcion.get(o.id);
          return {
            opcionId: o.id,
            nombre: o.nombre,
            activaEnEmpresa: o.activa,
            esNinguna: o.esNinguna,
            diferenciaDeLaOpcion: o.vigente ? diferenciaDeFila(o.vigente.tipoDeDiferencia, o.vigente.diferenciaPrecio, o.vigente.porcentaje) : null,
            fila: fo ? { version: fo.version, cantidadMaxima: fo.cantidadMaxima, precioAbsoluto: fo.precioAbsoluto, diferencia: diferenciaDeFila(fo.tipoDeDiferencia, fo.diferenciaPrecio, fo.porcentaje), activo: fo.activo } : null,
          };
        }),
      },
    ];
  });
  const yaAsignados = new Set(filas.map((f) => f.grupoId));
  return {
    producto: { id: producto.id, nombre: producto.nombre, tipo: producto.tipo, esAnclaDeAdicional: producto.opcionQueRespalda !== null, esBase: esBaseConfigurable(producto.modoDeVenta) },
    admitidos,
    paraAgregar: catalogo
      .filter((g) => g.activo && !yaAsignados.has(g.id))
      .map((g) => ({ grupoId: g.id, nombre: g.nombre, tipo: g.tipo as TipoDeGrupoDeOpciones, cantidadMaxima: g.cantidadMaxima, opcionIds: g.opciones.filter((o) => o.activa && o.vigente).map((o) => o.id) })),
    vistaPrevia,
    precioBase,
    precioGlobal: Number(producto.precioVenta),
    unidades,
    precioLocal,
  };
}

/** Para la lista de productos: los nombres de los grupos de opciones que tiene asignados (activos) cada producto, en el orden del producto. Una sola lectura para toda la página. */
export async function gruposDeOpcionesPorProducto(db: Db, productoIds: readonly string[]): Promise<Map<string, string[]>> {
  if (productoIds.length === 0) return new Map();
  const filas = await db.productoAdmiteGrupo.findMany({
    where: { productoId: { in: [...productoIds] }, activo: true, grupo: { activo: true } },
    orderBy: [{ orden: "asc" }, { grupo: { nombre: "asc" } }],
    select: { productoId: true, grupo: { select: { nombre: true } } },
  });
  const salida = new Map<string, string[]>();
  for (const f of filas) salida.set(f.productoId, [...(salida.get(f.productoId) ?? []), f.grupo.nombre]);
  return salida;
}
