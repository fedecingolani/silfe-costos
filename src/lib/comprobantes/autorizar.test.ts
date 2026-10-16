import { describe, expect, it } from "vitest";
import { RespuestaArcaIncierta, type RespuestaCae, type SolicitudCae } from "@/lib/arca/wsfe";
import {
  ESPERA_BLOQUEO_MS,
  ErrorBaseDatos,
  INTENTOS_BLOQUEO,
  autorizar,
  type BorradorRecalculado,
  type DatosAutorizacion,
  type RepositorioComprobantes,
  type ServiciosArca,
} from "./autorizar";

const AHORA = new Date("2026-10-16T15:00:00Z");
const ID = "a0000000-0000-0000-0000-000000000001";

const datosBase = (): DatosAutorizacion => ({
  comprobante: {
    id: ID,
    estado: "borrador",
    puntoVenta: 7,
    ambiente: "homologacion",
    clase: "factura",
    letra: null,
    tipoArca: null,
    fecha: "2026-10-16",
    total: 0,
    receptorDocNro: null,
    intentoNumero: null,
  },
  items: [
    { id: "i1", cantidad: 2, precioUnitario: 500, descuentoPct: 0, alicuotaIva: 21, importe: 0, iva: 0 },
    { id: "i2", cantidad: 1, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 10.5, importe: 100, iva: 10.5 },
  ],
  asociados: [],
  cliente: {
    razonSocial: "Frutícola S.A.",
    cuit: "20-11111111-2",
    condicionIva: "Responsable Inscripto",
    direccion: "Ruta 22 km 1200",
    localidad: "Allen",
    provincia: "Río Negro",
  },
  cuitEmisor: "23334771229",
  puntoVentaElectronico: true,
  credencial: { certificadoPem: "CERT", claveCifrada: "CLAVE-CIFRADA" },
});

const APROBADO = (numero = 0): RespuestaCae => ({
  resultado: "A",
  cae: `7612345678${String(numero).padStart(4, "0")}`,
  caeVencimiento: new Date(Date.UTC(2026, 9, 26)),
  observaciones: [{ code: 10217, msg: "Observación informativa" }],
  errores: [],
});

const NO_CORRELATIVO: RespuestaCae = {
  resultado: "R",
  cae: null,
  caeVencimiento: null,
  observaciones: [{ code: 10016, msg: "El numero o fecha del comprobante no se corresponde con el proximo a autorizar." }],
  errores: [],
};

const RECHAZO: RespuestaCae = {
  resultado: "R",
  cae: null,
  caeVencimiento: null,
  observaciones: [],
  errores: [{ code: 10242, msg: "El campo Condicion Frente al IVA del receptor resulta obligatorio." }],
};

type RespuestaFalsa = RespuestaCae | Error;

/**
 * Repositorio y ARCA en memoria. Registra cada paso en `eventos` para
 * verificar el orden: guardar, bloqueo, auth, ultimo, verificando, cae,
 * autorizado/rechazado, liberar.
 */
function escenario(opciones: {
  datos?: DatosAutorizacion;
  bloqueoOcupado?: number;
  ultimos?: (number | Error)[];
  respuestas?: RespuestaFalsa[];
  consulta?: Awaited<ReturnType<ServiciosArca["consultar"]>> | Error;
  autenticar?: Error;
  guardarFalla?: Error;
}) {
  const datos = opciones.datos ?? datosBase();
  const fila = datos.comprobante;
  const eventos: string[] = [];
  const esperas: number[] = [];
  const solicitudes: SolicitudCae[] = [];
  const ultimos = [...(opciones.ultimos ?? [360])];
  const respuestas = [...(opciones.respuestas ?? [APROBADO(361)])];
  let ocupado = opciones.bloqueoOcupado ?? 0;
  const estado: {
    recalculado?: BorradorRecalculado;
    autorizado?: Parameters<RepositorioComprobantes["marcarAutorizado"]>[1];
    rechazado?: Parameters<RepositorioComprobantes["marcarRechazado"]>[1];
    bloqueoTomado: boolean;
  } = { bloqueoTomado: false };

  const repositorio: RepositorioComprobantes = {
    async cargar(id) {
      eventos.push("cargar");
      return id === ID ? structuredClone({ ...datos, comprobante: fila }) : null;
    },
    async guardarRecalculado(_id, recalculado) {
      if (opciones.guardarFalla) throw opciones.guardarFalla;
      eventos.push("guardar");
      estado.recalculado = recalculado;
      Object.assign(fila, {
        estado: "borrador",
        letra: recalculado.letra,
        tipoArca: recalculado.tipoArca,
        total: recalculado.total,
        receptorDocNro: recalculado.receptor.docNro,
      });
    },
    async pasarAVerificando(_id, d) {
      eventos.push(`verificando ${d.intentoNumero}`);
      Object.assign(fila, { estado: "verificando", intentoNumero: d.intentoNumero, letra: d.letra, tipoArca: d.tipoArca });
    },
    async cambiarIntento(_id, numero) {
      eventos.push(`intento ${numero}`);
      fila.intentoNumero = numero;
    },
    async marcarAutorizado(_id, d) {
      eventos.push(`autorizado ${d.numero}`);
      estado.autorizado = d;
      fila.estado = "autorizado";
    },
    async marcarRechazado(_id, d) {
      eventos.push("rechazado");
      estado.rechazado = d;
      Object.assign(fila, { estado: "rechazado", intentoNumero: null });
    },
    async volverABorrador() {
      eventos.push("borrador");
      Object.assign(fila, { estado: "borrador", intentoNumero: null });
    },
    async tomarBloqueo() {
      if (ocupado > 0) {
        ocupado--;
        eventos.push("bloqueo-ocupado");
        return null;
      }
      eventos.push("bloqueo");
      estado.bloqueoTomado = true;
      return "2026-10-16T15:02:00.000000+00:00";
    },
    async liberarBloqueo(_clave, llave) {
      eventos.push("liberar");
      expect(llave).toBe("2026-10-16T15:02:00.000000+00:00");
      estado.bloqueoTomado = false;
    },
  };

  const arca: ServiciosArca = {
    async autenticar(_ambiente, credencial, cuit) {
      eventos.push("auth");
      if (opciones.autenticar) throw opciones.autenticar;
      expect(credencial.claveCifrada).toBe("CLAVE-CIFRADA");
      return { token: "TOKEN-SECRETO", sign: "SIGN-SECRETO", cuit };
    },
    async ultimoAutorizado() {
      eventos.push("ultimo");
      const valor = ultimos.shift();
      if (valor === undefined) throw new Error("ultimo no esperado");
      if (valor instanceof Error) throw valor;
      return valor;
    },
    async solicitarCae(_ambiente, auth, solicitud) {
      eventos.push(`cae ${solicitud.numero}`);
      expect(auth.token).toBe("TOKEN-SECRETO");
      solicitudes.push(solicitud);
      const respuesta = respuestas.shift();
      if (respuesta === undefined) throw new Error("CAE no esperado");
      if (respuesta instanceof Error) throw respuesta;
      return respuesta;
    },
    async consultar(_ambiente, _auth, _pv, _tipo, numero) {
      eventos.push(`consultar ${numero}`);
      if (opciones.consulta instanceof Error) throw opciones.consulta;
      return opciones.consulta ?? null;
    },
  };

  const deps = {
    repositorio,
    arca,
    ahora: () => AHORA,
    esperar: async (ms: number) => {
      esperas.push(ms);
    },
  };
  return { deps, eventos, esperas, solicitudes, estado, fila };
}

const verificando = (): DatosAutorizacion => {
  const datos = datosBase();
  Object.assign(datos.comprobante, {
    estado: "verificando",
    letra: "A",
    tipoArca: 1,
    total: 1220.5,
    receptorDocNro: "20111111112",
    intentoNumero: 361,
  });
  return datos;
};

describe("autorizar: camino feliz", () => {
  it("recalcula, numera último + 1 bajo bloqueo, pide el CAE y lo guarda", async () => {
    const { deps, eventos, solicitudes, estado } = escenario({});
    const resultado = await autorizar(ID, deps);

    expect(resultado).toEqual({
      ok: "Comprobante A-00007-00000361 autorizado. CAE 76123456780361, vence el 26/10/2026.",
      estado: "autorizado",
    });
    expect(eventos).toEqual([
      "cargar", "guardar", "bloqueo", "auth", "ultimo", "verificando 361", "cae 361", "autorizado 361", "liberar",
    ]);
    expect(estado.autorizado).toEqual({
      numero: 361,
      cae: "76123456780361",
      caeVencimiento: "2026-10-26",
      observaciones: [{ code: 10217, msg: "Observación informativa" }],
      autorizadoEn: AHORA,
    });
    expect(solicitudes[0]).toEqual({
      puntoVenta: 7,
      tipoComprobante: 1,
      numero: 361,
      fecha: "2026-10-16",
      docTipo: 80,
      docNro: "20111111112",
      condicionIvaReceptorId: 1,
      neto: 1100,
      iva: 220.5,
      total: 1320.5,
      alicuotas: [
        { id: 4, base: 100, importe: 10.5 },
        { id: 5, base: 1000, importe: 210 },
      ],
      asociados: undefined,
    });
  });

  it("guarda en el borrador lo recalculado en el servidor: letra, receptor, totales e importes", async () => {
    const { deps, estado } = escenario({});
    await autorizar(ID, deps);
    expect(estado.recalculado).toEqual({
      letra: "A",
      tipoArca: 1,
      receptor: {
        razonSocial: "Frutícola S.A.",
        docTipo: 80,
        docNro: "20111111112",
        condicionIva: "Responsable Inscripto",
        domicilio: "Ruta 22 km 1200, Allen, Río Negro",
        provincia: "Río Negro",
      },
      neto: 1100,
      iva: 220.5,
      total: 1320.5,
      items: [{ id: "i1", importe: 1000, iva: 210 }],
    });
  });

  it("emite B a un consumidor final sin CUIT, con documento 99", async () => {
    const datos = datosBase();
    datos.cliente = { ...datos.cliente, cuit: null, condicionIva: "Consumidor Final" };
    const { deps, solicitudes } = escenario({ datos });
    const resultado = await autorizar(ID, deps);
    expect(resultado.ok).toContain("B-00007-00000361");
    expect(solicitudes[0]).toMatchObject({ tipoComprobante: 6, docTipo: 99, docNro: "0", condicionIvaReceptorId: 5 });
  });

  it("envía los comprobantes asociados de una nota de crédito", async () => {
    const datos = datosBase();
    datos.comprobante.clase = "nota_credito";
    datos.asociados = [{ tipo: 1, puntoVenta: 7, numero: 150, cuit: "23334771229", fecha: "2026-01-10" }];
    const { deps, solicitudes } = escenario({ datos });
    await autorizar(ID, deps);
    expect(solicitudes[0]).toMatchObject({ tipoComprobante: 3, asociados: datos.asociados });
  });

  it("un rechazado vuelve a intentarse desde borrador", async () => {
    const datos = datosBase();
    datos.comprobante.estado = "rechazado";
    const { deps, eventos } = escenario({ datos });
    expect((await autorizar(ID, deps)).estado).toBe("autorizado");
    expect(eventos.slice(0, 3)).toEqual(["cargar", "guardar", "bloqueo"]);
  });

  it("no devuelve el token ni el sign", async () => {
    const { deps } = escenario({ respuestas: [RECHAZO] });
    const resultados = [await autorizar(ID, deps), await autorizar(ID, escenario({}).deps)];
    for (const r of resultados) {
      expect(JSON.stringify(r)).not.toMatch(/TOKEN-SECRETO|SIGN-SECRETO|CLAVE-CIFRADA/);
    }
  });
});

describe("autorizar: bloqueo de numeración", () => {
  it("espera mientras otro pedido tiene el bloqueo y sigue cuando se libera", async () => {
    const { deps, eventos, esperas } = escenario({ bloqueoOcupado: 2 });
    expect((await autorizar(ID, deps)).estado).toBe("autorizado");
    expect(esperas).toEqual([ESPERA_BLOQUEO_MS, ESPERA_BLOQUEO_MS]);
    expect(eventos.slice(0, 5)).toEqual(["cargar", "guardar", "bloqueo-ocupado", "bloqueo-ocupado", "bloqueo"]);
  });

  it("se rinde después de unas pocas esperas sin llamar a ARCA ni liberar un bloqueo ajeno", async () => {
    const { deps, eventos, esperas, fila } = escenario({ bloqueoOcupado: 100 });
    expect(await autorizar(ID, deps)).toEqual({
      error:
        "Otro pedido está numerando comprobantes de este tipo en el punto de venta 7. Probá de nuevo en un minuto.",
    });
    expect(esperas).toHaveLength(INTENTOS_BLOQUEO);
    expect(eventos.filter((e) => e === "bloqueo-ocupado")).toHaveLength(INTENTOS_BLOQUEO + 1);
    expect(eventos).not.toContain("auth");
    expect(eventos).not.toContain("liberar");
    expect(fila.estado).toBe("borrador");
  });

  it("libera el bloqueo si algo falla antes de pedir el CAE, y el comprobante sigue en borrador", async () => {
    const { deps, eventos, fila, estado } = escenario({ ultimos: [new TypeError("fetch failed")] });
    expect(await autorizar(ID, deps)).toEqual({ error: "No se pudo conectar con ARCA: fetch failed" });
    expect(eventos.at(-1)).toBe("liberar");
    expect(estado.bloqueoTomado).toBe(false);
    expect(fila.estado).toBe("borrador");
  });

  it("devuelve el mensaje de WSAA y libera el bloqueo", async () => {
    const { deps, eventos } = escenario({ autenticar: new Error("El certificado no está autorizado para factura electrónica (wsfe).") });
    expect(await autorizar(ID, deps)).toEqual({
      error: "El certificado no está autorizado para factura electrónica (wsfe).",
    });
    expect(eventos.slice(-2)).toEqual(["auth", "liberar"]);
  });
});

describe("autorizar: respuestas de ARCA", () => {
  it("ante un número no correlativo vuelve a consultar el último y reintenta una vez", async () => {
    const { deps, eventos, estado } = escenario({ ultimos: [360, 362], respuestas: [NO_CORRELATIVO, APROBADO(363)] });
    const resultado = await autorizar(ID, deps);
    expect(resultado.estado).toBe("autorizado");
    expect(resultado.ok).toContain("A-00007-00000363");
    expect(eventos).toEqual([
      "cargar", "guardar", "bloqueo", "auth", "ultimo", "verificando 361", "cae 361",
      "ultimo", "intento 363", "cae 363", "autorizado 363", "liberar",
    ]);
    expect(estado.autorizado?.numero).toBe(363);
  });

  it("un segundo rechazo por número no correlativo queda como rechazo", async () => {
    const { deps, eventos, estado, fila } = escenario({
      ultimos: [360, 362],
      respuestas: [NO_CORRELATIVO, NO_CORRELATIVO],
    });
    const resultado = await autorizar(ID, deps);
    expect(resultado).toEqual({
      error:
        "ARCA rechazó el comprobante: [10016] El numero o fecha del comprobante no se corresponde con el proximo a autorizar.",
      estado: "rechazado",
    });
    expect(eventos.filter((e) => e.startsWith("cae"))).toEqual(["cae 361", "cae 363"]);
    expect(eventos.at(-1)).toBe("liberar");
    expect(estado.rechazado).toEqual({ resultado: "R", observaciones: NO_CORRELATIVO.observaciones, errores: [] });
    expect(fila.intentoNumero).toBeNull();
  });

  it("si no puede consultar el último para reintentar, guarda el rechazo (ARCA ya respondió)", async () => {
    const { deps, eventos, fila } = escenario({
      ultimos: [360, new TypeError("fetch failed")],
      respuestas: [NO_CORRELATIVO],
    });
    expect((await autorizar(ID, deps)).estado).toBe("rechazado");
    expect(eventos.filter((e) => e.startsWith("cae"))).toEqual(["cae 361"]);
    expect(fila.estado).toBe("rechazado");
  });

  it("un rechazo queda rechazado con los errores de ARCA y sin número", async () => {
    const { deps, eventos, estado, fila } = escenario({ respuestas: [RECHAZO] });
    expect(await autorizar(ID, deps)).toEqual({
      error: "ARCA rechazó el comprobante: [10242] El campo Condicion Frente al IVA del receptor resulta obligatorio.",
      estado: "rechazado",
    });
    expect(estado.rechazado).toEqual({ resultado: "R", observaciones: [], errores: RECHAZO.errores });
    expect(fila.intentoNumero).toBeNull();
    expect(eventos.slice(-2)).toEqual(["rechazado", "liberar"]);
  });

  it.each([
    ["un corte de red", new TypeError("fetch failed")],
    ["una respuesta incierta", new RespuestaArcaIncierta("ARCA aprobó el comprobante pero no informó el CAE o su vencimiento.")],
  ])("ante %s deja el comprobante en verificación y pide volver a apretar Autorizar", async (_caso, falla) => {
    const { deps, eventos, fila } = escenario({ respuestas: [falla] });
    const resultado = await autorizar(ID, deps);
    expect(resultado.estado).toBe("verificando");
    expect(resultado.error).toMatch(/^No se pudo confirmar el resultado con ARCA \(.+\)\. /);
    expect(resultado.error).toContain("apretá «Autorizar» de nuevo para verificarlo con ARCA. No lo cargues de nuevo.");
    expect(fila.estado).toBe("verificando");
    expect(fila.intentoNumero).toBe(361);
    expect(eventos.slice(-2)).toEqual(["cae 361", "liberar"]);
  });
});

describe("autorizar: reconciliación de un comprobante en verificación", () => {
  const encontrado = {
    cae: "76123456789012",
    caeVencimiento: new Date(Date.UTC(2026, 9, 26)),
    importeTotal: 1220.5,
    fecha: "2026-10-16",
    docNro: "20111111112",
  };

  it("si ARCA lo tiene con los mismos datos, guarda su CAE sin pedir otro", async () => {
    const { deps, eventos, estado } = escenario({ datos: verificando(), consulta: encontrado });
    expect(await autorizar(ID, deps)).toEqual({
      ok: "ARCA ya había autorizado el comprobante A-00007-00000361. CAE 76123456789012, vence el 26/10/2026.",
      estado: "autorizado",
    });
    expect(eventos).toEqual(["cargar", "bloqueo", "auth", "consultar 361", "autorizado 361", "liberar"]);
    expect(estado.autorizado).toEqual({
      numero: 361,
      cae: "76123456789012",
      caeVencimiento: "2026-10-26",
      observaciones: [],
      autorizadoEn: AHORA,
    });
  });

  it("si ARCA tiene ese número con otros datos, lo marca rechazado para revisarlo", async () => {
    const { deps, eventos, estado } = escenario({
      datos: verificando(),
      consulta: { ...encontrado, importeTotal: 999, docNro: "30712345671" },
    });
    const resultado = await autorizar(ID, deps);
    const mensaje =
      "ARCA ya tiene el comprobante A-00007-00000361 con otros datos (total $ 999,00, documento 30712345671): " +
      "ese número lo usó otro sistema. Revisá ese comprobante antes de volver a autorizar este.";
    expect(resultado).toEqual({ error: mensaje, estado: "rechazado" });
    expect(estado.rechazado).toEqual({ resultado: null, observaciones: [], errores: [{ code: 0, msg: mensaje }] });
    expect(eventos).not.toContain("cae 361");
    expect(eventos.at(-1)).toBe("liberar");
  });

  it("si ARCA no lo tiene, vuelve a borrador y lo autoriza con el flujo normal", async () => {
    const { deps, eventos } = escenario({ datos: verificando(), consulta: null, ultimos: [361], respuestas: [APROBADO(362)] });
    const resultado = await autorizar(ID, deps);
    expect(resultado.estado).toBe("autorizado");
    expect(eventos).toEqual([
      "cargar", "bloqueo", "auth", "consultar 361", "borrador", "liberar",
      "cargar", "guardar", "bloqueo", "auth", "ultimo", "verificando 362", "cae 362", "autorizado 362", "liberar",
    ]);
  });

  it("si ARCA lo tiene pero no informa el vencimiento del CAE, sigue en verificación", async () => {
    const { deps, eventos, fila } = escenario({
      datos: verificando(),
      consulta: { ...encontrado, caeVencimiento: null },
    });
    const resultado = await autorizar(ID, deps);
    expect(resultado.estado).toBe("verificando");
    expect(resultado.error).toContain("no informó el vencimiento del CAE");
    expect(resultado.error).toContain("apretá «Autorizar» de nuevo");
    expect(fila.estado).toBe("verificando");
    expect(eventos.some((e) => e.startsWith("autorizado") || e.startsWith("cae"))).toBe(false);
    expect(eventos.at(-1)).toBe("liberar");
  });

  it("si no puede consultar, sigue en verificación y no pide CAE", async () => {
    const { deps, eventos, fila } = escenario({ datos: verificando(), consulta: new TypeError("fetch failed") });
    const resultado = await autorizar(ID, deps);
    expect(resultado.estado).toBe("verificando");
    expect(resultado.error).toContain("No se pudo verificar el comprobante con ARCA");
    expect(fila.estado).toBe("verificando");
    expect(eventos.some((e) => e.startsWith("cae"))).toBe(false);
    expect(eventos.at(-1)).toBe("liberar");
  });
});

describe("autorizar: validaciones y casos que no llegan a ARCA", () => {
  it("devuelve los errores de validación sin tocar ARCA ni la base", async () => {
    const datos = datosBase();
    datos.cliente = { ...datos.cliente, condicionIva: null };
    datos.items = [];
    const { deps, eventos } = escenario({ datos });
    expect(await autorizar(ID, deps)).toEqual({
      error:
        "Completá la condición frente al IVA del cliente. Agregá al menos un ítem. El total tiene que ser mayor a cero.",
    });
    expect(eventos).toEqual(["cargar"]);
  });

  it("valida la fecha contra hoy en Argentina", async () => {
    const datos = datosBase();
    datos.comprobante.fecha = "2026-10-22";
    // 16/10 a las 23:30 en Argentina ya es 17/10 en UTC: hoy sigue siendo 16/10.
    const { deps } = escenario({ datos });
    const resultado = await autorizar(ID, { ...deps, ahora: () => new Date("2026-10-17T02:30:00Z") });
    expect(resultado.error).toBe("La fecha del comprobante tiene que estar entre el 11/10/2026 y el 21/10/2026.");
  });

  it("los puntos de venta no electrónicos todavía no se emiten", async () => {
    const datos = datosBase();
    datos.puntoVentaElectronico = false;
    datos.comprobante.ambiente = null;
    const { deps, eventos } = escenario({ datos });
    expect(await autorizar(ID, deps)).toEqual({
      error: "La emisión en puntos de venta no electrónicos todavía no está disponible.",
    });
    expect(eventos).toEqual(["cargar"]);
  });

  it("no autoriza dos veces", async () => {
    const datos = datosBase();
    datos.comprobante.estado = "autorizado";
    const { deps, eventos } = escenario({ datos });
    expect(await autorizar(ID, deps)).toEqual({ error: "El comprobante ya está autorizado.", estado: "autorizado" });
    expect(eventos).toEqual(["cargar"]);
  });

  it("informa si no existe", async () => {
    const { deps } = escenario({});
    expect(await autorizar("otro", deps)).toEqual({ error: "No se encontró el comprobante." });
  });

  it("pide las credenciales del ambiente si faltan", async () => {
    const datos = datosBase();
    datos.credencial = null;
    const { deps } = escenario({ datos });
    expect(await autorizar(ID, deps)).toEqual({
      error: "Cargá el certificado y la clave de ARCA de homologación en Configuración → ARCA.",
    });
  });

  it("traduce los errores de los triggers de la base", async () => {
    const { deps, eventos } = escenario({
      guardarFalla: new ErrorBaseDatos("CM004", "El comprobante está verificando: sus ítems ..."),
    });
    expect(await autorizar(ID, deps)).toEqual({
      error: "El comprobante se está verificando con ARCA: sus datos no se pueden cambiar hasta terminar la verificación.",
    });
    expect(eventos).not.toContain("bloqueo");
  });
});
