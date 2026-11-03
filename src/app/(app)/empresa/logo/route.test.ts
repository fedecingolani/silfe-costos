import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PNG_1X1, PNG_1X1_BASE64 } from "@/lib/empresa/logo-fixtures";

type Respuesta = { data: unknown; error: { message: string } | null };

const estado = vi.hoisted(() => ({
  respuesta: { data: null, error: null } as Respuesta,
}));

/** Cliente de Supabase mínimo para `leerLogoEmpresa`: from → select → eq → maybeSingle. */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from() {
      const constructor = {
        select: () => constructor,
        eq: () => constructor,
        maybeSingle: async () => estado.respuesta,
      };
      return constructor;
    },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  estado.respuesta = { data: null, error: null };
});

afterEach(() => vi.restoreAllMocks());

describe("GET /empresa/logo", () => {
  it("da 404 sin cache si no hay logo cargado", async () => {
    estado.respuesta = { data: { logo_base64: null, logo_tipo: null }, error: null };
    const respuesta = await GET();
    expect(respuesta.status).toBe(404);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    expect(await respuesta.text()).toBe("Sin logo.");
  });

  it("devuelve los bytes del logo con su tipo y cache inmutable", async () => {
    estado.respuesta = { data: { logo_base64: PNG_1X1_BASE64, logo_tipo: "image/png" }, error: null };
    const respuesta = await GET();
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("image/png");
    expect(respuesta.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(respuesta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await respuesta.arrayBuffer())).toEqual(PNG_1X1);
  });

  it("ante un error de Supabase da 404 sin cache, con un aviso", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    estado.respuesta = { data: null, error: { message: "sin permiso" } };
    const respuesta = await GET();
    expect(respuesta.status).toBe(404);
    expect(respuesta.headers.get("Cache-Control")).toBe("no-store");
    expect(aviso).toHaveBeenCalledOnce();
  });
});
