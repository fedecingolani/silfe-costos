# Seguimiento de clientes (Fase 7 del roadmap, CRM)

## Objetivo

Registrar cada contacto con un cliente (llamado, visita, WhatsApp, email), con su resultado y
el próximo paso, y tener una vista diaria de **a quién hay que contactar hoy y quiénes están
atrasados**.

## Problema y por qué

Hoy el seguimiento comercial no queda registrado en el sistema: no se sabe cuándo se habló por
última vez con un cliente, qué se acordó ni cuándo hay que volver a llamarlo.

## Decisiones (defaults del agente, a confirmar por el usuario)

- **Interacción** (`cliente_interaccion`):
  - cliente y contacto opcional, que tiene que ser del mismo cliente;
  - tipo: Llamado, Visita, WhatsApp, Email u Otro;
  - sentido: saliente (lo iniciamos nosotros) o entrante (nos contactó el cliente);
  - fecha y hora, que por defecto es ahora;
  - resumen obligatorio y notas opcionales;
  - próximo contacto: fecha opcional y acción a realizar;
  - quién la registró: usuario y una copia de su email al momento del registro.
- **Próximo contacto del cliente:** es el de su interacción más reciente. Registrar una
  interacción nueva reemplaza la agenda anterior, así no quedan pendientes viejos colgados.
- **Estado de seguimiento:** se calcula en una vista. Puede ser atrasado (fecha < hoy), hoy,
  próximo (en los próximos 7 días), más adelante o sin agenda. "Hoy" es la fecha de Argentina
  (`America/Argentina/Buenos_Aires`).
- Las interacciones se pueden editar y borrar, porque es un sistema interno y no requieren
  auditoría.

## Checklist

| ID | Tarea | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | Migración: `cliente_interaccion`, vista `v_cliente_seguimiento` y RLS (tests pgTAP en rojo primero) | delegada (writer) | [x] |
| T2 | Lógica pura del estado de seguimiento y de las fechas en hora argentina, con Vitest | delegada (writer) | [x] |
| T3 | Ficha del cliente: historial de interacciones, registrar, editar y borrar, y próximo contacto visible | delegada (writer) | [x] |
| T4 | Pantalla **Ventas → Seguimiento**: atrasados, hoy y próximos 7 días, con registro rápido | delegada (writer) | [x] |
| T5 | Listado de clientes: columnas "último contacto" y "próximo contacto", y filtro por estado de seguimiento | delegada (writer) | [x] |
| T6 | Recorrido en el navegador contra Supabase local | orquestador | [x] |

## Criterios de aceptación

- Registrar un llamado con próximo contacto para mañana lleva al cliente a "Próximos". El día
  siguiente aparece en "Hoy", y si no se lo contacta, después en "Atrasados".
- Registrar una interacción nueva sin fecha de próximo contacto lo pasa a "Sin agenda".
- Un contacto de otro cliente no se puede asociar a la interacción.
- Borrar un cliente borra sus interacciones. Borrar un contacto deja la interacción sin
  contacto.
- Los errores se muestran legibles en producción (`useActionState` o `?aviso=`).

## Checks

- Test-first: pgTAP (restricciones, vista, RLS) y Vitest (estado y fechas).
- `npm test`, `supabase test db`, `npm run typecheck`, `npm run lint` y `npm run build`.
- Recorrido en el navegador.

## Progreso

- Rama `feat/crm`, encima de la Fase 6 y sus correcciones (`9b582de`).

- T1 a T5 implementados por un writer delegado:
  - migraciones `20261021000001_crm_seguimiento.sql` y `20261021000002_rls_crm_seguimiento.sql`;
  - `src/lib/clientes/seguimiento.ts`;
  - `FormularioInteraccion.tsx` (controlado);
  - pantalla `/seguimiento`;
  - el listado de clientes ahora lee de `v_cliente_seguimiento`.
- Decisiones del writer:
  - la fecha y hora se interpreta con offset −03:00 fijo, porque Argentina no tiene horario
    de verano;
  - después de registrar desde `/seguimiento`, se vuelve ahí;
  - el teléfono que se muestra es el del primer contacto que tenga uno.
- RED → GREEN: `supabase test db` con 200 tests y `npm test` con 143, todos en verde. Typecheck,
  lint y build OK.
- T6, recorrido en el navegador con datos de prueba locales, sin errores en consola:
  - `/seguimiento` muestra un cliente en Atrasados y uno en Hoy;
  - registrar un llamado con próximo contacto en 3 días lo pasa a "Próximos 7 días" y cierra el
    formulario;
  - el filtro de seguimiento "Atrasados" del listado devuelve solo el atrasado, con las columnas
    de último y próximo contacto;
  - la ficha del cliente muestra el estado, la agenda y el historial con quién registró.
- Detalles visuales pendientes:
  - en pantallas de unos 800 px, el botón "Registrar" queda cortado a la derecha de las tablas;
  - en el formulario de contacto, las etiquetas se ven alineadas a la derecha y el texto de
    ayuda se sale del modal.

## Próximo paso

Commits y revisión. Después, decidir el alcance de la Fase 8 (ventas) y la entrega (push,
`db push` y deploy).
