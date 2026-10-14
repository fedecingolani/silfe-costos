import { describe, expect, it } from "vitest";
import {
  mensajeErrorCliente,
  mensajeErrorContacto,
  mensajeErrorInteraccion,
  mensajeErrorSucursal,
} from "./errores";

describe("mensajeErrorCliente", () => {
  it("traduce las restricciones de los datos bancarios y del IVA", () => {
    const error = (restriccion: string) => ({
      code: "23514",
      message: `new row for relation "cliente" violates check constraint "${restriccion}"`,
    });
    expect(mensajeErrorCliente("crear", error("cliente_cbu_check"))).toBe(
      "El CBU debe tener exactamente 22 dígitos.",
    );
    expect(mensajeErrorCliente("crear", error("cliente_cvu_check"))).toBe(
      "El CVU debe tener exactamente 22 dígitos.",
    );
    expect(mensajeErrorCliente("crear", error("cliente_alias_bancario_check"))).toBe(
      "El alias lleva de 6 a 20 caracteres: letras, números, punto y guion.",
    );
    expect(mensajeErrorCliente("crear", error("cliente_condicion_iva_check"))).toBe(
      "La condición frente al IVA no es válida.",
    );
  });

  it("avisa si el transporte elegido ya no existe", () => {
    expect(
      mensajeErrorCliente("actualizar", {
        code: "23503",
        message: 'insert or update on table "cliente" violates foreign key constraint "cliente_transporte_id_fkey"',
      }),
    ).toBe("El transporte elegido ya no existe.");
  });

  it("no confunde una restricción con el código de otro tipo de error", () => {
    expect(mensajeErrorCliente("crear", { code: "23505", message: "cliente_cbu_check" })).toBe(
      "No se pudo crear el cliente: cliente_cbu_check",
    );
  });

  it("si no la reconoce, dice qué acción falló y el mensaje de la base", () => {
    expect(mensajeErrorCliente("actualizar", { code: "XX000", message: "algo raro" })).toBe(
      "No se pudo actualizar el cliente: algo raro",
    );
  });
});

describe("mensajeErrorSucursal", () => {
  it("pide el nombre cuando falta", () => {
    expect(mensajeErrorSucursal("agregar", { code: "23502", message: 'null value in column "nombre"' })).toBe(
      "La sucursal necesita un nombre.",
    );
  });

  it("avisa si otra sucursal se marcó como principal al mismo tiempo", () => {
    expect(
      mensajeErrorSucursal("agregar", {
        code: "23505",
        message: 'duplicate key value violates unique constraint "cliente_sucursal_principal_unica"',
      }),
    ).toBe("Otra sucursal se marcó como principal al mismo tiempo. Volvé a intentarlo.");
  });

  it("avisa si el transporte elegido ya no existe", () => {
    expect(
      mensajeErrorSucursal("actualizar", {
        code: "23503",
        message: 'violates foreign key constraint "cliente_sucursal_transporte_id_fkey"',
      }),
    ).toBe("El transporte elegido ya no existe.");
  });

  it("distingue si falta el cliente o la sucursal", () => {
    expect(mensajeErrorSucursal("agregar", { code: "P0002", message: "No existe el cliente 123" })).toBe(
      "El cliente ya no existe.",
    );
    expect(mensajeErrorSucursal("actualizar", { code: "P0002", message: "No existe la sucursal 123" })).toBe(
      "La sucursal ya no existe.",
    );
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorSucursal("eliminar", { message: "sin conexión" })).toBe(
      "No se pudo eliminar la sucursal: sin conexión",
    );
  });
});

describe("mensajeErrorContacto", () => {
  it("avisa si el email no tiene arroba", () => {
    expect(
      mensajeErrorContacto("agregar", {
        code: "23514",
        message: 'violates check constraint "cliente_contacto_email_check"',
      }),
    ).toBe("El email tiene que tener una arroba.");
  });

  it("avisa si la sucursal elegida no es del cliente", () => {
    expect(
      mensajeErrorContacto("actualizar", {
        code: "23503",
        message: 'violates foreign key constraint "cliente_contacto_sucursal_fk"',
      }),
    ).toBe("La sucursal elegida ya no existe o es de otro cliente.");
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorContacto("eliminar", { code: "42501", message: "permiso denegado" })).toBe(
      "No se pudo eliminar el contacto: permiso denegado",
    );
  });
});

describe("mensajeErrorInteraccion", () => {
  const error = (code: string, restriccion: string) => ({
    code,
    message: `violates constraint "${restriccion}"`,
  });

  it("avisa si el contacto elegido no es del cliente", () => {
    expect(mensajeErrorInteraccion("registrar", error("23503", "cliente_interaccion_contacto_fk"))).toBe(
      "El contacto elegido ya no existe o es de otro cliente.",
    );
  });

  it("avisa si el cliente ya no existe", () => {
    expect(mensajeErrorInteraccion("registrar", error("23503", "cliente_interaccion_cliente_id_fkey"))).toBe(
      "El cliente ya no existe.",
    );
  });

  it("traduce el resumen vacío, el tipo y el sentido", () => {
    expect(mensajeErrorInteraccion("registrar", error("23514", "cliente_interaccion_resumen_check"))).toBe(
      "Escribí un resumen de la interacción.",
    );
    expect(mensajeErrorInteraccion("registrar", error("23502", "resumen"))).toBe(
      "Escribí un resumen de la interacción.",
    );
    expect(mensajeErrorInteraccion("registrar", error("23514", "cliente_interaccion_tipo_check"))).toBe(
      "El tipo de interacción no es válido.",
    );
    expect(mensajeErrorInteraccion("registrar", error("23514", "cliente_interaccion_sentido_check"))).toBe(
      "El sentido de la interacción no es válido.",
    );
  });

  it("si no lo reconoce, dice qué acción falló", () => {
    expect(mensajeErrorInteraccion("actualizar", { code: "42501", message: "permiso denegado" })).toBe(
      "No se pudo actualizar la interacción: permiso denegado",
    );
  });
});
