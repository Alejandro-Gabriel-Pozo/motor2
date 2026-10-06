# ADR-003: Adopción de Zod (comandos y fronteras nuevas)

> Redactado el 2026-09-28, dentro de la Fase 1.1 del checklist de
> multi-tenancy (`Downloads/Motor 2/motor2-multitenancy-checklist (1).md`).
> El contenido ya estaba decidido por el dueño (2026-09-27) — este documento
> lo redacta como ADR formal, cerrando el pendiente "ADR de Zod... falta
> redactarlos" de `00-introduccion-multitenancy-empresa.md`, sección 6.

## Contexto

`docs/plan-validacion-de-datos-2026-09-25.md` (sección 4) había decidido
antes **"sin Zod ni dependencias nuevas"**: Zod no interpreta el formato de
número que usa la UI ("1.234,56"), el proyecto ya tiene su propio
`Resultado<T>`/`ResultadoAccion`, y `zod` no estaba en `package.json`. Esa
decisión preveía reconsiderarse más adelante.

Con la segunda refactorización (multi-tenancy) se necesita `ContextoEmpresa`
validado como una frontera nueva y explícita (Fase 1.1), y varias fronteras
más nacerán desde cero (provisioning de empresa, invitaciones). El dueño
reabrió la decisión el 2026-09-27.

## Decisión

**Se emplea Zod**, con alcance acotado:

- Zod **solo valida FORMA** (tipo, estructura, longitud) — nunca reglas de
  negocio ni autorización. Esas siguen viviendo en los guards, como hoy.
- Se aplica a **comandos y fronteras NUEVAS** — no se migra retroactivamente
  ningún comando ya existente. Los parsers de `src/core/datos/` (ej.
  `validarImporte`, que sí entiende "1.234,56") **no se reemplazan** — se
  envuelven con `.transform()`/`.refine()` cuando un schema Zod nuevo
  necesita ese formato, en vez de reimplementar el parseo.
- El error de Zod se traduce a `ResultadoAccion`/`ResultadoCaso` — nunca se
  expone crudo al cliente.
- Orden en la cadena de una Server Action (decidido 2026-09-28): contexto →
  autorización (`conPermiso`, primera línea) → Zod → comando → guard del
  comando → caso de uso. Para una entrada externa sin sesión (webhook,
  importación) Zod va primero, porque no hay actor que autorizar antes.
- `next-safe-action` sigue **descartado** (ya evaluado en
  `docs/plan-validacion-de-datos-2026-09-25.md`, sección 4: choca con
  `ResultadoAccion`, con `conPermiso` como primera línea y con los tests de
  arquitectura existentes).

Primer uso real: `contextoEmpresaSchema`
(`src/core/auth/contexto-empresa.ts`, Fase 1.1) — solo el schema/tipo por
ahora, sin un resolvedor real todavía (depende de `Empresa`/`UsuarioEmpresa`,
Fase A). **Actualización:** ese archivo se eliminó en A4 (`9548e73`, ADR-007):
`ContextoUsuario` (`src/core/auth/contexto.ts`) absorbió a `ContextoEmpresa`.
La decisión de adoptar Zod en las fronteras nuevas sigue vigente.

## Alternativas consideradas

- **Seguir sin Zod, con validadores propios para cada frontera nueva**:
  descartada — cada frontera nueva (provisioning de empresa, invitaciones,
  `ContextoEmpresa`) repetiría a mano lo que Zod ya resuelve bien (formas
  anidadas, mensajes de error consistentes, inferencia de tipos desde el
  schema).
- **Migrar TODO el proyecto a Zod de una vez**: descartada — reescribir los
  ~110 comandos/guards existentes que ya funcionan (`docs/plan-validacion-
  de-datos-2026-09-25.md`) no aporta nada hoy y es puro riesgo de romper
  algo que ya está probado. Zod se suma donde hace falta, no reemplaza lo
  que ya anda.
- **`next-safe-action`/tRPC en vez de Zod suelto**: descartada — `next-safe-
  action` ya fue evaluado y rechazado por chocar con el patrón de
  `ResultadoAccion`/`conPermiso`/tests de arquitectura de este proyecto;
  tRPC no fue evaluado, no hay necesidad concreta que lo justifique.

## Consecuencias

- Las fronteras nuevas (empresa, invitaciones, provisioning) ganan
  validación de forma consistente y tipos inferidos desde el schema, sin
  reescribir nada existente.
- Zod queda como una dependencia de producción nueva del proyecto —
  confirmado instalado (`zod@^4.6.5`) y compatible con Next 16/React 19 en
  este repo (verificado empíricamente el 2026-09-28: `tsc --noEmit`, build y
  suite completa limpios con la dependencia agregada — el propio checklist
  marcaba esto como "no verificado" antes de este ADR).
- Ningún comando existente cambia de comportamiento por esta decisión: es
  aditiva, no retroactiva.

## Revisar cuando

Si en algún momento se decide migrar retroactivamente los comandos
existentes a Zod (hoy explícitamente fuera de alcance), o si aparece una
necesidad concreta de type-safety end-to-end cliente↔servidor que Zod solo
no resuelve (ahí sí valdría reevaluar `next-safe-action`/tRPC desde cero).
