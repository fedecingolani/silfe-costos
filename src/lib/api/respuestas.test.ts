import { describe, expect, it } from "vitest";
import { errorApi, leerJson, respuestaJson } from "./respuestas";

describe("errorApi", () => {
  it("responde { error: { codigo, mensaje } } con el estado", async () => {
    const r = errorApi(422, "VALIDACION", "Falta el CUIT.");
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toEqual({ error: { codigo: "VALIDACION", mensaje: "Falta el CUIT." } });
  });

  it("puede sumar datos al error (p. ej. el proveedor existente)", async () => {
    const r = errorApi(409, "PROVEEDOR_EXISTE", "Ya existe.", { proveedor: { id: "1" } });
    expect(await r.json()).toEqual({ error: { codigo: "PROVEEDOR_EXISTE", mensaje: "Ya existe." }, proveedor: { id: "1" } });
  });
});

describe("respuestaJson", () => {
  it("serializa el cuerpo con el estado", async () => {
    const r = respuestaJson({ id: "x" }, 201);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: "x" });
  });
});

describe("leerJson", () => {
  const pedido = (cuerpo: string) => new Request("http://localhost/api/v1/x", { method: "POST", body: cuerpo });

  it("devuelve el JSON del cuerpo", async () => {
    expect(await leerJson(pedido('{"a":1}'))).toEqual({ datos: { a: 1 } });
  });

  it("un cuerpo que no es JSON es un 400 JSON_INVALIDO", async () => {
    const resultado = await leerJson(pedido("{no"));
    expect("respuesta" in resultado).toBe(true);
    if ("respuesta" in resultado) {
      expect(resultado.respuesta.status).toBe(400);
      expect(await resultado.respuesta.json()).toMatchObject({ error: { codigo: "JSON_INVALIDO" } });
    }
  });
});
