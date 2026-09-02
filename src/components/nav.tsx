"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES: { titulo: string; items: { href: string; texto: string }[] }[] = [
  {
    titulo: "Costeo",
    items: [
      { href: "/", texto: "Panel" },
      { href: "/productos", texto: "Productos" },
      { href: "/clientes", texto: "Clientes" },
    ],
  },
  {
    titulo: "Insumos",
    items: [
      { href: "/materias-primas", texto: "Materias primas" },
      { href: "/proveedores", texto: "Proveedores" },
    ],
  },
  {
    titulo: "Producción",
    items: [
      { href: "/procesos", texto: "Procesos" },
      { href: "/mano-obra", texto: "Mano de obra" },
    ],
  },
  {
    titulo: "Configuración",
    items: [
      { href: "/unidades", texto: "Unidades" },
      { href: "/configuracion", texto: "Parámetros" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-5">
      {SECCIONES.map((seccion) => (
        <div key={seccion.titulo}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-400">
            {seccion.titulo}
          </p>
          <ul className="space-y-0.5">
            {seccion.items.map((item) => {
              const activo =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-lg px-3 py-1.5 text-sm transition ${
                      activo
                        ? "bg-marca-600 font-medium text-white"
                        : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900"
                    }`}
                  >
                    {item.texto}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
