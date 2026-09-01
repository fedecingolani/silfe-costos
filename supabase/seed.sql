-- =====================================================================
-- Silfe Costos - Datos de ejemplo
-- Fabricación de elementos para cosecha de fruta.
-- Ejecutable varias veces (idempotente por códigos).
-- =====================================================================

-- Unidades ------------------------------------------------------------
insert into unidad_medida (codigo, nombre, magnitud) values
  ('u',   'Unidad',            'UNIDAD'),
  ('par', 'Par',               'UNIDAD'),
  ('kg',  'Kilogramo',         'MASA'),
  ('g',   'Gramo',             'MASA'),
  ('m',   'Metro',             'LONGITUD'),
  ('cm',  'Centímetro',        'LONGITUD'),
  ('m2',  'Metro cuadrado',    'SUPERFICIE'),
  ('l',   'Litro',             'VOLUMEN'),
  ('ml',  'Mililitro',         'VOLUMEN')
on conflict (codigo) do nothing;

insert into conversion_unidad (unidad_origen_id, unidad_destino_id, factor)
select o.id, d.id, c.factor
from (values
  ('kg','g',1000),
  ('g','kg',0.001),
  ('m','cm',100),
  ('cm','m',0.01),
  ('l','ml',1000),
  ('ml','l',0.001)
) as c(origen, destino, factor)
join unidad_medida o on o.codigo = c.origen
join unidad_medida d on d.codigo = c.destino
on conflict do nothing;

-- Proveedores ---------------------------------------------------------
insert into proveedor (nombre, cuit, contacto, telefono, email) values
  ('Textiles del Valle SRL',   '30-71234567-9', 'Marcela Ruiz',  '261-4567890', 'ventas@textilesdelvalle.com.ar'),
  ('Sogas Andinas',            '30-70987654-3', 'Jorge Peña',    '261-4112233', 'pedidos@sogasandinas.com.ar'),
  ('Bulonera Cuyo',            '30-69876543-2', 'Ana Gómez',     '261-4998877', 'info@bulonericuyo.com.ar'),
  ('Plásticos San Rafael',     '30-68765432-1', 'Luis Ferreyra', '260-4223344', 'ventas@plasticossr.com.ar')
on conflict do nothing;

-- Materia prima -------------------------------------------------------
insert into materia_prima (codigo, nombre, categoria, unidad_compra_id, unidad_uso_id, factor_conversion, merma_pct, notas)
select m.codigo, m.nombre, m.categoria, uc.id, uu.id, m.factor, m.merma, m.notas
from (values
  ('MP-001','Lona PVC 650 g/m²',        'Textil',   'kg', 'm2',  1.5385, 6.0,  'Rollo de 1,5 m de ancho. 1 kg rinde ~1,54 m²'),
  ('MP-002','Cincha polipropileno 40mm','Textil',   'kg', 'm',   38.0,   2.0,  'Comprada por kg, usada por metro'),
  ('MP-003','Soga polipropileno 8mm',   'Textil',   'kg', 'm',   20.0,   3.0,  '1 kg = 20 m aprox.'),
  ('MP-004','Hilo poliéster 40/3',      'Textil',   'kg', 'm',   9000.0, 5.0,  'Cono industrial'),
  ('MP-005','Remache tubular 8mm',      'Ferretería','u', 'u',   1.0,    2.0,  null),
  ('MP-006','Arandela plana 8mm',       'Ferretería','u', 'u',   1.0,    2.0,  null),
  ('MP-007','Hebilla regulable 40mm',   'Ferretería','u', 'u',   1.0,    1.0,  null),
  ('MP-008','Mosquetón acero 6mm',      'Ferretería','u', 'u',   1.0,    0.0,  null),
  ('MP-009','Caño estructural 3/4"',    'Metal',    'kg', 'm',   0.9,    4.0,  'Caño de 6 m, ~6,7 kg'),
  ('MP-010','Malla plástica cosechera', 'Plástico', 'kg', 'm2',  4.0,    5.0,  null),
  ('MP-011','Espuma EVA 10mm',          'Plástico', 'm2', 'm2',  1.0,    8.0,  'Para acolchado de correas'),
  ('MP-012','Pintura epoxi',            'Químicos', 'l',  'ml',  1000.0, 10.0, null)
) as m(codigo, nombre, categoria, u_compra, u_uso, factor, merma, notas)
join unidad_medida uc on uc.codigo = m.u_compra
join unidad_medida uu on uu.codigo = m.u_uso
on conflict (codigo) do nothing;

-- Precios (por unidad de compra) --------------------------------------
insert into precio_materia_prima (materia_prima_id, proveedor_id, precio, vigente_desde, es_preferido)
select mp.id, pv.id, p.precio, current_date - 30, true
from (values
  ('MP-001','Textiles del Valle SRL',   9800.00),
  ('MP-002','Textiles del Valle SRL',   7400.00),
  ('MP-003','Sogas Andinas',            6200.00),
  ('MP-004','Textiles del Valle SRL',  21500.00),
  ('MP-005','Bulonera Cuyo',              38.50),
  ('MP-006','Bulonera Cuyo',              12.90),
  ('MP-007','Bulonera Cuyo',             410.00),
  ('MP-008','Bulonera Cuyo',            1150.00),
  ('MP-009','Bulonera Cuyo',            2350.00),
  ('MP-010','Plásticos San Rafael',     8900.00),
  ('MP-011','Plásticos San Rafael',     5600.00),
  ('MP-012','Plásticos San Rafael',    18700.00)
) as p(codigo, proveedor, precio)
join materia_prima mp on mp.codigo = p.codigo
join proveedor pv on pv.nombre = p.proveedor
on conflict do nothing;

-- Segunda cotización para comparar
insert into precio_materia_prima (materia_prima_id, proveedor_id, precio, vigente_desde, es_preferido, observaciones)
select mp.id, pv.id, 6650.00, current_date - 10, false, 'Cotización alternativa, entrega a 20 días'
from materia_prima mp, proveedor pv
where mp.codigo = 'MP-003' and pv.nombre = 'Plásticos San Rafael'
on conflict do nothing;

-- Mano de obra --------------------------------------------------------
insert into categoria_mano_obra (nombre, costo_hora, cargas_sociales_pct) values
  ('Costurera',        3200.00, 45.0),
  ('Armador',          2900.00, 45.0),
  ('Oficial metalúrgico', 4100.00, 45.0),
  ('Ayudante',         2400.00, 45.0)
on conflict (nombre) do nothing;

insert into proceso (codigo, nombre, descripcion) values
  ('PR-01','Corte',        'Corte de lona, cincha y mallas'),
  ('PR-02','Costura',      'Costura industrial de piezas textiles'),
  ('PR-03','Remachado',    'Colocación de remaches y arandelas'),
  ('PR-04','Armado',       'Armado final del producto'),
  ('PR-05','Soldadura',    'Soldadura de estructura metálica'),
  ('PR-06','Pintura',      'Pintura epoxi y secado'),
  ('PR-07','Control y embalaje', 'Control de calidad y embalado')
on conflict (codigo) do nothing;

-- Productos y subgrupos ----------------------------------------------
insert into producto (codigo, nombre, tipo, descripcion, unidad_id)
select p.codigo, p.nombre, p.tipo::tipo_producto, p.descripcion, u.id
from (values
  ('SG-001','Lona recolectora',      'SUBGRUPO',  'Bolsa de lona con boca reforzada'),
  ('SG-002','Juego de correas',      'SUBGRUPO',  'Correas de hombro acolchadas con hebillas'),
  ('SG-003','Estructura de canasto', 'SUBGRUPO',  'Aro y bastidor metálico'),
  ('PT-001','Bolso recolector de fruta', 'TERMINADO', 'Bolso recolector con lona, correas y descarga inferior'),
  ('PT-002','Canasto cosechero 20 kg',   'TERMINADO', 'Canasto con estructura metálica y malla plástica')
) as p(codigo, nombre, tipo, descripcion)
join unidad_medida u on u.codigo = 'u'
on conflict (codigo) do nothing;

-- Estructura del subgrupo "Lona recolectora"
insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, merma_pct, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, c.cantidad, c.merma, c.orden
from (values
  ('SG-001','MP-001', 0.85,  4.0, 1),
  ('SG-001','MP-004', 22.0,  8.0, 2),
  ('SG-001','MP-003', 1.20,  5.0, 3)
) as c(producto, materia, cantidad, merma, orden)
join producto pr on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.materia
on conflict do nothing;

-- Estructura del subgrupo "Juego de correas"
insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, merma_pct, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, c.cantidad, c.merma, c.orden
from (values
  ('SG-002','MP-002', 3.20,  3.0, 1),
  ('SG-002','MP-011', 0.18,  10.0, 2),
  ('SG-002','MP-007', 2.0,   0.0, 3),
  ('SG-002','MP-004', 14.0,  8.0, 4)
) as c(producto, materia, cantidad, merma, orden)
join producto pr on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.materia
on conflict do nothing;

-- Estructura del subgrupo "Estructura de canasto"
insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, merma_pct, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, c.cantidad, c.merma, c.orden
from (values
  ('SG-003','MP-009', 2.80,  6.0, 1),
  ('SG-003','MP-012', 45.0,  12.0, 2)
) as c(producto, materia, cantidad, merma, orden)
join producto pr on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.materia
on conflict do nothing;

-- Estructura del producto terminado PT-001 (subgrupos + items sueltos)
insert into producto_componente (producto_id, tipo, subgrupo_id, cantidad, merma_pct, orden)
select pr.id, 'SUBGRUPO', sg.id, c.cantidad, 0, c.orden
from (values
  ('PT-001','SG-001', 1.0, 1),
  ('PT-001','SG-002', 1.0, 2)
) as c(producto, subgrupo, cantidad, orden)
join producto pr on pr.codigo = c.producto
join producto sg on sg.codigo = c.subgrupo
on conflict do nothing;

insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, merma_pct, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, c.cantidad, c.merma, c.orden
from (values
  ('PT-001','MP-005', 12.0, 3.0, 3),
  ('PT-001','MP-006', 12.0, 3.0, 4),
  ('PT-001','MP-008',  2.0, 0.0, 5)
) as c(producto, materia, cantidad, merma, orden)
join producto pr on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.materia
on conflict do nothing;

-- Estructura del producto terminado PT-002
insert into producto_componente (producto_id, tipo, subgrupo_id, cantidad, merma_pct, orden)
select pr.id, 'SUBGRUPO', sg.id, 1.0, 0, 1
from producto pr, producto sg
where pr.codigo = 'PT-002' and sg.codigo = 'SG-003'
on conflict do nothing;

insert into producto_componente (producto_id, tipo, materia_prima_id, cantidad, merma_pct, orden)
select pr.id, 'MATERIA_PRIMA', mp.id, c.cantidad, c.merma, c.orden
from (values
  ('PT-002','MP-010', 0.95, 6.0, 2),
  ('PT-002','MP-003', 2.40, 4.0, 3),
  ('PT-002','MP-005', 18.0, 3.0, 4)
) as c(producto, materia, cantidad, merma, orden)
join producto pr on pr.codigo = c.producto
join materia_prima mp on mp.codigo = c.materia
on conflict do nothing;

-- Procesos por producto -----------------------------------------------
insert into producto_proceso (producto_id, proceso_id, orden, modo, minutos, categoria_mano_obra_id, cantidad_por_ciclo)
select pr.id, pc.id, x.orden, 'TIEMPO', x.minutos, cm.id, x.ciclo
from (values
  ('SG-001','PR-01', 1,  6.0,  'Ayudante',           1.0),
  ('SG-001','PR-02', 2, 18.0,  'Costurera',          1.0),
  ('SG-002','PR-01', 1,  4.0,  'Ayudante',           1.0),
  ('SG-002','PR-02', 2, 12.0,  'Costurera',          1.0),
  ('SG-003','PR-05', 1, 14.0,  'Oficial metalúrgico',1.0),
  ('PT-001','PR-03', 1,  7.0,  'Armador',            1.0),
  ('PT-001','PR-04', 2, 10.0,  'Armador',            1.0),
  ('PT-002','PR-04', 1, 16.0,  'Armador',            1.0)
) as x(producto, proceso, orden, minutos, categoria, ciclo)
join producto pr on pr.codigo = x.producto
join proceso pc on pc.codigo = x.proceso
join categoria_mano_obra cm on cm.nombre = x.categoria
on conflict do nothing;

-- Procesos con costo fijo por unidad (tercerizados / a destajo)
insert into producto_proceso (producto_id, proceso_id, orden, modo, costo_fijo, cantidad_por_ciclo, notas)
select pr.id, pc.id, x.orden, 'FIJO', x.costo, x.ciclo, x.notas
from (values
  ('SG-003','PR-06', 2, 3800.00, 4.0, 'Pintura tercerizada, se pintan 4 estructuras por tanda'),
  ('PT-001','PR-07', 3,  450.00, 1.0, 'Control y embalaje pagado por unidad'),
  ('PT-002','PR-07', 2,  520.00, 1.0, 'Control y embalaje pagado por unidad')
) as x(producto, proceso, orden, costo, ciclo, notas)
join producto pr on pr.codigo = x.producto
join proceso pc on pc.codigo = x.proceso
on conflict do nothing;

-- Parámetros ----------------------------------------------------------
update parametro_costeo
   set moneda = 'ARS', gastos_generales_pct = 18, margen_pct = 35
 where id;
