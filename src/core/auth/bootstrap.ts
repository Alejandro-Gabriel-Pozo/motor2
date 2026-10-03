import { prisma } from "@/lib/db";
import { obtenerGerenteDeEmpresa } from "@/core/permisos/gerencia";
import { CLAVE_ROL_ADMIN } from "@/core/permisos/jerarquia";
import { ROL_EMPRESA_GERENTE } from "@/core/permisos/rol-empresa";
import { dbDeEmpresa } from "./base";

export function obtenerEmailsBootstrap(): string[] {
  return (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Bootstrap del primer admin del sistema (ver plan, "Bootstrap de admin sin
 * hueco de seguridad"). Se dispara en el evento signIn de Auth.js.
 *
 * Condición doble: (a) el email que hace login está en
 * BOOTSTRAP_ADMIN_EMAILS, Y (b) todavía no existe NINGÚN admin activo en
 * TODA la empresa (chequeo a nivel empresa, no por sucursal; la instalación
 * es multiempresa-capable pero hoy activa una sola, ADR-007). Reproduce la garantía de hoy (Core.js:892-898: solo
 * quien ya tenía acceso de Editor a la planilla podía ser "el primero") de
 * forma explícita en vez de implícita por orden de llegada.
 *
 * Una vez que existe un admin real, esta función deja de tener efecto — la
 * única vía para sumar gente pasa a ser la acción 'gestion_usuarios' (sumar
 * a alguien a una sucursal existente) o 'alta_sucursal' (crear una sucursal
 * nueva con su primer admin).
 *
 * Corre en el evento de login, o sea ANTES de tener empresa: sin contexto de usuario y bajo RLS. Solo opera cuando hay EXACTAMENTE una
 * empresa ACTIVE (la instalación de hoy, ADR-007): esa es la empresa del bootstrap y todo lo demás va con `dbDeEmpresa`. Con dos o más
 * no adivina a cuál sumar al usuario y no hace nada (el primer admin de una empresa nueva lo crea `crear-empresa`).
 */
export async function intentarBootstrapAdmin(usuarioId: string, email: string): Promise<void> {
  const emailsBootstrap = obtenerEmailsBootstrap();
  if (!emailsBootstrap.includes(email.trim().toLowerCase())) return;

  // `Empresa` no tiene RLS: se puede leer sin contexto. `take: 2` alcanza para distinguir "una sola" de "varias".
  const empresasActivas = await prisma.empresa.findMany({ where: { estado: "ACTIVE" }, select: { id: true }, take: 2 });
  if (empresasActivas.length !== 1) return;
  const db = dbDeEmpresa(empresasActivas[0].id);

  // El chequeo "todavía no hay admin" y el rol admin se resuelven DENTRO de esa empresa.
  const sucursal = await db.sucursal.findFirst({ where: { activo: true }, orderBy: { creadoEn: "asc" } });
  // Si el seed todavía no corrió no hay ni rol admin ni sucursal — no hay
  // dónde hacer bootstrap todavía; no es un error, solo "esperar al seed".
  if (!sucursal) return;
  const { empresaId } = sucursal;

  const yaHayAdmin = await db.usuarioSucursal.findFirst({
    where: { activo: true, rol: { clave: CLAVE_ROL_ADMIN, activo: true }, sucursal: { empresaId } },
  });
  if (yaHayAdmin) return;

  const rolAdmin = await db.rol.findFirst({ where: { empresaId, clave: CLAVE_ROL_ADMIN } });
  if (!rolAdmin) return;

  // Las dos pertenencias (empresa y sucursal) van juntas: sin la de empresa el usuario no tendría contexto (contexto.ts).
  // Quien crea la empresa (su primer admin) es su gerente — salvo que ya tenga uno: una empresa tiene un solo gerente. El `update` no pisa un rol que ya tuviera cargado.
  const rolEmpresa = (await obtenerGerenteDeEmpresa(db, empresaId)) ? null : ROL_EMPRESA_GERENTE;
  await db.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId, empresaId } },
    update: { activo: true },
    create: { usuarioId, empresaId, rolEmpresa },
  });
  await db.usuarioSucursal.upsert({
    where: { usuarioId_sucursalId: { usuarioId, sucursalId: sucursal.id } },
    update: { rolId: rolAdmin.id, activo: true },
    create: {
      usuarioId,
      sucursalId: sucursal.id,
      empresaId,
      rolId: rolAdmin.id,
      notas: "Alta automática por bootstrap (BOOTSTRAP_ADMIN_EMAILS).",
    },
  });
}
