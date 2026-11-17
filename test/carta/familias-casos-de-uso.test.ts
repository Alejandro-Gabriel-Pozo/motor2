import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));
// Para forzar una falla A MITAD de camino (atomicidad): envuelve el escritor de la auditoría con el original por defecto y deja que un test lo haga fallar.
vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importar) => {
  const real = await importar<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return { ...real, registrarCambioAuditado: vi.fn(real.registrarCambioAuditado) };
});

import { DATOS_EMPRESA_TESTIGO, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { agregarOpcionItemAgrupadoCartaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-opcion-item-agrupado-carta";
import { agregarProductoAFamiliaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/agregar-producto-a-familia";
import { crearFamiliaDeProductoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/crear-familia-de-producto";
import { editarFamiliaDeProductoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/editar-familia-de-producto";
import { fijarActivaFamiliaDeProductoCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/fijar-activa-familia-de-producto";
import { quitarProductoDeFamiliaCasoDeUso } from "../../src/server/actions/carta/casos-de-uso/quitar-producto-de-familia";
import { agregarProductoAFamilia, crearFamiliaDeProducto, editarFamiliaDeProducto, fijarActivaFamiliaDeProducto, quitarProductoDeFamilia } from "../../src/server/actions/carta/secciones";
import { registrarCambioAuditado } from "../../src/server/auditoria/registrar-cambio-auditado";
import { consultarFichaDeFamilia, listarFamiliasDeProducto } from "../../src/server/lecturas/carta/familias";
import { aceptar } from "../../src/core/datos/resultado";

/**
 * Etapa F1 (docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md, niveles 7 y 10): las familias de productos contra Postgres real como `motor2_app`. Concurrencia (gana uno), idempotencia (escribe y audita una sola vez),
 * atomicidad (una falla a mitad no deja nada), aislamiento (otra empresa responde «no encontrada»), permisos (el operador no; el administrador y el gerente sí) y el cruce transitorio con el ítem agrupado (la familia
 * reemplaza al ítem agrupado: un producto no está en los dos a la vez; la base lo exige aunque se saltee el caso de uso).
 */
const ITERACIONES = Number(process.env.MOTOR2_VUELTAS_DE_FAMILIAS ?? 10);
const uuid = () => crypto.randomUUID();

describe("familias de productos (etapa F1)", () => {
  let sucursalA: string;
  let usuarioId: string;
  let operadorId: string;
  let rolAdminId: string;
  let unidadId: string;
  let seccionId: string;
  const actor = () => actorDePrueba(usuarioId, sucursalA);
  let n = 0;
  const pv = async (nombre: string) => (await sembrarProductoDisponible({ codigo: `PV_${++n}_${nombre.replace(/\W/g, "_").toUpperCase()}`, nombre, tipo: "PV", unidadStockId: unidadId, precioVenta: 1000 }, sucursalA)).id;
  const crear = async (nombre: string) => {
    const id = uuid();
    const r = await crearFamiliaDeProductoCasoDeUso(actor(), { id, nombre });
    expect(r, nombre).toMatchObject({ ok: true });
    return id;
  };
  const agregar = (familiaId: string, productoId: string, miembroId = uuid()) => agregarProductoAFamiliaCasoDeUso(actor(), { miembroId, familiaId, productoId });
  const familia = (id: string) => prisma.familiaDeProducto.findUniqueOrThrow({ where: { id } });
  const vigentes = (familiaId: string) => prisma.miembroDeFamilia.findMany({ where: { familiaId, quitadoEn: null }, orderBy: { posicion: "asc" } });
  const auditorias = (entidad: "FamiliaDeProducto" | "MiembroDeFamilia") => prisma.registroAuditoria.count({ where: { entidad } });
  const resumen = (rs: PromiseSettledResult<{ ok: boolean; codigo?: string }>[]) => rs.map((r) => (r.status === "fulfilled" ? (r.value.ok ? "ok" : (r.value.codigo as string)) : `error:${String(r.reason)}`)).sort();

  beforeEach(async () => {
    vi.mocked(registrarCambioAuditado).mockClear();
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalA = base.sucursal.id;
    usuarioId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalA, rolId: base.admin.id })).id;
    rolAdminId = base.admin.id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: sucursalA, rolId: base.operador.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    seccionId = (await prisma.seccionCarta.create({ data: { nombre: "Bebidas", orden: 1 } })).id;
  });

  describe("crear", () => {
    it("nace con los dos interruptores APAGADOS, activa, versión 1 y sin miembros, con su auditoría; el nombre repetido (sin distinguir mayúsculas; los acentos distinguen, como Pedernal) se rechaza", async () => {
      const id = await crear("Gaseosas");
      expect(await familia(id)).toMatchObject({ nombre: "Gaseosas", nombreClave: "gaseosas", agruparEnCarta: false, agruparEnPos: false, activa: true, version: 1, creadoPorId: usuarioId });
      expect(await vigentes(id)).toEqual([]);
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "FamiliaDeProducto" } })).toMatchObject({ entidadId: id, campo: "nombre", valorAnterior: null, valorNuevo: "Gaseosas", actorId: usuarioId, sucursalId: null });
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "GASEOSAS" })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      await crear("Café");
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "CAFÉ" })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "Cafe" })).toMatchObject({ ok: true });
      expect(await prisma.familiaDeProducto.count()).toBe(3);
    });

    it("IDEMPOTENCIA: el mismo id y el mismo nombre → «yaExistia» sin escribir ni auditar; el mismo id con otro nombre → ID_REUTILIZADO y no pisa nada", async () => {
      const id = uuid();
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id, nombre: "Gaseosas" })).toMatchObject({ ok: true, datos: { yaExistia: false } });
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id, nombre: "Gaseosas" })).toMatchObject({ ok: true, datos: { yaExistia: true } });
      expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id, nombre: "Otro nombre" })).toMatchObject({ ok: false, codigo: "ID_REUTILIZADO" });
      expect(await prisma.familiaDeProducto.count()).toBe(1);
      expect((await familia(id)).nombre).toBe("Gaseosas");
      expect(await auditorias("FamiliaDeProducto")).toBe(1);
    });

    it(`concurrencia real (${ITERACIONES} vueltas, Promise.allSettled): dos altas con el mismo nombre a la vez → gana una (una fila y una auditoría) y la otra NOMBRE_REPETIDO`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.familiaDeProducto.deleteMany({});
        await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "FamiliaDeProducto" } });
        const dos = await Promise.allSettled([crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "Gaseosas" }), crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "gaseosas" })]);
        expect(resumen(dos), `vuelta ${i}`).toEqual(["NOMBRE_REPETIDO", "ok"]);
        expect(await prisma.familiaDeProducto.count(), `vuelta ${i}`).toBe(1);
        expect(await auditorias("FamiliaDeProducto"), `vuelta ${i}`).toBe(1);
      }
    }, 120_000);
  });

  describe("editar", () => {
    it("cambia el nombre y los interruptores contra la versión vista (sube la versión), con una auditoría por dato que cambió; el mismo estado → «yaEstaba» sin escribir ni auditar", async () => {
      const id = await crear("Gaseosas");
      const antes = await auditorias("FamiliaDeProducto");
      const r = await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, nombre: "Gaseosas y aguas", agruparEnCarta: true, agruparEnPos: false });
      expect(r).toMatchObject({ ok: true, datos: { yaEstaba: false } });
      expect(await familia(id)).toMatchObject({ nombre: "Gaseosas y aguas", nombreClave: "gaseosas y aguas", agruparEnCarta: true, agruparEnPos: false, version: 2 });
      expect((await auditorias("FamiliaDeProducto")) - antes).toBe(2); // nombre y agruparEnCarta; agruparEnPos no cambió
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "FamiliaDeProducto", campo: "agruparEnCarta" } })).toMatchObject({ valorAnterior: "false", valorNuevo: "true", sucursalId: null });
      // Repetirlo (doble clic: ya con la versión vieja): éxito sin escribir ni auditar.
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, nombre: "Gaseosas y aguas", agruparEnCarta: true, agruparEnPos: false })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
      expect((await familia(id)).version).toBe(2);
      expect((await auditorias("FamiliaDeProducto")) - antes).toBe(2);
    });

    it("una versión vieja se rechaza (VERSION_DESACTUALIZADA) y no cambia nada; un nombre repetido, vacío o sin una letra también", async () => {
      const id = await crear("Gaseosas");
      await crear("Cafés");
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, nombre: "Gaseosas", agruparEnCarta: true, agruparEnPos: true })).toMatchObject({ ok: true });
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, nombre: "Otro", agruparEnCarta: false, agruparEnPos: false })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 2, nombre: "CAFÉS", agruparEnCarta: true, agruparEnPos: true })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 2, nombre: "12", agruparEnCarta: true, agruparEnPos: true })).toMatchObject({ ok: false, codigo: "DATO_INVALIDO" });
      expect(await familia(id)).toMatchObject({ nombre: "Gaseosas", agruparEnCarta: true, agruparEnPos: true, version: 2 });
      // Cambiar solo las mayúsculas del propio nombre sí se puede (la clave es la misma, pero es la misma familia).
      expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 2, nombre: "GASEOSAS", agruparEnCarta: true, agruparEnPos: true })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
    });

    it(`concurrencia real (${ITERACIONES} vueltas): dos ediciones con la MISMA versión a la vez → gana una y la otra VERSION_DESACTUALIZADA (o ve ya el estado nuevo); nunca las dos`, async () => {
      const id = await crear("Gaseosas");
      for (let i = 0; i < ITERACIONES; i++) {
        const v = (await familia(id)).version;
        const dos = await Promise.allSettled([
          editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: v, nombre: `Gaseosas A${i}`, agruparEnCarta: true, agruparEnPos: false }),
          editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: v, nombre: `Gaseosas B${i}`, agruparEnCarta: false, agruparEnPos: true }),
        ]);
        expect(resumen(dos), `vuelta ${i}`).toEqual(["VERSION_DESACTUALIZADA", "ok"]);
        expect((await familia(id)).version, `vuelta ${i}`).toBe(v + 1);
      }
    }, 120_000);
  });

  describe("desactivar y reactivar", () => {
    it("por estado deseado: desactivar sube la versión y audita; repetir no escribe; con versión vieja se rechaza; sus miembros SIGUEN siéndolo", async () => {
      const id = await crear("Gaseosas");
      const p = await pv("Coca");
      expect(await agregar(id, p)).toMatchObject({ ok: true });
      expect(await fijarActivaFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, activa: false })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
      expect(await familia(id)).toMatchObject({ activa: false, version: 2 });
      expect(await vigentes(id)).toHaveLength(1);
      const audit = await auditorias("FamiliaDeProducto");
      expect(await fijarActivaFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 2, activa: false })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
      expect(await auditorias("FamiliaDeProducto")).toBe(audit);
      expect(await fijarActivaFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 1, activa: true })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await fijarActivaFamiliaDeProductoCasoDeUso(actor(), { familiaId: id, versionEsperada: 2, activa: true })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
      expect(await familia(id)).toMatchObject({ activa: true, version: 3 });
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "FamiliaDeProducto", campo: "activa", valorNuevo: "false" } })).toMatchObject({ valorAnterior: "true", actorId: usuarioId });
    });
  });

  describe("agregar un producto", () => {
    it("solo un producto de VENTA (una materia prima, un producto que no existe o de otra empresa: «no encontrado»); la posición es máximo + 1; repetir → «yaEstaba» sin escribir ni auditar", async () => {
      const id = await crear("Gaseosas");
      const mp = (await prisma.producto.create({ data: { codigo: "MP_X", nombre: "Harina", tipo: "MP", unidadStockId: unidadId } })).id;
      expect(await agregar(id, mp)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
      expect(await agregar(id, "no-existe")).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
      const coca = await pv("Coca");
      const sprite = await pv("Sprite");
      expect(await agregar(id, coca)).toMatchObject({ ok: true, datos: { yaEstaba: false, posicion: 1 } });
      expect(await agregar(id, sprite)).toMatchObject({ ok: true, datos: { yaEstaba: false, posicion: 2 } });
      const audit = await auditorias("MiembroDeFamilia");
      expect(audit).toBe(2);
      expect(await agregar(id, coca)).toMatchObject({ ok: true, datos: { yaEstaba: true, posicion: 1 } });
      expect(await auditorias("MiembroDeFamilia")).toBe(2);
      expect(await prisma.miembroDeFamilia.count()).toBe(2);
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "MiembroDeFamilia" }, orderBy: { creadoEn: "asc" } })).toMatchObject({ entidadId: `${id}:${coca}`, campo: "miembro", valorAnterior: null, valorNuevo: "true", sucursalId: null });
    });

    it("un producto está en UNA sola familia a la vez: la segunda rechaza con un mensaje GENÉRICO (no dice cuál); quitado de la primera, puede ir a la segunda", async () => {
      const a = await crear("Gaseosas");
      const b = await crear("Aguas");
      const coca = await pv("Coca");
      await agregar(a, coca);
      const r = await agregar(b, coca);
      expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_EN_OTRA_FAMILIA" });
      expect(r.mensaje).not.toContain("Gaseosas");
      expect(await vigentes(b)).toEqual([]);
      expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: a, productoId: coca, versionEsperada: 1 })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
      expect(await agregar(b, coca)).toMatchObject({ ok: true, datos: { posicion: 1 } });
    });

    it("el mismo id de miembro con otro contenido → ID_REUTILIZADO; un producto en un ítem agrupado (activo o no) → PRODUCTO_YA_AGRUPADO, sin escribir nada", async () => {
      const id = await crear("Gaseosas");
      const coca = await pv("Coca");
      const sprite = await pv("Sprite");
      const miembroId = uuid();
      expect(await agregar(id, coca, miembroId)).toMatchObject({ ok: true });
      expect(await agregar(id, sprite, miembroId)).toMatchObject({ ok: false, codigo: "ID_REUTILIZADO" });

      const fanta = await pv("Fanta");
      const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosa 500", seccionCartaId: seccionId, activo: false } });
      await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalA, itemAgrupadoCartaId: item.id, productoId: fanta } });
      const r = await agregar(id, fanta);
      expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_YA_AGRUPADO" });
      expect(await vigentes(id)).toHaveLength(1);
      expect(await auditorias("MiembroDeFamilia")).toBe(1);
    });

    it("un ítem agrupado de OTRA sucursal (que el alcance de quien actúa no ve) también bloquea: lo rechaza la base con su disparador y el caso de uso lo traduce a PRODUCTO_YA_AGRUPADO, sin escribir nada", async () => {
      const id = await crear("Gaseosas");
      const sucursalB = (await prisma.sucursal.create({ data: { nombre: "Norte" } })).id;
      const fanta = await pv("Fanta");
      const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalB, nombre: "Gaseosa 500", seccionCartaId: seccionId } });
      await prisma.opcionItemAgrupadoCarta.create({ data: { sucursalId: sucursalB, itemAgrupadoCartaId: item.id, productoId: fanta } });
      // El actor solo ve la sucursal A: el chequeo amable no lo encuentra, y la base sí.
      expect(await actor().db.opcionItemAgrupadoCarta.count({ where: { productoId: fanta } })).toBe(0);
      const r = await agregar(id, fanta);
      expect(r).toMatchObject({ ok: false, codigo: "PRODUCTO_YA_AGRUPADO" });
      expect(await prisma.miembroDeFamilia.count()).toBe(0);
      expect(await auditorias("MiembroDeFamilia")).toBe(0);
    });

    it(`concurrencia real (${ITERACIONES} vueltas): dos agregan el MISMO producto a familias DISTINTAS → gana una y la otra PRODUCTO_EN_OTRA_FAMILIA; el producto queda en una sola`, async () => {
      const a = await crear("Gaseosas");
      const b = await crear("Aguas");
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.miembroDeFamilia.deleteMany({});
        await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "MiembroDeFamilia" } });
        const p = await pv(`Producto ${i}`);
        const dos = await Promise.allSettled([agregar(a, p), agregar(b, p)]);
        expect(resumen(dos), `vuelta ${i}`).toEqual(["PRODUCTO_EN_OTRA_FAMILIA", "ok"]);
        expect(await prisma.miembroDeFamilia.count({ where: { productoId: p, quitadoEn: null } }), `vuelta ${i}`).toBe(1);
        expect(await auditorias("MiembroDeFamilia"), `vuelta ${i}`).toBe(1);
      }
    }, 180_000);

    it(`concurrencia real (${ITERACIONES} vueltas): dos altas de productos distintos a la MISMA familia reciben posiciones DISTINTAS`, async () => {
      const id = await crear("Gaseosas");
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.miembroDeFamilia.deleteMany({});
        const [p1, p2] = [await pv(`Uno ${i}`), await pv(`Dos ${i}`)];
        const dos = await Promise.allSettled([agregar(id, p1), agregar(id, p2)]);
        expect(resumen(dos), `vuelta ${i}`).toEqual(["ok", "ok"]);
        expect((await vigentes(id)).map((m) => m.posicion), `vuelta ${i}`).toEqual([1, 2]);
      }
    }, 180_000);

    it("ATOMICIDAD: una falla forzada DESPUÉS de insertar el miembro y ANTES de la auditoría no deja el miembro (todo o nada); el reintento sin falla sale bien", async () => {
      const id = await crear("Gaseosas");
      const coca = await pv("Coca");
      const original = vi.mocked(registrarCambioAuditado).getMockImplementation()!;
      vi.mocked(registrarCambioAuditado).mockImplementation(async () => {
        throw new Error("falla forzada a mitad de camino");
      });
      try {
        await expect(agregar(id, coca)).rejects.toThrow("falla forzada");
      } finally {
        vi.mocked(registrarCambioAuditado).mockImplementation(original);
      }
      expect(await prisma.miembroDeFamilia.count()).toBe(0);
      expect(await auditorias("MiembroDeFamilia")).toBe(0);
      expect(await agregar(id, coca)).toMatchObject({ ok: true, datos: { yaEstaba: false } });
    });
  });

  describe("quitar un producto", () => {
    it("quitar NO borra: escribe quién y cuándo; repetir → «yaEstaba» sin auditar; una versión vieja se rechaza; volver a agregar es una fila NUEVA", async () => {
      const id = await crear("Gaseosas");
      const coca = await pv("Coca");
      const primero = await agregar(id, coca);
      expect(primero).toMatchObject({ ok: true });
      expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: coca, versionEsperada: 7 })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await vigentes(id)).toHaveLength(1);
      expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: coca, versionEsperada: 1 })).toMatchObject({ ok: true, datos: { yaEstaba: false } });
      const filas = await prisma.miembroDeFamilia.findMany({ where: { familiaId: id } });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ productoId: coca, quitadoPorId: usuarioId });
      expect(filas[0].quitadoEn).not.toBeNull();
      expect(await prisma.registroAuditoria.findFirstOrThrow({ where: { entidad: "MiembroDeFamilia", valorNuevo: "false" } })).toMatchObject({ entidadId: `${id}:${coca}`, valorAnterior: "true" });
      const audit = await auditorias("MiembroDeFamilia");
      expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: coca, versionEsperada: 1 })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
      expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: "no-es-miembro", versionEsperada: 1 })).toMatchObject({ ok: true, datos: { yaEstaba: true } });
      expect(await auditorias("MiembroDeFamilia")).toBe(audit);
      // Volver a agregarlo: fila NUEVA (la quitada queda como historia).
      expect(await agregar(id, coca)).toMatchObject({ ok: true, datos: { yaEstaba: false, posicion: 1 } });
      expect(await prisma.miembroDeFamilia.count({ where: { familiaId: id } })).toBe(2);
    });

    it(`concurrencia real (${ITERACIONES} vueltas): dos «quitar» a la vez del mismo producto → uno quita y audita, el otro ve «yaEstaba»`, async () => {
      const id = await crear("Gaseosas");
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.miembroDeFamilia.deleteMany({});
        await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "MiembroDeFamilia" } });
        const p = await pv(`Producto ${i}`);
        await agregar(id, p);
        await prismaAdmin.registroAuditoria.deleteMany({ where: { entidad: "MiembroDeFamilia" } });
        const dos = await Promise.allSettled([
          quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: p, versionEsperada: 1 }),
          quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: p, versionEsperada: 1 }),
        ]);
        const yaEstaba = dos.map((r) => (r.status === "fulfilled" && r.value.ok ? String(r.value.datos.yaEstaba) : `error:${JSON.stringify(r)}`)).sort();
        expect(yaEstaba, `vuelta ${i}`).toEqual(["false", "true"]);
        expect(await auditorias("MiembroDeFamilia"), `vuelta ${i}`).toBe(1);
      }
    }, 120_000);
  });

  describe("el cruce TRANSITORIO con el ítem agrupado (la familia reemplaza al ítem agrupado)", () => {
    const agrupar = async (productoId: string, itemId?: string) => {
      const item = itemId ?? (await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: `Item ${++n}`, seccionCartaId: seccionId } })).id;
      return { item, r: await agregarOpcionItemAgrupadoCartaCasoDeUso(actor(), { itemAgrupadoCartaId: item, productoId, orden: aceptar({ orden: null }) }) };
    };

    it("agregar a un ítem agrupado un producto que es miembro VIGENTE de una familia → YA_EN_FAMILIA y no escribe; quitado de la familia, sí se puede", async () => {
      const id = await crear("Gaseosas");
      const coca = await pv("Coca");
      await agregar(id, coca);
      const { item, r } = await agrupar(coca);
      expect(r).toMatchObject({ ok: false, codigo: "YA_EN_FAMILIA" });
      expect(r.mensaje).not.toContain("Gaseosas");
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(0);
      await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: coca, versionEsperada: 1 });
      expect((await agrupar(coca, item)).r).toMatchObject({ ok: true });
      expect(await prisma.opcionItemAgrupadoCarta.count()).toBe(1);
      // Y ahora, al revés: ya agrupado, no entra a la familia.
      expect(await agregar(id, coca)).toMatchObject({ ok: false, codigo: "PRODUCTO_YA_AGRUPADO" });
    });

    it(`concurrencia real (${ITERACIONES} vueltas): las DOS altas opuestas a la vez (a la familia y al ítem agrupado) del mismo producto → EXACTAMENTE una gana; nunca queda en los dos lados`, async () => {
      const id = await crear("Gaseosas");
      const item = await prisma.itemAgrupadoCarta.create({ data: { sucursalId: sucursalA, nombre: "Gaseosa 500", seccionCartaId: seccionId } });
      const ganadores = { familia: 0, agrupado: 0 };
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.opcionItemAgrupadoCarta.deleteMany({});
        await prismaAdmin.miembroDeFamilia.deleteMany({});
        const p = await pv(`Producto ${i}`);
        const dos = await Promise.allSettled([agregar(id, p), agrupar(p, item.id).then((x) => x.r)]);
        const ok = dos.filter((r) => r.status === "fulfilled" && r.value.ok).length;
        expect(dos.every((r) => r.status === "fulfilled"), `vuelta ${i}: ${JSON.stringify(dos)}`).toBe(true);
        expect(ok, `vuelta ${i}: ${JSON.stringify(dos)}`).toBe(1);
        const enFamilia = await prisma.miembroDeFamilia.count({ where: { productoId: p, quitadoEn: null } });
        const enAgrupado = await prisma.opcionItemAgrupadoCarta.count({ where: { productoId: p } });
        expect([enFamilia, enAgrupado].sort(), `vuelta ${i}`).toEqual([0, 1]);
        if (enFamilia === 1) ganadores.familia++;
        else ganadores.agrupado++;
      }
      // Informativo: quién ganó cada vuelta (no se exige un reparto).
      expect(ganadores.familia + ganadores.agrupado).toBe(ITERACIONES);
    }, 180_000);
  });

  describe("aislamiento entre empresas", () => {
    it("una familia o un producto de OTRA empresa responden «no encontrado» (como si no existieran); la lista y la ficha no los ven", async () => {
      await prismaAdmin.empresa.upsert({ where: { id: EMPRESA_TESTIGO_ID }, update: { estado: "ACTIVE" }, create: DATOS_EMPRESA_TESTIGO });
      const unidadAjena = await prismaAdmin.unidad.create({ data: { empresaId: EMPRESA_TESTIGO_ID, nombre: "u", magnitud: "CANTIDAD", decimales: 0 } });
      const productoAjeno = await prismaAdmin.producto.create({ data: { empresaId: EMPRESA_TESTIGO_ID, codigo: "PV_AJENO", nombre: "Ajeno", tipo: "PV", unidadStockId: unidadAjena.id } });
      const familiaAjena = await prismaAdmin.familiaDeProducto.create({ data: { id: uuid(), empresaId: EMPRESA_TESTIGO_ID, nombre: "Ajena", nombreClave: "ajena", creadoPorId: usuarioId, actualizadoEn: new Date() } });
      try {
        const propia = await crear("Propia");
        expect(await agregar(familiaAjena.id, await pv("Coca"))).toMatchObject({ ok: false, codigo: "FAMILIA_NO_ENCONTRADA" });
        expect(await agregar(propia, productoAjeno.id)).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
        expect(await editarFamiliaDeProductoCasoDeUso(actor(), { familiaId: familiaAjena.id, versionEsperada: 1, nombre: "Pisada", agruparEnCarta: true, agruparEnPos: true })).toMatchObject({ ok: false, codigo: "FAMILIA_NO_ENCONTRADA" });
        expect(await fijarActivaFamiliaDeProductoCasoDeUso(actor(), { familiaId: familiaAjena.id, versionEsperada: 1, activa: false })).toMatchObject({ ok: false, codigo: "FAMILIA_NO_ENCONTRADA" });
        expect(await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: familiaAjena.id, productoId: productoAjeno.id, versionEsperada: 1 })).toMatchObject({ ok: false, codigo: "FAMILIA_NO_ENCONTRADA" });
        // El mismo nombre en otra empresa no choca: la unicidad es por empresa.
        expect(await crearFamiliaDeProductoCasoDeUso(actor(), { id: uuid(), nombre: "Ajena" })).toMatchObject({ ok: true });
        expect((await listarFamiliasDeProducto(actor().db)).map((f) => f.nombre).sort()).toEqual(["Ajena", "Propia"]);
        expect(await consultarFichaDeFamilia(actor().db, { sucursalId: sucursalA, familiaId: familiaAjena.id })).toBeNull();
        expect(await prismaAdmin.familiaDeProducto.findUniqueOrThrow({ where: { id: familiaAjena.id } })).toMatchObject({ nombre: "Ajena", version: 1, activa: true, agruparEnCarta: false });
      } finally {
        await prismaAdmin.miembroDeFamilia.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.familiaDeProducto.deleteMany({ where: { empresaId: EMPRESA_TESTIGO_ID } });
        await prismaAdmin.producto.delete({ where: { id: productoAjeno.id } });
        await prismaAdmin.unidad.delete({ where: { id: unidadAjena.id } });
      }
    });
  });

  describe("la consulta de gestión", () => {
    it("la lista cuenta solo los miembros vigentes; la ficha trae los miembros por posición con sus banderas (desactivado, oculto, sin medidas) de la sucursal activa", async () => {
      const id = await crear("Gaseosas");
      const otra = await crear("Aguas");
      const coca = await pv("Coca");
      const sprite = await pv("Sprite");
      const fanta = await pv("Fanta");
      for (const p of [coca, sprite, fanta]) await agregar(id, p);
      await quitarProductoDeFamiliaCasoDeUso(actor(), { familiaId: id, productoId: fanta, versionEsperada: 1 });
      expect((await listarFamiliasDeProducto(actor().db)).map((f) => [f.nombre, f.miembrosVigentes, f.version, f.activa])).toEqual([["Aguas", 0, 1, true], ["Gaseosas", 2, 1, true]]);
      expect(otra).toBeTruthy();

      await prisma.disponibilidadProducto.updateMany({ where: { productoId: sprite, sucursalId: sucursalA }, data: { disponible: false } });
      await prisma.ocultamientoProducto.create({ data: { id: uuid(), productoId: coca, sucursalId: sucursalA, oculto: true, actualizadoPorId: usuarioId, actualizadoEn: new Date() } });
      const grupo = await prisma.grupoDeOpciones.create({ data: { nombre: "Medida", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1 } });
      await prisma.productoAdmiteGrupo.create({ data: { productoId: sprite, grupoId: grupo.id } });
      const ficha = await consultarFichaDeFamilia(actor().db, { sucursalId: sucursalA, familiaId: id });
      expect(ficha).toMatchObject({ nombre: "Gaseosas", version: 1, miembrosVigentes: 2 });
      expect(ficha!.miembros).toEqual([
        { productoId: coca, nombre: "Coca", posicion: 1, desactivado: false, oculto: true, sinMedidas: true },
        { productoId: sprite, nombre: "Sprite", posicion: 2, desactivado: true, oculto: false, sinMedidas: false },
      ]);
    });
  });

  describe("las Server Actions", () => {
    const ordenCompleto = async () => {
      const id = await crear("Gaseosas");
      const p = await pv("Coca");
      return { id, p };
    };
    /** Los cinco comandos con datos válidos de forma, para recorrerlos con cada persona. */
    const comandos = (id: string, p: string): Record<string, () => Promise<{ ok: boolean }>> => {
      const version = async () => (await familia(id)).version;
      return {
        crearFamiliaDeProducto: () => crearFamiliaDeProducto({ nombre: "Nueva" }),
        editarFamiliaDeProducto: async () => editarFamiliaDeProducto({ familiaId: id, versionEsperada: await version(), nombre: "Editada", agruparEnCarta: true, agruparEnPos: false }),
        fijarActivaFamiliaDeProducto: async () => fijarActivaFamiliaDeProducto({ familiaId: id, versionEsperada: await version(), activa: false }),
        agregarProductoAFamilia: () => agregarProductoAFamilia({ familiaId: id, productoId: p }),
        quitarProductoDeFamilia: async () => quitarProductoDeFamilia({ familiaId: id, productoId: p, versionEsperada: await version() }),
      };
    };

    it("el OPERADOR es rechazado en CADA comando y no escribe nada ni audita; el administrador puede en todos", async () => {
      const { id, p } = await ordenCompleto();
      await agregar(id, p);
      const auditoriasAntes = await prisma.registroAuditoria.count();
      const familiasAntes = await prisma.familiaDeProducto.findMany({ orderBy: { id: "asc" } });
      const miembrosAntes = await prisma.miembroDeFamilia.findMany();
      await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
      for (const [nombre, correr] of Object.entries(comandos(id, p))) expect((await correr()).ok, `el operador no puede ${nombre}`).toBe(false);
      expect(await prisma.registroAuditoria.count()).toBe(auditoriasAntes);
      expect(await prisma.familiaDeProducto.findMany({ orderBy: { id: "asc" } })).toEqual(familiasAntes);
      expect(await prisma.miembroDeFamilia.findMany()).toEqual(miembrosAntes);

      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      for (const [nombre, correr] of Object.entries(comandos(id, p))) expect((await correr()).ok, `el administrador puede ${nombre}`).toBe(true);
    });

    it("el GERENTE de la empresa (el primer administrador, con rolEmpresa «gerente») puede en cada comando", async () => {
      const { id, p } = await ordenCompleto();
      const gerente = await crearUsuarioConMembresia({ email: "gerente@test.com", sucursalId: sucursalA, rolId: rolAdminId });
      await prismaAdmin.usuarioEmpresa.update({ where: { usuarioId_empresaId: { usuarioId: gerente.id, empresaId: EMPRESA_POR_DEFECTO_ID } }, data: { rolEmpresa: "gerente" } });
      await mockearUsuarioActual({ id: gerente.id, email: "gerente@test.com", nombre: null });
      for (const [nombre, correr] of Object.entries(comandos(id, p))) expect((await correr()).ok, `el gerente puede ${nombre}`).toBe(true);
    });

    it("un pedido sin forma se rechaza ANTES de tocar la base (nombre vacío o sin letra, ids que no son ids, versión no entera, interruptor que no es booleano); un `empresaId` del pedido se ignora", async () => {
      const { id, p } = await ordenCompleto();
      await mockearUsuarioActual({ id: usuarioId, email: "admin@test.com", nombre: null });
      const antes = await prisma.registroAuditoria.count();
      const malos = [
        crearFamiliaDeProducto({ nombre: "   " }),
        crearFamiliaDeProducto({ nombre: 42 }),
        editarFamiliaDeProducto({ familiaId: "no-uuid", versionEsperada: 1, nombre: "X", agruparEnCarta: true, agruparEnPos: true }),
        editarFamiliaDeProducto({ familiaId: id, versionEsperada: "1", nombre: "X", agruparEnCarta: true, agruparEnPos: true }),
        editarFamiliaDeProducto({ familiaId: id, versionEsperada: 0, nombre: "X", agruparEnCarta: true, agruparEnPos: true }),
        editarFamiliaDeProducto({ familiaId: id, versionEsperada: 1, nombre: "X", agruparEnCarta: "si", agruparEnPos: true }),
        fijarActivaFamiliaDeProducto({ familiaId: id, versionEsperada: 1, activa: "no" }),
        agregarProductoAFamilia({ familiaId: id, productoId: "con espacios" }),
        agregarProductoAFamilia({ familiaId: id, productoId: undefined }),
        quitarProductoDeFamilia({ familiaId: id, productoId: p, versionEsperada: 1.5 }),
      ];
      for (const r of await Promise.all(malos)) expect(r.ok).toBe(false);
      expect(await prisma.registroAuditoria.count()).toBe(antes);
      // La empresa sale del contexto del servidor: un `empresaId` que mande el navegador se ignora.
      const r = await crearFamiliaDeProducto({ nombre: "Con intruso", empresaId: EMPRESA_TESTIGO_ID } as never);
      expect(r).toMatchObject({ ok: true });
      expect((await prisma.familiaDeProducto.findFirstOrThrow({ where: { nombre: "Con intruso" } })).empresaId).toBe(EMPRESA_POR_DEFECTO_ID);
    });
  });
});
