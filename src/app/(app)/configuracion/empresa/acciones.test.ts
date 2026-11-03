import { beforeEach, describe, expect, it, vi } from "vitest";
import { JPEG_1X1, PNG_1X1, PNG_1X1_BASE64 } from "@/lib/empresa/logo-fixtures";
import { TAMANO_MAXIMO_LOGO } from "@/lib/empresa/validacion";

type Respuesta = { data: unknown; error: { message: string } | null };
type Llamada = { tabla: string; update?: unknown; eq?: [string, unknown]; select?: string };

const estado = vi.hoisted(() => ({
  respuesta: { data: [{ id: true }], error: null } as Respuesta,
  llamadas: [] as Llamada[],
}));

/** Cliente de Supabase mínimo: registra from → update → eq → select y responde `estado.respuesta`. */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(tabla: string) {
      const llamada: Llamada = { tabla };
      estado.llamadas.push(llamada);
      const constructor = {
        update: (valores: unknown) => {
          llamada.update = valores;
          return constructor;
        },
        eq: (columna: string, valor: unknown) => {
          llamada.eq = [columna, valor];
          return constructor;
        },
        select: async (columnas: string) => {
          llamada.select = columnas;
          return estado.respuesta;
        },
      };
      return constructor;
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { guardarEmpresa } from "./acciones";

function formulario(campos: Record<string, string | File> = {}): FormData {
  const datos = new FormData();
  const base = { nombre_fantasia: "", color_marca: "", telefono: "", email: "", web: "" };
  for (const [clave, valor] of Object.entries({ ...base, ...campos })) datos.set(clave, valor);
  return datos;
}

const archivo = (bytes: Uint8Array, nombre = "logo.png") => new File([bytes as Uint8Array<ArrayBuffer>], nombre);

beforeEach(() => {
  estado.respuesta = { data: [{ id: true }], error: null };
  estado.llamadas = [];
  vi.mocked(revalidatePath).mockClear();
});

describe("guardarEmpresa", () => {
  it("guarda los datos normalizados en la fila única y revalida el layout", async () => {
    const resultado = await guardarEmpresa(
      undefined,
      formulario({
        nombre_fantasia: "  Empresa de Ejemplo  ",
        color_marca: "#4A7A58",
        telefono: " 0341 555-0000 ",
        email: "ventas@ejemplo.com.ar",
        web: "",
      }),
    );
    expect(resultado).toEqual({ ok: "Datos de la empresa guardados." });
    expect(estado.llamadas).toEqual([
      {
        tabla: "empresa",
        update: {
          nombre_fantasia: "Empresa de Ejemplo",
          color_marca: "#4a7a58",
          telefono: "0341 555-0000",
          email: "ventas@ejemplo.com.ar",
          web: null,
        },
        eq: ["id", true],
        select: "id",
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("no toca la base si los datos no son válidos", async () => {
    const resultado = await guardarEmpresa(undefined, formulario({ color_marca: "rojo" }));
    expect(resultado).toEqual({ error: "El color de marca tiene que ser un hex de 6 dígitos, como #4a7a58." });
    expect(estado.llamadas).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("informa error si no se actualizó ninguna fila", async () => {
    estado.respuesta = { data: [], error: null };
    const resultado = await guardarEmpresa(undefined, formulario());
    expect(resultado).toEqual({
      error: "No se pudieron guardar los datos de la empresa: no se actualizó ningún registro.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("informa el error de Supabase", async () => {
    estado.respuesta = { data: null, error: { message: "sin permiso" } };
    const resultado = await guardarEmpresa(undefined, formulario());
    expect(resultado).toEqual({ error: "No se pudieron guardar los datos de la empresa: sin permiso" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sin archivo ni «quitar logo» no toca las columnas del logo", async () => {
    await guardarEmpresa(undefined, formulario());
    expect(estado.llamadas[0].update).not.toHaveProperty("logo_base64");
    expect(estado.llamadas[0].update).not.toHaveProperty("logo_tipo");
  });

  it("guarda un PNG válido en base64 con su tipo", async () => {
    const resultado = await guardarEmpresa(undefined, formulario({ logo: archivo(PNG_1X1) }));
    expect(resultado).toEqual({ ok: "Datos de la empresa guardados." });
    expect(estado.llamadas[0].update).toMatchObject({ logo_base64: PNG_1X1_BASE64, logo_tipo: "image/png" });
  });

  it("«quitar logo» deja las dos columnas del logo en null", async () => {
    await guardarEmpresa(undefined, formulario({ quitar_logo: "on" }));
    expect(estado.llamadas[0].update).toMatchObject({ logo_base64: null, logo_tipo: null });
  });

  it("rechaza un logo que no es PNG ni JPEG, aunque se llame .png", async () => {
    const resultado = await guardarEmpresa(
      undefined,
      formulario({ logo: archivo(new TextEncoder().encode("<svg></svg>")) }),
    );
    expect(resultado).toEqual({ error: "El logo tiene que ser una imagen PNG o JPEG." });
    expect(estado.llamadas).toEqual([]);
  });

  it("rechaza un logo de más de 512 KB", async () => {
    const grande = new Uint8Array(TAMANO_MAXIMO_LOGO + 1);
    grande.set(JPEG_1X1);
    const resultado = await guardarEmpresa(undefined, formulario({ logo: archivo(grande, "logo.jpg") }));
    expect(resultado).toEqual({ error: "El logo pesa más de 512 KB: achicalo y volvé a subirlo." });
    expect(estado.llamadas).toEqual([]);
  });
});
