-- =====================================================================
-- Silfe Costos - Configuración de ARCA (base de la facturación electrónica)
-- arca_emisor guarda los datos fiscales del emisor (fila única, como
-- parametro_costeo). arca_credencial guarda, por ambiente, el certificado
-- de ARCA, la clave privada y el ticket de acceso de WSAA. La clave y el
-- ticket se guardan cifrados con AES-256-GCM usando el secreto del Worker
-- ARCA_CLAVE_CIFRADO: la base nunca ve la clave privada en claro.
-- =====================================================================

-- ----- Emisor (fila única) -----------------------------------------------

create table arca_emisor (
  id              boolean primary key default true check (id),
  cuit            text,
  razon_social    text,
  condicion_iva   text,
  punto_venta     integer,
  ambiente        text not null default 'homologacion',
  actualizado_en  timestamptz not null default now(),
  constraint arca_emisor_cuit_check check (cuit ~ '^\d{11}$'),
  constraint arca_emisor_condicion_iva_check check (
    condicion_iva in ('Responsable Inscripto', 'Monotributista', 'Exento')
  ),
  constraint arca_emisor_punto_venta_check check (punto_venta between 1 and 99999),
  constraint arca_emisor_ambiente_check check (ambiente in ('homologacion', 'produccion'))
);

insert into arca_emisor (id) values (true);

comment on table arca_emisor is
  'Datos fiscales del emisor de comprobantes electrónicos (fila única)';
comment on column arca_emisor.cuit is
  'CUIT del emisor, 11 dígitos sin guiones. Vacía hasta configurarla';
comment on column arca_emisor.condicion_iva is
  'Condición frente al IVA: define el tipo de comprobante por defecto (A o C)';
comment on column arca_emisor.punto_venta is
  'Punto de venta habilitado en ARCA para Web Services (1 a 99999)';
comment on column arca_emisor.ambiente is
  'Ambiente activo de ARCA: homologacion (pruebas) o produccion';

create trigger trg_arca_emisor_actualizado before update on arca_emisor
  for each row execute function fn_set_actualizado_en();

-- ----- Credenciales por ambiente -----------------------------------------

create table arca_credencial (
  ambiente             text primary key,
  certificado_pem      text not null,
  certificado_titular  text,
  certificado_cuit     text not null,
  certificado_vence    timestamptz not null,
  clave_cifrada        text not null,
  ta_cifrado           text,
  ta_expira            timestamptz,
  ta_bloqueado_hasta   timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint arca_credencial_ambiente_check check (ambiente in ('homologacion', 'produccion')),
  constraint arca_credencial_certificado_cuit_check check (certificado_cuit ~ '^\d{11}$'),
  -- Defensa en la base: lo que se guarda tiene que ser texto cifrado
  -- ("v1.<iv>.<datos>") y nunca un PEM de clave privada en claro.
  constraint arca_credencial_clave_cifrada_check check (
    clave_cifrada like 'v1.%' and position('PRIVATE KEY' in clave_cifrada) = 0
  ),
  constraint arca_credencial_ta_cifrado_check check (
    ta_cifrado like 'v1.%' and position('PRIVATE KEY' in ta_cifrado) = 0
  )
);

comment on table arca_credencial is
  'Certificado, clave privada y ticket de acceso de ARCA, una fila por ambiente';
comment on column arca_credencial.certificado_pem is
  'Certificado X.509 emitido por ARCA, en PEM. Es público: no se cifra';
comment on column arca_credencial.certificado_titular is
  'Nombre común (CN) del certificado, para mostrar en la pantalla';
comment on column arca_credencial.certificado_cuit is
  'CUIT del certificado (serialNumber del sujeto), 11 dígitos';
comment on column arca_credencial.certificado_vence is
  'Fin de vigencia del certificado';
comment on column arca_credencial.clave_cifrada is
  'Clave privada RSA cifrada con AES-256-GCM (formato v1.<iv>.<datos>) con el secreto del Worker ARCA_CLAVE_CIFRADO. Nunca en claro';
comment on column arca_credencial.ta_cifrado is
  'Ticket de acceso de WSAA (token y sign) cifrado con AES-256-GCM con el secreto del Worker ARCA_CLAVE_CIFRADO';
comment on column arca_credencial.ta_expira is
  'Vencimiento del ticket de acceso (dura 12 h). Mientras esté vigente se reutiliza';
comment on column arca_credencial.ta_bloqueado_hasta is
  'Bloqueo corto mientras se pide un ticket nuevo, para no pedir dos a la vez';

create trigger trg_arca_credencial_actualizado before update on arca_credencial
  for each row execute function fn_set_actualizado_en();
