import { darRecetaDeReventa } from "./receta-de-venta";
import { prisma } from "./test-db";

/**
 * Siembra en Postgres el CATÁLOGO DE REFERENCIA de precio y carta (Fase 0 de la ola «precio y carta», 2026-10-19): las configuraciones REALES de producción que el catálogo puro
 * (`test/setup/referencia-precio-y-carta.ts`) describe sin base, con los mismos nombres, tipos y precios, más su carta pública. Lo usa la caracterización integrada
 * `test/caracterizacion-precio-y-carta/cobro-y-carta.test.ts` (lo que cobra el servidor y lo que arma la carta pública, con el catálogo cargado en la base).
 *
 * Se siembra directo con Prisma y el cliente de los fixtures (`prisma` de `test-db.ts`: empresa de prueba fijada en la conexión, RLS y restricciones de la base como en el resto de
 * los tests), igual que `sembrarCafeDelSalon`: sin pasar por los casos de uso de administración, para que la caracterización no dependa de ellos. Sobre el escenario del salón
 * (`test/pos/salon-fixture.ts`).
 *
 * Qué queda (todo PV disponible en la sucursal, con receta de reventa —ADR-033, sin receta no se vende— y en la carta propia de la sucursal):
 *  - «Pizzas» (18.000): MEDIDA «Tipos de Pizza» en ABSOLUTO, 6 opciones con su precio absoluto;
 *  - «Milanesas» (20.000): MEDIDA «Tipo de Milanesa» en ABSOLUTO (Simple 20.000, Napolitana 25.000) + VARIANTE «Milanesas de» 1..1 (Carne, Pollo);
 *  - «Café» (4.000): MEDIDA «Tamaño del Café» en ABSOLUTO (Chico 4.000, Mediano 4.100, Grande 4.300) + VARIANTE «Preparación del café» 0..1 (Solo, Cortado, Lágrima +200, Con leche +300);
 *  - «Bife a la criolla» (20.000): INCLUIDA «Guarnicion» 1..1 (Ensalada, Papas fritas, Puré) + ADICIONAL «Extras» 0..3 (Extra de papas +2.000, Huevo frito +1.500, cada uno con su producto ancla);
 *  - «Gaseosa 500 cc» (4.000) y «Wok de verduras» (19.000), sin opciones.
 * Cada opción con su versión 1 (MONTO). La carta: secciones «Pizzas» (1), «Platos» (2), «Cafetería» (3) y «Bebidas» (4), y la sucursal publicada con el slug `central`.
 */

/** El escenario del salón que necesita la siembra (lo que devuelve `sembrarSalon`). */
interface Salon {
  sucursalId: string;
  unidad: { id: string };
  admin: { id: string };
}

interface OpcionSembrada {
  /** El nombre simbólico (estable entre corridas) con el que la caracterización la nombra. */
  clave: string;
  nombre: string;
  /** `precioAbsoluto` del producto (solo en una MEDIDA en ABSOLUTO). */
  absoluto?: string;
  /** La diferencia de la versión 1 (MONTO). */
  diferencia?: string;
  /** El producto ANCLA de un adicional (se crea con este nombre, PV sin precio). */
  ancla?: string;
}

interface GrupoSembrado {
  clave: string;
  nombre: string;
  tipo: "MEDIDA" | "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  cantidadMinima: number;
  cantidadMaxima: number;
  modoPrecio?: "ABSOLUTO";
  opciones: OpcionSembrada[];
}

interface ProductoSembrado {
  clave: string;
  codigo: string;
  nombre: string;
  precioVenta: string;
  seccion: string;
  ordenEnSeccion: number;
  grupos: GrupoSembrado[];
}

const SECCIONES: readonly { nombre: string; orden: number }[] = [
  { nombre: "Pizzas", orden: 1 },
  { nombre: "Platos", orden: 2 },
  { nombre: "Cafetería", orden: 3 },
  { nombre: "Bebidas", orden: 4 },
];

const PRODUCTOS: readonly ProductoSembrado[] = [
  {
    clave: "pizzas",
    codigo: "PV_PIZZAS",
    nombre: "Pizzas",
    precioVenta: "18000.00",
    seccion: "Pizzas",
    ordenEnSeccion: 0,
    grupos: [
      {
        clave: "tiposDePizza",
        nombre: "Tipos de Pizza",
        tipo: "MEDIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        modoPrecio: "ABSOLUTO",
        opciones: [
          { clave: "pizzaMuzzarella", nombre: "Pizza muzzarella", absoluto: "18000.00" },
          { clave: "pizzaVerduras", nombre: "Pizza de verduras asadas", absoluto: "20000.00" },
          { clave: "pizzaFugazzeta", nombre: "Pizza fugazzeta", absoluto: "22000.00" },
          { clave: "pizzaNapolitana", nombre: "Pizza napolitana", absoluto: "22000.00" },
          { clave: "pizzaPapas", nombre: "Pizza con papas fritas", absoluto: "25000.00" },
          { clave: "pizzaBomba", nombre: "Pizza bomba", absoluto: "25000.00" },
        ],
      },
    ],
  },
  {
    clave: "milanesas",
    codigo: "PV_MILANESAS",
    nombre: "Milanesas",
    precioVenta: "20000.00",
    seccion: "Platos",
    ordenEnSeccion: 0,
    grupos: [
      {
        clave: "tipoDeMilanesa",
        nombre: "Tipo de Milanesa",
        tipo: "MEDIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        modoPrecio: "ABSOLUTO",
        opciones: [
          { clave: "simple", nombre: "Simple", absoluto: "20000.00" },
          { clave: "napolitana", nombre: "Napolitana", absoluto: "25000.00" },
        ],
      },
      {
        clave: "milanesasDe",
        nombre: "Milanesas de",
        tipo: "VARIANTE",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        opciones: [
          { clave: "carne", nombre: "Carne" },
          { clave: "pollo", nombre: "Pollo" },
        ],
      },
    ],
  },
  {
    clave: "bife",
    codigo: "PV_BIFE_CRIOLLA",
    nombre: "Bife a la criolla",
    precioVenta: "20000.00",
    seccion: "Platos",
    ordenEnSeccion: 1,
    grupos: [
      {
        clave: "guarnicion",
        nombre: "Guarnicion",
        tipo: "INCLUIDA",
        cantidadMinima: 1,
        cantidadMaxima: 1,
        opciones: [
          { clave: "ensalada", nombre: "Ensalada" },
          { clave: "papas", nombre: "Papas fritas" },
          { clave: "pure", nombre: "Puré" },
        ],
      },
      {
        clave: "extras",
        nombre: "Extras",
        tipo: "ADICIONAL",
        cantidadMinima: 0,
        cantidadMaxima: 3,
        opciones: [
          { clave: "extraPapas", nombre: "Extra de papas", diferencia: "2000.00", ancla: "Extra de papas" },
          { clave: "huevo", nombre: "Huevo frito", diferencia: "1500.00", ancla: "Huevo frito" },
        ],
      },
    ],
  },
  { clave: "wok", codigo: "PV_WOK", nombre: "Wok de verduras", precioVenta: "19000.00", seccion: "Platos", ordenEnSeccion: 2, grupos: [] },
  {
    clave: "cafe",
    codigo: "PV_CAFE",
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
          { clave: "chico", nombre: "Chico", absoluto: "4000.00" },
          { clave: "mediano", nombre: "Mediano", absoluto: "4100.00" },
          { clave: "grande", nombre: "Grande", absoluto: "4300.00" },
        ],
      },
      {
        clave: "preparacion",
        nombre: "Preparación del café",
        tipo: "VARIANTE",
        cantidadMinima: 0,
        cantidadMaxima: 1,
        opciones: [
          { clave: "solo", nombre: "Solo" },
          { clave: "cortado", nombre: "Cortado" },
          { clave: "lagrima", nombre: "Lágrima", diferencia: "200.00" },
          { clave: "conLeche", nombre: "Con leche", diferencia: "300.00" },
        ],
      },
    ],
  },
  { clave: "gaseosa", codigo: "PV_GASEOSA", nombre: "Gaseosa 500 cc", precioVenta: "4000.00", seccion: "Bebidas", ordenEnSeccion: 0, grupos: [] },
];

/** Lo que deja sembrado `sembrarCatalogoPrecioYCarta`: los ids por clave simbólica, y la tabla inversa (id → nombre simbólico) para el volcado. */
export interface CatalogoPrecioYCarta {
  /** Por clave del producto («pizzas», «cafe», …). */
  producto: Readonly<Record<string, string>>;
  /** Por clave de la opción («pizzaMuzzarella», «chico», …). */
  opcion: Readonly<Record<string, string>>;
  /** La versión 1 de cada opción, por clave de la opción. */
  version: Readonly<Record<string, string>>;
  /** El slug público de la sucursal. */
  slug: string;
  /** id → nombre simbólico de TODO lo sembrado (productos, anclas, recetas, grupos, opciones, versiones, secciones). */
  nombres: ReadonlyMap<string, string>;
}

export async function sembrarCatalogoPrecioYCarta(s: Salon): Promise<CatalogoPrecioYCarta> {
  const nombres = new Map<string, string>();
  const producto: Record<string, string> = {};
  const opcion: Record<string, string> = {};
  const version: Record<string, string> = {};

  const seccionId: Record<string, string> = {};
  for (const sc of SECCIONES) {
    const id = (await prisma.seccionCarta.create({ data: { nombre: sc.nombre, orden: sc.orden } })).id;
    seccionId[sc.nombre] = id;
    nombres.set(id, `seccion«${sc.nombre}»`);
  }

  for (const p of PRODUCTOS) {
    const pv = await prisma.producto.create({ data: { codigo: p.codigo, nombre: p.nombre, tipo: "PV", unidadStockId: s.unidad.id, precioVenta: p.precioVenta } });
    producto[p.clave] = pv.id;
    nombres.set(pv.id, p.clave);
    await prisma.disponibilidadProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, disponible: true } });
    const reventa = await darRecetaDeReventa(prisma, pv, { sucursalIds: [s.sucursalId] });
    nombres.set(reventa.id, `${p.clave}Reventa`);
    await prisma.contenidoCartaProducto.create({ data: { sucursalId: s.sucursalId, productoId: pv.id, visibleEnCarta: true, seccionCartaId: seccionId[p.seccion]!, orden: p.ordenEnSeccion } });

    for (const [ordenGrupo, g] of p.grupos.entries()) {
      const grupoId = (await prisma.grupoDeOpciones.create({ data: { nombre: g.nombre, tipo: g.tipo, cantidadMinima: g.cantidadMinima, cantidadMaxima: g.cantidadMaxima } })).id;
      nombres.set(grupoId, `grupo«${g.clave}»`);
      await prisma.productoAdmiteGrupo.create({ data: { productoId: pv.id, grupoId, orden: ordenGrupo, ...(g.modoPrecio ? { modoPrecio: g.modoPrecio } : {}) } });
      for (const [ordenOpcion, o] of g.opciones.entries()) {
        let anclaId: string | undefined;
        if (o.ancla) {
          anclaId = (await prisma.producto.create({ data: { codigo: `PV_ANCLA_${o.clave.toUpperCase()}`, nombre: o.ancla, tipo: "PV", unidadStockId: s.unidad.id, precioVenta: "0.00" } })).id;
          nombres.set(anclaId, `${o.clave}Ancla`);
        }
        const opcionId = (await prisma.opcionDeGrupo.create({ data: { grupoId, nombre: o.nombre, orden: ordenOpcion, ...(anclaId ? { productoId: anclaId } : {}) } })).id;
        opcion[o.clave] = opcionId;
        nombres.set(opcionId, o.clave);
        const versionId = (await prisma.versionDeOpcion.create({ data: { opcionId, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: o.diferencia ?? "0.00", creadoPorId: s.admin.id } })).id;
        version[o.clave] = versionId;
        nombres.set(versionId, `${o.clave}.v1`);
        await prisma.productoAdmiteOpcion.create({
          data: { productoId: pv.id, opcionId, ...(o.absoluto ? { precioAbsoluto: o.absoluto } : {}), ...(g.tipo === "ADICIONAL" ? { cantidadMaxima: g.cantidadMaxima } : {}) },
        });
      }
    }
  }

  const slug = "central";
  await prisma.sucursalPublica.create({ data: { sucursalId: s.sucursalId, slug, publicada: true } });
  return { producto, opcion, version, slug, nombres };
}

/** El precio de la sucursal (la grilla, `PrecioLocalDeOpcion`) de un tamaño de un producto: rige si la sucursal tiene la capacidad `precio_local` (sin fila, prendida). */
export async function sembrarPrecioDeSucursalDeTamano(sucursalId: string, productoId: string, opcionId: string, precio: string) {
  await prisma.precioLocalDeOpcion.create({ data: { sucursalId, productoId, opcionId, precio } });
}
