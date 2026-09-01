import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { cerrarSesion } from "@/app/login/acciones";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-50 px-3 py-5 md:flex">
        <div className="px-3 pb-6">
          <p className="text-lg font-semibold tracking-tight text-marca-700">Silfe</p>
          <p className="text-xs text-stone-500">Costos de producción</p>
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
          <span className="font-semibold text-marca-700">Silfe Costos</span>
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
