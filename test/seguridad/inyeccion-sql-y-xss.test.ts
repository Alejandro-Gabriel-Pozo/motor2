import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { buscarProductosSelector, darDeAltaProductoRapido, listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { buscarProductoParaHistorial, obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { GET as cronDolar } from "../../src/app/api/cron/sincronizar-dolar/route";
import { GET as cronIpc } from "../../src/app/api/cron/sincronizar-ipc/route";

/**
 * Seguridad de aplicación: SQL injection y XSS contra las acciones REALES (permiso → guard → caso de uso → Postgres), sin mocks de datos.
 *
 * Qué se afirma, para cada payload y cada puerta de entrada:
 *  1. La base queda intacta: mismas tablas, mismas filas de referencia (usuarios, roles, acciones, unidades) y ningún dato ajeno afectado.
 *  2. El texto que entra o se rechaza, o se guarda TAL CUAL como dato (nunca interpretado como SQL ni "limpiado" a medias): el escapado del HTML es
 *     responsabilidad de React al dibujar (ver `test/e2e/seguridad-xss-y-sqli.spec.ts`, que lo comprueba en un navegador real).
 *  3. Las búsquedas con un payload no devuelven "todo" (`' OR '1'='1` no es un comodín) y no revientan.
 *  4. Ninguna respuesta filtra detalles internos (códigos de Prisma, SQLSTATE, mensajes del motor, rutas de archivos, stacks).
 *
 * Solo corre contra la base de pruebas descartable (la misma de `npm test`); los payloads son cadenas inertes, no hay secretos reales.
 */

const PAYLOADS_SQL = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "'; DROP TABLE \"Producto\"; --",
  "\"; DROP TABLE \"Usuario\"; --",
  "1; DELETE FROM \"Rol\"",
  "' UNION SELECT clave, descripcion, NULL FROM \"Accion\" --",
  "\\'; SELECT pg_sleep(5); --",
  "$$; DROP SCHEMA public CASCADE; --$$",
] as const;

const PAYLOADS_XSS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "\"><svg/onload=alert(1)>",
  "javascript:alert(1)",
  "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
  "{{constructor.constructor('alert(1)')()}}",
] as const;

const PAYLOADS_MALFORMADOS = [
  "a".repeat(100_000),
  "ñandú\u202Eevil", // override bidireccional
  "\n\r\t   \n",
  "%'; --",
  "_%_%",
] as const;

/** Postgres no puede guardar un NUL ni un sustituto UTF-16 suelto: hoy las BÚSQUEDAS no los filtran (brecha conocida, ver el último bloque). */
const NUL = "nul\u0000byte";
const SUSTITUTO_SUELTO = "ñandú\uD83D";

const TODOS = [...PAYLOADS_SQL, ...PAYLOADS_XSS, ...PAYLOADS_MALFORMADOS];

/** Nada que delate el motor, el ORM o el sistema de archivos. */
const FILTRACION = /prisma|sqlstate|syntax error|postgres|relation ".*" does not exist|invalid `|\bP20\d\d\b|\.ts:\d+|node_modules|stack|at async/i;

function sinFiltraciones(mensaje: string, contexto: string) {
  expect(mensaje, `${contexto}: el mensaje filtra detalles internos`).not.toMatch(FILTRACION);
}

async function fotoDeLaBase() {
  const tablas = await prismaAdmin.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`;
  const [usuarios, roles, acciones, unidades, sucursales] = await Promise.all([
    prismaAdmin.user.count(),
    prismaAdmin.rol.count(),
    prismaAdmin.accion.count(),
    prismaAdmin.unidad.count(),
    prismaAdmin.sucursal.count(),
  ]);
  return { tablas: tablas.map((t) => t.table_name), usuarios, roles, acciones, unidades, sucursales };
}

describe("seguridad de entradas: SQL injection y XSS contra las acciones reales", () => {
  let unidadId: string;
  let sucursalId: string;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    const catalogo = await sembrarCatalogoBase();
    unidadId = catalogo.kg.id;
    sucursalId = base.sucursal.id;
    const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id });
    await mockearUsuarioActual({ id: admin.id, email: admin.email, nombre: null });
  });

  describe.each(TODOS.map((p) => [p.length > 40 ? `${p.slice(0, 20)}…(${p.length} caracteres)` : JSON.stringify(p), p] as const))("payload %s", (_etiqueta, payload) => {
    it("alta de proveedor, de cliente y de producto rápido: se rechaza o se guarda como texto, y la base queda intacta", async () => {
      const antes = await fotoDeLaBase();

      const resultados = [
        { nombre: "proveedor", r: await altaProveedor({ nombre: payload }) },
        { nombre: "cliente", r: await altaCliente(payload, 0) },
        { nombre: "producto", r: await darDeAltaProductoRapido(payload, unidadId) },
      ];
      for (const { nombre, r } of resultados) {
        sinFiltraciones(r.mensaje, `alta de ${nombre}`);
        expect(typeof r.ok).toBe("boolean");
      }

      expect(await fotoDeLaBase()).toEqual(antes);
      // Lo que se aceptó está guardado literal (el texto, no su interpretación): ni recortado a medias ni transformado en otra cosa.
      const proveedor = resultados[0].r;
      if (proveedor.ok) {
        const fila = await prismaAdmin.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
        expect(fila.nombre).toBe(payload.trim());
      }
      const cliente = resultados[1].r;
      if (cliente.ok) {
        const fila = await prismaAdmin.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
        expect(fila.nombre).toBe(payload.trim());
      }
      // Si se rechazaron los tres, no quedó ninguna fila a medias.
      if (resultados.every(({ r }) => !r.ok)) {
        expect(await prismaAdmin.proveedor.count()).toBe(0);
        expect(await prismaAdmin.cliente.count()).toBe(0);
        expect(await prismaAdmin.producto.count()).toBe(0);
      }
    });

    it("búsquedas (selector, listado de catálogo, historial): no devuelven todo, no revientan y no filtran", async () => {
      const harina = await prismaAdmin.producto.create({ data: { codigo: "MP_SEC_HARINA", nombre: "Harina", tipo: "MP", unidadStockId: unidadId } });
      await prismaAdmin.producto.create({ data: { codigo: "MP_SEC_AZUCAR", nombre: "Azúcar", tipo: "MP", unidadStockId: unidadId } });
      const antes = await fotoDeLaBase();
      const filasAntes = await prismaAdmin.producto.count();

      // Un texto que no está en ningún nombre ni código: ninguna búsqueda puede devolver filas (salvo los blancos puros, que equivalen a «sin filtro» por diseño).
      const esSoloBlancos = payload.trim() === "";
      const comodin = /^[%_]+$/.test(payload.trim());
      const selector = await buscarProductosSelector(payload);
      const listado = await listarProductosPagina(undefined, payload);
      const historial = await buscarProductoParaHistorial(sucursalId, payload, prisma);
      if (!esSoloBlancos && !comodin) {
        expect(selector, "selector").toEqual([]);
        expect(listado.items, "listado de catálogo").toEqual([]);
        expect(historial, "historial").toEqual([]);
      }
      if (comodin) {
        // `%` y `_` SÍ actúan como comodines LIKE en `contains` (Prisma no los escapa): no es una inyección —no sale del alcance autorizado ni toca otra cosa—,
        // pero se documenta acá: devuelven, a lo sumo, los productos de la propia empresa.
        const propios = new Set([harina.id, (await prismaAdmin.producto.findFirstOrThrow({ where: { codigo: "MP_SEC_AZUCAR" } })).id]);
        for (const fila of selector) expect(propios.has(fila.id), "selector con comodín LIKE").toBe(true);
        for (const fila of listado.items) expect(propios.has(fila.id), "listado con comodín LIKE").toBe(true);
        for (const fila of historial) expect(propios.has(fila.productoId), "historial con comodín LIKE").toBe(true);
      }

      // Y como identificadores de la consulta con SQL crudo del historial (el único lugar con `$queryRaw` alimentado por la URL): se pasan parametrizados.
      const h = await obtenerHistorialProducto(sucursalId, harina.id, payload, undefined, undefined, prisma);
      expect(h === null || (h.eventos ?? []).length === 0).toBe(true);
      expect(await obtenerHistorialProducto(sucursalId, payload, undefined, undefined, undefined, prisma)).toBeNull();

      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prismaAdmin.producto.count()).toBe(filasAntes);
    });
  });

  describe("entradas con la forma equivocada (lo que un cliente malicioso puede mandar a una Server Action)", () => {
    const FORMAS: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["objeto", { $ne: null }],
      ["arreglo", ["' OR '1'='1"]],
    ];

    it.each(FORMAS)("nombre = %s: se rechaza con un mensaje limpio, sin escribir nada", async (_n, valor) => {
      const antes = await fotoDeLaBase();
      const resultados = await Promise.all([
        altaProveedor({ nombre: valor as string }).catch((e: unknown) => ({ ok: false as const, mensaje: String(e) })),
        altaCliente(valor as string, 0).catch((e: unknown) => ({ ok: false as const, mensaje: String(e) })),
        darDeAltaProductoRapido(valor as string, unidadId).catch((e: unknown) => ({ ok: false as const, mensaje: String(e) })),
      ]);
      for (const r of resultados) {
        expect(r.ok).toBe(false);
        sinFiltraciones(r.mensaje, "forma equivocada");
      }
      expect(await fotoDeLaBase()).toEqual(antes);
      expect(await prismaAdmin.proveedor.count()).toBe(0);
      expect(await prismaAdmin.cliente.count()).toBe(0);
      expect(await prismaAdmin.producto.count()).toBe(0);
    });

    // Un número o un booleano se convierten a texto («7», «true»): es un nombre válido, no un ataque. Lo que importa es que queden como TEXTO inerte.
    it.each([["número", 7], ["booleano", true]])("nombre = %s: se trata como el texto que es y no rompe nada", async (_n, valor) => {
      const antes = await fotoDeLaBase();
      const r = await altaProveedor({ nombre: valor as unknown as string });
      sinFiltraciones(r.mensaje, "nombre no textual");
      if (r.ok) expect((await prismaAdmin.proveedor.findUniqueOrThrow({ where: { id: r.id } })).nombre).toBe(String(valor));
      expect((await fotoDeLaBase()).tablas).toEqual(antes.tablas);
    });

    it.each([["texto", "10; DROP TABLE \"Cliente\""], ["objeto", { gt: 0 }], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["negativo", -5]])(
      "descuento de cliente = %s: se rechaza y no se crea el cliente",
      async (_n, descuento) => {
        const r = await altaCliente("Cliente de prueba", descuento);
        expect(r.ok).toBe(false);
        sinFiltraciones(r.mensaje, "descuento");
        expect(await prismaAdmin.cliente.count()).toBe(0);
      }
    );
  });

  describe("longitud: un valor desmedido no se guarda ni tumba el servidor", () => {
    it("nombres, descripciones y búsquedas de 1 MB se rechazan o se manejan sin error", async () => {
      const enorme = "x".repeat(1_000_000);
      const r = await Promise.all([altaProveedor({ nombre: enorme }), altaCliente(enorme, 0), darDeAltaProductoRapido(enorme, unidadId)]);
      for (const x of r) {
        expect(x.ok, "un nombre de 1 MB no puede guardarse").toBe(false);
        sinFiltraciones(x.mensaje, "valor enorme");
      }
      expect(await prismaAdmin.proveedor.count()).toBe(0);
      expect(await prismaAdmin.cliente.count()).toBe(0);
      expect(await prismaAdmin.producto.count()).toBe(0);
      await expect(buscarProductosSelector(enorme)).resolves.toEqual([]);
      await expect(listarProductosPagina(undefined, enorme)).resolves.toMatchObject({ items: [] });
    });
  });

  describe("contenido de la carta pública (lo único que ve un anónimo): el texto se guarda inerte y lo excesivo se rechaza", () => {
    it.each([...PAYLOADS_XSS, ...PAYLOADS_SQL])("descripción y tags = %s: se guarda literal o se rechaza, sin tocar otras filas", async (payload) => {
      const pv = await prismaAdmin.producto.create({ data: { codigo: "PV_SEC_1", nombre: "Milanesa", tipo: "PV", precioVenta: 1000, unidadStockId: unidadId } });
      const seccion = await prismaAdmin.seccionCarta.create({ data: { nombre: "Platos", orden: 1 } });
      const antes = await fotoDeLaBase();

      const r = await guardarContenidoCartaProducto(pv.id, { visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: payload, tags: [payload] });
      sinFiltraciones(r.mensaje, "contenido de carta");
      if (r.ok) {
        const fila = await prismaAdmin.contenidoCartaProducto.findFirstOrThrow({ where: { productoId: pv.id } });
        expect(fila.descripcion).toBe(payload.trim());
      } else {
        expect(await prismaAdmin.contenidoCartaProducto.count({ where: { productoId: pv.id } })).toBe(0);
      }
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("una descripción de 1 MB se rechaza y no deja fila", async () => {
      const pv = await prismaAdmin.producto.create({ data: { codigo: "PV_SEC_2", nombre: "Pizza", tipo: "PV", precioVenta: 1000, unidadStockId: unidadId } });
      const seccion = await prismaAdmin.seccionCarta.create({ data: { nombre: "Pizzas", orden: 1 } });
      const r = await guardarContenidoCartaProducto(pv.id, { visibleEnCarta: true, seccionCartaId: seccion.id, descripcion: "y".repeat(1_000_000) });
      expect(r.ok).toBe(false);
      sinFiltraciones(r.mensaje, "descripción enorme");
      expect(await prismaAdmin.contenidoCartaProducto.count({ where: { productoId: pv.id } })).toBe(0);
    });
  });

  describe("endpoints administrativos (cron): solo el secreto exacto abre la puerta", () => {
    const ATAQUES = [
      "",
      "Bearer",
      "Bearer ",
      "Bearer ' OR '1'='1",
      "Bearer '; DROP TABLE \"Usuario\"; --",
      "Bearer <script>alert(1)</script>",
      `Bearer ${"a".repeat(100_000)}`,
      "Basic YWRtaW46YWRtaW4=",
    ];

    beforeEach(() => {
      vi.stubEnv("CRON_SECRET", "secreto-de-prueba-descartable-0123456789");
    });

    it.each(ATAQUES.map((a) => [a.length > 40 ? `${a.slice(0, 20)}…(${a.length})` : JSON.stringify(a), a] as const))("Authorization = %s: 401 sin tocar la base ni filtrar", async (_e, cabecera) => {
      const antes = await fotoDeLaBase();
      for (const ruta of [cronDolar, cronIpc]) {
        const respuesta = await ruta(new Request("http://localhost/api/cron", { headers: cabecera ? { authorization: cabecera } : {} }));
        expect(respuesta.status).toBe(401);
        const cuerpo = await respuesta.text();
        sinFiltraciones(cuerpo, "cron");
      }
      expect(await fotoDeLaBase()).toEqual(antes);
    });

    it("sin CRON_SECRET configurada, ni siquiera un `Bearer undefined` o vacío pasa", async () => {
      vi.stubEnv("CRON_SECRET", "");
      for (const cabecera of ["Bearer undefined", "Bearer ", "Bearer null"]) {
        for (const ruta of [cronDolar, cronIpc]) {
          const respuesta = await ruta(new Request("http://localhost/api/cron", { headers: { authorization: cabecera } }));
          expect(respuesta.status, cabecera).toBe(401);
        }
      }
    });
  });

  /**
   * BRECHA CONOCIDA (hallazgo de este trabajo, sin arreglar a propósito: el arreglo toca `src/core/texto.ts` y `server/consultas`, ver docs/seguridad-pipeline.md §Hallazgos).
   * Una búsqueda con un NUL (`\u0000`) o un sustituto UTF-16 suelto llega a Postgres/Prisma y revienta con un error sin atrapar (500 en vez de «sin resultados»).
   * No hay inyección ni fuga de datos —el rol de ejecución no puede hacer nada más— y exige sesión con permiso, pero es una entrada que el servidor tiene que absorber.
   * `it.fails` mantiene el test en verde mientras la brecha exista y se pone ROJO cuando alguien la arregla: ahí se cambia a `it` y se borra este comentario.
   */
  describe("brecha conocida: caracteres que Postgres no admite en una búsqueda", () => {
    it.fails.each([["NUL", NUL], ["sustituto suelto", SUSTITUTO_SUELTO]])("selector de productos con %s", async (_n, payload) => {
      await expect(buscarProductosSelector(payload)).resolves.toEqual([]);
    });
    it.fails.each([["NUL", NUL], ["sustituto suelto", SUSTITUTO_SUELTO]])("listado de catálogo con %s", async (_n, payload) => {
      await expect(listarProductosPagina(undefined, payload)).resolves.toMatchObject({ items: [] });
    });
    it.fails("búsqueda del historial con NUL", async () => {
      await expect(buscarProductoParaHistorial(sucursalId, NUL, prisma)).resolves.toEqual([]);
    });
    it("búsqueda del historial con sustituto suelto: ya se maneja", async () => {
      await expect(buscarProductoParaHistorial(sucursalId, SUSTITUTO_SUELTO, prisma)).resolves.toEqual([]);
    });
    it("el alta de un nombre con esos caracteres sí se rechaza limpio (la lista blanca de caracteres de catálogo los frena)", async () => {
      for (const payload of [NUL, SUSTITUTO_SUELTO]) {
        const r = await altaProveedor({ nombre: payload });
        expect(r.ok).toBe(false);
        sinFiltraciones(r.mensaje, "alta con carácter inválido");
      }
    });
  });
});
