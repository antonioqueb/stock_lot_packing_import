/* global React, Icon, Btn, Badge, Callout, Empty */

const Documents = ({ proforma, setProforma, setRoute }) => {
  const [drag, setDrag] = React.useState(false);

  const CATEGORIES = [
    { id: 'proforma', icon: 'file', title: 'Proforma Invoice (PI)', desc: 'La cotización que enviaste a SOM GROUP firmada.', required: true, files: [
      { name: 'PI-9920-A-signed.pdf', size: 412000, uploaded: '2026-05-15' },
    ]},
    { id: 'contract', icon: 'doc_lines', title: 'Contrato comercial', desc: 'Contrato marco si aplica.', required: false, files: [] },
    { id: 'quality', icon: 'sparkles', title: 'Certificados de calidad', desc: 'Mineralogía, densidad, absorción, etc.', required: true, files: [
      { name: 'Mineralogy-CG.pdf', size: 188000, uploaded: '2026-05-22' },
      { name: 'Density-test.pdf',  size: 92000,  uploaded: '2026-05-22' },
    ]},
    { id: 'photos',   icon: 'image', title: 'Fotografías del producto', desc: 'Catálogo o muestras a granel del proveedor.', required: false, files: [] },
    { id: 'other',    icon: 'box',   title: 'Otros documentos', desc: 'Cualquier otro adjunto general.', required: false, files: [] },
  ];

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

      <div className={`dropzone ${drag ? 'is-drag' : ''}`}
           onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
           onDragLeave={() => setDrag(false)}
           onDragOver={(e) => e.preventDefault()}
           onDrop={(e) => { e.preventDefault(); setDrag(false); }}>
        <div className="dz-icon"><Icon name="upload" size={28}/></div>
        <h4>Arrastra tus archivos aquí</h4>
        <p>PDF, JPG, PNG · máximo 10 MB por archivo · o <a href="#" onClick={(e) => e.preventDefault()} style={{color: 'var(--accent)', fontWeight: 600}}>elige desde tu computadora</a></p>
      </div>

      <div style={{marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14}}>
        {CATEGORIES.map(cat => (
          <div key={cat.id} className="card" style={{padding: 16}}>
            <div style={{display: 'flex', alignItems: 'flex-start', gap: 14}}>
              <div style={{width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)',
                           display: 'grid', placeItems: 'center', flexShrink: 0}}>
                <Icon name={cat.icon} size={16}/>
              </div>
              <div style={{flex: 1}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2}}>
                  <strong>{cat.title}</strong>
                  {cat.required && <Badge tone={cat.files.length > 0 ? 'done' : 'todo'}>
                    {cat.files.length > 0 ? <><Icon name="check" size={10}/> {cat.files.length}</> : 'Obligatorio'}
                  </Badge>}
                  {!cat.required && <Badge tone="draft">Opcional</Badge>}
                </div>
                <div className="text-muted" style={{fontSize: 12.5, marginBottom: cat.files.length > 0 ? 12 : 0}}>{cat.desc}</div>

                {cat.files.length > 0 && (
                  <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                    {cat.files.map((f, i) => (
                      <div key={i} className="doc-row">
                        <div className="doc-icon"><Icon name="file" size={15}/></div>
                        <div className="doc-meta">
                          <div className="name">{f.name}</div>
                          <div className="meta">{(f.size/1024).toFixed(0)} KB · subido {f.uploaded}</div>
                        </div>
                        <Btn variant="ghost" size="sm" icon="download"/>
                        <Btn variant="ghost" size="sm" icon="trash" className="btn-danger-ghost"/>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Btn variant="secondary" size="sm" icon="upload">Subir</Btn>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

window.Documents = Documents;
