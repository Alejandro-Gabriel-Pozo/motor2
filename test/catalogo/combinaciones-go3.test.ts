import { beforeEach, describe, expect, it, vi } from "vitest";
import { fijarEjesDeCombinacionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-ejes-de-combinacion";
import { guardarCombinacionDeProductoCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/guardar-combinacion-de-producto";
import { crearGrupoDePrecioCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/crear-grupo-de-precio";
import { editarGrupoDePrecioCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/editar-grupo-de-precio";
import { fijarPrecioLocalDeCombinacionCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/fijar-precio-local-de-combinacion";
import { guardComandoFijarPrecioLocalDeCombinacion, guardComandoGuardarCombinacion } from "../../src/core/features/catalogo/combinaciones.guard";
import { preciosLocalesDeCombinacionVigentes } from "../../src/server/lecturas/catalogo/precio-local-de-combinaciones";
import { fijarPrecioLocalDeCombinacion } from "../../src/server/persistencia/catalogo/combinaciones";
import { clienteConEmpresaDePrueba, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { limpiarBaseDeTest, prisma, prismaAdmin, prismaSinEmpresa } from "../setup/test-db";
import { sembrarEscenarioDeOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDeCombos } from "../setup/combos-go3b";
import { AHORA_DE_LA_CORRIDA } from "../setup/tiempo";

/**
 * GO-3b (ADR-032, frente A, paso AB4): la administración del PRECIO POR COMBINACIÓN. Contra Postgres real, como `motor2_app` con el alcance de la sucursal A.
 *  - Ejes: a lo sumo dos grupos admitidos, MEDIDA o VARIANTE de exactamente una opción (`EJES_INVALIDOS`); inmutables mientras haya combinaciones (`EJES_CON_COMBINACIONES`).
 *  - Combinación: sobrescritura dispersa (activa, precio propio O tarifa), identidad estable, control optimista (`VERSION_DESACTUALIZADA`), auditoría por columna.
 *  - Tarifas: nombre único sin mayúsculas, edición optimista, no se desactiva con miembros activos.
 *  - Precio local de una tarifa o una combinación en la sucursal activa: eco, precio esperado, capacidad `precio_local` y RLS por sucursal.
 *  - Concurrencia real (loop de 10, con la guarda contra el falso verde): dos editores de la misma combinación; write skew ejes contra combinación; desactivar la tarifa contra asignarla.
 *
 * Mutaciones demostradas (rojo y revertidas): sacar el chequeo de `tieneCombinaciones` (rojo: «inmutables» y el write skew); sacar el `version: esperada` del `updateMany` de la combinación junto con
 * la comparación de la versión leída (rojo: «dos editores»); sacar el chequeo de miembros al desactivar (rojo: «con miembros» y su write skew).
 */
const ITERACIONES = 10;

describe("el precio por combinación: administración (GO-3b, AB4)", () => {
  let e: EscenarioDeOpciones;
  const actor = () => actorDeCombos(e.usuarioId, e.sucursalA);
  const combinacion = (extra: Record<string, unknown>) => {
    const c = guardComandoGuardarCombinacion({ productoId: e.cafeId, opcionEje1Id: e.chicoId, opcionEje2Id: e.vacaId, versionEsperada: 0, activa: true, ...extra });
    if (!c.ok) throw new Error(c.mensaje);
    return guardarCombinacionDeProductoCasoDeUso(actor(), c.valor);
  };
  const ejes = (eje1GrupoId: string | null, eje2GrupoId: string | null) => fijarEjesDeCombinacionCasoDeUso(actor(), { productoId: e.cafeId, eje1GrupoId, eje2GrupoId });
  const auditoria = (entidad: string) =>
    prismaAdmin.registroAuditoria.findMany({ where: { entidad }, orderBy: [{ creadoEn: "asc" }, { campo: "asc" }], select: { entidadId: true, campo: true, valorAnterior: true, valorNuevo: true, sucursalId: true } });

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
    // La leche, obligatoria de a una en el café: así puede ser el eje 2 (tamaño × leche).
    await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoVarianteId } }, data: { cantidadMinima: 1 } });
  });

  describe("los ejes", () => {
    it("tamaño y leche son los ejes; se auditan por fila; repetir no escribe; sube la versión de lo que admite", async () => {
      const antes = await prisma.productoAdmiteGrupo.findUniqueOrThrow({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoMedidaId } } });
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true, datos: { huboCambio: true } });
      const filas = await prisma.productoAdmiteGrupo.findMany({ where: { productoId: e.cafeId, ejeDeCombinacion: { not: null } }, orderBy: { ejeDeCombinacion: "asc" } });
      expect(filas.map((f) => [f.grupoId, f.ejeDeCombinacion])).toEqual([[e.grupoMedidaId, 1], [e.grupoVarianteId, 2]]);
      expect(filas[0]!.version).toBe(antes.version + 1);
      expect((await auditoria("ProductoAdmiteGrupo")).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([["ejeDeCombinacion", null, "1"], ["ejeDeCombinacion", null, "2"]]);
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true, datos: { huboCambio: false } });
    });

    it("EJES_INVALIDOS: una INCLUIDA, un grupo que no es de una sola opción, un grupo que el producto no admite", async () => {
      expect(await ejes(e.grupoIncluidaId, null)).toMatchObject({ ok: false, codigo: "EJES_INVALIDOS" });
      await prisma.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoVarianteId } }, data: { cantidadMinima: 0 } });
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: false, codigo: "EJES_INVALIDOS" });
      const otro = (await prisma.grupoDeOpciones.create({ data: { nombre: "Otro", tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1 } })).id;
      expect(await ejes(otro, null)).toMatchObject({ ok: false, codigo: "EJES_INVALIDOS" });
      expect(await prisma.productoAdmiteGrupo.count({ where: { ejeDeCombinacion: { not: null } } })).toBe(0);
    });

    it("son INMUTABLES mientras exista una combinación (aunque esté desactivada)", async () => {
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true });
      expect(await combinacion({ activa: false })).toMatchObject({ ok: true });
      expect(await ejes(e.grupoMedidaId, null)).toMatchObject({ ok: false, codigo: "EJES_CON_COMBINACIONES" });
    });
  });

  describe("las combinaciones", () => {
    beforeEach(async () => {
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true });
    });

    it("«el flat white chico no existe»: crear desactivada, después darle precio propio; optimista y auditada por columna", async () => {
      const r = await combinacion({ activa: false });
      expect(r).toMatchObject({ ok: true, datos: { huboCambio: true } });
      const id = r.ok ? r.datos.combinacionId : "";
      expect(await combinacion({ activa: false })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect(await combinacion({ versionEsperada: 1, activa: false })).toMatchObject({ ok: true, datos: { huboCambio: false } });
      expect(await combinacion({ versionEsperada: 1, activa: true, precio: 3800 })).toMatchObject({ ok: true, datos: { huboCambio: true } });
      expect(await prisma.combinacionDeProducto.findUniqueOrThrow({ where: { id } })).toMatchObject({ activa: true, version: 2 });
      expect(Number((await prisma.combinacionDeProducto.findUniqueOrThrow({ where: { id } })).precio)).toBe(3800);
      expect((await auditoria("CombinacionDeProducto")).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
        ["activa", null, "false"],
        ["activa", "false", "true"],
        ["precio", null, "3800"],
      ]);
      expect(await combinacion({ versionEsperada: 1, activa: true, precio: 4000 })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
    });

    it("COMBINACION_INVALIDA: una opción que no es de su eje, la «ninguna», o falta la del eje 2; el guard no deja precio y tarifa juntos", async () => {
      expect(await combinacion({ opcionEje1Id: e.vacaId, opcionEje2Id: e.chicoId })).toMatchObject({ ok: false, codigo: "COMBINACION_INVALIDA" });
      expect(await combinacion({ opcionEje2Id: null })).toMatchObject({ ok: false, codigo: "COMBINACION_INVALIDA" });
      const ninguna = (await prisma.opcionDeGrupo.create({ data: { grupoId: e.grupoVarianteId, nombre: "Sin leche", esNinguna: true, orden: 9 } })).id;
      await prisma.productoAdmiteOpcion.create({ data: { productoId: e.cafeId, opcionId: ninguna } });
      expect(await combinacion({ opcionEje2Id: ninguna })).toMatchObject({ ok: false, codigo: "COMBINACION_INVALIDA" });
      expect(guardComandoGuardarCombinacion({ productoId: e.cafeId, opcionEje1Id: e.chicoId, versionEsperada: 0, activa: true, precio: 10, grupoDePrecioId: "g" }).ok).toBe(false);
      expect(guardComandoGuardarCombinacion({ productoId: e.cafeId, opcionEje1Id: e.chicoId, versionEsperada: 0, activa: true, precio: 10.123 }).ok).toBe(false);
      expect(await prisma.combinacionDeProducto.count()).toBe(0);
    });

    it("con una tarifa: activa sí, desactivada no; una tarifa de otra empresa no existe", async () => {
      const tarifa = await crearGrupoDePrecioCasoDeUso(actor(), { nombre: "Café chico", precio: 2800 });
      const tarifaId = tarifa.ok ? tarifa.datos.grupoDePrecioId : "";
      expect(await combinacion({ grupoDePrecioId: tarifaId })).toMatchObject({ ok: true });
      await prismaAdmin.grupoDePrecio.update({ where: { id: tarifaId }, data: { activo: false } });
      expect(await combinacion({ opcionEje2Id: e.almendrasId, grupoDePrecioId: tarifaId })).toMatchObject({ ok: false, codigo: "GRUPO_DE_PRECIO_INACTIVO" });
      const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
      const ajena = await testigo.grupoDePrecio.create({ data: { nombre: "Ajena", precio: 1000 } });
      expect(await combinacion({ opcionEje2Id: e.almendrasId, grupoDePrecioId: ajena.id })).toMatchObject({ ok: false, codigo: "GRUPO_DE_PRECIO_NO_ENCONTRADO" });
    });

    it("concurrencia real: dos editores sobre la misma versión, uno gana y el otro VERSION_DESACTUALIZADA (loop de 10)", async () => {
      const r = await combinacion({});
      const id = r.ok ? r.datos.combinacionId : "";
      for (let i = 0; i < ITERACIONES; i++) {
        const v = (await prisma.combinacionDeProducto.findUniqueOrThrow({ where: { id } })).version;
        const [a, b] = await Promise.all([combinacion({ versionEsperada: v, precio: 1000 + i }), combinacion({ versionEsperada: v, precio: 2000 + i })]);
        expect([a, b].filter((x) => x.ok), `iteración ${i}: ${a.mensaje} | ${b.mensaje}`).toHaveLength(1);
        expect([a, b].filter((x) => !x.ok).map((x) => (x.ok ? "" : x.codigo))).toEqual(["VERSION_DESACTUALIZADA"]);
        expect((await prisma.combinacionDeProducto.findUniqueOrThrow({ where: { id } })).version).toBe(v + 1);
      }
    });

    it("write skew real: cambiar los ejes contra crear una combinación — nunca queda una combinación con opciones que no son de los ejes (loop de 10)", async () => {
      const intentos = vi.spyOn(prismaSinEmpresa, "$transaction");
      intentos.mockClear();
      let ganoEjes = 0;
      let ganoCombinacion = 0;
      for (let i = 0; i < ITERACIONES; i++) {
        await prismaAdmin.combinacionDeProducto.deleteMany({ where: { productoId: e.cafeId } });
        await prismaAdmin.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId }, data: { ejeDeCombinacion: null } });
        await prismaAdmin.productoAdmiteGrupo.update({ where: { productoId_grupoId: { productoId: e.cafeId, grupoId: e.grupoMedidaId } }, data: { ejeDeCombinacion: 1 } });
        const demora = i % 2 === 0 ? 0 : 15 * i;
        const [cambio, alta] = await Promise.all([
          new Promise((r) => setTimeout(r, demora)).then(() => ejes(e.grupoVarianteId, null)),
          combinacion({ opcionEje2Id: null }),
        ]);
        expect([cambio.ok, alta.ok].filter(Boolean), `iteración ${i}: ${cambio.mensaje} | ${alta.mensaje}`).toHaveLength(1);
        if (cambio.ok) {
          ganoEjes++;
          expect(alta).toMatchObject({ ok: false, codigo: "COMBINACION_INVALIDA" });
        } else {
          ganoCombinacion++;
          expect(cambio).toMatchObject({ ok: false, codigo: "EJES_CON_COMBINACIONES" });
        }
        // Lo confirmado es coherente: toda combinación nombra una opción del grupo que hoy es el eje 1.
        const eje1 = await prisma.productoAdmiteGrupo.findFirstOrThrow({ where: { productoId: e.cafeId, ejeDeCombinacion: 1 } });
        for (const c of await prisma.combinacionDeProducto.findMany({ where: { productoId: e.cafeId }, include: { opcionEje1: true } })) expect(c.opcionEje1.grupoId, `iteración ${i}`).toBe(eje1.grupoId);
      }
      expect(ganoEjes + ganoCombinacion).toBe(ITERACIONES);
      const transacciones = intentos.mock.calls.filter(([primero]) => typeof primero === "function").length;
      expect(transacciones, "en ninguna iteración se cruzaron las dos transacciones: el test no ejercitó SERIALIZABLE").toBeGreaterThan(2 * ITERACIONES);
      intentos.mockRestore();
    });
  });

  describe("las tarifas (grupos de precio)", () => {
    it("crear, nombre único sin mayúsculas, editar optimista y auditado; no se desactiva con combinaciones activas", async () => {
      const r = await crearGrupoDePrecioCasoDeUso(actor(), { nombre: "Café mediano", precio: 3300 });
      const id = r.ok ? r.datos.grupoDePrecioId : "";
      expect(await crearGrupoDePrecioCasoDeUso(actor(), { nombre: "CAFÉ MEDIANO", precio: 1 })).toMatchObject({ ok: false, codigo: "NOMBRE_REPETIDO" });
      expect(await editarGrupoDePrecioCasoDeUso(actor(), { grupoDePrecioId: id, versionEsperada: 1, nombre: "Café mediano", precio: 3500, activo: true })).toMatchObject({ ok: true });
      expect(await editarGrupoDePrecioCasoDeUso(actor(), { grupoDePrecioId: id, versionEsperada: 1, nombre: "Café mediano", precio: 3600, activo: true })).toMatchObject({ ok: false, codigo: "VERSION_DESACTUALIZADA" });
      expect((await auditoria("GrupoDePrecio")).map((f) => [f.campo, f.valorAnterior, f.valorNuevo])).toEqual([
        ["nombre", null, "Café mediano"],
        ["precio", null, "3300"],
        ["precio", "3300", "3500"],
      ]);
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true });
      expect(await combinacion({ grupoDePrecioId: id })).toMatchObject({ ok: true });
      expect(await editarGrupoDePrecioCasoDeUso(actor(), { grupoDePrecioId: id, versionEsperada: 2, nombre: "Café mediano", precio: 3500, activo: false })).toMatchObject({ ok: false, codigo: "GRUPO_DE_PRECIO_CON_MIEMBROS" });
      // Con la combinación desactivada, ya se puede.
      await prismaAdmin.combinacionDeProducto.updateMany({ data: { activa: false } });
      expect(await editarGrupoDePrecioCasoDeUso(actor(), { grupoDePrecioId: id, versionEsperada: 2, nombre: "Café mediano", precio: 3500, activo: false })).toMatchObject({ ok: true });
    });

    it("concurrencia real: dos altas a la vez con el mismo nombre dejan una sola tarifa (loop de 10)", async () => {
      for (let i = 0; i < ITERACIONES; i++) {
        const resultados = await Promise.allSettled([crearGrupoDePrecioCasoDeUso(actor(), { nombre: `Tarifa ${i}`, precio: 100 }), crearGrupoDePrecioCasoDeUso(actor(), { nombre: `TARIFA ${i}`, precio: 200 })]);
        expect(resultados.map((r) => r.status), `iteración ${i}`).toEqual(["fulfilled", "fulfilled"]);
        const valores = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
        expect(valores.filter((v) => v?.ok), `iteración ${i}`).toHaveLength(1);
        expect(valores.filter((v) => v && !v.ok).map((v) => (v && !v.ok ? v.codigo : ""))).toEqual(["NOMBRE_REPETIDO"]);
        expect(await prisma.grupoDePrecio.count({ where: { nombre: { equals: `tarifa ${i}`, mode: "insensitive" } } })).toBe(1);
      }
    });

    it("write skew real: desactivar la tarifa contra asignarla a una combinación — nunca queda una combinación activa con una tarifa inactiva (loop de 10)", async () => {
      expect(await ejes(e.grupoMedidaId, e.grupoVarianteId)).toMatchObject({ ok: true });
      let ganoLaAsignacion = 0;
      for (let i = 0; i < ITERACIONES; i++) {
        const t = await crearGrupoDePrecioCasoDeUso(actor(), { nombre: `Skew ${i}`, precio: 100 });
        const tarifaId = t.ok ? t.datos.grupoDePrecioId : "";
        const opcionEje2Id = i % 2 === 0 ? e.vacaId : e.almendrasId;
        const v = (await prisma.combinacionDeProducto.findFirst({ where: { opcionEje1Id: e.chicoId, opcionEje2Id } }))?.version ?? 0;
        // El orden de llegada se alterna (como en el write skew de GO-2a): en las vueltas impares la baja sale con una demora creciente, así también se ejercita «gana la asignación».
        const demora = i % 2 === 0 ? 0 : 15 * i;
        const [baja, alta] = await Promise.all([
          new Promise((r) => setTimeout(r, demora)).then(() => editarGrupoDePrecioCasoDeUso(actor(), { grupoDePrecioId: tarifaId, versionEsperada: 1, nombre: `Skew ${i}`, precio: 100, activo: false })),
          combinacion({ opcionEje2Id, versionEsperada: v, grupoDePrecioId: tarifaId }),
        ]);
        expect([baja.ok, alta.ok].filter(Boolean), `iteración ${i}: ${baja.mensaje} | ${alta.mensaje}`).toHaveLength(1);
        if (alta.ok) ganoLaAsignacion++;
        const enUso = await prisma.combinacionDeProducto.count({ where: { grupoDePrecioId: tarifaId, activa: true } });
        const tarifa = await prisma.grupoDePrecio.findUniqueOrThrow({ where: { id: tarifaId } });
        expect(tarifa.activo || enUso === 0, `iteración ${i}`).toBe(true);
      }
      expect(ganoLaAsignacion, "ninguna vuelta la ganó la asignación: no se probó que la baja mire los miembros").toBeGreaterThan(0);
      expect(ganoLaAsignacion, "ninguna vuelta la ganó la baja").toBeLessThan(ITERACIONES);
    });
  });

  describe("el precio local de una tarifa o una combinación", () => {
    let tarifaId: string;
    beforeEach(async () => {
      const t = await crearGrupoDePrecioCasoDeUso(actor(), { nombre: "Café grande", precio: 3800 });
      tarifaId = t.ok ? t.datos.grupoDePrecioId : "";
    });
    const fijar = (precio: number | null, esperado: { precio: number; habilitado: boolean } | null) => {
      const c = guardComandoFijarPrecioLocalDeCombinacion({ sucursalId: e.sucursalA, sucursalActivaId: e.sucursalA, grupoDePrecioId: tarifaId, esperado, precio });
      if (!c.ok) throw new Error(c.mensaje);
      return fijarPrecioLocalDeCombinacionCasoDeUso(actor(), c.valor);
    };

    it("se fija en la sucursal activa con el precio esperado, se audita con la sucursal y la baja deshabilita; la lectura respeta la capacidad", async () => {
      expect(await fijar(4000, null)).toMatchObject({ ok: true });
      expect(await fijar(4100, null)).toMatchObject({ ok: false, codigo: "PRECIO_DESACTUALIZADO" });
      expect(await fijar(4100, { precio: 4000, habilitado: true })).toMatchObject({ ok: true });
      const leer = () => preciosLocalesDeCombinacionVigentes(e.sucursalA, prisma, { combinacionIds: [], grupoDePrecioIds: [tarifaId] });
      expect([...(await leer()).porGrupo]).toEqual([[tarifaId, 4100]]);
      await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: e.sucursalA, habilitado: false } });
      expect([...(await leer()).porGrupo]).toEqual([]);
      await prisma.capacidadSucursal.deleteMany({ where: { accionClave: "precio_local" } });
      expect(await fijar(null, { precio: 4100, habilitado: true })).toMatchObject({ ok: true });
      expect([...(await leer()).porGrupo]).toEqual([]);
      expect((await auditoria("PrecioLocalDeCombinacion")).map((f) => [f.entidadId, f.campo, f.valorAnterior, f.valorNuevo, f.sucursalId])).toEqual([
        [`${e.sucursalA}:${tarifaId}`, "precio", null, "4000", e.sucursalA],
        [`${e.sucursalA}:${tarifaId}`, "habilitado", null, "true", e.sucursalA],
        [`${e.sucursalA}:${tarifaId}`, "precio", "4000", "4100", e.sucursalA],
        [`${e.sucursalA}:${tarifaId}`, "habilitado", "true", "false", e.sucursalA],
      ]);
    });

    it("aislamiento: el eco rechaza otra sucursal y la base no deja escribir en B desde el alcance de A (42501)", async () => {
      expect(guardComandoFijarPrecioLocalDeCombinacion({ sucursalId: e.sucursalB, sucursalActivaId: e.sucursalA, grupoDePrecioId: tarifaId, esperado: null, precio: 1 }).ok).toBe(false);
      await expect(
        actor().transaccion((tx) => fijarPrecioLocalDeCombinacion(tx, { sucursalId: e.sucursalB, objetivo: { grupoDePrecioId: tarifaId }, precio: 1, habilitado: true, ahora: AHORA_DE_LA_CORRIDA })),
      ).rejects.toThrow(/row-level security|42501/);
      expect(await prisma.precioLocalDeCombinacion.count()).toBe(0);
    });
  });
});
