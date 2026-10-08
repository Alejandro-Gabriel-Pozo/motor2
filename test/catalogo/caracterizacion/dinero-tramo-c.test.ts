import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));
// Los efectos de Next se CUENTAN (no se ejecutan): cuántas veces cada paso revalida la carta pública y refresca la vista es parte de la huella.
vi.mock("../../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

import { refresh } from "next/cache";
import { revalidarCartasPublicas } from "../../../src/server/actions/carta/revalidar";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../../setup/test-db";
import { crearMembresia } from "../../setup/membresia";
import { mockearUsuarioActual } from "../../setup/mock-sesion";
import { __setCookieDeTestParaSucursal } from "../../setup/next-headers-stub";
import { guardarDescuentoProducto } from "../../../src/server/actions/carta/descuento-producto";
import {
  actualizarActivaPromoCarta,
  actualizarActivaPromoCartaEnSucursal,
  guardarCuposPromoCarta,
  guardarPrecioLocalPromoCarta,
  guardarPromoCarta,
} from "../../../src/server/actions/carta/promos";
import { setPrecioLocalProducto, sincronizarPrecioLocalGrupoCarta } from "../../../src/server/actions/movimientos/precio-local";
import { fijarRendimientoLocal, volverAlRendimientoCentral } from "../../../src/server/actions/catalogo/rendimiento-local";
import { volverALaRecetaCentral } from "../../../src/server/actions/catalogo/receta-sucursal";
import { actualizarActivaPresentacion, actualizarProducto, agregarPresentacionAlternativa, darDeAltaProducto, sincronizarPrecioGrupoCarta } from "../../../src/server/actions/catalogo/productos";
import { actualizarDecimalesUnidad, crearUnidad } from "../../../src/server/actions/catalogo/unidades";
import { actualizarCliente, altaCliente } from "../../../src/server/actions/clientes/cliente";
import { guardarMargenObjetivo } from "../../../src/server/actions/reportes/margen-objetivo";

/**
 * HUELLA DE DINERO del tramo C (Hito 4, paso H4C-0.3 de `docs/plan-hito-4-pureza.md` §3): las Server Actions que mueven plata en la pieza «carta, catálogo y
 * stock», recorridas por las acciones públicas con la sesión de un admin de dos sucursales, ANTES de mudarlas a casos de uso. Cubre las 11 de 4.2 (descuento de
 * producto, las 5 de promos, `setPrecioLocalProducto`, `sincronizarPrecioLocalGrupoCarta`, las 2 de rendimiento local y `volverALaRecetaCentral`) y, para que
 * los bloques B y C tengan la misma red, las de dinero que esos bloques mudan: `darDeAltaProducto`, `actualizarProducto`, `sincronizarPrecioGrupoCarta`, las 2 de
 * presentaciones, `crearUnidad`/`actualizarDecimalesUnidad`, `altaCliente`/`actualizarCliente` y `guardarMargenObjetivo`. Se escribe contra el código viejo y NO
 * se edita en ningún paso posterior: si una mudanza cambia un mensaje, una fila, el orden de dos chequeos, una fila de auditoría o un efecto de Next, este
 * archivo lo ve en rojo. Para regenerarlo A PROPÓSITO (una decisión de producto, nunca una mudanza):
 * `REGENERAR_HUELLA_DE_DINERO_TRAMO_C=1 npx vitest run test/catalogo/caracterizacion/dinero-tramo-c.test.ts`; la regeneración se declara además en
 * `test/arquitectura/caracterizaciones-congeladas.test.ts`. Archivo propio y no snapshots de Vitest, para que `-u` no lo regenere en silencio.
 *
 * Por cada paso se vuelca: el resultado (los ids con nombres simbólicos); cuántas veces llamó a `revalidarCartasPublicas` y a `refresh` de Next (el corazón de
 * `refrescarVistaSiHaceFalta`), con los dos módulos reemplazados por contadores; las FILAS TOCADAS de las tablas de dinero de la pieza (`+` nueva, `-` borrada,
 * `-`/`+` cambiada, `=` reescrita con el mismo valor: cambió su `actualizadoEn`), con los `Decimal` como texto, las fechas como `<fecha>` y los ids con nombre;
 * y las filas NUEVAS de `RegistroAuditoria`, sin id ni fecha, ordenadas por `[creadoEn, id]`. Casos: alta, cambio, sin cambios, borrar, el piso de la promo, la
 * sucursal cambiada (dos sucursales, la cookie de la sucursal activa) y el ítem agrupado de la carta (las dos sincronizaciones y el `sincronizable`).
 */
const ARCHIVO = join(__dirname, "dinero-tramo-c.golden.txt");
const E = EMPRESA_POR_DEFECTO_ID;

afterAll(async () => {
  __setCookieDeTestParaSucursal(undefined);
  await limpiarBaseDeTest();
});

type Fila = Record<string, unknown> & { id: string };

describe("Huella de dinero del tramo C", () => {
  const nombres = new Map<string, string>();
  const contadores = new Map<string, number>();
  const lineas: string[] = [];

  const nombrar = (prefijo: string, id: string): void => {
    if (nombres.has(id)) return;
    const n = (contadores.get(prefijo) ?? 0) + 1;
    contadores.set(prefijo, n);
    nombres.set(id, `${prefijo}${n}`);
  };
  const simbolo = (valor: string): string => (nombres.get(valor) ?? valor).replace(/c[a-z0-9]{20,}/g, (id) => nombres.get(id) ?? "<id-sin-nombre>");

  /** La fila sin su propio id, con las columnas ordenadas, los Decimal como texto, las fechas como `<fecha>` y los ids con nombre. */
  const fila = (f: Record<string, unknown>, sinColumnas: readonly string[] = ["id"]): string =>
    Object.keys(f)
      .filter((c) => !sinColumnas.includes(c))
      .sort()
      .map((columna) => {
        const v = f[columna];
        if (v === null || v === undefined) return `${columna}=null`;
        if (v instanceof Date) return `${columna}=<fecha>`;
        if (v instanceof Prisma.Decimal) return `${columna}=${v.toString()}`;
        if (typeof v === "string") return `${columna}=${simbolo(v)}`;
        if (Array.isArray(v)) return `${columna}=[${v.map((x) => (typeof x === "string" ? simbolo(x) : String(x))).join(",")}]`;
        return `${columna}=${String(v)}`;
      })
      .join(" ");
  const fechas = (f: Record<string, unknown>): string =>
    Object.keys(f)
      .sort()
      .flatMap((c) => (f[c] instanceof Date ? [`${c}=${(f[c] as Date).getTime()}`] : []))
      .join(" ");

  const donde = { where: { empresaId: E } };
  /** Las tablas de dinero (y de su significado) que toca la pieza: título, prefijo de los nombres y lectura de la empresa. */
  const TABLAS: { titulo: string; prefijo: string; leer: () => Promise<Fila[]> }[] = [
    { titulo: "PRODUCTO", prefijo: "producto", leer: () => prismaAdmin.producto.findMany(donde) },
    { titulo: "DISPONIBILIDAD", prefijo: "disponibilidad", leer: () => prismaAdmin.disponibilidadProducto.findMany(donde) },
    { titulo: "PRESENTACION", prefijo: "presentacion", leer: () => prismaAdmin.presentacion.findMany(donde) },
    { titulo: "UNIDAD", prefijo: "unidad", leer: () => prismaAdmin.unidad.findMany(donde) },
    { titulo: "CLIENTE", prefijo: "cliente", leer: () => prismaAdmin.cliente.findMany(donde) },
    { titulo: "MARGEN_OBJETIVO", prefijo: "margen", leer: () => prismaAdmin.margenObjetivo.findMany(donde) },
    { titulo: "PRECIO_LOCAL", prefijo: "precioLocal", leer: () => prismaAdmin.precioLocalProducto.findMany(donde) },
    { titulo: "DESCUENTO", prefijo: "descuento", leer: () => prismaAdmin.descuentoProductoSucursal.findMany(donde) },
    { titulo: "PROMO", prefijo: "promo", leer: () => prismaAdmin.promoCarta.findMany(donde) },
    { titulo: "PROMO_SUCURSAL", prefijo: "promoSucursal", leer: () => prismaAdmin.promoCartaSucursal.findMany(donde) },
    { titulo: "PROMO_CUPO", prefijo: "cupo", leer: () => prismaAdmin.promoCartaCupo.findMany(donde) },
    { titulo: "RENDIMIENTO_LOCAL", prefijo: "rendimiento", leer: () => prismaAdmin.rendimientoLocalIngrediente.findMany(donde) },
    { titulo: "RECETA_SUCURSAL", prefijo: "recetaSucursal", leer: () => prismaAdmin.recetaSucursal.findMany(donde) },
    { titulo: "RECETA_VERSION", prefijo: "recetaVersion", leer: () => prismaAdmin.recetaVersion.findMany(donde) },
  ];

  /** El estado de cada tabla: id → [fila normalizada, fechas crudas]. */
  type Estado = Map<string, Map<string, [string, string]>>;
  let estado: Estado = new Map();
  let auditoriasVistas = new Set<string>();

  async function leerEstado(): Promise<Estado> {
    const nuevo: Estado = new Map();
    for (const t of TABLAS) {
      const filas = await t.leer();
      // Las filas que aparecen por primera vez se nombran en un orden que no depende del id: por su contenido (con lo ya nombrado).
      const sinNombre = filas.filter((f) => !nombres.has(f.id)).sort((a, b) => fila(a).localeCompare(fila(b)));
      sinNombre.forEach((f) => nombrar(t.prefijo, f.id));
      nuevo.set(t.titulo, new Map(filas.map((f) => [f.id, [fila(f), fechas(f)] as [string, string]])));
    }
    return nuevo;
  }

  /** Las filas tocadas desde el paso anterior, en el orden de las tablas y, dentro de cada una, por nombre. */
  function filasTocadas(antes: Estado, despues: Estado): string[] {
    const salida: string[] = [];
    for (const t of TABLAS) {
      const a = antes.get(t.titulo) ?? new Map();
      const d = despues.get(t.titulo) ?? new Map();
      const ids = [...new Set([...a.keys(), ...d.keys()])].sort((x, y) => simbolo(x).localeCompare(simbolo(y), "es", { numeric: true }));
      for (const id of ids) {
        const va = a.get(id);
        const vd = d.get(id);
        const quien = `${t.titulo} ${simbolo(id)}`;
        if (!va && vd) salida.push(`  + ${quien} ${vd[0]}`);
        else if (va && !vd) salida.push(`  - ${quien} ${va[0]}`);
        else if (va && vd && va[0] !== vd[0]) salida.push(`  - ${quien} ${va[0]}`, `  + ${quien} ${vd[0]}`);
        else if (va && vd && va[1] !== vd[1]) salida.push(`  = ${quien} (reescrita con el mismo valor)`);
      }
    }
    return salida;
  }

  /** Las filas de auditoría que no estaban, ordenadas por `[creadoEn, id]`, sin id ni fecha. */
  async function auditoriaNueva(): Promise<string[]> {
    const todas = await prismaAdmin.registroAuditoria.findMany({ where: { empresaId: E }, orderBy: [{ creadoEn: "asc" }, { id: "asc" }] });
    const nuevas = todas.filter((a) => !auditoriasVistas.has(a.id));
    nuevas.forEach((a) => auditoriasVistas.add(a.id));
    return nuevas.map((a) => `  AUDITORIA ${fila(a, ["id", "creadoEn"])}`);
  }

  const paso = async (titulo: string, resultado: unknown) => {
    const despues = await leerEstado();
    const revalidar = vi.mocked(revalidarCartasPublicas).mock.calls.length;
    const refrescar = vi.mocked(refresh).mock.calls.length;
    vi.mocked(revalidarCartasPublicas).mockClear();
    vi.mocked(refresh).mockClear();
    lineas.push(
      `### ${titulo}`,
      `  resultado: ${JSON.stringify(resultado, (_, v) => (typeof v === "string" ? simbolo(v) : v))}`,
      `  efectos: revalidarCartasPublicas=${revalidar} refrescar=${refrescar}`,
      ...filasTocadas(estado, despues),
      ...(await auditoriaNueva()),
    );
    estado = despues;
  };

  beforeEach(async () => {
    nombres.clear();
    contadores.clear();
    lineas.length = 0;
    estado = new Map();
    auditoriasVistas = new Set();
    __setCookieDeTestParaSucursal(undefined);
    await limpiarBaseDeTest();
  });

  it("la secuencia entera coincide con lo guardado", async () => {
    const base = await sembrarBase();
    const central = base.sucursal.id;
    const norte = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: norte, rolId: base.admin.id });
    const enCentral = () => __setCookieDeTestParaSucursal(central);
    const enNorte = () => __setCookieDeTestParaSucursal(norte);
    enCentral();
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });

    const u = await prisma.unidad.create({ data: { nombre: "unidad", magnitud: "CANTIDAD", decimales: 0 } });
    const kg = await prisma.unidad.create({ data: { nombre: "kg", magnitud: "PESO", decimales: 2 } });
    const caja = await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } });
    const categoria = await prisma.categoriaProducto.create({ data: { nombre: "Pastas" } });
    const insumo = await prisma.insumo.create({ data: { nombre: "Harina" } });
    const harina = await sembrarProductoDisponible({ codigo: "MP_H000", nombre: "Harina 000", tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id }, central);
    const pizza = await sembrarProductoDisponible({ codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: u.id, precioVenta: 12000 }, central);
    const faina = await sembrarProductoDisponible({ codigo: "PV_FAINA", nombre: "Fainá", tipo: "PV", unidadStockId: u.id, precioVenta: 5000 }, central);
    const flan = await sembrarProductoDisponible({ codigo: "PV_FLAN", nombre: "Flan", tipo: "PV", unidadStockId: u.id, precioVenta: 3000 }, central);
    const empanada = await sembrarProductoDisponible({ codigo: "PV_EMP", nombre: "Empanada", tipo: "PV", unidadStockId: u.id, precioVenta: 1500 }, central);
    for (const p of [harina, pizza, faina, flan, empanada]) await prisma.disponibilidadProducto.create({ data: { sucursalId: norte, productoId: p.id, disponible: true } });

    // La receta central de la Pizza (0,25 kg de Harina 000) y la receta PROPIA habilitada de la Empanada en Central.
    const recetaPizza = await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.25, unidadId: kg.id, mermaPorcentaje: 0 }] } },
      include: { ingredientes: true },
    });
    const lineaPizza = recetaPizza.ingredientes[0].id;
    await prisma.recetaVersion.create({
      data: { productoId: empanada.id, sucursalId: central, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.05, unidadId: kg.id, mermaPorcentaje: 0 }] } },
    });
    await prisma.recetaSucursal.create({ data: { sucursalId: central, productoId: empanada.id, habilitada: true } });

    // La carta: la Pizza y la Fainá son opciones del mismo ítem agrupado en Central; la promo «Menú del día» de la empresa, prendida en Central.
    const platos = await prisma.seccionCarta.create({ data: { nombre: "Platos" } });
    const postres = await prisma.seccionCarta.create({ data: { nombre: "Postres" } });
    const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: central, nombre: "Para picar", seccionCartaId: platos.id } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: central, itemAgrupadoCartaId: item.id, productoId: pizza.id, orden: 1 } });
    await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: central, itemAgrupadoCartaId: item.id, productoId: faina.id, orden: 2 } });
    const menu = await prisma.promoCarta.create({ data: { seccionCartaId: platos.id, titulo: "Menú del día", precio: 10000, sucursales: { create: { sucursalId: central } } } });

    const fijos: Record<string, string> = {
      [E]: "empresa",
      [central]: "central",
      [norte]: "norte",
      [admin.id]: "admin",
      [u.id]: "unidad",
      [kg.id]: "kg",
      [caja.id]: "caja",
      [categoria.id]: "pastas",
      [insumo.id]: "insumoHarina",
      [harina.id]: "harina",
      [pizza.id]: "pizza",
      [faina.id]: "faina",
      [flan.id]: "flan",
      [empanada.id]: "empanada",
      [lineaPizza]: "lineaPizzaV1",
      [platos.id]: "platos",
      [postres.id]: "postres",
      [item.id]: "paraPicar",
      [menu.id]: "menu",
    };
    for (const [id, n] of Object.entries(fijos)) nombres.set(id, n);
    estado = await leerEstado();
    await auditoriaNueva();
    vi.mocked(revalidarCartasPublicas).mockClear();
    vi.mocked(refresh).mockClear();
    lineas.push("### estado inicial", ...[...estado.entries()].flatMap(([titulo, filas]) => [...filas.entries()].map(([id, [f]]) => `  ${titulo} ${simbolo(id)} ${f}`)).sort());

    // ── A. Descuento de producto (sucursal activa: Central) ────────────────────────────────────────────────────────────────────────────────────────────
    await paso("descuento: alta del 15 % al Flan", await guardarDescuentoProducto(flan.id, 15));
    await paso("descuento: cambio a «20,5»", await guardarDescuentoProducto(flan.id, "20,5"));
    await paso("descuento: sin cambios (20.5 otra vez)", await guardarDescuentoProducto(flan.id, 20.5));
    await paso("descuento: borrar (null)", await guardarDescuentoProducto(flan.id, null));
    await paso("descuento: borrar lo que no tenía (null)", await guardarDescuentoProducto(flan.id, null));
    await paso("descuento: 0 es borrar, sin fila", await guardarDescuentoProducto(flan.id, 0));
    await paso("descuento: la Pizza es opción de un ítem agrupado", await guardarDescuentoProducto(pizza.id, 10));
    await paso("descuento: una MP no admite descuento", await guardarDescuentoProducto(harina.id, 10));
    await paso("descuento: 150 % fuera de rango", await guardarDescuentoProducto(flan.id, 150));
    await paso("descuento: producto inexistente", await guardarDescuentoProducto("no-existe", 10));
    await paso("descuento: alta del 10 % al Flan en Central", await guardarDescuentoProducto(flan.id, 10));
    enNorte();
    await paso("descuento: sucursal cambiada (Norte), alta del 5 %", await guardarDescuentoProducto(flan.id, 5));
    enCentral();

    // ── B. Promos de la carta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso("promo: alta del «Combo» a $8000", await guardarPromoCarta({ seccionCartaId: platos.id, titulo: "Combo", descripcion: "Para dos", precio: 8000, orden: 2 }));
    const combo = await prisma.promoCarta.findFirstOrThrow({ where: { titulo: "Combo" } });
    await paso("promo: el Combo pasa a $8500", await guardarPromoCarta({ id: combo.id, seccionCartaId: platos.id, titulo: "Combo", precio: "8500" }));
    await paso("promo: solo el título (precio igual, sin auditoría)", await guardarPromoCarta({ id: combo.id, seccionCartaId: postres.id, titulo: "Combo grande", precio: 8500 }));
    await paso("promo: id inexistente", await guardarPromoCarta({ id: "no-existe", seccionCartaId: platos.id, titulo: "X", precio: 100 }));
    await paso("promo: sección inexistente", await guardarPromoCarta({ seccionCartaId: "no-existe", titulo: "X", precio: 100 }));
    await paso("promo: sin título", await guardarPromoCarta({ seccionCartaId: platos.id, titulo: "  ", precio: 100 }));
    await paso("promo: precio inválido", await guardarPromoCarta({ seccionCartaId: platos.id, titulo: "X", precio: "abc" }));
    await paso("promo: precio con coma (el validador de la carta no la acepta: el mensaje dice «negativo», se fija tal cual)", await guardarPrecioLocalPromoCarta(menu.id, "9000,5"));
    await paso("promo: apagado general del Menú", await actualizarActivaPromoCarta(menu.id, false));
    await paso("promo: prendido general del Menú", await actualizarActivaPromoCarta(menu.id, true));
    await paso("promo: apagado general de una inexistente", await actualizarActivaPromoCarta("no-existe", false));
    await paso("promo: el Combo apagado en Central", await actualizarActivaPromoCartaEnSucursal(combo.id, false));
    enNorte();
    await paso("promo: sucursal cambiada (Norte) prende el Combo", await actualizarActivaPromoCartaEnSucursal(combo.id, true));
    await paso("promo: precio local del Combo en Norte (fila ya prendida)", await guardarPrecioLocalPromoCarta(combo.id, 7000));
    enCentral();
    await paso("promo: precio local del Menú en Central", await guardarPrecioLocalPromoCarta(menu.id, 9000));
    await paso("promo: el mismo precio local (sin auditoría)", await guardarPrecioLocalPromoCarta(menu.id, "9000"));
    await paso("promo: precio local vacío vuelve al de la empresa", await guardarPrecioLocalPromoCarta(menu.id, ""));
    await paso("promo: precio local de una inexistente", await guardarPrecioLocalPromoCarta("no-existe", 100));
    await paso("promo: precio local inválido", await guardarPrecioLocalPromoCarta(menu.id, "-3"));
    await paso(
      "promo: cupos del Menú (Platos hasta 2, Postres 1 a 1)",
      await guardarCuposPromoCarta(menu.id, [
        { seccionCartaId: platos.id, cantidadMaxima: 2 },
        { seccionCartaId: postres.id, cantidadMinima: 1, cantidadMaxima: "1" },
      ]),
    );
    await paso("promo: precio local por debajo del piso (3 unidades)", await guardarPrecioLocalPromoCarta(menu.id, 0.02));
    await paso("promo: precio local justo en el piso", await guardarPrecioLocalPromoCarta(menu.id, 0.05));
    await paso(
      "promo: cupos que dejan el precio local bajo el piso",
      await guardarCuposPromoCarta(menu.id, [
        { seccionCartaId: platos.id, cantidadMaxima: 5 },
        { seccionCartaId: postres.id, cantidadMaxima: 5 },
      ]),
    );
    await paso("promo: precio de la empresa bajo el piso de sus cupos (hoy la edición NO mira el piso: hallazgo, se fija tal cual)", await guardarPromoCarta({ id: menu.id, seccionCartaId: platos.id, titulo: "Menú del día", precio: 0.01 }));
    await paso("promo: cupos con la sección repetida", await guardarCuposPromoCarta(menu.id, [{ seccionCartaId: platos.id, cantidadMaxima: 1 }, { seccionCartaId: platos.id, cantidadMaxima: 1 }]));
    await paso("promo: cupo con mínimo mayor que el máximo", await guardarCuposPromoCarta(menu.id, [{ seccionCartaId: platos.id, cantidadMinima: 3, cantidadMaxima: 2 }]));
    await paso("promo: cupo de una sección inexistente", await guardarCuposPromoCarta(menu.id, [{ seccionCartaId: "no-existe", cantidadMaxima: 1 }]));
    await paso("promo: cupos de una promo inexistente", await guardarCuposPromoCarta("no-existe", []));
    await paso("promo: sin cupos vuelve a informativa", await guardarCuposPromoCarta(menu.id, []));

    // ── C. Precio local (Central; la Pizza y la Fainá en el mismo ítem agrupado) ─────────────────────────────────────────────────────────────────────────
    await paso("precio local: alta de la Pizza en $13000 (ofrece sincronizar)", await setPrecioLocalProducto(pizza.id, 13000, true));
    await paso("precio local: el mismo valor otra vez", await setPrecioLocalProducto(pizza.id, 13000, true));
    await paso("precio local: deshabilitado", await setPrecioLocalProducto(pizza.id, 13000, false));
    await paso("precio local: Flan (sin ítem agrupado)", await setPrecioLocalProducto(flan.id, 3500.5, true));
    await paso("precio local: negativo", await setPrecioLocalProducto(flan.id, -1, true));
    await paso("precio local: tres decimales", await setPrecioLocalProducto(flan.id, 1.234, true));
    await paso("precio local: producto inexistente", await setPrecioLocalProducto("no-existe", 100, true));
    await paso("sincronizar precio local: Pizza y Fainá a $13000", await sincronizarPrecioLocalGrupoCarta(central, [pizza.id, faina.id, pizza.id], 13000, true));
    await paso("sincronizar precio local: la pantalla era de otra sucursal", await sincronizarPrecioLocalGrupoCarta(norte, [pizza.id, faina.id], 13000, true));
    await paso("sincronizar precio local: no son del mismo ítem", await sincronizarPrecioLocalGrupoCarta(central, [pizza.id, flan.id], 13000, true));
    await paso("sincronizar precio local: lista vacía", await sincronizarPrecioLocalGrupoCarta(central, [], 13000, true));
    await paso("sincronizar precio local: precio inválido", await sincronizarPrecioLocalGrupoCarta(central, [pizza.id], Number.NaN, true));
    enNorte();
    await paso("precio local: sucursal cambiada (Norte), Pizza en $14000 (sin ítem agrupado allá)", await setPrecioLocalProducto(pizza.id, 14000, true));
    enCentral();

    // ── D. Rendimiento local y receta propia (Central) ─────────────────────────────────────────────────────────────────────────────────────────────────
    const origen = { tipo: "sugerencia_simple" as const, sucursalCalculoId: central, sugerido: 0.3, comprado: 30, vendido: 100, semanas: 4, confianza: "alta" };
    await paso("rendimiento: calibra la cantidad (con origen)", await fijarRendimientoLocal(lineaPizza, { cantidad: 0.3, mermaPorcentaje: null }, origen));
    await paso("rendimiento: suma la merma", await fijarRendimientoLocal(lineaPizza, { cantidad: 0.3, mermaPorcentaje: 5 }));
    await paso("rendimiento: cantidad inválida", await fijarRendimientoLocal(lineaPizza, { cantidad: -1, mermaPorcentaje: null }));
    await paso("rendimiento: sin ningún valor", await fijarRendimientoLocal(lineaPizza, { cantidad: null, mermaPorcentaje: null }));
    await paso("rendimiento: el reporte era de otra sucursal", await fijarRendimientoLocal(lineaPizza, { cantidad: 0.3, mermaPorcentaje: null }, { ...origen, sucursalCalculoId: norte }));
    await paso("rendimiento: línea inexistente", await fijarRendimientoLocal("no-existe", { cantidad: 0.3, mermaPorcentaje: null }));
    await paso("rendimiento: vuelve al central", await volverAlRendimientoCentral(lineaPizza));
    await paso("rendimiento: vuelve al central otra vez (no-op)", await volverAlRendimientoCentral(lineaPizza));
    await paso("rendimiento: vuelve al central de una línea inexistente", await volverAlRendimientoCentral("no-existe"));
    await prisma.recetaVersion.create({
      data: { productoId: pizza.id, version: 2, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.3, unidadId: kg.id, mermaPorcentaje: 0 }] } },
    });
    await paso("rendimiento: la receta cambió (v2) mientras se miraba el reporte", await fijarRendimientoLocal(lineaPizza, { cantidad: 0.3, mermaPorcentaje: null }));
    await paso("rendimiento: volver al central con la receta cambiada", await volverAlRendimientoCentral(lineaPizza));
    await paso("receta propia: sin confirmar", await volverALaRecetaCentral(empanada.id, false));
    await paso("receta propia: vuelve a la central", await volverALaRecetaCentral(empanada.id, true));
    await paso("receta propia: ya no tiene propia habilitada", await volverALaRecetaCentral(empanada.id, true));

    // ── E. Lo de dinero que mudan los bloques B y C (se caracteriza sin moverlo) ────────────────────────────────────────────────────────────────────────
    await paso(
      "producto: alta de la Tarta (en todas las sucursales)",
      await darDeAltaProducto({ codigo: "PV_TARTA", nombre: "Tarta", tipo: "PV", categoriaId: categoria.id, unidadStockId: u.id, factorConversion: 1, precioVenta: 7000 }),
    );
    await paso(
      "producto: alta de la Torta (solo en la sucursal activa)",
      await darDeAltaProducto({ codigo: "PV_TORTA", nombre: "Torta", tipo: "PV", unidadStockId: u.id, factorConversion: 1, precioVenta: 6500.5, activoEnTodasLasSucursales: false }),
    );
    await paso("producto: alta con nombre repetido", await darDeAltaProducto({ codigo: "PV_X", nombre: "tarta", tipo: "PV", unidadStockId: u.id, factorConversion: 1 }));
    await paso(
      "producto: la Fainá pasa a $5200 (ofrece sincronizar)",
      await actualizarProducto(faina.id, { nombre: "Fainá", tipo: "PV", unidadStockId: u.id, factorConversion: 1, precioVenta: 5200, precioConsignacion: 0 }),
    );
    await paso("producto: la Fainá sin cambios de precio", await actualizarProducto(faina.id, { nombre: "Fainá", tipo: "PV", unidadStockId: u.id, factorConversion: 1, precioVenta: 5200 }));
    await paso("producto: cambiar el tipo", await actualizarProducto(faina.id, { nombre: "Fainá", tipo: "MP", unidadStockId: u.id, factorConversion: 1 }));
    await paso("sincronizar precio global: Pizza y Fainá a $11000", await sincronizarPrecioGrupoCarta([pizza.id, faina.id], 11000));
    await paso("sincronizar precio global: negativo", await sincronizarPrecioGrupoCarta([pizza.id, faina.id], -5));
    await paso("sincronizar precio global: no son del mismo ítem", await sincronizarPrecioGrupoCarta([pizza.id, flan.id], 100));
    await paso("presentación: alta de la caja de 25 kg", await agregarPresentacionAlternativa(harina.id, caja.id, 25));
    await paso("presentación: la misma caja otra vez", await agregarPresentacionAlternativa(harina.id, caja.id, 25));
    await paso("presentación: la caja pasa a 30 kg", await agregarPresentacionAlternativa(harina.id, caja.id, 30));
    await paso("presentación: factor inválido (tres decimales en kg)", await agregarPresentacionAlternativa(harina.id, caja.id, 1.234));
    const presentacion = await prisma.presentacion.findFirstOrThrow({ where: { productoId: harina.id } });
    await paso("presentación: desactivada", await actualizarActivaPresentacion(presentacion.id, false));
    await paso("presentación: la caja reactivada al volver a agregarla", await agregarPresentacionAlternativa(harina.id, caja.id, 30));
    await paso("unidad: alta del litro (decimales por defecto)", await crearUnidad({ nombre: "litro", magnitud: "VOLUMEN" }));
    await paso("unidad: alta repetida", await crearUnidad({ nombre: "LITRO", magnitud: "VOLUMEN" }));
    const litro = await prisma.unidad.findFirstOrThrow({ where: { nombre: "litro" } });
    await paso("unidad: decimales del litro a 3", await actualizarDecimalesUnidad(litro.id, 3));
    await paso("unidad: los mismos decimales", await actualizarDecimalesUnidad(litro.id, 3));
    await paso("unidad: decimales fuera de rango", await actualizarDecimalesUnidad(litro.id, 7));
    await paso("cliente: alta de Fulano con 10 %", await altaCliente("Fulano", 10));
    await paso("cliente: alta repetida", await altaCliente("fulano", 5));
    await paso("cliente: % inválido", await altaCliente("Mengano", 150));
    const fulano = await prisma.cliente.findFirstOrThrow({ where: { nombre: "Fulano" } });
    await paso("cliente: Fulano pasa a 12,5 %", await actualizarCliente(fulano.id, "Fulano", "12,5"));
    await paso("cliente: Fulano cambia de nombre", await actualizarCliente(fulano.id, "Fulano Pérez", 12.5));
    await paso("margen: alta del objetivo de la empresa (30 %)", await guardarMargenObjetivo(null, 30));
    await paso("margen: el mismo objetivo", await guardarMargenObjetivo(null, "30"));
    await paso("margen: cambio a 32,5 %", await guardarMargenObjetivo(null, "32,5"));
    await paso("margen: objetivo de la categoría Pastas", await guardarMargenObjetivo(categoria.id, 25));
    await paso("margen: borrar el de la empresa", await guardarMargenObjetivo(null, null));
    await paso("margen: borrar lo que no tenía", await guardarMargenObjetivo(null, ""));
    await paso("margen: categoría inexistente", await guardarMargenObjetivo("cnoexiste000000000000000", 20));

    const actual = lineas.join("\n") + "\n";
    expect(actual.length).toBeGreaterThan(20_000); // si el escenario no armó nada, esto no está mirando nada
    expect(actual).not.toContain("<id-sin-nombre>");

    if (process.env.REGENERAR_HUELLA_DE_DINERO_TRAMO_C === "1") {
      mkdirSync(__dirname, { recursive: true });
      writeFileSync(ARCHIVO, actual, "utf8");
      return;
    }
    expect(existsSync(ARCHIVO), "falta dinero-tramo-c.golden.txt: generalo contra el código ANTERIOR a la mudanza").toBe(true);
    expect(actual.replace(/\r\n/g, "\n")).toBe(readFileSync(ARCHIVO, "utf8").replace(/\r\n/g, "\n"));
  }, 180_000);
});
