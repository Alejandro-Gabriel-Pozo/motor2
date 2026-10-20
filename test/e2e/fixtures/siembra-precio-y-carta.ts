import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { prismaAdmin } from "../../setup/cliente-duenio";
import { crearMembresia } from "../../setup/membresia";
import { borrarRecetasDeReventa, darRecetaDeReventa } from "../../setup/receta-de-venta";
import { PRODUCTOS_DE_REFERENCIA } from "../../setup/referencia-precio-y-carta";

/**
 * Siembra para Playwright del CATÁLOGO DE REFERENCIA de precio y carta (Fase 0 de la ola «precio y carta»), la que usa `test/e2e/linea-de-base-precio-y-carta.spec.ts`. Son los MISMOS
 * productos, grupos, opciones, precios y secciones que `test/setup/siembra-precio-y-carta.ts` (la siembra de Vitest, que reproduce producción), copiados acá porque esa siembra escribe
 * con el cliente de Vitest (`test/setup/test-db.ts`) y no se puede importar desde Playwright. Para que la copia no se desvíe en silencio, `verificarContraLaReferencia` compara
 * nombres y precios con el catálogo puro (`test/setup/referencia-precio-y-carta.ts`) antes de sembrar.
 *
 * Todo vive en una sucursal DEDICADA («LB Precio y carta», slug público `lb-precio-y-carta`), con nombres ESTABLES (sin marca de tiempo: el golden los muestra) y un usuario propio
 * con membresía SOLO en esa sucursal (rol admin): las pantallas de administración que dependen de la sucursal activa («Así se cobra en…», la ficha de la carta) leen ESTA sucursal y
 * no «Central». Mismo mecanismo de sesión que `fixtures/auth.ts` y `fixtures/dos-sucursales.ts` (fila `Session` real + cookie).
 *
 * Limpieza: `limpiarLineaDeBasePrecioYCarta` borra TODO lo sembrado buscándolo por sus claves estables (nombre de la sucursal, códigos, nombres de grupos y de secciones, email):
 * corre antes de sembrar (restos de un intento anterior en la misma base) y al terminar, también si el spec falla. Las tablas de opciones solo admiten INSERT para el rol de la app y
 * el de pruebas (GO-1): esas filas se borran con el DUEÑO (`prismaAdmin`), igual que otros specs borran lo que el rol de ejecución no puede.
 */

const NOMBRE_SUCURSAL = "LB Precio y carta";
const SLUG = "lb-precio-y-carta";
const EMAIL_USUARIO = "lb-precio-y-carta@local.test";
/** Prefijo de los códigos de producto: los PV y las anclas (los de Vitest, sin él; acá no chocan con nada de otro spec). */
const PREFIJO = "LB_";

interface Opcion {
  nombre: string;
  /** `precioAbsoluto` del producto (solo en una MEDIDA en ABSOLUTO). */
  absoluto?: string;
  /** La diferencia de la versión 1 (MONTO). */
  diferencia?: string;
  /** El producto ANCLA de un adicional (PV sin precio, con este nombre). */
  ancla?: { codigo: string; nombre: string };
  /** Fase 5 (paso 13): agotada HOY en la sucursal (la carta de la pantalla no la muestra; la del papel, completa, sí). */
  agotadaHoy?: true;
}

interface Grupo {
  clave: string;
  nombre: string;
  tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  cantidadMinima: number;
  cantidadMaxima: number;
  modoPrecio?: "ABSOLUTO";
  /** Fase 4 (DEC-34): «se lee en la carta como» («De» para «Milanesas de»). */
  prefijoEnCarta?: string;
  opciones: Opcion[];
}

interface Producto {
  clave: string;
  codigo: string;
  nombre: string;
  precioVenta: string;
  seccion: string;
  ordenEnSeccion: number;
  /** Fase 4 (DEC-18): un producto BASE (se vende por opción). Fase 5: Pizzas (base de un eje: oculta) y Milanesas (base de dos ejes: tabla). */
  modoDeVenta?: "BASE_CONFIGURABLE";
  grupos: Grupo[];
}

const SECCIONES: readonly { nombre: string; orden: number }[] = [
  { nombre: "Pizzas", orden: 1 },
  { nombre: "Platos", orden: 2 },
  { nombre: "Cafetería", orden: 3 },
  { nombre: "Bebidas", orden: 4 },
];

// Copia de `PRODUCTOS` de test/setup/siembra-precio-y-carta.ts (mismos nombres, tipos, límites, órdenes y precios); solo cambian los códigos (prefijo `LB_`).
// Fase 5 (paso 13, capturas de la carta pareja): además, como va a quedar producción cuando el dueño los marque a mano, Pizzas y Milanesas son productos BASE y «Milanesas de» se lee «De»;
// y «Pizza bomba» está agotada hoy (la carta impresa sale completa). Así la carta muestra las cuatro formas: lista (pizzas, oculta), tabla (milanesas), simple (bife) y columnas (café).
const PRODUCTOS: readonly Producto[] = [
  {
    clave: "pizzas",
    codigo: `${PREFIJO}PV_PIZZAS`,
    nombre: "Pizzas",
    precioVenta: "18000.00",
    seccion: "Pizzas",
    ordenEnSeccion: 0,
    modoDeVenta: "BASE_CONFIGURABLE",
    grupos: [
      {
        clave: "tiposDePizza",
        nombre: "Tipos de Pizza",
        tipo: "MEDIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        modoPrecio: "ABSOLUTO",
        opciones: [
          { nombre: "Pizza muzzarella", absoluto: "18000.00" },
          { nombre: "Pizza de verduras asadas", absoluto: "20000.00" },
          { nombre: "Pizza fugazzeta", absoluto: "22000.00" },
          { nombre: "Pizza napolitana", absoluto: "22000.00" },
          { nombre: "Pizza con papas fritas", absoluto: "25000.00" },
          { nombre: "Pizza bomba", absoluto: "25000.00", agotadaHoy: true },
        ],
      },
    ],
  },
  {
    clave: "milanesas",
    codigo: `${PREFIJO}PV_MILANESAS`,
    nombre: "Milanesas",
    precioVenta: "20000.00",
    seccion: "Platos",
    ordenEnSeccion: 0,
    modoDeVenta: "BASE_CONFIGURABLE",
    grupos: [
      {
        clave: "tipoDeMilanesa",
        nombre: "Tipo de Milanesa",
        tipo: "MEDIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        modoPrecio: "ABSOLUTO",
        opciones: [
          { nombre: "Simple", absoluto: "20000.00" },
          { nombre: "Napolitana", absoluto: "25000.00" },
        ],
      },
      { clave: "milanesasDe", nombre: "Milanesas de", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: "De", opciones: [{ nombre: "Carne" }, { nombre: "Pollo" }] },
    ],
  },
  {
    clave: "bife",
    codigo: `${PREFIJO}PV_BIFE_CRIOLLA`,
    nombre: "Bife a la criolla",
    precioVenta: "20000.00",
    seccion: "Platos",
    ordenEnSeccion: 1,
    grupos: [
      { clave: "guarnicion", nombre: "Guarnicion", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ nombre: "Ensalada" }, { nombre: "Papas fritas" }, { nombre: "Puré" }] },
      {
        clave: "extras",
        nombre: "Extras",
        tipo: "ADICIONAL",
        cantidadMinima: 0,
        cantidadMaxima: 3,
        opciones: [
          { nombre: "Extra de papas", diferencia: "2000.00", ancla: { codigo: `${PREFIJO}PV_ANCLA_EXTRAPAPAS`, nombre: "Extra de papas" } },
          { nombre: "Huevo frito", diferencia: "1500.00", ancla: { codigo: `${PREFIJO}PV_ANCLA_HUEVO`, nombre: "Huevo frito" } },
        ],
      },
    ],
  },
  { clave: "wok", codigo: `${PREFIJO}PV_WOK`, nombre: "Wok de verduras", precioVenta: "19000.00", seccion: "Platos", ordenEnSeccion: 2, grupos: [] },
  {
    clave: "cafe",
    codigo: `${PREFIJO}PV_CAFE`,
    nombre: "Café",
    precioVenta: "4000.00",
    seccion: "Cafetería",
    ordenEnSeccion: 0,
    grupos: [
      {
        clave: "tamanoDelCafe",
        nombre: "Tamaño del Café",
        tipo: "MEDIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        modoPrecio: "ABSOLUTO",
        opciones: [
          { nombre: "Chico", absoluto: "4000.00" },
          { nombre: "Mediano", absoluto: "4100.00" },
          { nombre: "Grande", absoluto: "4300.00" },
        ],
      },
      {
        clave: "preparacion",
        nombre: "Preparación del café",
        tipo: "VARIANTE",
        cantidadMinima: 0,
        cantidadMaxima: 1,
        opciones: [{ nombre: "Solo" }, { nombre: "Cortado" }, { nombre: "Lágrima", diferencia: "200.00" }, { nombre: "Con leche", diferencia: "300.00" }],
      },
    ],
  },
  { clave: "gaseosa", codigo: `${PREFIJO}PV_GASEOSA`, nombre: "Gaseosa 500 cc", precioVenta: "4000.00", seccion: "Bebidas", ordenEnSeccion: 0, grupos: [] },
];

/** Con qué producto del catálogo puro se compara cada uno (el Wok no está en él). */
const EN_LA_REFERENCIA: Readonly<Record<string, string>> = {
  Pizzas: "Pizzas",
  Milanesas: "Milanesas (M1: terminación con precio absoluto)",
  "Bife a la criolla": "Bife a la criolla",
  Café: "Café",
  "Gaseosa 500 cc": "Gaseosa 500 cc",
};

/** Tira si un precio de esta copia no es el del catálogo puro (precio base y, por nombre de opción, el precio absoluto o la diferencia). */
function verificarContraLaReferencia(): void {
  const errores: string[] = [];
  for (const p of PRODUCTOS) {
    const nombreRef = EN_LA_REFERENCIA[p.nombre];
    if (!nombreRef) continue;
    const ref = PRODUCTOS_DE_REFERENCIA.find((r) => r.nombre === nombreRef);
    if (!ref) {
      errores.push(`«${nombreRef}» no está en el catálogo de referencia`);
      continue;
    }
    if (ref.precioBase !== Number(p.precioVenta)) errores.push(`«${p.nombre}»: precio ${p.precioVenta}, la referencia dice ${ref.precioBase}`);
    const opcionesRef = ref.grupos.flatMap((g) => g.opciones);
    for (const o of p.grupos.flatMap((g) => g.opciones)) {
      const r = opcionesRef.find((x) => x.nombre === o.nombre);
      if (!r) {
        errores.push(`«${p.nombre}» › «${o.nombre}» no está en la referencia`);
        continue;
      }
      const absolutoRef = r.precioAbsoluto ?? null;
      const diferenciaRef = r.diferenciaDeLaVersion.tipo === "MONTO" ? r.diferenciaDeLaVersion.monto : null;
      if ((o.absoluto ? Number(o.absoluto) : null) !== absolutoRef) errores.push(`«${p.nombre}» › «${o.nombre}»: absoluto ${o.absoluto ?? "-"}, la referencia ${absolutoRef ?? "-"}`);
      if (Number(o.diferencia ?? 0) !== diferenciaRef) errores.push(`«${p.nombre}» › «${o.nombre}»: diferencia ${o.diferencia ?? "0"}, la referencia ${diferenciaRef ?? "-"}`);
    }
  }
  if (errores.length) throw new Error(`La siembra e2e de precio y carta se desvió del catálogo de referencia:\n${errores.join("\n")}`);
}

const NOMBRES_DE_GRUPOS = PRODUCTOS.flatMap((p) => p.grupos.map((g) => g.nombre));
const CODIGOS_PV = PRODUCTOS.map((p) => p.codigo);
const CODIGOS_ANCLA = PRODUCTOS.flatMap((p) => p.grupos.flatMap((g) => g.opciones.flatMap((o) => (o.ancla ? [o.ancla.codigo] : []))));

/** Borra todo lo de la línea de base por sus claves estables. Idempotente: sin nada sembrado, no hace nada. */
export async function limpiarLineaDeBasePrecioYCarta(): Promise<void> {
  const sucursal = await prisma.sucursal.findFirst({ where: { nombre: NOMBRE_SUCURSAL }, select: { id: true } });
  const usuario = await prisma.user.findFirst({ where: { email: EMAIL_USUARIO }, select: { id: true } });
  if (usuario) {
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prismaAdmin.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prismaAdmin.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
  }
  if (sucursal) {
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId: sucursal.id } });
    await prisma.contenidoCartaProducto.deleteMany({ where: { sucursalId: sucursal.id } });
    await prisma.capacidadSucursal.deleteMany({ where: { sucursalId: sucursal.id } });
    // El tema oscuro de las capturas (paso 13).
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId: sucursal.id } });
  }
  const pvIds = (await prisma.producto.findMany({ where: { codigo: { in: CODIGOS_PV } }, select: { id: true } })).map((p) => p.id);
  const anclaIds = (await prisma.producto.findMany({ where: { codigo: { in: CODIGOS_ANCLA } }, select: { id: true } })).map((p) => p.id);
  const mpIds = (await prisma.producto.findMany({ where: { codigo: { in: CODIGOS_PV.map((c) => `MP_REV_${c}`) } }, select: { id: true } })).map((p) => p.id);
  const grupoIds = (await prismaAdmin.grupoDeOpciones.findMany({ where: { nombre: { in: NOMBRES_DE_GRUPOS } }, select: { id: true } })).map((g) => g.id);
  // Las tablas de opciones: solo el dueño las puede borrar (GO-1). Primero lo que las referencia.
  await prismaAdmin.opcionApagadaEnSucursal.deleteMany({ where: { opcion: { grupoId: { in: grupoIds } } } });
  await prismaAdmin.productoAdmiteOpcion.deleteMany({ where: { OR: [{ productoId: { in: pvIds } }, { opcion: { grupoId: { in: grupoIds } } }] } });
  await prismaAdmin.productoAdmiteGrupo.deleteMany({ where: { OR: [{ productoId: { in: pvIds } }, { grupoId: { in: grupoIds } }] } });
  await prismaAdmin.consumoDeOpcion.deleteMany({ where: { versionDeOpcion: { opcion: { grupoId: { in: grupoIds } } } } });
  await prismaAdmin.versionDeOpcion.deleteMany({ where: { opcion: { grupoId: { in: grupoIds } } } });
  await prismaAdmin.opcionDeGrupo.deleteMany({ where: { grupoId: { in: grupoIds } } });
  await prismaAdmin.grupoDeOpciones.deleteMany({ where: { id: { in: grupoIds } } });
  await borrarRecetasDeReventa(prisma, { pvIds, mpIds });
  await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [...pvIds, ...anclaIds] } } });
  await prisma.producto.deleteMany({ where: { id: { in: [...pvIds, ...anclaIds] } } });
  await prisma.seccionCarta.deleteMany({ where: { nombre: { in: SECCIONES.map((s) => s.nombre) } } });
  if (usuario) await prisma.user.deleteMany({ where: { id: usuario.id } });
  if (sucursal) await prisma.sucursal.deleteMany({ where: { id: sucursal.id } });
}

/** Lo que quedó de la línea de base en la base (vacío = la limpieza no dejó nada): una entrada «tabla: cantidad» por cada tabla con restos. */
export async function restosDeLaLineaDeBase(): Promise<string[]> {
  const codigos = [...CODIGOS_PV, ...CODIGOS_ANCLA, ...CODIGOS_PV.map((c) => `MP_REV_${c}`)];
  const cuentas: [string, number][] = [
    ["Sucursal", await prisma.sucursal.count({ where: { nombre: NOMBRE_SUCURSAL } })],
    ["SucursalPublica", await prisma.sucursalPublica.count({ where: { slug: SLUG } })],
    ["User", await prisma.user.count({ where: { email: EMAIL_USUARIO } })],
    ["Producto", await prisma.producto.count({ where: { codigo: { in: codigos } } })],
    ["SeccionCarta", await prisma.seccionCarta.count({ where: { nombre: { in: SECCIONES.map((s) => s.nombre) } } })],
    ["GrupoDeOpciones", await prismaAdmin.grupoDeOpciones.count({ where: { nombre: { in: NOMBRES_DE_GRUPOS } } })],
  ];
  return cuentas.filter(([, n]) => n > 0).map(([tabla, n]) => `${tabla}: ${n}`);
}

interface LineaDeBaseSembrada {
  slug: string;
  sucursalNombre: string;
  /** Las secciones de carta sembradas, en su orden. */
  secciones: readonly string[];
  /** Por clave del producto («pizzas», «cafe», …). */
  productoId: Readonly<Record<string, string>>;
  /** Por clave del grupo («tiposDePizza», …). */
  grupoId: Readonly<Record<string, string>>;
  /** El token de la sesión del usuario propio (cookie `authjs.session-token`). */
  sessionToken: string;
}

/**
 * Siembra el catálogo de referencia en la sucursal dedicada y la publica. Requiere la base de los fixtures (`asegurarBaseSeed`: unidades, rol admin y el usuario de las pruebas, que
 * firma las versiones de las opciones): el spec la pide con el fixture `sucursalId`. Si algo falla a mitad de camino, limpia lo sembrado antes de tirar.
 */
export async function sembrarLineaDeBasePrecioYCarta(): Promise<LineaDeBaseSembrada> {
  verificarContraLaReferencia();
  await limpiarLineaDeBasePrecioYCarta();
  try {
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const rolAdmin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const firmante = await prisma.user.findFirstOrThrow({ where: { email: "e2e-admin@local.test" }, select: { id: true } });
    const sucursal = await prisma.sucursal.create({ data: { nombre: NOMBRE_SUCURSAL } });

    const seccionId: Record<string, string> = {};
    for (const s of SECCIONES) seccionId[s.nombre] = (await prisma.seccionCarta.create({ data: { nombre: s.nombre, orden: s.orden } })).id;

    const productoId: Record<string, string> = {};
    const grupoId: Record<string, string> = {};
    for (const p of PRODUCTOS) {
      const pv = await prisma.producto.create({ data: { codigo: p.codigo, nombre: p.nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: p.precioVenta, ...(p.modoDeVenta ? { modoDeVenta: p.modoDeVenta } : {}) } });
      productoId[p.clave] = pv.id;
      await prisma.disponibilidadProducto.create({ data: { sucursalId: sucursal.id, productoId: pv.id, disponible: true } });
      await darRecetaDeReventa(prisma, pv, { sucursalIds: [sucursal.id] });
      await prisma.contenidoCartaProducto.create({ data: { sucursalId: sucursal.id, productoId: pv.id, visibleEnCarta: true, seccionCartaId: seccionId[p.seccion]!, orden: p.ordenEnSeccion } });

      for (const [ordenGrupo, g] of p.grupos.entries()) {
        const id = (await prisma.grupoDeOpciones.create({ data: { nombre: g.nombre, tipo: g.tipo, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima, ...(g.prefijoEnCarta ? { prefijoEnCarta: g.prefijoEnCarta } : {}) } })).id;
        grupoId[g.clave] = id;
        await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId: id, orden: ordenGrupo, ...(g.modoPrecio ? { modoPrecio: g.modoPrecio } : {}) } });
        for (const [ordenOpcion, o] of g.opciones.entries()) {
          const anclaId = o.ancla ? (await prisma.producto.create({ data: { codigo: o.ancla.codigo, nombre: o.ancla.nombre, tipo: "PV", unidadStockId: unidad.id, precioVenta: "0.00" } })).id : undefined;
          const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId: id, nombre: o.nombre, orden: ordenOpcion, ...(anclaId ? { productoId: anclaId } : {}) } })).id;
          await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: o.diferencia ?? "0.00", creadoPorId: firmante.id } });
          await prisma.productoAdmiteOpcion.create({
            data: { productoId: pv.id, opcionId, ...(o.absoluto ? { precioAbsoluto: o.absoluto } : {}), ...(g.tipo === "ADICIONAL" ? { cantidadMaxima: g.cantidadMaxima } : {}) },
          });
          if (o.agotadaHoy) await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: sucursal.id, opcionId, apagada: true, actualizadoPorId: firmante.id } });
        }
      }
    }

    await prisma.sucursalPublica.create({ data: { sucursalId: sucursal.id, slug: SLUG, publicada: true } });

    const usuario = await prisma.user.create({ data: { email: EMAIL_USUARIO, activoGlobal: true } });
    await crearMembresia({ usuarioId: usuario.id, sucursalId: sucursal.id, rolId: rolAdmin.id, activo: true });
    const sessionToken = randomUUID();
    await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

    return { slug: SLUG, sucursalNombre: NOMBRE_SUCURSAL, secciones: SECCIONES.map((s) => s.nombre), productoId, grupoId, sessionToken };
  } catch (e) {
    await limpiarLineaDeBasePrecioYCarta();
    throw e;
  }
}
