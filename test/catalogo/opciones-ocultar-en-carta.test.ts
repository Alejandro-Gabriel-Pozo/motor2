import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (patrón de `opciones-grupo-en-el-producto-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima llamada a `registrarCambioAuditado` tire,
 * DESPUÉS de que el caso de uso ya escribió. Sin el interruptor, delega en la implementación real.
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) throw new Error("auditoría caída (simulada)");
      return real.registrarCambioAuditado(...args);
    },
  };
});

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaSinEmpresa } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { azarDelProceso } from "../../src/lib/azar";
import { MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA } from "../../src/core/opciones/public";
import type { ComandoFijarAdmisionDeGrupo, OpcionAdmitidaEnComando } from "../../src/core/features/catalogo/opciones-de-venta.schema";
import { fijarAdmisionDeGrupoEnProducto, vincularGrupoEnProducto } from "../../src/server/actions/catalogo/opciones-de-venta";
import { agregarVersionDeOpcionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion";
import { crearOpcionEnElProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-opcion-en-el-producto";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import { vincularGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/vincular-grupo-en-producto";
import { cargarVistaPreviaDeLaCarta } from "../../src/server/consultas/carta/vista-previa-de-un-producto";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29: plato por plato), paso 4: el COMANDO. `fijarAdmisionDeGrupoEnProducto` acepta `seMuestraEnCarta` (opcional) y lo valida sobre el estado
 * RESULTANTE: solo una variante o una incluida, y ninguna opción ofrecida cambia el precio en el producto. Contra Postgres real, como `motor2_app`, con el bife del dueño (un producto de $20.000 con el grupo
 * «Corte»: «Ojo de bife» y «Bife de chorizo», sin recargo).
 *  - escritura: fila nueva y existente, auditoría por columna, sin el campo se conserva (I7), repetir no escribe ni audita (I1);
 *  - O6 (escritura): se acepta si y solo si el tipo es VARIANTE/INCLUIDA y el precio es neutro sobre el estado resultante (incluido «el producto lo deja en 0 sobre una versión con precio»); cargar un
 *    recargo en el MISMO formulario con el grupo oculto se rechaza (CU3);
 *  - O7: un precio posterior desde otro camino (la Biblioteca, una opción nueva) no se bloquea y no escribe en `ProductoAdmiteGrupo`; la carta vuelve a mostrar el grupo;
 *  - quitar y volver a vincular conserva el interruptor (CU7); los comandos sin el campo no lo pisan (I3);
 *  - permisos: la clave `producto_opciones_admitidas` se exige en el servidor, y `opciones_definir` sola no alcanza;
 *  - aislamiento entre empresas; auditoría atómica (si una fila de auditoría falla, no queda nada);
 *  - concurrencia real (C1 a C3, loop de 10).
 */
const ITERACIONES = 10;
const MENSAJE_OJO_CAMBIA = "Para ocultar «Corte» en la carta de «Bife», ninguna opción puede cambiar el precio: «Ojo de bife» cambia el precio. Dejala sin recargo o mostralo en la carta.";

describe("«Mostrar este grupo en la carta»: el comando de admisión del producto", () => {
  let e: EscenarioDeOpciones;
  let bifeId: string;
  let corteId: string;
  let ojoId: string;
  let chorizoId: string;
  let adminRolId: string;
  let operadorId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const op = (opcionId: string, extra: Partial<OpcionAdmitidaEnComando> = {}): OpcionAdmitidaEnComando => ({ opcionId, versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true, ...extra });
  const comando = (extra: Partial<ComandoFijarAdmisionDeGrupo> = {}): ComandoFijarAdmisionDeGrupo => ({
    productoId: bifeId,
    grupoId: corteId,
    versionEsperada: 0,
    orden: 0,
    cantidadMinima: null,
    cantidadMaxima: null,
    modoPrecio: null,
    activo: true,
    opciones: [op(ojoId), op(chorizoId)],
    ...extra,
  });
  const fila = () => prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: bifeId, grupoId: corteId } }, select: { id: true, seMuestraEnCarta: true, version: true, orden: true, activo: true } });
  const auditoriasDelInterruptor = async () => {
    const { id } = await fila();
    return prisma.registroAuditoria.findMany({ where: { entidad: "ProductoAdmiteGrupo", entidadId: id, campo: "seMuestraEnCarta" }, orderBy: { creadoEn: "asc" }, select: { valorAnterior: true, valorNuevo: true, actorId: true } });
  };
  const sinLaClave = (accionClave: string) => prisma.permisoRol.updateMany({ where: { rolId: adminRolId, accionClave }, data: { puedeEditar: false, puedeVer: false } });
  /** Lo que el comando puede escribir (para comprobar que un rechazo no deja nada). */
  const filas = async () => ({
    admisionesDeGrupo: await prisma.productoAdmiteGrupo.count(),
    admisionesDeOpcion: await prisma.productoAdmiteOpcion.count(),
    auditorias: await prisma.registroAuditoria.count(),
  });

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    bifeId = (await prisma.producto.create({ data: { codigo: "PV_BIFE", nombre: "Bife", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "20000.00" } })).id;
    corteId = (await prisma.grupoDeOpciones.create({ data: { nombre: "Corte", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
    const opcion = async (nombre: string, orden: number) => {
      const id = (await prisma.opcionDeGrupo.create({ data: { grupoId: corteId, nombre, orden } })).id;
      await prisma.versionDeOpcion.create({ data: { opcionId: id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: e.usuarioId } });
      return id;
    };
    ojoId = await opcion("Ojo de bife", 1);
    chorizoId = await opcion("Bife de chorizo", 2);
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    adminRolId = adminRol.id;
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  afterEach(() => {
    interruptor.fallarEnLlamada = null;
  });

  describe("escritura y auditoría", () => {
    it("ocultar al admitir el grupo: la fila nace con `seMuestraEnCarta = false` y la auditoría cuenta la columna (de nada a «false»)", async () => {
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      expect(r).toMatchObject({ ok: true, datos: { version: 1, huboCambio: true } });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false, version: 1, activo: true });
      expect(await auditoriasDelInterruptor()).toEqual([{ valorAnterior: null, valorNuevo: "false", actorId: e.usuarioId }]);
    });

    it("sin el campo, una fila nueva queda en «se muestra» y no se audita la columna (I7)", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
      expect(await fila()).toMatchObject({ seMuestraEnCarta: true });
      expect(await auditoriasDelInterruptor()).toEqual([]);
    });

    it("apagar y volver a prender una fila existente: sube la versión y audita el antes y el después (true → false → true)", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 1, seMuestraEnCarta: false, opciones: [] }))).toMatchObject({ ok: true, datos: { version: 2, huboCambio: true } });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false, version: 2 });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 2, seMuestraEnCarta: true, opciones: [] }))).toMatchObject({ ok: true, datos: { version: 3, huboCambio: true } });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: true, version: 3 });
      expect((await auditoriasDelInterruptor()).map((a) => [a.valorAnterior, a.valorNuevo])).toEqual([
        ["true", "false"],
        ["false", "true"],
      ]);
    });

    it("I1: el mismo comando dos veces (un doble clic) deja una sola fila de auditoría y la segunda no escribe", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
      const oculto = comando({ versionEsperada: 1, seMuestraEnCarta: false, opciones: [] });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), oculto)).toMatchObject({ ok: true, datos: { huboCambio: true } });
      const antes = await filas();
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), oculto)).toMatchObject({ ok: true, datos: { huboCambio: false } });
      expect(await filas()).toEqual(antes);
      expect(await auditoriasDelInterruptor()).toHaveLength(1);
      expect((await fila()).version).toBe(2);
    });

    it("I7: un comando sin el campo conserva lo guardado (cambiar el orden no vuelve a mostrar el grupo) y no audita la columna", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 1, orden: 5, opciones: [] }))).toMatchObject({ ok: true, datos: { huboCambio: true } });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false, orden: 5, version: 2 });
      expect(await auditoriasDelInterruptor()).toHaveLength(1);
    });

    it("la INCLUIDA («Viene con»: Azúcar) también se puede ocultar", async () => {
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoIncluidaId, seMuestraEnCarta: false, opciones: [op(e.azucarId)] }));
      expect(r).toMatchObject({ ok: true });
      expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: bifeId, grupoId: e.grupoIncluidaId } }, select: { seMuestraEnCarta: true } })).toEqual({ seMuestraEnCarta: false });
    });
  });

  describe("O6: se acepta si y solo si el tipo se puede ocultar y el precio es neutro sobre el estado resultante", () => {
    it("una opción con recargo en el producto (+$500 de «Ojo de bife»): se rechaza con el mensaje que nombra la opción, y no queda nada escrito", async () => {
      const antes = await filas();
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false, opciones: [op(ojoId, { diferencia: { tipo: "MONTO", monto: 500 } }), op(chorizoId)] }));
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OJO_CAMBIA });
      expect(await filas()).toEqual(antes);
    });

    it("un porcentaje también cambia el precio: se rechaza", async () => {
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false, opciones: [op(ojoId, { diferencia: { tipo: "PORCENTAJE", porcentaje: 5 } }), op(chorizoId)] }));
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OJO_CAMBIA });
    });

    it("un recargo en la VERSIÓN vigente de la opción (la Biblioteca) también cuenta, aunque el comando no traiga diferencia", async () => {
      await prisma.versionDeOpcion.create({ data: { opcionId: ojoId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "500.00", creadoPorId: e.usuarioId } });
      const antes = await filas();
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OJO_CAMBIA });
      expect(await filas()).toEqual(antes);
    });

    it("«el producto lo deja en 0 sobre una versión con precio» es neutro: se acepta (la diferencia del producto le gana a la de la versión)", async () => {
      await prisma.versionDeOpcion.create({ data: { opcionId: ojoId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "500.00", creadoPorId: e.usuarioId } });
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false, opciones: [op(ojoId, { diferencia: { tipo: "MONTO", monto: 0 } }), op(chorizoId)] }));
      expect(r).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
    });

    it("una opción con recargo que NO se ofrece (apagada en el producto) no impide ocultar", async () => {
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false, opciones: [op(ojoId, { diferencia: { tipo: "MONTO", monto: 500 }, activo: false }), op(chorizoId)] }));
      expect(r).toMatchObject({ ok: true });
    });

    it("un tamaño (MEDIDA) y un adicional no se pueden ocultar: «cambian el precio»", async () => {
      const antes = await filas();
      const medida = await fijarAdmisionDeGrupoEnProductoCasoDeUso(
        actor(),
        comando({ grupoId: e.grupoMedidaId, modoPrecio: "DIFERENCIA", seMuestraEnCarta: false, opciones: [op(e.chicoId), op(e.medianoId), op(e.grandeId)] })
      );
      expect(medida).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA });
      const adicional = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoAdicionalId, seMuestraEnCarta: false, cantidadMaxima: 3, opciones: [op(e.shotId, { cantidadMaxima: 3 })] }));
      expect(adicional).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA });
      expect(await filas()).toEqual(antes);
      // Prenderlo (o no mandar el campo) en esos tipos sí se puede: el interruptor «se muestra» es el de siempre.
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoAdicionalId, seMuestraEnCarta: true, cantidadMaxima: 3, opciones: [op(e.shotId, { cantidadMaxima: 3 })] }))).toMatchObject({ ok: true });
    });

    it("CU3: con el grupo ya oculto, cargar un recargo en el MISMO formulario (y mandar el campo apagado) se rechaza y la fila queda como estaba", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      const antes = { ...(await filas()), fila: await fila() };
      const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(
        actor(),
        comando({ versionEsperada: 1, seMuestraEnCarta: false, opciones: [op(ojoId, { versionEsperada: 1, diferencia: { tipo: "MONTO", monto: 2000 } })] })
      );
      expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA", mensaje: MENSAJE_OJO_CAMBIA });
      expect({ ...(await filas()), fila: await fila() }).toEqual(antes);
    });

    it("con la admisión apagada no se valida el precio (no hay nada que ocultar): se guarda sin efecto; el tipo sí se controla", async () => {
      await prisma.versionDeOpcion.create({ data: { opcionId: ojoId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "500.00", creadoPorId: e.usuarioId } });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ activo: false, seMuestraEnCarta: false, cantidadMinima: 0 }))).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false, activo: false });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoAdicionalId, activo: false, seMuestraEnCarta: false, opciones: [] }))).toMatchObject({ ok: false, mensaje: MENSAJE_OCULTAR_SOLO_VARIANTE_O_INCLUIDA });
    });
  });

  describe("O7 y CU4: un precio posterior desde otro camino no se bloquea ni escribe en `ProductoAdmiteGrupo`; la carta vuelve a mostrar el grupo", () => {
    const vistaPrevia = async () => cargarVistaPreviaDeLaCarta(prisma, e.sucursalA, { id: bifeId, precioVenta: 20000, esBase: false }, false);

    it("una versión nueva de «Ojo de bife» con +$500 desde la Biblioteca entra, deja la fila (versión, interruptor y auditoría) intacta, y la vista previa muestra el grupo de nuevo", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      expect(await vistaPrevia()).toEqual({ tipo: "forma", presentacion: { forma: "simple", aclaraciones: [] }, rotulos: [] });
      const antes = { fila: await fila(), auditorias: await prisma.registroAuditoria.count({ where: { entidad: "ProductoAdmiteGrupo" } }) };
      const v = await agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: ojoId, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 500 }, factorEscala: null, consumos: [] } });
      expect(v).toMatchObject({ ok: true });
      expect({ fila: await fila(), auditorias: await prisma.registroAuditoria.count({ where: { entidad: "ProductoAdmiteGrupo" } }) }, "no se escribió nada en lo que admite el producto").toEqual(antes);
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
      const despues = await vistaPrevia();
      expect(despues).toMatchObject({ tipo: "forma", presentacion: { forma: "lista", filas: [{ rotulo: "Ojo de bife", precio: 20500 }, { rotulo: "Bife de chorizo", precio: 20000 }] } });
    });

    it("una opción nueva con recargo en el grupo oculto («+ Opción»): entra sin tocar el interruptor (I3)", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      const antes = await fila();
      const r = await crearOpcionEnElProductoCasoDeUso(actor(), { productoId: bifeId, grupoId: corteId, versionEsperada: antes.version, nombre: "Lomo", importe: 700, unidadStockId: null }, azarDelProceso);
      expect(r).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
      expect(await auditoriasDelInterruptor()).toHaveLength(1);
    });
  });

  describe("CU7 e I3: quitar y volver a vincular conserva el interruptor; los comandos que no traen el campo no lo pisan", () => {
    it("quitar el grupo del producto y volver a vincularlo deja `seMuestraEnCarta = false` como estaba", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      const quitado = await vincularGrupoEnProductoCasoDeUso(actor(), { productoId: bifeId, grupoId: corteId, vinculado: false });
      expect(quitado).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ activo: false, seMuestraEnCarta: false });
      const vuelto = await vincularGrupoEnProductoCasoDeUso(actor(), { productoId: bifeId, grupoId: corteId, vinculado: true });
      expect(vuelto).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ activo: true, seMuestraEnCarta: false });
      expect(await auditoriasDelInterruptor()).toHaveLength(1);
    });

    it("«Agregar un grupo existente» (el comando sin el campo, sobre una fila apagada) no pisa el interruptor", async () => {
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }));
      await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 1, activo: false, opciones: [] }));
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 2, activo: true, opciones: [] }))).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ activo: true, seMuestraEnCarta: false });
    });
  });

  describe("permisos y forma del pedido (Server Action)", () => {
    const entrada = (extra: Record<string, unknown> = {}) => ({ ...comando({ seMuestraEnCarta: false }), ...extra });

    it("el operador (sin `producto_opciones_admitidas`) recibe el rechazo y no se escribe nada; el admin lo oculta", async () => {
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      const antes = await filas();
      const denegado = await fijarAdmisionDeGrupoEnProducto(entrada());
      expect(denegado.ok).toBe(false);
      expect(denegado.mensaje).toMatch(/producto_opciones_admitidas/);
      expect(await filas()).toEqual(antes);
      await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
      expect(await fijarAdmisionDeGrupoEnProducto(entrada())).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
    });

    it("la clave se exige en el servidor en cada envío: con solo `opciones_definir` (la de la Biblioteca) no alcanza", async () => {
      await sinLaClave("producto_opciones_admitidas");
      const antes = await filas();
      const r = await fijarAdmisionDeGrupoEnProducto(entrada());
      expect(r.ok).toBe(false);
      expect(r.mensaje).toMatch(/No tenés permiso/);
      expect(r.mensaje).toMatch(/producto_opciones_admitidas/);
      expect(await filas()).toEqual(antes);
    });

    it("el guard rechaza un valor que no es sí o no, sin escribir", async () => {
      const antes = await filas();
      expect(await fijarAdmisionDeGrupoEnProducto(entrada({ seMuestraEnCarta: "no" }))).toEqual({ ok: false, mensaje: "«Mostrar este grupo en la carta» tiene que ser sí o no." });
      expect(await filas()).toEqual(antes);
    });

    it("el vincular de la Server Action (clave de siempre) no cambia el interruptor", async () => {
      await fijarAdmisionDeGrupoEnProducto(entrada());
      expect(await vincularGrupoEnProducto({ productoId: bifeId, grupoId: corteId, vinculado: false })).toMatchObject({ ok: true });
      expect(await vincularGrupoEnProducto({ productoId: bifeId, grupoId: corteId, vinculado: true })).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
    });
  });

  describe("aislamiento entre empresas", () => {
    it("un producto de OTRA empresa no se encuentra: se rechaza sin tocar su fila (ni el interruptor ni la versión)", async () => {
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const unidad = await testigo.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const ajeno = await testigo.producto.create({ data: { codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidad.id } });
      const grupoAjeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
      const admision = await testigo.productoAdmiteGrupo.create({ data: { productoId: ajeno.id, grupoId: grupoAjeno.id } });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId: ajeno.id, grupoId: grupoAjeno.id, versionEsperada: 1, seMuestraEnCarta: false, opciones: [] }))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId: bifeId, grupoId: grupoAjeno.id, seMuestraEnCarta: false, opciones: [] }))).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
      expect(await testigo.productoAdmiteGrupo.findUniqueOrThrow({ where: { id: admision.id }, select: { seMuestraEnCarta: true, version: true } })).toEqual({ seMuestraEnCarta: true, version: 1 });
    });
  });

  describe("auditoría atómica", () => {
    it("si la auditoría falla en CUALQUIER llamada de «admitir y ocultar», no queda NADA (ni la fila, ni las opciones, ni una sola fila de auditoría)", async () => {
      const cuentas = filas;
      // Una corrida sana, sobre OTRO producto, cuenta cuántas llamadas a la auditoría hace el comando completo.
      const control = await prisma.producto.create({ data: { codigo: "PV_CONTROL", nombre: "Control", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "20000.00" } });
      interruptor.llamadas = 0;
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId: control.id, seMuestraEnCarta: false }))).toMatchObject({ ok: true });
      const total = interruptor.llamadas;
      expect(total, "audita la fila (orden, activo, el interruptor) y las dos opciones").toBeGreaterThan(5);
      const base = await cuentas();
      for (let k = 1; k <= total; k++) {
        interruptor.llamadas = 0;
        interruptor.fallarEnLlamada = k;
        await expect(fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false })), `llamada ${k} de ${total}`).rejects.toThrow("auditoría caída");
        expect(await cuentas(), `llamada ${k} de ${total}: quedó algo escrito`).toEqual(base);
      }
      interruptor.fallarEnLlamada = null;
      expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ seMuestraEnCarta: false }))).toMatchObject({ ok: true });
      expect(await fila()).toMatchObject({ seMuestraEnCarta: false });
    });
  });

  describe("concurrencia real (Postgres, loop de 10)", () => {
    it("C1: ocultar y cambiar el orden con la MISMA versión a la vez: una gana, la otra VERSION_DESACTUALIZADA, y la auditoría del interruptor es solo de la ganadora", async () => {
      const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
      intentos.mockClear();
      for (let i = 0; i < ITERACIONES; i++) {
        const productoId = (await prisma.producto.create({ data: { codigo: `PV_C1_${i}`, nombre: `Bife ${i}`, tipo: "PV", unidadStockId: e.unidadId, precioVenta: "20000.00" } })).id;
        await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId }));
        const [ocultar, ordenar] = await Promise.all([
          fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId, versionEsperada: 1, seMuestraEnCarta: false, opciones: [] })),
          fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId, versionEsperada: 1, orden: 7, opciones: [] })),
        ]);
        expect([ocultar, ordenar].filter((r) => r.ok), `vuelta ${i}: ${ocultar.mensaje} | ${ordenar.mensaje}`).toHaveLength(1);
        expect([ocultar, ordenar].filter((r) => !r.ok).map((r) => (r.ok ? "" : r.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
        const f = await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId, grupoId: corteId } } });
        expect(f.seMuestraEnCarta, `vuelta ${i}`).toBe(!ocultar.ok);
        expect(f.orden).toBe(ordenar.ok ? 7 : 0);
        expect(await prisma.registroAuditoria.count({ where: { entidad: "ProductoAdmiteGrupo", entidadId: f.id, campo: "seMuestraEnCarta" } }), `vuelta ${i}: auditoría solo de la ganadora`).toBe(ocultar.ok ? 1 : 0);
      }
      const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
      expect(transacciones, "en ninguna vuelta chocaron: el test no ejercitó SERIALIZABLE").toBeGreaterThan(2 * ITERACIONES);
      intentos.mockRestore();
    });

    it("C2: ocultar en paralelo con una versión nueva de «Ojo de bife» (+$500): o gana el ocultar y entra la versión (queda oculto con precio), o gana la versión y el ocultar se rechaza; la carta NUNCA oculta un grupo con un recargo", async () => {
      let ganoOcultar = 0;
      let ganoLaVersion = 0;
      for (let i = 0; i < ITERACIONES; i++) {
        const productoId = (await prisma.producto.create({ data: { codigo: `PV_C2_${i}`, nombre: `Bife ${i}`, tipo: "PV", unidadStockId: e.unidadId, precioVenta: "20000.00" } })).id;
        const ojo = (await prisma.opcionDeGrupo.create({ data: { grupoId: corteId, nombre: `Ojo ${i}`, orden: 10 + i } })).id;
        await prisma.versionDeOpcion.create({ data: { opcionId: ojo, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: e.usuarioId } });
        await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId, opciones: [op(ojo)] }));
        const demora = i % 2 === 0 ? 0 : 15 * i;
        const [ocultar, version] = await Promise.all([
          new Promise((r) => setTimeout(r, demora)).then(() => fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId, versionEsperada: 1, seMuestraEnCarta: false, opciones: [] }))),
          agregarVersionDeOpcionCasoDeUso(actor(), { opcionId: ojo, numeroEsperado: 1, version: { diferencia: { tipo: "MONTO", monto: 500 }, factorEscala: null, consumos: [] } }),
        ]);
        expect(version.ok, `vuelta ${i}: ${version.mensaje}`).toBe(true);
        if (!ocultar.ok) expect(ocultar, `vuelta ${i}`).toMatchObject({ codigo: "CONFIGURACION_INVALIDA" });
        if (ocultar.ok) ganoOcultar++;
        else ganoLaVersion++;
        const f = await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId, grupoId: corteId } } });
        expect(f.seMuestraEnCarta, `vuelta ${i}`).toBe(!ocultar.ok);
        // Pase lo que pase, la carta muestra el grupo: hay un recargo vigente y el interruptor no lo oculta (I2).
        const vista = await cargarVistaPreviaDeLaCarta(prisma, e.sucursalA, { id: productoId, precioVenta: 20000, esBase: false }, false);
        expect(JSON.stringify(vista), `vuelta ${i}: el grupo con recargo falta en la carta`).toContain("20500");
      }
      expect(ganoOcultar + ganoLaVersion).toBe(ITERACIONES);
    });

    it("C3: ocultar en paralelo con quitar el grupo del producto: en serie o VERSION_DESACTUALIZADA; el quitar NUNCA se pierde y, al volver a vincular, el interruptor es el que quedó", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const productoId = (await prisma.producto.create({ data: { codigo: `PV_C3_${i}`, nombre: `Bife ${i}`, tipo: "PV", unidadStockId: e.unidadId, precioVenta: "20000.00" } })).id;
        await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId }));
        const [ocultar, quitar] = await Promise.allSettled([
          fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId, versionEsperada: 1, seMuestraEnCarta: false, opciones: [] })),
          vincularGrupoEnProductoCasoDeUso(actor(), { productoId, grupoId: corteId, vinculado: false }),
        ]);
        expect(quitar.status === "fulfilled" && quitar.value.ok, `vuelta ${i}`).toBe(true);
        expect(ocultar.status, `vuelta ${i}`).toBe("fulfilled");
        const ocultoOk = ocultar.status === "fulfilled" && ocultar.value.ok;
        if (ocultar.status === "fulfilled" && !ocultar.value.ok) expect(ocultar.value.codigo, `vuelta ${i}`).toBe("VERSION_DESACTUALIZADA");
        const donde = { productoId_grupoId: { productoId, grupoId: corteId } };
        const quitado = await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: donde });
        expect(quitado.activo, `vuelta ${i}: el ocultar pisó el «quitar»`).toBe(false);
        expect(quitado.seMuestraEnCarta, `vuelta ${i}`).toBe(!ocultoOk);
        expect(await vincularGrupoEnProductoCasoDeUso(actor(), { productoId, grupoId: corteId, vinculado: true })).toMatchObject({ ok: true });
        expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: donde }), `vuelta ${i}: al volver a vincular se conserva el valor`).toMatchObject({ activo: true, seMuestraEnCarta: !ocultoOk });
      }
    });
  });
});
