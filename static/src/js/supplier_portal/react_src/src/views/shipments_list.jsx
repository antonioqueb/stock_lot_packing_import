/* global React, Icon, Btn, Badge, Callout, Empty */

const STATUS_LABEL = {
  draft: 'Borrador',
  in_production: 'En producción',
  booked: 'Reservado',
  departed: 'Despachado',
  in_transit: 'En tránsito',
  arrived: 'Llegó',
  delivered: 'Entregado',
};
const STATUS_TONE = {
  draft: 'draft',
  in_production: 'partial',
  booked: 'accent',
  departed: 'accent',
  in_transit: 'accent',
  arrived: 'done',
  delivered: 'done',
};

const ShipmentsList = ({ proforma, setProforma, status, setRoute }) => {
  return (
    <div>
      <div className="crumb">
        <a onClick={() => setRoute({ section: 'overview' })}>Vista general</a>
        <Icon name="chevron_right" size={10}/>
        Embarques
      </div>

      <div className="page-head">
        <div className="text">
          <h1>Embarques</h1>
          <p className="lead">
            Cada embarque es un viaje físico (un buque, un vuelo o un camión). Puedes dividir la PO en uno o varios embarques.
          </p>
        </div>
        <div className="head-actions">
          <Btn variant="primary" icon="plus" onClick={() => {
            const newId = 's' + (proforma.shipments.length + 1);
            setProforma({
              ...proforma,
              shipments: [...proforma.shipments, {
                id: newId, number: proforma.shipments.length + 1, type: '',
                shipping_line: '', vessel: '', etd: '', eta: '', status: 'draft', notes: '',
                bl_number: '', bl_date: '', bl_file: '',
                invoices: [], containers: [], packings: [], documents: [],
              }]
            });
          }}>Agregar embarque</Btn>
        </div>
      </div>

      {proforma.shipments.length === 0 ? (
        <Empty icon="ship" title="No hay embarques registrados todavía"
               action={<Btn variant="accent" icon="plus">Crear el primer embarque</Btn>}>
          Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.
        </Empty>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          {proforma.shipments.map((s, idx) => {
            const sst = status.shipments_status[idx];
            return (
              <div key={s.id} className="ship-card" onClick={() => setRoute({ section: 'shipment', shipmentId: s.id })}>
                <div className="num">#{s.number}</div>
                <div className="meta">
                  <div className="title">
                    <span>{s.vessel || <span className="text-muted">Sin buque asignado</span>}</span>
                    <Badge tone={STATUS_TONE[s.status]} dot>{STATUS_LABEL[s.status] || 'Borrador'}</Badge>
                    {sst.status === 'done' && <Badge tone="done"><Icon name="check" size={10}/> Completo</Badge>}
                    {sst.status === 'partial' && <Badge tone="partial"><Icon name="minus" size={10}/> {sst.pct}%</Badge>}
                    {sst.status === 'todo' && <Badge tone="todo">Sin datos</Badge>}
                  </div>
                  <div className="route">
                    <span><Icon name="anchor" size={11}/> {s.shipping_line || 'Sin naviera'}</span>
                    <span className="arrow">·</span>
                    <span className="mono">{proforma.globals.port_origin || '—'}</span>
                    <Icon name="arrow_right" size={11} className="arrow"/>
                    <span className="mono">{proforma.globals.port_destination || '—'}</span>
                    <span className="arrow">·</span>
                    <span>ETD <span className="mono">{s.etd || '—'}</span></span>
                    <span>ETA <span className="mono">{s.eta || '—'}</span></span>
                  </div>
                </div>

                <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
                  <div style={{textAlign: 'right', fontSize: 12}}>
                    <div className="mono" style={{fontWeight: 700, fontSize: 16}}>{sst.pct}%</div>
                    <div className="text-muted" style={{fontSize: 11}}>completo</div>
                  </div>
                  <div className="completion" title="Logística · B/L · Invoices · Contenedores · Packing">
                    <span className={`cdot ${sst.tabs.hasLog ? 'done' : ''}`}/>
                    <span className={`cdot ${sst.tabs.hasBL ? 'done' : ''}`}/>
                    <span className={`cdot ${sst.tabs.hasInv ? 'done' : ''}`}/>
                    <span className={`cdot ${sst.tabs.hasContainers ? 'done' : ''}`}/>
                    <span className={`cdot ${sst.tabs.hasPacking ? 'done' : ''}`}/>
                  </div>
                  <Icon name="chevron_right" size={18} style={{color: 'var(--ink-4)'}}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Callout tone="info" icon="info" title="¿Cuándo divido en varios embarques?">
        Si tu producción se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque está bien.
      </Callout>
    </div>
  );
};

window.ShipmentsList = ShipmentsList;
window.STATUS_LABEL = STATUS_LABEL;
window.STATUS_TONE = STATUS_TONE;
