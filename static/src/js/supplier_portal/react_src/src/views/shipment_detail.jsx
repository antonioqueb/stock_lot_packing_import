/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, Empty, Imgph, StatusDot, STATUS_LABEL, STATUS_TONE */

const SHIP_TABS = [
  { id: 'logistics',  label: 'Logística + B/L', icon: 'ship' },
  { id: 'invoices',   label: 'Invoices',        icon: 'invoice' },
  { id: 'containers', label: 'Contenedores',    icon: 'container' },
  { id: 'packings',   label: 'Packing List',    icon: 'box' },
  { id: 'documents',  label: 'Documentos',      icon: 'file' },
];

const ShipmentDetail = ({ proforma, setProforma, status, setRoute, route, openPackingWizard, onDeleteShipment, onDeletePacking }) => {
  const ship = proforma.shipments.find(s => s.id === route.shipmentId);
  const idx = proforma.shipments.findIndex(s => s.id === route.shipmentId);
  const sst = status.shipments_status[idx];
  const [tab, setTab] = React.useState(route.tab || 'logistics');

  React.useEffect(() => { if (route.tab) setTab(route.tab); }, [route.tab]);

  if (!ship) return <Empty title="Embarque no encontrado"/>;

  const updateShip = (patch) => {
    setProforma({
      ...proforma,
      shipments: proforma.shipments.map(s => s.id === ship.id ? { ...s, ...patch } : s),
    });
  };

  return (
    <div>
      <div className="crumb">
        <a onClick={() => setRoute({ section: 'overview' })}>Vista general</a>
        <Icon name="chevron_right" size={10}/>
        <a onClick={() => setRoute({ section: 'shipments' })}>Embarques</a>
        <Icon name="chevron_right" size={10}/>
        Embarque #{ship.number}
      </div>

      <div className="page-head">
        <div className="text">
          <h1 style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
            Embarque #{ship.number}
            <Badge tone={STATUS_TONE[ship.status]} dot>{STATUS_LABEL[ship.status] || 'Borrador'}</Badge>
          </h1>
          <p className="lead">
            {ship.shipping_line ? <span>Naviera <strong>{ship.shipping_line}</strong>.</span> :
            <span>Aún sin naviera. Empieza por la pestaña de Logística.</span>}
          </p>
        </div>
        <div className="head-actions">
          <span className="text-muted text-small">{sst.pct}% completo</span>
          <Btn variant="ghost" icon="trash" className="btn-danger-ghost" onClick={() => {
            if (typeof onDeleteShipment === 'function' && window.confirm(`¿Eliminar el embarque #${ship.number}? Se borrarán sus invoices, contenedores y packing lists. Esta acción no se puede deshacer.`))
              onDeleteShipment(ship.id);
          }}>Eliminar embarque</Btn>
        </div>
      </div>

      <div className="tabs">
        {SHIP_TABS.map(t => {
          const done =
            t.id === 'logistics'  ? sst.tabs.hasLog && sst.tabs.hasBL :
            t.id === 'invoices'   ? sst.tabs.hasInv :
            t.id === 'containers' ? sst.tabs.hasContainers :
            t.id === 'packings'   ? sst.tabs.hasPacking : null;
          const count =
            t.id === 'invoices'   ? ship.invoices.length :
            t.id === 'containers' ? ship.containers.length :
            t.id === 'packings'   ? ship.packings.length :
            t.id === 'documents'  ? ship.documents.length : null;
          return (
            <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={14}/>
              {t.label}
              {done === true && <span className="badge done" style={{padding: '1px 6px', fontSize: 10}}><Icon name="check" size={9}/></span>}
              {done === false && <span className="badge todo" style={{padding: '1px 6px', fontSize: 10}}>·</span>}
              {count != null && count > 0 && <span className="badge accent" style={{padding: '1px 6px', fontSize: 10}}>{count}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'logistics'  && <TabLogistics ship={ship} updateShip={updateShip}/>}
      {tab === 'invoices'   && <TabInvoices ship={ship} updateShip={updateShip}/>}
      {tab === 'containers' && <TabContainers ship={ship} updateShip={updateShip}/>}
      {tab === 'packings'   && <TabPackings ship={ship} updateShip={updateShip} openPackingWizard={openPackingWizard} proforma={proforma} onDeletePacking={onDeletePacking}/>}
      {tab === 'documents'  && <TabDocuments ship={ship} updateShip={updateShip}/>}
    </div>
  );
};

/* ============================================================
   Logistics + B/L tab
   ============================================================ */
const TabLogistics = ({ ship, updateShip }) => (
  <div>
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Datos de logística</h2>
          <p className="sub">Información del transporte. La obtienes de tu agente de carga (forwarder).</p>
        </div>
      </div>

      <div className="fld-row cols-3">
        <Field label="Tipo de transporte" required help="Cómo viaja físicamente la mercancía.">
          <Select value={ship.type} onChange={(e) => updateShip({ type: e.target.value })}>
            <option value="">Selecciona…</option>
            <option value="maritime">Marítimo</option>
            <option value="air">Aéreo</option>
            <option value="land">Terrestre</option>
          </Select>
        </Field>
        <Field label="Naviera / Aerolínea" required
               help="Compañía que opera el transporte." helpExample="COSCO, MSC, Hapag-Lloyd…">
          <Input placeholder="Ej. COSCO Shipping Lines" value={ship.shipping_line}
                 onChange={(e) => updateShip({ shipping_line: e.target.value })}/>
        </Field>
        <Field label="ETD" required help="Estimated Time of Departure — fecha estimada de salida del puerto origen.">
          <Input type="date" value={ship.etd} onChange={(e) => updateShip({ etd: e.target.value })}/>
        </Field>
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <div>
          <h2>Bill of Lading (B/L)</h2>
          <p className="sub">El B/L es el documento que prueba que la naviera recibió tu mercancía. Súbelo en cuanto lo recibas — sin él, aduanas no libera el embarque.</p>
        </div>
        <Badge tone={ship.bl_number ? 'done' : 'todo'}>
          {ship.bl_number ? <><Icon name="check" size={11}/> Cargado</> : 'Pendiente'}
        </Badge>
      </div>

      <div className="fld-row cols-2">
        <Field label="Número de B/L" required
               help="El número único que asigna la naviera a tu embarque." helpExample="COSU6817042500">
          <Input mono placeholder="Ej. COSU6817042500" value={ship.bl_number}
                 onChange={(e) => updateShip({ bl_number: e.target.value })}/>
        </Field>
        <Field label="Fecha de B/L" required help="Fecha que aparece impresa en el documento.">
          <Input type="date" value={ship.bl_date} onChange={(e) => updateShip({ bl_date: e.target.value })}/>
        </Field>
      </div>
    </div>
  </div>
);

/* ============================================================
   Invoices tab
   ============================================================ */
const TabInvoices = ({ ship, updateShip }) => {
  const addInvoice = () => {
    const newInv = { id: 'inv' + Date.now(), number: '', date: '', amount: 0, currency: 'USD', scope: 'full', containers: [] };
    updateShip({ invoices: [...ship.invoices, newInv] });
  };
  const updInv = (id, patch) => updateShip({ invoices: ship.invoices.map(i => i.id === id ? { ...i, ...patch } : i) });
  const delInv = (id) => updateShip({ invoices: ship.invoices.filter(i => i.id !== id) });

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Invoices (Facturas comerciales)</h2>
            <p className="sub">La factura comercial que emites para el embarque. Puede ser una global o varias parciales.</p>
          </div>
          <Btn variant="primary" icon="plus" size="sm" onClick={addInvoice}>Agregar invoice</Btn>
        </div>

        {ship.invoices.length === 0 ? (
          <Empty icon="invoice" title="Aún no hay invoices">
            Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores específicos.
          </Empty>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
            {ship.invoices.map((inv, i) => (
              <div key={inv.id} style={{border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface-alt)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
                  <strong style={{fontSize: 13}}>Invoice {i + 1}</strong>
                  <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost" onClick={() => delInv(inv.id)}>Eliminar</Btn>
                </div>
                <div className="fld-row cols-3">
                  <Field label="No. Invoice" required>
                    <Input mono placeholder="Ej. JQ-INV-2026-088" value={inv.number}
                           onChange={(e) => updInv(inv.id, { number: e.target.value })}/>
                  </Field>
                  <Field label="Fecha" required>
                    <Input type="date" value={inv.date}
                           onChange={(e) => updInv(inv.id, { date: e.target.value })}/>
                  </Field>
                  <Field label="Monto + moneda" required>
                    <div style={{display: 'flex', gap: 8}}>
                      <Input mono inputMode="decimal" style={{flex: 1}} placeholder="62,400.00"
                             value={inv.amountText !== undefined ? inv.amountText : (inv.amount ? inv.amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '')}
                             onChange={(e) => { const raw = e.target.value.replace(/[^0-9.,]/g, ''); const num = parseFloat(raw.replace(/,/g, '')) || 0; updInv(inv.id, { amount: num, amountText: raw }); }}/>
                      <Select style={{width: 90}} value={inv.currency}
                              onChange={(e) => updInv(inv.id, { currency: e.target.value })}>
                        {['USD','EUR','CNY','MXN'].map(c => <option key={c}>{c}</option>)}
                      </Select>
                    </div>
                  </Field>
                </div>
              </div>
            ))}

            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-soft)'}}>
              <span className="text-muted text-small">Total facturado en este embarque</span>
              <strong className="mono" style={{fontSize: 18}}>
                {ship.invoices.reduce((a,i) => a + (i.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
              </strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ============================================================
   Containers tab
   ============================================================ */
const TabContainers = ({ ship, updateShip }) => {
  const addC = () => updateShip({ containers: [...ship.containers, { id: 'c' + Date.now(), number: '', seal: '', type: '40HQ', weight: 0, volume: 0, packages: 0 }] });
  const updC = (id, patch) => updateShip({ containers: ship.containers.map(c => c.id === id ? { ...c, ...patch } : c) });
  const delC = (id) => updateShip({ containers: ship.containers.filter(c => c.id !== id) });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Contenedores</h2>
          <p className="sub">Cada caja física que viaja en el embarque. Los números son los que están pintados en el contenedor (4 letras + 7 dígitos).</p>
        </div>
        <Btn variant="primary" icon="plus" size="sm" onClick={addC}>Agregar contenedor</Btn>
      </div>

      {ship.containers.length === 0 ? (
        <Empty icon="container" title="Sin contenedores">
          Captura los números de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.
        </Empty>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
          {ship.containers.map((c, i) => {
            const isBad = c.number && !/^[A-Z]{4}\d{7}$/.test(c.number);
            return (
              <div key={c.id} style={{
                border: '1px solid var(--border)', borderRadius: 12, padding: 16,
                background: 'var(--surface-alt)', position: 'relative',
              }}>
                <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-soft)'}}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'var(--ink)', color: 'white',
                    display: 'grid', placeItems: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 14
                  }}>{String(i + 1).padStart(2, '0')}</div>
                  <div style={{flex: 1}}>
                    <strong style={{fontSize: 14}}>{c.number || <span className="text-muted">Contenedor sin número</span>}</strong>
                    <div className="text-muted" style={{fontSize: 12, marginTop: 2}}>
                      {c.type} · {(c.weight || 0).toLocaleString()} kg · {(c.volume || 0).toFixed(1)} m³ · {c.packages || 0} paquetes
                    </div>
                  </div>
                  <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost" onClick={() => delC(c.id)}>Eliminar</Btn>
                </div>

                <div className="fld-row cols-3">
                  <Field label="No. Contenedor" required
                         help="4 letras (código de naviera) + 7 dígitos. Está pintado en grande en el costado del contenedor."
                         helpExample="COSU6817042"
                         error={isBad ? 'Formato: 4 letras + 7 dígitos (ej. COSU6817042)' : null}>
                    <Input mono placeholder="COSU6817042" value={c.number}
                           onChange={(e) => updC(c.id, { number: e.target.value.toUpperCase() })}/>
                  </Field>
                  <Field label="No. de Sello" required
                         help="Sello de seguridad que se rompe al abrir el contenedor.">
                    <Input mono placeholder="CN8821044" value={c.seal}
                           onChange={(e) => updC(c.id, { seal: e.target.value.toUpperCase() })}/>
                  </Field>
                  <Field label="Tipo" required>
                    <Select value={c.type} onChange={(e) => updC(c.id, { type: e.target.value })}>
                      <option>20GP</option><option>40GP</option><option>40HQ</option><option>45HQ</option>
                    </Select>
                  </Field>
                </div>
                <div className="fld-row cols-3" style={{marginTop: 14}}>
                  <Field label="Peso bruto (kg)">
                    <Input mono type="number" placeholder="27500" value={c.weight || ''}
                           onChange={(e) => updC(c.id, { weight: +e.target.value })}/>
                  </Field>
                  <Field label="Volumen (m³)">
                    <Input mono type="number" step="0.1" placeholder="67.2" value={c.volume || ''}
                           onChange={(e) => updC(c.id, { volume: +e.target.value })}/>
                  </Field>
                  <Field label="No. de paquetes / bultos">
                    <Input mono type="number" placeholder="12" value={c.packages || ''}
                           onChange={(e) => updC(c.id, { packages: +e.target.value })}/>
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ============================================================
   Packings tab — lists packings, button to open wizard
   ============================================================ */
const TabPackings = ({ ship, updateShip, openPackingWizard, proforma, onDeletePacking }) => {
  return (
    <div>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Packing Lists</h2>
            <p className="sub">Aquí registras placa por placa (o pieza por pieza) lo que va en cada contenedor. <strong>Es la parte más detallada.</strong> Te guiaremos con un asistente.</p>
          </div>
          <Btn variant="primary" icon="plus" onClick={() => openPackingWizard(ship.id, null)}>Nuevo packing</Btn>
        </div>

        {ship.packings.length === 0 ? (
          <Empty icon="box" title="Sin packing lists todavía">
            El asistente te llevará paso a paso: <strong>1)</strong> Eliges productos · <strong>2)</strong> Configuras bloques con foto · <strong>3)</strong> Llenas placa por placa.
          </Empty>
        ) : (
          <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
            {ship.packings.map(pk => {
              const product = proforma.products.find(p => pk.products.includes(p.id));
              const photosOk = pk.blocks.every(b => b.photo);
              const rowsOk = pk.rows_filled === pk.rows_total;
              const fullyOk = photosOk && rowsOk;
              return (
                <div key={pk.id} style={{
                  border: '1px solid var(--border)', borderRadius: 12, padding: 16,
                  display: 'flex', alignItems: 'center', gap: 16, background: 'var(--surface)'
                }}>
                  <div style={{width: 48, height: 48, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)',
                               display: 'grid', placeItems: 'center'}}>
                    <Icon name="box" size={20}/>
                  </div>
                  <div style={{flex: 1}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4}}>
                      <strong className="mono">{pk.number}</strong>
                      <Badge tone={fullyOk ? 'done' : 'partial'}>
                        {fullyOk ? <><Icon name="check" size={10}/> Completo</> : `${pk.rows_filled}/${pk.rows_total} filas`}
                      </Badge>
                    </div>
                    <div className="text-muted" style={{fontSize: 12.5}}>
                      {product?.name} · {pk.blocks.length} bloques
                      {!photosOk && <span style={{color: 'var(--warn)', marginLeft: 8}}>
                        <Icon name="alert" size={10}/> {pk.blocks.filter(b => !b.photo).length} bloques sin foto
                      </span>}
                    </div>
                  </div>
                  <div style={{display: 'flex', gap: 8}}>
                    <Btn variant="secondary" icon="pencil" onClick={() => openPackingWizard(ship.id, pk.id)}>Editar</Btn>
                    <Btn variant="ghost" icon="trash" className="btn-danger-ghost" onClick={() => {
                      if (typeof onDeletePacking === 'function' && window.confirm(`¿Eliminar el packing list ${pk.number}? Se borrarán todas sus filas. Esta acción no se puede deshacer.`))
                        onDeletePacking(ship.id, pk.id);
                    }}>Eliminar</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Callout tone="info" icon="sparkles" title="Cómo funciona el asistente">
        En lugar de que escribas mil líneas a mano, el asistente <strong>genera las filas automáticamente</strong> con base en los bloques que configures. Tú solo agregas dimensiones y subes una foto por bloque.
      </Callout>
    </div>
  );
};

/* ============================================================
   Documents tab (per shipment)
   ============================================================ */
// Mapea los documentos serializados del backend a la forma del estado del portal.
// (docKind vive en el IIFE puente y no es accesible aquí, así que mapeamos local.)
const DOC_KIND_MAP = { bl: 'BL', invoice: 'INV', packing_list: 'PACKING', eur1: 'EUR1', certificate_origin: 'CO', fumigation: 'PHYTO' };
const mapDocKind = (t) => DOC_KIND_MAP[t] || String(t || 'OTHER').toUpperCase();
const mapServerDocs = (docs) => (docs || []).map(d => ({
  id: d.id,
  name: d.name || 'documento',
  kind: mapDocKind(d.document_type || d.kind),
  size: d.file_size || d.size || 0,
  uploaded: d.uploaded || d.create_date || '',
}));

const TabDocuments = ({ ship, updateShip }) => {
  // docType = valor válido en el backend (modelo supplier.shipment.document).
  const DOC_TYPES = [
    { kind: 'BL',    docType: 'bl',                 label: 'Bill of Lading (B/L)', desc: 'El PDF del B/L que emite la naviera. Es obligatorio: sin él, aduanas no libera el embarque.', required: true },
    { kind: 'CO',    docType: 'certificate_origin', label: 'Certificate of Origin', desc: 'Certifica el país donde se fabricó la mercancía. Lo emite la Cámara de Comercio local.' },
    { kind: 'PHYTO', docType: 'fumigation',         label: 'Certificado fitosanitario / fumigación', desc: 'Si la mercancía incluye empaque de madera, certifica que está fumigada (HT/MB).' },
    { kind: 'EUR1',  docType: 'eur1',               label: 'EUR.1 (certificado de circulación)', desc: 'Certificado de circulación de mercancías, cuando aplica para la Unión Europea.' },
  ];

  const [busy, setBusy] = React.useState(null);
  const api = (typeof window !== 'undefined' && window.__supplierPortalApi) || null;

  const pickDoc = async (dt, file) => {
    if (!file) return;
    if (!api || !api.token) { window.alert('No se puede subir el documento: el portal no tiene sesión activa.'); return; }
    const isPdf = file.type === 'application/pdf' || (file.name || '').toLowerCase().endsWith('.pdf');
    if (!isPdf) { window.alert('Solo se permiten archivos PDF.'); return; }
    if (file.size > 10 * 1024 * 1024) { window.alert('El archivo supera el máximo de 10 MB.'); return; }
    setBusy(dt.kind);
    try {
      // El embarque debe existir en el servidor para adjuntarle documentos. Si es
      // local (id temporal), forzamos el guardado y reintentamos.
      let shipmentId = api.resolveRealId('shipments', ship.id);
      if (!shipmentId && typeof api.flush === 'function') {
        await api.flush();
        shipmentId = api.resolveRealId('shipments', ship.id);
      }
      if (!shipmentId) { window.alert('Primero guarda el embarque (espera unos segundos a que se sincronice) e intenta de nuevo.'); return; }
      const { data } = await fileToBase64(file);
      const res = await portalRpc('/supplier/api/v2/upload_document', {
        token: api.token,
        shipment_id: shipmentId,
        document_type: dt.docType,
        file_data: data,
        file_name: file.name || 'documento.pdf',
        file_size: file.size || 0,
        mime_type: file.type || 'application/pdf',
      });
      if (!res || !res.success) { window.alert((res && res.message) || 'No se pudo subir el documento.'); return; }
      updateShip({ documents: mapServerDocs(res.documents) });
    } catch (err) {
      console.error('[SupplierPortal] Error subiendo documento:', err);
      window.alert('Ocurrió un error al subir el documento: ' + (err && err.message ? err.message : err));
    } finally {
      setBusy(null);
    }
  };

  const deleteDoc = async (dt, doc) => {
    if (!api || !api.token || !doc) return;
    if (!window.confirm('¿Eliminar "' + doc.name + '"?')) return;
    setBusy(dt.kind);
    try {
      const res = await portalRpc('/supplier/api/v2/delete_document', { token: api.token, document_id: doc.id });
      if (!res || !res.success) { window.alert((res && res.message) || 'No se pudo eliminar el documento.'); return; }
      updateShip({ documents: mapServerDocs(res.documents) });
    } catch (err) {
      console.error('[SupplierPortal] Error eliminando documento:', err);
      window.alert('Ocurrió un error al eliminar el documento.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Documentos del embarque</h2>
          <p className="sub">Sube los documentos legales y de calidad que acompañan este embarque. Solo PDF, máximo 10 MB.</p>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 18}}>
        {DOC_TYPES.map(dt => {
          const doc = ship.documents.find(d => d.kind === dt.kind);
          const isBusy = busy === dt.kind;
          return (
            <div key={dt.kind} style={{
              border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface)',
              display: 'flex', flexDirection: 'column', gap: 10
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8}}>
                <div>
                  <strong style={{fontSize: 13.5, display: 'block', marginBottom: 4}}>{dt.label}</strong>
                  <div className="text-muted" style={{fontSize: 12, lineHeight: 1.45}}>{dt.desc}</div>
                </div>
                {doc ? <Badge tone="done"><Icon name="check" size={10}/></Badge>
                     : <Badge tone={dt.required ? 'warn' : 'todo'}>{dt.required ? 'Obligatorio' : 'Pendiente'}</Badge>}
              </div>
              {doc ? (
                <div className="doc-row" style={{padding: '8px 10px'}}>
                  <div className="doc-icon" style={{width: 28, height: 28}}><Icon name="file" size={14}/></div>
                  <div className="doc-meta">
                    <div className="name" style={{fontSize: 12.5}}>{doc.name}</div>
                    <div className="meta">{(doc.size/1024).toFixed(0)} KB{doc.uploaded ? ' · ' + doc.uploaded : ''}</div>
                  </div>
                  <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost" disabled={isBusy} onClick={() => deleteDoc(dt, doc)}/>
                </div>
              ) : (
                <label className={`btn btn-secondary sm ${isBusy ? 'is-disabled' : ''}`} style={{cursor: isBusy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start'}}>
                  <input type="file" accept="application/pdf,.pdf" style={{display: 'none'}} disabled={isBusy}
                         onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickDoc(dt, f); }}/>
                  <Icon name="upload" size={13}/>
                  {isBusy ? 'Subiendo…' : 'Subir PDF'}
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

window.ShipmentDetail = ShipmentDetail;
