# ADR-023: Módulos por empresa desde la consola de plataforma

> Redactado el 2026-10-04. **Estado: implementado (sin migración).** Completa ADR-011, ADR-014 y ADR-015 (qué módulos tiene cada empresa) con la vía normal para cambiarlos:
> la consola. Los planes editables (ADR-013) quedan para después de salir a producción.

## Contexto

El registro `ModuloEmpresa` es la fuente de verdad de los módulos de cada empresa: el guard, el menú y el aviso del shell lo leen y nada más. Hasta ahora solo se escribía con el
script `scripts/modulos-empresa.ts` (`cambiarModulosDeEmpresa`), que exige un `User` existente como autor y deja la auditoría en `RegistroAuditoria` de la empresa. Una empresa
recién confirmada (E6) nace con solo Administración y no había forma cómoda de habilitarle lo contratado.

## Decisión

1. **La consola activa y desactiva módulos vendibles por empresa**, desde `/empresas/[id]/modulos`: una tabla con el estado de cada módulo (Siempre / Activo / Incluido por X / Inactivo /
   Próximamente), lo que se suma al activar, lo que se pierde al desactivar y, si está bloqueado, quién lo bloquea. Cada botón pide confirmación con ese detalle.
2. **Una sola clausura.** La vista (`src/core/modulos/vista-de-modulos.ts`) es cálculo puro sobre `modulosEfectivos`, `modulosQueIncluyen` y `validarCambioDeModulos`: la consola dice lo que
   hará el guard. Una prueba exhaustiva recorre los 512 registros posibles y compara la vista con la clausura.
3. **El cambio y su auditoría son una transacción** (`plataforma/src/servidor/modulos.ts`): cerrojo de la fila de la empresa (`FOR UPDATE`), estado distinto de `DELETING`, validación,
   `upsert` y una fila de `AuditoriaPlataforma` (`modulo-activado` / `modulo-desactivado`, con el administrador como autor, ADR-012 §5). Lo que no cambia no se audita. Desactivar deja
   la fila en `INACTIVO`; la plataforma no tiene DELETE.
4. **Sin migración.** `AuditoriaPlataforma.accion` es texto; `motor2_plataforma` ya tiene SELECT, INSERT y UPDATE sobre `ModuloEmpresa` y la política `escritura_plataforma`.
5. **El resultado sobrevive a su formulario** con el patrón `?hecho=<código>&modulo=<id>`: texto fijo, y el módulo solo se usa si es del catálogo.
6. **Un botón «Activar todos los disponibles»** deja el registro como el backfill; es comodidad, no un plan.
7. **El mail de activación** deja de afirmar qué módulos tiene la empresa: la plataforma puede activarlos antes o después de confirmar.

## Alternativas descartadas

- **Reusar `cambiarModulosDeEmpresa` desde la consola:** firmaría con un `User` técnico y escribiría en la auditoría de la empresa; ADR-012 §5 pide al administrador como autor.
- **Planes primero:** exigen migración, rama de respaldo y ensayo en cada base, y con la migración en el repo el build de la app falla en toda base que no la tenga. No hacen falta para salir.
- **Plan por defecto en el alta:** ADR-011 y ADR-014 dicen que el alta nunca otorga módulos por defecto.

## Consecuencias

- Dos vías de escritura con auditorías distintas: la consola (`AuditoriaPlataforma`) y el script de emergencia (`RegistroAuditoria`). El script queda para emergencias; unificarlo con un autor
  `AdminPlataforma` es un pendiente.
- El gerente no ve en su auditoría los cambios de módulos (coherente con ADR-012 §5); una pantalla de solo lectura «Plan y módulos» queda como mejora.
- Desactivar Carta oculta las pantallas internas, **no la carta pública** (previo a este ADR); el aviso de confirmación habla de «pantallas internas».
- Los cambios rigen en el próximo pedido de los usuarios, sin cerrar sesiones.

## Implementación

`src/core/modulos/vista-de-modulos.ts`, `plataforma/src/servidor/modulos.ts`, `plataforma/src/app/empresas/[id]/modulos/`, acción `cambiarModulo` en `plataforma/src/app/empresas/acciones.ts`.
Pruebas: `test/modulos/vista-de-modulos.test.ts`, `test/persistencia/modulos-desde-la-consola.test.ts` (con el rol real en CI), `test/e2e/consola-modulos.spec.ts`.
