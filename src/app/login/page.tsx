"use client";

import { useActionState } from "react";
import { iniciarSesion } from "./acciones";

export default function LoginPage() {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="tarjeta w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold text-marca-700">Silfe Costos</h1>
        <p className="mt-1 text-sm text-stone-500">Sistema de costeo de productos.</p>

        <form action={accion} className="mt-6 space-y-4">
          <div>
            <label className="etiqueta" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="email" required className="campo" />
          </div>
          <div>
            <label className="etiqueta" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="campo"
            />
          </div>

          {estado?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{estado.error}</p>
          )}

          <button type="submit" disabled={pendiente} className="boton-primario w-full">
            {pendiente ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
