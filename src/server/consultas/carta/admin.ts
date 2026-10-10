import "server-only";
import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { esClavePortal, esClaveTema, precioDeCarta, precioDePromo, seleccionDeSucursalDePromo, whereCartaDeSucursal, type SeccionCartaAdmin, type ProductoCartaAdmin, type GeneroCartaAdmin, type SucursalConCartaPropia, type DatosAdminCarta, type OpcionItemAgrupadoAdmin, type DatosAdminItemsAgrupados, type SucursalPortalAdmin, type TemaAdmin, type PortalEmpresaAdmin } from "@/core/carta/public";
import { descuentosConfiguradosEnSucursal } from "@/server/lecturas/carta/descuentos";
import { resolverMenuCartaConDiagnostico } from "@/server/lecturas/carta/menu";
import type { Db } from "@/lib/db-tipos";
import type { PrismaClient } from "@prisma/client";
import { sucursalesDondeElUsuarioPuedeVer } from "@/server/acceso/gate";

/** Las secciones de carta (orden, nombre) con cuántos ítems ya tiene cada una (`cantidadItems`, DA6). */
async function seccionesConCantidad(sucursalId: string, db: Db): Promise<SeccionCartaAdmin[]> {
  const secciones = await db.seccionCarta.findMany({
    include: {
      _count: {
        select: {
          // Mismo criterio que la carta: un PV agrupado no sale suelto (D3), aunque tenga contenido visible. Cuenta solo la carta PROPIA de la sucursal.
          contenidos: { where: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true, producto: { opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(sucursalId) } } } },
          agrupados: { where: { ...whereCartaDeSucursal(sucursalId), activo: true } },
        },
      },
    },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
  });
  return secciones.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    titulo: s.titulo,
    descripcion: s.descripcion,
    imagenUrl: s.imagenUrl,
    orden: s.orden,
    activa: s.activa,
    cantidadItems: s._count.contenidos + s._count.agrupados,
  }));
}

/** Todos los géneros (docs/plan-genero-carta-2026-09-26.md), activos primero, orden, nombre — reusado por las dos pantallas. */
async function generosOrdenados(sucursalId: string, db: Db): Promise<GeneroCartaAdmin[]> {
  const generos = await db.generoCarta.findMany({ where: whereCartaDeSucursal(sucursalId), orderBy: [{ activo: "desc" }, { orden: "asc" }, { nombre: "asc" }] });
  return generos.map((g) => ({ id: g.id, nombre: g.nombre, orden: g.orden, activo: g.activo }));
}

/**
 * Si la sucursal tiene carta propia y cuáles otras sucursales activas tienen la suya. La única lectura de la estructura que cruza sucursales a
 * propósito (para ofrecer de dónde copiar); va por el conteo de la relación de `Sucursal`, nunca por los modelos de la carta, y el RLS la deja
 * dentro de la empresa.
 */
async function estadoCartaPropia(sucursalId: string, db: Db): Promise<{ cartaVacia: boolean; sucursalesConCarta: SucursalConCartaPropia[] }> {
  const sucursales = await db.sucursal.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, _count: { select: { contenidosCarta: true, generosCarta: true, itemsAgrupadosCarta: true } } },
    orderBy: { nombre: "asc" },
  });
  const tiene = (s: (typeof sucursales)[number]) => s._count.contenidosCarta + s._count.generosCarta + s._count.itemsAgrupadosCarta > 0;
  const propia = sucursales.find((s) => s.id === sucursalId);
  return {
    cartaVacia: propia ? !tiene(propia) : true,
    sucursalesConCarta: sucursales.filter((s) => s.id !== sucursalId && tiene(s)).map((s) => ({ id: s.id, nombre: s.nombre, cantidadProductos: s._count.contenidosCarta })),
  };
}

/**
 * De las sucursales con carta propia que `cargarAdminCarta` junta (todas las de la empresa), las que se OFRECEN como origen de la copia: solo donde `usuarioId` tiene membresía
 * vigente y el «Ver» de la carta (`carta_ver`), la misma condición con la que `copiarCartaDeSucursal` acepta el origen (S-07, O.56). La pantalla pasa por acá antes de mostrar
 * nombres o cantidades de otra sucursal. `cargarAdminCarta` no filtra a propósito: su resultado es la caracterización congelada de las lecturas del tramo A.
 */
export async function origenesDeCopiaVisibles(usuarioId: string, origenes: readonly SucursalConCartaPropia[], db: PrismaClient): Promise<SucursalConCartaPropia[]> {
  const visibles = await sucursalesDondeElUsuarioPuedeVer(usuarioId, origenes.map((o) => o.id), "carta_ver", db);
  return origenes.filter((o) => visibles.has(o.id));
}

/**
 * La pantalla de administración de la carta. `ahora` obligatorio (O.22-c): lo fija la página; solo llega al `generadoEn` del menú armado, que acá se descarta.
 * M.3-A5: `dbDeOrigenes` es la base con que se lee la carta de LAS OTRAS sucursales (de dónde se puede copiar: `estadoCartaPropia`); por defecto, `db`. La página la pasa del contexto ampliado por
 * `lecturaEnSucursalesVisibles(ctx, "carta_ver")` solo a quien puede copiar la carta (`test/arquitectura/lectores-de-varias-sucursales.test.ts`); todo lo demás se lee de `sucursalId` con `db`.
 */
export async function cargarAdminCarta(sucursalId: string, db: Db, ahora: Date, dbDeOrigenes: Db = db): Promise<DatosAdminCarta> {
  const [secciones, generos, productos, promos, armado, precioLocalActivo, estado] = await Promise.all([
    seccionesConCantidad(sucursalId, db),
    generosOrdenados(sucursalId, db),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId) },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        contenidosCarta: {
          where: whereCartaDeSucursal(sucursalId),
          take: 1,
          select: {
            visibleEnCarta: true,
            seccionCartaId: true,
            seccionCarta: { select: { nombre: true, activa: true } },
            descripcion: true,
            tags: true,
            especial: true,
            orden: true,
            generoCartaId: true,
            generoCarta: { select: { nombre: true, activo: true } },
          },
        },
        opcionesItemAgrupadoCarta: { where: whereCartaDeSucursal(sucursalId), take: 1, select: { itemAgrupadoCarta: { select: { nombre: true } } } },
      },
      orderBy: { nombre: "asc" },
    }),
    db.promoCarta.findMany({
      include: {
        sucursales: seleccionDeSucursalDePromo(sucursalId),
        seccionCarta: { select: { nombre: true } },
        cupos: { select: { id: true, seccionCartaId: true, cantidadMinima: true, cantidadMaxima: true, orden: true, seccionCarta: { select: { nombre: true } } }, orderBy: { orden: "asc" } },
      },
      orderBy: [{ activa: "desc" }, { orden: "asc" }, { titulo: "asc" }],
    }),
    resolverMenuCartaConDiagnostico(sucursalId, db, ahora),
    precioLocalActivoEn(sucursalId, db),
    estadoCartaPropia(sucursalId, dbDeOrigenes),
  ]);

  const descuentos = await descuentosConfiguradosEnSucursal(sucursalId, db, productos.map((p) => p.id));
  const productosAdmin: ProductoCartaAdmin[] = productos.map((p) => {
    const c = p.contenidosCarta[0];
    return {
      id: p.id,
      nombre: p.nombre,
      seccionCarta: c?.seccionCarta?.activa ? c.seccionCarta.nombre : null,
      precio: Number(p.precioVenta),
      descuento: descuentos.get(p.id) ?? null,
      contenido: c ? {
        visibleEnCarta: c.visibleEnCarta,
        seccionCartaId: c.seccionCartaId,
        descripcion: c.descripcion,
        tags: c.tags,
        especial: c.especial,
        orden: c.orden,
        generoCartaId: c.generoCartaId,
      } : null,
      agrupadoEn: p.opcionesItemAgrupadoCarta[0]?.itemAgrupadoCarta.nombre ?? null,
      generoCarta: c?.generoCarta?.activo ? c.generoCarta.nombre : null,
    };
  });

  return {
    cartaVacia: estado.cartaVacia,
    sucursalesConCarta: estado.sucursalesConCarta,
    secciones,
    generos,
    productos: productosAdmin,
    sinContenido: productosAdmin.filter((p) => !p.contenido && !p.agrupadoEn),
    visiblesSinSeccion: armado?.diagnostico.visiblesSinSeccion ?? [],
    promos: promos.map((pr) => ({
      id: pr.id,
      seccionCartaId: pr.seccionCartaId,
      seccionCarta: pr.seccionCarta.nombre,
      titulo: pr.titulo,
      descripcion: pr.descripcion,
      precio: Number(pr.precio),
      orden: pr.orden,
      activa: pr.activa,
      prendidaAca: pr.sucursales[0]?.activa ?? false,
      precioLocal: pr.sucursales[0]?.precioLocal != null ? Number(pr.sucursales[0].precioLocal) : null,
      precioAca: precioDePromo(pr.precio, pr.sucursales[0], precioLocalActivo),
      cupos: pr.cupos.map((c) => ({ id: c.id, seccionCartaId: c.seccionCartaId, seccionCarta: c.seccionCarta.nombre, cantidadMinima: c.cantidadMinima, cantidadMaxima: c.cantidadMaxima, orden: c.orden })),
    })),
    precioLocalActivo,
  };
}

/** Todos los ítems agrupados (activos primero, orden, nombre), con lo que se ve y se avisa en la sucursal activa. `ahora` obligatorio (O.22-c), como `cargarAdminCarta`. */
export async function cargarAdminItemsAgrupados(sucursalId: string, db: Db, ahora: Date): Promise<DatosAdminItemsAgrupados> {
  const [items, secciones, generos, sinGrupo, armado] = await Promise.all([
    db.itemAgrupadoCarta.findMany({
      where: whereCartaDeSucursal(sucursalId),
      select: {
        id: true,
        nombre: true,
        seccionCartaId: true,
        seccionCarta: { select: { nombre: true, activa: true } },
        descripcion: true,
        tags: true,
        especial: true,
        orden: true,
        activo: true,
        generoCartaId: true,
        generoCarta: { select: { nombre: true, activo: true } },
        opciones: {
          select: {
            id: true,
            orden: true,
            producto: { select: { id: true, nombre: true, tipo: true, precioVenta: true } },
          },
        },
      },
      orderBy: [{ activo: "desc" }, { orden: "asc" }, { nombre: "asc" }],
    }),
    seccionesConCantidad(sucursalId, db),
    generosOrdenados(sucursalId, db),
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId), opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(sucursalId) } },
      select: { id: true, nombre: true, precioVenta: true },
      orderBy: { nombre: "asc" },
    }),
    resolverMenuCartaConDiagnostico(sucursalId, db, ahora),
  ]);

  const idsOpciones = items.flatMap((it) => it.opciones.map((o) => o.producto.id));
  const idsConPrecio = [...new Set([...idsOpciones, ...sinGrupo.map((p) => p.id)])];
  const [disponibilidad, localPorProducto] = await Promise.all([
    disponibilidadDeProductos(sucursalId, idsOpciones, db),
    preciosLocalesVigentes(sucursalId, db, idsConPrecio),
  ]);
  const precioAca = (productoId: string, precioVenta: { toString(): string }) => precioDeCarta(Number(precioVenta), localPorProducto.get(productoId));
  const comparar = (a: string, b: string) => a.localeCompare(b, "es");

  return {
    items: items.map((it) => {
      const seccionCarta = it.seccionCarta.activa ? it.seccionCarta.nombre : null;
      const opciones: OpcionItemAgrupadoAdmin[] = it.opciones
        .map((o) => ({
          id: o.id,
          productoId: o.producto.id,
          nombre: o.producto.nombre,
          orden: o.orden,
          // Mismo criterio que la carta (menu-consulta.ts): solo un PV disponible acá cuenta.
          disponibleAca: o.producto.tipo === "PV" && disponibilidad.get(o.producto.id) === true,
          precioAca: precioAca(o.producto.id, o.producto.precioVenta),
        }))
        .sort((a, b) => a.orden - b.orden || comparar(a.nombre, b.nombre));
      const precios = opciones.filter((o) => o.disponibleAca).map((o) => o.precioAca);
      const precio = precios.length ? { minimo: Math.min(...precios), maximo: Math.max(...precios) } : null;
      return {
        id: it.id,
        nombre: it.nombre,
        seccionCartaId: it.seccionCartaId,
        seccionCarta,
        descripcion: it.descripcion,
        tags: it.tags,
        especial: it.especial,
        orden: it.orden,
        activo: it.activo,
        generoCartaId: it.generoCartaId,
        generoCarta: it.generoCarta?.activo ? it.generoCarta.nombre : null,
        opciones,
        disponiblesAca: precios.length,
        precio,
        avisos: {
          preciosDistintos: precio && precio.minimo !== precio.maximo ? { ...precio, mostrado: precio.maximo } : null,
          sinOpcionesAca: precios.length === 0,
          sinSeccion: seccionCarta === null,
        },
      };
    }),
    secciones,
    generos,
    productosSinGrupo: sinGrupo.map((p) => ({ id: p.id, nombre: p.nombre, precioAca: precioAca(p.id, p.precioVenta) })),
    diagnostico: {
      agrupadosSinSeccion: armado?.diagnostico.agrupadosSinSeccion ?? [],
      agrupadosSinOpciones: armado?.diagnostico.agrupadosSinOpciones ?? [],
      agrupadosConPreciosDistintos: armado?.diagnostico.agrupadosConPreciosDistintos ?? [],
    },
  };
}

/** TODAS las sucursales (el mapa del portal es entre sucursales, no depende de la activa), activas primero, con su fila si la tienen. */
export async function cargarAdminPortal(db: Db): Promise<SucursalPortalAdmin[]> {
  const sucursales = await db.sucursal.findMany({
    select: { id: true, nombre: true, activo: true, publica: true, temaCarta: { select: { aplicarEnCarta: true } } },
    orderBy: [{ activo: "desc" }, { nombre: "asc" }],
  });
  const num = (v: { toString(): string } | null) => (v === null ? null : Number(v));
  return sucursales.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    activo: s.activo,
    publica: s.publica && {
      slug: s.publica.slug,
      etiqueta: s.publica.etiqueta,
      subtituloPortal: s.publica.subtituloPortal,
      posX: num(s.publica.posX),
      posY: num(s.publica.posY),
      posW: num(s.publica.posW),
      posH: num(s.publica.posH),
      orden: s.publica.orden,
      publicada: s.publica.publicada,
    },
    temaDesdeMotor2: s.temaCarta?.aplicarEnCarta === true,
  }));
}

/** El tema de la sucursal (la activa de quien llama) y su lugar en el portal, en una sola consulta. */
export async function cargarTemaAdmin(sucursalId: string, db: Db): Promise<TemaAdmin | null> {
  const s = await db.sucursal.findUnique({
    where: { id: sucursalId },
    select: {
      id: true,
      nombre: true,
      temaCarta: { select: { valores: true, aplicarEnCarta: true, actualizadoEn: true } },
      publica: { select: { slug: true, publicada: true } },
    },
  });
  if (!s) return null;
  const json = s.temaCarta?.valores;
  const obj: Record<string, unknown> = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const valores: Record<string, string> = {};
  for (const clave of Object.keys(obj)) {
    const v = obj[clave];
    if (esClaveTema(clave) && typeof v === "string") valores[clave] = v;
  }
  return {
    sucursalId: s.id,
    nombre: s.nombre,
    tema: s.temaCarta && { valores, aplicarEnCarta: s.temaCarta.aplicarEnCarta, actualizadoEn: s.temaCarta.actualizadoEn },
    publica: s.publica,
  };
}

/** La apariencia del portal de la empresa activa (una fila por empresa; RLS deja ver solo la propia). */
export async function cargarPortalEmpresaAdmin(db: Db): Promise<PortalEmpresaAdmin> {
  const fila = await db.portalCartaEmpresa.findFirst({ select: { valores: true, actualizadoEn: true } });
  const json = fila?.valores;
  const obj: Record<string, unknown> = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const valores: Record<string, string> = {};
  for (const clave of Object.keys(obj)) {
    const v = obj[clave];
    if (esClavePortal(clave) && typeof v === "string") valores[clave] = v;
  }
  return { valores, actualizadoEn: fila?.actualizadoEn ?? null };
}