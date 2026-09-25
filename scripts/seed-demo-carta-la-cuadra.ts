/**
 * Seed de la CARTA PÚBLICA para la demo "La Cuadra" (docs/plan-carta-seccion-directa-2026-09-25.md): a diferencia de
 * scripts/seed-demo-pizzeria(-6-meses).ts (catálogo + movimientos de stock), esto solo agrega lo que hace falta para que
 * "La Cuadra" tenga una carta pública real y visible: dos `SeccionCarta` ("Pizzas", "Bebidas"), el `ContenidoCartaProducto`
 * de cada PV que va en la carta, un tema visual aplicado, y su alta+publicación en el portal (`SucursalPublica`).
 *
 * REQUIERE que "La Cuadra" y sus PV ya existan (correr primero seed-demo-pizzeria.ts o seed-demo-pizzeria-6-meses.ts):
 * este script NO crea sucursal, categorías ni productos — solo lee sus ids por código.
 *
 * NUNCA corre contra Neon (mismas guardas que el seed de 6 meses, ver vitest.seed-carta-la-cuadra.config.ts y
 * scripts/demo-seed/guardas-destino.ts): requiere `MOTOR2_SEED_DATABASE_URL` a un Postgres LOCAL cuyo nombre termine en
 * "_demo", más `MOTOR2_SEED_CONFIRMAR=si`. Uso:
 *
 *   MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
 *   MOTOR2_SEED_CONFIRMAR="si" \
 *     npx vitest run --config vitest.seed-carta-la-cuadra.config.ts
 *
 * Idempotente por diseño (se puede correr de nuevo sin duplicar nada), igual que los pasos de catálogo del seed de 6 meses:
 * cada sección de carta se busca por nombre antes de crear (si ya existe, se actualiza en vez de fallar por nombre repetido);
 * `guardarContenidoCartaProducto`/`guardarTemaCarta` ya son upsert por su cuenta; el alta al portal se salta si la fila ya
 * existe. No hace falta un MOTOR2_SEED_REHACER propio: no hay ningún evento de un solo uso que este script reproduzca.
 *
 * DECISIONES de esta siembra (para que quede documentado por qué, no solo qué):
 *  - PV099 ("Pizza Rúcula y jamón crudo") queda A PROPÓSITO sin ContenidoCartaProducto: ya es el ejemplo deliberado de
 *    producto inactivo del catálogo (seed-demo-pizzeria-data.ts) — no tener fila de carta es la demostración de D3 ("sin
 *    fila = no se muestra") aplicada al mismo ejemplo, en vez de inventar uno nuevo.
 *  - Sin ItemAgrupadoCarta de ejemplo: D5 solo deja agrupar productos del MISMO precio, y ningún PV de "La Cuadra" comparte
 *    precio con otro (ver seed-demo-pizzeria-data.ts) — forzar un agrupado hubiera significado inventar productos nuevos
 *    solo para la demo, en vez de reflejar el catálogo real de la pizzería.
 *  - Sin imagenUrl en las secciones: no hay una URL de imagen real para "La Cuadra" a mano; queda "—" en la carta (campo
 *    opcional) en vez de linkear una imagen de stock inventada.
 *  - `sheetId` del portal es un placeholder que no resuelve a ninguna sheet real: con `menuDesdeMotor2: true` y el tema
 *    aplicado (`aplicarEnCarta: true`), restaurant-menu-design no necesita leer la sheet para nada de esta sucursal — el
 *    campo solo existe hoy porque `guardarSucursalPublica` lo exige para publicar (docs/plan-registro-tenants-2026-09-24.md).
 */
import "dotenv/config";
import { vi, describe, it, expect } from "vitest";

vi.mock("../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { prisma } from "../src/lib/db";
import { __setCookieDeTestParaSucursal } from "../test/setup/next-headers-stub";
import { getUsuarioActual } from "../src/core/auth/session";
import { guardarSeccionCarta } from "../src/server/actions/carta/secciones";
import { guardarContenidoCartaProducto, type DatosContenidoCarta } from "../src/server/actions/carta/contenido-producto";
import { guardarTemaCarta, cambiarAplicacionTema } from "../src/server/actions/carta/tema";
import { agregarSucursalAlPortal, guardarSucursalPublica } from "../src/server/actions/carta/registro-publico";
import type { ResultadoAccion } from "../src/server/actions/tipos";

const EMAIL_ADMIN = "alepogabriel@gmail.com";
const NOMBRE_SUCURSAL = "La Cuadra";
/** Placeholder sintáctico (pasa RE_SHEET_ID: 20-128 [A-Za-z0-9_-]) — nunca se lee de verdad, ver docstring arriba. */
const SHEET_ID_PLACEHOLDER = "demo_la_cuadra_sin_sheet_real";

interface ItemCarta {
  codigo: string;
  descripcion: string;
  tags?: readonly string[];
  especial?: boolean;
}

const PIZZAS: readonly ItemCarta[] = [
  { codigo: "PV020", descripcion: "Muzzarella y aceitunas, la de siempre.", tags: ["clásica"] },
  { codigo: "PV021", descripcion: "La misma muzzarella, tamaño individual.", tags: ["clásica", "individual"] },
  { codigo: "PV022", descripcion: "Muzzarella, tomate y ajo.", tags: ["clásica"] },
  { codigo: "PV023", descripcion: "Muzzarella y cebolla a la crema.", tags: [] },
  { codigo: "PV024", descripcion: "Muzzarella, jamón, morrón y huevo.", tags: ["la más pedida"], especial: true },
  { codigo: "PV025", descripcion: "Muzzarella y longaniza calabresa picante.", tags: ["picante"] },
  { codigo: "PV026", descripcion: "Muzzarella, provolone y roquefort.", tags: [] },
  { codigo: "PV027", descripcion: "Muzzarella, morrón, cebolla y champiñones.", tags: ["sin carne"] },
  { codigo: "PV030", descripcion: "Porción individual de la bandeja del día.", tags: ["para llevar"] },
];

const BEBIDAS: readonly ItemCarta[] = [
  { codigo: "PV007", descripcion: "Porrón 473ml, bien fría.", tags: [] },
  { codigo: "PV008", descripcion: "Lata 354ml.", tags: [] },
  { codigo: "PV009", descripcion: "Botella 500ml, sin gas.", tags: [] },
  { codigo: "PV010", descripcion: "Copa individual.", tags: [] },
  { codigo: "PV011", descripcion: "Botella 750ml para compartir.", tags: [] },
];

async function mock(usuario: { id: string; email: string; nombre: string | null }) {
  vi.mocked(getUsuarioActual).mockResolvedValue(usuario);
}

describe("seed de carta pública — demo pizzería La Cuadra", () => {
  it(
    "siembra secciones, contenido de producto, tema y alta en el portal",
    async () => {
      const fallos: string[] = [];
      const anotarSiFalla = (etiqueta: string, r: ResultadoAccion) => {
        if (!r.ok) fallos.push(`${etiqueta}: ${r.mensaje}`);
      };

      // --- 0) Precondiciones: "La Cuadra" y sus PV ya sembrados por el seed de catálogo. ---
      const usuario = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL_ADMIN } });
      await mock({ id: usuario.id, email: usuario.email, nombre: usuario.name });
      const sucursal = await prisma.sucursal.findUnique({ where: { nombre: NOMBRE_SUCURSAL } });
      if (!sucursal) {
        throw new Error(`No existe la sucursal "${NOMBRE_SUCURSAL}": correr primero seed-demo-pizzeria.ts o seed-demo-pizzeria-6-meses.ts.`);
      }
      __setCookieDeTestParaSucursal(sucursal.id);

      const productoIdPorCodigo = new Map((await prisma.producto.findMany({ where: { codigo: { in: [...PIZZAS, ...BEBIDAS].map((i) => i.codigo) } } })).map((p) => [p.codigo, p.id]));
      const idProd = (codigo: string): string => {
        const id = productoIdPorCodigo.get(codigo);
        if (!id) throw new Error(`Producto no encontrado: ${codigo} (¿corriste el seed de catálogo de "La Cuadra"?)`);
        return id;
      };

      // --- 1) Secciones de carta (idempotente: busca por nombre antes de crear). ---
      const seccionesExistentes = await prisma.seccionCarta.findMany({ where: { nombre: { in: ["Pizzas", "Bebidas"] } } });
      const seccionIdPorNombre = new Map(seccionesExistentes.map((s) => [s.nombre, s.id]));
      async function upsertSeccion(nombre: string, titulo: string, descripcion: string, orden: number): Promise<string> {
        const r = await guardarSeccionCarta({ id: seccionIdPorNombre.get(nombre), nombre, titulo, descripcion, orden });
        anotarSiFalla(`guardarSeccionCarta(${nombre})`, r);
        if (!r.ok) throw new Error(fallos.at(-1));
        return r.id;
      }
      const seccionPizzas = await upsertSeccion("Pizzas", "Pizzas", "Todas se arman al momento.", 1);
      const seccionBebidas = await upsertSeccion("Bebidas", "Bebidas", "Frías, para acompañar.", 2);

      // --- 2) Contenido de carta de cada PV (upsert por producto, D3: sin fila = no se muestra — PV099 queda afuera a propósito). ---
      async function sembrarContenido(items: readonly ItemCarta[], seccionCartaId: string) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const datos: DatosContenidoCarta = { visibleEnCarta: true, seccionCartaId, descripcion: item.descripcion, tags: item.tags, especial: item.especial === true, orden: i + 1 };
          anotarSiFalla(`guardarContenidoCartaProducto(${item.codigo})`, await guardarContenidoCartaProducto(idProd(item.codigo), datos));
        }
      }
      await sembrarContenido(PIZZAS, seccionPizzas);
      await sembrarContenido(BEBIDAS, seccionBebidas);

      // --- 3) Tema visual (paleta cálida de pizzería), aplicado. ---
      anotarSiFalla(
        "guardarTemaCarta",
        await guardarTemaCarta(sucursal.id, {
          restaurante_nombre: "La Cuadra",
          restaurante_subtitulo: "Pizzería de barrio",
          restaurante_descripcion: "Pizza a la piedra, de siempre, con masa madre de 48hs.",
          color_marca: "#b3401f",
          color_fondo_dia: "#fff8ef",
          hero_color_fondo: "#2a1712",
          hero_ink: "claro",
          color_portada_textos: "#fff8ef",
          color_portada_cta: "#f2a33a",
          color_indice_titulo: "#b3401f",
          color_banda_titulo: "#2a1712",
          color_item_nombre: "#2a1712",
          color_item_precio: "#b3401f",
        })
      );
      anotarSiFalla("cambiarAplicacionTema", await cambiarAplicacionTema(sucursal.id, true));

      // --- 4) Alta y publicación en el portal (idempotente: se salta el alta si ya está). ---
      const yaEnPortal = await prisma.sucursalPublica.findUnique({ where: { sucursalId: sucursal.id } });
      if (!yaEnPortal) anotarSiFalla("agregarSucursalAlPortal", await agregarSucursalAlPortal(sucursal.id));
      const enPortal = await prisma.sucursalPublica.findUniqueOrThrow({ where: { sucursalId: sucursal.id } });
      anotarSiFalla(
        "guardarSucursalPublica",
        await guardarSucursalPublica(sucursal.id, {
          slug: enPortal.slug,
          etiqueta: "La Cuadra",
          publicada: true,
          menuDesdeMotor2: true,
          sheetId: SHEET_ID_PLACEHOLDER,
        })
      );

      if (fallos.length) console.error(`\nFALLOS (${fallos.length}):\n` + fallos.join("\n"));
      expect(fallos.length, `${fallos.length} fallos — ver arriba`).toBe(0);

      const final = await prisma.sucursalPublica.findUniqueOrThrow({ where: { sucursalId: sucursal.id } });
      console.log(`\nListo — carta de "${NOMBRE_SUCURSAL}" viva en /carta/${final.slug}.`);
    },
    300_000
  );
});
