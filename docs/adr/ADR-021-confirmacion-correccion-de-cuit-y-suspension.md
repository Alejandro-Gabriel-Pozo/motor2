# ADR-021: Confirmar el alta, corregir el CUIT, suspender y reactivar una empresa

> Redactado el 2026-10-04 (paso E6 del plan de plataforma). **Estado: implementado en el código, sin migración de base.** Concreta ADR-012 §6 y continúa a ADR-020
> (E5): la empresa que el gerente aceptó queda en alta hasta que la plataforma confirma su CUIT. Corrige dos puntos de ADR-020 y uno de ADR-017 (ver «Correcciones a otros ADR»).

## Contexto

Después de E5 una empresa está `PROVISIONING`, su gerente aceptó la invitación y **declaró** un CUIT (`Invitacion.cuitDeclarado`), pero la empresa no tiene CUIT confirmado ni da
acceso (solo las `ACTIVE` lo dan, `src/core/auth/contexto.ts`). E6 le da a la plataforma tres cosas: **confirmar** el alta, **corregir** el CUIT y **suspender o reactivar**.

El CUIT importa porque ARCA tiene dos ambientes, homologación y producción, y los certificados de AMBOS se emiten para el CUIT real. Con el certificado de homologación se
verifica el CUIT y, si hace falta, se corrige; recién una factura autorizada en producción lo fija para siempre (decisión del dueño, 2026-10-04).

## Decisión

### 1. Confirmar el alta (`PROVISIONING → ACTIVE`)

`confirmarAltaDeEmpresa` (`plataforma/src/servidor/ciclo-de-vida.ts`), en una transacción: toma el cerrojo de la fila de la empresa (`FOR UPDATE`), exige que siga en alta y que su
invitación esté aceptada con CUIT declarado, valida el CUIT (E2), pasa la empresa a `ACTIVE` con un `UPDATE` condicional, copia el CUIT a `Empresa.cuit` y escribe la
auditoría (`empresa-confirmada`, con el CUIT confirmado, el declarado y si difieren). No hace falta `SERIALIZABLE`: las carreras sobre la misma fila las serializan el cerrojo y
el `UPDATE` condicional, y la única regla entre filas —el CUIT es único— la garantiza el índice `Empresa_cuit_key`.

- **Revisión humana:** hay que tildar «revisé el CUIT contra la constancia de ARCA». Si el CUIT que se confirma difiere del declarado, además se acepta expresamente (queda auditado).
- **CUIT repetido:** dos empresas pueden DECLARAR el mismo CUIT mientras ninguna esté confirmada (el gerente declara sin ver a las demás). Gana la primera que se confirma; a la
  segunda se le dice a cuál empresa pertenece ya el CUIT (la plataforma sí puede ver nombres). La lista y el detalle marcan los repetidos antes de confirmar. Un choque del índice
  que escape a la comprobación previa (carrera) se traduce al mismo mensaje; un test lo provoca de forma determinista.
- **Aviso al gerente:** «tu empresa está activa», por el canal `avisos` (ADR-018), **después** del commit. Si no sale, la empresa queda confirmada y la auditoría registra
  `aviso-de-activacion` con `enviado: false`; el detalle ofrece «Reenviar el aviso de activación».
- **`Invitacion.cuitDeclarado` no se reescribe:** queda como lo que declaró el gerente. La verdad pasa a ser `Empresa.cuit` más la auditoría.

### 2. Corregir el CUIT

`corregirCuitDeEmpresa`: para empresas `ACTIVE` o `SUSPENDED` (una en alta se corrige al confirmarla). También sirve para **cargar** el CUIT de empresas anteriores a E2 que no lo
tienen. Pide motivo (obligatorio, solo para la auditoría), valida (E2), mira que ninguna otra empresa lo tenga y audita `cuit-corregido` con el valor anterior, el nuevo y el motivo.
**Quitar** el CUIT solo se permite en una empresa suspendida (el caso de quien se hizo pasar por otra y fue confirmado por error).

**Inmutabilidad:** se rechaza si la empresa tiene una factura autorizada por ARCA **en producción** (las de homologación no cuentan). Es un único predicado,
`empresaTieneFacturaAutorizada` (`src/core/fiscal/factura-autorizada.ts`), que hoy da siempre falso porque el circuito fiscal no existe. `test/arquitectura/cuit-inmutable-cableado.test.ts`
falla si el schema declara comprobantes fiscales y la lista de fuentes sigue vacía: quien construya la facturación tiene que cablearlo.

### 3. Suspender y reactivar

`ACTIVE ↔ SUSPENDED`, con auditoría (`empresa-suspendida` con motivo obligatorio, `empresa-reactivada` con motivo opcional). Una empresa **en alta no se suspende**: nadie opera en ella; para
frenar un alta se revoca la invitación o no se confirma. No hay mails de suspensión ni de reactivación.

- **Efecto inmediato:** `obtenerSituacionDeAcceso` relee el estado en cada pedido, así que los usuarios dejan de entrar en su próximo pedido sin revocar sesiones. Quien tiene otras
  empresas activas pasa a ellas. Los datos quedan intactos.
- **Pantalla:** «La empresa «X» está suspendida. Para reactivarla, contactá a la plataforma de Motor2», y, solo si está configurada, «escribiendo a <email>»
  (`CONTACTO_PLATAFORMA_EMAIL`, opcional; `src/core/auth/contacto-plataforma.ts`). Sin la variable no se muestra ningún contacto ni se inventa uno.
- **Carta pública:** el portal de una empresa suspendida da 404 en el acto; la carta de cada sucursal es ISR (`revalidate = 300`) y puede seguir viéndose hasta unos 5 minutos. Se acepta y se
  documenta: la consola es otra aplicación y no puede invalidar esa caché, y una página «no disponible» revelaría que la empresa existe.

### 4. Consola

La lista filtra (Todas, CUIT pendiente, En alta, Activas, Activas sin CUIT, Suspendidas), marca los CUIT repetidos y el inicio cuenta las empresas que esperan confirmación. El detalle muestra
por estado lo que corresponde (confirmar, corregir, suspender, reactivar, reenviar el aviso) y el historial de la auditoría de esa empresa. Toda acción pide confirmación con un componente
propio de la consola (`plataforma/src/app/empresas/[id]/confirmacion.tsx`: aviso anunciado, foco en «Cancelar», Escape cierra), que también reemplaza al `window.confirm` de «Revocar» de E5; un test
prohíbe `window.confirm` en `plataforma/src`.

## Alternativas descartadas

- **`SERIALIZABLE` con reintento para confirmar:** exigiría traer a la consola el ciclo de reintento sin ganar ninguna garantía que el cerrojo y el índice único no den.
- **Rechazar dos declaraciones del mismo CUIT:** el gerente no ve las demás empresas; rechazarlo en la aceptación filtraría que existe una pendiente con ese CUIT y no resuelve el caso de la suplantación.
- **Reescribir `cuitDeclarado` al corregir:** el trigger de `Invitacion` no lo permite a la plataforma y es mejor testimonio dejarlo como estaba.
- **Suspender una empresa en alta:** no tiene usuarios operando; la invitación se revoca.
- **Mandar mail al suspender o corregir:** por ahora solo se avisa la activación.

## Correcciones a otros ADR

1. **ADR-020 (Consecuencias):** dice que las altas abandonadas ocupan nombre y slug «hasta que exista el estado `DELETING` (E6)». `DELETING` no es de E6 y no liberaría nombre ni slug (la fila
   sigue existiendo y el rol de plataforma no tiene `DELETE`). Cancelar o dar de baja un alta queda para una etapa posterior.
2. **ADR-020 §5:** el CUIT declarado «lo copia E6 a `Empresa.cuit`»: se copia al confirmar, y `cuitDeclarado` queda como histórico (no se reescribe).
3. **ADR-017 (mensaje de la empresa suspendida):** el texto ahora es el de §3.

## Consecuencias

- **Sin migración.** El rol de plataforma ya tenía `UPDATE` sobre `Empresa` (a nivel de tabla: ver los endurecimientos opcionales en `docs/deploy-con-migraciones.md`) y `AuditoriaPlataforma` ya existía.
- **La primera confirmación real deja una instalación con DOS empresas activas.** Eso afectaba a lo que se apoyaba en que haya una sola (el respaldo de `app_empresa_actual()`, el bootstrap del
  primer admin, la tolerancia al rol privilegiado): ADR-022 lo retira, y con él el riesgo; sus prerrequisitos de despliegue están en el runbook.
- Una empresa recién confirmada arranca solo con Administración: los módulos los activa la plataforma (E7); hasta entonces, `npm run modulos-empresa`.
- La consola sigue administrando solo la instalación a la que apunta su conexión.
- El circuito fiscal tendrá que: cablear el predicado, tomar `FOR SHARE` sobre `Empresa.cuit` al emitir, copiar el CUIT en cada comprobante, comparar `cuitCertificado` con `Empresa.cuit` al cargar una credencial
  (si no coincide, se le pide a la plataforma que corrija) e invalidar credenciales y tickets al corregir el CUIT.

## Implementación

Núcleo: `src/core/features/empresa/ciclo-de-vida.ts`, `src/core/fiscal/factura-autorizada.ts`, `src/core/auth/contacto-plataforma.ts`. Consola: `plataforma/src/servidor/ciclo-de-vida.ts`,
`plataforma/src/servidor/empresas.ts` y `plataforma/src/app/empresas/`. Pruebas: `test/persistencia/ciclo-de-vida-de-empresa.test.ts` (con el rol real en CI), `test/core/ciclo-de-vida-de-empresa.test.ts`,
`test/arquitectura/cuit-inmutable-cableado.test.ts`, `test/e2e/consola-ciclo-de-vida.spec.ts`.
