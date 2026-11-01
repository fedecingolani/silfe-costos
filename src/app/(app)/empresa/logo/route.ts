import { createClient } from "@/lib/supabase/server";
import { leerLogoEmpresa } from "@/lib/empresa/logo";

export const dynamic = "force-dynamic";

/**
 * Logo de la empresa para el menú (el middleware ya exige sesión). La URL
 * lleva `?v=` con la fecha de actualización de `empresa`, así que la
 * respuesta se puede guardar sin vencimiento: un logo nuevo cambia la URL.
 */
export async function GET() {
  const logo = await leerLogoEmpresa(await createClient());
  if (!logo) {
    return new Response("Sin logo.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(new Blob([logo.bytes as Uint8Array<ArrayBuffer>], { type: logo.tipo }), {
    headers: {
      "Content-Type": logo.tipo,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
