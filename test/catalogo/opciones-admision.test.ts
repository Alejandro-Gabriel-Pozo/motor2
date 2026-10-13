import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { crearUsuarioConMembresia, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { mockearUsuarioActual } from "../setup/mock-sesion";
import { crearMembresia } from "../setup/membresia";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { fijarAdmisionDeGrupoEnProducto } from "../../src/server/actions/catalogo/opciones-de-venta";
import { fijarAdmisionDeGrupoEnProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-admision-de-grupo-en-producto";
import type { ComandoFijarAdmisionDeGrupo, OpcionAdmitidaEnComando } from "../../src/core/features/catalogo/opciones-de-venta.schema";

/**
 * GO-2a, paso 9: lo que ADMITE cada producto (`producto_opciones_admitidas`; ADR-030 §4: lista de permitidos, fila ausente = no). Contra Postgres real, como `motor2_app`. Para un par
 * (producto, grupo) se fija la fila del grupo y las de sus opciones, cada una con su versión esperada (0 = nueva); nunca se borra; las reglas puras sobre el estado resultante, el
 * control de precio de lista, los activos al admitir, el aviso S3 y la auditoría por columna.
 */
describe("lo que admite cada producto (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  let teId: string;
  let operadorId: string;
  const actor = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const op = (opcionId: string, extra: Partial<OpcionAdmitidaEnComando> = {}): OpcionAdmitidaEnComando => ({ opcionId, versionEsperada: 0, cantidadMaxima: 1, precioAbsoluto: null, diferencia: null, activo: true, ...extra });
  const comando = (extra: Partial<ComandoFijarAdmisionDeGrupo> = {}): ComandoFijarAdmisionDeGrupo => ({
    productoId: teId,
    grupoId: e.grupoVarianteId,
    versionEsperada: 0,
    orden: 0,
    cantidadMinima: null,
    cantidadMaxima: null,
    modoPrecio: null,
    activo: true,
    opciones: [op(e.vacaId), op(e.almendrasId, { diferencia: { tipo: "MONTO", monto: 100 } })],
    ...extra,
  });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    teId = (await prisma.producto.create({ data: { codigo: "PV_TE", nombre: "Té", tipo: "PV", unidadStockId: e.unidadId, precioVenta: "800.00" } })).id;
    const adminRol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
    const operadorRol = await prisma.rol.findFirstOrThrow({ where: { clave: "operador" } });
    await crearMembresia({ usuarioId: e.usuarioId, sucursalId: e.sucursalA, rolId: adminRol.id });
    operadorId = (await crearUsuarioConMembresia({ email: "operador@test.com", sucursalId: e.sucursalA, rolId: operadorRol.id })).id;
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
  });

  it("admitir por primera vez: la fila del grupo y las de sus opciones en versión 1, con la auditoría de cada columna (de null al valor)", async () => {
    const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
    expect(r).toMatchObject({ ok: true, datos: { version: 1, huboCambio: true, avisos: [] } });
    if (!r.ok) return;
    expect(await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { id: r.datos.admisionId } })).toMatchObject({ productoId: teId, grupoId: e.grupoVarianteId, activo: true, version: 1, modoPrecio: null });
    const almendras = await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: teId, opcionId: e.almendrasId } } });
    expect(almendras).toMatchObject({ tipoDeDiferencia: "MONTO", porcentaje: null, version: 1 });
    expect(Number(almendras.diferenciaPrecio)).toBe(100);
    const auditoria = await prisma.registroAuditoria.findMany({ where: { entidad: { in: ["ProductoAdmiteGrupo", "ProductoAdmiteOpcion"] } }, select: { entidad: true, entidadId: true, campo: true, valorAnterior: true, valorNuevo: true } });
    expect(auditoria.filter((f) => f.entidad === "ProductoAdmiteGrupo").map((f) => f.campo).sort()).toEqual(["activo", "orden"]);
    expect(auditoria.filter((f) => f.entidadId === almendras.id).map((f) => [f.campo, f.valorNuevo]).sort()).toEqual([
      ["activo", "true"],
      ["cantidadMaxima", "1"],
      ["diferenciaPrecio", "100"],
      ["tipoDeDiferencia", "MONTO"],
    ]);
    expect(auditoria.every((f) => f.valorAnterior === null)).toBe(true);
  });

  it("editar: sube la versión de lo que cambia y audita el antes y el después; sin cambios, nada; con la versión vieja y otro cambio, VERSION_DESACTUALIZADA; el mismo pedido repetido, éxito sin escribir", async () => {
    await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
    const cambio = comando({ versionEsperada: 1, opciones: [op(e.almendrasId, { versionEsperada: 1, diferencia: { tipo: "PORCENTAJE", porcentaje: 12.5 }, cantidadMaxima: 1 })] });
    const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), cambio);
    expect(r).toMatchObject({ ok: true, datos: { version: 1, huboCambio: true } });
    const fila = await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: teId, opcionId: e.almendrasId } } });
    expect(fila).toMatchObject({ tipoDeDiferencia: "PORCENTAJE", diferenciaPrecio: null, version: 2 });
    expect(await prisma.registroAuditoria.findMany({ where: { entidadId: fila.id, valorAnterior: { not: null } }, orderBy: { campo: "asc" }, select: { campo: true, valorAnterior: true, valorNuevo: true } })).toEqual([
      { campo: "diferenciaPrecio", valorAnterior: "100", valorNuevo: null },
      { campo: "tipoDeDiferencia", valorAnterior: "MONTO", valorNuevo: "PORCENTAJE" },
    ]);
    // La vaca no vino en el comando: su fila queda como estaba.
    expect((await prisma.productoAdmiteOpcion.findUniqueOrThrow({ where: { productoId_opcionId: { productoId: teId, opcionId: e.vacaId } } })).version).toBe(1);

    const auditoria = await prisma.registroAuditoria.count();
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), cambio)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    expect(await prisma.registroAuditoria.count()).toBe(auditoria);
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 1, opciones: [op(e.almendrasId, { versionEsperada: 1, cantidadMaxima: 2 })] }))).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 0, orden: 5, opciones: [] }))).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
  });

  it("quitar es apagar: `activo = false` deja las filas (no se borra nada) y la auditoría lo cuenta", async () => {
    await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
    const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ versionEsperada: 1, activo: false, opciones: [] }));
    expect(r).toMatchObject({ ok: true, datos: { version: 2 } });
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: teId } })).toBe(1);
    expect(await prisma.productoAdmiteOpcion.count({ where: { productoId: teId } })).toBe(2);
    expect(await prisma.registroAuditoria.findFirst({ where: { entidad: "ProductoAdmiteGrupo", campo: "activo", valorAnterior: "true" }, select: { valorNuevo: true } })).toEqual({ valorNuevo: "false" });
  });

  it("producto, grupo y opciones: PRODUCTO_NO_ENCONTRADO, PRODUCTO_NO_ELEGIBLE (una materia prima), GRUPO_NO_ENCONTRADO y una opción de otro grupo (CONFIGURACION_INVALIDA)", async () => {
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId: "no-existe" }))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ENCONTRADO" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ productoId: e.lecheId }))).toMatchObject({ ok: false, codigo: "PRODUCTO_NO_ELEGIBLE" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: "no-existe" }))).toMatchObject({ ok: false, codigo: "GRUPO_NO_ENCONTRADO" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ opciones: [op(e.chicoId)] }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: teId } })).toBe(0);
  });

  it("MEDIDA en ABSOLUTO: sin precio propio se rechaza; con precio, pasa; un tope distinto de 1 se rechaza", async () => {
    const medida = (opciones: OpcionAdmitidaEnComando[]) => comando({ grupoId: e.grupoMedidaId, modoPrecio: "ABSOLUTO", opciones });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), medida([op(e.chicoId, { precioAbsoluto: 700 }), op(e.grandeId)]))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), medida([op(e.chicoId, { precioAbsoluto: 700, cantidadMaxima: 2 })]))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), medida([op(e.chicoId, { precioAbsoluto: 700 }), op(e.grandeId, { precioAbsoluto: 1100.5 })]))).toMatchObject({ ok: true });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoMedidaId, modoPrecio: null, opciones: [op(e.chicoId)] }))).toMatchObject({ ok: false });
  });

  it("al admitir, el grupo y la opción tienen que estar prendidos para la empresa (GRUPO_INACTIVO, OPCION_INACTIVA)", async () => {
    await prisma.grupoDeOpciones.update({ where: { id: e.grupoVarianteId }, data: { activo: false } });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando())).toMatchObject({ ok: false, codigo: "GRUPO_INACTIVO" });
    await prisma.grupoDeOpciones.update({ where: { id: e.grupoVarianteId }, data: { activo: true } });
    await prisma.opcionDeGrupo.update({ where: { id: e.almendrasId }, data: { activa: false } });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando())).toMatchObject({ ok: false, codigo: "OPCION_INACTIVA" });
    // Admitirla APAGADA en el producto sí se puede.
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ opciones: [op(e.vacaId), op(e.almendrasId, { activo: false })] }))).toMatchObject({ ok: true });
  });

  it("el control de precio de lista: una diferencia que deja el té en menos de 0,01 se rechaza; el mínimo inalcanzable de una INCLUIDA, también", async () => {
    const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ opciones: [op(e.almendrasId, { diferencia: { tipo: "MONTO", monto: -800 } })] }));
    expect(r).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
    expect(r.mensaje).toMatch(/Con «Almendras» este producto no se puede vender/);
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ opciones: [op(e.almendrasId, { diferencia: { tipo: "MONTO", monto: -799.99 } })] }))).toMatchObject({ ok: true });
    expect(await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando({ grupoId: e.grupoIncluidaId, opciones: [] }))).toMatchObject({ ok: false, codigo: "CONFIGURACION_INVALIDA" });
  });

  it("aviso S3, sin bloquear: un REEMPLAZA cuyo insumo no está en la receta central del producto", async () => {
    const harina = await prisma.producto.create({ data: { codigo: "MP_H", nombre: "Hebras", tipo: "MP", unidadStockId: e.unidadId } });
    await prisma.recetaVersion.create({ data: { productoId: teId, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: "1.0000", unidadId: e.unidadId }] } } });
    const r = await fijarAdmisionDeGrupoEnProductoCasoDeUso(actor(), comando());
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.datos.avisos).toEqual(["«Almendras» reemplaza un insumo que la receta de «Té» no tiene: en este producto no reemplaza nada."]);
  });

  it("la Server Action: el operador (sin `producto_opciones_admitidas`) recibe el rechazo; el admin la fija", async () => {
    await mockearUsuarioActual({ id: operadorId, email: "operador@test.com", nombre: null });
    const r = await fijarAdmisionDeGrupoEnProducto({ ...comando() });
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/producto_opciones_admitidas/);
    expect(await prisma.productoAdmiteGrupo.count({ where: { productoId: teId } })).toBe(0);
    await mockearUsuarioActual({ id: e.usuarioId, email: "administrativo@test.com", nombre: null });
    expect(await fijarAdmisionDeGrupoEnProducto({ ...comando() })).toMatchObject({ ok: true });
    expect(await fijarAdmisionDeGrupoEnProducto({ ...comando(), opciones: "todas" })).toEqual({ ok: false, mensaje: "Las opciones no son una lista." });
  });
});
