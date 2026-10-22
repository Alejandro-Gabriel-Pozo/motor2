import { beforeEach, describe, expect, it } from "vitest";
import { azarDelProceso } from "../../src/lib/azar";
import { guardComandoCrearGrupoEnElProducto, MAX_OPCIONES_EN_UN_ALTA } from "../../src/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoCrearGrupoEnElProducto } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";
import { crearGrupoEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-en-el-producto";
import { cargarOpcionesParaVender } from "../../src/server/lecturas/opciones/opciones-para-vender";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";

/**
 * Fase 6, paso 6.14c: el comando compuesto «crear un grupo de opciones y agregarlo al producto», TODO O NADA (ADR-030, «El comando compuesto»), contra Postgres real como `motor2_app`.
 *  - Camino feliz con las tres respuestas a «¿Cambia el precio?»: PRECIO_FINAL (3 opciones, en un producto base), SUMA (en uno directo, que ya tiene grupos) e INCLUIDO.
 *  - Idempotencia por estado: repetir el pedido no crea ni audita nada de nuevo.
 *  - La biblioteca queda intacta: un grupo con ese nombre y otras opciones se rechaza sin escribir; uno idéntico se «adopta» (solo se agrega al producto).
 *  - Rechazo TARDÍO (posterior a la primera escritura): no queda NADA (H-3: devolver un `fracaso` desde adentro de la transacción confirmaría lo ya escrito; el caso de uso lanza).
 *  - El guard: formato y rango del dinero y de las opciones.
 * La atomicidad frente a una auditoría caída está en `opciones-grupo-en-el-producto-auditoria-atomica`, la concurrencia en `…-concurrencia`, los permisos en `test/permisos/grupo-en-el-producto-dos-claves`.
 */
describe("crear un grupo sin salir del producto (6.14c)", () => {
  let e: EscenarioDeOpciones;
  let milanesaId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const crear = (comando: ComandoCrearGrupoEnElProducto) => crearGrupoEnElProductoCasoDeUso(actor(), comando, azarDelProceso);
  const tamanos = (productoId: string): ComandoCrearGrupoEnElProducto => ({
    productoId,
    nombre: "Presentación",
    respuesta: "PRECIO_FINAL",
    prefijoEnCarta: null,
    opciones: [
      { nombre: "Simple", importe: 8000 },
      { nombre: "Doble", importe: 11000.5 },
      { nombre: "Triple", importe: 14000 },
    ],
  });
  /** Todo lo que el comando puede escribir, contado: lo que NO tiene que cambiar cuando se rechaza. */
  const cuentas = async () => ({
    grupos: await prisma.grupoDeOpciones.count(),
    opciones: await prisma.opcionDeGrupo.count(),
    versiones: await prisma.versionDeOpcion.count(),
    admisionesDeGrupo: await prisma.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await prisma.productoAdmiteOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
    productos: await prisma.producto.count(),
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    milanesaId = (await prisma.producto.create({ data: { codigo: "PV_MILA", nombre: "Milanesa", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } })).id;
  });

  it("PRECIO_FINAL con 3 opciones en un producto base: el grupo de medida, sus opciones con versión 1 en 0, lo que admite el producto con el precio de cada una, todo auditado", async () => {
    const antes = await cuentas();
    const r = await crear(tamanos(milanesaId));
    expect(r).toMatchObject({ ok: true, mensaje: "Listo: «Presentación» se agregó a «Milanesa» con 3 opciones.", datos: { yaExistia: false } });
    if (!r.ok) return;

    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: r.datos.grupoId } })).toMatchObject({ nombre: "Presentación", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, activo: true, prefijoEnCarta: null });
    const opciones = await prisma.opcionDeGrupo.findMany({ where: { grupoId: r.datos.grupoId }, orderBy: { orden: "asc" }, include: { versiones: true } });
    expect(opciones.map((o) => [o.nombre, o.orden, o.esNinguna, o.activa, o.productoId])).toEqual([
      ["Simple", 10, false, true, null],
      ["Doble", 20, false, true, null],
      ["Triple", 30, false, true, null],
    ]);
    for (const o of opciones) {
      expect(o.versiones).toHaveLength(1);
      expect(o.versiones[0]).toMatchObject({ numero: 1, tipoDeDiferencia: "MONTO", factorEscala: null, creadoPorId: e.usuarioId });
      expect(Number(o.versiones[0]!.diferenciaPrecio)).toBe(0);
    }

    const admision = await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: milanesaId, grupoId: r.datos.grupoId } } });
    expect(admision).toMatchObject({ id: r.datos.admisionId, orden: 10, cantidadMinima: null, cantidadMaxima: null, modoPrecio: "ABSOLUTO", activo: true, version: 1 });
    const filas = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: milanesaId }, orderBy: { opcion: { orden: "asc" } }, include: { opcion: { select: { nombre: true } } } });
    expect(filas.map((f) => [f.opcion.nombre, Number(f.precioAbsoluto), f.cantidadMaxima, f.tipoDeDiferencia, f.activo])).toEqual([
      ["Simple", 8000, 1, null, true],
      ["Doble", 11000.5, 1, null, true],
      ["Triple", 14000, 1, null, true],
    ]);

    // Lo que ve la venta: el producto se vende por opción y admite el grupo con sus tres opciones.
    const paraVender = (await cargarOpcionesParaVender(actor().db, { sucursalId: e.sucursalA, productoIds: [milanesaId] })).get(milanesaId)!;
    expect(paraVender.esBase).toBe(true);
    expect(paraVender.grupos).toHaveLength(1);
    expect(paraVender.grupos[0]!.opciones.map((o) => o.nombre)).toEqual(["Simple", "Doble", "Triple"]);

    // Auditoría: las cinco entidades del alta compuesta, todas del mismo actor.
    const despues = await cuentas();
    expect(despues).toMatchObject({ grupos: antes.grupos + 1, opciones: antes.opciones + 3, versiones: antes.versiones + 3, admisionesDeGrupo: antes.admisionesDeGrupo + 1, admisionesDeOpcion: antes.admisionesDeOpcion + 3, productos: antes.productos });
    const auditorias = await prisma.registroAuditoria.findMany({ select: { entidad: true, actorId: true } });
    expect([...new Set(auditorias.map((a) => a.entidad))].sort()).toEqual(["GrupoDeOpciones", "OpcionDeGrupo", "ProductoAdmiteGrupo", "ProductoAdmiteOpcion", "VersionDeOpcion"]);
    expect(auditorias.every((a) => a.actorId === e.usuarioId)).toBe(true);
    expect(await prisma.registroAuditoria.count({ where: { entidad: "ProductoAdmiteOpcion", campo: "precioAbsoluto", valorNuevo: "11000.5" } })).toBe(1);
  });

  it("SUMA en un producto directo con grupos: el grupo de variantes con lo que suma cada opción en su versión 1, y el grupo va al final de los que ya admite (orden leído en la transacción)", async () => {
    const r = await crear({ productoId: e.cafeId, nombre: "Salsa", respuesta: "SUMA", prefijoEnCarta: "Con", opciones: [{ nombre: "Criolla", importe: 0 }, { nombre: "Trucha", importe: 3000 }] });
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!r.ok) return;
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: r.datos.grupoId } })).toMatchObject({ tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, prefijoEnCarta: "Con" });
    const opciones = await prisma.opcionDeGrupo.findMany({ where: { grupoId: r.datos.grupoId }, orderBy: { orden: "asc" }, include: { versiones: true } });
    expect(opciones.map((o) => [o.nombre, Number(o.versiones[0]!.diferenciaPrecio)])).toEqual([["Criolla", 0], ["Trucha", 3000]]);
    // El café ya admitía cuatro grupos con orden 0, 1, 2 y 3: el nuevo va a 13.
    expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: r.datos.grupoId } } })).toMatchObject({ orden: 13, modoPrecio: null, cantidadMinima: null, cantidadMaxima: null, activo: true });
    const filas = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: e.cafeId, opcionId: { in: opciones.map((o) => o.id) } } });
    expect(filas).toHaveLength(2);
    for (const f of filas) expect(f).toMatchObject({ precioAbsoluto: null, tipoDeDiferencia: null, cantidadMaxima: 1, activo: true });
  });

  it("INCLUIDO: el grupo de opciones incluidas, con versión 1 en 0 y sin ningún importe en lo que admite el producto", async () => {
    const r = await crear({ productoId: e.cafeId, nombre: "Se sirve", respuesta: "INCLUIDO", prefijoEnCarta: null, opciones: [{ nombre: "Caliente", importe: null }, { nombre: "Frío", importe: null }] });
    expect(r).toMatchObject({ ok: true, datos: { yaExistia: false } });
    if (!r.ok) return;
    expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: r.datos.grupoId } })).toMatchObject({ tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1 });
    const opciones = await prisma.opcionDeGrupo.findMany({ where: { grupoId: r.datos.grupoId }, include: { versiones: true } });
    for (const o of opciones) expect(Number(o.versiones[0]!.diferenciaPrecio)).toBe(0);
    const filas = await prisma.productoAdmiteOpcion.findMany({ where: { productoId: e.cafeId, opcionId: { in: opciones.map((o) => o.id) } } });
    expect(filas).toHaveLength(2);
    for (const f of filas) expect(f).toMatchObject({ precioAbsoluto: null, tipoDeDiferencia: null });
  });

  it("por estado: repetir el pedido (un reintento, un doble clic en serie) devuelve lo mismo sin escribir ni auditar de nuevo", async () => {
    const primera = await crear(tamanos(milanesaId));
    const despuesDeLaPrimera = await cuentas();
    const segunda = await crear(tamanos(milanesaId));
    expect(primera).toMatchObject({ ok: true, datos: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, mensaje: "«Presentación» ya estaba en «Milanesa» con esas opciones: no se hizo nada más.", datos: { yaExistia: true } });
    if (primera.ok && segunda.ok) expect(segunda.datos).toMatchObject({ grupoId: primera.datos.grupoId, admisionId: primera.datos.admisionId });
    expect(await cuentas()).toEqual(despuesDeLaPrimera);
  });

  describe("la biblioteca queda intacta", () => {
    it("un grupo con ese nombre (aunque cambien las mayúsculas) y OTRAS opciones: NOMBRE_REPETIDO, no se toca el grupo, ni sus opciones, ni sus versiones ni lo que admite el producto", async () => {
      const antes = await cuentas();
      const grupo = await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoMedidaId }, include: { opciones: { include: { versiones: true } } } });
      for (const nombre of ["Tamaño", "TAMAÑO"]) {
        const r = await crear({ productoId: milanesaId, nombre, respuesta: "PRECIO_FINAL", prefijoEnCarta: null, opciones: [{ nombre: "Chico", importe: 5000 }, { nombre: "Gigante", importe: 9000 }] });
        expect(r).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
        expect(r.mensaje).toMatch(/Agregar un grupo existente/);
      }
      expect(await cuentas()).toEqual(antes);
      expect(await prisma.grupoDeOpciones.findUniqueOrThrow({ where: { id: e.grupoMedidaId }, include: { opciones: { include: { versiones: true } } } })).toEqual(grupo);
    });

    /** Un grupo de la biblioteca escrito directo (como si lo hubieran armado en `/catalogo/opciones`): `Salsa`, VARIANTE 1 y 1, con sus opciones y su versión 1 (lo que suma cada una). */
    const salsaDeLaBiblioteca = async (opciones: Array<[nombre: string, suma: string, activa?: boolean]> = [["Criolla", "0.00"], ["Trucha", "3000.00"]]) => {
      const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Salsa", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } });
      for (const [i, [nombre, suma, activa]] of opciones.entries()) {
        const opcion = await prisma.opcionDeGrupo.create({ data: { grupoId: grupo.id, nombre, orden: (i + 1) * 10, activa: activa ?? true } });
        await prisma.versionDeOpcion.create({ data: { opcionId: opcion.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: suma, creadoPorId: e.usuarioId } });
      }
      return grupo;
    };
    const salsa = (opciones: Array<{ nombre: string; importe: number }>, productoId = e.cafeId): ComandoCrearGrupoEnElProducto => ({ productoId, nombre: "Salsa", respuesta: "SUMA", prefijoEnCarta: null, opciones });

    it("otro CONJUNTO de opciones (una de más, una de menos o un nombre distinto): NOMBRE_REPETIDO, el grupo queda como estaba y no se escribe nada", async () => {
      const grupo = await salsaDeLaBiblioteca();
      const antes = await cuentas();
      for (const opciones of [
        [{ nombre: "Criolla", importe: 0 }],
        [{ nombre: "Criolla", importe: 0 }, { nombre: "Trucha", importe: 3000 }, { nombre: "Picante", importe: 100 }],
        [{ nombre: "Criolla", importe: 0 }, { nombre: "Picante", importe: 3000 }],
      ]) {
        const r = await crear(salsa(opciones));
        expect(r, JSON.stringify(opciones)).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
        expect(r.mensaje).toMatch(/Agregar un grupo existente/);
      }
      expect(await cuentas()).toEqual(antes);
      expect(await prisma.opcionDeGrupo.count({ where: { grupoId: grupo.id } })).toBe(2);
    });

    it("las mismas opciones con OTRO precio (la versión 1 de «Trucha» suma otra cosa): también NOMBRE_REPETIDO y sin escribir", async () => {
      await salsaDeLaBiblioteca();
      const antes = await cuentas();
      const r = await crear(salsa([{ nombre: "Criolla", importe: 0 }, { nombre: "Trucha", importe: 3500 }]));
      expect(r).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await cuentas()).toEqual(antes);
    });

    it("las mismas opciones pero el grupo tiene OTRO tipo y otras cantidades (el café ya tiene «Leche», una variante de 0 a 1): tampoco se adopta", async () => {
      const antes = await cuentas();
      const r = await crear({ productoId: milanesaId, nombre: "Leche", respuesta: "SUMA", prefijoEnCarta: null, opciones: [{ nombre: "De vaca", importe: 0 }, { nombre: "Almendras", importe: 150 }] });
      expect(r).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      const comoMedida = await crear({ productoId: milanesaId, nombre: "Leche", respuesta: "INCLUIDO", prefijoEnCarta: null, opciones: [{ nombre: "De vaca", importe: null }, { nombre: "Almendras", importe: null }] });
      expect(comoMedida).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await cuentas()).toEqual(antes);
    });

    it("el grupo de la biblioteca es el mismo (hasta una opción archivada de más, que no cuenta): se adopta y no se toca ni su grupo, ni sus opciones, ni sus versiones", async () => {
      const grupo = await salsaDeLaBiblioteca([["Criolla", "0.00"], ["Trucha", "3000.00"], ["Vieja", "50.00", false]]);
      const antes = await cuentas();
      const r = await crear(salsa([{ nombre: "TRUCHA", importe: 3000 }, { nombre: "criolla", importe: 0 }]));
      expect(r).toMatchObject({ ok: true, datos: { grupoId: grupo.id, yaExistia: true } });
      const despues = await cuentas();
      expect(despues).toMatchObject({ grupos: antes.grupos, opciones: antes.opciones, versiones: antes.versiones, admisionesDeGrupo: antes.admisionesDeGrupo + 1, admisionesDeOpcion: antes.admisionesDeOpcion + 2 });
      expect(await prisma.opcionDeGrupo.count({ where: { grupoId: grupo.id } })).toBe(3);
    });

    it("un grupo idéntico que ya está en la biblioteca (de otro producto) se ADOPTA: solo se agrega a este producto, sin tocar el grupo ni sus opciones", async () => {
      const otro = await prisma.producto.create({ data: { codigo: "PV_MILA2", nombre: "Milanesa napolitana", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } });
      const primera = await crear(tamanos(milanesaId));
      const antes = await cuentas();
      const adoptada = await crear(tamanos(otro.id));
      expect(adoptada).toMatchObject({ ok: true, datos: { yaExistia: true } });
      expect(adoptada.mensaje).toMatch(/ya estaba en la biblioteca con esas mismas opciones y se agregó a «Milanesa napolitana» sin cambiarlo/);
      if (!primera.ok || !adoptada.ok) return;
      expect(adoptada.datos.grupoId).toBe(primera.datos.grupoId);
      const despues = await cuentas();
      expect(despues).toMatchObject({ grupos: antes.grupos, opciones: antes.opciones, versiones: antes.versiones, admisionesDeGrupo: antes.admisionesDeGrupo + 1, admisionesDeOpcion: antes.admisionesDeOpcion + 3 });
      // Lo que se audita es solo la admisión del producto nuevo: ni el grupo ni sus opciones ni sus versiones se escriben de nuevo.
      const nuevas = await prisma.registroAuditoria.findMany({ orderBy: { creadoEn: "asc" }, skip: antes.auditorias, select: { entidad: true } });
      expect([...new Set(nuevas.map((a) => a.entidad))].sort()).toEqual(["ProductoAdmiteGrupo", "ProductoAdmiteOpcion"]);
      expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: otro.id, grupoId: primera.datos.grupoId } } })).toMatchObject({ orden: 10, modoPrecio: "ABSOLUTO", activo: true });
    });

    it("un grupo idéntico pero ARCHIVADO no se adopta: GRUPO_INACTIVO (el mensaje dice cómo restaurarlo) y no queda nada", async () => {
      const otro = await prisma.producto.create({ data: { codigo: "PV_MILA2", nombre: "Milanesa napolitana", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "0.00", modoDeVenta: "BASE_CONFIGURABLE" } });
      const primera = await crear(tamanos(milanesaId));
      if (!primera.ok) throw new Error(primera.mensaje);
      await archivarOpcionesCasoDeUso(actor(), { grupoIds: [primera.datos.grupoId], opcionIds: [], archivar: true });
      const antes = await cuentas();
      const r = await crear(tamanos(otro.id));
      expect(r).toMatchObject({ ok: false, codigo: "GRUPO_INACTIVO" });
      expect(r.mensaje).toMatch(/restauralo/);
      expect(await cuentas()).toEqual(antes);
    });

    it("el grupo ya está en el producto pero con OTRO precio (alguien lo cambió después): NOMBRE_REPETIDO, no se pisa", async () => {
      const primera = await crear(tamanos(milanesaId));
      if (!primera.ok) throw new Error(primera.mensaje);
      await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: milanesaId, opcion: { nombre: "Simple" } }, data: { precioAbsoluto: "8500.00" } });
      const antes = await cuentas();
      const r = await crear(tamanos(milanesaId));
      expect(r).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(r.mensaje).toMatch(/ya está \(o estuvo\) en «Milanesa»/);
      expect(await cuentas()).toEqual(antes);
      expect(Number((await prisma.productoAdmiteOpcion.findFirstOrThrow({ where: { productoId: milanesaId, opcion: { nombre: "Simple" } } })).precioAbsoluto)).toBe(8500);
    });
  });

  describe("el producto", () => {
    it("un producto que no existe (o es de otra empresa), una materia prima y el producto de respaldo de un adicional se rechazan sin escribir nada", async () => {
      const antes = await cuentas();
      expect(await crear(tamanos("no-existe-este-producto"))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
      expect(await crear(tamanos(e.lecheId))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
      expect(await crear(tamanos(e.anclaDelShotId))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
      expect(await cuentas()).toEqual(antes);
    });
  });

  describe("un rechazo posterior a la primera escritura deshace TODO (H-3: se lanza, no se devuelve)", () => {
    it("PRECIO_FINAL con una opción a $ 0 (el guard la frena antes, pero el caso de uso se puede llamar directo): la admisión rechaza y no queda el grupo, ni las opciones, ni las versiones, ni nada", async () => {
      const antes = await cuentas();
      const r = await crear({ ...tamanos(milanesaId), opciones: [{ nombre: "Simple", importe: 8000 }, { nombre: "Gratis", importe: 0 }] });
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(r.mensaje).toMatch(/necesita un precio propio de 0,01 o más/);
      expect(await cuentas()).toEqual(antes);
    });

    it("un producto base al que se le agrega primero un grupo que SUMA: la regla de la base rechaza al final y no queda nada", async () => {
      const antes = await cuentas();
      const r = await crear({ productoId: milanesaId, nombre: "Salsa", respuesta: "SUMA", prefijoEnCarta: null, opciones: [{ nombre: "Criolla", importe: 0 }, { nombre: "Trucha", importe: 3000 }] });
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(r.mensaje).toMatch(/se vende por opción/);
      expect(await cuentas()).toEqual(antes);
    });

    it("un producto con precio de lista al que una opción lo deja en negativo (el control de precio de lista rechaza): no queda nada", async () => {
      const antes = await cuentas();
      // El guard no deja pasar un importe negativo en SUMA; llamado directo, la versión lo admite y el control del precio de lista (1.000 − 2.000) lo rechaza ya con todo escrito.
      const r = await crear({ productoId: e.cafeId, nombre: "Descuento", respuesta: "SUMA", prefijoEnCarta: null, opciones: [{ nombre: "Promo", importe: -2000 }] });
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
      expect(r.mensaje).toMatch(/no se puede vender/);
      expect(await cuentas()).toEqual(antes);
    });
  });

  describe("el guard: formato y rango", () => {
    const entrada = (cambios: Record<string, unknown> = {}) => ({ productoId: "prod1", nombre: "Presentación", respuesta: "PRECIO_FINAL", prefijoEnCarta: null, opciones: [{ nombre: "Simple", importe: 8000 }], ...cambios });
    const rechazo = (cambios: Record<string, unknown>) => {
      const r = guardComandoCrearGrupoEnElProducto(entrada(cambios));
      return r.ok ? null : r.mensaje;
    };

    it("acepta un alta bien formada, con los importes como número o como texto con a lo sumo 2 decimales, y devuelve la forma normalizada", () => {
      expect(guardComandoCrearGrupoEnElProducto(entrada({ opciones: [{ nombre: " Simple ", importe: "8000" }, { nombre: "Doble", importe: 11000.5 }] }))).toEqual({
        ok: true,
        valor: { productoId: "prod1", nombre: "Presentación", respuesta: "PRECIO_FINAL", prefijoEnCarta: null, opciones: [{ nombre: "Simple", importe: 8000 }, { nombre: "Doble", importe: 11000.5 }] },
      });
    });

    it("el dinero: más de 2 decimales, importe en 0 en un precio final, negativo en SUMA, vacío o que no es un número se rechazan; SUMA acepta 0; INCLUIDO no lleva importe", () => {
      expect(rechazo({ opciones: [{ nombre: "A", importe: 100.123 }] })).toMatch(/como máximo 2 decimales/);
      expect(rechazo({ opciones: [{ nombre: "A", importe: 0 }] })).toMatch(/mayor que cero/);
      expect(rechazo({ opciones: [{ nombre: "A", importe: null }] })).toMatch(/Falta el importe/);
      expect(rechazo({ opciones: [{ nombre: "A", importe: "mucho" }] })).toMatch(/no es un número válido/);
      expect(rechazo({ opciones: [{ nombre: "A", importe: 1e13 }] })).toMatch(/demasiado grande/);
      expect(rechazo({ respuesta: "SUMA", opciones: [{ nombre: "A", importe: -1 }] })).toMatch(/no puede ser negativo/);
      expect(guardComandoCrearGrupoEnElProducto(entrada({ respuesta: "SUMA", opciones: [{ nombre: "A", importe: 0 }, { nombre: "B", importe: 0.01 }] })).ok).toBe(true);
      expect(rechazo({ respuesta: "INCLUIDO", opciones: [{ nombre: "A", importe: 0 }] })).toMatch(/no lleva importe/);
      expect(guardComandoCrearGrupoEnElProducto(entrada({ respuesta: "INCLUIDO", opciones: [{ nombre: "A" }, { nombre: "B", importe: null }] })).ok).toBe(true);
    });

    it("las opciones: de 1 a MAX_OPCIONES_EN_UN_ALTA, con nombre y sin repetirse (sin distinguir mayúsculas)", () => {
      expect(rechazo({ opciones: [] })).toMatch(/al menos una opción/);
      expect(rechazo({ opciones: "no es una lista" })).toMatch(/al menos una opción/);
      expect(rechazo({ opciones: [{ nombre: "Simple", importe: 1 }, { nombre: "SIMPLE", importe: 2 }] })).toMatch(/dos opciones llamadas/);
      expect(rechazo({ opciones: [{ nombre: "", importe: 1 }] })).toMatch(/no puede estar vacío/);
      expect(rechazo({ opciones: ["Simple"] })).toMatch(/no es válida/);
      const muchas = (n: number) => Array.from({ length: n }, (_, i) => ({ nombre: `Opción ${i}`, importe: 100 }));
      expect(guardComandoCrearGrupoEnElProducto(entrada({ opciones: muchas(MAX_OPCIONES_EN_UN_ALTA) })).ok).toBe(true);
      expect(rechazo({ opciones: muchas(MAX_OPCIONES_EN_UN_ALTA + 1) })).toMatch(new RegExp(`no pueden ser más de ${MAX_OPCIONES_EN_UN_ALTA}`));
    });

    it("el producto, el nombre, la respuesta y el prefijo: lo mal formado se rechaza; el prefijo solo va en SUMA y PRECIO_FINAL", () => {
      expect(rechazo({ productoId: 7 })).toMatch(/No se encontró el producto/);
      expect(rechazo({ nombre: "" })).toMatch(/nombre del grupo/);
      expect(rechazo({ respuesta: "ADICIONAL" })).toMatch(/Elegí si el grupo cambia el precio/);
      expect(rechazo({ prefijoEnCarta: "x".repeat(21) })).toMatch(/hasta 20 caracteres/);
      expect(guardComandoCrearGrupoEnElProducto(entrada({ prefijoEnCarta: "De" })).ok).toBe(true);
      expect(rechazo({ respuesta: "INCLUIDO", prefijoEnCarta: "De", opciones: [{ nombre: "A" }] })).toMatch(/variante|medida/i);
    });
  });
});
