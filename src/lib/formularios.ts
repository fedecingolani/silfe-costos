import { startTransition, type FormEvent } from "react";

/**
 * Manejador de `onSubmit` que despacha la acción de `useActionState` sin pasar
 * por `<form action>`. Con `<form action>`, React 19 reinicia el formulario
 * después de cada acción: los campos no controlados pierden lo cargado (también
 * ante un error del servidor) y los `<select>` controlados vuelven a su primera
 * opción aunque el estado conserve el valor, así que el próximo envío lo pierde.
 */
export function enviarSinReiniciar(accionFormulario: (datos: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    startTransition(() => accionFormulario(datos));
  };
}
