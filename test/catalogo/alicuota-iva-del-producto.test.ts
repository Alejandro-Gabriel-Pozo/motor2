import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

/**
 * Interruptor para romper la auditoría A MITAD DE CAMINO (mismo molde que `test/clientes/cliente-auditoria-atomica.test.ts` y `precio-auditoria-atomica.test.ts`): `fallarEnLlamada = N` hace que la N-ésima llamada
 * a `registrarCambioAuditado` tire, DESPUÉS de que el caso de uso ya escribió el producto. El resto delega en la implementación real (escribe la fila de verdad). `llamadas` cuenta todas, también las que no escriben (no-op).
 */
const interruptor = vi.hoisted(() => ({ fallarEnLlamada: null as number | null, llamadas: 0 }));

vi.mock("../../src/server/auditoria/registrar-cambio-auditado", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/server/auditoria/registrar-cambio-auditado")>();
  return {
    ...real,
    registrarCambioAuditado: async (...args: Parameters<typeof real.registrarCambioAuditado>) => {
      interruptor.llamadas++;
      if (interruptor.fallarEnLlamada !== null && interruptor.llamadas === interruptor.fallarEnLlamada) {
        throw new Error("auditoría caída (simulada)");
      }
      return real.registrarCambioAuditado(...args);
    },
  };
});

import { baseDeTest, EMPRESA_POR_DEFECTO_ID, crearUsuarioConMembresia, limpiarBaseDeTest, prisma, prismaAdmin, sembrarBase, sembrarProductoDisponible } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { actualizarProducto, darDeAltaProducto, type DatosProducto, type DatosProductoEdicion } from "../../src/server/actions/catalogo/productos";
import { actualizarProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/actualizar-producto";
import { guardComandoDatosDeProducto } from "../../src/core/features/catalogo/productos.guard";
import type { ResultadoConSincronizable } from "../../src/server/actions/tipos";

/**
 * Alícuota de IVA del producto (paso 13 de la auditoría 2026-11-12; `docs/diseno-alicuota-iva-del-producto-2026-11-12.md`; pedido del dueño del 2026-11-12, «Sí, hacemos A»), por la Server Action pública y contra Postgres real.
 * «IVA de venta» (`alicuotaIvaVenta`) en un PV, «IVA de compra» (`alicuotaIvaCompra`) en una MP. Lista cerrada o vacío (I1), cada una en su tipo (I2), cambiarla exige `producto_campos_sensibles` (I3), cada cambio deja su fila de
 * auditoría en la MISMA transacción (I4), ningún producto existente cambia (I5). Concurrencia (control del valor visto, `alicuotaVista`, como el precio) e idempotencia: lo que el dueño exige.
 */
const ITERACIONES = 8;

describe("alícuota de IVA del producto", () => {
  let sucursalId: string;
  let unidadId: string;
  let adminId: string;
  let operadorId: string;
  let altaSoloId: string;
  let n = 0;

  const como = (id: string, email: string) => mockearUsuarioActual({ id, email, nombre: null });
  const comoAdmin = () => como(adminId, "admin@test.com");
  const comoOperador = () => como(operadorId, "operador@test.com");

  beforeEach(async () => {
    interruptor.fallarEnLlamada = null;
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalId = base.sucursal.id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId, rolId: base.admin.id })).id;
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId, rolId: base.operador.id })).id;
    // Un rol propio que puede dar de alta productos pero NO tiene la clave fina.
    const alta = await prisma.rol.create({ data: { nombre: "Solo alta" } });
    await prisma.permisoRol.create({ data: { rolId: alta.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: true } });
    altaSoloId = (await crearUsuarioConMembresia({ email: "alta@test.com", sucursalId, rolId: alta.id })).id;
    unidadId = (await prisma.unidad.create({ data: { nombre: "u", magnitud: "CANTIDAD", decimales: 0 } })).id;
    await comoAdmin();
    interruptor.llamadas = 0;
  });

  afterEach(() => {
    interruptor.fallarEnLlamada = null;
  });

  const pv = async (nombre: string, extra: { alicuotaIvaVenta?: string } = {}) =>
    (await sembrarProductoDisponible({ codigo: `PV_IVA_${n++}`, nombre, tipo: "PV", precioVenta: 1000, unidadStockId: unidadId, ...extra }, sucursalId)).id;
  const mp = async (nombre: string, extra: { alicuotaIvaCompra?: string } = {}) =>
    (await sembrarProductoDisponible({ codigo: `MP_IVA_${n++}`, nombre, tipo: "MP", precioVenta: 0, unidadStockId: unidadId, ...extra }, sucursalId)).id;

  /** Lo que manda el formulario de un PV: el producto tal cual, con la alícuota pedida y la que mostraba. */
  const formularioPV = (nombre: string, extra: Partial<DatosProductoEdicion> = {}): DatosProductoEdicion => ({ nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta: 1000, precioVentaVisto: 1000, ...extra });
  const formularioMP = (nombre: string, extra: Partial<DatosProductoEdicion> = {}): DatosProductoEdicion => ({ nombre, tipo: "MP", unidadStockId: unidadId, factorConversion: 1, precioVenta: 0, precioVentaVisto: 0, ...extra });

  const alicuotas = async (id: string) => {
    const p = await prisma.producto.findUniqueOrThrow({ where: { id } });
    return { venta: p.alicuotaIvaVenta, compra: p.alicuotaIvaCompra };
  };
  const filasDeAuditoria = (id: string, campo?: string) =>
    prismaAdmin.registroAuditoria.findMany({ where: { entidad: "Producto", entidadId: id, ...(campo ? { campo } : {}) }, orderBy: { creadoEn: "asc" } });
  const resumen = (filas: Awaited<ReturnType<typeof filasDeAuditoria>>) => filas.map((f) => `${f.campo}: ${f.valorAnterior} → ${f.valorNuevo}`);

  describe("guardar la alícuota (I1, I4)", () => {
    it("un PV sin declarar pasa a IVA 21 %: queda la alícuota de venta y UNA fila de auditoría (del anterior al nuevo); la de compra no se toca", async () => {
      const id = await pv("Milanesa");
      expect(await alicuotas(id)).toEqual({ venta: null, compra: null });
      expect(await actualizarProducto(id, formularioPV("Milanesa", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }))).toMatchObject({ ok: true, mensaje: 'Producto "Milanesa" actualizado.' });
      expect(await alicuotas(id)).toEqual({ venta: "IVA_21", compra: null });
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaVenta: null → IVA_21"]);
    });

    it("una MP sin declarar pasa a IVA 10,5 %: queda la alícuota de COMPRA y su fila de auditoría; la de venta no se toca", async () => {
      const id = await mp("Harina");
      expect((await actualizarProducto(id, formularioMP("Harina", { alicuotaIvaCompra: "IVA_10_5", alicuotaVista: null }))).ok).toBe(true);
      expect(await alicuotas(id)).toEqual({ venta: null, compra: "IVA_10_5" });
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaCompra: null → IVA_10_5"]);
    });

    it.each(["IVA_0", "IVA_2_5", "IVA_5", "IVA_10_5", "IVA_21", "IVA_27", "EXENTO", "NO_GRAVADO"] as const)("cada valor de la lista cerrada se guarda: %s", async (valor) => {
      const id = await pv(`Plato ${valor}`);
      expect((await actualizarProducto(id, formularioPV(`Plato ${valor}`, { alicuotaIvaVenta: valor, alicuotaVista: null }))).ok).toBe(true);
      expect((await alicuotas(id)).venta).toBe(valor);
    });

    it("cambiarla de una a otra deja la fila del anterior al nuevo; quitarla (volver a «sin declarar») también", async () => {
      const id = await pv("Pizza", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Pizza", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: "IVA_21" }))).ok).toBe(true);
      expect((await actualizarProducto(id, formularioPV("Pizza", { alicuotaIvaVenta: null, alicuotaVista: "IVA_10_5" }))).ok).toBe(true);
      expect((await alicuotas(id)).venta).toBeNull();
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaVenta: IVA_21 → IVA_10_5", "alicuotaIvaVenta: IVA_10_5 → null"]);
    });

    it("editar solo el nombre con la alícuota igual a la guardada no escribe ni audita la alícuota", async () => {
      const id = await pv("Tarta", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Tarta de verdura", { alicuotaIvaVenta: "IVA_21", alicuotaVista: "IVA_21" }))).ok).toBe(true);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Tarta de verdura");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("un valor que NO viene (`undefined`) queda como estaba, aunque quien edita tenga la clave", async () => {
      const id = await pv("Flan", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Flan casero"))).ok).toBe(true);
      expect((await alicuotas(id)).venta).toBe("IVA_21");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });
  });

  describe("I1: lista cerrada: un valor fuera de la lista se rechaza SIN escribir", () => {
    it.each([
      ["un texto que no es de la lista", "IVA_99"],
      ["el porcentaje a secas", "21"],
      ["texto vacío (el vacío válido es null)", ""],
      ["NO_CORRESPONDE", "NO_CORRESPONDE"],
      ["un número", 21],
      ["un objeto", { valor: "IVA_21" }],
    ])("%s → DATOS_INVALIDOS, el producto y la auditoría intactos", async (_nombre, valor) => {
      const id = await pv("Empanada", { alicuotaIvaVenta: "IVA_10_5" });
      const r = await actualizarProducto(id, formularioPV("Empanada rica", { alicuotaIvaVenta: valor as never, alicuotaVista: "IVA_10_5" }));
      expect(r).toEqual({ ok: false, mensaje: "La alícuota de IVA no es una de las admitidas: elegí una de la lista, o dejala sin declarar." });
      expect(await alicuotas(id)).toEqual({ venta: "IVA_10_5", compra: null });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Empanada");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("el caso de uso responde con el código DATOS_INVALIDOS", async () => {
      const id = await pv("Alfajor");
      const datos = formularioPV("Alfajor", { alicuotaIvaVenta: "IVA_99" as never, alicuotaVista: null });
      const r = await actualizarProductoCasoDeUso(actor(adminId), { productoId: id, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.codigo).toBe("DATOS_INVALIDOS");
    });
  });

  describe("I2: la de venta solo en un PV, la de compra solo en una MP", () => {
    it("alícuota de VENTA en una MP → rechazo con mensaje claro, sin escribir", async () => {
      const id = await mp("Aceite");
      const r = await actualizarProducto(id, formularioMP("Aceite", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }));
      expect(r).toEqual({ ok: false, mensaje: "El «IVA de venta» solo se carga en un producto de venta (PV)." });
      expect(await alicuotas(id)).toEqual({ venta: null, compra: null });
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("alícuota de COMPRA en un PV → rechazo con mensaje claro, sin escribir", async () => {
      const id = await pv("Hamburguesa");
      const r = await actualizarProducto(id, formularioPV("Hamburguesa", { alicuotaIvaCompra: "IVA_21", alicuotaVista: null }));
      expect(r).toEqual({ ok: false, mensaje: "El «IVA de compra» solo se carga en una materia prima (MP)." });
      expect(await alicuotas(id)).toEqual({ venta: null, compra: null });
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("`null` en el campo del tipo equivocado no escribe nada (no borra una alícuota ajena guardada)", async () => {
      const id = await pv("Lomito");
      await prisma.producto.update({ where: { id }, data: { alicuotaIvaCompra: "IVA_27" } }); // un valor ajeno al tipo, sembrado a mano
      expect((await actualizarProducto(id, formularioPV("Lomito completo", { alicuotaIvaCompra: null }))).ok).toBe(true);
      expect((await alicuotas(id)).compra).toBe("IVA_27");
    });
  });

  describe("I3: cambiarla exige producto_campos_sensibles", () => {
    it("sin la clave, cambiarla → SIN_PERMISO_CAMPOS_SENSIBLES, la alícuota y la auditoría intactas (aunque lo demás sí se pueda editar)", async () => {
      await comoOperador();
      const id = await pv("Pastel", { alicuotaIvaVenta: "IVA_21" });
      const r = await actualizarProducto(id, formularioPV("Pastel de papa", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: "IVA_21" }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No tenés permiso para cambiar la alícuota de IVA del producto.");
      expect(r.mensaje).toContain("recargá la página");
      expect(await alicuotas(id)).toEqual({ venta: "IVA_21", compra: null });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Pastel");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("sin la clave, quitarla (null) tampoco se puede", async () => {
      await comoOperador();
      const id = await pv("Ensalada", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Ensalada", { alicuotaIvaVenta: null, alicuotaVista: "IVA_21" }))).ok).toBe(false);
      expect((await alicuotas(id)).venta).toBe("IVA_21");
    });

    it("el caso de uso responde con el código SIN_PERMISO_CAMPOS_SENSIBLES", async () => {
      const id = await pv("Sandwich");
      const datos = formularioPV("Sandwich", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null });
      const r = await actualizarProductoCasoDeUso(actor(operadorId), { productoId: id, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: false });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.codigo).toBe("SIN_PERMISO_CAMPOS_SENSIBLES");
      expect((await alicuotas(id)).venta).toBeNull();
    });

    it("sin la clave, mandar la MISMA alícuota que está guardada no es un cambio: la edición sigue", async () => {
      await comoOperador();
      const id = await pv("Bruschetta", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Bruschetta clásica", { alicuotaIvaVenta: "IVA_21", alicuotaVista: "IVA_21" }))).ok).toBe(true);
      expect(await alicuotas(id)).toEqual({ venta: "IVA_21", compra: null });
    });

    it("sin la clave, el formulario NO manda la alícuota (el campo viaja deshabilitado): queda como estaba y el resto se edita", async () => {
      await comoOperador();
      const id = await pv("Canelones", { alicuotaIvaVenta: "IVA_27" });
      expect((await actualizarProducto(id, formularioPV("Canelones de verdura"))).ok).toBe(true);
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Canelones de verdura");
      expect((await alicuotas(id)).venta).toBe("IVA_27");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("los permisos se vuelven a exigir en cada guardado: con la clave se guarda; al quitarla, ya no", async () => {
      const id = await pv("Ravioles");
      expect((await actualizarProducto(id, formularioPV("Ravioles", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }))).ok).toBe(true);
      await comoOperador();
      expect((await actualizarProducto(id, formularioPV("Ravioles", { alicuotaIvaVenta: "IVA_27", alicuotaVista: "IVA_21" }))).ok).toBe(false);
      expect((await alicuotas(id)).venta).toBe("IVA_21");
    });
  });

  describe("concurrencia: control del valor visto (`alicuotaVista`) e idempotencia", () => {
    const codigo = (r: PromiseSettledResult<ResultadoConSincronizable>) =>
      r.status === "rejected" ? `error:${String(r.reason)}` : r.value.ok ? "ok" : r.value.mensaje.includes("mientras lo editabas") ? "ALICUOTA_DESACTUALIZADA" : r.value.mensaje;

    it("ALICUOTA_DESACTUALIZADA: otra persona la cambió mientras se editaba → no se guarda nada y no se pisa lo suyo", async () => {
      const id = await pv("Pizza muzzarella");
      expect((await actualizarProducto(id, formularioPV("Pizza muzzarella", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }))).ok).toBe(true); // otra persona
      const r = await actualizarProducto(id, formularioPV("Pizza muzzarella grande", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: null })); // la pantalla vieja
      expect(r).toEqual({ ok: false, mensaje: "Alguien cambió la alícuota de IVA de «Pizza muzzarella» mientras lo editabas: no se guardó nada. Recargá la pantalla y volvé a hacer el cambio." });
      expect(await alicuotas(id)).toEqual({ venta: "IVA_21", compra: null });
      expect((await prisma.producto.findUniqueOrThrow({ where: { id } })).nombre).toBe("Pizza muzzarella");
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaVenta: null → IVA_21"]);
    });

    it("el caso de uso responde con el código ALICUOTA_DESACTUALIZADA", async () => {
      const id = await pv("Matambre", { alicuotaIvaVenta: "IVA_21" });
      const datos = formularioPV("Matambre", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: null });
      const r = await actualizarProductoCasoDeUso(actor(adminId), { productoId: id, datos, puerta: guardComandoDatosDeProducto({ datos }), puedeGestionarConsignacion: true, puedeEditarCamposSensibles: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.codigo).toBe("ALICUOTA_DESACTUALIZADA");
    });

    it("falla CERRADO: sin `alicuotaVista` (la pantalla no la mandó) un cambio de alícuota se rechaza, y con `null` contra una guardada también", async () => {
      const id = await pv("Pollo", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Pollo", { alicuotaIvaVenta: "IVA_10_5" }))).mensaje).toContain("mientras lo editabas");
      expect((await actualizarProducto(id, formularioPV("Pollo", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: null }))).mensaje).toContain("mientras lo editabas");
      expect((await actualizarProducto(id, formularioPV("Pollo", { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: "IVA_27" }))).mensaje).toContain("mientras lo editabas");
      expect((await alicuotas(id)).venta).toBe("IVA_21");
      expect(await filasDeAuditoria(id)).toEqual([]);
    });

    it("si la alícuota NO cambia, la vista no se mira: quien edita solo el nombre con una pantalla vieja no recibe el rechazo de la alícuota", async () => {
      const id = await pv("Churrasco", { alicuotaIvaVenta: "IVA_21" });
      expect((await actualizarProducto(id, formularioPV("Churrasco de lomo", { alicuotaIvaVenta: "IVA_21" }))).ok).toBe(true);
    });

    it("rige también para la alícuota de COMPRA de una MP", async () => {
      const id = await mp("Sal");
      expect((await actualizarProducto(id, formularioMP("Sal", { alicuotaIvaCompra: "IVA_21", alicuotaVista: null }))).ok).toBe(true);
      expect((await actualizarProducto(id, formularioMP("Sal", { alicuotaIvaCompra: "IVA_10_5", alicuotaVista: null }))).mensaje).toContain("mientras lo editabas");
      expect((await alicuotas(id)).compra).toBe("IVA_21");
    });

    it("IDEMPOTENTE: el mismo guardado dos veces → ok, ok; una sola escritura y UNA sola fila de auditoría", async () => {
      const id = await pv("Tortilla");
      const guardar = () => actualizarProducto(id, formularioPV("Tortilla", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }));
      expect((await guardar()).ok).toBe(true);
      expect((await guardar()).ok).toBe(true);
      expect(await alicuotas(id)).toEqual({ venta: "IVA_21", compra: null });
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaVenta: null → IVA_21"]);
    });

    it(`CARRERA (${ITERACIONES} vueltas): dos ediciones a la vez con la misma alícuota vista (sin declarar) → UNA gana, la otra ALICUOTA_DESACTUALIZADA; una sola fila de auditoría y la guardada es la de la ganadora`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const nombre = `Fainá ${i}`;
        const id = await pv(nombre);
        const res = await Promise.allSettled([
          actualizarProducto(id, formularioPV(nombre, { alicuotaIvaVenta: "IVA_21", alicuotaVista: null })),
          actualizarProducto(id, formularioPV(nombre, { alicuotaIvaVenta: "IVA_27", alicuotaVista: null })),
        ]);
        expect(res.map(codigo).sort(), `vuelta ${i}`).toEqual(["ALICUOTA_DESACTUALIZADA", "ok"]);
        const gano = res.findIndex((r) => r.status === "fulfilled" && r.value.ok);
        expect((await alicuotas(id)).venta, `vuelta ${i}`).toBe(gano === 0 ? "IVA_21" : "IVA_27");
        expect(await filasDeAuditoria(id, "alicuotaIvaVenta"), `vuelta ${i}`).toHaveLength(1);
      }
    });

    it(`CARRERA (${ITERACIONES} vueltas): el MISMO guardado dos veces a la vez → dos ok y una sola fila de auditoría`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const nombre = `Flan ${i}`;
        const id = await pv(nombre);
        const res = await Promise.allSettled([
          actualizarProducto(id, formularioPV(nombre, { alicuotaIvaVenta: "IVA_21", alicuotaVista: null })),
          actualizarProducto(id, formularioPV(nombre, { alicuotaIvaVenta: "IVA_21", alicuotaVista: null })),
        ]);
        expect(res.map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
        expect((await alicuotas(id)).venta, `vuelta ${i}`).toBe("IVA_21");
        expect(await filasDeAuditoria(id, "alicuotaIvaVenta"), `vuelta ${i}`).toHaveLength(1);
      }
    });

    it(`CARRERA (${ITERACIONES} vueltas): una edición de la alícuota y otra de otro dato del mismo producto → las dos quedan (la segunda no pisa la alícuota con su valor viejo)`, async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const nombre = `Postre ${i}`;
        const id = await pv(nombre, { alicuotaIvaVenta: "IVA_21" });
        const res = await Promise.allSettled([
          actualizarProducto(id, formularioPV(nombre, { alicuotaIvaVenta: "IVA_10_5", alicuotaVista: "IVA_21" })),
          actualizarProducto(id, formularioPV(nombre, { observaciones: `nota ${i}` })), // no manda la alícuota: queda como esté
        ]);
        expect(res.map(codigo), `vuelta ${i}`).toEqual(["ok", "ok"]);
        const p = await prisma.producto.findUniqueOrThrow({ where: { id } });
        expect({ venta: p.alicuotaIvaVenta, nota: p.observaciones }, `vuelta ${i}`).toEqual({ venta: "IVA_10_5", nota: `nota ${i}` });
      }
    });
  });

  describe("I4: la auditoría va en la MISMA transacción (si falla, no queda nada)", () => {
    it("si falla CUALQUIERA de las filas de auditoría de una edición que cambia el precio y la alícuota, no queda ni el precio ni la alícuota ni ninguna fila", async () => {
      const id = await pv("Brownie");
      const cambios = () => formularioPV("Brownie", { precioVenta: 1200, precioVentaVisto: 1000, alicuotaIvaVenta: "IVA_21", alicuotaVista: null });
      // Corrida de control: cuenta cuántas llamadas a la auditoría hace una edición así (también las que no escriben).
      interruptor.llamadas = 0;
      expect((await actualizarProducto(id, cambios())).ok).toBe(true);
      const total = interruptor.llamadas;
      expect(total).toBeGreaterThan(4);
      expect(resumen(await filasDeAuditoria(id)).sort()).toEqual(["alicuotaIvaVenta: null → IVA_21", "precioVenta: 1000 → 1200"]);
      // Se vuelve al estado de partida y se rompe, de a una, cada llamada.
      await prisma.producto.update({ where: { id }, data: { precioVenta: 1000, alicuotaIvaVenta: null } });
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: id } });
      for (let k = 1; k <= total; k++) {
        interruptor.llamadas = 0;
        interruptor.fallarEnLlamada = k;
        await expect(actualizarProducto(id, cambios()), `falla la llamada ${k} de ${total}`).rejects.toThrow("auditoría caída");
        const p = await prisma.producto.findUniqueOrThrow({ where: { id } });
        expect({ precio: Number(p.precioVenta), venta: p.alicuotaIvaVenta }, `falla la llamada ${k}`).toEqual({ precio: 1000, venta: null });
        expect(await filasDeAuditoria(id), `falla la llamada ${k}`).toEqual([]);
      }
      // Y sin falla, el mismo guardado sí queda (control).
      interruptor.fallarEnLlamada = null;
      expect((await actualizarProducto(id, cambios())).ok).toBe(true);
      expect((await alicuotas(id)).venta).toBe("IVA_21");
    });

    it("lo mismo con la alícuota de COMPRA de una MP", async () => {
      const id = await mp("Azúcar");
      const guardar = () => actualizarProducto(id, formularioMP("Azúcar", { alicuotaIvaCompra: "IVA_21", alicuotaVista: null }));
      interruptor.llamadas = 0;
      interruptor.fallarEnLlamada = 5; // la de compra es la quinta llamada del caso de uso (precio, consignación, modo, venta, compra)
      await expect(guardar()).rejects.toThrow("auditoría caída");
      expect(await alicuotas(id)).toEqual({ venta: null, compra: null });
      expect(await filasDeAuditoria(id)).toEqual([]);
      interruptor.fallarEnLlamada = null;
      expect((await guardar()).ok).toBe(true);
      expect(resumen(await filasDeAuditoria(id))).toEqual(["alicuotaIvaCompra: null → IVA_21"]);
    });
  });

  describe("I5: ningún producto existente cambia", () => {
    it("editar un producto no toca la alícuota de los demás, ni deja filas de auditoría de ellos", async () => {
      const otro = await pv("Otro plato", { alicuotaIvaVenta: "IVA_27" });
      const otraMp = await mp("Otra MP", { alicuotaIvaCompra: "IVA_10_5" });
      const sinDeclarar = await pv("Sin declarar");
      const id = await pv("El que se edita");
      expect((await actualizarProducto(id, formularioPV("El que se edita", { alicuotaIvaVenta: "IVA_21", alicuotaVista: null }))).ok).toBe(true);
      expect(await alicuotas(otro)).toEqual({ venta: "IVA_27", compra: null });
      expect(await alicuotas(otraMp)).toEqual({ venta: null, compra: "IVA_10_5" });
      expect(await alicuotas(sinDeclarar)).toEqual({ venta: null, compra: null });
      expect(await prismaAdmin.registroAuditoria.count({ where: { entidadId: { in: [otro, otraMp, sinDeclarar] } } })).toBe(0);
    });
  });

  describe("el alta (opcional: nace vacía)", () => {
    const altaPV = (nombre: string, extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre, tipo: "PV", unidadStockId: unidadId, factorConversion: 1, precioVenta: 1500, ...extra });
    const altaMP = (nombre: string, extra: Partial<DatosProducto> = {}): DatosProducto => ({ nombre, tipo: "MP", unidadStockId: unidadId, factorConversion: 1, ...extra });
    const porNombre = (nombre: string) => prisma.producto.findFirstOrThrow({ where: { nombre } });

    it("sin alícuota, el producto nace «sin declarar» (nada preelegido), PV y MP", async () => {
      expect((await darDeAltaProducto(altaPV("Lasaña"))).ok).toBe(true);
      expect((await darDeAltaProducto(altaMP("Tomate"))).ok).toBe(true);
      expect([(await porNombre("Lasaña")).alicuotaIvaVenta, (await porNombre("Lasaña")).alicuotaIvaCompra]).toEqual([null, null]);
      expect([(await porNombre("Tomate")).alicuotaIvaVenta, (await porNombre("Tomate")).alicuotaIvaCompra]).toEqual([null, null]);
    });

    it("con la clave, un PV nace con su alícuota de venta y una MP con la de compra", async () => {
      expect((await darDeAltaProducto(altaPV("Ñoquis", { alicuotaIvaVenta: "IVA_21" }))).ok).toBe(true);
      expect((await darDeAltaProducto(altaMP("Queso", { alicuotaIvaCompra: "IVA_10_5" }))).ok).toBe(true);
      expect(await alicuotas((await porNombre("Ñoquis")).id)).toEqual({ venta: "IVA_21", compra: null });
      expect(await alicuotas((await porNombre("Queso")).id)).toEqual({ venta: null, compra: "IVA_10_5" });
    });

    it("`null` explícito en el alta es «sin declarar»", async () => {
      expect((await darDeAltaProducto(altaPV("Sorrentinos", { alicuotaIvaVenta: null }))).ok).toBe(true);
      expect((await porNombre("Sorrentinos")).alicuotaIvaVenta).toBeNull();
    });

    it("un valor fuera de la lista o en el tipo equivocado se rechaza y no crea el producto", async () => {
      const fuera = await darDeAltaProducto(altaPV("Fuera de lista", { alicuotaIvaVenta: "IVA_99" as never }));
      expect(fuera).toEqual({ ok: false, mensaje: "La alícuota de IVA no es una de las admitidas: elegí una de la lista, o dejala sin declarar." });
      expect(await darDeAltaProducto(altaMP("Venta en MP", { alicuotaIvaVenta: "IVA_21" }))).toEqual({ ok: false, mensaje: "El «IVA de venta» solo se carga en un producto de venta (PV)." });
      expect(await darDeAltaProducto(altaPV("Compra en PV", { alicuotaIvaCompra: "IVA_21" }))).toEqual({ ok: false, mensaje: "El «IVA de compra» solo se carga en una materia prima (MP)." });
      expect(await prisma.producto.count({ where: { nombre: { in: ["Fuera de lista", "Venta en MP", "Compra en PV"] } } })).toBe(0);
    });

    it("sin la clave fina, el alta con una alícuota se rechaza (fallo cerrado) y no crea el producto; sin alícuota sí se crea", async () => {
      await como(altaSoloId, "alta@test.com");
      const r = await darDeAltaProducto(altaMP("Pimienta", { alicuotaIvaCompra: "IVA_21" }));
      expect(r.ok).toBe(false);
      expect(r.mensaje).toContain("No tenés permiso para cambiar la alícuota de IVA del producto.");
      expect(await prisma.producto.count({ where: { nombre: "Pimienta" } })).toBe(0);
      expect((await darDeAltaProducto(altaMP("Pimienta"))).ok).toBe(true);
      expect((await alicuotas((await porNombre("Pimienta")).id)).compra).toBeNull();
    });
  });

  // El actor del caso de uso lleva el alcance que tiene en producción: SOLO su sucursal activa (ADR-028).
  const actor = (usuarioId: string) => ({ usuarioId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId, ahora: new Date(), ...baseDeTest({ lectura: [sucursalId], escritura: [sucursalId] }) });
});
