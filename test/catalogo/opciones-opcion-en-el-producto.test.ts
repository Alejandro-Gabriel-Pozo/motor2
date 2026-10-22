import { beforeEach, describe, expect, it } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import { guardComandoCrearOpcionEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoCrearOpcionEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { crearOpcionEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-en-el-producto";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * «+ Opción» y «+ Extra» (el comando compuesto de ADR-030): agregar una opción a un grupo que el producto ya usa, TODO O NADA, contra Postgres real como `motor2_app`. Lo que lleva la opción lo decide el TIPO del grupo,
 * que el caso de uso lee: una variante o una medida en DIFERENCIA, lo que suma; una medida en ABSOLUTO, su precio final (en lo que admite el producto); una incluida, nada; un adicional (el extra), lo que cobra y su
 * producto de respaldo. Idempotencia por estado, sin migración; nada se pisa; los otros productos del grupo no cambian. Las dos claves, en `test/permisos/opcion-en-el-producto-dos-claves`; el aislamiento por
 * empresa, en `test/aislamiento/opcion-en-el-producto-otra-empresa`.
 */
describe("agregar una opción a un grupo del producto (+ Opción, + Extra)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const crear = (comando: ComandoCrearOpcionEnElProducto) => crearOpcionEnElProductoCasoDeUso(actor(), comando, azarDelProceso);
  /** Todo lo que el comando puede escribir, contado: lo que NO tiene que cambiar cuando se rechaza o se repite. */
  const cuentas = async () => ({
    opciones: await prisma.opcionDeGrupo.count(),
    versiones: await prisma.versionDeOpcion.count(),
    admisionesDeGrupo: await prisma.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await prisma.productoAdmiteOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
    productos: await prisma.producto.count(),
  });
  const versionDeLaFila = async (productoId: string, grupoId: string) => (await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId, grupoId } } })).version;
  const pedido = async (productoId: string, grupoId: string, resto: Partial<ComandoCrearOpcionEnElProducto> & { nombre: string }): Promise<ComandoCrearOpcionEnElProducto> => ({
    productoId,
    grupoId,
    versionEsperada: await versionDeLaFila(productoId, grupoId),
    importe: null,
    unidadStockId: null,
    ...resto,
  });
  /** Un PV que usa solo la VARIANTE «Leche» con «De vaca» (no el resto del café): para comprobar que lo que admite OTRO producto no cambia. */
  const otroProductoConLeche = async () => {
    const otro = await prisma.producto.create({ data: { codigo: "PV_OTRO", nombre: "Otro café", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "1000.00" } });
    await prisma.productoAdmiteGrupo.create({ data: { productoId: otro.id, grupoId: e.grupoVarianteId, orden: 0 } });
    await prisma.productoAdmiteOpcion.create({ data: { productoId: otro.id, opcionId: e.vacaId, cantidadMaxima: 1 } });
    return otro.id;
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  it("«+ Opción» en una VARIANTE: la opción queda al final del grupo con su versión 1 (lo que suma), el producto la admite, los otros productos no, y todo está auditado", async () => {
    const otroId = await otroProductoConLeche();
    const antes = await cuentas();
    const r = await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena", importe: 200 }));
    expect(r).toMatchObject({ ok: true, mensaje: "Listo: se agregó la opción «Avena» a «Leche» de «Café».", datos: { yaExistia: false } });
    if (!r.ok) return;

    const opcion = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: r.datos.opcionId }, include: { versiones: true } });
    expect(opcion).toMatchObject({ grupoId: e.grupoVarianteId, nombre: "Avena", orden: 12, esNinguna: false, activa: true, productoId: null });
    expect(opcion.versiones).toHaveLength(1);
    expect(opcion.versiones[0]).toMatchObject({ numero: 1, tipoDeDiferencia: "MONTO", factorEscala: null, creadoPorId: e.usuarioId });
    expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(200);

    const fila = await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: e.cafeId, opcionId: r.datos.opcionId } } });
    expect(fila).toMatchObject({ cantidadMaxima: 1, tipoDeDiferencia: null, precioAbsoluto: null, activo: true });
    // La fila del grupo queda como estaba (mismo orden y límites); las demás opciones del grupo no se tocan.
    expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoVarianteId } } })).toMatchObject({ activo: true });
    // Otro producto que usa el mismo grupo NO admite la opción nueva.
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: otroId, opcionId: r.datos.opcionId } })).toBe(0);

    const despues = await cuentas();
    expect(despues).toMatchObject({ opciones: antes.opciones + 1, versiones: antes.versiones + 1, admisionesDeOpcion: antes.admisionesDeOpcion + 1, admisionesDeGrupo: antes.admisionesDeGrupo, productos: antes.productos });
    const auditadas = await prisma.registroAuditoria.findMany({ where: { entidad: { in: ["OpcionDeGrupo", "VersionDeOpcion", "ProductoAdmiteOpcion"] }, actorId: e.usuarioId }, orderBy: { creadoEn: "asc" } });
    expect(new Set(auditadas.map((a) => a.entidad))).toEqual(new Set(["OpcionDeGrupo", "VersionDeOpcion", "ProductoAdmiteOpcion"]));
  });

  it("«+ Opción» en una MEDIDA en DIFERENCIA (el tamaño del café): lo que suma va en la versión y la fila del producto no lleva precio propio", async () => {
    await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoMedidaId } }, data: { modoPrecio: "DIFERENCIA" } });
    const r = await crear(await pedido(e.cafeId, e.grupoMedidaId, { nombre: "Gigante", importe: 300 }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const opcion = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: r.datos.opcionId }, include: { versiones: true } });
    expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(300);
    expect(await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: e.cafeId, opcionId: r.datos.opcionId } } })).toMatchObject({ precioAbsoluto: null, cantidadMaxima: 1 });
  });

  describe("una MEDIDA en ABSOLUTO (un producto de precio por opción)", () => {
    let pizzaId: string;
    beforeEach(async () => {
      pizzaId = (await prisma.producto.create({ data: { codigo: "PV_PIZZA", nombre: "Pizza", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } })).id;
      await prisma.productoAdmiteGrupo.create({ data: { productoId: pizzaId, grupoId: e.grupoMedidaId, orden: 0, modoPrecio: "ABSOLUTO" } });
      await prisma.productoAdmiteOpcion.create({ data: { productoId: pizzaId, opcionId: e.chicoId, cantidadMaxima: 1, precioAbsoluto: "5000.00" } });
    });

    it("el importe es el PRECIO FINAL de la opción (en lo que admite el producto) y su versión queda en 0", async () => {
      const r = await crear(await pedido(pizzaId, e.grupoMedidaId, { nombre: "Gigante", importe: 9000 }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const opcion = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: r.datos.opcionId }, include: { versiones: true } });
      expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(0);
      const fila = await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: pizzaId, opcionId: r.datos.opcionId } } });
      expect(Number(fila.precioAbsoluto)).toBe(9000);
    });

    it("sin importe o en cero no hay precio final: se rechaza y no queda nada", async () => {
      const antes = await cuentas();
      expect(await crear(await pedido(pizzaId, e.grupoMedidaId, { nombre: "Gigante", importe: null }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: "Falta el precio final de la opción." });
      expect(await crear(await pedido(pizzaId, e.grupoMedidaId, { nombre: "Gigante", importe: 0 }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: "El precio final de la opción tiene que ser mayor que cero." });
      expect(await cuentas()).toEqual(antes);
    });
  });

  it("«+ Opción» en un grupo INCLUIDA: sin importe (queda en 0); con un importe se rechaza", async () => {
    const antes = await cuentas();
    expect(await crear(await pedido(e.cafeId, e.grupoIncluidaId, { nombre: "Edulcorante", importe: 50 }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await cuentas()).toEqual(antes);
    const r = await crear(await pedido(e.cafeId, e.grupoIncluidaId, { nombre: "Edulcorante" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const version = await prisma.versionDeOpcion.findFirstOrThrow({ where: { opcionId: r.datos.opcionId } });
    expect(Number(version.diferenciaPrecio)).toBe(0);
  });

  it("«+ Extra» en un ADICIONAL: la opción lleva su producto de respaldo (sin disponibilidad), lo que cobra va en la versión y el producto la admite con el tope del grupo", async () => {
    const antes = await cuentas();
    const r = await crear(await pedido(e.cafeId, e.grupoAdicionalId, { nombre: "Crema", importe: 120, unidadStockId: e.unidadId }));
    expect(r).toMatchObject({ ok: true, mensaje: "Listo: se agregó el extra «Crema» a «Extras» de «Café».", datos: { yaExistia: false } });
    if (!r.ok) return;
    const opcion = await prisma.opcionDeGrupo.findUniqueOrThrow({ where: { id: r.datos.opcionId }, include: { versiones: true } });
    expect(opcion.productoId).not.toBeNull();
    expect(Number(opcion.versiones[0]!.diferenciaPrecio)).toBe(120);
    const ancla = await prisma.producto.findUniqueOrThrow({ where: { id: opcion.productoId! } });
    expect(ancla).toMatchObject({ nombre: "Crema", tipo: "PV", unidadStockId: e.unidadId });
    expect(await prisma.disponibilidadProducto.count({ where: { productoId: ancla.id } })).toBe(0);
    expect(await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: e.cafeId, opcionId: r.datos.opcionId } } })).toMatchObject({ cantidadMaxima: 3, precioAbsoluto: null, activo: true });
    expect((await cuentas()).productos).toBe(antes.productos + 1);
  });

  it("«+ Extra»: sin la unidad del respaldo se rechaza; «+ Opción» con una unidad (solo un extra lleva respaldo) también; un producto con el nombre del extra: NOMBRE_DE_ANCLA_REPETIDO; y no queda nada", async () => {
    const antes = await cuentas();
    expect(await crear(await pedido(e.cafeId, e.grupoAdicionalId, { nombre: "Crema", importe: 120 }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: "Elegí la unidad del producto de respaldo del extra." });
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena", importe: 200, unidadStockId: e.unidadId }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: "Solo un extra (un adicional) lleva producto de respaldo." });
    expect(await crear(await pedido(e.cafeId, e.grupoAdicionalId, { nombre: "Café", importe: 120, unidadStockId: e.unidadId }))).toMatchObject({ ok: false, codigo: "NOMBRE_DE_ANCLA_REPETIDO" });
    expect(await crear(await pedido(e.cafeId, e.grupoAdicionalId, { nombre: "Crema", importe: 0, unidadStockId: e.unidadId }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await cuentas()).toEqual(antes);
  });

  it("IDEMPOTENCIA por estado: repetir el pedido (un doble clic, un reintento) no crea, no cambia ni audita nada de nuevo", async () => {
    const comando = await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena", importe: 200 });
    const primera = await crear(comando);
    expect(primera.ok).toBe(true);
    const despuesDeLaPrimera = await cuentas();
    // El mismo pedido, con la versión que vio la pantalla (ya vieja: otro clic llegó después de que el primero confirmó).
    const repetida = await crear(comando);
    expect(repetida).toMatchObject({ ok: true, datos: { yaExistia: true } });
    if (repetida.ok && primera.ok) expect(repetida.datos.opcionId).toBe(primera.datos.opcionId);
    expect(await cuentas()).toEqual(despuesDeLaPrimera);
  });

  it("nada se pisa: una opción con ese nombre pero distinta (otro importe) o ya admitida con otro importe se rechaza con NOMBRE_REPETIDO y no queda nada", async () => {
    const antes = await cuentas();
    // «Almendras» ya está en la leche (suma 150) y el café la admite: con otro importe es otra cosa.
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Almendras", importe: 999 }))).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "de vaca", importe: 10 }))).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
    expect(await cuentas()).toEqual(antes);
  });

  it("una opción del grupo que YA estaba, igual a la pedida, y que este producto no admitía se adopta: solo se agrega lo que admite el producto", async () => {
    const otroId = await otroProductoConLeche();
    const soja = await prisma.opcionDeGrupo.create({ data: { grupoId: e.grupoVarianteId, nombre: "Soja", orden: 5 } });
    await prisma.versionDeOpcion.create({ data: { opcionId: soja.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "100.00", creadoPorId: e.usuarioId } });
    const antes = await cuentas();
    const r = await crear(await pedido(otroId, e.grupoVarianteId, { nombre: "soja", importe: 100 }));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, datos: { yaExistia: false, opcionId: soja.id } });
    const despues = await cuentas();
    expect(despues).toMatchObject({ opciones: antes.opciones, versiones: antes.versiones, admisionesDeOpcion: antes.admisionesDeOpcion + 1 });
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: otroId, opcionId: soja.id } })).toBe(1);
  });

  it("el producto tiene que USAR el grupo: sin la fila (o con el grupo quitado) es GRUPO_NO_ADMITIDO y no queda nada", async () => {
    const otro = await prisma.producto.create({ data: { codigo: "PV_SIN", nombre: "Sin opciones", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "1000.00" } });
    const antes = await cuentas();
    expect(await crear({ productoId: otro.id, grupoId: e.grupoVarianteId, versionEsperada: 1, nombre: "Avena", importe: 200, unidadStockId: null })).toMatchObject({ ok: false, codigo: "GRUPO_NO_ADMITIDO" });
    await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoVarianteId } }, data: { activo: false } });
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena", importe: 200 }))).toMatchObject({ ok: false, codigo: "GRUPO_NO_ADMITIDO" });
    expect((await cuentas()).opciones).toBe(antes.opciones);
  });

  it("la versión que vio la pantalla manda: si lo que admite el producto del grupo cambió, VERSION_DESACTUALIZADA, y NO queda ni la opción que se había creado antes de la admisión (rechazo tardío)", async () => {
    const antes = await cuentas();
    const vieja = await versionDeLaFila(e.cafeId, e.grupoVarianteId);
    const r = await crear({ productoId: e.cafeId, grupoId: e.grupoVarianteId, versionEsperada: vieja + 5, nombre: "Avena", importe: 200, unidadStockId: null });
    expect(r).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await cuentas()).toEqual(antes);
    expect(await prisma.opcionDeGrupo.count({ where: { nombre: "Avena" } })).toBe(0);
  });

  it("rechazos de pertenencia y de tipo: producto o grupo inexistente, un producto que no es de venta, el respaldo de un adicional, un grupo archivado", async () => {
    const antes = await cuentas();
    expect(await crear({ productoId: "no-existe", grupoId: e.grupoVarianteId, versionEsperada: 1, nombre: "Avena", importe: 1, unidadStockId: null })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect(await crear({ productoId: e.cafeId, grupoId: "no-existe", versionEsperada: 1, nombre: "Avena", importe: 1, unidadStockId: null })).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
    expect(await crear({ productoId: e.lecheId, grupoId: e.grupoVarianteId, versionEsperada: 1, nombre: "Avena", importe: 1, unidadStockId: null })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
    expect(await crear({ productoId: e.anclaDelShotId, grupoId: e.grupoVarianteId, versionEsperada: 1, nombre: "Avena", importe: 1, unidadStockId: null })).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
    await prisma.grupoDeOpciones.update({ where: { id: e.grupoVarianteId }, data: { activo: false } });
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena", importe: 200 }))).toMatchObject({ ok: false, codigo: "GRUPO_INACTIVO" });
    expect(await cuentas()).toEqual(antes);
  });

  it("falta el importe en un grupo que cobra (variante) y en un extra: se dice cuál", async () => {
    expect(await crear(await pedido(e.cafeId, e.grupoVarianteId, { nombre: "Avena" }))).toMatchObject({ ok: false, mensaje: "Falta cuánto suma la opción (0 si no cambia el precio)." });
    expect(await crear(await pedido(e.cafeId, e.grupoAdicionalId, { nombre: "Crema", unidadStockId: e.unidadId }))).toMatchObject({ ok: false, mensaje: "Falta cuánto cobra el extra." });
  });
});

describe("guardComandoCrearOpcionEnElProducto: formato y rango", () => {
  const ok = { productoId: "p1", grupoId: "g1", versionEsperada: 1, nombre: "Avena", importe: 200, unidadStockId: null };

  it("un pedido bien formado pasa, con el importe y la unidad opcionales (null si no vienen)", () => {
    expect(guardComandoCrearOpcionEnElProducto(ok)).toEqual({ ok: true, valor: ok });
    expect(guardComandoCrearOpcionEnElProducto({ productoId: "p1", grupoId: "g1", versionEsperada: 3, nombre: " Crema ", unidadStockId: "u1" })).toEqual({
      ok: true,
      valor: { productoId: "p1", grupoId: "g1", versionEsperada: 3, nombre: "Crema", importe: null, unidadStockId: "u1" },
    });
  });

  it("el importe lleva a lo sumo 2 decimales, no es negativo y se lee con la regla del campo: «21.000» son veintiún mil y «21,000» se rechaza", () => {
    expect(guardComandoCrearOpcionEnElProducto({ ...ok, importe: "21.000" })).toMatchObject({ ok: true, valor: { importe: 21000 } });
    for (const malo of [-1, "21,000", 1.234, Number.NaN, Infinity, "abc", {}, true]) expect(guardComandoCrearOpcionEnElProducto({ ...ok, importe: malo }).ok, String(malo)).toBe(false);
    expect(guardComandoCrearOpcionEnElProducto({ ...ok, importe: "" })).toMatchObject({ ok: true, valor: { importe: null } });
  });

  it("los ids, la versión y el nombre tienen que ser válidos", () => {
    for (const mala of [{ productoId: "" }, { productoId: 5 }, { grupoId: null }, { grupoId: "x".repeat(65) }, { versionEsperada: 0 }, { versionEsperada: "a" }, { versionEsperada: 1.5 }, { nombre: "" }, { nombre: "   " }, { unidadStockId: 3 }]) {
      expect(guardComandoCrearOpcionEnElProducto({ ...ok, ...mala }).ok, JSON.stringify(mala)).toBe(false);
    }
  });
});
