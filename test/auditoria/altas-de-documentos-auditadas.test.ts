import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, sembrarBase, sembrarCatalogoBase, sembrarSeccion, crearUsuarioConMembresia, prisma } from "../setup/test-db";
import { registrarConteoFisicoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-conteo-fisico";
import { crearSolicitudDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-solicitud-de-traspaso";
import { crearEnvioDirectoDeTraspasoCasoDeUso } from "../../src/server/actions/traspasos/casos-de-uso/crear-envio-directo-de-traspaso";

/**
 * Las tres altas de documentos que `escrituras-auditadas` tenía exceptuadas —un conteo físico, una solicitud de traspaso y un envío directo de traspaso— ahora dejan su fila en el registro
 * de auditoría (decisión del dueño, 2026-10-07; trabajo 1.14 de la rama `pureza-integracion`). Postgres real: el caso de uso corre con el actor ya resuelto y se lee lo que quedó en
 * `RegistroAuditoria`.
 */
describe("las altas de conteo físico y de traspaso dejan su fila de auditoría", () => {
  let sucursalAId: string;
  let sucursalBId: string;
  let seccionAId: string;
  let seccionBId: string;
  let adminId: string;
  let kgId: string;
  let insumoId: string;
  let harinaId: string;

  const comoA = () => ({ usuarioId: adminId, sucursalId: sucursalAId, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest });
  const auditoria = (entidad: string) => prisma.registroAuditoria.findMany({ where: { entidad }, orderBy: { creadoEn: "asc" } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    const base = await sembrarBase();
    sucursalAId = base.sucursal.id;
    const catalogo = await sembrarCatalogoBase();
    kgId = catalogo.kg.id;
    insumoId = catalogo.insumo.id;
    seccionAId = (await sembrarSeccion(sucursalAId, "Depósito A")).id;
    sucursalBId = (await prisma.sucursal.create({ data: { nombre: "Sucursal B" } })).id;
    seccionBId = (await sembrarSeccion(sucursalBId, "Depósito B")).id;
    adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: sucursalAId, rolId: base.admin.id })).id;
    harinaId = (await prisma.producto.create({ data: { codigo: "MP_HARINA_AUD", nombre: "Harina", tipo: "MP", unidadStockId: kgId, insumoId } })).id;
    await prisma.disponibilidadProducto.createMany({ data: [sucursalAId, sucursalBId].map((sucursalId) => ({ sucursalId, productoId: harinaId, disponible: true })) });
    // 10 kg en el depósito A.
    const op = await prisma.operacion.create({ data: { sucursalId: sucursalAId, proceso: "COMPRA", fecha: new Date(), usuarioId: adminId } });
    await prisma.movimientoStock.create({ data: { operacionId: op.id, productoId: harinaId, seccionId: seccionAId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 } });
  });

  describe("conteo físico", () => {
    const contar = (conteoReal: number) =>
      registrarConteoFisicoCasoDeUso(comoA(), { productoId: harinaId, seccionId: seccionAId, conteoReal, fechaConteo: new Date(), accion: "AJUSTAR" });

    it("con diferencia: una fila ConteoFisico con el saldo del sistema → lo contado, de quien contó y en su sucursal", async () => {
      const r = await contar(8);
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
      const conteo = await prisma.conteoFisico.findFirstOrThrow();
      const filas = await auditoria("ConteoFisico");
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ entidadId: conteo.id, campo: "conteoReal", valorAnterior: "10", valorNuevo: "8", actorId: adminId, sucursalId: sucursalAId });
      expect(filas[0].descripcion).toContain('"Harina"');
      expect(filas[0].descripcion).toContain("Central");
    });

    it("sin diferencia (el stock ya coincidía) no cambia nada y no deja fila", async () => {
      expect((await contar(10)).ok).toBe(true);
      expect(await prisma.conteoFisico.count()).toBe(1);
      expect(await auditoria("ConteoFisico")).toHaveLength(0);
    });
  });

  describe("traspasos", () => {
    it("la solicitud (PULL) deja una fila TraspasoSucursal con la cantidad pedida, en la sucursal de destino (quien la pide)", async () => {
      const r = await crearSolicitudDeTraspasoCasoDeUso(comoA(), { origenSucursalId: sucursalBId, productoId: harinaId, cantidad: 3, seccionDestinoId: seccionAId, detalle: null });
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
      const traspaso = await prisma.traspasoSucursal.findFirstOrThrow();
      const filas = await auditoria("TraspasoSucursal");
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ entidadId: traspaso.id, campo: "cantidad", valorAnterior: null, valorNuevo: "3", actorId: adminId, sucursalId: sucursalAId });
      expect(filas[0].descripcion).toContain("Solicitud de traspaso");
    });

    it("el envío directo (PUSH) deja una fila TraspasoSucursal con la cantidad enviada, en la sucursal de origen (quien lo manda)", async () => {
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), { destinoSucursalId: sucursalBId, productoId: harinaId, cantidad: 4, seccionOrigenId: seccionAId, detalle: null });
      expect(r.ok, r.ok ? "" : r.mensaje).toBe(true);
      const traspaso = await prisma.traspasoSucursal.findFirstOrThrow();
      const filas = await auditoria("TraspasoSucursal");
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ entidadId: traspaso.id, campo: "cantidad", valorAnterior: null, valorNuevo: "4", actorId: adminId, sucursalId: sucursalAId });
      expect(filas[0].descripcion).toContain("Envío directo");
    });

    it("un rechazo (stock insuficiente) no deja fila: la auditoría va dentro de la misma transacción", async () => {
      const r = await crearEnvioDirectoDeTraspasoCasoDeUso(comoA(), { destinoSucursalId: sucursalBId, productoId: harinaId, cantidad: 999, seccionOrigenId: seccionAId, detalle: null });
      expect(r.ok).toBe(false);
      expect(await prisma.traspasoSucursal.count()).toBe(0);
      expect(await auditoria("TraspasoSucursal")).toHaveLength(0);
    });
  });
});
