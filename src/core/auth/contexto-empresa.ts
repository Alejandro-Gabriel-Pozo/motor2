import { z } from "zod";

/**
 * `ContextoEmpresa` — Fase 1.1 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md), forma
 * acordada en `motor2-sesion-decisiones-pre-multitenant-v3.md` (Bloque 7). SOLO el tipo/schema — todavía SIN un
 * `resolverContextoEmpresa()` real: ese necesita `obtenerPertenenciaActiva()` contra los modelos `Empresa`/`UsuarioEmpresa`, que no
 * existen en `prisma/schema.prisma` hasta la Fase A del plan del panel (`plan-panel-gerenciamiento-empresa-sucursal-2026-09-27.md`).
 * Este archivo no lo importa nada todavía — es la evolución PLANEADA de `ContextoUsuario` (`src/core/auth/contexto.ts`, 88 archivos
 * lo consumen hoy), no un reemplazo: `contexto.ts` sigue siendo la fuente real hasta que la Fase A conecte esto.
 *
 * `sucursales[]` con un `rol` por elemento (no dos arrays paralelos `roles[]`/`sucursalIds[]`): hoy un usuario ya puede tener un rol
 * distinto en cada sucursal (`UsuarioSucursal.rolId`) — dos arrays sueltos perderían esa correspondencia.
 *
 * El schema SOLO valida FORMA (cadena de una Server Action, checklist §"Cadena de una Server Action"): que `empresaId` sea de
 * verdad el de la sesión resuelta en el servidor (nunca el que mandó el cliente en el body/query/hidden input) es una guarda de
 * AUTORIZACIÓN aparte, no algo que Zod pueda validar.
 *
 * Superadmin de plataforma (v3 Bloque 4, alcance v1: solo gestiona la plataforma, sin leer datos operativos — sigue sin
 * decidirse el detalle): un superadmin no tiene pertenencia (`UsuarioEmpresa`) en ninguna empresa en particular, así que
 * `sucursales: []` es un estado VÁLIDO de este tipo, no un error — ningún guard futuro debe asumir `sucursales.length > 0`.
 *
 * `rolEmpresa` (decisión del dueño, 2026-09-28 — `Downloads/Motor 2/idea-roles-contextuales-empresa-sucursal-2026-09-28.md`):
 * reemplaza a `esGerenteEmpresa: boolean` del diseño original del checklist — NO conviven. Razón: `esGerente` es dicotómico y
 * un rol contextual ya lo expresa; con los dos campos sueltos, una combinación inconsistente (`rolEmpresa: "auditor"` +
 * `esGerenteEmpresa: true`) sería representable sin que nada la impida. Con un solo campo de rol, el más específico gana por
 * construcción — no hay dos fuentes de verdad que puedan discrepar. `null` = sin rol de empresa (el caso de siempre: acceso
 * solo por `UsuarioSucursal`, sin gerenciamiento cross-sucursal). El nombre "gerente" (no un enum: mismo criterio que
 * `sucursales[].rol`, texto libre para no anticipar qué otros roles de empresa aparezcan) es el único rol de empresa
 * documentado hoy — un chequeo `rolEmpresa === "gerente"` reemplaza el `if (esGerenteEmpresa)` de antes.
 */
export const contextoEmpresaSchema = z.object({
  empresaId: z.string().min(1),
  usuarioId: z.string().min(1),
  rolEmpresa: z.string().min(1).nullable(),
  sucursales: z.array(z.object({ sucursalId: z.string().min(1), rol: z.string().min(1) })),
  sucursalActivaId: z.string().min(1).nullable(),
});

export type ContextoEmpresa = z.infer<typeof contextoEmpresaSchema>;
