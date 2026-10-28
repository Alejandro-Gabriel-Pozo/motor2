import { beforeEach, describe, expect, it, vi } from "vitest";

// Rompe la escritura en lote del contenido de carta (la ÚLTIMA escritura antes de la auditoría) cuando el test lo pide: A.8, «si falla el createMany de contenido, quedan 0 productos».
const romperLaCarta = vi.hoisted(() => ({ activo: false }));
vi.mock("../../../src/server/persistencia/carta/contenido-producto", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/server/persistencia/carta/contenido-producto")>();
  return {
    ...real,
    crearContenidosImportados: async (...args: Parameters<typeof real.crearContenidosImportados>) => {
      if (romperLaCarta.activo) throw new Error("falla simulada de la carta");
      return real.crearContenidosImportados(...args);
    },
  };
});

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma } from "../../setup/test-db";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../../setup/rol-de-pruebas";
import { actorDePrueba } from "../../setup/opciones-de-venta";
import { agregarProductoALaCartaCasoDeUso } from "../../../src/server/actions/carta/casos-de-uso/agregar-producto-a-la-carta";
import { importarCatalogoCasoDeUso, type ModoDeImportacion, type ResultadoImportarCatalogo } from "../../../src/server/actions/catalogo/casos-de-uso/importar-catalogo";
import { normalizarCatalogo } from "../../../src/core/features/catalogo/importacion/normalizar";
import { LOCALES_DEL_IMPORTADOR, type CatalogoNormalizado } from "../../../src/core/features/catalogo/importacion/tipos";
import { cargarCartaParaMantener } from "../../../src/server/consultas/carta/mantenimiento";
import type { ContextoUsuario } from "../../../src/server/sesion/contexto";
import { correccionesDe, libroDesde } from "./fixtura-de-catalogo";
import { catalogoSintetico, SKU_CORREGIDO } from "./catalogo-sintetico";
import { sembrarEmpresaDelImportador } from "./base-de-importacion";

/**
 * E1.5 del importador: el caso de uso C1/C2 contra Postgres real, como `motor2_app` (RLS por empresa y por sucursal). Con el catálogo SINTÉTICO de la misma forma que el del dueño:
 * idempotencia (dos confirmaciones dejan 207 / 610 / 430 / 637 / 0 y la segunda es VERSION_DESACTUALIZADA; una vista previa nueva da todo «sin cambios»), concurrencia (dos a la vez: una gana,
 * la otra se rechaza, resultado exacto), atomicidad (falla la carta a mitad: 0 de todo), aislamiento (la sección y la sucursal de otra empresa con el mismo nombre no coinciden), permisos (sin
 * una clave en UNA sucursal no se escribe nada) y precio (con el precio local prendido o apagado, la carta lee `precioVenta` y no hay filas locales).
 */
let semilla: Awaited<ReturnType<typeof sembrarEmpresaDelImportador>>;
let catalogo: CatalogoNormalizado;

/** El actor como lo arma el comando: la dueña, parada en Huinganco, con alcance SOLO en la activa (el caso de uso ensancha después del gate). */
function actor(): ContextoUsuario {
  const activa = semilla.sucursales.Huinganco;
  const membresias = [...LOCALES_DEL_IMPORTADOR.map((l) => ({ sucursalId: semilla.sucursales[l], sucursalNombre: l })), { sucursalId: semilla.oficinas, sucursalNombre: "Oficinas NQNTUR" }].map((m) => ({
    ...m,
    rolNombre: "admin",
    esAdmin: true,
  }));
  return {
    usuarioId: semilla.duena.id,
    email: "duena@importador.test",
    empresaId: EMPRESA_POR_DEFECTO_ID,
    empresaSlug: "principal",
    empresaNombre: "Empresa principal",
    empresaZonaHoraria: "America/Argentina/Buenos_Aires",
    rolEmpresa: null,
    empresas: [],
    sucursalId: activa,
    sucursalNombre: "Huinganco",
    rolNombre: "admin",
    esAdminEnSucursal: true,
    membresias,
    ...baseDeTest({ lectura: [activa], escritura: [activa] }),
  };
}

const importar = (modo: ModoDeImportacion, c = catalogo) => importarCatalogoCasoDeUso(actor(), { shaDelArchivo: "sha-del-archivo-sintetico", catalogo: c, modo });
async function vistaPrevia() {
  const r = await importar({ tipo: "VISTA_PREVIA" });
  if (!r.ok) throw new Error(r.mensaje);
  return r.datos;
}
async function conteos() {
  return {
    productos: await prisma.producto.count(),
    disponibilidades: await prisma.disponibilidadProducto.count(),
    contenidos: await prisma.contenidoCartaProducto.count(),
    auditorias: await prisma.registroAuditoria.count(),
    preciosLocales: await prisma.precioLocalProducto.count(),
  };
}
const NADA = { productos: 0, disponibilidades: 0, contenidos: 0, auditorias: 0, preciosLocales: 0 };
const TODO = { productos: 207, disponibilidades: 610, contenidos: 430, auditorias: 637, preciosLocales: 0 };

beforeEach(async () => {
  romperLaCarta.activo = false;
  await limpiarBaseDeTest();
  semilla = await sembrarEmpresaDelImportador();
  const sintetico = catalogoSintetico();
  catalogo = normalizarCatalogo(libroDesde(sintetico.productos), correccionesDe({ correcciones: sintetico.correcciones }));
});

describe("importar el catálogo (E1.5): vista previa y confirmación", () => {
  it("la vista previa no escribe nada y da los conteos del plan (207 / 610 / 430 / 637 / 0, 50 SKU sin sección en 179 filas, 13 por la regla y 1 por corrección)", async () => {
    expect(catalogo.errores).toEqual([]);
    const informe = await vistaPrevia();
    expect(await conteos()).toEqual(NADA);
    expect(informe.confirmable).toBe(true);
    expect(informe.errores).toEqual([]);
    expect(informe.huellaVisible).toHaveLength(12);
    expect(informe.conteos).toEqual({
      productos: { CREAR: 207, SIN_CAMBIOS: 0, ERROR: 0 },
      filasDeDisponibilidad: 610,
      contenidos: { CREAR: 430, SIN_CAMBIOS: 0, FUERA_DE_CARTA: 180, NO_SE_EVALUA: 0, ERROR: 0 },
      auditorias: 637,
      preciosLocales: 0,
    });
    const sinSeccion = informe.carta.contenidos.filter((c) => c.codigo === "SIN_SECCION");
    expect([sinSeccion.length, new Set(sinSeccion.map((c) => c.sku)).size]).toEqual([179, 50]);
    const origenes = informe.productos.productos.map((p) => p.precio!.origen);
    expect([origenes.filter((o) => o === "REGLA").length, origenes.filter((o) => o === "CORRECCION").length]).toEqual([13, 1]);
    // Otra vista previa del mismo estado: la misma huella.
    expect((await vistaPrevia()).huella).toBe(informe.huella);
  });

  it("idempotencia: confirmar deja 207 / 610 / 430 / 637 / 0; confirmar otra vez con la misma huella es VERSION_DESACTUALIZADA sin escribir; una vista previa nueva da todo «sin cambios»", async () => {
    const { huellaVisible } = await vistaPrevia();
    const primera = await importar({ tipo: "CONFIRMAR", huella: huellaVisible });
    expect(primera).toMatchObject({ ok: true, datos: { escrituras: { productos: 207, filasDeDisponibilidad: 610, contenidos: 430, auditorias: 637 } } });
    expect(await conteos()).toEqual(TODO);
    const segunda = await importar({ tipo: "CONFIRMAR", huella: huellaVisible });
    expect(segunda).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await conteos()).toEqual(TODO);
    const nueva = await vistaPrevia();
    expect(nueva.conteos.productos).toEqual({ CREAR: 0, SIN_CAMBIOS: 207, ERROR: 0 });
    expect(nueva.conteos.contenidos).toMatchObject({ CREAR: 0, SIN_CAMBIOS: 430, ERROR: 0 });
    expect(nueva.huella).not.toBe(huellaVisible);
    // Confirmar ese «todo sin cambios» no escribe ni audita nada.
    const tercera = await importar({ tipo: "CONFIRMAR", huella: nueva.huella });
    expect(tercera).toMatchObject({ ok: true, datos: { escrituras: { productos: 0, filasDeDisponibilidad: 0, contenidos: 0, auditorias: 0 } } });
    expect(await conteos()).toEqual(TODO);
    // El precio del SKU corregido es el de la corrección (no los $25.000 del Excel): un precio por empresa.
    const corregido = await prisma.producto.findFirstOrThrow({ where: { codigo: SKU_CORREGIDO }, select: { precioVenta: true } });
    expect(corregido.precioVenta.toFixed(2)).toBe("3000.00");
  });

  it("concurrencia: dos confirmaciones a la vez con la misma huella → una gana, la otra se rechaza, y el resultado es exacto", async () => {
    const { huellaVisible } = await vistaPrevia();
    const resultados = await Promise.all([importar({ tipo: "CONFIRMAR", huella: huellaVisible }), importar({ tipo: "CONFIRMAR", huella: huellaVisible })]);
    const ganadoras = resultados.filter((r) => r.ok);
    const perdedoras = resultados.filter((r): r is Extract<ResultadoImportarCatalogo, { ok: false }> => !r.ok);
    expect(ganadoras).toHaveLength(1);
    expect(perdedoras).toHaveLength(1);
    expect(["VERSION_DESACTUALIZADA", "CHOQUE_DE_UNICIDAD"]).toContain(perdedoras[0].codigo);
    expect(await conteos()).toEqual(TODO);
  });

  it("atomicidad: si la escritura de la carta falla a mitad, no queda NADA (ni productos, ni disponibilidad, ni auditoría)", async () => {
    const { huellaVisible } = await vistaPrevia();
    romperLaCarta.activo = true;
    await expect(importar({ tipo: "CONFIRMAR", huella: huellaVisible })).rejects.toThrow("falla simulada de la carta");
    expect(await conteos()).toEqual(NADA);
  });

  it("una huella que no es la de la vista previa (otra, o menos de 12 caracteres) no confirma nada", async () => {
    const { huella } = await vistaPrevia();
    expect(await importar({ tipo: "CONFIRMAR", huella: "0123456789ab" })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await importar({ tipo: "CONFIRMAR", huella: huella.slice(0, 8) })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await conteos()).toEqual(NADA);
  });

  it("si otra persona carga un producto con un código del archivo entre la vista previa y la confirmación, la confirmación lo ve (EXISTE_DISTINTO: NO_CONFIRMABLE) y no escribe nada", async () => {
    const { huellaVisible } = await vistaPrevia();
    await prisma.producto.create({ data: { codigo: "CON-SECCION-1", nombre: "Cargado por otra persona", tipo: "PV", unidadStockId: semilla.unidadId } });
    expect(await importar({ tipo: "CONFIRMAR", huella: huellaVisible })).toMatchObject({ ok: false, codigo: "NO_CONFIRMABLE" });
    expect(await conteos()).toEqual({ ...NADA, productos: 1 });
  });

  it("con errores (una sección apagada) la vista previa es NO CONFIRMABLE y confirmar no escribe nada", async () => {
    await prisma.seccionCarta.update({ where: { id: semilla.secciones.Pizzas }, data: { activa: false } });
    const informe = await vistaPrevia();
    expect(informe.confirmable).toBe(false);
    expect(new Set(informe.errores.map((e) => e.codigo))).toEqual(new Set(["SECCION_APAGADA"]));
    expect(await importar({ tipo: "CONFIRMAR", huella: informe.huella })).toMatchObject({ ok: false, codigo: "NO_CONFIRMABLE" });
    expect(await conteos()).toEqual(NADA);
  });
});

describe("aislamiento y permisos", () => {
  it("la sección y la sucursal de OTRA empresa con el mismo nombre no coinciden", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    await testigo.seccionCarta.create({ data: { nombre: "Pizzas" } });
    await testigo.sucursal.create({ data: { nombre: "Las Ovejas" } });
    // En la empresa del importador: sin «Pizzas» y sin «Las Ovejas» (se renombran: nada se borra).
    await prisma.seccionCarta.update({ where: { id: semilla.secciones.Pizzas }, data: { nombre: "Pizzas viejas" } });
    await prisma.sucursal.update({ where: { id: semilla.sucursales["Las Ovejas"] }, data: { nombre: "Las Ovejas (vieja)" } });
    const r = await importar({ tipo: "VISTA_PREVIA" });
    expect(r.ok && r.datos.confirmable).toBe(false);
    const codigos = new Set(r.ok ? r.datos.errores.map((e) => e.codigo) : []);
    expect(codigos.has("SUCURSAL_INEXISTENTE")).toBe(true);
    expect(codigos.has("SECCION_INEXISTENTE")).toBe(true);
    expect(await importar({ tipo: "CONFIRMAR", huella: r.ok ? r.datos.huella : "x" })).toMatchObject({ ok: false, codigo: "SIN_PERMISO" });
    expect(await conteos()).toEqual(NADA);
  });

  it("sin «carta_contenido_producto» en UNA sola sucursal (operador en Varvarco): confirmar se rechaza entero con 0 filas, y la vista previa lo muestra", async () => {
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: semilla.duena.id, sucursalId: semilla.sucursales.Varvarco }, data: { rolId: semilla.base.operador.id } });
    const previa = await importar({ tipo: "VISTA_PREVIA" });
    expect(previa.ok && previa.datos.confirmable).toBe(false);
    const huella = previa.ok ? previa.datos.huella : "";
    const r = await importar({ tipo: "CONFIRMAR", huella });
    expect(r).toMatchObject({ ok: false, codigo: "SIN_PERMISO" });
    expect(r.mensaje).toContain("Varvarco");
    expect(r.mensaje).toContain("carta_contenido_producto");
    expect(await conteos()).toEqual(NADA);
  });

  it("sin «producto_campos_sensibles» (operador en todas): SIN_PERMISO y 0 filas", async () => {
    await prisma.usuarioSucursal.updateMany({ where: { usuarioId: semilla.duena.id }, data: { rolId: semilla.base.operador.id } });
    const r = await importar({ tipo: "CONFIRMAR", huella: "0".repeat(64) });
    expect(r).toMatchObject({ ok: false, codigo: "SIN_PERMISO" });
    expect(r.mensaje).toContain("producto_campos_sensibles");
    expect(await conteos()).toEqual(NADA);
  });
});

describe("precio: un precio por empresa", () => {
  it.each([true, false])("con la capacidad precio_local %s en las 5, la carta de cada sucursal muestra precioVenta y no hay ninguna fila de precio local", async (prendida) => {
    for (const local of LOCALES_DEL_IMPORTADOR) await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: semilla.sucursales[local], habilitado: prendida } });
    const { huellaVisible } = await vistaPrevia();
    expect((await importar({ tipo: "CONFIRMAR", huella: huellaVisible })).ok).toBe(true);
    expect(await prisma.precioLocalProducto.count()).toBe(0);
    const precioVenta = new Map((await prisma.producto.findMany({ select: { id: true, precioVenta: true } })).map((p) => [p.id, Number(p.precioVenta)]));
    for (const local of LOCALES_DEL_IMPORTADOR) {
      const id = semilla.sucursales[local];
      const carta = await cargarCartaParaMantener(baseDeTest({ lectura: [id], escritura: [id] }).db, id);
      const enLaCarta = carta.secciones.flatMap((s) => s.productos);
      expect(enLaCarta.length, local).toBeGreaterThan(0);
      for (const p of enLaCarta) expect(p.precioAca, `${local} ${p.nombre}`).toBe(precioVenta.get(p.id));
    }
  });
});

describe("concurrencia con «Agregar a la carta» (A.5, A.8)", () => {
  const VUELTAS = 10;

  it(`importar y «Agregar a la carta» del mismo producto y local a la vez (${VUELTAS} vueltas): queda UNA fila, no ganan las dos, y la importación nunca pisa lo que cargó «Agregar»`, async () => {
    const huinganco = semilla.sucursales.Huinganco;
    const { huellaVisible } = await vistaPrevia();
    expect((await importar({ tipo: "CONFIRMAR", huella: huellaVisible })).ok).toBe(true);
    expect(await conteos()).toEqual(TODO);

    const producto = await prisma.producto.findFirstOrThrow({ where: { codigo: "CON-SECCION-1" }, select: { id: true } });
    const clave = { sucursalId_productoId: { sucursalId: huinganco, productoId: producto.id } };
    const entidadId = `${huinganco}:${producto.id}`;
    const delImportador = await prisma.contenidoCartaProducto.findUniqueOrThrow({ where: clave });
    // «Agregar» lo pone en OTRA sección: si la importación lo pisara, la sección volvería a la suya.
    const otraSeccion = Object.values(semilla.secciones).find((id) => id !== delImportador.seccionCartaId)!;
    const actorDeAgregar = { ...actorDePrueba(semilla.duena.id, huinganco), sucursalNombre: "Huinganco" };
    const auditoriasDeLaFila = () => prisma.registroAuditoria.count({ where: { entidad: "ContenidoCartaProducto", entidadId } });

    const ganadores = { importacion: 0, agregar: 0 };
    for (let vuelta = 1; vuelta <= VUELTAS; vuelta++) {
      // Rehacer el estado: ese producto vuelve a estar fuera de carta en Huinganco (las auditorías ya escritas quedan: solo se agrega).
      await prisma.contenidoCartaProducto.delete({ where: clave });
      const auditoriasAntes = await auditoriasDeLaFila();
      const totalAntes = await prisma.registroAuditoria.count();
      const previa = await vistaPrevia();
      expect(previa.conteos.contenidos, `vuelta ${vuelta}`).toMatchObject({ CREAR: 1, SIN_CAMBIOS: 429, ERROR: 0 });

      // «Agregar» entra con un retraso que crece por vuelta (0 a 180 ms): así se cruzan las dos transacciones en distintos momentos de la importación (antes de leer, entre leer y escribir, ya confirmada).
      const retraso = (vuelta - 1) * 20;
      const [importacion, agregar] = await Promise.all([
        importar({ tipo: "CONFIRMAR", huella: previa.huellaVisible }),
        new Promise((r) => setTimeout(r, retraso)).then(() => agregarProductoALaCartaCasoDeUso(actorDeAgregar, { productoId: producto.id, seccionCartaId: otraSeccion })),
      ]);

      const gano = { importacion: importacion.ok, agregar: agregar.ok && agregar.datos.huboCambio };
      expect(gano.importacion !== gano.agregar, `vuelta ${vuelta}: gana exactamente una (importación ${JSON.stringify(importacion.ok)}, agregar ${JSON.stringify(agregar.ok)})`).toBe(true);
      // Si «Agregar» ya había confirmado cuando la importación leyó, el plan ve el contenido distinto (NO_CONFIRMABLE); si confirmó entre su lectura y su escritura, cambia la huella o choca el único.
      if (!importacion.ok) expect(["VERSION_DESACTUALIZADA", "CHOQUE_DE_UNICIDAD", "NO_CONFIRMABLE"], `vuelta ${vuelta}`).toContain(importacion.codigo);
      if (!agregar.ok) expect(agregar.codigo, `vuelta ${vuelta}`).toBe("YA_TIENE_CONTENIDO");

      const filas = await prisma.contenidoCartaProducto.findMany({ where: { sucursalId: huinganco, productoId: producto.id } });
      expect(filas, `vuelta ${vuelta}`).toHaveLength(1);
      if (gano.agregar) {
        // La fila es la de «Agregar» (su sección, sin descripción): la importación no la pisó.
        expect(filas[0], `vuelta ${vuelta}`).toMatchObject({ seccionCartaId: otraSeccion, visibleEnCarta: true, descripcion: null });
        expect(importacion.ok, `vuelta ${vuelta}`).toBe(false);
      } else {
        expect(filas[0], `vuelta ${vuelta}`).toMatchObject({ seccionCartaId: delImportador.seccionCartaId, descripcion: delImportador.descripcion, orden: delImportador.orden });
      }
      expect(await auditoriasDeLaFila(), `vuelta ${vuelta}`).toBe(auditoriasAntes + 1);
      expect(await prisma.registroAuditoria.count(), `vuelta ${vuelta}`).toBe(totalAntes + 1);
      ganadores[gano.importacion ? "importacion" : "agregar"]++;
    }
    expect(ganadores.importacion + ganadores.agregar).toBe(VUELTAS);
  });
});
