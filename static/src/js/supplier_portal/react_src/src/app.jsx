/* global React, ReactDOM, Icon, Btn, Badge,
   MOCK_PROFORMA, SAMPLE_ROWS, computeStatus, LangCtx, I18N,
   Sidebar, Overview, Globals, ShipmentsList, ShipmentDetail,
   PackingWizard, Documents, Confirm, Onboarding, GuidePanel,
   useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, TweakSelect */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "lang": "es",
  "accent": "#59473d",
  "validation_style": "inline",
  "show_onboarding": false,
  "show_guide_panel": true,
  "density": "comfortable",
  "show_completed_route": false
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = ['#59473d', '#3F7CD8', '#4F8B6E', '#C56A2F'];

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const t = tweaks;

  // simulate a completed proforma if requested
  const [proforma, setProforma] = React.useState(() => {
    if (t.show_completed_route) return completedProforma();
    return (window.SupplierReactExactData && window.SupplierReactExactData.proforma) || MOCK_PROFORMA;
  });
  React.useEffect(() => {
    setProforma(t.show_completed_route ? completedProforma() : ((window.SupplierReactExactData && window.SupplierReactExactData.proforma) || MOCK_PROFORMA));
  }, [t.show_completed_route]);

  const status = React.useMemo(() => computeStatus(proforma), [proforma]);

  // routing: { section, shipmentId?, tab? }
  const [route, setRoute] = React.useState({ section: 'overview' });
  const [packingWiz, setPackingWiz] = React.useState(null);
  const [showOnboard, setShowOnboard] = React.useState(t.show_onboarding);
  const [guideOpen, setGuideOpen] = React.useState(t.show_guide_panel);
  const [mobileNav, setMobileNav] = React.useState(false);

  React.useEffect(() => { setShowOnboard(t.show_onboarding); }, [t.show_onboarding]);
  React.useEffect(() => { setGuideOpen(t.show_guide_panel); }, [t.show_guide_panel]);

  // Inject dynamic accent color
  React.useEffect(() => {
    // convert hex to oklch-ish accent — use raw hex; lighter soft is computed via mix
    const root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-2', t.accent);
    root.style.setProperty('--accent-soft', t.accent + '14'); // 8% alpha
    root.style.setProperty('--accent-border', t.accent + '40');
  }, [t.accent]);

  // density
  React.useEffect(() => {
    document.documentElement.style.setProperty('--header-h', t.density === 'compact' ? '56px' : '64px');
  }, [t.density]);

  const lang = t.lang || 'es';
  // Sync the module-level language used by the React.createElement monkey-patch
  // (defined in i18n.jsx) so every literal Spanish child string and props
  // (title/placeholder/alt/aria-label) gets auto-translated on each render.
  if (typeof window !== 'undefined' && typeof window.__setLang === 'function') {
    window.__setLang(lang);
  }
  const tFn = (k) => (I18N[lang] && I18N[lang][k]) || (I18N.es[k]) || k;

  const openPackingWizard = (shipmentId, packingId) => setPackingWiz({ shipmentId, packingId });
  const closePackingWizard = () => setPackingWiz(null);
  // Imágenes capturadas en el asistente pendientes de subir (prototipo: solo
  // preview local). En el bundle conectado se suben en persistSnapshot.
  const pendingImagesRef = React.useRef({ blocks: {}, rows: {} });

  // Persist a packing (draft + rows) into the proforma state. Called by the
  // PackingWizard before closing. Creates the packing if it does not exist yet.
  const savePacking = (shipmentId, packingId, draftSnap, rowsSnap) => {
    if (!shipmentId) return;
    setProforma(prev => ({
      ...prev,
      shipments: prev.shipments.map(s => {
        if (s.id !== shipmentId) return s;
        const filled = rowsSnap.filter(r => r.h > 0 && r.w > 0 && r.container).length;
        const updated = {
          number: draftSnap.number,
          date: draftSnap.date,
          products: draftSnap.products,
          blocks: draftSnap.blocks,
          rows: rowsSnap,
          rows_filled: filled,
          rows_total: rowsSnap.length,
        };
        const existing = packingId ? s.packings.find(p => p.id === packingId) : null;
        const newPackings = existing
          ? s.packings.map(p => p.id === packingId ? { ...p, ...updated } : p)
          : [...s.packings, { id: 'pk-' + Date.now(), ...updated }];
        return { ...s, packings: newPackings };
      }),
    }));
  };

  const deleteShipment = (shipmentId) => {
    setProforma(prev => ({ ...prev, shipments: prev.shipments.filter(s => s.id !== shipmentId) }));
    setRoute({ section: 'shipments' });
  };

  const deletePacking = (shipmentId, packingId) => {
    setProforma(prev => ({
      ...prev,
      shipments: prev.shipments.map(s => s.id === shipmentId
        ? { ...s, packings: s.packings.filter(p => p.id !== packingId) }
        : s),
    }));
  };

  return (
    <LangCtx.Provider value={{ lang, t: tFn }}>
      <div className="app">
        <header className="app-header">
          <button className="icon-btn" style={{display: 'none'}} onClick={() => setMobileNav(!mobileNav)} aria-label="Menú">
            <Icon name="menu" size={16}/>
          </button>

          <div className="brand">
            <img src="/stock_lot_packing_import/static/src/img/icon.png" alt="SOM" className="brand-logo"/>
            <div className="brand-name">
              <span>SOM</span>
              <small>Portal proveedor</small>
            </div>
          </div>

          <div className="header-ctx">
            <span className="header-chip">
              <span className="dot"/>
              <span>{tFn('vendor')}:</span>
              <strong>{proforma.vendor}</strong>
            </span>
            <span className="header-chip">
              <span>{tFn('purchase_order')}:</span>
              <strong>{proforma.po_name}</strong>
            </span>

            <div className="lang-pill" role="tablist" aria-label="Idioma">
              {['es','en','zh','it','pt'].map(l => (
                <button key={l} className={lang === l ? 'active' : ''} onClick={() => setTweak({ lang: l })}>
                  {l === 'zh' ? '中' : l.toUpperCase()}
                </button>
              ))}
            </div>

            {route.section !== 'shipments' && (
            <button className={`guide-toggle ${guideOpen ? 'is-active' : ''}`}
                    onClick={() => setGuideOpen(!guideOpen)}
                    title={guideOpen ? tFn('hide_guide') : tFn('show_guide')}>
              <Icon name="sparkles" size={14}/>
              <span>{guideOpen ? 'Ocultar guía' : 'Mostrar guía'}</span>
            </button>
            )}
            <button className="guide-toggle" onClick={() => setShowOnboard(true)} title="Tutorial inicial">
              <Icon name="play" size={12}/>
              <span>Tutorial</span>
            </button>

            <div className="user-avatar" title="ZW">ZW</div>
          </div>
        </header>

        <div className={`app-body ${!(guideOpen && route.section !== 'shipments') ? 'guide-collapsed' : ''}`}>
          <Sidebar proforma={proforma} route={route} setRoute={setRoute} status={status} mobileOpen={mobileNav}/>

          <main className="main">
            {route.section === 'overview'  && <Overview proforma={proforma} status={status} setRoute={setRoute}/>}
            {route.section === 'globals'   && <Globals proforma={proforma} setProforma={setProforma} status={status} setRoute={setRoute} validationStyle={t.validation_style}/>}
            {route.section === 'shipments' && <ShipmentsList proforma={proforma} setProforma={setProforma} status={status} setRoute={setRoute}/>}
            {route.section === 'shipment'  && <ShipmentDetail proforma={proforma} setProforma={setProforma} status={status} setRoute={setRoute} route={route} openPackingWizard={openPackingWizard} onDeleteShipment={deleteShipment} onDeletePacking={deletePacking}/>}
            {route.section === 'documents' && <Documents proforma={proforma} setProforma={setProforma} setRoute={setRoute}/>}
            {route.section === 'review'    && <Confirm proforma={proforma} status={status} setRoute={setRoute}/>}
          </main>

          {guideOpen && route.section !== 'shipments' && <GuidePanel route={route} onClose={() => setGuideOpen(false)}/>}
        </div>

        {packingWiz && (
          <PackingWizard proforma={proforma}
                         shipmentId={packingWiz.shipmentId}
                         packingId={packingWiz.packingId}
                         sampleRows={SAMPLE_ROWS}
                         onClose={closePackingWizard}
                         onSave={savePacking}
                         pendingImages={pendingImagesRef}/>
        )}

        {showOnboard && <Onboarding onClose={() => setShowOnboard(false)}/>}

        <TweaksPanel title="Tweaks">
          <TweakSection label="Idioma & branding">
            <TweakRadio label="Idioma" value={t.lang} onChange={(v) => setTweak({ lang: v })}
                        options={[{value:'es',label:'ES'},{value:'en',label:'EN'},{value:'zh',label:'中'},{value:'it',label:'IT'},{value:'pt',label:'PT'}]}/>
            <TweakColor label="Acento" value={t.accent} options={ACCENT_OPTIONS} onChange={(v) => setTweak({ accent: v })}/>
            <TweakRadio label="Densidad" value={t.density} onChange={(v) => setTweak({ density: v })}
                        options={[{value:'comfortable',label:'Cómoda'},{value:'compact',label:'Compacta'}]}/>
          </TweakSection>

          <TweakSection label="Guía y onboarding">
            <TweakToggle label="Panel guía a la derecha" value={t.show_guide_panel} onChange={(v) => setTweak({ show_guide_panel: v })}/>
            <TweakToggle label="Mostrar onboarding ahora" value={t.show_onboarding} onChange={(v) => setTweak({ show_onboarding: v })}/>
          </TweakSection>

          <TweakSection label="Validación">
            <TweakSelect label="Estilo cuando hay errores" value={t.validation_style} onChange={(v) => setTweak({ validation_style: v })}
                         options={[
                           {value:'inline', label:'Suave — solo inline en cada campo'},
                           {value:'sticky', label:'Inline + banner sticky resumen'},
                           {value:'block', label:'Bloquear avance hasta corregir'},
                         ]}/>
          </TweakSection>

          <TweakSection label="Estado simulado">
            <TweakToggle label="Mostrar todo completado" value={t.show_completed_route} onChange={(v) => setTweak({ show_completed_route: v })}/>
          </TweakSection>
        </TweaksPanel>
      </div>
    </LangCtx.Provider>
  );
}

function completedProforma() {
  const base = JSON.parse(JSON.stringify(MOCK_PROFORMA));
  base.globals.invoice_global = 'INV-2026-GLOBAL-001';
  base.globals.general_notes  = 'Las placas vienen empacadas en bundles de madera dura. Cuidado con esquinas.';
  base.shipments.forEach(s => {
    if (!s.type) s.type = 'maritime';
    if (!s.shipping_line) s.shipping_line = 'COSCO Shipping Lines';
    if (!s.vessel) s.vessel = 'COSCO TAICANG / 044E';
    if (!s.etd) s.etd = '2026-07-15';
    if (!s.eta) s.eta = '2026-08-07';
    if (!s.bl_number) { s.bl_number = 'COSU6817042777'; s.bl_date = '2026-07-16'; s.bl_file = 'BL.pdf'; }
    if (s.invoices.length === 0) s.invoices = [{ id:'i', number:'INV-2026-090', date:'2026-07-14', amount: 45200, currency:'USD', scope:'full', containers: [] }];
    s.invoices.forEach(i => { if (!i.number) i.number = 'INV-AUTO'; if (!i.amount) i.amount = 12000; if (!i.date) i.date = '2026-07-14'; });
    if (s.containers.length === 0) s.containers = [{ id:'cx', number:'COSU6817044', seal:'CN8821099', type:'40HQ', weight: 27200, volume: 67.2, packages: 12 }];
    s.containers.forEach(c => { if (!c.number) c.number = 'COSU6817099'; });
    if (s.packings.length === 0) {
      s.packings = [{ id:'pkx', number:'PK-AUTO-1', date:'2026-07-14', products:['p1'], blocks:[{id:'bx', name:'B-AUTO', count:12, photo:true, product:'p1'}], rows_filled: 12, rows_total: 12 }];
    }
    s.packings.forEach(pk => { pk.rows_filled = pk.rows_total; pk.blocks.forEach(b => b.photo = true); });
  });
  return base;
}

// Límite de error: si algún componente lanza durante el render, en lugar de dejar
// la app en blanco o en un ciclo de remontaje, mostramos un aviso y un botón de
// recarga. (En el bundle conectado, los datos siguen a salvo en el respaldo local.)
class PortalErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[SupplierPortal] Error de render:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 24, maxWidth: 520, margin: '48px auto', textAlign: 'center', fontFamily: 'inherit'}}>
          <h2 style={{marginBottom: 8}}>Ocurrió un problema al mostrar el portal</h2>
          <p style={{color: '#666', lineHeight: 1.5, marginBottom: 16}}>Tus datos capturados están a salvo. Recarga la página para continuar desde donde te quedaste.</p>
          <button onClick={() => window.location.reload()} style={{padding: '10px 20px', cursor: 'pointer', borderRadius: 8, border: 'none', background: 'var(--accent, #59473d)', color: '#fff', fontWeight: 600}}>Recargar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const __supplierPortalRoot = document.getElementById('root');
if (__supplierPortalRoot) { ReactDOM.createRoot(__supplierPortalRoot).render(<PortalErrorBoundary><App/></PortalErrorBoundary>); }
