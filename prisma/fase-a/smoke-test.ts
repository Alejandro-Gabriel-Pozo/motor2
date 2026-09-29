// Smoke test manual de la Fase A: valida que el Prisma Client aislado
// (node_modules/.prisma/fase-a-client, generado desde prisma/fase-a/schema.prisma)
// funciona de punta a punta contra el Neon dedicado de .env.multitenancy.
// No se ejecuta en CI ni en el gate de verificación real — es una
// herramienta de esta rama mientras el schema todavía no se integra a
// prisma/schema.prisma. Requiere FASE_A_DIRECT_URL en el entorno.
// Se corre con `npx tsx prisma/fase-a/smoke-test.ts` (import de un .ts real
// desde afuera de src/ — .mjs no puede importar TS sin un loader).
import { PrismaClient } from "../../node_modules/.prisma/fase-a-client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { extraerTokenBearer, generarTokenCartaPlano, hashTokenCarta, tokenCoincideConHash } from "../../src/core/carta/token-servicio-empresa";

const adapter = new PrismaPg({ connectionString: process.env.FASE_A_DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const empresa = await prisma.empresa.create({
    data: {
      id: "smoke_empresa_1",
      nombre: "Empresa Smoke Test",
      slug: "empresa-smoke-test",
      zonaHoraria: "America/Argentina/Buenos_Aires",
      moneda: "ARS",
    },
  });
  console.log("Empresa creada:", empresa.id, empresa.estado);

  const sucursal = await prisma.sucursal.create({
    data: { id: "smoke_suc_1", nombre: "Sucursal Smoke", empresaId: empresa.id },
  });
  console.log("Sucursal creada:", sucursal.id, "empresaId:", sucursal.empresaId);

  const usuario = await prisma.user.create({
    data: { id: "smoke_user_1", email: "smoke-fase-a@example.test" },
  });

  const membresia = await prisma.usuarioEmpresa.create({
    data: { usuarioId: usuario.id, empresaId: empresa.id, rolEmpresa: "gerente" },
  });
  console.log("UsuarioEmpresa creada:", membresia.id, "rolEmpresa:", membresia.rolEmpresa);

  const conRelaciones = await prisma.empresa.findUnique({
    where: { id: empresa.id },
    include: { sucursales: true, usuarios: true },
  });
  console.log(
    "Empresa con relaciones -> sucursales:",
    conRelaciones!.sucursales.length,
    "usuarios:",
    conRelaciones!.usuarios.length
  );

  // Carta multisucursal + sincronización de precios (plan del panel, 2.4/2.5).
  const seccion = await prisma.seccionCarta.create({
    data: { id: "smoke_seccion_1", nombre: "Sección Smoke", empresaId: empresa.id },
  });
  console.log("SeccionCarta creada:", seccion.id, "alcance:", seccion.alcance);

  const seccionSucursal = await prisma.seccionCartaSucursal.create({
    data: { empresaId: empresa.id, seccionCartaId: seccion.id, sucursalId: sucursal.id },
  });
  console.log("SeccionCartaSucursal creada:", seccionSucursal.seccionCartaId, seccionSucursal.sucursalId);

  const promo = await prisma.promoCarta.create({
    data: {
      id: "smoke_promo_1",
      empresaId: empresa.id,
      sucursalId: sucursal.id,
      seccionCartaId: seccion.id,
      titulo: "Promo Smoke",
      precio: "100.00",
    },
  });
  console.log("PromoCarta creada:", promo.id, "empresaId:", promo.empresaId);

  const grupo = await prisma.grupoSincroPrecio.create({
    data: { id: "smoke_grupo_1", empresaId: empresa.id, nombre: "Grupo Smoke" },
  });
  const grupoSucursal = await prisma.grupoSincroPrecioSucursal.create({
    data: { empresaId: empresa.id, grupoId: grupo.id, sucursalId: sucursal.id },
  });
  console.log("GrupoSincroPrecio creado:", grupo.id, "sucursal:", grupoSucursal.sucursalId);

  // ADR-005: TokenCartaEmpresa — emitir, resolver por hash, revocar.
  const tokenPlano = generarTokenCartaPlano();
  const token = await prisma.tokenCartaEmpresa.create({
    data: { empresaId: empresa.id, tokenHash: hashTokenCarta(tokenPlano) },
  });
  console.log("TokenCartaEmpresa creado:", token.id, "(el texto plano NUNCA se persiste)");

  // Simula lo que haría autorizarServicioCarta: recibe el header, extrae el token, resuelve la empresa por hash.
  const headerRecibido = `Bearer ${tokenPlano}`;
  const tokenRecibido = extraerTokenBearer(headerRecibido);
  if (!tokenRecibido) throw new Error("extraerTokenBearer falló con un header bien formado");
  const filaResuelta = await prisma.tokenCartaEmpresa.findUnique({ where: { tokenHash: hashTokenCarta(tokenRecibido) } });
  if (!filaResuelta || filaResuelta.revocadoEn !== null || !tokenCoincideConHash(tokenRecibido, filaResuelta.tokenHash)) {
    throw new Error("El token recién emitido debería resolver a su empresa y no lo hizo");
  }
  console.log("Token resuelto -> empresaId:", filaResuelta.empresaId, "(coincide:", filaResuelta.empresaId === empresa.id, ")");

  // Un token con el texto plano correcto pero de OTRA fila (simula un intento de reusar el hash de otra empresa) no debe colar.
  const otroTokenPlano = generarTokenCartaPlano();
  const noDeberiaResolver = await prisma.tokenCartaEmpresa.findUnique({ where: { tokenHash: hashTokenCarta(otroTokenPlano) } });
  if (noDeberiaResolver) throw new Error("Un token nunca emitido no debería resolver ninguna fila");
  console.log("Token nunca emitido: correctamente no resuelve ninguna fila.");

  // Revocar: la fila sigue existiendo (auditoría) pero deja de autorizar.
  const revocado = await prisma.tokenCartaEmpresa.update({ where: { id: token.id }, data: { revocadoEn: new Date() } });
  if (revocado.revocadoEn === null) throw new Error("El token debería quedar revocado");
  console.log("Token revocado:", revocado.id, "revocadoEn:", revocado.revocadoEn?.toISOString());

  await prisma.tokenCartaEmpresa.delete({ where: { id: token.id } });
  await prisma.grupoSincroPrecioSucursal.delete({
    where: { grupoId_sucursalId: { grupoId: grupo.id, sucursalId: sucursal.id } },
  });
  await prisma.grupoSincroPrecio.delete({ where: { id: grupo.id } });
  await prisma.promoCarta.delete({ where: { id: promo.id } });
  await prisma.seccionCartaSucursal.delete({
    where: { seccionCartaId_sucursalId: { seccionCartaId: seccion.id, sucursalId: sucursal.id } },
  });
  await prisma.seccionCarta.delete({ where: { id: seccion.id } });

  await prisma.usuarioEmpresa.delete({ where: { id: membresia.id } });
  await prisma.user.delete({ where: { id: usuario.id } });
  await prisma.sucursal.delete({ where: { id: sucursal.id } });
  await prisma.empresa.delete({ where: { id: empresa.id } });
  console.log("Limpieza OK");
}

main()
  .catch((e) => {
    console.error("SMOKE TEST FALLÓ:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
