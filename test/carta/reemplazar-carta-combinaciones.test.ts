import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
vi.mock("../../src/server/actions/carta/revalidar", () => ({ revalidarCartasPublicas: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { crearMembresia } from "../setup/membresia";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { copiarCartaDeSucursal, reemplazarCartaDeSucursal } from "../../src/server/actions/carta/copiar-carta";
import { COLUMNAS_DE_LA_CARTA, MODELOS_QUE_APUNTAN_A_LA_CARTA, PRESENCIAS, esperadoDeCopiar, esperadoDeReemplazar, nombreDe, type PresenciaDeCarta } from "./reemplazar-carta.oraculo";

/**
 * COMBINACIONES de «copiar / reemplazar la carta de otra sucursal» (regla del dueño, 2026-10-28, vale para todo el sistema): recorre TODAS las combinaciones de lo que tiene el destino (8) × lo que tiene el
 * origen (8) × el modo (COPIAR y REEMPLAZAR) contra el ORÁCULO escrito aparte (`reemplazar-carta.oraculo.ts`), contra Postgres real: 8 × 8 × 2 = 128 casos exhaustivos. Más los GUARDIANES: fallan si aparece una
 * dimensión nueva sin declarar (una columna nueva en las tablas de la carta, o una tabla nueva que apunte a una fila de la carta, lo que obligaría a revisar el borrado).
 */
describe("copiar / reemplazar la carta: todas las combinaciones contra el oráculo", () => {
  let centralId: string;
  let destinoId: string;
  let seccionId: string;
  let ids: { pizza: string; coca: string; bife: string; jugo: string };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    centralId = base.sucursal.id;
    destinoId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    const admin = await crearUsuarioConMembresia({ email: "admin-b@test.com", sucursalId: destinoId, rolId: base.admin.id });
    await crearMembresia({ usuarioId: admin.id, sucursalId: centralId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
    const unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } })).id;
    const pv = async (codigo: string, nombre: string) => (await sembrarProductoDisponible({ codigo, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId }, centralId)).id;
    ids = { pizza: await pv("PV_PIZZA", "Pizza"), coca: await pv("PV_COCA", "Coca"), bife: await pv("PV_BIFE", "Bife"), jugo: await pv("PV_JUGO", "Jugo") };
  });

  /** Siembra lo que dice la presencia en la sucursal, con nombres propios de `quien` (para que origen y destino nunca sean iguales por casualidad). */
  async function sembrar(sucursalId: string, p: PresenciaDeCarta, quien: string, productoItem: string, productoContenido: string) {
    const genero = p.generos ? await prisma.generoCarta.create({ data: { sucursalId, nombre: `Género ${quien}`, orden: 1 } }) : null;
    if (p.items) {
      const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId, nombre: `Ítem ${quien}`, seccionCartaId: seccionId, generoCartaId: genero?.id ?? null } });
      await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId, itemAgrupadoCartaId: item.id, productoId: productoItem, orden: 0 } });
    }
    if (p.contenidos) await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: productoContenido, visibleEnCarta: true, seccionCartaId: seccionId, descripcion: `Contenido ${quien}`, generoCartaId: genero?.id ?? null } });
  }

  /** La carta de la sucursal por CONTENIDO (sin ids), para compararla entre origen y destino. */
  async function porContenido(sucursalId: string) {
    const generos = await prisma.generoCarta.findMany({ where: { sucursalId }, orderBy: { nombre: "asc" } });
    const generoPorId = new Map(generos.map((g) => [g.id, g.nombre.replace(/ (origen|destino)$/, "")]));
    return {
      generos: generos.map((g) => [g.nombre.replace(/ (origen|destino)$/, ""), g.orden, g.activo]),
      items: (await prisma.itemAgrupadoCarta.findMany({ where: { sucursalId }, include: { opciones: true }, orderBy: { nombre: "asc" } })).map((i) => [i.nombre.replace(/ (origen|destino)$/, ""), i.generoCartaId ? generoPorId.get(i.generoCartaId) : null, i.opciones.map((o) => o.productoId)]),
      contenidos: (await prisma.contenidoCartaProducto.findMany({ where: { sucursalId }, orderBy: { productoId: "asc" } })).map((c) => [c.productoId, c.descripcion?.replace(/ (origen|destino)$/, ""), c.generoCartaId ? generoPorId.get(c.generoCartaId) : null]),
    };
  }
  const idsDe = async (sucursalId: string) => ({
    g: (await prisma.generoCarta.findMany({ where: { sucursalId }, orderBy: { id: "asc" } })).map((x) => x.id),
    i: (await prisma.itemAgrupadoCarta.findMany({ where: { sucursalId }, orderBy: { id: "asc" } })).map((x) => x.id),
    c: (await prisma.contenidoCartaProducto.findMany({ where: { sucursalId }, orderBy: { id: "asc" } })).map((x) => x.id),
  });

  for (const destino of PRESENCIAS) {
    for (const origen of PRESENCIAS) {
      it(`destino ${nombreDe(destino)} × origen ${nombreDe(origen)}`, async () => {
        // Los nombres terminan en «origen»/«destino» y `porContenido` los normaliza: así la comparación es por lo que se VE, no por el nombre del sembrado.
        await sembrar(centralId, origen, "origen", ids.coca, ids.pizza);
        await sembrar(destinoId, destino, "destino", ids.jugo, ids.bife);
        const idsDestinoAntes = await idsDe(destinoId);
        const contenidoDestinoAntes = await porContenido(destinoId);
        const contenidoOrigenAntes = await porContenido(centralId);

        // --- REEMPLAZAR ---
        const esperado = esperadoDeReemplazar(destino, origen);
        const r = await reemplazarCartaDeSucursal(centralId, "Sucursal B");
        expect(r.ok).toBe(esperado.ok);
        if (esperado.ok) {
          // El destino queda con lo del origen, ni más ni menos.
          expect(await porContenido(destinoId)).toEqual(contenidoOrigenAntes);
        } else {
          expect(r.mensaje).toBe("«Central» no tiene carta propia: no hay nada que copiar.");
          expect(await idsDe(destinoId)).toEqual(idsDestinoAntes);
          expect(await porContenido(destinoId)).toEqual(contenidoDestinoAntes);
        }
        // El origen NUNCA se toca.
        expect(await porContenido(centralId)).toEqual(contenidoOrigenAntes);

        // --- COPIAR (la acción de siempre), sobre el estado de partida de nuevo ---
        await limpiarCartas();
        await sembrar(centralId, origen, "origen", ids.coca, ids.pizza);
        await sembrar(destinoId, destino, "destino", ids.jugo, ids.bife);
        const idsAntes2 = await idsDe(destinoId);
        const copiar = esperadoDeCopiar(destino, origen);
        const c = await copiarCartaDeSucursal(centralId, true);
        expect(c.ok).toBe(copiar.ok);
        if (copiar.ok) expect(await porContenido(destinoId)).toEqual(contenidoOrigenAntes);
        else {
          expect(c.mensaje).toBe(copiar.codigo === "CARTA_PROPIA_EXISTENTE" ? "Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía." : "«Central» no tiene carta propia: no hay nada que copiar.");
          expect(await idsDe(destinoId)).toEqual(idsAntes2);
        }
      });
    }
  }

  async function limpiarCartas() {
    await prisma.opcionItemAgrupadoCarta.deleteMany({});
    await prisma.contenidoCartaProducto.deleteMany({});
    await prisma.itemAgrupadoCarta.deleteMany({});
    await prisma.generoCarta.deleteMany({});
  }
});

/** Los bloques `model X { … }` del esquema de Prisma, por nombre. */
function modelosDelEsquema(): Map<string, string[]> {
  const texto = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const modelos = new Map<string, string[]>();
  for (const m of texto.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) {
    modelos.set(
      m[1],
      m[2].split("\n").map((l) => l.trim()),
    );
  }
  return modelos;
}

describe("guardianes de dimensiones nuevas (reemplazar la carta)", () => {
  it("toda columna de las cuatro tablas de la carta está declarada: hay que decidir si la copia la copia", () => {
    const modelos = modelosDelEsquema();
    const sinDeclarar: string[] = [];
    for (const [modelo, declaradas] of Object.entries(COLUMNAS_DE_LA_CARTA)) {
      const lineas = modelos.get(modelo);
      expect(lineas, `falta el modelo ${modelo} en el esquema`).toBeDefined();
      // Una columna es una línea «nombre Tipo…» cuyo tipo es escalar (no otro modelo ni una relación `@relation`).
      const escalares = new Set(["String", "Int", "Boolean", "DateTime", "Decimal", "Json", "BigInt", "Float"]);
      for (const l of lineas ?? []) {
        if (l === "" || l.startsWith("//") || l.startsWith("@@")) continue;
        const [nombre, tipo] = l.split(/\s+/);
        if (!nombre || !tipo) continue;
        if (!escalares.has(tipo.replace(/[?[\]]/g, ""))) continue;
        if (!Object.hasOwn(declaradas, nombre)) sinDeclarar.push(`${modelo}.${nombre}`);
      }
      for (const nombre of Object.keys(declaradas)) {
        const existe = (lineas ?? []).some((l) => l.split(/\s+/)[0] === nombre);
        expect(existe, `${modelo}.${nombre} está declarada en el oráculo pero ya no está en el esquema: sacala`).toBe(true);
      }
    }
    expect(sinDeclarar, `Columna nueva en la carta: declará en COLUMNAS_DE_LA_CARTA (test/carta/reemplazar-carta.oraculo.ts) si se copia o es de identidad y, si se copia, sumala a la copia, a la firma y a la foto de auditoría (src/core/features/carta/reemplazar-carta.ts).\n${sinDeclarar.join("\n")}`).toEqual([]);
  });

  it("ningún modelo fuera de la carta apunta a una fila de la carta (el borrado del reemplazo no toca dinero, stock ni comprobantes)", () => {
    const modelos = modelosDelEsquema();
    const apuntan: string[] = [];
    for (const [nombre, lineas] of modelos) {
      for (const l of lineas) {
        if (!l.includes("@relation(fields:")) continue;
        const destino = l.split(/\s+/)[1]?.replace(/[?[\]]/g, "");
        if (!destino || !Object.hasOwn(MODELOS_QUE_APUNTAN_A_LA_CARTA, destino)) continue;
        if (!MODELOS_QUE_APUNTAN_A_LA_CARTA[destino].includes(nombre)) apuntan.push(`${nombre} → ${destino}`);
      }
    }
    expect(apuntan, `Un modelo nuevo apunta a una fila de la carta: revisá el borrado de «reemplazar la carta» (diseño N5) y declaralo en MODELOS_QUE_APUNTAN_A_LA_CARTA.\n${apuntan.join("\n")}`).toEqual([]);
  });
});
