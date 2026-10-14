import { beforeEach, describe, expect, it } from "vitest";
import { limpiarBaseDeTest, prisma } from "../setup/test-db";
import { EMPRESA_TESTIGO_ID, clienteConEmpresaDePrueba } from "../setup/empresa-de-prueba";
import { urlDeSembradoDeVitest } from "../setup/rol-de-pruebas";
import { sembrarEscenarioDeOpciones, sembrarLineaConOpciones, type EscenarioDeOpciones } from "../setup/opciones";
import { actorDePrueba } from "../setup/opciones-de-venta";
import { AHORA_DE_LA_CORRIDA, DIA_MS } from "../setup/tiempo";
import { lecturaDeVerificacionEnLaEmpresa } from "../../src/server/acceso/alcance";
import { listarCandidatosALimpiar } from "../../src/server/consultas/catalogo/limpieza-de-opciones";
import { archivarOpcionesCasoDeUso } from "../../src/server/actions/catalogo/casos-de-uso/archivar-opciones";

/**
 * OPCIONES-LIMPIEZA (G2): la consulta de «Limpiar» (`listarCandidatosALimpiar`) contra Postgres real, como `motor2_app` y con la RLS por sucursal. Fija: qué productos «usan» un grupo
 * y una opción (admisión activa y producto disponible en ALGUNA sucursal), los períodos de ventas (30, 90, 180 días), que lo archivado no aparece, que con la base de VERIFICACIÓN se ven
 * las ventas de OTRA sucursal (con la de la sucursal activa no: por eso la página la usa) y que nada de otra empresa se cuela.
 */
describe("la consulta de «Limpiar» (OPCIONES-LIMPIEZA)", () => {
  let e: EscenarioDeOpciones;
  const enA = () => actorDePrueba(e.usuarioId, e.sucursalA);
  const deVerificacion = async () => (await lecturaDeVerificacionEnLaEmpresa(enA())).db;
  const grupo = (d: Awaited<ReturnType<typeof listarCandidatosALimpiar>>, id: string) => d.grupos.find((g) => g.id === id);
  const opcion = (d: Awaited<ReturnType<typeof listarCandidatosALimpiar>>, grupoId: string, opcionId: string) => grupo(d, grupoId)?.opciones.find((o) => o.id === opcionId);

  /** Una venta de «De vaca» en la cuenta dada, hace `dias` días. */
  const vender = async (cuentaId: string, dias: number) => {
    const linea = await sembrarLineaConOpciones(cuentaId, e);
    await prisma.opcionElegidaEnLinea.create({
      data: {
        cuentaItemId: linea.id,
        grupoId: e.grupoVarianteId,
        opcionId: e.vacaId,
        versionDeOpcionId: e.versionDe[e.vacaId]!,
        tipoGrupo: "VARIANTE",
        nombreGrupo: "Leche",
        nombreOpcion: "De vaca",
        importeUnitario: "0.00",
        creadoEn: new Date(AHORA_DE_LA_CORRIDA.getTime() - dias * DIA_MS),
      },
    });
  };

  beforeEach(async () => {
    await limpiarBaseDeTest();
    e = await sembrarEscenarioDeOpciones();
  });

  it("un producto usa un grupo si está disponible en ALGUNA sucursal; sin eso, el grupo queda «sin productos»", async () => {
    let d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(grupo(d, e.grupoVarianteId)?.productoIds, "el café no está disponible en ninguna sucursal").toEqual([]);

    await prisma.disponibilidadProducto.create({ data: { sucursalId: e.sucursalB, productoId: e.cafeId, disponible: true } });
    d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(grupo(d, e.grupoVarianteId)?.productoIds, "disponible en la OTRA sucursal: lo usa").toEqual([e.cafeId]);
    expect(opcion(d, e.grupoVarianteId, e.almendrasId)?.productoIds).toEqual([e.cafeId]);
    expect(d.nombresDeProductos[e.cafeId]).toBe("Café");

    // Quitado el grupo del producto, sus opciones ya no cuentan para ese producto aunque la fila de la opción siga activa.
    await prisma.productoAdmiteGrupo.updateMany({ where: { productoId: e.cafeId, grupoId: e.grupoVarianteId }, data: { activo: false } });
    d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(grupo(d, e.grupoVarianteId)?.productoIds).toEqual([]);
    expect(opcion(d, e.grupoVarianteId, e.almendrasId)?.productoIds).toEqual([]);
  });

  it("los períodos de ventas: una venta de hace 100 días cuenta para 180 y no para 90 ni 30; una de hace 200, para ninguno", async () => {
    await vender(e.cuentaAId, 200);
    let d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(opcion(d, e.grupoVarianteId, e.vacaId)?.ventas).toEqual({ d30: false, d90: false, d180: false });
    await vender(e.cuentaAId, 100);
    d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(opcion(d, e.grupoVarianteId, e.vacaId)?.ventas).toEqual({ d30: false, d90: false, d180: true });
    await vender(e.cuentaAId, 10);
    d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(opcion(d, e.grupoVarianteId, e.vacaId)?.ventas).toEqual({ d30: true, d90: true, d180: true });
    expect(opcion(d, e.grupoVarianteId, e.almendrasId)?.ventas, "otra opción del grupo no se contagia").toEqual({ d30: false, d90: false, d180: false });
  });

  it("con la base de VERIFICACIÓN se ven las ventas de OTRA sucursal; con la de la sucursal activa no (por eso la página usa la de verificación)", async () => {
    await vender(e.cuentaBId, 5);
    const conVerificacion = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(opcion(conVerificacion, e.grupoVarianteId, e.vacaId)?.ventas.d30).toBe(true);
    const soloA = await listarCandidatosALimpiar(enA().db, AHORA_DE_LA_CORRIDA);
    expect(opcion(soloA, e.grupoVarianteId, e.vacaId)?.ventas.d30, "la base de la sucursal A no ve la venta de B").toBe(false);
  });

  it("lo archivado no aparece (ya está limpio), y nada de otra empresa se cuela", async () => {
    await archivarOpcionesCasoDeUso(enA(), { grupoIds: [e.grupoAdicionalId], opcionIds: [e.chicoId], archivar: true });
    const testigo = clienteConEmpresaDePrueba(urlDeSembradoDeVitest(), EMPRESA_TESTIGO_ID);
    const ajeno = await testigo.grupoDeOpciones.create({ data: { nombre: "Ajeno", tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1 } });
    const d = await listarCandidatosALimpiar(await deVerificacion(), AHORA_DE_LA_CORRIDA);
    expect(d.grupos.map((g) => g.id)).not.toContain(e.grupoAdicionalId);
    expect(d.grupos.map((g) => g.id)).not.toContain(ajeno.id);
    expect(grupo(d, e.grupoMedidaId)?.opciones.map((o) => o.id)).toEqual([e.medianoId, e.grandeId]);
  });
});
