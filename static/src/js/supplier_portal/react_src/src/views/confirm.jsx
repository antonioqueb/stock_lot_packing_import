/* global React, Icon, Btn, Badge, Callout, ProgressRing */

const Confirm = ({ proforma, status, setRoute }) => {
  const allDone = status.overall >= 100;

  const checks = [
    { ok: status.globals_pct === 100, label: 'Datos generales de la Proforma', detail: status.globals_pct === 100 ? 'Completos' : `${status.globals_pct}% — faltan campos requeridos` },
    ...proforma.shipments.map((s, i) => {
      const sst = status.shipments_status[i];
      const miss = [];
      if (!sst.tabs.hasLog) miss.push('logística');
      if (!sst.tabs.hasBL)  miss.push('B/L');
      if (!sst.tabs.hasInv) miss.push('invoices');
      if (!sst.tabs.hasContainers) miss.push('contenedores');
      if (!sst.tabs.hasPacking) miss.push('packing');
      return {
        ok: sst.status === 'done',
        label: `Embarque #${s.number}`,
        detail: sst.status === 'done' ? 'Todo capturado' : `Pendiente: ${miss.join(', ')}`,
      };
    }),
  ];

  return (
    <div>
      <div className="crumb">
        <a onClick={() => setRoute({ section: 'overview' })}>Vista general</a>
        <Icon name="chevron_right" size={10}/>
        Revisar y enviar
      </div>

      <div className="page-head">
        <div className="text">
          <h1>Revisar y enviar a SOM GROUP</h1>
          <p className="lead">
            Última revisión antes de marcar la Proforma como completa. Una vez enviada, nuestro equipo recibirá una notificación y empezará la coordinación de aduanas.
          </p>
        </div>
        <div className="head-actions">
          <ProgressRing pct={status.overall} size={68} stroke={6} label="listo"/>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Resumen general</h2>
            <p className="sub">Datos que se enviarán como confirmación.</p>
          </div>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16}}>
          <StatCard label="Proforma" value={proforma.globals.proforma_number || '—'} mono/>
          <StatCard label="Orden de compra" value={proforma.po_name} mono/>
          <StatCard label="Incoterm" value={proforma.globals.incoterm || '—'}/>
          <StatCard label="Origen → Destino" value={`${proforma.globals.port_origin || '?'} → ${proforma.globals.port_destination || '?'}`}/>
          <StatCard label="Embarques" value={proforma.shipments.length}/>
          <StatCard label="Total invoices" value={`${proforma.shipments.reduce((a,s) => a + s.invoices.reduce((b,i) => b + (i.amount || 0), 0), 0).toLocaleString()} USD`} mono/>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Checklist final</h2>
            <p className="sub">Verifica que cada sección esté completa.</p>
          </div>
        </div>

        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid',
              borderColor: c.ok ? 'var(--ok-border)' : 'var(--warn-border)',
              background: c.ok ? 'var(--ok-soft)' : 'var(--warn-soft)',
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 50, display: 'grid', placeItems: 'center',
                background: c.ok ? 'var(--ok)' : 'var(--warn)', color: 'white'
              }}>
                <Icon name={c.ok ? 'check' : 'minus'} size={14}/>
              </div>
              <div style={{flex: 1}}>
                <strong style={{fontSize: 14}}>{c.label}</strong>
                <div className="text-muted" style={{fontSize: 12.5}}>{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!allDone && (
        <Callout tone="warn" icon="alert" title="Aún no puedes marcar como completa">
          Termina los puntos pendientes del checklist. Puedes seguir trabajando — tus datos se guardan automáticamente.
        </Callout>
      )}

      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24}}>
        <span className="text-muted text-small">Al marcar como completa, SOM GROUP recibirá un correo automático.</span>
        <div style={{display: 'flex', gap: 8}}>
          <Btn variant="ghost" onClick={() => setRoute({ section: 'overview' })}>Volver</Btn>
          <Btn variant="accent" size="lg" icon="flag" disabled={!allDone}>
            {allDone ? 'Marcar como completa' : 'Faltan datos requeridos'}
          </Btn>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, mono }) => (
  <div style={{padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-alt)'}}>
    <div className="text-muted" style={{fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4}}>{label}</div>
    <div className={mono ? 'mono' : ''} style={{fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', wordBreak: 'break-word'}}>{value}</div>
  </div>
);

window.Confirm = Confirm;
