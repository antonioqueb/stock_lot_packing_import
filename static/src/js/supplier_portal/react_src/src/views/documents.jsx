/* global React, Icon, Btn, Badge, Callout, Empty, portalRpc, fileToBase64 */

// Categorías de documentos generales (alcance Proforma). docType = valor del backend.
const GENERAL_DOC_CATS = [
  { docType: 'proforma_signed', icon: 'file',      title: 'Proforma firmada',       desc: 'La cotización que enviaste a SOM GROUP, firmada.', required: true },
  { docType: 'contract',        icon: 'doc_lines', title: 'Contrato comercial',     desc: 'Contrato marco, si aplica.', required: false },
  { docType: 'quality_cert',    icon: 'sparkles',  title: 'Certificados de calidad', desc: 'Mineralogía, densidad, absorción, etc.', required: true },
  { docType: 'product_photos',  icon: 'image',     title: 'Fotos del producto',     desc: 'Catálogo o muestras a granel del proveedor.', required: false },
  { docType: 'general_other',   icon: 'box',       title: 'Otros documentos',       desc: 'Cualquier otro adjunto general.', required: false },
];

const generalDocAllowed = (file) =>
  file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/jpg' ||
  file.type === 'image/png' || /\.(pdf|jpe?g|png)$/i.test(file.name || '');

const Documents = ({ proforma, setProforma, setRoute }) => {
  const [drag, setDrag] = React.useState(false);
  const [docs, setDocs] = React.useState([]);
  const [busy, setBusy] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const api = (typeof window !== 'undefined' && window.__supplierPortalApi) || null;
  const token = api && api.token;

  const refresh = React.useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const res = await portalRpc('/supplier/api/v2/list_documents', { token });
      if (res && res.success) setDocs(res.global_documents || []);
    } catch (err) {
      console.error('[SupplierPortal] Error listando documentos:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);
  React.useEffect(() => { refresh(); }, [refresh]);

  const uploadOne = async (docType, file) => {
    if (!file) return false;
    if (!generalDocAllowed(file)) { window.alert('"' + file.name + '": solo se permiten archivos PDF, JPG o PNG.'); return false; }
    if (file.size > 10 * 1024 * 1024) { window.alert('"' + file.name + '" supera el máximo de 10 MB.'); return false; }
    const { data } = await fileToBase64(file);
    const res = await portalRpc('/supplier/api/v2/upload_document', {
      token,
      document_type: docType,
      file_data: data,
      file_name: file.name || 'documento',
      file_size: file.size || 0,
      mime_type: file.type || '',
    });
    if (!res || !res.success) { window.alert((res && res.message) || ('No se pudo subir "' + file.name + '".')); return false; }
    setDocs(res.documents || []);
    return true;
  };

  const uploadMany = async (docType, fileList) => {
    if (!token) { window.alert('No se puede subir: el portal no tiene sesión activa.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(docType);
    try {
      for (const f of files) { await uploadOne(docType, f); }
    } catch (err) {
      console.error('[SupplierPortal] Error subiendo documento general:', err);
      window.alert('Ocurrió un error al subir el documento.');
    } finally {
      setBusy(null);
    }
  };

  const removeDoc = async (doc) => {
    if (!token || !doc) return;
    if (!window.confirm('¿Eliminar "' + doc.name + '"?')) return;
    setBusy(doc.document_type);
    try {
      const res = await portalRpc('/supplier/api/v2/delete_document', { token, document_id: doc.id });
      if (!res || !res.success) { window.alert((res && res.message) || 'No se pudo eliminar el documento.'); return; }
      setDocs(res.documents || []);
    } catch (err) {
      console.error('[SupplierPortal] Error eliminando documento general:', err);
      window.alert('Ocurrió un error al eliminar el documento.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="crumb">
        <a onClick={() => setRoute({ section: 'overview' })}>Vista general</a>
        <Icon name="chevron_right" size={10}/>
        Documentos
      </div>

      <div className="page-head">
        <div className="text">
          <h1>Documentos generales</h1>
          <p className="lead">
            Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque.
          </p>
        </div>
      </div>

      <label className={`dropzone ${drag ? 'is-drag' : ''}`} style={{cursor: 'pointer', display: 'block'}}
             onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
             onDragLeave={() => setDrag(false)}
             onDragOver={(e) => e.preventDefault()}
             onDrop={(e) => { e.preventDefault(); setDrag(false); uploadMany('general_other', e.dataTransfer.files); }}>
        <input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple style={{display: 'none'}}
               onChange={(e) => { const fl = e.target.files; e.target.value = ''; uploadMany('general_other', fl); }}/>
        <div className="dz-icon"><Icon name="upload" size={28}/></div>
        <h4>Arrastra tus archivos aquí</h4>
        <p>PDF, JPG, PNG · máximo 10 MB por archivo · o <span style={{color: 'var(--accent)', fontWeight: 600}}>elige desde tu computadora</span> (se guardan en "Otros documentos")</p>
      </label>

      {loading ? (
        <div className="text-muted" style={{marginTop: 24, fontSize: 13}}>Cargando documentos…</div>
      ) : (
      <div style={{marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14}}>
        {GENERAL_DOC_CATS.map(cat => {
          const catDocs = docs.filter(d => d.document_type === cat.docType);
          const isBusy = busy === cat.docType;
          return (
          <div key={cat.docType} className="card" style={{padding: 16}}>
            <div style={{display: 'flex', alignItems: 'flex-start', gap: 14}}>
              <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)',
                           display: 'grid', placeItems: 'center', flexShrink: 0}}>
                <Icon name={cat.icon} size={16}/>
              </div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2}}>
                  <strong>{cat.title}</strong>
                  {cat.required && <Badge tone={catDocs.length > 0 ? 'done' : 'warn'}>
                    {catDocs.length > 0 ? <><Icon name="check" size={10}/> {catDocs.length}</> : 'Obligatorio'}
                  </Badge>}
                  {!cat.required && (catDocs.length > 0
                    ? <Badge tone="done"><Icon name="check" size={10}/> {catDocs.length}</Badge>
                    : <Badge tone="draft">Opcional</Badge>)}
                </div>
                <div className="text-muted" style={{fontSize: 12.5, marginBottom: catDocs.length > 0 ? 12 : 0}}>{cat.desc}</div>

                {catDocs.length > 0 && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                    {catDocs.map((f) => (
                      <div key={f.id} className="doc-row">
                        <div className="doc-icon"><Icon name="file" size={15}/></div>
                        <div className="doc-meta">
                          <div className="name">{f.name}</div>
                          <div className="meta">{((f.file_size || 0)/1024).toFixed(0)} KB</div>
                        </div>
                        <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost" disabled={isBusy} onClick={() => removeDoc(f)}/>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <label className={`btn btn-secondary sm ${isBusy ? 'is-disabled' : ''}`} style={{cursor: isBusy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0}}>
                <input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple style={{display: 'none'}} disabled={isBusy}
                       onChange={(e) => { const fl = e.target.files; e.target.value = ''; uploadMany(cat.docType, fl); }}/>
                <Icon name="upload" size={13}/>
                {isBusy ? 'Subiendo…' : 'Subir'}
              </label>
            </div>
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
};

window.Documents = Documents;
