/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, ProgressRing */

const Globals = ({ proforma, setProforma, status, setRoute, validationStyle = 'inline' }) => {
  const g = proforma.globals;
  const update = (k, v) => setProforma({ ...proforma, globals: { ...g, [k]: v } });

  const errors = {};
  // simulated validation
  if (g.proforma_number && !/^PI-/i.test(g.proforma_number)) errors.proforma_number = 'El número debería empezar con "PI-" para identificar una Proforma.';
  if (!g.incoterm) errors.incoterm = 'Falta este dato: define quién paga y se hace cargo del transporte.';
  if (!g.port_destination) errors.port_destination = 'Es necesario para coordinar la llegada del embarque.';

  const errorList = Object.entries(errors);

  return (
    <div>
      <div className="crumb">
        <a onClick={() => setRoute({ section: 'overview' })}>Vista general</a>
        <Icon name="chevron_right" size={10}/>
        Datos de la Proforma
      </div>

      <div className="page-head">
        <div className="text">
          <h1>Datos generales de la Proforma</h1>
          <p className="lead">
            Información que se aplica a todos los embarques de esta Orden de Compra. Llénala una sola vez al inicio.
          </p>
        </div>
        <div className="head-actions">
          <Badge tone={status.globals_status === 'done' ? 'done' : status.globals_status === 'partial' ? 'partial' : 'todo'}>
            <Icon name={status.globals_status === 'done' ? 'check' : 'minus'} size={11}/>
            {status.globals_pct}% completo
          </Badge>
        </div>
      </div>

      {validationStyle === 'sticky' && errorList.length > 0 && (
        <div className="val-banner">
          <Icon name="alert" size={16}/>
          <div>
            <strong>{errorList.length} {errorList.length === 1 ? 'campo necesita atención' : 'campos necesitan atención'}.</strong>
            {' '}Corrige los puntos resaltados abajo para poder continuar.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Identificación</h2>
            <p className="sub">Cómo identifica este lote tu sistema y el nuestro.</p>
          </div>
        </div>
        <div className="fld-row">
          <Field
            label="Número de Proforma"
            required
            help="Es el número con el que tu sistema identifica esta venta (Proforma Invoice)."
            helpExample="Ej: PI-9920-A"
            error={validationStyle !== 'block' && errors.proforma_number}
          >
            <Input mono placeholder="PI-9920-A" value={g.proforma_number}
                   onChange={(e) => update('proforma_number', e.target.value)}/>
          </Field>

          <Field
            label="Factura global"
            optional
            help="Si emites una factura comercial que cubre toda la PO, escríbela aquí. Si tienes una por embarque, déjalo vacío y llénalo en cada embarque."
          >
            <Input mono placeholder="INV-2026-001 (opcional)" value={g.invoice_global}
                   onChange={(e) => update('invoice_global', e.target.value)}/>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Logística internacional</h2>
            <p className="sub">Ruta y términos del envío. Estos datos van impresos en la documentación de aduanas.</p>
          </div>
        </div>
        <div className="fld-row cols-3">
          <Field label="País de origen" required
                 help="País desde donde sale la mercancía.">
            <Input placeholder="Ej. China" value={g.country_origin}
                   onChange={(e) => update('country_origin', e.target.value)}/>
          </Field>
          <Field label="Puerto de origen" required
                 help="Puerto marítimo o aeropuerto desde donde zarpa el embarque." helpExample="Ej: Shanghai, Ningbo">
            <Input placeholder="Ej. Shanghai" value={g.port_origin}
                   onChange={(e) => update('port_origin', e.target.value)}/>
          </Field>
          <Field label="Puerto destino" required
                 help="El puerto mexicano donde llegará el embarque."
                 helpExample="Ej: Manzanillo, Veracruz, Lázaro Cárdenas"
                 error={errors.port_destination}>
            <Input placeholder="Ej. Manzanillo" value={g.port_destination}
                   onChange={(e) => update('port_destination', e.target.value)}/>
          </Field>
        </div>

        <div className="fld-row" style={{marginTop: 16}}>
          <Field label="Incoterm" required
                 help="Define qué parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no estás seguro, pregunta a tu contacto de SOM GROUP."
                 helpExample="CIF = tú pagas hasta el puerto destino, incluyendo seguro"
                 error={errors.incoterm}>
            <Select value={g.incoterm} onChange={(e) => update('incoterm', e.target.value)}>
              <option value="">Selecciona…</option>
              <option>EXW</option><option>FOB</option><option>CIF</option>
              <option>CFR</option><option>DAP</option><option>DDP</option>
            </Select>
          </Field>
          <Field label="Condiciones de pago" required
                 help="Cómo y cuándo te van a pagar."
                 helpExample="T/T 30% advance, 70% B/L copy">
            <Input placeholder="Ej. T/T 30% advance, 70% B/L copy" value={g.payment_terms}
                   onChange={(e) => update('payment_terms', e.target.value)}/>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Observaciones generales</h2>
            <p className="sub">¿Hay algo que SOM GROUP debe saber antes de recibir? Restricciones, demoras, cuidados especiales.</p>
          </div>
        </div>
        <Field optional hint="Esto se incluirá en la confirmación final. Puedes dejarlo vacío si no aplica.">
          <Textarea rows={3} placeholder="Ej. Las placas vienen empacadas en bundles de madera dura. Cuidado con esquinas." value={g.general_notes}
                    onChange={(e) => update('general_notes', e.target.value)}/>
        </Field>
      </div>

      {validationStyle === 'block' && errorList.length > 0 && (
        <Callout tone="error" icon="alert" title={`Hay ${errorList.length} ${errorList.length === 1 ? 'campo' : 'campos'} sin completar:`}>
          <ul style={{margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6}}>
            {errorList.map(([k, v]) => <li key={k}><strong>{k}:</strong> {v}</li>)}
          </ul>
        </Callout>
      )}

      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24}}>
        <span className="text-muted text-small">
          <Icon name="check" size={12}/> Guardado automático activo
        </span>
        <div style={{display: 'flex', gap: 8}}>
          <Btn variant="ghost" onClick={() => setRoute({ section: 'overview' })}>Volver</Btn>
          <Btn variant="primary" iconRight="arrow_right"
               onClick={() => setRoute({ section: 'shipments' })}
               disabled={validationStyle === 'block' && errorList.length > 0}>
            Continuar a embarques
          </Btn>
        </div>
      </div>
    </div>
  );
};

window.Globals = Globals;
