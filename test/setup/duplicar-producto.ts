import { randomUUID } from "node:crypto";
import { crearMembresia } from "./membresia";
import { crearUsuarioConMembresia, prisma, sembrarBase, sembrarCatalogoBase } from "./test-db";

/**
 * El escenario de los tests de «Duplicar producto» (E4, docs/diseno-duplicar-producto-2026-11-12.md): el caso del dueño, «Bife a criolla» → «Bife con chimichurri». Una empresa con dos sucursales (Central y
 * Norte, el administrador pertenece a las dos), un producto de venta con su ficha completa y un precio, una receta central (dos ingredientes, un sustituto, dos pasos que nombran ingredientes y la ficha técnica) y
 * dos grupos de la biblioteca que el producto admite (uno con precio por opción), más un grupo archivado que también admite. Todo sembrado con el cliente de pruebas (`prisma`), sin pasar por las acciones.
 */
export interface EscenarioDelBife {
  centralId: string;
  norteId: string;
  adminId: string;
  rolAdminId: string;
  kgId: string;
  gId: string;
  categoriaId: string;
  insumoId: string;
  /** «Bife a criolla»: el producto que se duplica. */
  bifeId: string;
  /** Las materias primas de la receta. */
  carneId: string;
  salId: string;
  /** El grupo «Guarnición» (con dos opciones, una con precio propio en el producto) y el grupo «Salsas» (con una). */
  grupoGuarnicionId: string;
  papasId: string;
  ensaladaId: string;
  grupoSalsasId: string;
  chimichurriId: string;
  /** Un grupo archivado en la biblioteca que el producto todavía admite. */
  grupoArchivadoId: string;
}

export const NOMBRE_DEL_BIFE = "Bife a criolla";

export async function sembrarElBife(): Promise<EscenarioDelBife> {
  const base = await sembrarBase();
  const norte = await prisma.sucursal.create({ data: { nombre: "Norte" } });
  const { kg, g, categoria, insumo } = await sembrarCatalogoBase();
  const admin = await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: base.sucursal.id, rolId: base.admin.id });
  await crearMembresia({ usuarioId: admin.id, sucursalId: norte.id, rolId: base.admin.id });

  const sucursalIds = [base.sucursal.id, norte.id];
  const producto = async (codigo: string, nombre: string, tipo: "MP" | "PV", extra: Record<string, unknown> = {}) => {
    const p = await prisma.producto.create({ data: { codigo, nombre, tipo, unidadStockId: kg.id, ...extra } });
    for (const sucursalId of sucursalIds) await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: p.id, disponible: true } });
    return p;
  };
  const carne = await producto("MP_CARNE", "Carne de bife", "MP");
  const sal = await producto("MP_SAL", "Sal fina", "MP");
  const bife = await producto("PV_BIFE", NOMBRE_DEL_BIFE, "PV", {
    categoriaId: categoria.id,
    precioVenta: "5000.00",
    observaciones: "Se sirve a punto",
    alicuotaIvaVenta: "IVA_21",
    pasoVenta: "0.5000",
    factorConversion: "1.0000",
  });

  // La receta central: dos ingredientes (el primero con un sustituto), dos pasos que nombran ingredientes y la ficha técnica.
  await prisma.recetaVersion.create({
    data: {
      productoId: bife.id,
      version: 1,
      rendimientoCantidad: "1.0000",
      rendimientoUnidadId: kg.id,
      racionesCantidad: 1,
      tiempoPreparacionMinutos: 10,
      tiempoCoccionMinutos: 8,
      comentarios: "Sellar fuerte",
      presentacionEmplatado: "Sobre la parrilla",
      notasAdicionales: "Reposar dos minutos",
      equipamientoNecesario: "Plancha",
      ingredientes: {
        create: [
          { insumoProductoId: carne.id, cantidad: "0.3000", unidadId: kg.id, mermaPorcentaje: "5.00", observaciones: "Corte alto", sustitutos: { create: [{ insumoSustitutoId: insumo.id, orden: 1 }] } },
          { insumoProductoId: sal.id, cantidad: "0.0100", unidadId: kg.id, mermaPorcentaje: "0" },
        ],
      },
    },
  });
  const v1 = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: bife.id }, include: { ingredientes: true } });
  const ingrediente = (productoId: string) => v1.ingredientes.find((i) => i.insumoProductoId === productoId)!;
  const paso1 = await prisma.recetaPaso.create({ data: { recetaVersionId: v1.id, orden: 1, nombre: "Sellar", instruccion: "Sellar el bife de carne", minutos: 4 } });
  const paso2 = await prisma.recetaPaso.create({ data: { recetaVersionId: v1.id, orden: 2, nombre: "Salar", instruccion: "Salar al servir" } });
  await prisma.recetaPasoIngrediente.create({ data: { recetaPasoId: paso1.id, recetaIngredienteId: ingrediente(carne.id).id } });
  await prisma.recetaPasoIngrediente.create({ data: { recetaPasoId: paso2.id, recetaIngredienteId: ingrediente(sal.id).id } });

  // Lo que admite: «Guarnición» (Papas con el precio de la biblioteca; Ensalada con un precio propio en este producto), «Salsas» (una opción) y un grupo archivado.
  const grupo = async (nombre: string, activo = true) => (await prisma.grupoDeOpciones.create({ data: { nombre, tipo: "VARIANTE", cantidadMinima: 0, cantidadMaxima: 1, activo } })).id;
  const opcion = async (grupoId: string, nombre: string, orden: number, diferencia: string) => {
    const o = await prisma.opcionDeGrupo.create({ data: { grupoId, nombre, orden } });
    await prisma.versionDeOpcion.create({ data: { opcionId: o.id, numero: 1, tipoDeDiferencia: "MONTO", diferenciaPrecio: diferencia, creadoPorId: admin.id } });
    return o.id;
  };
  const grupoGuarnicionId = await grupo("Guarnición");
  const papasId = await opcion(grupoGuarnicionId, "Papas fritas", 1, "300.00");
  const ensaladaId = await opcion(grupoGuarnicionId, "Ensalada mixta", 2, "0.00");
  const grupoSalsasId = await grupo("Salsas");
  const chimichurriId = await opcion(grupoSalsasId, "Chimichurri", 1, "0.00");
  const grupoArchivadoId = await grupo("Salsa vieja", false);
  await opcion(grupoArchivadoId, "Barbacoa", 1, "0.00");
  await prisma.productoAdmiteGrupo.create({ data: { productoId: bife.id, grupoId: grupoGuarnicionId, orden: 1, cantidadMinima: 0, cantidadMaxima: 1, seMuestraEnCarta: true } });
  await prisma.productoAdmiteGrupo.create({ data: { productoId: bife.id, grupoId: grupoSalsasId, orden: 2, cantidadMinima: 0, cantidadMaxima: 1, seMuestraEnCarta: false } });
  await prisma.productoAdmiteGrupo.create({ data: { productoId: bife.id, grupoId: grupoArchivadoId, orden: 3, cantidadMinima: 0, cantidadMaxima: 1 } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: bife.id, opcionId: papasId, cantidadMaxima: 1 } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: bife.id, opcionId: ensaladaId, cantidadMaxima: 2, tipoDeDiferencia: "MONTO", diferenciaPrecio: "450.00" } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: bife.id, opcionId: chimichurriId, cantidadMaxima: 1 } });
  const barbacoa = await prisma.opcionDeGrupo.findFirstOrThrow({ where: { grupoId: grupoArchivadoId } });
  await prisma.productoAdmiteOpcion.create({ data: { productoId: bife.id, opcionId: barbacoa.id, cantidadMaxima: 1 } });

  return {
    centralId: base.sucursal.id,
    norteId: norte.id,
    adminId: admin.id,
    rolAdminId: base.admin.id,
    kgId: kg.id,
    gId: g.id,
    categoriaId: categoria.id,
    insumoId: insumo.id,
    bifeId: bife.id,
    carneId: carne.id,
    salId: sal.id,
    grupoGuarnicionId,
    papasId,
    ensaladaId,
    grupoSalsasId,
    chimichurriId,
    grupoArchivadoId,
  };
}

/** Un id de duplicado con la forma que genera la pantalla (un UUID): único por llamada. */
export function nuevoDuplicadoId(): string {
  return randomUUID();
}
