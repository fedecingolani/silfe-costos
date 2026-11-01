import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { cerrarSesion } from "@/app/login/acciones";
import { estiloMarca } from "@/lib/empresa/identidad";
import { leerIdentidadEmpresa } from "@/lib/empresa/identidad-servidor";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const empresa = await leerIdentidadEmpresa();

  return (
    <div className="flex min-h-screen" style={estiloMarca(empresa.color)}>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50 px-3 py-5 md:flex">
        <div className="px-3 pb-6">
          {empresa.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- logo servido por /empresa/logo, sin optimizar
            <img src={empresa.logo} alt={empresa.nombre ? "" : "Logo de la empresa"} className="mb-2 max-h-14 max-w-full object-contain" />
          )}
          {empresa.nombre ? (
            <>
              <p className="text-lg font-semibold leading-tight tracking-tight text-marca-700">{empresa.nombre}</p>
              <p className="text-xs text-stone-500">Charoli Gestión</p>
            </>
          ) : (
            <p className="text-lg font-semibold tracking-tight text-marca-700">Charoli Gestión</p>
          )}
        </div>
        <Nav />
        <div className="mt-auto border-t border-stone-200 px-3 pt-4">
          <p className="truncate text-xs text-stone-500" title={user.email ?? ""}>
            {user.email}
          </p>
          <form action={cerrarSesion}>
            <button type="submit" className="mt-2 text-xs text-stone-500 hover:text-red-700 hover:underline">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 md:hidden">
          <span className="truncate font-semibold text-marca-700">{empresa.nombre ?? "Charoli Gestión"}</span>
          <form action={cerrarSesion}>
            <button type="submit" className="text-xs text-stone-500">
              Salir
            </button>
          </form>
        </header>
        <div className="md:hidden">
          <div className="border-b border-stone-200 bg-stone-50 px-3 py-3">
            <Nav />
          </div>
        </div>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
