/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, Empty, Imgph */

/* =================================================================
   Packing Wizard — 4 steps
   1) Select product(s)
   2) Configure blocks (name, count, photo)
   3) Review structure (visual preview)
   4) Fill spreadsheet
   ================================================================= */

const WIZARD_STEPS = [
  { id: 1, label: 'Productos' },
  { id: 2, label: 'Bloques + fotos' },
  { id: 3, label: 'Revisión' },
  { id: 4, label: 'Llenar placas' },
];

// Lee un File como base64 (sin el prefijo data:...;base64,) para Odoo.
const wizFileToBase64 = (typeof fileToBase64 === 'function') ? fileToBase64 : (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const res = String(reader.result || '');
    const comma = res.indexOf(',');
    resolve({ data: comma >= 0 ? res.slice(comma + 1) : res, name: file.name || 'foto.jpg', dataUrl: res });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const PackingWizard = ({ proforma, shipmentId, packingId, onClose, onSave, sampleRows, pendingImages }) => {
  const ship = proforma.shipments.find(s => s.id === shipmentId);
  const existing = packingId ? ship.packings.find(p => p.id === packingId) : null;

  // determine starting step: if editing and already has rows, jump to step 4
  const initialStep = existing ? (existing.rows_filled > 0 ? 4 : 3) : 1;
  const [step, setStep] = React.useState(initialStep);

  const [draft, setDraft] = React.useState(() => existing ? {
    number: existing.number,
    date:   existing.date,
    products: existing.products,
    blocks: existing.blocks.map(b => ({ ...b })),
  } : {
    number: '',
    date: new Date().toISOString().slice(0, 10),
    products: [],
    blocks: [],
  });

  // rows for spreadsheet (only used in step 4).
  // Priority: 1) rows previously saved on this packing, 2) hard-coded sample
  // rows for the demo packing pk1, 3) empty (will be auto-generated on entering step 4).
  const [rows, setRows] = React.useState(() => {
    if (existing && Array.isArray(existing.rows) && existing.rows.length > 0) {
      return existing.rows.map(r => ({ ...r }));
    }
    if (existing && existing.id === 'pk1') return [...sampleRows];
    return [];
  });

  // Persist current draft+rows to the parent state, then close. Used by every
  // close path (the Listo button, the X button, and the scrim click) so the
  // user never loses what they entered.
  const commitAndClose = () => {
    if (typeof onSave === 'function') {
      onSave(shipmentId, packingId, draft, rows);
    }
    onClose();
  };
  // Firma de la estructura de bloques. Si cambia (el usuario corrigió la
  // selección de productos o ajustó bloques), hay que REGENERAR las filas.
  const blocksSig = draft.blocks.map(b => `${b.id}:${b.product}:${b.count}:${b.name}`).join('|');
  const genSigRef = React.useRef(null);
  // Genera (o regenera) las filas a partir de los bloques. Conserva los datos
  // ya capturados de los bloques que no cambiaron (match por id de fila).
  React.useEffect(() => {
    if (step !== 4 || draft.blocks.length === 0) return;
    const needGen = rows.length === 0 || (genSigRef.current !== null && genSigRef.current !== blocksSig);
    if (!needGen) {
      genSigRef.current = blocksSig;
      return;
    }
    const KEEP = ['h','w','thickness','container','container_id','notes','photo','quantity','weight','plate','atado','grupo','pedimento','ref'];
    const prevById = {};
    rows.forEach(r => { prevById[r.id] = r; });
    // Si el embarque tiene EXACTAMENTE un contenedor, se precarga en todas las filas.
    const shipContainerNumbers = (ship && ship.containers ? ship.containers : []).map(c => c.number).filter(Boolean);
    const defaultContainer = shipContainerNumbers.length === 1 ? shipContainerNumbers[0] : '';
    const generated = [];
    draft.blocks.forEach((b, bi) => {
      const product = proforma.products.find(p => String(p.id) === String(b.product)) || proforma.products[0] || {};
      const tipo = product.kind === 'placa' ? 'Placa' : (product.kind === 'formato' ? 'Formato' : 'Pieza');
      for (let i = 0; i < b.count; i++) {
        const id = `r-${b.id}-${i}`;
        const base = {
          id,
          product_id: b.product || product.id,
          tipo,
          block: b.name, atado: '',
          plate: '',
          ref: product.ref || '', thickness: 2, h: 0, w: 0, quantity: tipo === 'Placa' ? 0 : 1, weight: 0, notes: '', grupo: '', pedimento: '', container: defaultContainer, container_id: false, photo: false, errors: [],
          blockStart: i === 0,
        };
        const prev = prevById[id];
        if (prev) KEEP.forEach(k => { if (prev[k] !== undefined) base[k] = prev[k]; });
        generated.push(base);
      }
    });
    genSigRef.current = blocksSig;
    setRows(generated);
  }, [step, blocksSig]);

  const canNext = () => {
    if (step === 1) return draft.products.length > 0;
    if (step === 2) return !!(draft.number || '').trim() && draft.blocks.length > 0 && draft.blocks.every(b => b.name && b.count > 0);
    return true;
  };

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && commitAndClose()}>
      <div className={`modal ${step === 4 ? 'modal-wide' : ''}`} style={{maxWidth: step === 4 ? 1280 : 880}}>
        <div className="modal-head">
          <div>
            <div style={{fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6}}>
              Embarque #{ship.number} · {existing ? 'Editar' : 'Nuevo'} packing list
            </div>
            <h2>{step === 1 ? 'Para empezar, ¿qué producto vas a empacar?' :
                 step === 2 ? 'Configura los bloques' :
                 step === 3 ? 'Revisa la estructura antes de capturar' :
                 'Captura placa por placa'}</h2>
            <p className="sub">
              {step === 1 && 'Selecciona uno o más productos de la PO. Cada packing list puede incluir varios productos.'}
              {step === 2 && 'Un bloque agrupa placas que vienen del mismo bloque de cantera. Define cuántas placas hay en cada uno.'}
              {step === 3 && 'Confirmamos cuántas filas vamos a generar. Si algo no cuadra, regresa al paso anterior.'}
              {step === 4 && 'Las filas ya están creadas. Solo llena las dimensiones de cada placa y asigna su contenedor.'}
            </p>
          </div>
          <button className="icon-btn" onClick={commitAndClose} aria-label="Cerrar"><Icon name="x" size={16}/></button>
        </div>

        <div className="modal-body" style={{background: step === 4 ? 'var(--bg)' : 'var(--surface)'}}>
          <div className="stepper">
            {WIZARD_STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                <div className={`step ${step === s.id ? 'active' : step > s.id ? 'done' : ''}`}>
                  <span className="n">{step > s.id ? <Icon name="check" size={12}/> : s.id}</span>
                  <span>{s.label}</span>
                </div>
                {i < WIZARD_STEPS.length - 1 && <span className="step-sep"/>}
              </React.Fragment>
            ))}
          </div>

          {step === 1 && <Step1Products proforma={proforma} draft={draft} setDraft={setDraft}/>}
          {step === 2 && <Step2Blocks proforma={proforma} draft={draft} setDraft={setDraft} pendingImages={pendingImages}/>}
          {step === 3 && <Step3Review proforma={proforma} draft={draft}/>}
          {step === 4 && <Step4Sheet proforma={proforma} draft={draft} rows={rows} setRows={setRows} ship={ship} pendingImages={pendingImages}/>}
        </div>

        {step === 4 && (
          <div className="wizard-prop-tip">
            <Icon name="sparkles" size={14}/>
            <span>
              <strong>Llena más rápido con propagación: </strong>
              pasa el cursor sobre cualquier celda y verás dos íconos a la derecha — <span className="wizard-prop-chip"><Icon name="prop_one" size={11}/> uno</span> copia el valor a la siguiente fila del mismo bloque · <span className="wizard-prop-chip"><Icon name="prop_all" size={11}/> todos</span> copia a todas las filas debajo del mismo bloque. También puedes copiar/pegar desde Excel y usar <kbd className="wizard-prop-kbd">Tab</kbd> entre celdas.
            </span>
          </div>
        )}

        <div className="modal-foot">
          <div>
            {step > 1 && step < 4 && <Btn variant="ghost" icon="arrow_left" onClick={() => setStep(step - 1)}>Anterior</Btn>}
          </div>
          <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
            <span className="text-muted text-small">
              {step === 4 && (
                <span><Icon name="check" size={11}/> Autoguardado · hace un momento</span>
              )}
            </span>
            {step < 3 && (
              <Btn variant="primary" iconRight="arrow_right" disabled={!canNext()} onClick={() => setStep(step + 1)}>
                Siguiente: {WIZARD_STEPS[step].label}
              </Btn>
            )}
            {step === 3 && (
              <React.Fragment>
                <Btn variant="ghost" onClick={() => setStep(2)}>Ajustar bloques</Btn>
                <Btn variant="accent" icon="sparkles" onClick={() => setStep(4)}>
                  Generar {draft.blocks.reduce((a,b) => a + b.count, 0)} filas
                </Btn>
              </React.Fragment>
            )}
            {step === 4 && (
              <Btn variant="primary" icon="check" onClick={commitAndClose}>Listo, volver al embarque</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ====================== Step 1 ====================== */
const Step1Products = ({ proforma, draft, setDraft }) => {
  const toggle = (id) => {
    const has = draft.products.includes(id);
    setDraft({ ...draft, products: has ? draft.products.filter(p => p !== id) : [...draft.products, id] });
  };
  return (
    <div>
      <div className="fld-row" style={{marginBottom: 18}}>
        <Field label="No. del Packing" required help="Identifica este documento. Suele ser una variante de la invoice." helpExample="PK-2026-088-A"
               error={!(draft.number || '').trim() ? 'El folio es obligatorio para continuar.' : undefined}
               hint="Obligatorio: escribe el folio del packing list.">
          <Input mono placeholder="Agregar folio" value={draft.number} onChange={(e) => setDraft({...draft, number: e.target.value})}/>
        </Field>
        <Field label="Fecha del Packing" required>
          <Input type="date" value={draft.date} onChange={(e) => setDraft({...draft, date: e.target.value})}/>
        </Field>
      </div>

      <div style={{fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10}}>
        Productos solicitados en esta PO
      </div>

      <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
        {proforma.products.map(p => {
          const selected = draft.products.includes(p.id);
          return (
            <label key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: 14,
              border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
              background: selected ? 'var(--accent-soft)' : 'var(--surface)',
              borderRadius: 12, cursor: 'pointer'
            }}>
              <input type="checkbox" checked={selected} onChange={() => toggle(p.id)}
                     style={{width: 18, height: 18, accentColor: 'var(--accent)'}}/>
              <div style={{width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0}}>
                <Imgph style={{width: '100%', height: '100%'}}>{p.kind}</Imgph>
              </div>
              <div style={{flex: 1}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                  <strong>{p.name}</strong>
                  <Badge tone="draft" className="mono">{p.ref}</Badge>
                </div>
                <div className="text-muted" style={{fontSize: 12.5, marginTop: 2}}>
                  {p.kind === 'placa' ? 'Placa / Slab' : 'Formato / Tile'} · {p.dim_text}
                </div>
              </div>
              <div style={{textAlign: 'right'}}>
                <div className="mono" style={{fontWeight: 700, fontSize: 17}}>{p.requested_qty}</div>
                <div className="text-muted" style={{fontSize: 11}}>{p.unit} solicitados</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};

/* ====================== Step 2 ====================== */
const Step2Blocks = ({ proforma, draft, setDraft, pendingImages }) => {
  const products = proforma.products.filter(p => draft.products.includes(p.id));

  const addBlock = (productId) => {
    const newBlock = {
      id: 'b' + Date.now() + Math.random().toString(36).slice(2,6),
      name: '', count: 0, photo: false, product: productId,
    };
    setDraft({ ...draft, blocks: [...draft.blocks, newBlock] });
  };
  const updBlock = (id, patch) => setDraft({ ...draft, blocks: draft.blocks.map(b => b.id === id ? { ...b, ...patch } : b) });
  const delBlock = (id) => setDraft({ ...draft, blocks: draft.blocks.filter(b => b.id !== id) });
  // Captura real de la foto del bloque (se sube al persistir).
  const pickBlockPhoto = (b, file) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    wizFileToBase64(file).then(({ data, name }) => {
      if (pendingImages && pendingImages.current) pendingImages.current.blocks[b.id] = { data, name };
      updBlock(b.id, { photo: true, image_preview: preview });
    });
  };
  const blockPhotoSrc = (b) => b.image_preview || (b.block_image_id ? `/web/image/supplier.shipment.block.image/${b.block_image_id}/image` : '');

  return (
    <div>
      <Callout tone="info" icon="info" title="¿Qué es un bloque?">
        Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generará automáticamente 48 filas para llenar.
      </Callout>

      <div style={{marginTop: 20, display: 'flex', flexDirection: 'column', gap: 24}}>
        {products.map(p => {
          const productBlocks = draft.blocks.filter(b => b.product === p.id);
          const needsPhoto = (p.kind || 'placa') === 'placa';
          return (
            <div key={p.id}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10}}>
                <div>
                  <strong style={{fontSize: 14}}>{p.name}</strong>
                  <span className="text-muted text-small" style={{marginLeft: 8}}>· {productBlocks.reduce((a,b) => a + (+b.count || 0), 0)} de {p.requested_qty} {p.unit} configurados</span>
                </div>
                <Btn variant="secondary" size="sm" icon="plus" onClick={() => addBlock(p.id)}>Agregar bloque</Btn>
              </div>

              {productBlocks.length === 0 ? (
                <Empty icon="cube" title="Sin bloques aún">
                  Empieza con uno. Puedes agregar tantos como necesites.
                </Empty>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                  {productBlocks.map((b, bi) => (
                    <div key={b.id} className="block-card">
                      {needsPhoto && (
                        <label className={`block-photo ${b.photo ? 'has-photo' : ''}`} style={{cursor: 'pointer', overflow: 'hidden'}} title="Subir/Reemplazar foto del bloque">
                          <input type="file" accept="image/*" style={{display: 'none'}}
                                 onChange={(e) => pickBlockPhoto(b, e.target.files && e.target.files[0])}/>
                          {blockPhotoSrc(b) ? (
                            <img src={blockPhotoSrc(b)} alt="foto bloque" style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8}}/>
                          ) : (
                            <div style={{textAlign: 'center'}}>
                              <Icon name="camera" size={20}/>
                              <div style={{fontSize: 10, marginTop: 4, fontWeight: 600}}>Subir foto</div>
                            </div>
                          )}
                        </label>
                      )}
                      <div className="block-fields">
                        <Field label={`Nombre del bloque #${bi + 1}`} required>
                          <Input mono placeholder="Ej. 3024117 " value={b.name}
                                 onChange={(e) => updBlock(b.id, { name: e.target.value })}/>
                        </Field>
                        <div className="block-fields-row">
                          <Field label="Placas / piezas" required>
                            <Input mono type="number" min={1} value={b.count || ''} placeholder="18"
                                   onChange={(e) => updBlock(b.id, { count: +e.target.value })}/>
                          </Field>
                          <Field label="Estado">
                            <div style={{display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0'}}>
                              {!needsPhoto
                                ? <span className="text-muted text-small">No requiere foto</span>
                                : b.photo
                                  ? <Badge tone="done"><Icon name="check" size={10}/> Foto OK</Badge>
                                  : <Badge tone="partial"><Icon name="camera" size={10}/> Falta foto</Badge>}
                              <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost" onClick={() => delBlock(b.id)}/>
                            </div>
                          </Field>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ====================== Step 3 ====================== */
const Step3Review = ({ proforma, draft }) => {
  const totalPlates = draft.blocks.reduce((a, b) => a + (+b.count || 0), 0);
  const products = proforma.products.filter(p => draft.products.includes(p.id));
  const needsBlockPhoto = (b) => {
    const pr = proforma.products.find(p => p.id === b.product);
    return ((pr && pr.kind) || 'placa') === 'placa';
  };
  const blockOk = (b) => !needsBlockPhoto(b) || b.photo;
  const photosMissing = draft.blocks.filter(b => needsBlockPhoto(b) && !b.photo).length;

  return (
    <div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24}}>
        <div style={{padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)'}}>
          <div className="text-muted" style={{fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6}}>Productos</div>
          <div className="mono" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em'}}>{products.length}</div>
        </div>
        <div style={{padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)'}}>
          <div className="text-muted" style={{fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6}}>Bloques configurados</div>
          <div className="mono" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em'}}>{draft.blocks.length}</div>
        </div>
        <div style={{padding: 18, border: '1.5px solid var(--accent)', borderRadius: 12, background: 'var(--accent-soft)'}}>
          <div style={{fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: 'var(--accent)'}}>Filas a generar</div>
          <div className="mono" style={{fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent)'}}>{totalPlates}</div>
        </div>
      </div>

      {photosMissing > 0 && (
        <Callout tone="warn" icon="alert" title={`${photosMissing} ${photosMissing === 1 ? 'bloque' : 'bloques'} sin foto`}>
          Puedes continuar y subirlas después, pero el packing list no se considerará completo hasta que cada bloque tenga al menos una foto.
        </Callout>
      )}

      <div style={{marginTop: 18}}>
        <div style={{fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10}}>
          Estructura del packing
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
          {products.map(p => {
            const pblocks = draft.blocks.filter(b => b.product === p.id);
            return (
              <div key={p.id} style={{border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface)'}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12}}>
                  <strong>{p.name}</strong>
                  <span className="mono text-small text-muted">
                    {pblocks.reduce((a,b) => a + (+b.count || 0), 0)} placas
                  </span>
                </div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  {pblocks.map(b => (
                    <div key={b.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 8,
                      background: blockOk(b) ? 'var(--ok-soft)' : 'var(--warn-soft)',
                      border: `1px solid ${blockOk(b) ? 'var(--ok-border)' : 'var(--warn-border)'}`,
                      fontSize: 12.5,
                    }}>
                      <Icon name={blockOk(b) ? 'check' : 'camera'} size={11}/>
                      <span className="mono" style={{fontWeight: 600}}>{b.name}</span>
                      <span className="text-muted" style={{fontSize: 11}}>× {b.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ====================== Step 4: Spreadsheet ====================== */
const Step4Sheet = ({ proforma, draft, rows, setRows, ship, pendingImages }) => {
  const [filter, setFilter] = React.useState('all');
  // Si el embarque tiene EXACTAMENTE un contenedor, se asigna a las filas sin contenedor.
  const soleContainer = (() => {
    const nums = (ship && ship.containers ? ship.containers : []).map(c => c.number).filter(Boolean);
    return nums.length === 1 ? nums[0] : '';
  })();
  React.useEffect(() => {
    if (!soleContainer) return;
    if (rows.some(r => !r.container))
      setRows(prev => prev.map(r => r.container ? r : { ...r, container: soleContainer }));
  }, [soleContainer, rows, setRows]);
  const [activeRow, setActiveRow] = React.useState(null);

  // Solo las placas llevan foto por fila. Piezas/Formatos no llevan foto.
  const rowIsPlaca = (r) => String(r.tipo || 'Placa').toLowerCase().indexOf('placa') >= 0;
  const anyPlaca = rows.some(rowIsPlaca);

  const errors = rows.filter(r => r.errors && r.errors.length > 0);
  const completeRows = rows.filter(r => r.h > 0 && r.w > 0 && r.container);

  const filtered = filter === 'all' ? rows : filter === 'errors' ? errors : filter === 'empty' ? rows.filter(r => !r.h || !r.w) : rows;

  const updRow = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const portalRowImageId = (r) => {
    const v = r._odoo_id || r.id;
    return (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) ? parseInt(v, 10) : 0;
  };
  const rowPhotoSrc = (r) => r.image_preview || (r.photo && portalRowImageId(r) ? `/web/image/supplier.shipment.packing.row/${portalRowImageId(r)}/image` : '');
  // Captura real de la foto de la fila (se sube al persistir).
  const pickRowPhoto = (r, file) => {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    wizFileToBase64(file).then(({ data, name }) => {
      if (pendingImages && pendingImages.current) pendingImages.current.rows[r.id] = { data, name };
      updRow(r.id, { photo: true, image_preview: preview });
    });
  };

  // Para "No. Placa" la propagación es CONSECUTIVA (P-001 → P-002 → P-003…);
  // para el resto se copia el valor tal cual.
  const incPlate = (value, step) => {
    const sval = String(value == null ? '' : value);
    const m = sval.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return sval;
    const n = parseInt(m[2], 10) + step;
    return m[1] + String(n).padStart(m[2].length, '0') + m[3];
  };
  // PROPAGATION — copy the value of `field` from `sourceId` either to the next row
  // in the same block, or to every row below it inside the same block.
  const propagate = (sourceId, field, mode) => {
    const idx = rows.findIndex(r => r.id === sourceId);
    if (idx < 0) return;
    const src = rows[idx];
    const block = src.block;
    const isPlate = field === 'plate';
    if (mode === 'next') {
      for (let i = idx + 1; i < rows.length; i++) {
        if (rows[i].block === block) {
          const targetId = rows[i].id;
          const val = isPlate ? incPlate(src[field], 1) : src[field];
          setRows(prev => prev.map(r => r.id === targetId ? { ...r, [field]: val } : r));
          return;
        }
      }
    } else {
      const valById = {};
      let k = 0;
      for (let i = idx + 1; i < rows.length; i++) {
        if (rows[i].block === block) {
          k += 1;
          valById[rows[i].id] = isPlate ? incPlate(src[field], k) : src[field];
        }
      }
      setRows(prev => prev.map(r => Object.prototype.hasOwnProperty.call(valById, r.id) ? { ...r, [field]: valById[r.id] } : r));
    }
  };

  // Helper that decides if propagation is available — needs a value and at least one row below in the same block
  const canPropagate = (rowId) => {
    const idx = rows.findIndex(r => r.id === rowId);
    if (idx < 0) return false;
    const block = rows[idx].block;
    for (let i = idx + 1; i < rows.length; i++) if (rows[i].block === block) return true;
    return false;
  };

  // Cell wrapper that injects the two propagation buttons
  const PropCell = ({ rowId, field, children, extra, errClass }) => {
    const propable = canPropagate(rowId);
    return (
      <td className={`${propable ? 'propable' : ''} ${errClass || ''} ${extra || ''}`}>
        {children}
        {propable && (
          <div className="prop-actions" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => propagate(rowId, field, 'next')} title="Copiar a la siguiente fila del mismo bloque">
              <Icon name="prop_one" size={13}/>
            </button>
            <button onClick={() => propagate(rowId, field, 'all')} title="Copiar a TODAS las filas del mismo bloque (abajo)">
              <Icon name="prop_all" size={13}/>
            </button>
          </div>
        )}
      </td>
    );
  };

  const containers = ship.containers.map(c => c.number).filter(Boolean);

  // Agrupación visual por producto: ordenamos las filas según el orden de los
  // productos de la PO (orden estable: conserva el orden de bloques dentro de
  // cada producto) y mostramos un encabezado al cambiar de producto.
  const prodKey = (r) => String((r && r.product_id != null && r.product_id !== false) ? r.product_id : '');
  const productById = {};
  (proforma.products || []).forEach((p) => { productById[String(p.id)] = p; });
  const prodOrder = [];
  filtered.forEach(r => { const k = prodKey(r); if (prodOrder.indexOf(k) < 0) prodOrder.push(k); });
  const visibleRows = filtered.slice().sort((a, b) => prodOrder.indexOf(prodKey(a)) - prodOrder.indexOf(prodKey(b)));
  const multiProduct = prodOrder.length > 1;

  // ---- Excel-compatible CSV export & paste ----
  const COL_DEFS = [
    { header: '#',          field: null,        type: 'index'  },
    { header: 'Bloque',     field: 'block',     type: 'string' },
    { header: 'Atado',      field: 'atado',     type: 'string' },
    { header: 'No. Placa',  field: 'plate',     type: 'string' },
    { header: 'Grosor cm',  field: 'thickness', type: 'number' },
    { header: 'Largo m',    field: 'w',         type: 'number' },
    { header: 'Alto m',     field: 'h',         type: 'number' },
    { header: 'Contenedor', field: 'container', type: 'string' },
    { header: 'Notas',      field: 'notes',     type: 'string' },
  ];

  const exportCSV = () => {
    if (rows.length === 0) return;
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [COL_DEFS.map(c => escape(c.header)).join(',')];
    rows.forEach((r, i) => {
      lines.push(COL_DEFS.map(c => escape(c.type === 'index' ? i + 1 : r[c.field])).join(','));
    });
    const csv = '﻿' + lines.join('\n'); // BOM para que Excel abra UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packing_${draft.number || 'list'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState('');

  const parsePaste = (text) => {
    const clean = (text || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
    if (!clean) return { hasHeaders: false, dataRows: [], mapping: [], indexCol: -1 };
    const grid = clean.split('\n').map(l => l.split('\t'));
    const known = COL_DEFS.reduce((acc, c) => { acc[c.header.toLowerCase()] = c; return acc; }, {});
    const firstLower = grid[0].map(c => c.trim().toLowerCase());
    const matches = firstLower.filter(c => known[c]).length;
    let mapping, dataRows, hasHeaders;
    if (matches >= 2) {
      hasHeaders = true;
      mapping = firstLower.map(c => known[c] || null);
      dataRows = grid.slice(1);
    } else {
      hasHeaders = false;
      mapping = COL_DEFS.slice(0, grid[0].length);
      dataRows = grid;
    }
    const indexCol = mapping.findIndex(m => m && m.type === 'index');
    return { hasHeaders, dataRows, mapping, indexCol };
  };

  const pastePreview = pasteText ? parsePaste(pasteText) : null;

  const applyPaste = () => {
    const p = parsePaste(pasteText);
    if (p.dataRows.length === 0) return;
    const updates = new Map();
    p.dataRows.forEach((cells, ri) => {
      let targetIdx;
      if (p.indexCol >= 0 && cells[p.indexCol] != null && cells[p.indexCol].trim() !== '') {
        const n = parseInt(cells[p.indexCol], 10);
        if (!isNaN(n)) targetIdx = n - 1;
      }
      if (targetIdx === undefined) targetIdx = ri;
      if (targetIdx < 0 || targetIdx >= rows.length) return;

      const patch = {};
      p.mapping.forEach((def, ci) => {
        if (!def || def.type === 'index') return;
        const raw = (cells[ci] || '').trim();
        if (raw === '') return;
        if (def.type === 'number') {
          const n = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
          if (!isNaN(n)) patch[def.field] = n;
        } else {
          patch[def.field] = raw;
        }
      });
      if (Object.keys(patch).length > 0) updates.set(targetIdx, patch);
    });
    if (updates.size === 0) return;
    setRows(rows.map((r, i) => updates.has(i) ? { ...r, ...updates.get(i) } : r));
    setPasteOpen(false);
    setPasteText('');
  };

  return (
    <div>
      {/* Summary bar */}
      <div style={{display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14, flexWrap: 'wrap'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 13}}>
            <span className="mono" style={{fontWeight: 700, fontSize: 18}}>{completeRows.length}</span>
            <span className="text-muted">/ {rows.length} completas</span>
          </div>
          <div style={{width: 1, height: 16, background: 'var(--border)'}}/>
          <div style={{display: 'flex', alignItems: 'center', gap: 6, color: errors.length > 0 ? 'var(--danger)' : 'var(--ink-3)', fontSize: 13}}>
            <Icon name="alert" size={12}/>
            <span className="mono" style={{fontWeight: 700}}>{errors.length}</span>
            <span>con errores</span>
          </div>
        </div>

        <div className="seg">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas ({rows.length})</button>
          <button className={filter === 'errors' ? 'active' : ''} onClick={() => setFilter('errors')}>Errores ({errors.length})</button>
          <button className={filter === 'empty' ? 'active' : ''} onClick={() => setFilter('empty')}>Sin dimensiones</button>
        </div>

        <div style={{marginLeft: 'auto', display: 'flex', gap: 8}}>
          <Btn variant="secondary" icon="download" size="sm" onClick={exportCSV} disabled={rows.length === 0}>Exportar CSV</Btn>
          <Btn variant="secondary" icon="upload" size="sm" onClick={() => { setPasteText(''); setPasteOpen(true); }}>Pegar de Excel</Btn>
        </div>
      </div>

      <div className="sheet">
        <div className="sheet-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th style={{width: 30}}>#</th>
                {!window.PORTAL_NATIONAL && <th style={{minWidth: 130}}>Bloque</th>}
                {!window.PORTAL_NATIONAL && <th style={{minWidth: 110}}>Atado</th>}
                <th style={{minWidth: 110}}>No. Placa</th>
                <th style={{width: 110}}>Grosor cm</th>
                <th style={{width: 110}}>Largo m</th>
                <th style={{width: 110}}>Alto m</th>
                <th style={{width: 80}}>Área m²</th>
                <th style={{minWidth: 180}}>{window.PORTAL_NATIONAL ? 'Plataforma' : 'Contenedor'}</th>
                {anyPlaca && <th style={{width: 60}}>Foto</th>}
                <th style={{minWidth: 170}}>Notas</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.flatMap((r, i) => {
                const hNum = parseFloat(r.h) || 0;
                const wNum = parseFloat(r.w) || 0;
                const area = (hNum && wNum) ? (hNum * wNum).toFixed(2) : '';
                const noH = !hNum;
                const noW = !wNum;
                const noC = !r.container;
                const isProductStart = i === 0 || prodKey(visibleRows[i-1]) !== prodKey(r);
                const isBlockStart = isProductStart || visibleRows[i-1].block !== r.block;
                const prod = productById[prodKey(r)];
                const els = [];
                if (multiProduct && isProductStart) {
                  els.push(
                    <tr key={'grp-' + r.id} className="product-group" data-noncommentable="">
                      <td colSpan={window.PORTAL_NATIONAL ? (anyPlaca ? 9 : 8) : (anyPlaca ? 11 : 10)} style={{background: 'var(--accent-soft)', borderTop: '2px solid var(--accent)', padding: '8px 12px', fontSize: 12.5, letterSpacing: '0.02em', position: 'sticky', left: 0}}>
                        <span style={{fontWeight: 700, color: 'var(--accent)'}}>{(prod && prod.name) || 'Producto'}</span>
                        {prod && prod.ref ? <span className="mono" style={{marginLeft: 8, color: 'var(--ink-3)', fontWeight: 600}}>{prod.ref}</span> : null}
                      </td>
                    </tr>
                  );
                }
                els.push(
                  <tr key={r.id} className={`${isBlockStart ? 'block-start' : ''} ${activeRow === r.id ? 'is-active' : ''}`}
                      onClick={() => setActiveRow(r.id)}>
                    <td style={{textAlign: 'center', color: 'var(--ink-4)', fontSize: 11}}>{rows.indexOf(r) + 1}</td>
                    {!window.PORTAL_NATIONAL && <td className="cell-block"><input value={r.block} style={{textTransform: 'uppercase'}} onChange={forceUpper((e) => updRow(r.id, { block: e.target.value }))}/></td>}
                    {!window.PORTAL_NATIONAL && PropCell({ rowId: r.id, field: "atado", children: (
                      <input value={r.atado} placeholder="rellenar valor" style={{textTransform: 'uppercase'}} onChange={forceUpper((e) => updRow(r.id, { atado: e.target.value }))}/>
                    )})}
                    {PropCell({ rowId: r.id, field: "plate", children: (
                      <input value={r.plate} placeholder="rellenar valor" style={{textTransform: 'uppercase'}} onChange={forceUpper((e) => updRow(r.id, { plate: e.target.value }))}/>
                    )})}
                    {PropCell({ rowId: r.id, field: "thickness", children: (
                      <input type="text" inputMode="decimal" value={r.thickness || ''} onChange={(e) => updRow(r.id, { thickness: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') })}/>
                    )})}
                    {PropCell({ rowId: r.id, field: "w", errClass: noW ? 'is-error' : '', children: (
                      <input type="text" inputMode="decimal" value={r.w || ''} placeholder="0.00"
                             onChange={(e) => updRow(r.id, { w: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') })}/>
                    )})}
                    {PropCell({ rowId: r.id, field: "h", errClass: noH ? 'is-error' : '', children: (
                      <input type="text" inputMode="decimal" value={r.h || ''} placeholder="0.00"
                             onChange={(e) => updRow(r.id, { h: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') })}/>
                    )})}
                    <td className="cell-computed"><input readOnly value={area}/></td>
                    {PropCell({ rowId: r.id, field: "container", errClass: (!window.PORTAL_NATIONAL && noC) ? 'is-error' : '', children: (
                      window.PORTAL_NATIONAL ? (
                        <input value={r.container} placeholder="plataforma / camión" style={{textTransform: 'uppercase'}} onChange={forceUpper((e) => updRow(r.id, { container: e.target.value }))}/>
                      ) : (
                        <select value={r.container} onChange={(e) => updRow(r.id, { container: e.target.value })}>
                          <option value="">— sin asignar —</option>
                          {containers.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )
                    )})}
                    {anyPlaca && (
                      <td style={{textAlign: 'center'}}>
                        {rowIsPlaca(r) ? (
                          <label className={`row-mini-photo ${r.photo ? 'has' : ''}`} style={{cursor: 'pointer', overflow: 'hidden'}} title="Subir/Reemplazar foto de la placa" onClick={(e) => e.stopPropagation()}>
                            <input type="file" accept="image/*" style={{display: 'none'}}
                                   onChange={(e) => pickRowPhoto(r, e.target.files && e.target.files[0])}/>
                            {rowPhotoSrc(r)
                              ? <img src={rowPhotoSrc(r)} alt="foto" style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4}}/>
                              : <Icon name="camera" size={12}/>}
                          </label>
                        ) : (
                          <span className="text-muted" style={{fontSize: 11}}>—</span>
                        )}
                      </td>
                    )}
                    {PropCell({ rowId: r.id, field: "notes", children: (
                      <input placeholder="—" value={r.notes} style={{textTransform: 'uppercase'}} onChange={forceUpper((e) => updRow(r.id, { notes: e.target.value }))}/>
                    )})}
                  </tr>
                );
                return els;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pasteOpen && (
        <div style={{position: 'fixed', inset: 0, zIndex: 2147483001, background: 'oklch(0.2 0.01 60 / 0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24}}
             onClick={(e) => e.target === e.currentTarget && setPasteOpen(false)}>
          <div style={{background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', width: 'min(680px, calc(100vw - 48px))', maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column'}}>
            <div style={{padding: '18px 22px 14px', borderBottom: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flex: '0 0 auto'}}>
              <div>
                <h2 style={{margin: 0, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em'}}>Pegar desde Excel</h2>
                <p style={{margin: '4px 0 0', fontSize: 13, color: 'var(--ink-3)', maxWidth: '55ch'}}>
                  Copia el rango en Excel (con o sin la fila de headers) y pégalo aquí con <kbd style={{padding: '1px 5px', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11}}>Ctrl/Cmd + V</kbd>. Las filas se actualizan por la columna <strong>#</strong>; si no la incluyes, se aplica por orden.
                </p>
              </div>
              <button className="icon-btn" onClick={() => setPasteOpen(false)} aria-label="Cerrar"><Icon name="x" size={16}/></button>
            </div>
            <div style={{padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0, overflow: 'auto'}}>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'Pega aquí los datos copiados de Excel...\n\nColumnas esperadas (en este orden si no incluyes headers):\n#  Bloque  Atado  No. Placa  Grosor cm  Largo m  Alto m  Contenedor  Notas'}
                autoFocus
                spellCheck={false}
                style={{width: '100%', minHeight: 180, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical', background: 'var(--surface-alt)', color: 'var(--ink)', lineHeight: 1.5}}
              />
              {pastePreview && pastePreview.dataRows.length > 0 && (
                <div style={{fontSize: 12, color: 'var(--ink-2)', padding: '10px 12px', background: 'var(--ok-soft)', border: '1px solid var(--ok)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4}}>
                  <div><strong>{pastePreview.dataRows.length}</strong> fila(s) detectada(s) · {pastePreview.hasHeaders ? 'headers reconocidos ✓' : 'sin headers (mapeo por posición)'}</div>
                  <div style={{color: 'var(--ink-3)'}}>Columnas que se aplicarán: {pastePreview.mapping.filter(m => m && m.field).map(m => m.header).join(', ') || '—'}</div>
                </div>
              )}
              {pasteText && pastePreview && pastePreview.dataRows.length === 0 && (
                <div style={{fontSize: 12, color: 'var(--danger)', padding: '10px 12px', background: 'var(--danger-soft, #fff0f0)', border: '1px solid var(--danger)', borderRadius: 8}}>
                  No se detectaron filas válidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).
                </div>
              )}
            </div>
            <div style={{padding: '14px 22px', borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'flex-end', gap: 8, flex: '0 0 auto'}}>
              <Btn variant="ghost" onClick={() => setPasteOpen(false)}>Cancelar</Btn>
              <Btn variant="primary" icon="check" disabled={!pastePreview || pastePreview.dataRows.length === 0} onClick={applyPaste}>Aplicar a {pastePreview ? pastePreview.dataRows.length : 0} fila(s)</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

window.PackingWizard = PackingWizard;
