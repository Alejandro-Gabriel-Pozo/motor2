# ADR-013: Planes editables

> Redactado el 2026-10-03 (Bloque 0 del plan de plataforma). **Decidido, todavía sin implementar.** Se apoya en ADR-011 (registro de módulos) y
> se opera desde la consola de ADR-012. La migración que cree las tablas del plan se autoriza por separado.

## Contexto

Asignar módulos empresa por empresa, uno a uno, no escala y es fácil de equivocar. El dueño quiere **paquetes** (por ejemplo «básico» o «con
salón») que la plataforma pueda crear y modificar sin tocar código ni desplegar. No hay cobro ni facturación de suscripciones: el plan agrupa
módulos y nada más.

## Decisión

### 1. Un plan es un dato

Un plan es un nombre y un conjunto de módulos del catálogo de ADR-011. Se guarda en dos tablas, `Plan` y `PlanModulo`, que edita solo la
plataforma. Los planes se crean, renombran, archivan y editan desde la consola; ninguno está fijo en el código.

### 2. Asignar un plan genera las filas del registro

Al asignarle un plan a una empresa, la plataforma escribe en el registro de módulos de esa empresa las filas que el plan indica, **validando las
dependencias y los datos requeridos** de ADR-011 antes de escribir: si algo falta, el cambio no se aplica y se dice qué falta. Una empresa
puede además tener módulos activados o desactivados a mano por encima del plan.

La empresa guarda de qué plan partió, para informarlo («Plan y módulos»), pero lo que **manda** son las filas del registro.

### 3. Editar un plan es una «foto» (decidido, D5)

Cambiar un plan **no cambia las empresas que ya lo tienen**. Quien lo tenía conserva lo que tenía. Para llevar a una empresa al estado actual de su plan
hay una acción explícita **«reaplicar»**, que muestra antes la diferencia (qué módulos se agregan y cuáles se sacan) y exige confirmar.
Justificación: un cambio de catálogo no debe poder apagarle a un cliente algo que usa sin que nadie lo decida mirando ese cliente.

### 4. Un solo lugar muestra al gerente su plan

El gerente de la empresa ve su plan y sus módulos en una pantalla «Plan y módulos» de **solo lectura**. No contrata ni cambia nada: eso lo hace la
plataforma. Los módulos en desarrollo aparecen como «Próximamente».

### 5. Los atajos «completo» y «lite» no son planes

El código tiene dos atajos con esos nombres que fijan las perillas de política (ADR-011, punto 7). Ya se renombraron a «perfil de política»
(2026-10-03), para no usar la misma palabra para dos cosas. Los planes y los perfiles son independientes mientras la política siga
fuera del registro.

### 6. Sin cobro

No hay precios, ciclos de facturación ni suscripciones en este ADR. Si el dueño decide cobrar planes, será un ADR propio y no lleva un proyecto
aparte: el dominio queda dentro de la plataforma.

## Alternativas descartadas

- **Propagar los cambios del plan a todas las empresas que lo tienen**: un error al editar el plan afecta a todos los clientes a la vez y puede
  apagar funciones en uso. Se prefiere la foto con «reaplicar».
- **Planes en código**: cada paquete nuevo exigiría un deploy.
- **Derivar siempre los módulos de la empresa del plan (sin filas propias)**: no permite excepciones por cliente y vuelve costosa cada consulta
  del guard; las filas del registro son la fuente y el plan solo las genera.

## Consecuencias

- Dos tablas nuevas de plataforma y una referencia opcional al plan de origen en cada empresa.
- La pantalla «Plan y módulos» del gerente depende de las filas del registro, no del plan: si la plataforma ajusta un módulo a mano, el gerente ve lo real.
- Los atajos de política ya no se llaman «plan»: el nombre «plan» queda reservado a este ADR.
- La acción «reaplicar» necesita su propia auditoría de plataforma (ADR-012).
