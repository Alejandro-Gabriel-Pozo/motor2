import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { baseDeTest, limpiarBaseDeTest, prisma } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { cargarAdmisionDeProducto, cargarGrupoDeOpciones, listarGruposDeOpciones, opcionesApagadasEnSucursal } from "../../src/server/lecturas/catalogo/opciones-de-venta";
import { filaDePrecioLocalDeOpcion, preciosLocalesDeOpcionVigentes } from "../../src/server/lecturas/catalogo/precio-local-de-opciones";

/**
 * GO-2a, paso 5: las LECTURAS del catálogo de opciones de venta y de la grilla de precios por sucursal, contra Postgres real y como `motor2_app` (el camino de la app, sujeto a la RLS).
 *  - La versión VIGENTE es la de número mayor aunque las versiones se carguen en desorden (derivada, sin bandera).
 *  - Otra empresa no ve nada (RLS `aislamiento_empresa`); la sucursal B no se ve desde el alcance de A (políticas por sucursal de GO-1c).
 *  - La grilla rige solo con la capacidad `precio_local`, la fila habilitada, la admisión activa y la opción MEDIDA en modo ABSOLUTO.
 *  - Sin N+1: la cantidad de consultas no crece con la cantidad de grupos y opciones.
 */
describe("lecturas del catálogo de opciones de venta (GO-2a)", () => {
  let e: EscenarioDeOpciones;
  const comoA = () => baseDeTest({ lectura: [e.sucursalA], escritura: [e.sucursalA] }).db;

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  it("la vigente es la de número MAYOR aunque las versiones se carguen en desorden; el historial va de la mayor a la menor", async () => {
    // Al «Grande» (versión 1 sembrada) se le cargan la 3 y después la 2.
    await prisma.versionDeOpcion.create({ data: { opcionId: e.grandeId, numero: 3, tipoDeDiferencia: "PORCENTAJE", porcentaje: "12.5000", creadoPorId: e.usuarioId } });
    await prisma.versionDeOpcion.create({ data: { opcionId: e.grandeId, numero: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "120.00", factorEscala: "1.7500", creadoPorId: e.usuarioId } });

    const grupos = await listarGruposDeOpciones(comoA(), { incluirInactivos: true });
    const grande = grupos.find((g) => g.id === e.grupoMedidaId)!.opciones.find((o) => o.id === e.grandeId)!;
    expect(grande.vigente).toMatchObject({ numero: 3, tipoDeDiferencia: "PORCENTAJE", porcentaje: 12.5, diferenciaPrecio: null, factorEscala: null });

    const detalle = await cargarGrupoDeOpciones(comoA(), e.grupoMedidaId);
    expect(detalle!.opciones.find((o) => o.id === e.grandeId)!.versiones.map((v) => v.numero)).toEqual([3, 2, 1]);
    expect(detalle!.opciones.find((o) => o.id === e.grandeId)!.versiones[1]).toMatchObject({ diferenciaPrecio: 120, factorEscala: 1.75 });
  });

  it("lista los cuatro grupos con sus opciones, la versión vigente con sus consumos y cuántos productos los admiten; `incluirInactivos: false` deja afuera lo apagado", async () => {
    await prisma.opcionDeGrupo.update({ where: { id: e.vacaId }, data: { activa: false } });
    await prisma.grupoDeOpciones.update({ where: { id: e.grupoIncluidaId }, data: { activo: false } });

    const todos = await listarGruposDeOpciones(comoA(), { incluirInactivos: true });
    expect(todos.map((g) => g.nombre)).toEqual(["Extras", "Leche", "Tamaño", "Viene con"]);
    expect(todos.every((g) => g.productosQueLoAdmiten === 1)).toBe(true);
    const leche = todos.find((g) => g.id === e.grupoVarianteId)!;
    expect(leche.opciones.map((o) => o.nombre)).toEqual(["De vaca", "Almendras"]);
    expect(leche.opciones[1]!.vigente!.consumos).toEqual([
      expect.objectContaining({ efecto: "REEMPLAZA", insumoProductoId: e.almendrasInsumoId, reemplazaAProductoId: e.lecheId, cantidad: 0.2, mermaPorcentaje: 0, orden: 0 }),
    ]);
    const extras = todos.find((g) => g.id === e.grupoAdicionalId)!;
    expect(extras.opciones[0]).toMatchObject({ nombre: "Shot extra", productoId: e.anclaDelShotId, version: 1 });

    const activos = await listarGruposDeOpciones(comoA(), { incluirInactivos: false });
    expect(activos.map((g) => g.nombre)).toEqual(["Extras", "Leche", "Tamaño"]);
    expect(activos.find((g) => g.id === e.grupoVarianteId)!.opciones.map((o) => o.nombre)).toEqual(["Almendras"]);
  });

  it("la admisión de un producto: cada grupo con sus opciones admitidas, sus montos en número y la versión de cada fila", async () => {
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
    await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: e.grandeId }, data: { precioAbsoluto: "1500.50" } });
    const admision = await cargarAdmisionDeProducto(comoA(), e.cafeId);
    expect(admision.map((g) => g.grupo.nombre)).toEqual(["Tamaño", "Leche", "Viene con", "Extras"]);
    const tamano = admision[0]!;
    expect(tamano).toMatchObject({ modoPrecio: "ABSOLUTO", version: 1, activo: true });
    expect(tamano.opciones.map((o) => o.opcion.nombre).sort()).toEqual(["Chico", "Grande", "Mediano"]);
    expect(tamano.opciones.find((o) => o.opcionId === e.grandeId)).toMatchObject({ precioAbsoluto: 1500.5, version: 1 });
    expect(await cargarAdmisionDeProducto(comoA(), "no-existe")).toEqual([]);
  });

  it("otra empresa no ve NADA del catálogo (RLS por empresa): ni su lista, ni un grupo por id, ni la admisión de su producto", async () => {
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Grupo ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const deA = await listarGruposDeOpciones(comoA(), { incluirInactivos: true });
    expect(deA.map((g) => g.id)).not.toContain(ajeno.id);
    expect(await cargarGrupoDeOpciones(comoA(), ajeno.id)).toBeNull();

    const delTestigo = await listarGruposDeOpciones(testigo, { incluirInactivos: true });
    expect(delTestigo.map((g) => g.id)).toEqual([ajeno.id]);
    expect(await cargarGrupoDeOpciones(testigo, e.grupoMedidaId)).toBeNull();
    expect(await cargarAdmisionDeProducto(testigo, e.cafeId)).toEqual([]);
  });

  it("lo apagado en la sucursal B no se ve desde el alcance de A, aunque se pida por el id de B (política por sucursal, como motor2_app)", async () => {
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: e.sucursalA, opcionId: e.vacaId, apagada: true, actualizadoPorId: e.usuarioId } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: e.sucursalA, opcionId: e.azucarId, apagada: false, actualizadoPorId: e.usuarioId } });
    await prisma.opcionApagadaEnSucursal.create({ data: { sucursalId: e.sucursalB, opcionId: e.almendrasId, apagada: true, actualizadoPorId: e.usuarioId } });

    expect((await opcionesApagadasEnSucursal(comoA(), e.sucursalA)).map((f) => f.opcionId)).toEqual([e.vacaId]);
    expect(await opcionesApagadasEnSucursal(comoA(), e.sucursalB)).toEqual([]);
    const comoB = baseDeTest({ lectura: [e.sucursalB], escritura: [e.sucursalB] }).db;
    expect((await opcionesApagadasEnSucursal(comoB, e.sucursalB)).map((f) => f.opcionId)).toEqual([e.almendrasId]);
  });

  describe("la grilla de precios de una opción en la sucursal (preciosLocalesDeOpcionVigentes)", () => {
    beforeEach(async () => {
      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
      await prisma.precioLocalDeOpcion.create({ data: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.grandeId, precio: "1800.00" } });
      await prisma.precioLocalDeOpcion.create({ data: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.chicoId, precio: "800.00", habilitado: false } });
    });

    it("rige la fila habilitada de una MEDIDA en ABSOLUTO admitida; la deshabilitada no; la de B no se ve desde A", async () => {
      await prisma.precioLocalDeOpcion.create({ data: { sucursalId: e.sucursalB, productoId: e.cafeId, opcionId: e.medianoId, precio: "999.00" } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map([[e.grandeId, 1800]]));
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalB, comoA(), e.cafeId)).toEqual(new Map());
      expect(await filaDePrecioLocalDeOpcion(comoA(), { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.chicoId })).toEqual({ precio: 800, habilitado: false });
      expect(await filaDePrecioLocalDeOpcion(comoA(), { sucursalId: e.sucursalB, productoId: e.cafeId, opcionId: e.medianoId })).toBeNull();
    });

    it("sin la capacidad `precio_local` en la sucursal no rige ninguna fila", async () => {
      await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: e.sucursalA, habilitado: false } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map());
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId, true)).toEqual(new Map([[e.grandeId, 1800]]));
    });

    it("no rige si el producto ya no admite la opción o el grupo, si el grupo pasa a DIFERENCIA, ni para una opción que no es MEDIDA", async () => {
      await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: e.grandeId }, data: { activo: false } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map());
      await prisma.productoAdmiteOpcion.updateMany({ where: { productoId: e.cafeId, opcionId: e.grandeId }, data: { activo: true } });

      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { activo: false } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map());
      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { activo: true, modoPrecio: "DIFERENCIA" } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map());

      await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoMedidaId }, data: { modoPrecio: "ABSOLUTO" } });
      await prisma.precioLocalDeOpcion.create({ data: { sucursalId: e.sucursalA, productoId: e.cafeId, opcionId: e.almendrasId, precio: "500.00" } });
      expect(await preciosLocalesDeOpcionVigentes(e.sucursalA, comoA(), e.cafeId)).toEqual(new Map([[e.grandeId, 1800]]));
    });
  });

  it("sin N+1: listar el catálogo hace la MISMA cantidad de consultas con 4 grupos que con 12 (y con el triple de opciones)", async () => {
    const medir = async () => {
      const consultas: string[] = [];
      const contador = prisma.$extends({
        query: {
          $allOperations({ model, operation, args, query }) {
            consultas.push(`${model ?? ""}.${operation}`);
            return query(args);
          },
        },
      }) as unknown as PrismaClient;
      await listarGruposDeOpciones(contador, { incluirInactivos: true });
      return consultas.length;
    };
    const conCuatro = await medir();
    for (let i = 0; i < 8; i++) {
      const g = await prisma.grupoDeOpciones.create({ data: { nombre: `Grupo extra ${i}`, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
      for (let j = 0; j < 3; j++) {
        const o = await prisma.opcionDeGrupo.create({ data: { grupoId: g.id, nombre: `Opción ${j}` } });
        await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: "0.00", creadoPorId: e.usuarioId } });
      }
    }
    expect(await medir()).toBe(conCuatro);
    expect(conCuatro).toBeLessThanOrEqual(1);
  });
});
