import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { cargarOpcionesDelProducto } from "../../src/server/consultas/catalogo/opciones-de-venta";
import type { DatosDeVersionDeOpcion } from "../../src/core/features/catalogo/opciones-de-venta.schema";

/**
 * Cargar qué consume cada opción DESDE LA FICHA DEL PRODUCTO (`docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`), contra Postgres real y como `motor2_app`. La pestaña Opciones usa el MISMO caso de uso que la
 * Biblioteca (`agregarVersionDeOpcionCasoDeUso`) y le manda la diferencia y el factor que rigen hoy, tal cual, con las líneas nuevas: acá se prueba ESE pedido (la forma que arma la pestaña) en lo que importa:
 * lo que la pantalla lee (consumos con nombres, quiénes usan el grupo), que guardar un consumo no cambia el precio ni el factor, dos guardados a la vez (una sola versión ganadora), el mismo pedido repetido
 * (no duplica) y el aislamiento entre empresas.
 */
type Vigente = NonNullable<Awaited<ReturnType<typeof cargarOpcionesDelProducto>>>["admitidos"][number]["opciones"][number]["vigente"];

/** El pedido que arma la pestaña: lo vigente (diferencia y factor, sin tocar) más las líneas de consumo del formulario. */
function pedidoDeLaPestania(opcionId: string, vigente: NonNullable<Vigente>, consumos: DatosDeVersionDeOpcion["consumos"]) {
  return { opcionId, numeroEsperado: vigente.numero, version: { diferencia: vigente.diferencia, factorEscala: vigente.factorEscala, consumos } };
}

describe("consumo de una opción desde la ficha del producto", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const SUMA = (insumoProductoId: string, cantidad: number, escalaConLaMedida = false) => ({ efecto: "SUMA" as const, insumoProductoId, reemplazaAProductoId: null, cantidad, mermaPorcentaje: 0, escalaConLaMedida });

  async function vigenteDe(opcionId: string, productoId = e.cafeId) {
    const datos = await cargarOpcionesDelProducto(baseDeTest.db, productoId, e.sucursalA);
    const opcion = datos?.admitidos.flatMap((g) => g.opciones).find((o) => o.opcionId === opcionId);
    expect(opcion?.vigente, "la opción no trae su versión vigente").toBeTruthy();
    return opcion!.vigente!;
  }

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  it("la pestaña lee de cada opción su versión vigente con los nombres, los insumos de la empresa y quiénes usan cada grupo (contados junto con este producto)", async () => {
    const datos = await cargarOpcionesDelProducto(baseDeTest.db, e.cafeId, e.sucursalA);
    expect(datos).not.toBeNull();
    const variante = datos!.admitidos.find((g) => g.grupoId === e.grupoVarianteId)!;
    const almendras = variante.opciones.find((o) => o.opcionId === e.almendrasId)!;
    expect(almendras.vigente).toMatchObject({
      numero: 1,
      diferencia: { tipo: "MONTO", monto: 150 },
      factorEscala: null,
      consumos: [{ efecto: "REEMPLAZA", insumoNombre: "Bebida de almendras", reemplazaNombre: "Leche", cantidad: 0.2, mermaPorcentaje: 0, escalaConLaMedida: false }],
    });
    expect(almendras.vigente!.consumos[0]!.unidadNombre).not.toBe("");
    // Una opción sin consumo cargado: la lista viene vacía (la pantalla dice «pendiente de completar»), nunca inventada.
    expect(variante.opciones.find((o) => o.opcionId === e.vacaId)!.vigente!.consumos).toEqual([]);
    // El factor del tamaño viaja para leerlo.
    const chico = datos!.admitidos.find((g) => g.grupoId === e.grupoMedidaId)!.opciones.find((o) => o.opcionId === e.chicoId)!;
    expect(chico.vigente).toMatchObject({ factorEscala: 0.5, diferencia: { tipo: "MONTO", monto: -50 } });
    expect(datos!.insumos.map((i) => i.nombre)).toEqual(expect.arrayContaining(["Leche", "Bebida de almendras"]));
    expect(datos!.insumos.every((i) => i.unidadNombre.length > 0)).toBe(true);
    expect(variante.productosQueLoUsan).toEqual([{ id: e.cafeId, nombre: "Café" }]);

    // Un segundo producto usa el mismo grupo: los dos nombres, por orden alfabético, en cualquiera de los dos productos.
    const otro = await prisma.producto.create({ data: { codigo: "PV_CAPU", nombre: "Capuchino", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "1500.00" } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: otro.id, grupoId: e.grupoVarianteId, orden: 1 } });
    for (const productoId of [e.cafeId, otro.id]) {
      const d = await cargarOpcionesDelProducto(baseDeTest.db, productoId, e.sucursalA);
      expect(d!.admitidos.find((g) => g.grupoId === e.grupoVarianteId)!.productosQueLoUsan.map((p) => p.nombre)).toEqual(["Café", "Capuchino"]);
    }
    // Un grupo que el otro producto QUITÓ (fila inactiva) ya no cuenta como usado.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: otro.id, grupoId: e.grupoVarianteId }, data: { activo: false } });
    const d = await cargarOpcionesDelProducto(baseDeTest.db, e.cafeId, e.sucursalA);
    expect(d!.admitidos.find((g) => g.grupoId === e.grupoVarianteId)!.productosQueLoUsan.map((p) => p.nombre)).toEqual(["Café"]);
  });

  it("guardar un consumo agrega UNA versión con las líneas nuevas y CONSERVA la diferencia y el factor que regían (un tamaño con factor 0,5 sigue en 0,5 y en −$50)", async () => {
    const antes = await vigenteDe(e.chicoId);
    const r = await agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.chicoId, antes, [SUMA(e.lecheId, 0.15, true)]));
    expect(r).toMatchObject({ ok: true, datos: { numero: 2, yaExistia: false } });
    const despues = await vigenteDe(e.chicoId);
    expect(despues).toMatchObject({ numero: 2, diferencia: { tipo: "MONTO", monto: -50 }, factorEscala: 0.5 });
    expect(despues.consumos).toMatchObject([{ efecto: "SUMA", insumoNombre: "Leche", cantidad: 0.15, escalaConLaMedida: true }]);
    // La versión 1 queda intacta (inmutable) y con quién guardó.
    expect(await prisma.consumoDeOpcion.count({ where: { versionDeOpcionId: e.versionDe[e.chicoId]! } })).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "VersionDeOpcion", campo: "numero", valorNuevo: "2" } })).toBe(1);
  });

  it("también se carga el consumo de un adicional (solo SUMA, sin escalar): con «escala con el tamaño» o REEMPLAZA el servidor lo rechaza y no guarda nada", async () => {
    const antes = await vigenteDe(e.shotId);
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.shotId, antes, [SUMA(e.lecheId, 0.05, true)]))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.shotId, antes, [{ ...SUMA(e.lecheId, 0.05), efecto: "REEMPLAZA" as const, reemplazaAProductoId: e.almendrasInsumoId }]))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.shotId } })).toBe(1);
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.shotId, antes, [SUMA(e.lecheId, 0.05)]))).toMatchObject({ ok: true, datos: { numero: 2 } });
  });

  it("dos guardados a la vez sobre la misma opción: UNA sola versión ganadora y la otra recibe VERSION_DESACTUALIZADA (nada se pisa)", async () => {
    const antes = await vigenteDe(e.vacaId);
    const [a, b] = await Promise.all([
      agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.vacaId, antes, [SUMA(e.lecheId, 0.2)])),
      agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.vacaId, antes, [SUMA(e.almendrasInsumoId, 0.3)])),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok)).toMatchObject([{ codigo: "VERSION_DESACTUALIZADA" }]);
    const versiones = await prisma.versionDeOpcion.findMany({ where: { opcionId: e.vacaId }, orderBy: { numero: "asc" }, include: { consumos: true } });
    expect(versiones.map((v) => v.numero)).toEqual([1, 2]);
    expect(versiones[1]!.consumos).toHaveLength(1);
  });

  it("el mismo pedido repetido (dos veces seguidas y dos a la vez): una sola versión, un solo juego de consumos y una sola auditoría", async () => {
    const antes = await vigenteDe(e.azucarId);
    const pedido = pedidoDeLaPestania(e.azucarId, antes, [SUMA(e.lecheId, 0.01)]);
    const [a, b] = await Promise.all([agregarVersionDeOpcionCasoDeUso(actor(), pedido), agregarVersionDeOpcionCasoDeUso(actor(), pedido)]);
    const c = await agregarVersionDeOpcionCasoDeUso(actor(), pedido);
    expect([a, b, c].every((r) => r.ok)).toBe(true);
    expect([a, b, c].filter((r) => r.ok && r.datos.yaExistia)).toHaveLength(2);
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.azucarId } })).toBe(2);
    expect(await prisma.consumoDeOpcion.count({ where: { versionDeOpcion: { opcionId: e.azucarId } } })).toBe(1);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "VersionDeOpcion", campo: "numero" } })).toBe(1);
  });

  it("aislamiento entre empresas: una opción de otra empresa responde «no encontrada» y no se escribe nada; el producto de otra empresa no se lee", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const grupo = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const ajena = await testigo.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre: "Ajena", orden: 1 } });
    const antes = await vigenteDe(e.vacaId);
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), { ...pedidoDeLaPestania(e.vacaId, antes, [SUMA(e.lecheId, 0.2)]), opcionId: ajena.id })).toMatchObject({ ok: false, codigo: "OPCION_NO_ENCONTRADA" });
    expect(await prismaAdmin.versionDeOpcion.count({ where: { opcionId: ajena.id } })).toBe(0);
    // Un insumo de otra empresa tampoco se acepta como consumo de una opción propia.
    const unidad = await testigo.unidad.create({ data: { nombre: "kg ajeno", magnitud: "PESO" } });
    const insumoAjeno = await testigo.producto.create({ data: { codigo: "MP_AJENO", nombre: "Insumo ajeno", tipo: "MP", unidadStockId: unidad.id } });
    expect(await agregarVersionDeOpcionCasoDeUso(actor(), pedidoDeLaPestania(e.vacaId, antes, [SUMA(insumoAjeno.id, 1)]))).toMatchObject({ ok: false });
    expect(await prisma.versionDeOpcion.count({ where: { opcionId: e.vacaId } })).toBe(1);
    expect(await cargarOpcionesDelProducto(baseDeTest.db, "producto-que-no-existe", e.sucursalA)).toBeNull();
  });
});
