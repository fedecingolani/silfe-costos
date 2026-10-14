import { describe, expect, it } from "vitest";
import { filtroBusquedaClientes, filtroActivo } from "./busqueda";

describe("filtroBusquedaClientes", () => {
  it("devuelve null si no hay texto", () => {
    expect(filtroBusquedaClientes("")).toBeNull();
    expect(filtroBusquedaClientes("   ")).toBeNull();
    expect(filtroBusquedaClientes(undefined)).toBeNull();
  });

  it("busca por razón social y CUIT con ilike", () => {
    expect(filtroBusquedaClientes(" frutas ")).toBe(
      'razon_social.ilike."%frutas%",cuit.ilike."%frutas%"',
    );
  });

  it("suma el código legado cuando el texto es un número entero", () => {
    expect(filtroBusquedaClientes("1234")).toBe(
      'razon_social.ilike."%1234%",cuit.ilike."%1234%",cuit_digitos.ilike."%1234%",codigo_legado.eq.1234',
    );
  });

  it("busca un CUIT sin guiones también entre los cargados con guiones", () => {
    expect(filtroBusquedaClientes("20123456789")).toBe(
      'razon_social.ilike."%20123456789%",cuit.ilike."%20123456789%",cuit_digitos.ilike."%20123456789%"',
    );
  });

  it("busca un CUIT con guiones también entre los cargados sin guiones", () => {
    expect(filtroBusquedaClientes("20-12345678-9")).toBe(
      'razon_social.ilike."%20-12345678-9%",cuit.ilike."%20-12345678-9%",cuit_digitos.ilike."%20123456789%"',
    );
  });

  it("acepta puntos y espacios como separadores del CUIT", () => {
    expect(filtroBusquedaClientes("20.123 456")).toContain('cuit_digitos.ilike."%20123456%"');
  });

  it("no busca por dígitos del CUIT si el texto tiene letras", () => {
    expect(filtroBusquedaClientes("Frutas 2")).toBe(
      'razon_social.ilike."%Frutas 2%",cuit.ilike."%Frutas 2%"',
    );
  });

  it("escapa los comodines de LIKE para buscarlos literalmente", () => {
    expect(filtroBusquedaClientes("50%_a\\b")).toBe(
      'razon_social.ilike."%50\\\\%\\\\_a\\\\\\\\b%",cuit.ilike."%50\\\\%\\\\_a\\\\\\\\b%"',
    );
  });

  it("protege comas, paréntesis y comillas de la sintaxis de PostgREST", () => {
    expect(filtroBusquedaClientes('a,b (c) "d"')).toBe(
      'razon_social.ilike."%a,b (c) \\"d\\"%",cuit.ilike."%a,b (c) \\"d\\"%"',
    );
  });

  it("descarta el asterisco, que PostgREST trata como comodín", () => {
    expect(filtroBusquedaClientes("a*b")).toBe('razon_social.ilike."%ab%",cuit.ilike."%ab%"');
  });
});

describe("filtroActivo", () => {
  it("por defecto muestra sólo los activos", () => {
    expect(filtroActivo(undefined)).toEqual({ valor: "activos", activo: true });
    expect(filtroActivo("cualquiera")).toEqual({ valor: "activos", activo: true });
  });

  it("acepta inactivos y todos", () => {
    expect(filtroActivo("inactivos")).toEqual({ valor: "inactivos", activo: false });
    expect(filtroActivo("todos")).toEqual({ valor: "todos", activo: null });
  });
});
