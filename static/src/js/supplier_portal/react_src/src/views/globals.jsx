/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, ProgressRing */

const Globals = ({ proforma, setProforma, status, setRoute, validationStyle = 'inline' }) => {
  const g = proforma.globals;
  const update = (k, v) => setProforma({ ...proforma, globals: { ...g, [k]: v } });

  const errors = {};

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
