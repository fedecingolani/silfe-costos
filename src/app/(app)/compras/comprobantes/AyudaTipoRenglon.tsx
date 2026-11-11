/**
 * Ayuda desplegable para el operario: cuándo elegir cada tipo de renglón
 * (artículo del proveedor, artículo nuevo o renglón libre) y qué cambia
 * en el costeo según la elección.
 */
export function AyudaTipoRenglon() {
  return (
    <details className="mb-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
      <summary className="cursor-pointer font-medium text-marca-700">¿Qué tipo de renglón elijo?</summary>
      <div className="mt-2 space-y-3">
        <p>
          Cada renglón tiene que quedar unido a una <strong>materia prima</strong> cuando lo que se compra se usa
          para fabricar: así el precio de la factura puede llegar al costo de los productos.
        </p>
        <dl className="space-y-2">
          <div>
            <dt className="font-medium">Artículo del proveedor</dt>
            <dd>
              El artículo ya está en el catálogo de este proveedor. Buscalo y elegilo: la materia prima, la unidad y
              la conversión salen solas. Es la opción de todos los días y la única que acepta renglones de un
              remito.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Artículo nuevo</dt>
            <dd>
              El proveedor factura algo que todavía no está en su catálogo. Completá descripción, unidad, cuántas
              unidades de la materia prima trae cada unidad del proveedor, y la materia prima. Al guardar queda
              dado de alta: la próxima factura ya lo vas a encontrar como «Artículo del proveedor».
            </dd>
          </div>
          <div>
            <dt className="font-medium">Renglón libre (flete, servicio)</dt>
            <dd>
              Lo que no es materia prima: fletes, servicios, trabajos de terceros. Suma al total de la factura pero
              no toca el costo de los productos.
            </dd>
          </div>
        </dl>
        <p>
          <strong>Ojo:</strong> si cargás como renglón libre algo que es materia prima, su precio nunca llega al
          costeo. Y si cargás un flete como artículo, ensucia el precio de la materia prima. Al confirmar la factura
          vas a poder elegir qué precios actualizar, pero sólo de los renglones con artículo.
        </p>
      </div>
    </details>
  );
}
