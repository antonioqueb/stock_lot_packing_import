/* global React, Icon, ProgressRing, Badge, Btn, Callout */

const Overview = ({ proforma, status, setRoute }) => {
  // Pending items list, in plain language
  const pending = [];
  if (status.globals_pct < 100) pending.push({
    id: 'globals', icon: 'globe', tone: 'partial',
    title: 'Completar datos generales de la Proforma',
    desc: `Completa el número de Proforma y el puerto destino.`,
    action: () => setRoute({ section: 'globals' }),
  });
  proforma.shipments.forEach((s, idx) => {
    const sst = status.shipments_status[idx];
    if (sst.status === 'done') return;
    const reasons = [];
    if (!sst.tabs.hasLog) reasons.push('logística');
    if (!sst.tabs.hasBL)  reasons.push('B/L');
    if (!sst.tabs.hasInv) reasons.push('invoices');
    if (!sst.tabs.hasContainers) reasons.push('contenedores');
    if (!sst.tabs.hasPacking) reasons.push('packing list');
    pending.push({
      id: 's-' + s.id, icon: 'ship', tone: sst.status,
      title: `Embarque #${s.number} — ${sst.pct}% completo`,
      desc: reasons.length ? `Pendiente: ${reasons.join(', ')}.` : 'Sin pendientes.',
      action: () => setRoute({ section: 'shipment', shipmentId: s.id }),
    });
  });

  const greetName = (proforma.vendor || '').split(' ')[0];

  return (
    <div>
      <div className="crumb"><Icon name="home" size={12}/> Vista general</div>

      <div className="hero">
        <div>
          <p className="greet">Hola, equipo de {proforma.vendor}</p>
          <h1>Bienvenido al portal del proveedor</h1>
          <p className="lead">
            Aquí vas a registrar todos los datos del envío para la Orden de Compra <strong className="mono">{proforma.po_name}</strong>.
            No tienes que terminar de una sola vez — guardamos lo que escribas automáticamente y puedes volver cuando quieras.
          </p>
          <div className="hero-meta">
            <div className="item">
              <strong>{proforma.shipments.length}</strong>
              embarques
            </div>
            <div className="item">
              <strong>{proforma.shipments.reduce((a,s) => a + s.containers.length, 0)}</strong>
              contenedores
            </div>
            <div className="item">
              <strong>{proforma.shipments.reduce((a,s) => a + s.invoices.length, 0)}</strong>
              invoices
            </div>
            <div className="item">
              <strong>{proforma.products.reduce((a,p) => a + p.requested_qty, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              cantidad solicitada
            </div>
          </div>
        </div>
        <ProgressRing pct={status.overall} size={148} stroke={10} label={status.overall === 100 ? 'listo' : 'completo'}/>
      </div>

      {status.overall < 100 && (
        <div className="card">
          <div className="card-head no-divider">
            <div>
              <h2>Lo que te falta para terminar</h2>
              <p className="sub">Ordenados de lo más fácil a lo más detallado. Comienza por el primero.</p>
            </div>
            <Btn variant="accent" icon="play" onClick={() => pending[0]?.action()}>{status.overall > 0 ? 'Continuar donde quedé' : 'Comenzar'}</Btn>
          </div>

          <div className="chk-list">
            {pending.map(p => (
              <div key={p.id} className="chk-item" onClick={p.action}>
                <span className={`chk-icon ${p.tone}`}>
                  <Icon name={p.tone === 'done' ? 'check' : p.tone === 'partial' ? 'minus' : 'plus'} size={14}/>
                </span>
                <div className="chk-body">
                  <div className="title">{p.title}</div>
                  <div className="desc">{p.desc}</div>
                </div>
                <Icon name="chevron_right" size={16} className="chevron"/>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head no-divider">
          <div>
            <h3>Productos solicitados en esta Proforma</h3>
            <p className="sub">Esto es lo que SOM GROUP te pidió. Tendrás que registrar packing list que los incluya a todos.</p>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Dimensión</th>
              <th style={{textAlign:'right'}}>Solicitado</th>
            </tr>
          </thead>
          <tbody>
            {proforma.products.map(p => (
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td className="ink-3">{p.kind === 'placa' ? 'Placa / Slab' : p.kind === 'formato' ? 'Formato / Tile' : 'Pieza'}</td>
                <td className="mono ink-3">{p.dim_text}</td>
                <td style={{textAlign:'right'}} className="mono"><strong>{p.requested_qty}</strong> <span className="ink-3">{p.unit}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Callout tone="info" icon="sparkles" title="Tip: el packing list es lo más detallado.">
        Antes de capturar placa por placa, vas a configurar los <strong>bloques</strong> que se cargarán. El portal generará automáticamente las filas que necesitas llenar. Subiendo una foto por bloque ahorras escribir muchos detalles.
      </Callout>
    </div>
  );
};

window.Overview = Overview;
