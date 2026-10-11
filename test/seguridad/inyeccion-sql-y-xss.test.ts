import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }));

import { limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, crearUsuarioConMembresia, prisma, prismaAdmin } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { altaProveedor } from "../../src/server/actions/catalogo/proveedores";
import { altaCliente } from "../../src/server/actions/clientes/cliente";
import { buscarProductosSelector, darDeAltaProductoRapido, listarProductosPagina } from "../../src/server/actions/catalogo/productos";
import { guardarContenidoCartaProducto } from "../../src/server/actions/carta/contenido-producto";
import { buscarProductoParaHistorial, obtenerHistorialProducto } from "../../src/server/consultas/reportes/historial-producto";
import { buscarOperacionesPorProducto } from "../../src/server/consultas/reportes/trazabilidad";
import { listarComprasRegistradas } from "../../src/server/consultas/reportes/compras-registradas";
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

/** Postgres no puede guardar un NUL ni un sustituto UTF-16 suelto: las BÚSQUEDAS los sacan antes de consultar (ver el último bloque). */
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
      // Tampoco `%` ni `_` (los comodines de LIKE): se buscan como el texto que son, ver el bloque «comodines de LIKE» más abajo.
      const esSoloBlancos = payload.trim() === "";
      const selector = await buscarProductosSelector(payload);
      const listado = await listarProductosPagina(undefined, payload);
      const historial = await buscarProductoParaHistorial(sucursalId, payload, prisma);
      if (!esSoloBlancos) {
        expect(selector, "selector").toEqual([]);
        expect(listado.items, "listado de catálogo").toEqual([]);
        expect(historial, "historial").toEqual([]);
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
   * Caracteres que Postgres no admite en un texto (NUL `\u0000`) o que no son texto válido (sustituto UTF-16 suelto): llegaban a Postgres/Prisma y reventaban con un error sin atrapar
   * (500 en vez de «sin resultados»). Hallazgo del #97 (era una «brecha conocida» con `it.fails`); corregido sacándolos de la BÚSQUEDA en un solo lugar (`textoDeBusqueda`, `src/core/texto.ts`)
   * y de los parámetros de la URL (`unicosDeUrl`). No hay inyección ni fuga de datos —el rol de ejecución no puede hacer nada más— y exige sesión con permiso, pero es una entrada que el servidor tiene que absorber.
   * Lo que se GUARDA no se toca: el alta de un nombre con esos caracteres se rechaza (último caso).
   */
  /**
   * `%` y `_` son comodines de LIKE y `\` su escape: Prisma los pasa tal cual en un `contains`, así que buscar `%` devolvía todo, `pan_i` encontraba también «Pan integral»
   * y una barra invertida al final escapaba el `%` que Prisma agrega (buscar `\` devolvía lo que contiene un `%`). No era una inyección (nunca sale del alcance de la empresa ni
   * rompe la consulta), pero la búsqueda no hacía lo que dice. `escaparComodinesLike` (`src/core/texto.ts`) los escapa donde se arma el patrón.
   */
  describe("comodines de LIKE (%, _ y \\): se buscan como el texto que son", () => {
    beforeEach(async () => {
      for (const [codigo, nombre] of [["MP_CMD_SALSA", "Salsa 100% tomate"], ["MP_CMD_PAN", "Pan_integral"], ["MP_CMD_PANB", "Pan integral"], ["MP_CMD_BARRA", "Cinta\\doble"], ["MP_CMD_HARINA", "Harina"]] as const) {
        await prismaAdmin.producto.create({ data: { codigo, nombre, tipo: "MP", unidadStockId: unidadId } });
      }
    });

    const buscar = async (q: string) => ({
      selector: (await buscarProductosSelector(q)).map((p) => p.codigo).sort(),
      listado: (await listarProductosPagina(undefined, q)).items.map((p) => p.codigo).sort(),
      historial: (await buscarProductoParaHistorial(sucursalId, q, prisma)).map((p) => p.codigo).sort(),
    });
    const todas = (codigos: string[]) => ({ selector: codigos, listado: codigos, historial: codigos });

    it.each([
      ["%", ["MP_CMD_SALSA"]], // antes: los 5
      ["100%", ["MP_CMD_SALSA"]],
      ["%00", []], // «%00» como texto, no como escape de URL
      ["pan_i", ["MP_CMD_PAN"]], // antes: también «Pan integral»
      ["_", ["MP_CMD_BARRA", "MP_CMD_HARINA", "MP_CMD_PAN", "MP_CMD_PANB", "MP_CMD_SALSA"]], // el guion bajo está en TODOS los códigos: el comodín no cambia el resultado, pero tampoco rompe
      ["\\", ["MP_CMD_BARRA"]], // antes: lo que contiene un «%» (la barra escapaba el comodín final)
      ["cinta\\d", ["MP_CMD_BARRA"]],
      ["a\\", ["MP_CMD_BARRA"]], // «Cint[a\]doble»
      ["x\\", []],
      ["\\%", []],
      ["\\_", []],
    ] as Array<[string, string[]]>)("buscar %j", async (q, esperados) => {
      expect(await buscar(q)).toEqual(todas(esperados));
    });

    it("lo normal sigue igual: sin distinguir mayúsculas ni acentos de la ñ, por nombre y por código", async () => {
      expect(await buscar("HARINA")).toEqual(todas(["MP_CMD_HARINA"]));
      expect(await buscar("MP_CMD_PAN")).toEqual(todas(["MP_CMD_PAN", "MP_CMD_PANB"]));
      expect(await buscar("pan integral")).toEqual(todas(["MP_CMD_PANB"]));
    });
  });

  describe("caracteres que Postgres no admite en una búsqueda: se absorben, no revientan", () => {
    const INVALIDOS = [["NUL", NUL], ["sustituto suelto al final", SUSTITUTO_SUELTO], ["sustituto suelto en el medio", "a\uDE00b"], ["solo NUL", "\u0000"]] as const;

    it.each(INVALIDOS)("selector de productos con %s", async (_n, payload) => {
      await expect(buscarProductosSelector(payload)).resolves.toEqual([]);
    });
    it.each(INVALIDOS)("listado de catálogo con %s (y como cursor)", async (_n, payload) => {
      await expect(listarProductosPagina(undefined, payload)).resolves.toMatchObject({ items: [] });
      await expect(listarProductosPagina(payload)).resolves.toBeDefined();
    });
    it.each(INVALIDOS)("búsqueda del historial con %s", async (_n, payload) => {
      await expect(buscarProductoParaHistorial(sucursalId, payload, prisma)).resolves.toEqual([]);
    });
    it.each(INVALIDOS)("trazabilidad por producto con %s", async (_n, payload) => {
      await expect(buscarOperacionesPorProducto(sucursalId, payload, prisma)).resolves.toEqual([]);
    });
    it.each(INVALIDOS)("compras registradas: filtro de factura con %s", async (_n, payload) => {
      await expect(listarComprasRegistradas(sucursalId, { factura: payload }, prisma)).resolves.toMatchObject({ items: [] });
    });
    it("el texto válido no se altera: acentos, ñ y emojis con su par completo siguen encontrando", async () => {
      await prismaAdmin.producto.create({ data: { codigo: "MP_SEC_NINIO", nombre: "Ñandú café 😀", tipo: "MP", unidadStockId: unidadId } });
      for (const q of ["Ñandú café 😀", "ñandú", "café 😀", "😀"]) {
        expect((await buscarProductosSelector(q)).map((p) => p.codigo), q).toEqual(["MP_SEC_NINIO"]);
        expect((await buscarProductoParaHistorial(sucursalId, q, prisma)).map((p) => p.codigo), q).toEqual(["MP_SEC_NINIO"]);
      }
      // Los inválidos mezclados con texto válido buscan lo válido: «ñand\0ú» encuentra «Ñandú».
      expect((await buscarProductosSelector("ñand\u0000ú\uD83D")).map((p) => p.codigo)).toEqual(["MP_SEC_NINIO"]);
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
