(function(){
'use strict';
// portal_react_exact_bridge.js — maps Odoo portal_json into the JSX prototype data shape.
(function () {
    function parsePayload() {
        var el = document.getElementById('portal-data-store');
        if (!el)
            return {};
        var raw = (el.dataset && el.dataset.payload) || el.textContent || '{}';
        try {
            return JSON.parse(raw);
        }
        catch (err) {
            console.error('[ReactExactPortal] Invalid portal_json payload', err);
            return {};
        }
    }
    function s(v, fallback) { return (v === null || v === undefined || v === false) ? (fallback || '') : String(v); }
    function n(v, fallback) { var x = Number(v); return Number.isFinite(x) ? x : (fallback || 0); }
    function arr(v) { return Array.isArray(v) ? v : []; }
    function uniq(values) {
        var out = [];
        arr(values).forEach(function (v) { if (v !== null && v !== undefined && out.indexOf(v) === -1)
            out.push(v); });
        return out;
    }
    function kind(unitType) {
        var k = s(unitType || '').toLowerCase();
        if (k.indexOf('placa') >= 0 || k.indexOf('slab') >= 0)
            return 'placa';
        if (k.indexOf('formato') >= 0 || k.indexOf('tile') >= 0)
            return 'formato';
        return 'pieza';
    }
    function productFromOdoo(p) {
        var k = kind(p.unit_type || p.kind);
        return {
            id: p.id,
            name: s(p.name || p.product_name || p.display_name, 'Producto'),
            ref: s(p.code || p.default_code || p.ref, ''),
            kind: k,
            requested_qty: n(p.qty_ordered || p.requested_qty || p.qty_available, 0),
            unit: s(p.uom || p.unit || (k === 'placa' ? 'placa' : 'pz'), ''),
            dim_text: s(p.dim_text || p.dimension || p.uom || '', '')
        };
    }
    function docKind(t) {
        var map = { bl: 'BL', invoice: 'INV', packing_list: 'PACKING', eur1: 'EUR1', certificate_origin: 'CO', fumigation: 'PHYTO' };
        return map[t] || s(t || 'OTHER').toUpperCase();
    }
    function normalizePacking(pk, shipment, fallbackProducts) {
        var rows = arr(pk.rows);
        var blockImages = arr(shipment.block_images || []);
        function hasBlockImage(productId, blockName) {
            blockName = s(blockName).trim().toLowerCase();
            return blockImages.some(function (img) {
                return String(img.product_id) === String(productId) && s(img.block_name).trim().toLowerCase() === blockName && (img.has_image !== false);
            });
        }
        function blockImageIdFor(productId, blockName) {
            blockName = s(blockName).trim().toLowerCase();
            var found = blockImages.find(function (img) {
                return String(img.product_id) === String(productId) && s(img.block_name).trim().toLowerCase() === blockName && (img.has_image !== false);
            });
            return found ? found.id : 0;
        }
        function rowToUi(r, idx) {
            var product = fallbackProducts.find(function (p) { return String(p.id) === String(r.product_id); }) || fallbackProducts[0] || {};
            var tipo = s(r.tipo || product.kind || 'Placa');
            return {
                id: r.id || r._client_id || ('row-' + idx),
                _odoo_id: r.id || false,
                product_id: r.product_id || product.id || false,
                tipo: tipo,
                block: s(r.bloque || r.block || 'SIN BLOQUE').trim() || 'SIN BLOQUE',
                atado: s(r.atado || '', ''),
                plate: s(r.numero_placa || r.plate || '', ''),
                ref: s(r.ref_proveedor || r.ref || '', ''),
                thickness: n(r.grosor || r.thickness, 0),
                h: n(r.alto || r.h, 0),
                w: n(r.ancho || r.w, 0),
                quantity: n(r.quantity || r.qty, 0),
                weight: n(r.peso || r.weight, 0),
                notes: s(r.color || r.notes || '', ''),
                grupo: s(r.grupo_name || r.grupo || '', ''),
                pedimento: s(r.pedimento || '', ''),
                container: s(r.container_number || r.container || '', ''),
                container_id: r.container_id || false,
                photo: !!r.has_image,
                errors: []
            };
        }
        var uiRows = rows.map(rowToUi);
        var byKey = {};
        uiRows.forEach(function (r) {
            var block = s(r.block || 'SIN BLOQUE').trim() || 'SIN BLOQUE';
            var pid = r.product_id || (fallbackProducts[0] && fallbackProducts[0].id);
            // Solo las Placas usan foto por bloque. Formato/Pieza no tienen
            // bloque de cantera, así que se marcan como que no requieren foto.
            var isPlaca = s(r.tipo || 'Placa').toLowerCase().indexOf('placa') >= 0;
            var key = String(pid) + '::' + block.toLowerCase();
            if (!byKey[key])
                byKey[key] = { id: key, name: block, count: 0, photo: !isPlaca || hasBlockImage(pid, block) || !!r.photo, product: pid, needs_photo: isPlaca, block_image_id: blockImageIdFor(pid, block) };
            byKey[key].count += 1;
            if (r.photo)
                byKey[key].photo = true;
        });
        var blocks = Object.keys(byKey).map(function (k) { return byKey[k]; });
        var productIds = uniq(uiRows.map(function (r) { return r.product_id; })).filter(Boolean);
        if (!productIds.length && arr(pk.products).length)
            productIds = pk.products;
        if (!productIds.length && fallbackProducts.length)
            productIds = [fallbackProducts[0].id];
        var total = n(pk.row_count || pk.rows_total || uiRows.length || blocks.reduce(function (a, b) { return a + n(b.count); }, 0), 0);
        var filled = uiRows.filter(function (r) {
            var tipo = s(r.tipo || 'Placa').toLowerCase();
            var hasMeasure = tipo.indexOf('placa') >= 0 ? (n(r.h) > 0 && n(r.w) > 0) : (n(r.quantity) > 0);
            return hasMeasure;
        }).length;
        return {
            id: pk.id || pk._client_id || ('pk-' + Math.random().toString(36).slice(2)),
            number: s(pk.packing_number || pk.number || pk.name, 'PK'),
            date: s(pk.packing_date || pk.date, ''),
            products: productIds,
            blocks: blocks,
            rows: uiRows,
            rows_filled: n(pk.rows_filled, filled),
            rows_total: total || filled,
            _odoo_rows: rows
        };
    }
    function normalize(payload) {
        payload = payload || {};
        var p = payload.proforma || {};
        var sourceProducts = arr(payload.products).length ? arr(payload.products) : arr(p.products);
        var products = sourceProducts.map(productFromOdoo);
        var firstShipment = arr(p.shipments)[0] || {};
        var shipments = arr(p.shipments).map(function (sh, idx) {
            var shipProducts = arr(sh.products).length ? arr(sh.products).map(productFromOdoo) : products;
            return {
                id: sh.id || ('s' + (idx + 1)),
                // Folio mostrado al proveedor: posición (1,2,3…) según el orden del
                // backend. Así el primero siempre es 1 aunque la secuencia interna
                // tenga huecos por embarques eliminados (la secuencia real se usa
                // solo para ordenar/nombrar en Odoo).
                number: idx + 1,
                type: sh.shipment_type || sh.type || 'maritime',
                shipping_line: s(sh.shipping_line, ''),
                vessel: s(sh.vessel_name || sh.vessel, ''),
                etd: s(sh.etd, ''),
                eta: s(sh.eta, ''),
                status: s(sh.status, 'draft'),
                notes: s(sh.notes, ''),
                bl_number: s(sh.bl_number, ''),
                bl_date: s(sh.bl_date, ''),
                bl_file: '',
                invoices: arr(sh.invoices).map(function (inv, i) {
                    return { id: inv.id || ('inv' + i), number: s(inv.invoice_number || inv.number, ''), date: s(inv.invoice_date || inv.date, ''), amount: n(inv.amount, 0), currency: s(inv.currency_name || inv.currency || 'USD', 'USD'), scope: inv.scope || 'full', containers: arr(inv.container_ids || inv.containers) };
                }),
                containers: arr(sh.containers).map(function (c, i) {
                    return { id: c.id || ('c' + i), number: s(c.container_number || c.number, ''), seal: s(c.seal_number || c.seal, ''), type: s(c.container_type || c.type || '40HQ', '40HQ'), weight: n(c.weight, 0), volume: n(c.volume, 0), packages: n(c.packages, 0) };
                }),
                packings: arr(sh.packings).map(function (pk) { return normalizePacking(pk, sh, shipProducts); }),
                documents: arr(sh.documents).map(function (d) { return { id: d.id, name: s(d.name || d.file_name, 'documento'), kind: docKind(d.document_type || d.kind), size: n(d.file_size || d.size, 0), uploaded: s(d.uploaded || d.create_date || '', '') }; })
            };
        });
        return {
            vendor: s(payload.vendor_name || payload.partner_name || p.vendor || '', ''),
            vendor_country: s(payload.vendor_country || '', ''),
            po_name: s(payload.poName || payload.po_name || p.po_name || '', ''),
            picking_name: s(payload.pickingName || payload.picking_name || firstShipment.picking_name || '', ''),
            payload_currency: s(payload.currency || 'USD', 'USD'),
            globals: {
                proforma_number: s(p.proforma_number || (payload.header && payload.header.proforma_number), ''),
                invoice_global: s(p.invoice_global_number || (payload.header && payload.header.invoice_number), ''),
                payment_terms: s(p.payment_terms || (payload.header && payload.header.payment_terms), ''),
                country_origin: s(p.country_origin || (payload.header && payload.header.country_origin), ''),
                port_origin: s(p.port_origin || firstShipment.port_origin || (payload.header && payload.header.port_origin) || '', ''),
                port_destination: s(p.port_destination || firstShipment.port_destination || (payload.header && payload.header.port_destination) || '', ''),
                incoterm: s(p.incoterm || (payload.header && payload.header.incoterm), ''),
                general_notes: s(p.general_notes || (payload.header && payload.header.general_notes), '')
            },
            products: products,
            shipments: shipments
        };
    }
    var rawPayload = parsePayload();
    window.SupplierReactExactNormalize = normalize;
    window.SupplierReactExactData = { raw: rawPayload, proforma: normalize(rawPayload) };
})();
// ===== tweaks-panel.jsx =====
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// ─────────────────────────────────────────────────────────────────────────────
const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;
// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
    const [values, setValues] = React.useState(defaults);
    // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
    // useState-style call doesn't write a "[object Object]" key into the persisted
    // JSON block.
    const setTweak = React.useCallback((keyOrEdits, val) => {
        const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
            ? keyOrEdits : { [keyOrEdits]: val };
        setValues((prev) => ({ ...prev, ...edits }));
        window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
        // Same-window signal so in-page listeners (deck-stage rail thumbnails)
        // can react — the parent message only reaches the host, not peers.
        window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
    }, []);
    return [values, setTweak];
}
// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({ title = 'Tweaks', noDeckControls = false, children }) {
    const [open, setOpen] = React.useState(false);
    const dragRef = React.useRef(null);
    // Auto-inject a rail toggle when a <deck-stage> is on the page. The
    // toggle drives the deck's per-viewer _railVisible via window message;
    // state is mirrored from the same localStorage key the deck reads so
    // the control reflects reality across reloads. The mechanism is the
    // message — authors who want custom placement can post it directly
    // and pass noDeckControls to suppress this one.
    const hasDeckStage = React.useMemo(() => typeof document !== 'undefined' && !!document.querySelector('deck-stage'), []);
    // deck-stage enables its rail in connectedCallback, but this panel can
    // mount before that element has upgraded. The initial read catches the
    // common case; the listener covers mounting first. (Older deck-stage.js
    // copies still wait for the host's __omelette_rail_enabled postMessage —
    // same listener handles those.)
    const [railEnabled, setRailEnabled] = React.useState(() => { var _a; return hasDeckStage && !!((_a = document.querySelector('deck-stage')) === null || _a === void 0 ? void 0 : _a._railEnabled); });
    React.useEffect(() => {
        if (!hasDeckStage || railEnabled)
            return undefined;
        const onMsg = (e) => {
            if (e.data && e.data.type === '__omelette_rail_enabled')
                setRailEnabled(true);
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    }, [hasDeckStage, railEnabled]);
    const [railVisible, setRailVisible] = React.useState(() => {
        try {
            return localStorage.getItem('deck-stage.railVisible') !== '0';
        }
        catch (e) {
            return true;
        }
    });
    const toggleRail = (on) => {
        setRailVisible(on);
        window.postMessage({ type: '__deck_rail_visible', on }, '*');
    };
    const offsetRef = React.useRef({ x: 16, y: 16 });
    const PAD = 16;
    const clampToViewport = React.useCallback(() => {
        const panel = dragRef.current;
        if (!panel)
            return;
        const w = panel.offsetWidth, h = panel.offsetHeight;
        const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
        const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
        offsetRef.current = {
            x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
            y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
        };
        panel.style.right = offsetRef.current.x + 'px';
        panel.style.bottom = offsetRef.current.y + 'px';
    }, []);
    React.useEffect(() => {
        if (!open)
            return;
        clampToViewport();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', clampToViewport);
            return () => window.removeEventListener('resize', clampToViewport);
        }
        const ro = new ResizeObserver(clampToViewport);
        ro.observe(document.documentElement);
        return () => ro.disconnect();
    }, [open, clampToViewport]);
    React.useEffect(() => {
        const onMsg = (e) => {
            var _a;
            const t = (_a = e === null || e === void 0 ? void 0 : e.data) === null || _a === void 0 ? void 0 : _a.type;
            if (t === '__activate_edit_mode')
                setOpen(true);
            else if (t === '__deactivate_edit_mode')
                setOpen(false);
        };
        window.addEventListener('message', onMsg);
        window.parent.postMessage({ type: '__edit_mode_available' }, '*');
        return () => window.removeEventListener('message', onMsg);
    }, []);
    const dismiss = () => {
        setOpen(false);
        window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
    };
    const onDragStart = (e) => {
        const panel = dragRef.current;
        if (!panel)
            return;
        const r = panel.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        const startRight = window.innerWidth - r.right;
        const startBottom = window.innerHeight - r.bottom;
        const move = (ev) => {
            offsetRef.current = {
                x: startRight - (ev.clientX - sx),
                y: startBottom - (ev.clientY - sy),
            };
            clampToViewport();
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };
    if (!open)
        return null;
    return (React.createElement(React.Fragment, null,
        React.createElement("style", null, __TWEAKS_STYLE),
        React.createElement("div", { ref: dragRef, className: "twk-panel", "data-noncommentable": "", style: { right: offsetRef.current.x, bottom: offsetRef.current.y } },
            React.createElement("div", { className: "twk-hd", onMouseDown: onDragStart },
                React.createElement("b", null, title),
                React.createElement("button", { className: "twk-x", "aria-label": "Close tweaks", onMouseDown: (e) => e.stopPropagation(), onClick: dismiss }, "\u2715")),
            React.createElement("div", { className: "twk-body" },
                children,
                hasDeckStage && railEnabled && !noDeckControls && (React.createElement(TweakSection, { label: "Deck" },
                    React.createElement(TweakToggle, { label: "Thumbnail rail", value: railVisible, onChange: toggleRail })))))));
}
// ── Layout helpers ──────────────────────────────────────────────────────────
function TweakSection({ label, children }) {
    return (React.createElement(React.Fragment, null,
        React.createElement("div", { className: "twk-sect" }, label),
        children));
}
function TweakRow({ label, value, children, inline = false }) {
    return (React.createElement("div", { className: inline ? 'twk-row twk-row-h' : 'twk-row' },
        React.createElement("div", { className: "twk-lbl" },
            React.createElement("span", null, label),
            value != null && React.createElement("span", { className: "twk-val" }, value)),
        children));
}
// ── Controls ────────────────────────────────────────────────────────────────
function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
    return (React.createElement(TweakRow, { label: label, value: `${value}${unit}` },
        React.createElement("input", { type: "range", className: "twk-slider", min: min, max: max, step: step, value: value, onChange: (e) => onChange(Number(e.target.value)) })));
}
function TweakToggle({ label, value, onChange }) {
    return (React.createElement("div", { className: "twk-row twk-row-h" },
        React.createElement("div", { className: "twk-lbl" },
            React.createElement("span", null, label)),
        React.createElement("button", { type: "button", className: "twk-toggle", "data-on": value ? '1' : '0', role: "switch", "aria-checked": !!value, onClick: () => onChange(!value) },
            React.createElement("i", null))));
}
function TweakRadio({ label, value, options, onChange }) {
    var _a;
    const trackRef = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    // The active value is read by pointer-move handlers attached for the lifetime
    // of a drag — ref it so a stale closure doesn't fire onChange for every move.
    const valueRef = React.useRef(value);
    valueRef.current = value;
    // Segments wrap mid-word once per-segment width runs out. The track is
    // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
    // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
    // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
    // back to a dropdown rather than wrap.
    const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
    const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
    const fitsAsSegments = maxLen <= ((_a = { 2: 16, 3: 10 }[options.length]) !== null && _a !== void 0 ? _a : 0);
    if (!fitsAsSegments) {
        // <select> emits strings — map back to the original option value so the
        // fallback stays type-preserving (numbers, booleans) like the segment path.
        const resolve = (s) => {
            const m = options.find((o) => String(typeof o === 'object' ? o.value : o) === s);
            return m === undefined ? s : typeof m === 'object' ? m.value : m;
        };
        return React.createElement(TweakSelect, { label: label, value: value, options: options, onChange: (s) => onChange(resolve(s)) });
    }
    const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    const idx = Math.max(0, opts.findIndex((o) => o.value === value));
    const n = opts.length;
    const segAt = (clientX) => {
        const r = trackRef.current.getBoundingClientRect();
        const inner = r.width - 4;
        const i = Math.floor(((clientX - r.left - 2) / inner) * n);
        return opts[Math.max(0, Math.min(n - 1, i))].value;
    };
    const onPointerDown = (e) => {
        setDragging(true);
        const v0 = segAt(e.clientX);
        if (v0 !== valueRef.current)
            onChange(v0);
        const move = (ev) => {
            if (!trackRef.current)
                return;
            const v = segAt(ev.clientX);
            if (v !== valueRef.current)
                onChange(v);
        };
        const up = () => {
            setDragging(false);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };
    return (React.createElement(TweakRow, { label: label },
        React.createElement("div", { ref: trackRef, role: "radiogroup", onPointerDown: onPointerDown, className: dragging ? 'twk-seg dragging' : 'twk-seg' },
            React.createElement("div", { className: "twk-seg-thumb", style: { left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                    width: `calc((100% - 4px) / ${n})` } }),
            opts.map((o) => (React.createElement("button", { key: o.value, type: "button", role: "radio", "aria-checked": o.value === value }, o.label))))));
}
function TweakSelect({ label, value, options, onChange }) {
    return (React.createElement(TweakRow, { label: label },
        React.createElement("select", { className: "twk-field", value: value, onChange: (e) => onChange(e.target.value) }, options.map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : o;
            return React.createElement("option", { key: v, value: v }, l);
        }))));
}
function TweakText({ label, value, placeholder, onChange }) {
    return (React.createElement(TweakRow, { label: label },
        React.createElement("input", { className: "twk-field", type: "text", value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value) })));
}
function TweakNumber({ label, value, min, max, step = 1, unit = '', onChange }) {
    const clamp = (n) => {
        if (min != null && n < min)
            return min;
        if (max != null && n > max)
            return max;
        return n;
    };
    const startRef = React.useRef({ x: 0, val: 0 });
    const onScrubStart = (e) => {
        e.preventDefault();
        startRef.current = { x: e.clientX, val: value };
        const decimals = (String(step).split('.')[1] || '').length;
        const move = (ev) => {
            const dx = ev.clientX - startRef.current.x;
            const raw = startRef.current.val + dx * step;
            const snapped = Math.round(raw / step) * step;
            onChange(clamp(Number(snapped.toFixed(decimals))));
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };
    return (React.createElement("div", { className: "twk-num" },
        React.createElement("span", { className: "twk-num-lbl", onPointerDown: onScrubStart }, label),
        React.createElement("input", { type: "number", value: value, min: min, max: max, step: step, onChange: (e) => onChange(clamp(Number(e.target.value))) }),
        unit && React.createElement("span", { className: "twk-num-unit" }, unit)));
}
// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
    const h = String(hex).replace('#', '');
    const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
    const n = parseInt(x.slice(0, 6), 16);
    if (Number.isNaN(n))
        return true;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({ light }) => (React.createElement("svg", { viewBox: "0 0 14 14", "aria-hidden": "true" },
    React.createElement("path", { d: "M3 7.2 5.8 10 11 4.2", fill: "none", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round", stroke: light ? 'rgba(0,0,0,.78)' : '#fff' })));
// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({ label, value, options, onChange }) {
    if (!options || !options.length) {
        return (React.createElement("div", { className: "twk-row twk-row-h" },
            React.createElement("div", { className: "twk-lbl" },
                React.createElement("span", null, label)),
            React.createElement("input", { type: "color", className: "twk-swatch", value: value, onChange: (e) => onChange(e.target.value) })));
    }
    // Native <input type=color> emits lowercase hex per the HTML spec, so
    // compare case-insensitively. String() guards JSON.stringify(undefined),
    // which returns the primitive undefined (no .toLowerCase).
    const key = (o) => String(JSON.stringify(o)).toLowerCase();
    const cur = key(value);
    return (React.createElement(TweakRow, { label: label },
        React.createElement("div", { className: "twk-chips", role: "radiogroup" }, options.map((o, i) => {
            const colors = Array.isArray(o) ? o : [o];
            const [hero, ...rest] = colors;
            const sup = rest.slice(0, 4);
            const on = key(o) === cur;
            return (React.createElement("button", { key: i, type: "button", className: "twk-chip", role: "radio", "aria-checked": on, "data-on": on ? '1' : '0', "aria-label": colors.join(', '), title: colors.join(' · '), style: { background: hero }, onClick: () => onChange(o) },
                sup.length > 0 && (React.createElement("span", null, sup.map((c, j) => React.createElement("i", { key: j, style: { background: c } })))),
                on && React.createElement(__TwkCheck, { light: __twkIsLight(hero) })));
        }))));
}
function TweakButton({ label, onClick, secondary = false }) {
    return (React.createElement("button", { type: "button", className: secondary ? 'twk-btn secondary' : 'twk-btn', onClick: onClick }, label));
}
Object.assign(window, {
    useTweaks, TweaksPanel, TweakSection, TweakRow,
    TweakSlider, TweakToggle, TweakRadio, TweakSelect,
    TweakText, TweakNumber, TweakColor, TweakButton,
});
// ===== src/icons.jsx =====
/* global React */
// Inline SVG icons — kept simple, geometric only
const Icon = ({ name, size = 16, stroke = 1.6, ...rest }) => {
    const s = size;
    const common = {
        width: s, height: s, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: stroke,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        ...rest,
    };
    const P = {
        check: React.createElement("path", { d: "M5 12.5L10 17l9-10" }),
        x: React.createElement("path", { d: "M6 6l12 12M18 6L6 18" }),
        plus: React.createElement("path", { d: "M12 5v14M5 12h14" }),
        minus: React.createElement("path", { d: "M5 12h14" }),
        chevron_right: React.createElement("path", { d: "M9 6l6 6-6 6" }),
        chevron_left: React.createElement("path", { d: "M15 6l-6 6 6 6" }),
        chevron_down: React.createElement("path", { d: "M6 9l6 6 6-6" }),
        arrow_right: React.createElement("path", { d: "M5 12h14M13 6l6 6-6 6" }),
        arrow_left: React.createElement("path", { d: "M19 12H5M11 6l-6 6 6 6" }),
        arrow_up: React.createElement("path", { d: "M12 19V5M6 11l6-6 6 6" }),
        cube: React.createElement("g", null,
            React.createElement("path", { d: "M12 3l9 5v8l-9 5-9-5V8z" }),
            React.createElement("path", { d: "M3 8l9 5 9-5M12 13v10" })),
        ship: React.createElement("g", null,
            React.createElement("path", { d: "M3 17l9 4 9-4M5 10l7-4 7 4v6l-7 3-7-3z" }),
            React.createElement("path", { d: "M12 6V2" })),
        box: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "6", width: "18", height: "14", rx: "2" }),
            React.createElement("path", { d: "M3 10h18M9 6V3h6v3" })),
        file: React.createElement("g", null,
            React.createElement("path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }),
            React.createElement("path", { d: "M14 3v5h5" })),
        doc_lines: React.createElement("g", null,
            React.createElement("path", { d: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" }),
            React.createElement("path", { d: "M14 3v5h5M9 13h6M9 17h4" })),
        invoice: React.createElement("g", null,
            React.createElement("path", { d: "M6 3h12v18l-3-2-3 2-3-2-3 2z" }),
            React.createElement("path", { d: "M9 8h6M9 12h6M9 16h3" })),
        container: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "6", width: "18", height: "12", rx: "1" }),
            React.createElement("path", { d: "M7 6v12M11 6v12M15 6v12M19 6v12" })),
        truck: React.createElement("g", null,
            React.createElement("path", { d: "M3 7h11v10H3zM14 10h4l3 3v4h-7z" }),
            React.createElement("circle", { cx: "7", cy: "18", r: "2" }),
            React.createElement("circle", { cx: "17", cy: "18", r: "2" })),
        globe: React.createElement("g", null,
            React.createElement("circle", { cx: "12", cy: "12", r: "9" }),
            React.createElement("path", { d: "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" })),
        image: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
            React.createElement("circle", { cx: "9", cy: "9", r: "1.7" }),
            React.createElement("path", { d: "M21 16l-5-5-9 9" })),
        camera: React.createElement("g", null,
            React.createElement("path", { d: "M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" }),
            React.createElement("circle", { cx: "12", cy: "13", r: "3.5" })),
        upload: React.createElement("g", null,
            React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v13" })),
        save: React.createElement("g", null,
            React.createElement("path", { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" }),
            React.createElement("path", { d: "M7 3v6h8V3M7 21v-8h10v8" })),
        download: React.createElement("g", null,
            React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" })),
        info: React.createElement("g", null,
            React.createElement("circle", { cx: "12", cy: "12", r: "9" }),
            React.createElement("path", { d: "M12 8h.01M11 12h1v5h1" })),
        help: React.createElement("g", null,
            React.createElement("circle", { cx: "12", cy: "12", r: "9" }),
            React.createElement("path", { d: "M9.5 9.5a2.5 2.5 0 1 1 4 2c-.8.5-1.5 1-1.5 2" }),
            React.createElement("path", { d: "M12 17h.01" })),
        bell: React.createElement("g", null,
            React.createElement("path", { d: "M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16zM10 21a2 2 0 0 0 4 0" })),
        home: React.createElement("g", null,
            React.createElement("path", { d: "M3 11l9-8 9 8M5 10v10h14V10" })),
        list: React.createElement("g", null,
            React.createElement("path", { d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" })),
        grid: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "3", width: "7", height: "7" }),
            React.createElement("rect", { x: "14", y: "3", width: "7", height: "7" }),
            React.createElement("rect", { x: "3", y: "14", width: "7", height: "7" }),
            React.createElement("rect", { x: "14", y: "14", width: "7", height: "7" })),
        settings: React.createElement("g", null,
            React.createElement("circle", { cx: "12", cy: "12", r: "3" }),
            React.createElement("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" })),
        calendar: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }),
            React.createElement("path", { d: "M3 9h18M8 3v4M16 3v4" })),
        pencil: React.createElement("g", null,
            React.createElement("path", { d: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" })),
        trash: React.createElement("g", null,
            React.createElement("path", { d: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" })),
        eye: React.createElement("g", null,
            React.createElement("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" }),
            React.createElement("circle", { cx: "12", cy: "12", r: "3" })),
        alert: React.createElement("g", null,
            React.createElement("path", { d: "M12 2L1 21h22z" }),
            React.createElement("path", { d: "M12 9v5M12 18h.01" })),
        sparkles: React.createElement("g", null,
            React.createElement("path", { d: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" }),
            React.createElement("path", { d: "M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z" })),
        play: React.createElement("path", { d: "M6 4l14 8-14 8z" }),
        menu: React.createElement("path", { d: "M3 6h18M3 12h18M3 18h18" }),
        panel_right: React.createElement("g", null,
            React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }),
            React.createElement("path", { d: "M14 3v18" })),
        package: React.createElement("g", null,
            React.createElement("path", { d: "M21 16V8l-9-5-9 5v8l9 5z" }),
            React.createElement("path", { d: "M3.3 7L12 12l8.7-5M12 22V12" })),
        location: React.createElement("g", null,
            React.createElement("path", { d: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z" }),
            React.createElement("circle", { cx: "12", cy: "10", r: "3" })),
        anchor: React.createElement("g", null,
            React.createElement("circle", { cx: "12", cy: "5", r: "2" }),
            React.createElement("path", { d: "M12 7v15M5 16a7 7 0 0 0 14 0M3 16h4M17 16h4" })),
        bookmark: React.createElement("path", { d: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" }),
        flag: React.createElement("g", null,
            React.createElement("path", { d: "M4 21V4M4 4h12l-2 4 2 4H4" })),
        prop_one: React.createElement("g", null,
            React.createElement("path", { d: "M12 4v11" }),
            React.createElement("path", { d: "M7 11l5 5 5-5" }),
            React.createElement("path", { d: "M5 21h14", strokeOpacity: "0.5" })),
        prop_all: React.createElement("g", null,
            React.createElement("path", { d: "M12 3v7" }),
            React.createElement("path", { d: "M7 7l5 5 5-5" }),
            React.createElement("path", { d: "M7 14l5 5 5-5" })),
        arrow_down: React.createElement("path", { d: "M12 5v14M6 13l6 6 6-6" }),
    };
    return React.createElement("svg", { ...common }, P[name] || P.info);
};
window.Icon = Icon;
// ===== src/data.jsx =====
/* global React */
// Mock data — represents a real Proforma in mid-fill state
const MOCK_PROFORMA = {
    vendor: 'YUNFU JINQI STONE CO., LTD.',
    vendor_country: 'China',
    po_name: 'PO-2026/0418',
    picking_name: 'WH/IN/02418',
    payload_currency: 'USD',
    globals: {
        proforma_number: 'PI-9920-A',
        invoice_global: '',
        payment_terms: 'T/T 30% advance, 70% B/L copy',
        country_origin: 'China',
        port_origin: 'Shanghai',
        port_destination: 'Manzanillo',
        incoterm: 'CIF',
        general_notes: '',
    },
    // Requested products (from the PO)
    products: [
        { id: 'p1', name: 'Calacatta Gold Polished', ref: 'CG-POL-20', kind: 'placa', requested_qty: 240, unit: 'placa', dim_text: '320×160×2cm' },
        { id: 'p2', name: 'Statuario Venato Honed', ref: 'SV-HON-20', kind: 'placa', requested_qty: 120, unit: 'placa', dim_text: '320×160×2cm' },
        { id: 'p3', name: 'Carrara Bianco 60×60 Tile', ref: 'CB-T60', kind: 'formato', requested_qty: 480, unit: 'caja', dim_text: '60×60×2cm' },
    ],
    shipments: [
        {
            id: 's1',
            number: 1,
            type: 'maritime',
            shipping_line: 'COSCO Shipping Lines',
            vessel: 'COSCO TAICANG / 042E',
            etd: '2026-06-12',
            eta: '2026-07-04',
            status: 'booked',
            notes: '',
            bl_number: 'COSU6817042500',
            bl_date: '2026-06-13',
            bl_file: 'BL-COSU6817042500.pdf',
            invoices: [
                { id: 'inv1', number: 'JQ-INV-2026-088', date: '2026-06-10', amount: 62400, currency: 'USD', scope: 'full', containers: [] },
                { id: 'inv2', number: 'JQ-INV-2026-089', date: '2026-06-11', amount: 28800, currency: 'USD', scope: 'specific', containers: ['c1'] },
            ],
            containers: [
                { id: 'c1', number: 'COSU6817042', seal: 'CN8821044', type: '40HQ', weight: 27500, volume: 67.2, packages: 12 },
                { id: 'c2', number: 'COSU6817043', seal: 'CN8821045', type: '40HQ', weight: 26800, volume: 67.2, packages: 11 },
            ],
            packings: [
                {
                    id: 'pk1', number: 'PK-2026-088-A', date: '2026-06-10',
                    products: ['p1'],
                    blocks: [
                        { id: 'b1', name: 'B-2024-117', count: 18, photo: true, product: 'p1' },
                        { id: 'b2', name: 'B-2024-118', count: 16, photo: true, product: 'p1' },
                        { id: 'b3', name: 'B-2024-119', count: 14, photo: false, product: 'p1' },
                    ],
                    rows_filled: 38,
                    rows_total: 48,
                },
                {
                    id: 'pk2', number: 'PK-2026-088-B', date: '2026-06-11',
                    products: ['p2'],
                    blocks: [
                        { id: 'b4', name: 'B-2024-204', count: 12, photo: true, product: 'p2' },
                    ],
                    rows_filled: 0,
                    rows_total: 12,
                },
            ],
            documents: [
                { id: 'd1', name: 'Certificate-of-Origin.pdf', kind: 'CO', size: 248120, uploaded: '2026-06-08' },
                { id: 'd2', name: 'Fumigation-Cert.pdf', kind: 'PHYTO', size: 132002, uploaded: '2026-06-08' },
            ],
        },
        {
            id: 's2',
            number: 2,
            type: 'maritime',
            shipping_line: 'MSC',
            vessel: 'MSC LORETO / 326W',
            etd: '2026-07-04',
            eta: '2026-07-28',
            status: 'in_production',
            notes: '',
            bl_number: '',
            bl_date: '',
            bl_file: '',
            invoices: [
                { id: 'inv3', number: 'JQ-INV-2026-092', date: '', amount: 0, currency: 'USD', scope: 'full', containers: [] },
            ],
            containers: [
                { id: 'c3', number: '', seal: '', type: '40HQ', weight: 0, volume: 0, packages: 0 },
            ],
            packings: [],
            documents: [],
        },
        {
            id: 's3',
            number: 3,
            type: '',
            shipping_line: '', vessel: '', etd: '', eta: '', status: 'draft', notes: '',
            bl_number: '', bl_date: '', bl_file: '',
            invoices: [], containers: [], packings: [], documents: [],
        },
    ],
};
// Sample slab rows for packing pk1, block b1 (used in spreadsheet view)
const SAMPLE_ROWS = [
    // Block 1 — 6 slabs of 18 filled, demo subset
    { id: 'r1', block: 'B-2024-117', atado: 'A-01', plate: 'P-001', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r2', block: 'B-2024-117', atado: 'A-01', plate: 'P-002', ref: 'CG-POL-20', thickness: 2, h: 3.20, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r3', block: 'B-2024-117', atado: 'A-01', plate: 'P-003', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.58, notes: 'edge chip', container: 'COSU6817042', photo: false, errors: [] },
    { id: 'r4', block: 'B-2024-117', atado: 'A-01', plate: 'P-004', ref: 'CG-POL-20', thickness: 2, h: 0, w: 1.60, notes: '', container: 'COSU6817042', photo: false, errors: ['Falta alto'] },
    { id: 'r5', block: 'B-2024-117', atado: 'A-01', plate: 'P-005', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r6', block: 'B-2024-117', atado: 'A-01', plate: 'P-006', ref: 'CG-POL-20', thickness: 2, h: 3.20, w: 1.60, notes: '', container: '', photo: true, errors: ['Asignar contenedor'] },
    // Block 2
    { id: 'r7', block: 'B-2024-118', atado: 'A-02', plate: 'P-007', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r8', block: 'B-2024-118', atado: 'A-02', plate: 'P-008', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r9', block: 'B-2024-118', atado: 'A-02', plate: 'P-009', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true, errors: [] },
    { id: 'r10', block: 'B-2024-118', atado: 'A-02', plate: 'P-010', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817043', photo: false, errors: [] },
    // Block 3 (empty)
    { id: 'r11', block: 'B-2024-119', atado: 'A-03', plate: 'P-011', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto', 'Falta largo', 'Asignar contenedor'] },
    { id: 'r12', block: 'B-2024-119', atado: 'A-03', plate: 'P-012', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto', 'Falta largo', 'Asignar contenedor'] },
];
// Sections used in sidebar / overview
const SECTIONS = [
    { id: 'overview', label: 'Vista general', icon: 'home' },
    { id: 'globals', label: 'Datos de la Proforma', icon: 'globe' },
    { id: 'shipments', label: 'Embarques', icon: 'ship', children: true },
    { id: 'documents', label: 'Documentos generales', icon: 'doc_lines' },
    { id: 'review', label: 'Revisar y enviar', icon: 'flag' },
];
// Compute per-section completion
function computeStatus(proforma) {
    const g = proforma.globals;
    const required = ['proforma_number'];
    const filled = required.filter(k => (g[k] || '').toString().trim().length > 0).length;
    const globals_pct = Math.round(filled / required.length * 100);
    const globals_status = globals_pct === 100 ? 'done' : globals_pct > 0 ? 'partial' : 'todo';
    const shipments_status = proforma.shipments.map(s => {
        const hasLog = s.type && s.shipping_line && s.etd;
        const hasBL = !!s.bl_number;
        const hasInv = s.invoices.length > 0 && s.invoices.every(i => i.number && i.amount);
        const hasContainers = s.containers.length > 0 && s.containers.every(c => c.number);
        const hasPacking = s.packings.length > 0 && s.packings.every(p => p.rows_filled >= p.rows_total);
        const score = [hasLog, hasBL, hasInv, hasContainers, hasPacking].filter(Boolean).length;
        return {
            id: s.id,
            pct: Math.round(score / 5 * 100),
            status: score === 5 ? 'done' : score > 0 ? 'partial' : 'todo',
            tabs: { hasLog, hasBL, hasInv, hasContainers, hasPacking },
        };
    });
    const ship_done = shipments_status.filter(s => s.status === 'done').length;
    const ship_pct = proforma.shipments.length === 0 ? 0
        : Math.round(shipments_status.reduce((a, b) => a + b.pct, 0) / shipments_status.length);
    const ship_overall = ship_pct === 100 ? 'done' : ship_pct > 0 ? 'partial' : 'todo';
    const overall = Math.round((globals_pct + ship_pct) / 2);
    return { globals_pct, globals_status, ship_pct, ship_overall, ship_done, shipments_status, overall };
}
window.MOCK_PROFORMA = MOCK_PROFORMA;
window.SAMPLE_ROWS = SAMPLE_ROWS;
window.SECTIONS = SECTIONS;
window.computeStatus = computeStatus;
// ===== src/i18n.jsx =====
/* global React */
// Comprehensive i18n — uses Spanish strings as lookup keys so EVERY hard-coded
// label in JSX gets auto-translated via a React.createElement monkey-patch.

const I18N = {
  es: { portal: 'Portal del Proveedor', welcome_back: 'Bienvenido de vuelta', welcome_first: 'Bienvenido', progress: 'Progreso', completed: 'completado', next_action: 'Siguiente paso recomendado', save: 'Guardar', saved: 'Cambios guardados', autosaving: 'Guardando…', cancel: 'Cancelar', continue: 'Continuar', back: 'Atrás', next: 'Siguiente', add: 'Agregar', delete: 'Eliminar', edit: 'Editar', open: 'Abrir', upload_photo: 'Subir foto', upload_doc: 'Subir documento', purchase_order: 'Orden de Compra', receipt: 'Recepción', vendor: 'Proveedor', optional: 'opcional', required: 'obligatorio', show_guide: 'Mostrar guía', hide_guide: 'Ocultar guía', help: 'Ayuda' },
  en: { portal: 'Supplier Portal', welcome_back: 'Welcome back', welcome_first: 'Welcome', progress: 'Progress', completed: 'complete', next_action: 'Next recommended step', save: 'Save', saved: 'Changes saved', autosaving: 'Saving…', cancel: 'Cancel', continue: 'Continue', back: 'Back', next: 'Next', add: 'Add', delete: 'Delete', edit: 'Edit', open: 'Open', upload_photo: 'Upload photo', upload_doc: 'Upload document', purchase_order: 'Purchase Order', receipt: 'Receipt', vendor: 'Vendor', optional: 'optional', required: 'required', show_guide: 'Show guide', hide_guide: 'Hide guide', help: 'Help' },
  zh: { portal: '供应商门户', welcome_back: '欢迎回来', welcome_first: '欢迎', progress: '进度', completed: '已完成', next_action: '下一步建议', save: '保存', saved: '已保存', autosaving: '保存中…', cancel: '取消', continue: '继续', back: '返回', next: '下一步', add: '添加', delete: '删除', edit: '编辑', open: '打开', upload_photo: '上传照片', upload_doc: '上传文件', purchase_order: '采购订单', receipt: '收货单', vendor: '供应商', optional: '可选', required: '必填', show_guide: '显示指南', hide_guide: '隐藏指南', help: '帮助' },
  it: { portal: 'Portale Fornitore', welcome_back: 'Bentornato', welcome_first: 'Benvenuto', progress: 'Avanzamento', completed: 'completato', next_action: 'Prossimo passo consigliato', save: 'Salva', saved: 'Modifiche salvate', autosaving: 'Salvataggio…', cancel: 'Annulla', continue: 'Continua', back: 'Indietro', next: 'Avanti', add: 'Aggiungi', delete: 'Elimina', edit: 'Modifica', open: 'Apri', upload_photo: 'Carica foto', upload_doc: 'Carica documento', purchase_order: 'Ordine di Acquisto', receipt: 'Ricezione', vendor: 'Fornitore', optional: 'opzionale', required: 'obbligatorio', show_guide: 'Mostra guida', hide_guide: 'Nascondi guida', help: 'Aiuto' },
  pt: { portal: 'Portal do Fornecedor', welcome_back: 'Bem-vindo de volta', welcome_first: 'Bem-vindo', progress: 'Progresso', completed: 'concluído', next_action: 'Próximo passo recomendado', save: 'Salvar', saved: 'Alterações salvas', autosaving: 'Salvando…', cancel: 'Cancelar', continue: 'Continuar', back: 'Voltar', next: 'Próximo', add: 'Adicionar', delete: 'Excluir', edit: 'Editar', open: 'Abrir', upload_photo: 'Enviar foto', upload_doc: 'Enviar documento', purchase_order: 'Pedido de Compra', receipt: 'Recebimento', vendor: 'Fornecedor', optional: 'opcional', required: 'obrigatório', show_guide: 'Mostrar guia', hide_guide: 'Ocultar guia', help: 'Ajuda' },
};

// String-keyed dictionary. Source = Spanish. Each entry maps the exact ES string
// shown in JSX to its translation. The monkey-patch on React.createElement looks
// strings up here at render time, so any new ES string lands here and propagates.
const TR = {
  en: {
    // Generic words / status
    'Cancelar': 'Cancel', 'Continuar': 'Continue', 'Atrás': 'Back', 'Anterior': 'Previous', 'Siguiente': 'Next', 'Saltar': 'Skip', 'Empezar': 'Get started', 'Guardar': 'Save', 'Editar': 'Edit', 'Eliminar': 'Delete', 'Subir': 'Upload', 'Cerrar': 'Close', 'Volver': 'Back', 'Abrir': 'Open', 'Ayuda': 'Help', 'Tutorial': 'Tutorial', 'Tutorial inicial': 'Initial tutorial', 'Aplicar': 'Apply', 'Generar ': 'Generate ',
    'completo': 'complete', 'completado': 'completed', 'listo': 'done', 'Pendiente': 'Pending', 'opcional': 'optional', 'obligatorio': 'required', 'Opcional': 'Optional', 'Sin datos': 'No data', 'Solicitado': 'Requested',
    'Embarques': 'Shipments', 'Embarque #': 'Shipment #', 'Embarque no encontrado': 'Shipment not found', 'embarques': 'shipments', 'contenedores': 'containers', 'invoices': 'invoices', 'bloques': 'blocks', 'cantidad solicitada': 'requested quantity',
    // Header / nav
    'Portal proveedor': 'Supplier portal', 'Menú': 'Menu', 'Mostrar guía': 'Show guide', 'Ocultar guía': 'Hide guide',
    // Sidebar / sections
    'Vista general': 'Overview', 'Datos de la Proforma': 'Proforma data', 'Datos generales de la Proforma': 'Proforma general data', 'Documentos generales': 'General documents', 'Documentos': 'Documents', 'Revisar y enviar': 'Review and submit', 'Revisar y enviar a SOM GROUP': 'Review and send to SOM GROUP', 'Llenado de la Proforma': 'Proforma fill', 'Progreso global': 'Overall progress', 'Lo que te falta para terminar': 'What you have left',
    // Overview / hero
    'Bienvenido al portal del proveedor': 'Welcome to the supplier portal', 'Bienvenido al portal SOM GROUP': 'Welcome to the SOM GROUP portal', 'Hola, equipo de ': 'Hello, team at ', 'Aquí vas a registrar todos los datos del envío para la Orden de Compra ': 'Here you will register all the shipment data for Purchase Order ', 'Continuar donde quedé': 'Continue where I left off', 'Productos solicitados en esta PO': 'Products requested in this PO', 'Productos solicitados en esta Proforma': 'Products requested in this Proforma', 'Productos': 'Products', 'Producto': 'Product', 'Estado actual': 'Current status',
    // Globals form
    'Identificación': 'Identification', 'Cómo identifica este lote tu sistema y el nuestro.': 'How your system and ours identify this batch.', 'Número de Proforma': 'Proforma Number', 'Es el número con el que tu sistema identifica esta venta (Proforma Invoice).': 'The number your system uses to identify this sale (Proforma Invoice).', 'Origen → Destino': 'Origin → Destination', 'Ruta y términos del envío. Estos datos van impresos en la documentación de aduanas.': 'Shipment route and terms. This information is printed on customs documentation.', 'País de origen': 'Country of origin', 'País desde donde sale la mercancía.': 'Country the goods leave from.', 'Puerto de origen': 'Port of origin', 'Puerto marítimo o aeropuerto desde donde zarpa el embarque.': 'Sea port or airport where the shipment departs.', 'Puerto destino': 'Destination port', 'El puerto mexicano donde llegará el embarque.': 'The Mexican port where the shipment will arrive.', 'Incoterm': 'Incoterm', 'Incoterm:': 'Incoterm:', 'Define qué parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no estás seguro, pregunta a tu contacto de SOM GROUP.': 'Defines which party (supplier or customer) covers transport, insurance and customs. If unsure, ask your SOM GROUP contact.', 'CIF = tú pagas hasta el puerto destino, incluyendo seguro': 'CIF = you pay up to the destination port, including insurance', 'Ej: CIF = tú pagas hasta el puerto destino': 'E.g. CIF = you pay up to the destination port', 'Cómo y cuándo te van a pagar.': 'How and when you will be paid.', 'Condiciones de pago': 'Payment terms', 'Factura global': 'Global invoice', 'Si emites una factura comercial que cubre toda la PO, escríbela aquí. Si tienes una por embarque, déjalo vacío y llénalo en cada embarque.': 'If you issue one commercial invoice covering the whole PO, write it here. If you have one per shipment, leave it empty and fill it in each shipment.', 'Observaciones generales': 'General notes', 'Observaciones': 'Notes', 'Esto se incluirá en la confirmación final. Puedes dejarlo vacío si no aplica.': 'This will be included in the final confirmation. You can leave it empty if it does not apply.', 'Continuar a embarques': 'Continue to shipments', 'Ej: PI-9920-A': 'E.g. PI-9920-A', 'Ej. China': 'E.g. China', 'Ej. Shanghai': 'E.g. Shanghai', 'Ej. Manzanillo': 'E.g. Manzanillo', 'Ej: Manzanillo, Veracruz, Lázaro Cárdenas': 'E.g. Manzanillo, Veracruz, Lázaro Cárdenas', 'Ej: Shanghai, Ningbo': 'E.g. Shanghai, Ningbo', 'Ej. T/T 30% advance, 70% B/L copy': 'E.g. T/T 30% advance, 70% B/L copy', 'Ej. Las placas vienen empacadas en bundles de madera dura. Cuidado con esquinas.': 'E.g. Slabs come in hardwood bundles. Mind the corners.', 'Selecciona…': 'Select…',
    // Shipments list / detail
    'Esto es lo que SOM GROUP te pidió. Tendrás que registrar packing list para cada uno.': 'This is what SOM GROUP requested. You will need to register a packing list for each.', 'No hay embarques registrados todavía': 'No shipments registered yet', 'Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.': 'When you know the approximate shipment date, add a shipment and start filling in logistics and packing list.', 'Crear el primer embarque': 'Create first shipment', 'Agregar embarque': 'Add shipment', 'Si tu producción se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque está bien.': 'If your production ships on different dates or ships, create one shipment per case. If everything goes in the same ship, a single shipment is fine.',
    'Sin buque asignado': 'No vessel assigned', 'Sin contenedores': 'No containers', 'Estado': 'Status', 'Tipo': 'Type', 'Tipo de transporte': 'Transport type', 'Marítimo': 'Maritime', 'Aéreo': 'Air', 'Terrestre': 'Land',
    'Eliminar embarque': 'Delete shipment', 'Logística · B/L · Invoices · Contenedores · Packing': 'Logistics · B/L · Invoices · Containers · Packing', 'Logística internacional': 'International logistics', 'Datos de logística': 'Logistics data', 'Información del transporte. La obtienes de tu agente de carga (forwarder).': 'Transport information. Your freight forwarder provides it.', 'Naviera / Aerolínea': 'Carrier / Airline', 'Compañía que opera el transporte.': 'Company operating the transport.', 'Ej. COSCO Shipping Lines': 'E.g. COSCO Shipping Lines', 'COSCO, MSC, Hapag-Lloyd…': 'COSCO, MSC, Hapag-Lloyd…', 'Buque + viaje': 'Vessel + voyage', 'Nombre del buque seguido del número de viaje.': 'Vessel name followed by voyage number.', 'Ej. COSCO TAICANG / 042E': 'E.g. COSCO TAICANG / 042E', 'ETD': 'ETD', 'ETA': 'ETA', 'Estimated Time of Departure — fecha estimada de salida del puerto origen.': 'Estimated Time of Departure — estimated date of departure from the origin port.', 'Estimated Time of Arrival — fecha estimada de llegada al puerto destino.': 'Estimated Time of Arrival — estimated date of arrival at the destination port.', 'Notas internas sobre el viaje.': 'Internal notes about the trip.', 'Ej. Cambio de buque por sobrecupo. Reasignado a TAICANG.': 'E.g. Vessel changed due to overbooking. Reassigned to TAICANG.',
    'Bill of Lading (B/L)': 'Bill of Lading (B/L)', 'El B/L es el documento que prueba que la naviera recibió tu mercancía. Súbelo en cuanto lo recibas — sin él, aduanas no libera el embarque.': 'The B/L is the document proving the carrier received your goods. Upload it as soon as you get it — without it, customs will not release the shipment.', 'Número de B/L': 'B/L Number', 'El número único que asigna la naviera a tu embarque.': 'The unique number the carrier assigns to your shipment.', 'Fecha de B/L': 'B/L Date', 'Fecha que aparece impresa en el documento.': 'Date printed on the document.', 'Archivo PDF': 'PDF file', 'Sube el PDF original. Aceptamos máximo 10 MB.': 'Upload the original PDF. Max 10 MB.', 'Subir PDF': 'Upload PDF',
    'Invoices (Facturas comerciales)': 'Invoices (Commercial)', 'Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores específicos.': 'Create at least one commercial invoice per shipment. You can assign it to the whole shipment or to specific containers.', 'Aún no hay invoices': 'No invoices yet', 'La factura comercial que emites para el embarque. Puede ser una global o varias parciales.': 'The commercial invoice you issue for the shipment. Can be global or several partials.', 'Agregar primer invoice': 'Add first invoice', 'Agregar invoice': 'Add invoice', 'Invoice ': 'Invoice ', 'No. Invoice': 'Invoice No.', 'Identifica este documento. Suele ser una variante de la invoice.': 'Identifies this document. Usually a variant of the invoice.', 'Ej. JQ-INV-2026-088': 'E.g. JQ-INV-2026-088', 'Fecha': 'Date', 'Monto + moneda': 'Amount + currency', 'Total facturado en este embarque': 'Total invoiced in this shipment', 'Total invoices': 'Total invoices',
    'Contenedores': 'Containers', 'Contenedor': 'Container', 'Cada caja física que viaja en el embarque. Los números son los que están pintados en el contenedor (4 letras + 7 dígitos).': 'Each physical box traveling in the shipment. Numbers are those painted on the container (4 letters + 7 digits).', 'Captura los números de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.': 'Enter the container numbers as soon as your agent gives them to you. You need them before the packing list.', 'Agregar primer contenedor': 'Add first container', 'Agregar contenedor': 'Add container', 'No. Contenedor': 'Container No.', 'No. de Sello': 'Seal No.', 'Sello de seguridad que se rompe al abrir el contenedor.': 'Security seal that breaks when opening the container.', 'Peso bruto (kg)': 'Gross weight (kg)', 'Volumen (m³)': 'Volume (m³)', 'No. de paquetes / bultos': 'Packages / bundles', 'Dimensión': 'Dimensions', 'Contenedor sin número': 'Container without number',
    'Packing Lists': 'Packing Lists', 'Nuevo packing': 'New packing', 'Sin packing lists todavía': 'No packing lists yet', 'Aquí registras placa por placa (o pieza por pieza) lo que va en cada contenedor. ': 'Here you register slab by slab (or piece by piece) what goes in each container. ', 'Es la parte más detallada.': 'It is the most detailed part.', 'Empezar con el asistente': 'Start with the wizard', 'Cómo funciona el asistente': 'How the wizard works', 'El asistente te llevará paso a paso: ': 'The wizard guides you step by step: ', 'En lugar de que escribas mil líneas a mano, el asistente ': 'Instead of writing a thousand lines by hand, the wizard ', 'genera las filas automáticamente': 'auto-generates the rows', 'Tip: el packing list es lo más detallado.': 'Tip: the packing list is the most detailed.', 'Fecha del Packing': 'Packing date', 'No. del Packing': 'Packing No.',
    // Wizard steps
    'Bloque': 'Block', 'Bloques configurados': 'Configured blocks', 'Atado': 'Bundle', 'No. Placa': 'Slab No.', 'Grosor cm': 'Thickness cm', 'Alto m': 'Height m', 'Largo m': 'Length m', 'Foto': 'Photo', 'Notas': 'Notes', 'Referencia': 'Reference', 'Placas / piezas': 'Slabs / pieces', 'Crear primer bloque': 'Create first block', 'Sin bloques aún': 'No blocks yet', 'Empieza con uno. Puedes agregar tantos como necesites.': 'Start with one. You can add as many as needed.', 'Agregar bloque': 'Add block', 'Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generará automáticamente 48 filas para llenar.': 'A block is the original quarry stone, before being cut. Multiple slabs come from each block. If you have 3 blocks with 18, 16 and 14 slabs, this step will auto-generate 48 rows to fill.', 'Antes de capturar placa por placa, vas a configurar los ': 'Before entering slab by slab, you will configure the ', 'Puedes continuar y subirlas después, pero el packing list no se considerará completo hasta que cada bloque tenga al menos una foto.': 'You can continue and upload them later, but the packing list will not be considered complete until each block has at least one photo.', 'Estructura del packing': 'Packing structure', 'Filas a generar': 'Rows to generate', 'Ajustar bloques': 'Adjust blocks', 'Listo, volver al embarque': 'Done, back to shipment', 'Iniciar llenado': 'Start filling', 'Paso ': 'Step ', 'Ordenados de lo más fácil a lo más detallado. Comienza por el primero.': 'Sorted from easiest to most detailed. Start with the first.',
    // Packing sheet
    'Llena más rápido con propagación': 'Fill faster with propagation', 'Pasa el cursor sobre cualquier celda y verás ': 'Hover over any cell and you will see ', 'dos íconos a la derecha': 'two icons to the right', 'copia el valor a la siguiente fila del mismo bloque ·': 'copies the value to the next row in the same block ·', 'copia a todas las filas debajo en el mismo bloque. También puedes copiar/pegar desde Excel y usar ': 'copies to all rows below in the same block. You can also copy/paste from Excel and use ', ' entre celdas.': ' between cells.', 'Copiar a la siguiente fila del mismo bloque': 'Copy to next row in same block', 'Copiar a TODAS las filas del mismo bloque (abajo)': 'Copy to ALL rows in same block (below)', 'Todas (': 'All (', 'Errores (': 'Errors (', 'Sin dimensiones': 'No dimensions', 'con errores': 'with errors', 'Exportar CSV': 'Export CSV', 'Pegar de Excel': 'Paste from Excel', 'Pegar desde Excel': 'Paste from Excel',
    'Copia el rango en Excel (con o sin la fila de headers) y pégalo aquí con ': 'Copy the range in Excel (with or without header row) and paste it here with ', 'Aplicar a ': 'Apply to ', 'Columnas que se aplicarán: ': 'Columns to apply: ', 'No se detectaron filas válidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).': 'No valid rows detected. Make sure you pasted from Excel (tab-separated cells).',
    // Documents
    'Documentos del embarque': 'Shipment documents', 'Sube los documentos legales y de calidad que acompañan este embarque.': 'Upload the legal and quality documents that accompany this shipment.', 'Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque.': 'Documents that apply to the whole Proforma (not a specific shipment). Per-shipment documents live inside each shipment.', 'Arrastra tus archivos aquí': 'Drag your files here', 'PDF, JPG, PNG · máximo 10 MB por archivo · o ': 'PDF, JPG, PNG · max 10 MB per file · or ', 'elige desde tu computadora': 'choose from your computer', 'Subir foto': 'Upload photo',
    // Review
    'Checklist final': 'Final checklist', 'Verifica que cada sección esté completa.': 'Check that each section is complete.', 'Resumen general': 'Overview', 'Aún no puedes marcar como completa': 'You cannot mark as complete yet', 'Corrige los puntos resaltados abajo para poder continuar.': 'Fix the points highlighted below to continue.', 'Termina los puntos pendientes del checklist. Puedes seguir trabajando — tus datos se guardan automáticamente.': 'Finish the pending checklist items. You can keep working — your data is auto-saved.', 'Al marcar como completa, SOM GROUP recibirá un correo automático.': 'When marked complete, SOM GROUP will get an automatic email.', 'Datos que se enviarán como confirmación.': 'Data that will be sent as confirmation.', 'Aún sin buque ni naviera. Empieza por la pestaña de Logística.': 'No vessel or carrier yet. Start with the Logistics tab.',
    // Guide panel
    'Guía del paso actual': 'Current step guide', 'Guía': 'Guide', 'Guía del embarque': 'Shipment guide', 'Antes de enviar': 'Before submitting',
    // Tweaks
    'Idioma & branding': 'Language & branding', 'Idioma': 'Language', 'Acento': 'Accent', 'Densidad': 'Density', 'Cómoda': 'Comfortable', 'Compacta': 'Compact', 'Guía y onboarding': 'Guide & onboarding', 'Panel guía a la derecha': 'Guide panel on the right', 'Mostrar onboarding ahora': 'Show onboarding now', 'Validación': 'Validation', 'Estilo cuando hay errores': 'Error style', 'Suave — solo inline en cada campo': 'Soft — inline on each field only', 'Inline + banner sticky resumen': 'Inline + sticky summary banner', 'Bloquear avance hasta corregir': 'Block until corrected', 'Estado simulado': 'Simulated state', 'Mostrar todo completado': 'Show everything completed', 'Close tweaks': 'Close tweaks', 'Tweaks': 'Tweaks', 'Density': 'Density', 'Dark mode': 'Dark mode', 'Theme': 'Theme', 'Palette': 'Palette', 'Typography': 'Typography', 'Font size': 'Font size', 'Thumbnail rail': 'Thumbnail rail',
    // Onboarding
    '¡Bienvenido al portal!': 'Welcome to the portal!', 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.': 'Here you will register the shipment data for SOM GROUP. We will guide you step by step. You do not have to finish in one go.', 'Tu progreso siempre visible': 'Your progress always visible', 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.': 'On the left you will see each section progress with visual marks: green = done, amber = in progress, gray = pending.', 'Datos generales': 'General data', 'Embarque #1': 'Shipment #1', 'Embarque #2': 'Shipment #2', 'Ayuda contextual en cada campo': 'Contextual help on each field', 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.': 'You will see a "?" icon next to confusing fields. Hover for an explanation with example.', ' define quién paga el transporte y seguro. ': ' defines who pays transport and insurance. ', 'El packing list es asistido': 'The packing list is assisted', 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.': 'Instead of writing hundreds of lines, we ask how many blocks you load and how many slabs each has. We generate the rows for you.', '1. Productos': '1. Products', '2. Bloques + fotos': '2. Blocks + photos', '3. Revisión': '3. Review', '4. Llenar placas': '4. Fill slabs', '¿Listo para empezar?': 'Ready to start?', 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.': 'Let us start with general data. If you get stuck, look for the "Current step guide" panel on the right — it always tells you what to do.', ' de ': ' of ',
    // Guide panel
    'Tu llenado en 4 etapas': 'Your fill in 4 stages', 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.': 'We recommend following this order. You can skip to another section if needed.', 'Una sola vez al inicio. Identificación de la Proforma, puertos e incoterm.': 'One time at the start. Proforma identification, ports and incoterm.', 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.': 'Create one or several. Each with logistics, B/L, invoices, containers and packing.', 'Sube certificados de calidad y otros papeles generales.': 'Upload quality certificates and other general papers.', 'Última verificación y notificación a SOM GROUP.': 'Final verification and notification to SOM GROUP.', 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.': 'This section defines identity and route. If unsure, ask your agent or leave empty and come back later.', 'Es el ID que tu sistema usa. Suele comenzar con "PI-".': 'The ID your system uses. Usually starts with "PI-".', 'Origen y destino': 'Origin and destination', 'País y puerto de salida + puerto donde llegará.': 'Country and origin port + destination port.', 'Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP.': 'Defines who pays what. Agreed with your SOM GROUP contact.', 'Pagos y notas': 'Payments and notes', 'Términos de pago y observaciones generales.': 'Payment terms and general notes.', 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.': 'A shipment = a trip. Split the PO into several shipments if production ships on different dates.', 'Agrega un embarque': 'Add a shipment', 'Hazlo en cuanto tengas el buque o vuelo asignado.': 'Do it as soon as you have the vessel or flight assigned.', 'Llena las 5 secciones': 'Fill the 5 sections', 'Logística, B/L, invoices, contenedores y packing list.': 'Logistics, B/L, invoices, containers and packing list.', 'Sube documentos': 'Upload documents', 'Certificado de origen, fitosanitario, etc.': 'Certificate of origin, phytosanitary, etc.', 'Captura por pestañas': 'Capture by tabs', 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.': 'Follow tabs left to right. The packing list is the most detailed — leave it for last.', 'Logística + B/L': 'Logistics + B/L', 'Naviera, buque, fechas y el documento B/L.': 'Carrier, vessel, dates and the B/L document.', 'Invoices': 'Invoices', 'Factura(s) comercial(es). Puede ser una global o varias parciales.': 'Commercial invoice(s). Can be global or several partials.', 'Los números físicos pintados en cada contenedor.': 'The physical numbers painted on each container.', 'Packing list': 'Packing list', 'Asistente paso a paso. Captura placa por placa.': 'Step-by-step wizard. Slab by slab capture.', 'CO, fitosanitario, inspección.': 'CO, phytosanitary, inspection.', 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.': 'Documents that apply to the whole Proforma. Accepts PDF, JPG, PNG up to 10 MB.', 'Proforma firmada': 'Signed Proforma', 'La que enviaste a SOM GROUP con firma.': 'The one you sent SOM GROUP signed.', 'Certificados de calidad': 'Quality certificates', 'Pruebas técnicas: mineralogía, densidad, absorción.': 'Technical tests: mineralogy, density, absorption.', 'Fotos del producto': 'Product photos', 'Catálogo o muestras a granel.': 'Catalog or bulk samples.', 'Verifica todo': 'Verify everything', 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.': 'Once marked complete, SOM GROUP receives a notification. To edit later, ask your contact.', 'Datos clave que se enviarán.': 'Key data that will be sent.', 'Checklist por sección': 'Checklist by section', 'Si algo está en ámbar, vuelve a esa sección.': 'If something is amber, go back to that section.', 'Marcar como completa': 'Mark as complete', 'Solo se habilita cuando todo está en verde.': 'Only enabled when everything is green.', 'mapa de ruta': 'route map', 'ilustración guía': 'guide illustration',
    // Sidebar
    'Todo listo': 'All done', 'En proceso': 'In progress', '% completado': '% complete', 'PI sin número': 'PI without number',
  },
  zh: {
    'Cancelar': '取消', 'Continuar': '继续', 'Atrás': '返回', 'Anterior': '上一步', 'Siguiente': '下一步', 'Saltar': '跳过', 'Empezar': '开始', 'Guardar': '保存', 'Editar': '编辑', 'Eliminar': '删除', 'Subir': '上传', 'Cerrar': '关闭', 'Volver': '返回', 'Abrir': '打开', 'Ayuda': '帮助', 'Tutorial': '教程', 'Tutorial inicial': '初始教程', 'Aplicar': '应用', 'Generar ': '生成 ',
    'completo': '完成', 'completado': '已完成', 'listo': '已就绪', 'Pendiente': '待处理', 'opcional': '可选', 'obligatorio': '必填', 'Opcional': '可选', 'Sin datos': '无数据', 'Solicitado': '已请求',
    'Embarques': '货运', 'Embarque #': '货运 #', 'Embarque no encontrado': '未找到货运', 'embarques': '货运', 'contenedores': '集装箱', 'invoices': '发票', 'bloques': '区块', 'cantidad solicitada': '请求数量',
    'Portal proveedor': '供应商门户', 'Menú': '菜单', 'Mostrar guía': '显示指南', 'Ocultar guía': '隐藏指南',
    'Vista general': '概览', 'Datos de la Proforma': '形式发票数据', 'Datos generales de la Proforma': '形式发票一般数据', 'Documentos generales': '一般文档', 'Documentos': '文档', 'Revisar y enviar': '审核并提交', 'Revisar y enviar a SOM GROUP': '审核并发送给 SOM GROUP', 'Llenado de la Proforma': '形式发票填写', 'Progreso global': '总体进度', 'Lo que te falta para terminar': '剩余事项',
    'Bienvenido al portal del proveedor': '欢迎使用供应商门户', 'Bienvenido al portal SOM GROUP': '欢迎使用 SOM GROUP 门户', 'Hola, equipo de ': '您好,', 'Aquí vas a registrar todos los datos del envío para la Orden de Compra ': '在此处录入采购订单的所有发货数据 ', 'Continuar donde quedé': '继续上次进度', 'Productos solicitados en esta PO': '本采购订单请求的产品', 'Productos solicitados en esta Proforma': '本形式发票请求的产品', 'Productos': '产品', 'Producto': '产品', 'Estado actual': '当前状态',
    'Identificación': '识别', 'Cómo identifica este lote tu sistema y el nuestro.': '您的系统和我们的系统如何识别此批次。', 'Número de Proforma': '形式发票编号', 'Es el número con el que tu sistema identifica esta venta (Proforma Invoice).': '您系统识别此销售的编号(形式发票)。', 'Origen → Destino': '起运地 → 目的地', 'Ruta y términos del envío. Estos datos van impresos en la documentación de aduanas.': '运输路线和条款。这些数据将打印在报关文件上。', 'País de origen': '原产国', 'País desde donde sale la mercancía.': '货物起运国家。', 'Puerto de origen': '起运港', 'Puerto marítimo o aeropuerto desde donde zarpa el embarque.': '货运起运的海港或机场。', 'Puerto destino': '目的港', 'El puerto mexicano donde llegará el embarque.': '货运到达的墨西哥港口。', 'Incoterm': '贸易术语', 'Incoterm:': '贸易术语:', 'Define qué parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no estás seguro, pregunta a tu contacto de SOM GROUP.': '定义哪一方(供应商或客户)承担运输、保险和报关。如不确定,请咨询 SOM GROUP 联系人。', 'CIF = tú pagas hasta el puerto destino, incluyendo seguro': 'CIF = 您支付到目的港的费用,包括保险', 'Ej: CIF = tú pagas hasta el puerto destino': '例: CIF = 您支付到目的港的费用', 'Cómo y cuándo te van a pagar.': '付款方式和时间。', 'Condiciones de pago': '付款条件', 'Factura global': '总发票', 'Si emites una factura comercial que cubre toda la PO, escríbela aquí. Si tienes una por embarque, déjalo vacío y llénalo en cada embarque.': '如果您开具覆盖整个采购订单的商业发票,请填写此处。如果每次货运一张,请留空并在每次货运中填写。', 'Observaciones generales': '一般备注', 'Observaciones': '备注', 'Esto se incluirá en la confirmación final. Puedes dejarlo vacío si no aplica.': '这将包含在最终确认中。如不适用可留空。', 'Continuar a embarques': '继续到货运', 'Selecciona…': '选择…',
    'Esto es lo que SOM GROUP te pidió. Tendrás que registrar packing list para cada uno.': '这是 SOM GROUP 向您订购的。您需要为每项登记装箱单。', 'No hay embarques registrados todavía': '尚无货运登记', 'Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.': '当您知道大致发货日期后,添加一个货运并开始录入物流和装箱单。', 'Crear el primer embarque': '创建首个货运', 'Agregar embarque': '添加货运', 'Si tu producción se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque está bien.': '如果您的生产分不同日期或不同船只发运,每个分别创建一个货运。如果都在同一船只,一个货运即可。',
    'Sin buque asignado': '未分配船舶', 'Sin contenedores': '无集装箱', 'Estado': '状态', 'Tipo': '类型', 'Tipo de transporte': '运输类型', 'Marítimo': '海运', 'Aéreo': '空运', 'Terrestre': '陆运',
    'Eliminar embarque': '删除货运', 'Logística · B/L · Invoices · Contenedores · Packing': '物流 · 提单 · 发票 · 集装箱 · 装箱', 'Logística internacional': '国际物流', 'Datos de logística': '物流数据', 'Información del transporte. La obtienes de tu agente de carga (forwarder).': '运输信息。由您的货运代理提供。', 'Naviera / Aerolínea': '船公司 / 航空公司', 'Compañía que opera el transporte.': '运营运输的公司。', 'Buque + viaje': '船舶 + 航次', 'Nombre del buque seguido del número de viaje.': '船舶名称加航次号。', 'Estimated Time of Departure — fecha estimada de salida del puerto origen.': '预计离港时间。', 'Estimated Time of Arrival — fecha estimada de llegada al puerto destino.': '预计到港时间。', 'Notas internas sobre el viaje.': '关于此次航行的内部备注。',
    'Bill of Lading (B/L)': '提单 (B/L)', 'El B/L es el documento que prueba que la naviera recibió tu mercancía. Súbelo en cuanto lo recibas — sin él, aduanas no libera el embarque.': '提单是证明船公司已接收货物的文件。收到后请立即上传 — 没有它海关不会放行。', 'Número de B/L': '提单号', 'El número único que asigna la naviera a tu embarque.': '船公司为您的货运分配的唯一编号。', 'Fecha de B/L': '提单日期', 'Fecha que aparece impresa en el documento.': '文件上打印的日期。', 'Archivo PDF': 'PDF 文件', 'Sube el PDF original. Aceptamos máximo 10 MB.': '上传原始 PDF。最大 10 MB。', 'Subir PDF': '上传 PDF',
    'Invoices (Facturas comerciales)': '发票(商业发票)', 'Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores específicos.': '每次货运至少创建一张商业发票。可分配给整个货运或特定集装箱。', 'Aún no hay invoices': '尚无发票', 'La factura comercial que emites para el embarque. Puede ser una global o varias parciales.': '为货运开具的商业发票。可以是总发票或多张部分发票。', 'Agregar primer invoice': '添加首张发票', 'Agregar invoice': '添加发票', 'No. Invoice': '发票编号', 'Identifica este documento. Suele ser una variante de la invoice.': '识别此文件。通常是发票的变体。', 'Fecha': '日期', 'Monto + moneda': '金额 + 币种', 'Total facturado en este embarque': '本货运开票总额', 'Total invoices': '发票总额',
    'Contenedores': '集装箱', 'Contenedor': '集装箱', 'Cada caja física que viaja en el embarque. Los números son los que están pintados en el contenedor (4 letras + 7 dígitos).': '运输中的每个物理箱体。编号为集装箱上喷涂的(4 字母 + 7 数字)。', 'Captura los números de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.': '代理交付后请立即录入集装箱号。装箱单之前需要。', 'Agregar primer contenedor': '添加首个集装箱', 'Agregar contenedor': '添加集装箱', 'No. Contenedor': '集装箱号', 'No. de Sello': '封条号', 'Sello de seguridad que se rompe al abrir el contenedor.': '打开集装箱时会破坏的安全封条。', 'Peso bruto (kg)': '毛重 (kg)', 'Volumen (m³)': '体积 (m³)', 'No. de paquetes / bultos': '包装件数', 'Dimensión': '尺寸', 'Contenedor sin número': '无编号集装箱',
    'Packing Lists': '装箱单', 'Nuevo packing': '新建装箱单', 'Sin packing lists todavía': '尚无装箱单', 'Aquí registras placa por placa (o pieza por pieza) lo que va en cada contenedor. ': '在此逐板(或逐件)登记每个集装箱的内容。 ', 'Es la parte más detallada.': '是最详细的部分。', 'Empezar con el asistente': '使用向导开始', 'Cómo funciona el asistente': '向导工作原理', 'El asistente te llevará paso a paso: ': '向导将逐步引导您: ', 'En lugar de que escribas mil líneas a mano, el asistente ': '无需手动编写上千行,向导 ', 'genera las filas automáticamente': '自动生成行', 'Tip: el packing list es lo más detallado.': '提示: 装箱单是最详细的部分。', 'Fecha del Packing': '装箱日期', 'No. del Packing': '装箱单号',
    'Bloque': '区块', 'Bloques configurados': '已配置区块', 'Atado': '捆', 'No. Placa': '板号', 'Grosor cm': '厚度 cm', 'Alto m': '高 m', 'Largo m': '长 m', 'Foto': '照片', 'Notas': '备注', 'Referencia': '参考', 'Placas / piezas': '板 / 件', 'Crear primer bloque': '创建首个区块', 'Sin bloques aún': '尚无区块', 'Empieza con uno. Puedes agregar tantos como necesites.': '从一个开始。可按需添加。', 'Agregar bloque': '添加区块', 'Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generará automáticamente 48 filas para llenar.': '区块是切割前的原石。每个区块产生多块板。如有 3 个区块分别 18、16、14 块板,此步骤将自动生成 48 行供填写。', 'Antes de capturar placa por placa, vas a configurar los ': '逐板录入前,您将配置 ', 'Puedes continuar y subirlas después, pero el packing list no se considerará completo hasta que cada bloque tenga al menos una foto.': '可继续并稍后上传,但装箱单只有在每个区块至少有一张照片时才算完成。', 'Estructura del packing': '装箱结构', 'Filas a generar': '生成行数', 'Ajustar bloques': '调整区块', 'Listo, volver al embarque': '完成,返回货运', 'Iniciar llenado': '开始填写', 'Paso ': '步骤 ', 'Ordenados de lo más fácil a lo más detallado. Comienza por el primero.': '从易到详排序。从第一个开始。',
    'Llena más rápido con propagación': '使用传播更快填写', 'Pasa el cursor sobre cualquier celda y verás ': '将光标悬停在任何单元格上,您将看到 ', 'dos íconos a la derecha': '右侧两个图标', 'copia el valor a la siguiente fila del mismo bloque ·': '将值复制到同一区块的下一行 ·', 'copia a todas las filas debajo en el mismo bloque. También puedes copiar/pegar desde Excel y usar ': '复制到同一区块下方所有行。也可从 Excel 复制粘贴并使用 ', ' entre celdas.': ' 在单元格之间。', 'Copiar a la siguiente fila del mismo bloque': '复制到同一区块的下一行', 'Copiar a TODAS las filas del mismo bloque (abajo)': '复制到同一区块的所有下方行', 'Todas (': '全部 (', 'Errores (': '错误 (', 'Sin dimensiones': '无尺寸', 'con errores': '有错误', 'Exportar CSV': '导出 CSV', 'Pegar de Excel': '从 Excel 粘贴', 'Pegar desde Excel': '从 Excel 粘贴',
    'Copia el rango en Excel (con o sin la fila de headers) y pégalo aquí con ': '在 Excel 中复制范围(含或不含标题行)并使用 ', 'Aplicar a ': '应用到 ', 'Columnas que se aplicarán: ': '将应用的列: ', 'No se detectaron filas válidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).': '未检测到有效行。请确认从 Excel 粘贴(制表符分隔)。',
    'Documentos del embarque': '货运文档', 'Sube los documentos legales y de calidad que acompañan este embarque.': '上传随此货运的法律和质量文件。', 'Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque.': '适用于整个形式发票的文档(非特定货运)。按货运的文档在各货运内部。', 'Arrastra tus archivos aquí': '将文件拖到此处', 'PDF, JPG, PNG · máximo 10 MB por archivo · o ': 'PDF、JPG、PNG · 每个文件最大 10 MB · 或 ', 'elige desde tu computadora': '从您的电脑选择', 'Subir foto': '上传照片',
    'Checklist final': '最终检查清单', 'Verifica que cada sección esté completa.': '检查每个部分是否完成。', 'Resumen general': '概览', 'Aún no puedes marcar como completa': '尚不能标记为完成', 'Corrige los puntos resaltados abajo para poder continuar.': '修正下方高亮项目以继续。', 'Termina los puntos pendientes del checklist. Puedes seguir trabajando — tus datos se guardan automáticamente.': '完成检查清单中的待办事项。可继续工作 — 数据自动保存。', 'Al marcar como completa, SOM GROUP recibirá un correo automático.': '标记为完成后,SOM GROUP 将收到自动邮件。', 'Datos que se enviarán como confirmación.': '将作为确认发送的数据。', 'Aún sin buque ni naviera. Empieza por la pestaña de Logística.': '尚无船舶或船公司。请从物流标签开始。',
    'Guía del paso actual': '当前步骤指南', 'Guía': '指南', 'Guía del embarque': '货运指南', 'Antes de enviar': '提交前',
    'Idioma & branding': '语言与品牌', 'Idioma': '语言', 'Acento': '强调色', 'Densidad': '密度', 'Cómoda': '舒适', 'Compacta': '紧凑', 'Guía y onboarding': '指南和引导', 'Panel guía a la derecha': '右侧指南面板', 'Mostrar onboarding ahora': '现在显示引导', 'Validación': '验证', 'Estilo cuando hay errores': '错误样式', 'Suave — solo inline en cada campo': '柔和 — 仅每个字段内联', 'Inline + banner sticky resumen': '内联 + 粘性摘要横幅', 'Bloquear avance hasta corregir': '修正前阻止前进', 'Estado simulado': '模拟状态', 'Mostrar todo completado': '显示全部完成', 'Close tweaks': '关闭调整', 'Tweaks': '调整',
    // Onboarding
    '¡Bienvenido al portal!': '欢迎使用门户!', 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.': '在此处录入 SOM GROUP 的货运数据。我们将逐步引导您。无需一次完成。', 'Tu progreso siempre visible': '您的进度始终可见', 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.': '左侧显示每个部分的进度: 绿色 = 完成, 琥珀色 = 进行中, 灰色 = 待处理。', 'Datos generales': '一般数据', 'Embarque #1': '货运 #1', 'Embarque #2': '货运 #2', 'Ayuda contextual en cada campo': '每个字段的上下文帮助', 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.': '混淆字段旁会显示 "?" 图标。悬停查看解释和示例。', ' define quién paga el transporte y seguro. ': ' 定义谁支付运输和保险费。 ', 'El packing list es asistido': '装箱单为辅助式', 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.': '无需手写数百行,我们会询问您装载几个区块以及每个区块有几块板。我们为您生成行。', '1. Productos': '1. 产品', '2. Bloques + fotos': '2. 区块 + 照片', '3. Revisión': '3. 审核', '4. Llenar placas': '4. 填写板', '¿Listo para empezar?': '准备开始了吗?', 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.': '从一般数据开始。如果卡住,请查看右侧的"当前步骤指南"面板 — 它会告诉您该做什么。', ' de ': ' / ',
    // Guide panel
    'Tu llenado en 4 etapas': '4 阶段填写', 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.': '建议按此顺序进行。也可跳到其他部分。', 'Una sola vez al inicio. Identificación de la Proforma, puertos e incoterm.': '开始时一次性填写。形式发票识别、港口和贸易术语。', 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.': '创建一个或多个。每个包含物流、提单、发票、集装箱和装箱。', 'Sube certificados de calidad y otros papeles generales.': '上传质量证书和其他一般文件。', 'Última verificación y notificación a SOM GROUP.': '最终验证并通知 SOM GROUP。', 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.': '此部分定义身份和路线。如不确定,请咨询代理或留空稍后填写。', 'Es el ID que tu sistema usa. Suele comenzar con "PI-".': '您系统使用的 ID。通常以 "PI-" 开头。', 'Origen y destino': '起运地和目的地', 'País y puerto de salida + puerto donde llegará.': '出发国家和港口 + 到达港口。', 'Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP.': '定义谁支付什么。与 SOM GROUP 联系人约定。', 'Pagos y notas': '付款和备注', 'Términos de pago y observaciones generales.': '付款条件和一般备注。', 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.': '一个货运 = 一次航行。如生产分日期出货,可拆分为多个货运。', 'Agrega un embarque': '添加货运', 'Hazlo en cuanto tengas el buque o vuelo asignado.': '一旦分配船舶或航班立即操作。', 'Llena las 5 secciones': '填写 5 个部分', 'Logística, B/L, invoices, contenedores y packing list.': '物流、提单、发票、集装箱和装箱单。', 'Sube documentos': '上传文档', 'Certificado de origen, fitosanitario, etc.': '原产地证、植检证等。', 'Captura por pestañas': '按标签录入', 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.': '从左到右依次操作标签。装箱单最详细 — 留到最后。', 'Logística + B/L': '物流 + 提单', 'Naviera, buque, fechas y el documento B/L.': '船公司、船舶、日期和提单文件。', 'Invoices': '发票', 'Factura(s) comercial(es). Puede ser una global o varias parciales.': '商业发票。可为总发票或多张部分发票。', 'Los números físicos pintados en cada contenedor.': '集装箱上喷涂的实物编号。', 'Packing list': '装箱单', 'Asistente paso a paso. Captura placa por placa.': '逐步向导。逐板录入。', 'CO, fitosanitario, inspección.': '原产地证、植检、检验。', 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.': '适用于整个形式发票的文档。接受 PDF、JPG、PNG,最大 10 MB。', 'Proforma firmada': '已签署的形式发票', 'La que enviaste a SOM GROUP con firma.': '您带签名发送给 SOM GROUP 的那份。', 'Certificados de calidad': '质量证书', 'Pruebas técnicas: mineralogía, densidad, absorción.': '技术测试: 矿物学、密度、吸水率。', 'Fotos del producto': '产品照片', 'Catálogo o muestras a granel.': '目录或散装样品。', 'Verifica todo': '全部验证', 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.': '标记为完成后,SOM GROUP 将收到通知。如需后续编辑,请联系您的联系人。', 'Datos clave que se enviarán.': '将发送的关键数据。', 'Checklist por sección': '按部分的检查清单', 'Si algo está en ámbar, vuelve a esa sección.': '如有琥珀色项目,请返回该部分。', 'Marcar como completa': '标记为完成', 'Solo se habilita cuando todo está en verde.': '仅当所有项目为绿色时启用。', 'mapa de ruta': '路线图', 'ilustración guía': '指南插图',
    // Sidebar
    'Todo listo': '全部就绪', 'En proceso': '进行中', '% completado': '% 完成', 'PI sin número': 'PI 无编号',
  },
  it: {
    'Cancelar': 'Annulla', 'Continuar': 'Continua', 'Atrás': 'Indietro', 'Anterior': 'Precedente', 'Siguiente': 'Avanti', 'Saltar': 'Salta', 'Empezar': 'Inizia', 'Guardar': 'Salva', 'Editar': 'Modifica', 'Eliminar': 'Elimina', 'Subir': 'Carica', 'Cerrar': 'Chiudi', 'Volver': 'Indietro', 'Abrir': 'Apri', 'Ayuda': 'Aiuto', 'Tutorial': 'Tutorial', 'Tutorial inicial': 'Tutorial iniziale', 'Aplicar': 'Applica', 'Generar ': 'Genera ',
    'completo': 'completo', 'completado': 'completato', 'listo': 'pronto', 'Pendiente': 'In sospeso', 'opcional': 'opzionale', 'obligatorio': 'obbligatorio', 'Opcional': 'Opzionale', 'Sin datos': 'Nessun dato', 'Solicitado': 'Richiesto',
    'Embarques': 'Spedizioni', 'Embarque #': 'Spedizione #', 'Embarque no encontrado': 'Spedizione non trovata', 'embarques': 'spedizioni', 'contenedores': 'container', 'invoices': 'fatture', 'bloques': 'blocchi', 'cantidad solicitada': 'quantità richiesta',
    'Portal proveedor': 'Portale fornitore', 'Menú': 'Menu', 'Mostrar guía': 'Mostra guida', 'Ocultar guía': 'Nascondi guida',
    'Vista general': 'Panoramica', 'Datos de la Proforma': 'Dati della Proforma', 'Datos generales de la Proforma': 'Dati generali della Proforma', 'Documentos generales': 'Documenti generali', 'Documentos': 'Documenti', 'Revisar y enviar': 'Rivedi e invia', 'Revisar y enviar a SOM GROUP': 'Rivedi e invia a SOM GROUP', 'Llenado de la Proforma': 'Compilazione della Proforma', 'Progreso global': 'Avanzamento globale', 'Lo que te falta para terminar': 'Cosa manca per finire',
    'Bienvenido al portal del proveedor': 'Benvenuto nel portale del fornitore', 'Bienvenido al portal SOM GROUP': 'Benvenuto nel portale SOM GROUP', 'Hola, equipo de ': 'Ciao, team di ', 'Aquí vas a registrar todos los datos del envío para la Orden de Compra ': 'Qui registrerai tutti i dati della spedizione per l’Ordine d’Acquisto ', 'Continuar donde quedé': 'Riprendi da dove eri', 'Productos solicitados en esta PO': 'Prodotti richiesti in questo OdA', 'Productos solicitados en esta Proforma': 'Prodotti richiesti in questa Proforma', 'Productos': 'Prodotti', 'Producto': 'Prodotto', 'Estado actual': 'Stato attuale',
    'Identificación': 'Identificazione', 'Cómo identifica este lote tu sistema y el nuestro.': 'Come il tuo sistema e il nostro identificano questo lotto.', 'Número de Proforma': 'Numero Proforma', 'Es el número con el que tu sistema identifica esta venta (Proforma Invoice).': 'Il numero con cui il tuo sistema identifica questa vendita (Proforma Invoice).', 'Origen → Destino': 'Origine → Destinazione', 'Ruta y términos del envío. Estos datos van impresos en la documentación de aduanas.': 'Rotta e termini di spedizione. Questi dati sono stampati nella documentazione doganale.', 'País de origen': 'Paese di origine', 'País desde donde sale la mercancía.': 'Paese da cui parte la merce.', 'Puerto de origen': 'Porto di origine', 'Puerto marítimo o aeropuerto desde donde zarpa el embarque.': 'Porto marittimo o aeroporto da cui parte la spedizione.', 'Puerto destino': 'Porto di destinazione', 'El puerto mexicano donde llegará el embarque.': 'Il porto messicano dove arriverà la spedizione.', 'Incoterm': 'Incoterm', 'Incoterm:': 'Incoterm:', 'Define qué parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no estás seguro, pregunta a tu contacto de SOM GROUP.': 'Definisce quale parte (fornitore o cliente) copre trasporto, assicurazione e dogana. Se non sei sicuro, chiedi al tuo contatto SOM GROUP.', 'CIF = tú pagas hasta el puerto destino, incluyendo seguro': 'CIF = paghi fino al porto di destinazione, inclusa assicurazione', 'Ej: CIF = tú pagas hasta el puerto destino': 'Es. CIF = paghi fino al porto di destinazione', 'Cómo y cuándo te van a pagar.': 'Come e quando verrai pagato.', 'Condiciones de pago': 'Condizioni di pagamento', 'Factura global': 'Fattura globale', 'Si emites una factura comercial que cubre toda la PO, escríbela aquí. Si tienes una por embarque, déjalo vacío y llénalo en cada embarque.': 'Se emetti una fattura commerciale che copre l’intero OdA, scrivila qui. Se ne hai una per spedizione, lascia vuoto e compilala in ogni spedizione.', 'Observaciones generales': 'Note generali', 'Observaciones': 'Note', 'Esto se incluirá en la confirmación final. Puedes dejarlo vacío si no aplica.': 'Sarà incluso nella conferma finale. Puoi lasciarlo vuoto se non si applica.', 'Continuar a embarques': 'Continua alle spedizioni', 'Selecciona…': 'Seleziona…',
    'Esto es lo que SOM GROUP te pidió. Tendrás que registrar packing list para cada uno.': 'Questo è ciò che SOM GROUP ti ha chiesto. Dovrai registrare un packing list per ciascuno.', 'No hay embarques registrados todavía': 'Nessuna spedizione registrata', 'Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.': 'Quando saprai la data approssimativa, aggiungi una spedizione e inizia a inserire logistica e packing list.', 'Crear el primer embarque': 'Crea la prima spedizione', 'Agregar embarque': 'Aggiungi spedizione', 'Si tu producción se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque está bien.': 'Se la produzione partirà in date o navi diverse, crea una spedizione per ciascuna. Se tutto parte sulla stessa nave, va bene una sola spedizione.',
    'Sin buque asignado': 'Nessuna nave assegnata', 'Sin contenedores': 'Nessun container', 'Estado': 'Stato', 'Tipo': 'Tipo', 'Tipo de transporte': 'Tipo di trasporto', 'Marítimo': 'Marittimo', 'Aéreo': 'Aereo', 'Terrestre': 'Terrestre',
    'Eliminar embarque': 'Elimina spedizione', 'Logística · B/L · Invoices · Contenedores · Packing': 'Logistica · B/L · Fatture · Container · Packing', 'Logística internacional': 'Logistica internazionale', 'Datos de logística': 'Dati logistici', 'Información del transporte. La obtienes de tu agente de carga (forwarder).': 'Informazioni sul trasporto. Ottenute dal tuo spedizioniere.', 'Naviera / Aerolínea': 'Compagnia di navigazione / Aerea', 'Compañía que opera el transporte.': 'Compagnia che gestisce il trasporto.', 'Buque + viaje': 'Nave + viaggio', 'Nombre del buque seguido del número de viaje.': 'Nome della nave seguito dal numero di viaggio.', 'Estimated Time of Departure — fecha estimada de salida del puerto origen.': 'Estimated Time of Departure — data prevista di partenza dal porto di origine.', 'Estimated Time of Arrival — fecha estimada de llegada al puerto destino.': 'Estimated Time of Arrival — data prevista di arrivo al porto di destinazione.', 'Notas internas sobre el viaje.': 'Note interne sul viaggio.',
    'Bill of Lading (B/L)': 'Polizza di Carico (B/L)', 'El B/L es el documento que prueba que la naviera recibió tu mercancía. Súbelo en cuanto lo recibas — sin él, aduanas no libera el embarque.': 'Il B/L è il documento che prova che il vettore ha ricevuto la merce. Caricalo appena lo ricevi — senza, la dogana non rilascia la spedizione.', 'Número de B/L': 'Numero B/L', 'El número único que asigna la naviera a tu embarque.': 'Il numero univoco che il vettore assegna alla spedizione.', 'Fecha de B/L': 'Data B/L', 'Fecha que aparece impresa en el documento.': 'Data stampata sul documento.', 'Archivo PDF': 'File PDF', 'Sube el PDF original. Aceptamos máximo 10 MB.': 'Carica il PDF originale. Max 10 MB.', 'Subir PDF': 'Carica PDF',
    'Invoices (Facturas comerciales)': 'Fatture (commerciali)', 'Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores específicos.': 'Crea almeno una fattura commerciale per spedizione. Puoi assegnarla all’intera spedizione o solo a container specifici.', 'Aún no hay invoices': 'Nessuna fattura ancora', 'La factura comercial que emites para el embarque. Puede ser una global o varias parciales.': 'La fattura commerciale emessa per la spedizione. Può essere globale o parziali.', 'Agregar primer invoice': 'Aggiungi prima fattura', 'Agregar invoice': 'Aggiungi fattura', 'No. Invoice': 'N. Fattura', 'Identifica este documento. Suele ser una variante de la invoice.': 'Identifica questo documento. Di solito una variante della fattura.', 'Fecha': 'Data', 'Monto + moneda': 'Importo + valuta', 'Total facturado en este embarque': 'Totale fatturato in questa spedizione', 'Total invoices': 'Totale fatture',
    'Contenedores': 'Container', 'Contenedor': 'Container', 'Cada caja física que viaja en el embarque. Los números son los que están pintados en el contenedor (4 letras + 7 dígitos).': 'Ogni cassa fisica nella spedizione. I numeri sono quelli dipinti sul container (4 lettere + 7 cifre).', 'Captura los números de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.': 'Inserisci i numeri dei container appena il tuo agente te li dà. Servono prima del packing list.', 'Agregar primer contenedor': 'Aggiungi primo container', 'Agregar contenedor': 'Aggiungi container', 'No. Contenedor': 'N. Container', 'No. de Sello': 'N. Sigillo', 'Sello de seguridad que se rompe al abrir el contenedor.': 'Sigillo di sicurezza che si rompe aprendo il container.', 'Peso bruto (kg)': 'Peso lordo (kg)', 'Volumen (m³)': 'Volume (m³)', 'No. de paquetes / bultos': 'N. colli / pacchi', 'Dimensión': 'Dimensione', 'Contenedor sin número': 'Container senza numero',
    'Packing Lists': 'Packing Lists', 'Nuevo packing': 'Nuovo packing', 'Sin packing lists todavía': 'Nessun packing list ancora', 'Aquí registras placa por placa (o pieza por pieza) lo que va en cada contenedor. ': 'Qui registri lastra per lastra (o pezzo per pezzo) cosa va in ogni container. ', 'Es la parte más detallada.': 'È la parte più dettagliata.', 'Empezar con el asistente': 'Inizia con l’assistente', 'Cómo funciona el asistente': 'Come funziona l’assistente', 'El asistente te llevará paso a paso: ': 'L’assistente ti guiderà passo a passo: ', 'En lugar de que escribas mil líneas a mano, el asistente ': 'Invece di scrivere mille righe a mano, l’assistente ', 'genera las filas automáticamente': 'genera le righe automaticamente', 'Tip: el packing list es lo más detallado.': 'Suggerimento: il packing list è la parte più dettagliata.', 'Fecha del Packing': 'Data Packing', 'No. del Packing': 'N. Packing',
    'Bloque': 'Blocco', 'Bloques configurados': 'Blocchi configurati', 'Atado': 'Pacco', 'No. Placa': 'N. Lastra', 'Grosor cm': 'Spessore cm', 'Alto m': 'Altezza m', 'Largo m': 'Lunghezza m', 'Foto': 'Foto', 'Notas': 'Note', 'Referencia': 'Riferimento', 'Placas / piezas': 'Lastre / pezzi', 'Crear primer bloque': 'Crea primo blocco', 'Sin bloques aún': 'Nessun blocco ancora', 'Empieza con uno. Puedes agregar tantos como necesites.': 'Inizia con uno. Puoi aggiungerne quanti ne servono.', 'Agregar bloque': 'Aggiungi blocco', 'Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generará automáticamente 48 filas para llenar.': 'Un blocco è la pietra originale di cava, prima del taglio. Da ogni blocco escono più lastre. Se hai 3 blocchi con 18, 16 e 14 lastre, questo passo genererà automaticamente 48 righe da compilare.', 'Antes de capturar placa por placa, vas a configurar los ': 'Prima di registrare lastra per lastra, configurerai i ', 'Puedes continuar y subirlas después, pero el packing list no se considerará completo hasta que cada bloque tenga al menos una foto.': 'Puoi continuare e caricarle dopo, ma il packing list non sarà completo finché ogni blocco non avrà almeno una foto.', 'Estructura del packing': 'Struttura del packing', 'Filas a generar': 'Righe da generare', 'Ajustar bloques': 'Regola blocchi', 'Listo, volver al embarque': 'Fatto, torna alla spedizione', 'Iniciar llenado': 'Inizia compilazione', 'Paso ': 'Passo ', 'Ordenados de lo más fácil a lo más detallado. Comienza por el primero.': 'Ordinati dal più facile al più dettagliato. Inizia dal primo.',
    'Llena más rápido con propagación': 'Compila più velocemente con la propagazione', 'Pasa el cursor sobre cualquier celda y verás ': 'Passa il cursore su qualsiasi cella e vedrai ', 'dos íconos a la derecha': 'due icone a destra', 'copia el valor a la siguiente fila del mismo bloque ·': 'copia il valore alla riga successiva dello stesso blocco ·', 'copia a todas las filas debajo en el mismo bloque. También puedes copiar/pegar desde Excel y usar ': 'copia in tutte le righe sottostanti dello stesso blocco. Puoi anche copiare/incollare da Excel e usare ', ' entre celdas.': ' tra le celle.', 'Copiar a la siguiente fila del mismo bloque': 'Copia nella riga successiva dello stesso blocco', 'Copiar a TODAS las filas del mismo bloque (abajo)': 'Copia in TUTTE le righe dello stesso blocco (sotto)', 'Todas (': 'Tutte (', 'Errores (': 'Errori (', 'Sin dimensiones': 'Senza dimensioni', 'con errores': 'con errori', 'Exportar CSV': 'Esporta CSV', 'Pegar de Excel': 'Incolla da Excel', 'Pegar desde Excel': 'Incolla da Excel',
    'Copia el rango en Excel (con o sin la fila de headers) y pégalo aquí con ': 'Copia il range in Excel (con o senza riga di intestazione) e incollalo qui con ', 'Aplicar a ': 'Applica a ', 'Columnas que se aplicarán: ': 'Colonne da applicare: ', 'No se detectaron filas válidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).': 'Nessuna riga valida rilevata. Verifica di aver incollato il contenuto di Excel (celle separate da tab).',
    'Documentos del embarque': 'Documenti della spedizione', 'Sube los documentos legales y de calidad que acompañan este embarque.': 'Carica i documenti legali e di qualità che accompagnano questa spedizione.', 'Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque.': 'Documenti che si applicano all’intera Proforma (non a una spedizione specifica). I documenti per spedizione sono dentro ogni spedizione.', 'Arrastra tus archivos aquí': 'Trascina i tuoi file qui', 'PDF, JPG, PNG · máximo 10 MB por archivo · o ': 'PDF, JPG, PNG · max 10 MB per file · oppure ', 'elige desde tu computadora': 'scegli dal tuo computer', 'Subir foto': 'Carica foto',
    'Checklist final': 'Checklist finale', 'Verifica que cada sección esté completa.': 'Verifica che ogni sezione sia completa.', 'Resumen general': 'Riepilogo generale', 'Aún no puedes marcar como completa': 'Non puoi ancora segnare come completa', 'Corrige los puntos resaltados abajo para poder continuar.': 'Correggi i punti evidenziati sotto per continuare.', 'Termina los puntos pendientes del checklist. Puedes seguir trabajando — tus datos se guardan automáticamente.': 'Completa i punti in sospeso nella checklist. Puoi continuare a lavorare — i dati si salvano automaticamente.', 'Al marcar como completa, SOM GROUP recibirá un correo automático.': 'Una volta segnata come completa, SOM GROUP riceverà un’email automatica.', 'Datos que se enviarán como confirmación.': 'Dati che saranno inviati come conferma.', 'Aún sin buque ni naviera. Empieza por la pestaña de Logística.': 'Ancora senza nave o vettore. Inizia dalla scheda Logistica.',
    'Guía del paso actual': 'Guida del passo corrente', 'Guía': 'Guida', 'Guía del embarque': 'Guida della spedizione', 'Antes de enviar': 'Prima di inviare',
    'Idioma & branding': 'Lingua & branding', 'Idioma': 'Lingua', 'Acento': 'Accento', 'Densidad': 'Densità', 'Cómoda': 'Comoda', 'Compacta': 'Compatta', 'Guía y onboarding': 'Guida e onboarding', 'Panel guía a la derecha': 'Pannello guida a destra', 'Mostrar onboarding ahora': 'Mostra onboarding ora', 'Validación': 'Validazione', 'Estilo cuando hay errores': 'Stile quando ci sono errori', 'Suave — solo inline en cada campo': 'Soft — solo inline in ogni campo', 'Inline + banner sticky resumen': 'Inline + banner sticky riepilogo', 'Bloquear avance hasta corregir': 'Blocca avanzamento fino alla correzione', 'Estado simulado': 'Stato simulato', 'Mostrar todo completado': 'Mostra tutto completato', 'Close tweaks': 'Chiudi tweaks', 'Tweaks': 'Tweaks',
    // Onboarding
    '¡Bienvenido al portal!': 'Benvenuto nel portale!', 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.': 'Qui registrerai i dati della spedizione per SOM GROUP. Ti guideremo passo a passo. Non devi finire tutto in una volta.', 'Tu progreso siempre visible': 'Il tuo avanzamento sempre visibile', 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.': 'A sinistra vedrai l’avanzamento di ogni sezione con segni visivi: verde = fatto, ambra = in corso, grigio = in sospeso.', 'Datos generales': 'Dati generali', 'Embarque #1': 'Spedizione #1', 'Embarque #2': 'Spedizione #2', 'Ayuda contextual en cada campo': 'Aiuto contestuale in ogni campo', 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.': 'Vedrai un’icona "?" accanto ai campi confusi. Passa il cursore per una spiegazione con esempio.', ' define quién paga el transporte y seguro. ': ' definisce chi paga trasporto e assicurazione. ', 'El packing list es asistido': 'Il packing list è guidato', 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.': 'Invece di scrivere centinaia di righe, ti chiederemo quanti blocchi carichi e quante lastre ha ognuno. Generiamo le righe per te.', '1. Productos': '1. Prodotti', '2. Bloques + fotos': '2. Blocchi + foto', '3. Revisión': '3. Revisione', '4. Llenar placas': '4. Compila lastre', '¿Listo para empezar?': 'Pronto a iniziare?', 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.': 'Iniziamo dai dati generali. Se ti blocchi, guarda il pannello "Guida del passo corrente" a destra — ti dirà sempre cosa fare.', ' de ': ' di ',
    // Guide panel
    'Tu llenado en 4 etapas': 'La tua compilazione in 4 fasi', 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.': 'Consigliamo questo ordine. Puoi saltare a un’altra sezione se serve.', 'Una sola vez al inicio. Identificación de la Proforma, puertos e incoterm.': 'Una sola volta all’inizio. Identificazione della Proforma, porti e incoterm.', 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.': 'Crea uno o più. Ciascuno con logistica, B/L, fatture, container e packing.', 'Sube certificados de calidad y otros papeles generales.': 'Carica certificati di qualità e altri documenti generali.', 'Última verificación y notificación a SOM GROUP.': 'Verifica finale e notifica a SOM GROUP.', 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.': 'Questa sezione definisce identità e rotta. Se non sai qualcosa, chiedi al tuo agente o lascia vuoto e torna dopo.', 'Es el ID que tu sistema usa. Suele comenzar con "PI-".': 'L’ID che il tuo sistema usa. Di solito inizia con "PI-".', 'Origen y destino': 'Origine e destinazione', 'País y puerto de salida + puerto donde llegará.': 'Paese e porto di partenza + porto di arrivo.', 'Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP.': 'Definisce chi paga cosa. Concordato con il tuo contatto SOM GROUP.', 'Pagos y notas': 'Pagamenti e note', 'Términos de pago y observaciones generales.': 'Condizioni di pagamento e note generali.', 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.': 'Una spedizione = un viaggio. Puoi dividere l’OdA in più spedizioni se la produzione esce in date diverse.', 'Agrega un embarque': 'Aggiungi una spedizione', 'Hazlo en cuanto tengas el buque o vuelo asignado.': 'Fallo appena hai la nave o il volo assegnato.', 'Llena las 5 secciones': 'Compila le 5 sezioni', 'Logística, B/L, invoices, contenedores y packing list.': 'Logistica, B/L, fatture, container e packing list.', 'Sube documentos': 'Carica documenti', 'Certificado de origen, fitosanitario, etc.': 'Certificato di origine, fitosanitario, ecc.', 'Captura por pestañas': 'Inserimento per schede', 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.': 'Segui le schede da sinistra a destra. Il packing list è il più dettagliato — lascialo per ultimo.', 'Logística + B/L': 'Logistica + B/L', 'Naviera, buque, fechas y el documento B/L.': 'Vettore, nave, date e documento B/L.', 'Invoices': 'Fatture', 'Factura(s) comercial(es). Puede ser una global o varias parciales.': 'Fattura/e commerciale/i. Può essere globale o parziali.', 'Los números físicos pintados en cada contenedor.': 'I numeri fisici dipinti su ogni container.', 'Packing list': 'Packing list', 'Asistente paso a paso. Captura placa por placa.': 'Assistente passo a passo. Lastra per lastra.', 'CO, fitosanitario, inspección.': 'CO, fitosanitario, ispezione.', 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.': 'Documenti che si applicano all’intera Proforma. Accetta PDF, JPG, PNG fino a 10 MB.', 'Proforma firmada': 'Proforma firmata', 'La que enviaste a SOM GROUP con firma.': 'Quella che hai inviato a SOM GROUP firmata.', 'Certificados de calidad': 'Certificati di qualità', 'Pruebas técnicas: mineralogía, densidad, absorción.': 'Test tecnici: mineralogia, densità, assorbimento.', 'Fotos del producto': 'Foto del prodotto', 'Catálogo o muestras a granel.': 'Catalogo o campioni sfusi.', 'Verifica todo': 'Verifica tutto', 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.': 'Una volta segnata completa, SOM GROUP riceve una notifica. Per modificare dopo, chiedi al tuo contatto.', 'Datos clave que se enviarán.': 'Dati chiave che saranno inviati.', 'Checklist por sección': 'Checklist per sezione', 'Si algo está en ámbar, vuelve a esa sección.': 'Se qualcosa è ambra, torna a quella sezione.', 'Marcar como completa': 'Segna come completa', 'Solo se habilita cuando todo está en verde.': 'Abilitato solo quando tutto è verde.', 'mapa de ruta': 'mappa del percorso', 'ilustración guía': 'illustrazione guida',
    // Sidebar
    'Todo listo': 'Tutto pronto', 'En proceso': 'In corso', '% completado': '% completato', 'PI sin número': 'PI senza numero',
  },
  pt: {
    'Cancelar': 'Cancelar', 'Continuar': 'Continuar', 'Atrás': 'Voltar', 'Anterior': 'Anterior', 'Siguiente': 'Próximo', 'Saltar': 'Pular', 'Empezar': 'Começar', 'Guardar': 'Salvar', 'Editar': 'Editar', 'Eliminar': 'Excluir', 'Subir': 'Enviar', 'Cerrar': 'Fechar', 'Volver': 'Voltar', 'Abrir': 'Abrir', 'Ayuda': 'Ajuda', 'Tutorial': 'Tutorial', 'Tutorial inicial': 'Tutorial inicial', 'Aplicar': 'Aplicar', 'Generar ': 'Gerar ',
    'completo': 'completo', 'completado': 'concluído', 'listo': 'pronto', 'Pendiente': 'Pendente', 'opcional': 'opcional', 'obligatorio': 'obrigatório', 'Opcional': 'Opcional', 'Sin datos': 'Sem dados', 'Solicitado': 'Solicitado',
    'Embarques': 'Embarques', 'Embarque #': 'Embarque #', 'Embarque no encontrado': 'Embarque não encontrado', 'embarques': 'embarques', 'contenedores': 'contêineres', 'invoices': 'faturas', 'bloques': 'blocos', 'cantidad solicitada': 'quantidade solicitada',
    'Portal proveedor': 'Portal do fornecedor', 'Menú': 'Menu', 'Mostrar guía': 'Mostrar guia', 'Ocultar guía': 'Ocultar guia',
    'Vista general': 'Visão geral', 'Datos de la Proforma': 'Dados da Proforma', 'Datos generales de la Proforma': 'Dados gerais da Proforma', 'Documentos generales': 'Documentos gerais', 'Documentos': 'Documentos', 'Revisar y enviar': 'Revisar e enviar', 'Revisar y enviar a SOM GROUP': 'Revisar e enviar à SOM GROUP', 'Llenado de la Proforma': 'Preenchimento da Proforma', 'Progreso global': 'Progresso geral', 'Lo que te falta para terminar': 'O que falta para terminar',
    'Bienvenido al portal del proveedor': 'Bem-vindo ao portal do fornecedor', 'Bienvenido al portal SOM GROUP': 'Bem-vindo ao portal SOM GROUP', 'Hola, equipo de ': 'Olá, equipe de ', 'Aquí vas a registrar todos los datos del envío para la Orden de Compra ': 'Aqui você vai registrar todos os dados do envio para o Pedido de Compra ', 'Continuar donde quedé': 'Continuar de onde parei', 'Productos solicitados en esta PO': 'Produtos solicitados neste pedido', 'Productos solicitados en esta Proforma': 'Produtos solicitados nesta Proforma', 'Productos': 'Produtos', 'Producto': 'Produto', 'Estado actual': 'Status atual',
    'Identificación': 'Identificação', 'Cómo identifica este lote tu sistema y el nuestro.': 'Como seu sistema e o nosso identificam este lote.', 'Número de Proforma': 'Número da Proforma', 'Es el número con el que tu sistema identifica esta venta (Proforma Invoice).': 'É o número com o qual seu sistema identifica esta venda (Proforma Invoice).', 'Origen → Destino': 'Origem → Destino', 'Ruta y términos del envío. Estos datos van impresos en la documentación de aduanas.': 'Rota e termos do envio. Estes dados vão impressos na documentação alfandegária.', 'País de origen': 'País de origem', 'País desde donde sale la mercancía.': 'País de onde sai a mercadoria.', 'Puerto de origen': 'Porto de origem', 'Puerto marítimo o aeropuerto desde donde zarpa el embarque.': 'Porto marítimo ou aeroporto de onde parte o embarque.', 'Puerto destino': 'Porto de destino', 'El puerto mexicano donde llegará el embarque.': 'O porto mexicano onde o embarque chegará.', 'Incoterm': 'Incoterm', 'Incoterm:': 'Incoterm:', 'Define qué parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no estás seguro, pregunta a tu contacto de SOM GROUP.': 'Define qual parte (fornecedor ou cliente) cobre transporte, seguro e alfândega. Em dúvida, pergunte ao seu contato na SOM GROUP.', 'CIF = tú pagas hasta el puerto destino, incluyendo seguro': 'CIF = você paga até o porto de destino, incluindo seguro', 'Ej: CIF = tú pagas hasta el puerto destino': 'Ex: CIF = você paga até o porto de destino', 'Cómo y cuándo te van a pagar.': 'Como e quando você será pago.', 'Condiciones de pago': 'Condições de pagamento', 'Factura global': 'Fatura global', 'Si emites una factura comercial que cubre toda la PO, escríbela aquí. Si tienes una por embarque, déjalo vacío y llénalo en cada embarque.': 'Se você emite uma fatura comercial que cobre todo o pedido, escreva aqui. Se tem uma por embarque, deixe vazio e preencha em cada embarque.', 'Observaciones generales': 'Observações gerais', 'Observaciones': 'Observações', 'Esto se incluirá en la confirmación final. Puedes dejarlo vacío si no aplica.': 'Isso será incluído na confirmação final. Pode deixar vazio se não se aplica.', 'Continuar a embarques': 'Continuar para embarques', 'Selecciona…': 'Selecionar…',
    'Esto es lo que SOM GROUP te pidió. Tendrás que registrar packing list para cada uno.': 'Isto é o que a SOM GROUP pediu. Você terá que registrar um packing list para cada um.', 'No hay embarques registrados todavía': 'Nenhum embarque registrado ainda', 'Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.': 'Quando souber a data aproximada do envio, adicione um embarque e comece a capturar logística e packing list.', 'Crear el primer embarque': 'Criar primeiro embarque', 'Agregar embarque': 'Adicionar embarque', 'Si tu producción se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque está bien.': 'Se a produção for embarcada em datas ou navios diferentes, crie um embarque para cada. Se tudo sai no mesmo navio, um único embarque está bem.',
    'Sin buque asignado': 'Sem navio atribuído', 'Sin contenedores': 'Sem contêineres', 'Estado': 'Status', 'Tipo': 'Tipo', 'Tipo de transporte': 'Tipo de transporte', 'Marítimo': 'Marítimo', 'Aéreo': 'Aéreo', 'Terrestre': 'Terrestre',
    'Eliminar embarque': 'Excluir embarque', 'Logística · B/L · Invoices · Contenedores · Packing': 'Logística · B/L · Faturas · Contêineres · Packing', 'Logística internacional': 'Logística internacional', 'Datos de logística': 'Dados de logística', 'Información del transporte. La obtienes de tu agente de carga (forwarder).': 'Informações do transporte. Obtidas do seu agente de carga (forwarder).', 'Naviera / Aerolínea': 'Armador / Companhia aérea', 'Compañía que opera el transporte.': 'Empresa que opera o transporte.', 'Buque + viaje': 'Navio + viagem', 'Nombre del buque seguido del número de viaje.': 'Nome do navio seguido do número da viagem.', 'Estimated Time of Departure — fecha estimada de salida del puerto origen.': 'Estimated Time of Departure — data estimada de saída do porto de origem.', 'Estimated Time of Arrival — fecha estimada de llegada al puerto destino.': 'Estimated Time of Arrival — data estimada de chegada ao porto de destino.', 'Notas internas sobre el viaje.': 'Notas internas sobre a viagem.',
    'Bill of Lading (B/L)': 'Bill of Lading (B/L)', 'El B/L es el documento que prueba que la naviera recibió tu mercancía. Súbelo en cuanto lo recibas — sin él, aduanas no libera el embarque.': 'O B/L é o documento que prova que o armador recebeu sua mercadoria. Faça upload assim que receber — sem ele, a alfândega não libera o embarque.', 'Número de B/L': 'Número do B/L', 'El número único que asigna la naviera a tu embarque.': 'O número único atribuído pelo armador ao seu embarque.', 'Fecha de B/L': 'Data do B/L', 'Fecha que aparece impresa en el documento.': 'Data impressa no documento.', 'Archivo PDF': 'Arquivo PDF', 'Sube el PDF original. Aceptamos máximo 10 MB.': 'Envie o PDF original. Máximo 10 MB.', 'Subir PDF': 'Enviar PDF',
    'Invoices (Facturas comerciales)': 'Faturas (comerciais)', 'Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores específicos.': 'Crie pelo menos uma fatura comercial por embarque. Pode atribuí-la a todo o embarque ou apenas a contêineres específicos.', 'Aún no hay invoices': 'Ainda não há faturas', 'La factura comercial que emites para el embarque. Puede ser una global o varias parciales.': 'A fatura comercial emitida para o embarque. Pode ser global ou parciais.', 'Agregar primer invoice': 'Adicionar primeira fatura', 'Agregar invoice': 'Adicionar fatura', 'No. Invoice': 'Nº Fatura', 'Identifica este documento. Suele ser una variante de la invoice.': 'Identifica este documento. Geralmente uma variação da fatura.', 'Fecha': 'Data', 'Monto + moneda': 'Valor + moeda', 'Total facturado en este embarque': 'Total faturado neste embarque', 'Total invoices': 'Total faturas',
    'Contenedores': 'Contêineres', 'Contenedor': 'Contêiner', 'Cada caja física que viaja en el embarque. Los números son los que están pintados en el contenedor (4 letras + 7 dígitos).': 'Cada caixa física que viaja no embarque. Os números são os pintados no contêiner (4 letras + 7 dígitos).', 'Captura los números de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.': 'Capture os números de contêiner assim que seu agente os entregar. Você precisa deles antes do packing list.', 'Agregar primer contenedor': 'Adicionar primeiro contêiner', 'Agregar contenedor': 'Adicionar contêiner', 'No. Contenedor': 'Nº Contêiner', 'No. de Sello': 'Nº Lacre', 'Sello de seguridad que se rompe al abrir el contenedor.': 'Lacre de segurança que se rompe ao abrir o contêiner.', 'Peso bruto (kg)': 'Peso bruto (kg)', 'Volumen (m³)': 'Volume (m³)', 'No. de paquetes / bultos': 'Nº de pacotes / volumes', 'Dimensión': 'Dimensão', 'Contenedor sin número': 'Contêiner sem número',
    'Packing Lists': 'Packing Lists', 'Nuevo packing': 'Novo packing', 'Sin packing lists todavía': 'Nenhum packing list ainda', 'Aquí registras placa por placa (o pieza por pieza) lo que va en cada contenedor. ': 'Aqui você registra chapa por chapa (ou peça por peça) o que vai em cada contêiner. ', 'Es la parte más detallada.': 'É a parte mais detalhada.', 'Empezar con el asistente': 'Começar com o assistente', 'Cómo funciona el asistente': 'Como funciona o assistente', 'El asistente te llevará paso a paso: ': 'O assistente te guiará passo a passo: ', 'En lugar de que escribas mil líneas a mano, el asistente ': 'Em vez de escrever mil linhas à mão, o assistente ', 'genera las filas automáticamente': 'gera as linhas automaticamente', 'Tip: el packing list es lo más detallado.': 'Dica: o packing list é a parte mais detalhada.', 'Fecha del Packing': 'Data do Packing', 'No. del Packing': 'Nº do Packing',
    'Bloque': 'Bloco', 'Bloques configurados': 'Blocos configurados', 'Atado': 'Amarrado', 'No. Placa': 'Nº Chapa', 'Grosor cm': 'Espessura cm', 'Alto m': 'Altura m', 'Largo m': 'Comprimento m', 'Foto': 'Foto', 'Notas': 'Notas', 'Referencia': 'Referência', 'Placas / piezas': 'Chapas / peças', 'Crear primer bloque': 'Criar primeiro bloco', 'Sin bloques aún': 'Sem blocos ainda', 'Empieza con uno. Puedes agregar tantos como necesites.': 'Comece com um. Pode adicionar quantos precisar.', 'Agregar bloque': 'Adicionar bloco', 'Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generará automáticamente 48 filas para llenar.': 'Um bloco é a pedra original da pedreira, antes de ser cortada. De cada bloco saem várias chapas. Se você tem 3 blocos com 18, 16 e 14 chapas, este passo gerará automaticamente 48 linhas para preencher.', 'Antes de capturar placa por placa, vas a configurar los ': 'Antes de capturar chapa por chapa, você vai configurar os ', 'Puedes continuar y subirlas después, pero el packing list no se considerará completo hasta que cada bloque tenga al menos una foto.': 'Pode continuar e enviá-las depois, mas o packing list não será considerado completo até que cada bloco tenha pelo menos uma foto.', 'Estructura del packing': 'Estrutura do packing', 'Filas a generar': 'Linhas a gerar', 'Ajustar bloques': 'Ajustar blocos', 'Listo, volver al embarque': 'Pronto, voltar ao embarque', 'Iniciar llenado': 'Iniciar preenchimento', 'Paso ': 'Passo ', 'Ordenados de lo más fácil a lo más detallado. Comienza por el primero.': 'Ordenados do mais fácil ao mais detalhado. Comece pelo primeiro.',
    'Llena más rápido con propagación': 'Preencha mais rápido com propagação', 'Pasa el cursor sobre cualquier celda y verás ': 'Passe o cursor sobre qualquer célula e verá ', 'dos íconos a la derecha': 'dois ícones à direita', 'copia el valor a la siguiente fila del mismo bloque ·': 'copia o valor à próxima linha do mesmo bloco ·', 'copia a todas las filas debajo en el mismo bloque. También puedes copiar/pegar desde Excel y usar ': 'copia a todas as linhas abaixo no mesmo bloco. Também pode copiar/colar do Excel e usar ', ' entre celdas.': ' entre células.', 'Copiar a la siguiente fila del mismo bloque': 'Copiar para a próxima linha do mesmo bloco', 'Copiar a TODAS las filas del mismo bloque (abajo)': 'Copiar para TODAS as linhas do mesmo bloco (abaixo)', 'Todas (': 'Todas (', 'Errores (': 'Erros (', 'Sin dimensiones': 'Sem dimensões', 'con errores': 'com erros', 'Exportar CSV': 'Exportar CSV', 'Pegar de Excel': 'Colar do Excel', 'Pegar desde Excel': 'Colar do Excel',
    'Copia el rango en Excel (con o sin la fila de headers) y pégalo aquí con ': 'Copie o intervalo no Excel (com ou sem a linha de cabeçalho) e cole aqui com ', 'Aplicar a ': 'Aplicar a ', 'Columnas que se aplicarán: ': 'Colunas a aplicar: ', 'No se detectaron filas válidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).': 'Nenhuma linha válida detectada. Verifique se colou o conteúdo do Excel (células separadas por tab).',
    'Documentos del embarque': 'Documentos do embarque', 'Sube los documentos legales y de calidad que acompañan este embarque.': 'Envie os documentos legais e de qualidade que acompanham este embarque.', 'Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque.': 'Documentos que se aplicam a toda a Proforma (não a um embarque específico). Os documentos por embarque estão dentro de cada embarque.', 'Arrastra tus archivos aquí': 'Arraste seus arquivos aqui', 'PDF, JPG, PNG · máximo 10 MB por archivo · o ': 'PDF, JPG, PNG · máximo 10 MB por arquivo · ou ', 'elige desde tu computadora': 'escolha do seu computador', 'Subir foto': 'Enviar foto',
    'Checklist final': 'Checklist final', 'Verifica que cada sección esté completa.': 'Verifique se cada seção está completa.', 'Resumen general': 'Resumo geral', 'Aún no puedes marcar como completa': 'Ainda não pode marcar como concluída', 'Corrige los puntos resaltados abajo para poder continuar.': 'Corrija os pontos destacados abaixo para continuar.', 'Termina los puntos pendientes del checklist. Puedes seguir trabajando — tus datos se guardan automáticamente.': 'Termine os pontos pendentes do checklist. Pode continuar trabalhando — seus dados são salvos automaticamente.', 'Al marcar como completa, SOM GROUP recibirá un correo automático.': 'Ao marcar como concluída, a SOM GROUP receberá um e-mail automático.', 'Datos que se enviarán como confirmación.': 'Dados que serão enviados como confirmação.', 'Aún sin buque ni naviera. Empieza por la pestaña de Logística.': 'Ainda sem navio ou armador. Comece pela aba Logística.',
    'Guía del paso actual': 'Guia do passo atual', 'Guía': 'Guia', 'Guía del embarque': 'Guia do embarque', 'Antes de enviar': 'Antes de enviar',
    'Idioma & branding': 'Idioma & marca', 'Idioma': 'Idioma', 'Acento': 'Cor de destaque', 'Densidad': 'Densidade', 'Cómoda': 'Confortável', 'Compacta': 'Compacta', 'Guía y onboarding': 'Guia e onboarding', 'Panel guía a la derecha': 'Painel de guia à direita', 'Mostrar onboarding ahora': 'Mostrar onboarding agora', 'Validación': 'Validação', 'Estilo cuando hay errores': 'Estilo quando há erros', 'Suave — solo inline en cada campo': 'Suave — apenas inline em cada campo', 'Inline + banner sticky resumen': 'Inline + banner sticky de resumo', 'Bloquear avance hasta corregir': 'Bloquear avanço até corrigir', 'Estado simulado': 'Estado simulado', 'Mostrar todo completado': 'Mostrar tudo concluído', 'Close tweaks': 'Fechar tweaks', 'Tweaks': 'Ajustes',
    // Onboarding
    '¡Bienvenido al portal!': 'Bem-vindo ao portal!', 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.': 'Aqui você vai registrar os dados do embarque para a SOM GROUP. Vamos guiá-lo passo a passo. Não precisa terminar de uma só vez.', 'Tu progreso siempre visible': 'Seu progresso sempre visível', 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.': 'À esquerda você verá o avanço de cada seção com marcas visuais: verde = pronto, âmbar = em andamento, cinza = pendente.', 'Datos generales': 'Dados gerais', 'Embarque #1': 'Embarque #1', 'Embarque #2': 'Embarque #2', 'Ayuda contextual en cada campo': 'Ajuda contextual em cada campo', 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.': 'Você verá um ícone "?" ao lado de campos confusos. Passe o cursor para ver explicação com exemplo.', ' define quién paga el transporte y seguro. ': ' define quem paga transporte e seguro. ', 'El packing list es asistido': 'O packing list é assistido', 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.': 'Em vez de escrever centenas de linhas, vamos perguntar quantos blocos você carrega e quantas chapas tem cada um. Geramos as linhas para você.', '1. Productos': '1. Produtos', '2. Bloques + fotos': '2. Blocos + fotos', '3. Revisión': '3. Revisão', '4. Llenar placas': '4. Preencher chapas', '¿Listo para empezar?': 'Pronto para começar?', 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.': 'Vamos começar pelos dados gerais. Se travar, procure o painel "Guia do passo atual" à direita — ele sempre diz o que fazer.', ' de ': ' de ',
    // Guide panel
    'Tu llenado en 4 etapas': 'Seu preenchimento em 4 etapas', 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.': 'Recomendamos seguir esta ordem. Você pode pular para outra seção se precisar.', 'Una sola vez al inicio. Identificación de la Proforma, puertos e incoterm.': 'Uma vez no início. Identificação da Proforma, portos e incoterm.', 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.': 'Crie um ou vários. Cada um com logística, B/L, faturas, contêineres e packing.', 'Sube certificados de calidad y otros papeles generales.': 'Envie certificados de qualidade e outros documentos gerais.', 'Última verificación y notificación a SOM GROUP.': 'Verificação final e notificação à SOM GROUP.', 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.': 'Esta seção define identidade e rota. Em dúvida, pergunte ao seu agente ou deixe vazio e volte depois.', 'Es el ID que tu sistema usa. Suele comenzar con "PI-".': 'É o ID que seu sistema usa. Geralmente começa com "PI-".', 'Origen y destino': 'Origem e destino', 'País y puerto de salida + puerto donde llegará.': 'País e porto de saída + porto de chegada.', 'Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP.': 'Define quem paga o quê. Combinado com seu contato na SOM GROUP.', 'Pagos y notas': 'Pagamentos e notas', 'Términos de pago y observaciones generales.': 'Condições de pagamento e observações gerais.', 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.': 'Um embarque = uma viagem. Divida o pedido em vários embarques se a produção sair em datas diferentes.', 'Agrega un embarque': 'Adicionar um embarque', 'Hazlo en cuanto tengas el buque o vuelo asignado.': 'Faça assim que tiver navio ou voo atribuído.', 'Llena las 5 secciones': 'Preencha as 5 seções', 'Logística, B/L, invoices, contenedores y packing list.': 'Logística, B/L, faturas, contêineres e packing list.', 'Sube documentos': 'Enviar documentos', 'Certificado de origen, fitosanitario, etc.': 'Certificado de origem, fitossanitário, etc.', 'Captura por pestañas': 'Captura por abas', 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.': 'Siga as abas da esquerda para a direita. O packing list é o mais detalhado — deixe para o final.', 'Logística + B/L': 'Logística + B/L', 'Naviera, buque, fechas y el documento B/L.': 'Armador, navio, datas e o documento B/L.', 'Invoices': 'Faturas', 'Factura(s) comercial(es). Puede ser una global o varias parciales.': 'Fatura(s) comercial(is). Pode ser global ou parciais.', 'Los números físicos pintados en cada contenedor.': 'Os números físicos pintados em cada contêiner.', 'Packing list': 'Packing list', 'Asistente paso a paso. Captura placa por placa.': 'Assistente passo a passo. Chapa por chapa.', 'CO, fitosanitario, inspección.': 'CO, fitossanitário, inspeção.', 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.': 'Documentos que se aplicam a toda a Proforma. Aceita PDF, JPG, PNG até 10 MB.', 'Proforma firmada': 'Proforma assinada', 'La que enviaste a SOM GROUP con firma.': 'A que você enviou à SOM GROUP assinada.', 'Certificados de calidad': 'Certificados de qualidade', 'Pruebas técnicas: mineralogía, densidad, absorción.': 'Testes técnicos: mineralogia, densidade, absorção.', 'Fotos del producto': 'Fotos do produto', 'Catálogo o muestras a granel.': 'Catálogo ou amostras a granel.', 'Verifica todo': 'Verifique tudo', 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.': 'Uma vez marcada como concluída, a SOM GROUP recebe uma notificação. Para editar depois, peça ao seu contato.', 'Datos clave que se enviarán.': 'Dados-chave que serão enviados.', 'Checklist por sección': 'Checklist por seção', 'Si algo está en ámbar, vuelve a esa sección.': 'Se algo estiver em âmbar, volte a essa seção.', 'Marcar como completa': 'Marcar como concluída', 'Solo se habilita cuando todo está en verde.': 'Habilitado apenas quando tudo estiver em verde.', 'mapa de ruta': 'mapa da rota', 'ilustración guía': 'ilustração guia',
    // Sidebar
    'Todo listo': 'Tudo pronto', 'En proceso': 'Em andamento', '% completado': '% concluído', 'PI sin número': 'PI sem número',
  },
};

// Current language — kept as a module-level variable so the React.createElement
// monkey-patch can read it without going through React context (which would
// require components to subscribe).
let __currentLang = 'es';
function tr(s) {
  if (__currentLang === 'es' || typeof s !== 'string' || !s) return s;
  const dict = TR[__currentLang];
  return (dict && dict[s]) || s;
}
function __setLang(l) { __currentLang = l; }

// ---- Monkey-patch React.createElement -----------------------------------
// All hard-coded literal strings passed as children get auto-translated.
// We also translate common string props that surface in UI: title,
// placeholder, alt, aria-label.
(function patchReact() {
  if (typeof React === 'undefined' || React.__supplierTrPatched) return;
  React.__supplierTrPatched = true;
  const orig = React.createElement;
  const PROPS_TO_TRANSLATE = ['title', 'placeholder', 'alt', 'aria-label'];
  React.createElement = function(type, props, ...children) {
    if (__currentLang !== 'es') {
      if (children && children.length) {
        children = children.map(c => typeof c === 'string' ? tr(c) : c);
      }
      if (props && typeof props === 'object' && !Array.isArray(props)) {
        let next = null;
        for (let i = 0; i < PROPS_TO_TRANSLATE.length; i++) {
          const k = PROPS_TO_TRANSLATE[i];
          const v = props[k];
          if (typeof v === 'string' && v) {
            const t = tr(v);
            if (t !== v) {
              if (!next) next = Object.assign({}, props);
              next[k] = t;
            }
          }
        }
        if (next) props = next;
      }
    }
    return orig.apply(React, [type, props].concat(children));
  };
})();

const LangCtx = React.createContext({ lang: 'es', t: (k) => k });
const useT = () => React.useContext(LangCtx);

window.I18N = I18N;
window.TR = TR;
window.tr = tr;
window.__setLang = __setLang;
window.LangCtx = LangCtx;
window.useT = useT;
// ===== src/ui.jsx =====
/* global React, Icon */
// Tooltip with optional visual example
const HelpTip = ({ children, example, align = 'left' }) => {
    return (React.createElement("span", { className: `tt-wrap ${align === 'right' ? 'right' : ''}`, tabIndex: 0 },
        React.createElement("span", { className: "help-trig", "aria-label": "Ayuda" }, "?"),
        React.createElement("span", { className: "tt", role: "tooltip" },
            children,
            example && React.createElement("span", { className: "tt-example" }, example))));
};
// Form field wrapper
const Field = ({ label, required, optional, help, helpExample, hint, error, warn, ok, msg, msgLevel, children, full, className = '' }) => {
    const level = error ? 'error' : warn ? 'warn' : ok ? 'ok' : null;
    return (React.createElement("div", { className: `fld ${full ? 'fld-full' : ''} ${level ? 'is-' + level : ''} ${className}` },
        label && (React.createElement("label", { className: "fld-label" },
            label,
            required && React.createElement("span", { className: "req", "aria-label": "obligatorio" }, "*"),
            optional && React.createElement("span", { className: "opt" }, "opcional"),
            help && React.createElement(HelpTip, { example: helpExample }, help))),
        children,
        error && React.createElement("span", { className: "fld-msg error" },
            React.createElement(Icon, { name: "alert", size: 13 }),
            " ",
            error),
        warn && !error && React.createElement("span", { className: "fld-msg warn" },
            React.createElement(Icon, { name: "alert", size: 13 }),
            " ",
            warn),
        ok && !error && !warn && React.createElement("span", { className: "fld-msg ok" },
            React.createElement(Icon, { name: "check", size: 13 }),
            " ",
            ok),
        hint && !error && !warn && !ok && React.createElement("span", { className: "fld-msg hint" }, hint)));
};
// Fuerza mayúsculas en cualquier campo de texto: transforma el valor (para que se
// guarde en mayúsculas) y conserva la posición del cursor para no estorbar al teclear.
const forceUpper = (onChange) => (e) => {
    const el = e.target;
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    try {
        el.setSelectionRange(pos, pos);
    }
    catch (_) { }
    if (onChange)
        onChange(e);
};
const Input = ({ onChange, style, type, mono, className, ...p }) => {
    const isText = !type || type === 'text' || type === 'search' || type === 'tel';
    return React.createElement("input", {
        type,
        className: `input ${mono ? 'mono' : ''} ${className || ''}`,
        style: isText ? Object.assign({ textTransform: 'uppercase' }, style || {}) : style,
        onChange: (isText && onChange) ? forceUpper(onChange) : onChange,
        ...p
    });
};
const Select = ({ children, className = '', ...p }) => React.createElement("select", { className: `select ${className}`, ...p }, children);
const Textarea = ({ onChange, style, className, ...p }) => React.createElement("textarea", {
    className: `textarea ${className || ''}`,
    style: Object.assign({ textTransform: 'uppercase' }, style || {}),
    onChange: onChange ? forceUpper(onChange) : onChange,
    ...p
});
const Badge = ({ tone = 'draft', children, dot }) => (React.createElement("span", { className: `badge ${tone}` },
    dot && React.createElement("span", { className: "dot" }),
    children));
// Modal de aviso con estilo propio (reemplaza window.alert). notice = { title, message, tone, cta }.
const NoticeModal = ({ notice, onClose }) => {
    if (!notice)
        return null;
    const tone = notice.tone || 'info';
    const iconName = tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : tone === 'error' ? 'alert' : 'info';
    return React.createElement("div", { className: "notice-overlay", onClick: onClose },
        React.createElement("div", { className: `notice-card notice-${tone}`, onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true" },
            React.createElement("div", { className: "notice-head" },
                React.createElement("div", { className: "notice-icon" },
                    React.createElement(Icon, { name: iconName, size: 18 })),
                React.createElement("h3", null, notice.title || 'Aviso'),
                React.createElement("button", { className: "notice-x", onClick: onClose, "aria-label": "Cerrar" },
                    React.createElement(Icon, { name: "x", size: 16 }))),
            React.createElement("div", { className: "notice-body" }, notice.message),
            React.createElement("div", { className: "notice-actions" },
                React.createElement(Btn, { variant: "primary", onClick: onClose }, notice.cta || 'Entendido'))));
};
// Big circular progress (used in hero + sidebar)
const ProgressRing = ({ pct = 0, size = 140, stroke = 10, label }) => {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - pct / 100);
    return (React.createElement("div", { className: size > 80 ? 'hero-ring' : 'progress-ring', style: size > 80 ? { width: size, height: size } : null },
        React.createElement("svg", { viewBox: `0 0 ${size} ${size}` },
            React.createElement("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", strokeWidth: stroke, className: "track" }),
            React.createElement("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", strokeWidth: stroke, className: "fill", strokeDasharray: `${c - offset} ${c}`, strokeLinecap: "round" })),
        React.createElement("div", { className: "pct" }, size > 80 ? (React.createElement(React.Fragment, null,
            React.createElement("span", { className: "big" },
                pct,
                "%"),
            React.createElement("span", { className: "small" }, label || 'completo'))) : (React.createElement("span", null,
            pct,
            "%")))));
};
const Callout = ({ tone = 'info', icon, title, children, onClose }) => (React.createElement("div", { className: `callout ${tone}` },
    React.createElement("div", { className: "ico" },
        React.createElement(Icon, { name: icon || (tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : tone === 'error' ? 'alert' : 'info'), size: 16 })),
    React.createElement("div", { className: "body" },
        title && React.createElement("strong", null, title),
        React.createElement("p", null, children)),
    onClose && React.createElement("button", { className: "close", onClick: onClose, "aria-label": "Cerrar" },
        React.createElement(Icon, { name: "x", size: 14 }))));
const Empty = ({ icon = 'box', title, children, action }) => (React.createElement("div", { className: "empty" },
    React.createElement("div", { className: "e-icon" },
        React.createElement(Icon, { name: icon, size: 24 })),
    React.createElement("h4", null, title),
    children && React.createElement("p", null, children),
    action));
const Imgph = ({ children, style }) => (React.createElement("div", { className: "imgph", style: style }, children || 'imagen'));
const StatusDot = ({ status = 'todo', label }) => {
    const map = {
        done: { icon: 'check', cls: 'done' },
        partial: { icon: 'minus', cls: 'partial' },
        todo: { icon: 'plus', cls: 'todo' },
        error: { icon: 'alert', cls: 'error' },
    };
    const it = map[status] || map.todo;
    return React.createElement("span", { className: `status-dot ${it.cls}`, "aria-label": label || status },
        React.createElement(Icon, { name: it.icon, size: 10 }));
};
// Standalone button used a lot
const Btn = ({ variant = 'secondary', size, icon, iconRight, children, className = '', ...rest }) => (React.createElement("button", { className: `btn btn-${variant} ${size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : ''} ${className}`, ...rest },
    icon && React.createElement(Icon, { name: icon, size: 14 }),
    children,
    iconRight && React.createElement(Icon, { name: iconRight, size: 14 })));
Object.assign(window, { HelpTip, Field, Input, Select, Textarea, Badge, ProgressRing, Callout, Empty, Imgph, StatusDot, Btn });
// ===== src/sidebar.jsx =====
/* global React, Icon, StatusDot, ProgressRing, computeStatus, SECTIONS */
const Sidebar = ({ proforma, route, setRoute, status, mobileOpen }) => {
    const sectionMap = {
        overview: { title: status.overall >= 100 ? 'Todo listo' : 'En proceso', desc: `${status.overall}% completado` },
    };
    const getStatus = (id) => {
        if (id === 'overview')
            return null;
        if (id === 'globals')
            return status.globals_status;
        if (id === 'shipments')
            return status.ship_overall;
        if (id === 'documents')
            return 'partial';
        if (id === 'review')
            return status.overall >= 100 ? 'todo' : 'todo';
        return 'todo';
    };
    return (React.createElement("aside", { className: `sidebar ${mobileOpen ? 'is-mobile-open' : ''}` },
        React.createElement("div", { className: "progress-card" },
            React.createElement(ProgressRing, { pct: status.overall, size: 52, stroke: 5 }),
            React.createElement("div", { className: "progress-info" },
                React.createElement("span", { className: "label" }, "Progreso global"),
                React.createElement("span", { className: "value" },
                    status.overall,
                    "% completado"),
                React.createElement("span", { className: "meta" }, proforma.globals.proforma_number || 'PI sin número'))),
        React.createElement("nav", null,
            React.createElement("div", { className: "nav-section-title" }, "Llenado de la Proforma"),
            React.createElement("div", { className: "nav-list" }, SECTIONS.map(sec => {
                const st = getStatus(sec.id);
                const active = route.section === sec.id;
                return (React.createElement(React.Fragment, { key: sec.id },
                    React.createElement("button", { className: `nav-item ${active ? 'active' : ''}`, onClick: () => setRoute({ section: sec.id }) },
                        st ? React.createElement(StatusDot, { status: st }) : React.createElement(Icon, { name: sec.icon, size: 16 }),
                        React.createElement("span", null, sec.label),
                        sec.id === 'shipments' && (React.createElement("span", { className: "count" },
                            status.ship_done,
                            "/",
                            proforma.shipments.length))),
                    sec.id === 'shipments' && (active || route.section === 'shipment') && (React.createElement("div", { className: "nav-list", style: { marginLeft: 0, marginBottom: 4 } }, proforma.shipments.map((s, idx) => {
                        const sst = status.shipments_status[idx];
                        const isActive = route.section === 'shipment' && route.shipmentId === s.id;
                        return (React.createElement("button", { key: s.id, className: `nav-item nav-child ${isActive ? 'active' : ''}`, onClick: () => setRoute({ section: 'shipment', shipmentId: s.id }) },
                            React.createElement(StatusDot, { status: sst.status }),
                            React.createElement("span", null,
                                "Embarque #",
                                s.number),
                            React.createElement("span", { className: "count" },
                                sst.pct,
                                "%")));
                    })))));
            }))),
        React.createElement("div", { style: { marginTop: 'auto' } })));
};
window.Sidebar = Sidebar;
// ===== src/views/overview.jsx =====
/* global React, Icon, ProgressRing, Badge, Btn, Callout */
const Overview = ({ proforma, status, setRoute }) => {
    // Pending items list, in plain language
    const pending = [];
    if (status.globals_pct < 100)
        pending.push({
            id: 'globals', icon: 'globe', tone: 'partial',
            title: 'Completar datos generales de la Proforma',
            desc: `Completa el número de Proforma y el puerto destino.`,
            action: () => setRoute({ section: 'globals' }),
        });
    proforma.shipments.forEach((s, idx) => {
        const sst = status.shipments_status[idx];
        if (sst.status === 'done')
            return;
        const reasons = [];
        if (!sst.tabs.hasLog)
            reasons.push('logística');
        if (!sst.tabs.hasBL)
            reasons.push('B/L');
        if (!sst.tabs.hasInv)
            reasons.push('invoices');
        if (!sst.tabs.hasContainers)
            reasons.push('contenedores');
        if (!sst.tabs.hasPacking)
            reasons.push('packing list');
        pending.push({
            id: 's-' + s.id, icon: 'ship', tone: sst.status,
            title: `Embarque #${s.number} — ${sst.pct}% completo`,
            desc: reasons.length ? `Pendiente: ${reasons.join(', ')}.` : 'Sin pendientes.',
            action: () => setRoute({ section: 'shipment', shipmentId: s.id }),
        });
    });
    const greetName = (proforma.vendor || '').split(' ')[0];
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement(Icon, { name: "home", size: 12 }),
            " Vista general"),
        React.createElement("div", { className: "hero" },
            React.createElement("div", null,
                React.createElement("p", { className: "greet" },
                    "Hola, equipo de ",
                    proforma.vendor),
                React.createElement("h1", null, "Bienvenido al portal del proveedor"),
                React.createElement("p", { className: "lead" },
                    "Aqu\u00ED vas a registrar todos los datos del env\u00EDo para la Orden de Compra ",
                    React.createElement("strong", { className: "mono" }, proforma.po_name),
                    ". No tienes que terminar de una sola vez \u2014 guardamos lo que escribas autom\u00E1ticamente y puedes volver cuando quieras."),
                React.createElement("div", { className: "hero-meta" },
                    React.createElement("div", { className: "item" },
                        React.createElement("strong", null, proforma.shipments.length),
                        "embarques"),
                    React.createElement("div", { className: "item" },
                        React.createElement("strong", null, proforma.shipments.reduce((a, s) => a + s.containers.length, 0)),
                        "contenedores"),
                    React.createElement("div", { className: "item" },
                        React.createElement("strong", null, proforma.shipments.reduce((a, s) => a + s.invoices.length, 0)),
                        "invoices"),
                    React.createElement("div", { className: "item" },
                        React.createElement("strong", null, proforma.products.reduce((a, p) => a + p.requested_qty, 0)),
                        "cantidad solicitada"))),
            React.createElement(ProgressRing, { pct: status.overall, size: 148, stroke: 10, label: status.overall === 100 ? 'listo' : 'completo' })),
        status.overall < 100 && (React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head no-divider" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Lo que te falta para terminar"),
                    React.createElement("p", { className: "sub" }, "Ordenados de lo m\u00E1s f\u00E1cil a lo m\u00E1s detallado. Comienza por el primero.")),
                React.createElement(Btn, { variant: "accent", icon: "play", onClick: () => { var _a; return (_a = pending[0]) === null || _a === void 0 ? void 0 : _a.action(); } }, status.overall > 0 ? "Continuar donde qued\u00E9" : "Comenzar")),
            React.createElement("div", { className: "chk-list" }, pending.map(p => (React.createElement("div", { key: p.id, className: "chk-item", onClick: p.action },
                React.createElement("span", { className: `chk-icon ${p.tone}` },
                    React.createElement(Icon, { name: p.tone === 'done' ? 'check' : p.tone === 'partial' ? 'minus' : 'plus', size: 14 })),
                React.createElement("div", { className: "chk-body" },
                    React.createElement("div", { className: "title" }, p.title),
                    React.createElement("div", { className: "desc" }, p.desc)),
                React.createElement(Icon, { name: "chevron_right", size: 16, className: "chevron" }))))))),
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head no-divider" },
                React.createElement("div", null,
                    React.createElement("h3", null, "Productos solicitados en esta Proforma"),
                    React.createElement("p", { className: "sub" }, "Esto es lo que SOM GROUP te pidi\u00F3. Tendr\u00E1s que registrar packing list para cada uno."))),
            React.createElement("table", { className: "tbl" },
                React.createElement("thead", null,
                    React.createElement("tr", null,
                        React.createElement("th", null, "Referencia"),
                        React.createElement("th", null, "Producto"),
                        React.createElement("th", null, "Tipo"),
                        React.createElement("th", null, "Dimensi\u00F3n"),
                        React.createElement("th", { style: { textAlign: 'right' } }, "Solicitado"))),
                React.createElement("tbody", null, proforma.products.map(p => (React.createElement("tr", { key: p.id },
                    React.createElement("td", { className: "mono" }, p.ref),
                    React.createElement("td", null,
                        React.createElement("strong", null, p.name)),
                    React.createElement("td", { className: "ink-3" }, p.kind === 'placa' ? 'Placa / Slab' : p.kind === 'formato' ? 'Formato / Tile' : 'Pieza'),
                    React.createElement("td", { className: "mono ink-3" }, p.dim_text),
                    React.createElement("td", { style: { textAlign: 'right' }, className: "mono" },
                        React.createElement("strong", null, p.requested_qty),
                        " ",
                        React.createElement("span", { className: "ink-3" }, p.unit)))))))),
        React.createElement(Callout, { tone: "info", icon: "sparkles", title: "Tip: el packing list es lo m\u00E1s detallado." },
            "Antes de capturar placa por placa, vas a configurar los ",
            React.createElement("strong", null, "bloques"),
            " que se cargar\u00E1n. El portal generar\u00E1 autom\u00E1ticamente las filas que necesitas llenar. Subiendo una foto por bloque ahorras escribir muchos detalles.")));
};
window.Overview = Overview;
// ===== src/views/globals.jsx =====
/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, ProgressRing */
const Globals = ({ proforma, setProforma, status, setRoute, validationStyle = 'inline' }) => {
    const g = proforma.globals;
    const update = (k, v) => setProforma({ ...proforma, globals: { ...g, [k]: v } });
    const errors = {};
    const errorList = Object.entries(errors);
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Datos de la Proforma"),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", null, "Datos generales de la Proforma"),
                React.createElement("p", { className: "lead" }, "Informaci\u00F3n que se aplica a todos los embarques de esta Orden de Compra. Ll\u00E9nala una sola vez al inicio.")),
            React.createElement("div", { className: "head-actions" },
                React.createElement(Badge, { tone: status.globals_status === 'done' ? 'done' : status.globals_status === 'partial' ? 'partial' : 'todo' },
                    React.createElement(Icon, { name: status.globals_status === 'done' ? 'check' : 'minus', size: 11 }),
                    status.globals_pct,
                    "% completo"))),
        validationStyle === 'sticky' && errorList.length > 0 && (React.createElement("div", { className: "val-banner" },
            React.createElement(Icon, { name: "alert", size: 16 }),
            React.createElement("div", null,
                React.createElement("strong", null,
                    errorList.length,
                    " ",
                    errorList.length === 1 ? 'campo necesita atención' : 'campos necesitan atención',
                    "."),
                ' ',
                "Corrige los puntos resaltados abajo para poder continuar."))),
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Identificaci\u00F3n"),
                    React.createElement("p", { className: "sub" }, "C\u00F3mo identifica este lote tu sistema y el nuestro."))),
            React.createElement("div", { className: "fld-row" },
                React.createElement(Field, { label: "N\u00FAmero de Proforma", required: true, help: "Es el n\u00FAmero con el que tu sistema identifica esta venta (Proforma Invoice).", helpExample: "Ej: PI-9920-A", error: validationStyle !== 'block' && errors.proforma_number },
                    React.createElement(Input, { mono: true, placeholder: "PI-9920-A", value: g.proforma_number, onChange: (e) => update('proforma_number', e.target.value) })),
                React.createElement(Field, { label: "Factura global", optional: true, help: "Si emites una factura comercial que cubre toda la PO, escr\u00EDbela aqu\u00ED. Si tienes una por embarque, d\u00E9jalo vac\u00EDo y ll\u00E9nalo en cada embarque." },
                    React.createElement(Input, { mono: true, placeholder: "INV-2026-001 (opcional)", value: g.invoice_global, onChange: (e) => update('invoice_global', e.target.value) })))),
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Observaciones generales"),
                    React.createElement("p", { className: "sub" }, "\u00BFHay algo que SOM GROUP debe saber antes de recibir? Restricciones, demoras, cuidados especiales."))),
            React.createElement(Field, { optional: true, hint: "Esto se incluir\u00E1 en la confirmaci\u00F3n final. Puedes dejarlo vac\u00EDo si no aplica." },
                React.createElement(Textarea, { rows: 3, placeholder: "Ej. Las placas vienen empacadas en bundles de madera dura. Cuidado con esquinas.", value: g.general_notes, onChange: (e) => update('general_notes', e.target.value) }))),
        validationStyle === 'block' && errorList.length > 0 && (React.createElement(Callout, { tone: "error", icon: "alert", title: `Hay ${errorList.length} ${errorList.length === 1 ? 'campo' : 'campos'} sin completar:` },
            React.createElement("ul", { style: { margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 } }, errorList.map(([k, v]) => React.createElement("li", { key: k },
                React.createElement("strong", null,
                    k,
                    ":"),
                " ",
                v))))),
        React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 } },
            React.createElement("span", { className: "text-muted text-small" },
                React.createElement(Icon, { name: "check", size: 12 }),
                " Guardado autom\u00E1tico activo"),
            React.createElement("div", { style: { display: 'flex', gap: 8 } },
                React.createElement(Btn, { variant: "ghost", onClick: () => setRoute({ section: 'overview' }) }, "Volver"),
                React.createElement(Btn, { variant: "primary", iconRight: "arrow_right", onClick: () => setRoute({ section: 'shipments' }), disabled: validationStyle === 'block' && errorList.length > 0 }, "Continuar a embarques")))));
};
window.Globals = Globals;
// ===== src/views/shipments_list.jsx =====
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
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Embarques"),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", null, "Embarques"),
                React.createElement("p", { className: "lead" }, "Cada embarque es un viaje f\u00EDsico (un buque, un vuelo o un cami\u00F3n). Puedes dividir la PO en uno o varios embarques.")),
            React.createElement("div", { className: "head-actions" },
                React.createElement(Btn, { variant: "primary", icon: "plus", onClick: () => {
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
                    } }, "Agregar embarque"))),
        proforma.shipments.length === 0 ? (React.createElement(Empty, { icon: "ship", title: "No hay embarques registrados todav\u00EDa" }, "Cuando sepas la fecha aproximada del env\u00EDo, agrega un embarque y empieza a capturar log\u00EDstica y packing list.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, proforma.shipments.map((s, idx) => {
            const sst = status.shipments_status[idx];
            return (React.createElement("div", { key: s.id, className: "ship-card", onClick: () => setRoute({ section: 'shipment', shipmentId: s.id }) },
                React.createElement("div", { className: "num" },
                    "#",
                    s.number),
                React.createElement("div", { className: "meta" },
                    React.createElement("div", { className: "title" },
                        React.createElement("span", null, s.shipping_line || React.createElement("span", { className: "text-muted" }, "Sin naviera asignada")),
                        React.createElement(Badge, { tone: STATUS_TONE[s.status], dot: true }, STATUS_LABEL[s.status] || 'Borrador'),
                        sst.status === 'done' && React.createElement(Badge, { tone: "done" },
                            React.createElement(Icon, { name: "check", size: 10 }),
                            " Completo"),
                        sst.status === 'partial' && React.createElement(Badge, { tone: "partial" },
                            React.createElement(Icon, { name: "minus", size: 10 }),
                            " ",
                            sst.pct,
                            "%"),
                        sst.status === 'todo' && React.createElement(Badge, { tone: "todo" }, "Sin datos")),
                    React.createElement("div", { className: "route" },
                        React.createElement("span", null,
                            React.createElement(Icon, { name: "anchor", size: 11 }),
                            " Destino ",
                            React.createElement("span", { className: "mono" }, proforma.globals.port_destination || '—')),
                        React.createElement("span", { className: "arrow" }, "\u00B7"),
                        React.createElement("span", null,
                            "ETD ",
                            React.createElement("span", { className: "mono" }, s.etd || '—')))),
                React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 16 } },
                    React.createElement("div", { style: { textAlign: 'right', fontSize: 12 } },
                        React.createElement("div", { className: "mono", style: { fontWeight: 700, fontSize: 16 } },
                            sst.pct,
                            "%"),
                        React.createElement("div", { className: "text-muted", style: { fontSize: 11 } }, "completo")),
                    React.createElement("div", { className: "completion", title: "Log\u00EDstica \u00B7 B/L \u00B7 Invoices \u00B7 Contenedores \u00B7 Packing" },
                        React.createElement("span", { className: `cdot ${sst.tabs.hasLog ? 'done' : ''}` }),
                        React.createElement("span", { className: `cdot ${sst.tabs.hasBL ? 'done' : ''}` }),
                        React.createElement("span", { className: `cdot ${sst.tabs.hasInv ? 'done' : ''}` }),
                        React.createElement("span", { className: `cdot ${sst.tabs.hasContainers ? 'done' : ''}` }),
                        React.createElement("span", { className: `cdot ${sst.tabs.hasPacking ? 'done' : ''}` })),
                    React.createElement(Icon, { name: "chevron_right", size: 18, style: { color: 'var(--ink-4)' } }))));
        }))),
        React.createElement(Callout, { tone: "info", icon: "info", title: "\u00BFCu\u00E1ndo divido en varios embarques?" }, "Si tu producci\u00F3n se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque est\u00E1 bien."),
        React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 24 } },
            React.createElement(Btn, { variant: "secondary", icon: "arrow_left", onClick: () => setRoute({ section: 'globals' }) }, "Volver a datos generales"),
            React.createElement(Btn, { variant: "primary", iconRight: "arrow_right", onClick: () => setRoute({ section: 'documents' }) }, "Continuar a documentos generales"))));
};
window.ShipmentsList = ShipmentsList;
window.STATUS_LABEL = STATUS_LABEL;
window.STATUS_TONE = STATUS_TONE;
// ===== src/views/shipment_detail.jsx =====
/* global React, Icon, Field, Input, Select, Textarea, Btn, Badge, Callout, Empty, Imgph, StatusDot, STATUS_LABEL, STATUS_TONE */
const SHIP_TABS = [
    { id: 'logistics', label: 'Logística + B/L', icon: 'ship' },
    { id: 'invoices', label: 'Invoices', icon: 'invoice' },
    { id: 'containers', label: 'Contenedores', icon: 'container' },
    { id: 'packings', label: 'Packing List', icon: 'box' },
    { id: 'documents', label: 'Documentos', icon: 'file' },
];
const ShipmentDetail = ({ proforma, setProforma, status, setRoute, route, openPackingWizard, onDeleteShipment, onDeletePacking }) => {
    const ship = proforma.shipments.find(s => s.id === route.shipmentId);
    const idx = proforma.shipments.findIndex(s => s.id === route.shipmentId);
    const sst = status.shipments_status[idx];
    const [tab, setTab] = React.useState(route.tab || 'logistics');
    React.useEffect(() => { if (route.tab)
        setTab(route.tab); }, [route.tab]);
    if (!ship)
        return React.createElement(Empty, { title: "Embarque no encontrado" });
    const updateShip = (patch) => {
        setProforma({
            ...proforma,
            shipments: proforma.shipments.map(s => s.id === ship.id ? { ...s, ...patch } : s),
        });
    };
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            React.createElement("a", { onClick: () => setRoute({ section: 'shipments' }) }, "Embarques"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Embarque #",
            ship.number),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
                    "Embarque #",
                    ship.number,
                    React.createElement(Badge, { tone: STATUS_TONE[ship.status], dot: true }, STATUS_LABEL[ship.status] || 'Borrador')),
                React.createElement("p", { className: "lead" }, ship.shipping_line ? React.createElement("span", null,
                    "Naviera ",
                    React.createElement("strong", null, ship.shipping_line),
                    ".") :
                    React.createElement("span", null, "A\u00FAn sin naviera. Empieza por la pesta\u00F1a de Log\u00EDstica."))),
            React.createElement("div", { className: "head-actions" },
                React.createElement("span", { className: "text-muted text-small" },
                    sst.pct,
                    "% completo"),
                React.createElement(Btn, { variant: "ghost", icon: "trash", className: "btn-danger-ghost", onClick: () => {
                        if (typeof onDeleteShipment === 'function' && window.confirm(`¿Eliminar el embarque #${ship.number}? Se borrarán sus invoices, contenedores y packing lists. Esta acción no se puede deshacer.`))
                            onDeleteShipment(ship.id);
                    } }, "Eliminar embarque"))),
        React.createElement("div", { className: "tabs" }, SHIP_TABS.map(t => {
            const done = t.id === 'logistics' ? sst.tabs.hasLog && sst.tabs.hasBL :
                t.id === 'invoices' ? sst.tabs.hasInv :
                    t.id === 'containers' ? sst.tabs.hasContainers :
                        t.id === 'packings' ? sst.tabs.hasPacking : null;
            const count = t.id === 'invoices' ? ship.invoices.length :
                t.id === 'containers' ? ship.containers.length :
                    t.id === 'packings' ? ship.packings.length :
                        t.id === 'documents' ? ship.documents.length : null;
            return (React.createElement("button", { key: t.id, className: `tab ${tab === t.id ? 'active' : ''}`, onClick: () => setTab(t.id) },
                React.createElement(Icon, { name: t.icon, size: 14 }),
                t.label,
                done === true && React.createElement("span", { className: "badge done", style: { padding: '1px 6px', fontSize: 10 } },
                    React.createElement(Icon, { name: "check", size: 9 })),
                done === false && React.createElement("span", { className: "badge todo", style: { padding: '1px 6px', fontSize: 10 } }, "\u00B7"),
                count != null && count > 0 && React.createElement("span", { className: "badge accent", style: { padding: '1px 6px', fontSize: 10 } }, count)));
        })),
        tab === 'logistics' && React.createElement(TabLogistics, { ship: ship, updateShip: updateShip }),
        tab === 'invoices' && React.createElement(TabInvoices, { ship: ship, updateShip: updateShip }),
        tab === 'containers' && React.createElement(TabContainers, { ship: ship, updateShip: updateShip }),
        tab === 'packings' && React.createElement(TabPackings, { ship: ship, updateShip: updateShip, openPackingWizard: openPackingWizard, proforma: proforma, onDeletePacking: onDeletePacking }),
        tab === 'documents' && React.createElement(TabDocuments, { ship: ship, updateShip: updateShip }),
        React.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 24 } },
            React.createElement(Btn, { variant: "secondary", icon: "arrow_left", onClick: () => { const i = SHIP_TABS.findIndex(x => x.id === tab); if (i > 0) setTab(SHIP_TABS[i - 1].id); else setRoute({ section: 'shipments' }); } }, "Retroceder"),
            React.createElement(Btn, { variant: "primary", iconRight: "arrow_right", onClick: () => { const i = SHIP_TABS.findIndex(x => x.id === tab); if (i < SHIP_TABS.length - 1) setTab(SHIP_TABS[i + 1].id); else setRoute({ section: 'shipments' }); } }, "Avanzar"))));
};
/* ============================================================
   Logistics + B/L tab
   ============================================================ */
const TabLogistics = ({ ship, updateShip }) => (React.createElement("div", null,
    React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Datos de log\u00EDstica"),
                React.createElement("p", { className: "sub" }, "Informaci\u00F3n del transporte. La obtienes de tu agente de carga (forwarder)."))),
        React.createElement("div", { className: "fld-row cols-3" },
            React.createElement(Field, { label: "Tipo de transporte", required: true, help: "C\u00F3mo viaja f\u00EDsicamente la mercanc\u00EDa." },
                React.createElement(Select, { value: ship.type, onChange: (e) => updateShip({ type: e.target.value }) },
                    React.createElement("option", { value: "" }, "Selecciona\u2026"),
                    React.createElement("option", { value: "maritime" }, "Mar\u00EDtimo"),
                    React.createElement("option", { value: "air" }, "A\u00E9reo"),
                    React.createElement("option", { value: "land" }, "Terrestre"))),
            React.createElement(Field, { label: "Naviera / Aerol\u00EDnea", required: true, help: "Compa\u00F1\u00EDa que opera el transporte.", helpExample: "COSCO, MSC, Hapag-Lloyd\u2026" },
                React.createElement(Input, { placeholder: "Ej. COSCO Shipping Lines", value: ship.shipping_line, onChange: (e) => updateShip({ shipping_line: e.target.value }) })),
            React.createElement(Field, { label: "ETD", required: true, help: "Estimated Time of Departure \u2014 fecha estimada de salida del puerto origen." },
                React.createElement(Input, { type: "date", value: ship.etd, onChange: (e) => updateShip({ etd: e.target.value }) })))),
    React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Bill of Lading (B/L)"),
                React.createElement("p", { className: "sub" }, "El B/L es el documento que prueba que la naviera recibi\u00F3 tu mercanc\u00EDa. S\u00FAbelo en cuanto lo recibas \u2014 sin \u00E9l, aduanas no libera el embarque.")),
            React.createElement(Badge, { tone: ship.bl_number ? 'done' : 'todo' }, ship.bl_number ? React.createElement(React.Fragment, null,
                React.createElement(Icon, { name: "check", size: 11 }),
                " Cargado") : 'Pendiente')),
        React.createElement("div", { className: "fld-row cols-2" },
            React.createElement(Field, { label: "N\u00FAmero de B/L", required: true, help: "El n\u00FAmero \u00FAnico que asigna la naviera a tu embarque.", helpExample: "COSU6817042500" },
                React.createElement(Input, { mono: true, placeholder: "Ej. COSU6817042500", value: ship.bl_number, onChange: (e) => updateShip({ bl_number: e.target.value }) })),
            React.createElement(Field, { label: "Fecha de B/L", required: true, help: "Fecha que aparece impresa en el documento." },
                React.createElement(Input, { type: "date", value: ship.bl_date, onChange: (e) => updateShip({ bl_date: e.target.value }) }))))));
/* ============================================================
   Invoices tab
   ============================================================ */
// Convierte un texto monetario a número, entendiendo formato anglosajón
// (coma=miles, punto=decimal → 1,234.56) Y europeo (punto=miles, coma=decimal →
// 1.234,56). Heurística: si hay ambos separadores, el ÚLTIMO es el decimal; si hay
// uno solo, es decimal salvo que tenga exactamente 3 dígitos detrás (entonces miles).
const parseMoney = (raw) => {
    let s = String(raw == null ? '' : raw).trim().replace(/[^0-9.,-]/g, '');
    if (!s)
        return 0;
    const neg = s.charAt(0) === '-';
    s = s.replace(/-/g, '');
    const hasC = s.indexOf(',') >= 0, hasD = s.indexOf('.') >= 0;
    let dec = '';
    if (hasC && hasD)
        dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    else if (hasC) {
        const p = s.split(',');
        dec = (p.length === 2 && p[1].length !== 3) ? ',' : '';
    }
    else if (hasD) {
        const p = s.split('.');
        dec = (p.length === 2 && p[1].length !== 3) ? '.' : '';
    }
    let intp, decp = '';
    if (dec) {
        const i = s.lastIndexOf(dec);
        intp = s.slice(0, i).replace(/[.,]/g, '');
        decp = s.slice(i + 1).replace(/[.,]/g, '');
    }
    else {
        intp = s.replace(/[.,]/g, '');
    }
    const num = parseFloat((intp || '0') + (decp ? '.' + decp : '')) || 0;
    return neg ? -num : num;
};
// Formatea un número al estándar anglosajón con 2 decimales (1,234.56).
const formatMoneyEN = (num) => (Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TabInvoices = ({ ship, updateShip }) => {
    const addInvoice = () => {
        const newInv = { id: 'inv' + Date.now(), number: '', date: '', amount: 0, currency: 'USD', scope: 'full', containers: [] };
        updateShip({ invoices: [...ship.invoices, newInv] });
    };
    const updInv = (id, patch) => updateShip({ invoices: ship.invoices.map(i => i.id === id ? { ...i, ...patch } : i) });
    const delInv = (id) => updateShip({ invoices: ship.invoices.filter(i => i.id !== id) });
    return (React.createElement("div", null,
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Invoices (Facturas comerciales)"),
                    React.createElement("p", { className: "sub" }, "La factura comercial que emites para el embarque. Puede ser una global o varias parciales.")),
                React.createElement(Btn, { variant: "primary", icon: "plus", size: "sm", onClick: addInvoice }, "Agregar invoice")),
            ship.invoices.length === 0 ? (React.createElement(Empty, { icon: "invoice", title: "A\u00FAn no hay invoices" }, "Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores espec\u00EDficos.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                ship.invoices.map((inv, i) => (React.createElement("div", { key: inv.id, style: { border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface-alt)' } },
                    React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
                        React.createElement("strong", { style: { fontSize: 13 } },
                            "Invoice ",
                            i + 1),
                        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", onClick: () => delInv(inv.id) }, "Eliminar")),
                    React.createElement("div", { className: "fld-row cols-3" },
                        React.createElement(Field, { label: "No. Invoice", required: true },
                            React.createElement(Input, { mono: true, placeholder: "Ej. JQ-INV-2026-088", value: inv.number, onChange: (e) => updInv(inv.id, { number: e.target.value }) })),
                        React.createElement(Field, { label: "Fecha", required: true },
                            React.createElement(Input, { type: "date", value: inv.date, onChange: (e) => updInv(inv.id, { date: e.target.value }) })),
                        React.createElement(Field, { label: "Monto + moneda", required: true, hint: "Formato anglosajón: coma para miles y punto para decimales (ej. 1,234.56). Si lo escribes en formato europeo (1.234,56) lo convertimos automáticamente al salir del campo." },
                            React.createElement("div", { style: { display: 'flex', gap: 8 } },
                                React.createElement(Input, { mono: true, inputMode: "decimal", style: { flex: 1 }, placeholder: "1,234.56", value: (inv.amountText !== undefined ? inv.amountText : (inv.amount ? formatMoneyEN(inv.amount) : '')), onChange: (e) => { const raw = e.target.value.replace(/[^0-9.,\s-]/g, ''); updInv(inv.id, { amount: parseMoney(raw), amountText: raw }); }, onBlur: () => { const t = (inv.amountText !== undefined ? inv.amountText : '').trim(); if (!t) { updInv(inv.id, { amount: 0, amountText: '' }); return; } const num = parseMoney(t); updInv(inv.id, { amount: num, amountText: formatMoneyEN(num) }); } }),
                                React.createElement(Select, { style: { width: 90 }, value: inv.currency, onChange: (e) => updInv(inv.id, { currency: e.target.value }) }, ['USD', 'EUR', 'CNY', 'MXN'].map(c => React.createElement("option", { key: c }, c))))))))),
                React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-soft)' } },
                    React.createElement("span", { className: "text-muted text-small" }, "Total facturado en este embarque"),
                    React.createElement("strong", { className: "mono", style: { fontSize: 18 } },
                        ship.invoices.reduce((a, i) => a + (i.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        " USD")))))));
};
/* ============================================================
   Containers tab
   ============================================================ */
const TabContainers = ({ ship, updateShip }) => {
    const addC = () => updateShip({ containers: [...ship.containers, { id: 'c' + Date.now(), number: '', seal: '', type: '40HQ', weight: 0, volume: 0, packages: 0 }] });
    const updC = (id, patch) => updateShip({ containers: ship.containers.map(c => c.id === id ? { ...c, ...patch } : c) });
    const delC = (id) => updateShip({ containers: ship.containers.filter(c => c.id !== id) });
    return (React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Contenedores"),
                React.createElement("p", { className: "sub" }, "Cada caja f\u00EDsica que viaja en el embarque. Los n\u00FAmeros son los que est\u00E1n pintados en el contenedor (4 letras + 7 d\u00EDgitos).")),
            React.createElement(Btn, { variant: "primary", icon: "plus", size: "sm", onClick: addC }, "Agregar contenedor")),
        ship.containers.length === 0 ? (React.createElement(Empty, { icon: "container", title: "Sin contenedores" }, "Captura los n\u00FAmeros de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, ship.containers.map((c, i) => {
            const isBad = c.number && !/^[A-Z]{4}\d{7}$/.test(c.number);
            return (React.createElement("div", { key: c.id, style: {
                    border: '1px solid var(--border)', borderRadius: 12, padding: 16,
                    background: 'var(--surface-alt)', position: 'relative',
                } },
                React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border-soft)' } },
                    React.createElement("div", { style: {
                            width: 40, height: 40, borderRadius: 10,
                            background: 'var(--ink)', color: 'white',
                            display: 'grid', placeItems: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 14
                        } }, String(i + 1).padStart(2, '0')),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("strong", { style: { fontSize: 14 } }, c.number || React.createElement("span", { className: "text-muted" }, "Contenedor sin n\u00FAmero")),
                        React.createElement("div", { className: "text-muted", style: { fontSize: 12, marginTop: 2 } },
                            c.type,
                            " \u00B7 ",
                            (c.weight || 0).toLocaleString(),
                            " kg \u00B7 ",
                            (c.volume || 0).toFixed(1),
                            " m\u00B3 \u00B7 ",
                            c.packages || 0,
                            " paquetes")),
                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", onClick: () => delC(c.id) }, "Eliminar")),
                React.createElement("div", { className: "fld-row cols-3" },
                    React.createElement(Field, { label: "No. Contenedor", required: true, help: "4 letras (c\u00F3digo de naviera) + 7 d\u00EDgitos. Est\u00E1 pintado en grande en el costado del contenedor.", helpExample: "COSU6817042", error: isBad ? 'Formato: 4 letras + 7 dígitos (ej. COSU6817042)' : null },
                        React.createElement(Input, { mono: true, placeholder: "COSU6817042", value: c.number, onChange: (e) => updC(c.id, { number: e.target.value.toUpperCase() }) })),
                    React.createElement(Field, { label: "No. de Sello", required: true, help: "Sello de seguridad que se rompe al abrir el contenedor." },
                        React.createElement(Input, { mono: true, placeholder: "CN8821044", value: c.seal, onChange: (e) => updC(c.id, { seal: e.target.value.toUpperCase() }) })),
                    React.createElement(Field, { label: "Tipo", required: true },
                        React.createElement(Select, { value: c.type, onChange: (e) => updC(c.id, { type: e.target.value }) },
                            React.createElement("option", null, "20GP"),
                            React.createElement("option", null, "40GP"),
                            React.createElement("option", null, "40HQ"),
                            React.createElement("option", null, "45HQ")))),
                React.createElement("div", { className: "fld-row cols-3", style: { marginTop: 14 } },
                    React.createElement(Field, { label: "Peso bruto (kg)" },
                        React.createElement(Input, { mono: true, type: "number", placeholder: "27500", value: c.weight || '', onChange: (e) => updC(c.id, { weight: +e.target.value }) })),
                    React.createElement(Field, { label: "Volumen (m\u00B3)" },
                        React.createElement(Input, { mono: true, type: "number", step: "0.1", placeholder: "67.2", value: c.volume || '', onChange: (e) => updC(c.id, { volume: +e.target.value }) })),
                    React.createElement(Field, { label: "No. de paquetes / bultos" },
                        React.createElement(Input, { mono: true, type: "number", placeholder: "12", value: c.packages || '', onChange: (e) => updC(c.id, { packages: +e.target.value }) })))));
        })))));
};
/* ============================================================
   Packings tab — lists packings, button to open wizard
   ============================================================ */
const TabPackings = ({ ship, updateShip, openPackingWizard, proforma, onDeletePacking }) => {
    return (React.createElement("div", null,
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Packing Lists"),
                    React.createElement("p", { className: "sub" },
                        "Aqu\u00ED registras placa por placa (o pieza por pieza) lo que va en cada contenedor. ",
                        React.createElement("strong", null, "Es la parte m\u00E1s detallada."),
                        " Te guiaremos con un asistente.")),
                React.createElement(Btn, { variant: "primary", icon: "plus", onClick: () => openPackingWizard(ship.id, null) }, "Nuevo packing")),
            ship.packings.length === 0 ? (React.createElement(Empty, { icon: "box", title: "Sin packing lists todav\u00EDa" },
                "El asistente te llevar\u00E1 paso a paso: ",
                React.createElement("strong", null, "1)"),
                " Eliges productos \u00B7 ",
                React.createElement("strong", null, "2)"),
                " Configuras bloques con foto \u00B7 ",
                React.createElement("strong", null, "3)"),
                " Llenas placa por placa.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, ship.packings.map(pk => {
                const product = proforma.products.find(p => pk.products.includes(p.id));
                const photosOk = pk.blocks.every(b => b.photo);
                const rowsOk = pk.rows_filled === pk.rows_total;
                const fullyOk = photosOk && rowsOk;
                return (React.createElement("div", { key: pk.id, style: {
                        border: '1px solid var(--border)', borderRadius: 12, padding: 16,
                        display: 'flex', alignItems: 'center', gap: 16, background: 'var(--surface)'
                    } },
                    React.createElement("div", { style: { width: 48, height: 48, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)',
                            display: 'grid', placeItems: 'center' } },
                        React.createElement(Icon, { name: "box", size: 20 })),
                    React.createElement("div", { style: { flex: 1 } },
                        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 } },
                            React.createElement("strong", { className: "mono" }, pk.number),
                            React.createElement(Badge, { tone: fullyOk ? 'done' : 'partial' }, fullyOk ? React.createElement(React.Fragment, null,
                                React.createElement(Icon, { name: "check", size: 10 }),
                                " Completo") : `${pk.rows_filled}/${pk.rows_total} filas`)),
                        React.createElement("div", { className: "text-muted", style: { fontSize: 12.5 } }, product === null || product === void 0 ? void 0 :
                            product.name,
                            " \u00B7 ",
                            pk.blocks.length,
                            " bloques",
                            !photosOk && React.createElement("span", { style: { color: 'var(--warn)', marginLeft: 8 } },
                                React.createElement(Icon, { name: "alert", size: 10 }),
                                " ",
                                pk.blocks.filter(b => !b.photo).length,
                                " bloques sin foto"))),
                    React.createElement("div", { style: { display: 'flex', gap: 8 } },
                        React.createElement(Btn, { variant: "secondary", icon: "pencil", onClick: () => openPackingWizard(ship.id, pk.id) }, "Editar"),
                        React.createElement(Btn, { variant: "ghost", icon: "trash", className: "btn-danger-ghost", onClick: () => {
                                if (typeof onDeletePacking === 'function' && window.confirm(`¿Eliminar el packing list ${pk.number}? Se borrarán todas sus filas. Esta acción no se puede deshacer.`))
                                    onDeletePacking(ship.id, pk.id);
                            } }, "Eliminar"))));
            })))),
        React.createElement(Callout, { tone: "info", icon: "sparkles", title: "C\u00F3mo funciona el asistente" },
            "En lugar de que escribas mil l\u00EDneas a mano, el asistente ",
            React.createElement("strong", null, "genera las filas autom\u00E1ticamente"),
            " con base en los bloques que configures. T\u00FA solo agregas dimensiones y subes una foto por bloque.")));
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
        { kind: 'BL', docType: 'bl', label: 'Bill of Lading (B/L)', desc: 'El PDF del B/L que emite la naviera. Es obligatorio: sin él, aduanas no libera el embarque.', required: true },
        { kind: 'INV', docType: 'invoice', label: 'Invoice (factura comercial)', desc: 'El PDF de la factura comercial de este embarque. Obligatorio para poder cerrar el embarque.', required: true },
        { kind: 'PACKING', docType: 'packing_list', label: 'Packing List (documento)', desc: 'El PDF u hoja de cálculo (xlsx/csv) del packing list de este embarque. Obligatorio para cerrar el embarque.', required: true, spreadsheet: true },
        { kind: 'CO', docType: 'certificate_origin', label: 'Certificate of Origin', desc: 'Certifica el país donde se fabricó la mercancía. Lo emite la Cámara de Comercio local.' },
        { kind: 'PHYTO', docType: 'fumigation', label: 'Certificado fitosanitario / fumigación', desc: 'Si la mercancía incluye empaque de madera, certifica que está fumigada (HT/MB).' },
        { kind: 'EUR1', docType: 'eur1', label: 'EUR.1 (certificado de circulación)', desc: 'Certificado de circulación de mercancías, cuando aplica para la Unión Europea.' },
    ];
    const [busy, setBusy] = React.useState(null);
    const api = (typeof window !== 'undefined' && window.__supplierPortalApi) || null;
    const pickDoc = async (dt, file) => {
        if (!file)
            return;
        if (!api || !api.token) {
            window.alert('No se puede subir el documento: el portal no tiene sesión activa.');
            return;
        }
        const fname = (file.name || '').toLowerCase();
        const isPdf = file.type === 'application/pdf' || fname.endsWith('.pdf');
        const isSheet = !!dt.spreadsheet && (/(\.xlsx|\.xls|\.csv)$/.test(fname) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || (file.type || '').indexOf('spreadsheet') >= 0);
        if (!isPdf && !isSheet) {
            window.alert(dt.spreadsheet ? 'Solo se permiten archivos PDF o una hoja de cálculo (xlsx, xls, csv).' : 'Solo se permiten archivos PDF.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            window.alert('El archivo supera el máximo de 10 MB.');
            return;
        }
        setBusy(dt.kind);
        try {
            // El embarque debe existir en el servidor para adjuntarle documentos. Si
            // es local (id temporal), forzamos el guardado y reintentamos.
            let shipmentId = api.resolveRealId('shipments', ship.id);
            if (!shipmentId && typeof api.flush === 'function') {
                await api.flush();
                shipmentId = api.resolveRealId('shipments', ship.id);
            }
            if (!shipmentId) {
                window.alert('Primero guarda el embarque (espera unos segundos a que se sincronice) e intenta de nuevo.');
                return;
            }
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
            if (!res || !res.success) {
                window.alert((res && res.message) || 'No se pudo subir el documento.');
                return;
            }
            updateShip({ documents: mapServerDocs(res.documents) });
        }
        catch (err) {
            console.error('[SupplierPortal] Error subiendo documento:', err);
            window.alert('Ocurrió un error al subir el documento: ' + (err && err.message ? err.message : err));
        }
        finally {
            setBusy(null);
        }
    };
    const deleteDoc = async (dt, doc) => {
        if (!api || !api.token || !doc)
            return;
        if (!window.confirm('¿Eliminar "' + doc.name + '"?'))
            return;
        setBusy(dt.kind);
        try {
            const res = await portalRpc('/supplier/api/v2/delete_document', { token: api.token, document_id: doc.id });
            if (!res || !res.success) {
                window.alert((res && res.message) || 'No se pudo eliminar el documento.');
                return;
            }
            updateShip({ documents: mapServerDocs(res.documents) });
        }
        catch (err) {
            console.error('[SupplierPortal] Error eliminando documento:', err);
            window.alert('Ocurrió un error al eliminar el documento.');
        }
        finally {
            setBusy(null);
        }
    };
    return (React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Documentos del embarque"),
                React.createElement("p", { className: "sub" }, "Sube los documentos legales y de calidad que acompa\u00F1an este embarque. Solo PDF, m\u00E1ximo 10 MB."))),
        React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 18 } }, DOC_TYPES.map(dt => {
            const doc = ship.documents.find(d => d.kind === dt.kind);
            const isBusy = busy === dt.kind;
            return (React.createElement("div", { key: dt.kind, style: {
                    border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface)',
                    display: 'flex', flexDirection: 'column', gap: 10
                } },
                React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
                    React.createElement("div", null,
                        React.createElement("strong", { style: { fontSize: 13.5, display: 'block', marginBottom: 4 } }, dt.label),
                        React.createElement("div", { className: "text-muted", style: { fontSize: 12, lineHeight: 1.45 } }, dt.desc)),
                    doc ? React.createElement(Badge, { tone: "done" },
                        React.createElement(Icon, { name: "check", size: 10 }))
                        : React.createElement(Badge, { tone: dt.required ? 'warn' : 'todo' }, dt.required ? 'Obligatorio' : 'Pendiente')),
                doc ? (React.createElement("div", { className: "doc-row", style: { padding: '8px 10px' } },
                    React.createElement("div", { className: "doc-icon", style: { width: 28, height: 28 } },
                        React.createElement(Icon, { name: "file", size: 14 })),
                    React.createElement("div", { className: "doc-meta" },
                        React.createElement("div", { className: "name", style: { fontSize: 12.5 } }, doc.name),
                        React.createElement("div", { className: "meta" },
                            (doc.size / 1024).toFixed(0),
                            " KB \u00B7 ",
                            doc.uploaded)),
                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", disabled: isBusy, onClick: () => deleteDoc(dt, doc) }))) : (React.createElement("label", { className: `btn btn-secondary sm ${isBusy ? 'is-disabled' : ''}`, style: { cursor: isBusy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' } },
                    React.createElement("input", { type: "file", accept: dt.spreadsheet ? "application/pdf,.pdf,.xlsx,.xls,.csv" : "application/pdf,.pdf", style: { display: 'none' }, disabled: isBusy, onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickDoc(dt, f); } }),
                    React.createElement(Icon, { name: "upload", size: 13 }),
                    isBusy ? 'Subiendo…' : 'Subir'))));
        }))));
};
window.ShipmentDetail = ShipmentDetail;
// ===== src/views/packing_wizard.jsx =====
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
const PackingWizard = ({ proforma, shipmentId, packingId, onClose, onSave, sampleRows, pendingImages }) => {
    const ship = proforma.shipments.find(s => s.id === shipmentId);
    const existing = packingId ? ship.packings.find(p => p.id === packingId) : null;
    // determine starting step: if editing and already has rows, jump to step 4
    const initialStep = existing ? (existing.rows_filled > 0 ? 4 : 3) : 1;
    const [step, setStep] = React.useState(initialStep);
    const [draft, setDraft] = React.useState(() => existing ? {
        number: existing.number,
        date: existing.date,
        products: existing.products,
        blocks: existing.blocks.map(b => ({ ...b })),
    } : {
        number: '',
        date: new Date().toISOString().slice(0, 10),
        products: [],
        blocks: [],
    });
    // rows for spreadsheet (only used in step 4)
    const [rows, setRows] = React.useState(() => {
        if (existing && Array.isArray(existing.rows) && existing.rows.length > 0) {
            return existing.rows.map(r => ({ ...r }));
        }
        if (existing && existing.id === 'pk1') return [...sampleRows];
        return [];
    });
    const commitAndClose = () => {
        if (typeof onSave === 'function') {
            onSave(shipmentId, packingId, draft, rows);
        }
        onClose();
    };
    // Firma de la estructura de bloques. Si cambia (el usuario corrigió la
    // selección de productos o ajustó bloques), hay que REGENERAR las filas.
    const blocksSig = draft.blocks.map(b => `${b.id}:${b.product}:${b.count}:${b.name}`).join('|');
    // Firma con la que se generaron las filas actuales. null = aún no generado.
    const genSigRef = React.useRef(null);
    // Genera (o regenera) las filas a partir de los bloques. Conserva los datos
    // ya capturados de los bloques que no cambiaron (match por id de fila).
    React.useEffect(() => {
        if (step !== 4 || draft.blocks.length === 0)
            return;
        const needGen = rows.length === 0 || (genSigRef.current !== null && genSigRef.current !== blocksSig);
        if (!needGen) {
            // p. ej. al abrir un packing existente: registramos la base para
            // detectar cambios futuros, sin sobreescribir lo ya capturado.
            genSigRef.current = blocksSig;
            return;
        }
        const KEEP = ['h', 'w', 'thickness', 'container', 'container_id', 'notes', 'photo', 'quantity', 'weight', 'plate', 'atado', 'grupo', 'pedimento', 'ref'];
        const prevById = {};
        rows.forEach(r => { prevById[r.id] = r; });
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
                    block: b.name, atado: `A-${String(bi + 1).padStart(2, '0')}`,
                    plate: `P-${String(generated.length + 1).padStart(3, '0')}`,
                    ref: product.ref || '', thickness: 2, h: 0, w: 0, quantity: tipo === 'Placa' ? 0 : 1, weight: 0, notes: '', grupo: '', pedimento: '', container: '', container_id: false, photo: false, errors: [],
                    blockStart: i === 0,
                };
                const prev = prevById[id];
                if (prev)
                    KEEP.forEach(k => { if (prev[k] !== undefined) base[k] = prev[k]; });
                generated.push(base);
            }
        });
        genSigRef.current = blocksSig;
        setRows(generated);
    }, [step, blocksSig]);
    const canNext = () => {
        if (step === 1)
            return draft.products.length > 0;
        if (step === 2)
            return draft.blocks.length > 0 && draft.blocks.every(b => b.name && b.count > 0);
        return true;
    };
    return (React.createElement("div", { className: "modal-scrim", onClick: (e) => e.target === e.currentTarget && commitAndClose() },
        React.createElement("div", { className: `modal ${step === 4 ? 'modal-wide' : ''}`, style: { maxWidth: step === 4 ? 1280 : 880 } },
            React.createElement("div", { className: "modal-head" },
                React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 } },
                        "Embarque #",
                        ship.number,
                        " \u00B7 ",
                        existing ? 'Editar' : 'Nuevo',
                        " packing list"),
                    React.createElement("h2", null, step === 1 ? 'Para empezar, ¿qué producto vas a empacar?' :
                        step === 2 ? 'Configura los bloques' :
                            step === 3 ? 'Revisa la estructura antes de capturar' :
                                'Captura placa por placa'),
                    React.createElement("p", { className: "sub" },
                        step === 1 && 'Selecciona uno o más productos de la PO. Cada packing list puede incluir varios productos.',
                        step === 2 && 'Un bloque agrupa placas que vienen del mismo bloque de cantera. Define cuántas placas hay en cada uno.',
                        step === 3 && 'Confirmamos cuántas filas vamos a generar. Si algo no cuadra, regresa al paso anterior.',
                        step === 4 && 'Las filas ya están creadas. Solo llena las dimensiones de cada placa y asigna su contenedor.')),
                React.createElement("button", { className: "icon-btn", onClick: commitAndClose, "aria-label": "Cerrar" },
                    React.createElement(Icon, { name: "x", size: 16 }))),
            React.createElement("div", { className: "modal-body", style: { background: step === 4 ? 'var(--bg)' : 'var(--surface)' } },
                React.createElement("div", { className: "stepper" }, WIZARD_STEPS.map((s, i) => (React.createElement(React.Fragment, { key: s.id },
                    React.createElement("div", { className: `step ${step === s.id ? 'active' : step > s.id ? 'done' : ''}` },
                        React.createElement("span", { className: "n" }, step > s.id ? React.createElement(Icon, { name: "check", size: 12 }) : s.id),
                        React.createElement("span", null, s.label)),
                    i < WIZARD_STEPS.length - 1 && React.createElement("span", { className: "step-sep" }))))),
                step === 1 && React.createElement(Step1Products, { proforma: proforma, draft: draft, setDraft: setDraft }),
                step === 2 && React.createElement(Step2Blocks, { proforma: proforma, draft: draft, setDraft: setDraft, pendingImages: pendingImages }),
                step === 3 && React.createElement(Step3Review, { proforma: proforma, draft: draft }),
                step === 4 && React.createElement(Step4Sheet, { proforma: proforma, draft: draft, rows: rows, setRows: setRows, ship: ship, pendingImages: pendingImages })),
            React.createElement("div", { className: "modal-foot" },
                React.createElement("div", null, step > 1 && step < 4 && React.createElement(Btn, { variant: "ghost", icon: "arrow_left", onClick: () => setStep(step - 1) }, "Anterior")),
                React.createElement("div", { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    React.createElement("span", { className: "text-muted text-small" }, step === 4 && (React.createElement("span", null,
                        React.createElement(Icon, { name: "check", size: 11 }),
                        " Autoguardado \u00B7 hace un momento"))),
                    step < 3 && (React.createElement(Btn, { variant: "primary", iconRight: "arrow_right", disabled: !canNext(), onClick: () => setStep(step + 1) },
                        "Siguiente: ",
                        WIZARD_STEPS[step].label)),
                    step === 3 && (React.createElement(React.Fragment, null,
                        React.createElement(Btn, { variant: "ghost", onClick: () => setStep(2) }, "Ajustar bloques"),
                        React.createElement(Btn, { variant: "accent", icon: "sparkles", onClick: () => setStep(4) },
                            "Generar ",
                            draft.blocks.reduce((a, b) => a + b.count, 0),
                            " filas"))),
                    step === 4 && (React.createElement(Btn, { variant: "primary", icon: "check", onClick: commitAndClose }, "Listo, volver al embarque")))))));
};
/* ====================== Step 1 ====================== */
const Step1Products = ({ proforma, draft, setDraft }) => {
    const toggle = (id) => {
        const has = draft.products.includes(id);
        setDraft({ ...draft, products: has ? draft.products.filter(p => p !== id) : [...draft.products, id] });
    };
    return (React.createElement("div", null,
        React.createElement("div", { className: "fld-row", style: { marginBottom: 18 } },
            React.createElement(Field, { label: "No. del Packing", required: true, help: "Identifica este documento. Suele ser una variante de la invoice.", helpExample: "PK-2026-088-A" },
                React.createElement(Input, { mono: true, placeholder: "Agregar folio", value: draft.number, onChange: (e) => setDraft({ ...draft, number: e.target.value }) })),
            React.createElement(Field, { label: "Fecha del Packing", required: true },
                React.createElement(Input, { type: "date", value: draft.date, onChange: (e) => setDraft({ ...draft, date: e.target.value }) }))),
        React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 } }, "Productos solicitados en esta PO"),
        React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, proforma.products.map(p => {
            const selected = draft.products.includes(p.id);
            return (React.createElement("label", { key: p.id, style: {
                    display: 'flex', alignItems: 'center', gap: 14, padding: 14,
                    border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                    borderRadius: 12, cursor: 'pointer'
                } },
                React.createElement("input", { type: "checkbox", checked: selected, onChange: () => toggle(p.id), style: { width: 18, height: 18, accentColor: 'var(--accent)' } }),
                React.createElement("div", { style: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0 } },
                    React.createElement(Imgph, { style: { width: '100%', height: '100%' } }, p.kind)),
                React.createElement("div", { style: { flex: 1 } },
                    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                        React.createElement("strong", null, p.name),
                        React.createElement(Badge, { tone: "draft", className: "mono" }, p.ref)),
                    React.createElement("div", { className: "text-muted", style: { fontSize: 12.5, marginTop: 2 } },
                        p.kind === 'placa' ? 'Placa / Slab' : 'Formato / Tile',
                        " \u00B7 ",
                        p.dim_text)),
                React.createElement("div", { style: { textAlign: 'right' } },
                    React.createElement("div", { className: "mono", style: { fontWeight: 700, fontSize: 17 } }, p.requested_qty),
                    React.createElement("div", { className: "text-muted", style: { fontSize: 11 } },
                        p.unit,
                        " solicitados"))));
        }))));
};
/* ====================== Step 2 ====================== */
const Step2Blocks = ({ proforma, draft, setDraft, pendingImages }) => {
    const products = proforma.products.filter(p => draft.products.includes(p.id));
    const addBlock = (productId) => {
        const newBlock = {
            id: 'b' + Date.now() + Math.random().toString(36).slice(2, 6),
            name: '', count: 0, photo: false, product: productId,
        };
        setDraft({ ...draft, blocks: [...draft.blocks, newBlock] });
    };
    const updBlock = (id, patch) => setDraft({ ...draft, blocks: draft.blocks.map(b => b.id === id ? { ...b, ...patch } : b) });
    const delBlock = (id) => setDraft({ ...draft, blocks: draft.blocks.filter(b => b.id !== id) });
    // Captura real de la foto del bloque: guarda el base64 en pendingImages (se
    // sube al persistir) y muestra una vista previa inmediata.
    const pickBlockPhoto = (b, file) => {
        if (!file)
            return;
        const preview = URL.createObjectURL(file);
        fileToBase64(file).then(({ data, name }) => {
            if (pendingImages && pendingImages.current)
                pendingImages.current.blocks[b.id] = { data, name };
            updBlock(b.id, { photo: true, image_preview: preview });
        });
    };
    const blockPhotoSrc = (b) => b.image_preview || (b.block_image_id ? `/web/image/supplier.shipment.block.image/${b.block_image_id}/image` : '');
    return (React.createElement("div", null,
        React.createElement(Callout, { tone: "info", icon: "info", title: "\u00BFQu\u00E9 es un bloque?" }, "Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generar\u00E1 autom\u00E1ticamente 48 filas para llenar."),
        React.createElement("div", { style: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 24 } }, products.map(p => {
            const productBlocks = draft.blocks.filter(b => b.product === p.id);
            const needsPhoto = (p.kind || 'placa') === 'placa';
            return (React.createElement("div", { key: p.id },
                React.createElement("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
                    React.createElement("div", null,
                        React.createElement("strong", { style: { fontSize: 14 } }, p.name),
                        React.createElement("span", { className: "text-muted text-small", style: { marginLeft: 8 } },
                            "\u00B7 ",
                            productBlocks.reduce((a, b) => a + (+b.count || 0), 0),
                            " de ",
                            p.requested_qty,
                            " ",
                            p.unit,
                            " configurados")),
                    React.createElement(Btn, { variant: "secondary", size: "sm", icon: "plus", onClick: () => addBlock(p.id) }, "Agregar bloque")),
                productBlocks.length === 0 ? (React.createElement(Empty, { icon: "cube", title: "Sin bloques a\u00FAn" }, "Empieza con uno. Puedes agregar tantos como necesites.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, productBlocks.map((b, bi) => (React.createElement("div", { key: b.id, className: "block-card" },
                    needsPhoto && React.createElement("label", { className: `block-photo ${b.photo ? 'has-photo' : ''}`, style: { cursor: 'pointer', overflow: 'hidden' }, title: "Subir/Reemplazar foto del bloque" },
                        React.createElement("input", { type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => pickBlockPhoto(b, e.target.files && e.target.files[0]) }),
                        blockPhotoSrc(b) ? (React.createElement("img", { src: blockPhotoSrc(b), alt: "foto bloque", style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 } })) : (React.createElement("div", { style: { textAlign: 'center' } },
                            React.createElement(Icon, { name: "camera", size: 20 }),
                            React.createElement("div", { style: { fontSize: 10, marginTop: 4, fontWeight: 600 } }, "Subir foto")))),
                    React.createElement("div", { className: "block-fields" },
                        React.createElement(Field, { label: `Nombre del bloque #${bi + 1}`, required: true },
                            React.createElement(Input, { mono: true, placeholder: "Ej. 3024117 ", value: b.name, onChange: (e) => updBlock(b.id, { name: e.target.value }) })),
                        React.createElement("div", { className: "block-fields-row" },
                            React.createElement(Field, { label: "Placas / piezas", required: true },
                                React.createElement(Input, { mono: true, type: "number", min: 1, value: b.count || '', placeholder: "18", onChange: (e) => updBlock(b.id, { count: +e.target.value }) })),
                            React.createElement(Field, { label: "Estado" },
                                React.createElement("div", { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0' } },
                                    (!needsPhoto
                                        ? React.createElement("span", { className: "text-muted text-small" }, "No requiere foto")
                                        : (b.photo
                                            ? React.createElement(Badge, { tone: "done" },
                                                React.createElement(Icon, { name: "check", size: 10 }),
                                                " Foto OK")
                                            : React.createElement(Badge, { tone: "partial" },
                                                React.createElement(Icon, { name: "camera", size: 10 }),
                                                " Falta foto"))),
                                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", onClick: () => delBlock(b.id) }))))))))))));
        }))));
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
    return (React.createElement("div", null,
        React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 } },
            React.createElement("div", { style: { padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' } },
                React.createElement("div", { className: "text-muted", style: { fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 } }, "Productos"),
                React.createElement("div", { className: "mono", style: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }, products.length)),
            React.createElement("div", { style: { padding: 18, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' } },
                React.createElement("div", { className: "text-muted", style: { fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 } }, "Bloques configurados"),
                React.createElement("div", { className: "mono", style: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' } }, draft.blocks.length)),
            React.createElement("div", { style: { padding: 18, border: '1.5px solid var(--accent)', borderRadius: 12, background: 'var(--accent-soft)' } },
                React.createElement("div", { style: { fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6, color: 'var(--accent)' } }, "Filas a generar"),
                React.createElement("div", { className: "mono", style: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--accent)' } }, totalPlates))),
        photosMissing > 0 && (React.createElement(Callout, { tone: "warn", icon: "alert", title: `${photosMissing} ${photosMissing === 1 ? 'bloque' : 'bloques'} sin foto` }, "Puedes continuar y subirlas despu\u00E9s, pero el packing list no se considerar\u00E1 completo hasta que cada bloque tenga al menos una foto.")),
        React.createElement("div", { style: { marginTop: 18 } },
            React.createElement("div", { style: { fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 } }, "Estructura del packing"),
            React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, products.map(p => {
                const pblocks = draft.blocks.filter(b => b.product === p.id);
                return (React.createElement("div", { key: p.id, style: { border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface)' } },
                    React.createElement("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 } },
                        React.createElement("strong", null, p.name),
                        React.createElement("span", { className: "mono text-small text-muted" },
                            pblocks.reduce((a, b) => a + (+b.count || 0), 0),
                            " placas")),
                    React.createElement("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, pblocks.map(b => (React.createElement("div", { key: b.id, style: {
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px', borderRadius: 8,
                            background: blockOk(b) ? 'var(--ok-soft)' : 'var(--warn-soft)',
                            border: `1px solid ${blockOk(b) ? 'var(--ok-border)' : 'var(--warn-border)'}`,
                            fontSize: 12.5,
                        } },
                        React.createElement(Icon, { name: blockOk(b) ? 'check' : 'camera', size: 11 }),
                        React.createElement("span", { className: "mono", style: { fontWeight: 600 } }, b.name),
                        React.createElement("span", { className: "text-muted", style: { fontSize: 11 } },
                            "\u00D7 ",
                            b.count)))))));
            })))));
};
/* ====================== Step 4: Spreadsheet ====================== */
const Step4Sheet = ({ proforma, draft, rows, setRows, ship, pendingImages }) => {
    const [filter, setFilter] = React.useState('all');
    const [activeRow, setActiveRow] = React.useState(null);
    // Solo las placas llevan foto por fila. Piezas/Formatos no llevan foto.
    const rowIsPlaca = (r) => String(r.tipo || 'Placa').toLowerCase().indexOf('placa') >= 0;
    const anyPlaca = rows.some(rowIsPlaca);
    const errors = rows.filter(r => r.errors && r.errors.length > 0);
    const completeRows = rows.filter(r => r.h > 0 && r.w > 0 && r.container);
    const filtered = filter === 'all' ? rows : filter === 'errors' ? errors : filter === 'empty' ? rows.filter(r => !r.h || !r.w) : rows;
    const updRow = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    // Captura real de la foto de la fila (solo placas). Guarda el base64 en
    // pendingImages (se sube al persistir, cuando la fila ya tiene id real).
    const pickRowPhoto = (r, file) => {
        if (!file)
            return;
        const preview = URL.createObjectURL(file);
        fileToBase64(file).then(({ data, name }) => {
            if (pendingImages && pendingImages.current)
                pendingImages.current.rows[r.id] = { data, name };
            updRow(r.id, { photo: true, image_preview: preview });
        });
    };
    const rowPhotoSrc = (r) => r.image_preview || (r.photo && portalRowImageId(r) ? `/web/image/supplier.shipment.packing.row/${portalRowImageId(r)}/image` : '');
    const portalRowImageId = (r) => {
        const v = r._odoo_id || r.id;
        return (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) ? parseInt(v, 10) : 0;
    };
    // Para "No. Placa" la propagación es CONSECUTIVA: incrementa la parte
    // numérica conservando prefijo y ceros (P-001 → P-002 → P-003…). Para el
    // resto de columnas se copia el valor tal cual.
    const incPlate = (value, step) => {
        const sval = String(value == null ? '' : value);
        const m = sval.match(/^(.*?)(\d+)(\D*)$/);
        if (!m)
            return sval;
        const n = parseInt(m[2], 10) + step;
        return m[1] + String(n).padStart(m[2].length, '0') + m[3];
    };
    // PROPAGATION — copia el valor de `field` desde `sourceId` a la siguiente fila
    // del mismo bloque, o a todas las de abajo dentro del mismo bloque.
    const propagate = (sourceId, field, mode) => {
        const idx = rows.findIndex(r => r.id === sourceId);
        if (idx < 0)
            return;
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
        }
        else {
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
        if (idx < 0)
            return false;
        const block = rows[idx].block;
        for (let i = idx + 1; i < rows.length; i++)
            if (rows[i].block === block)
                return true;
        return false;
    };
    // Cell wrapper that injects the two propagation buttons
    // OJO: PropCell se INVOCA como función (PropCell(props, children)), NO como
    // componente vía React.createElement. Un componente definido dentro de
    // Step4Sheet tendría identidad nueva en cada render (cada tecla dispara
    // setRows) y React desmontaría/remontaría la celda, haciendo que el input
    // pierda el foco en cada pulsación.
    const PropCell = (props, children) => {
        const { rowId, field, extra, errClass } = props;
        const propable = canPropagate(rowId);
        return (React.createElement("td", { className: `${propable ? 'propable' : ''} ${errClass || ''} ${extra || ''}` },
            children,
            propable && (React.createElement("div", { className: "prop-actions", onClick: (e) => e.stopPropagation() },
                React.createElement("button", { onClick: () => propagate(rowId, field, 'next'), title: "Copiar a la siguiente fila del mismo bloque" },
                    React.createElement(Icon, { name: "prop_one", size: 13 })),
                React.createElement("button", { onClick: () => propagate(rowId, field, 'all'), title: "Copiar a TODAS las filas del mismo bloque (abajo)" },
                    React.createElement(Icon, { name: "prop_all", size: 13 }))))));
    };
    const containers = ship.containers.map(c => c.number).filter(Boolean);
    // Agrupación visual por producto: ordenamos las filas según el orden de los
    // productos de la PO (orden estable: conserva el orden de bloques dentro de
    // cada producto) y, al renderizar, mostramos un encabezado cuando cambia el
    // producto para separar visualmente los grupos.
    // Clave de producto normalizada a string (los ids de Odoo a veces llegan
    // como número y otras como string; comparar sin normalizar fragmentaba los
    // grupos y mostraba encabezados a media tabla).
    const prodKey = (r) => String((r && r.product_id != null && r.product_id !== false) ? r.product_id : '');
    const productById = {};
    (proforma.products || []).forEach((p) => { productById[String(p.id)] = p; });
    // Orden de aparición de cada producto en las filas → agrupa contiguo y
    // conserva el orden de bloques dentro de cada producto (sort estable).
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
        const csv = '﻿' + lines.join('\n');
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
    return (React.createElement("div", null,
        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14, flexWrap: 'wrap' } },
            React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 } },
                React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 } },
                    React.createElement("span", { className: "mono", style: { fontWeight: 700, fontSize: 18 } }, completeRows.length),
                    React.createElement("span", { className: "text-muted" },
                        "/ ",
                        rows.length,
                        " completas")),
                React.createElement("div", { style: { width: 1, height: 16, background: 'var(--border)' } }),
                React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 6, color: errors.length > 0 ? 'var(--danger)' : 'var(--ink-3)', fontSize: 13 } },
                    React.createElement(Icon, { name: "alert", size: 12 }),
                    React.createElement("span", { className: "mono", style: { fontWeight: 700 } }, errors.length),
                    React.createElement("span", null, "con errores"))),
            React.createElement("div", { className: "seg" },
                React.createElement("button", { className: filter === 'all' ? 'active' : '', onClick: () => setFilter('all') },
                    "Todas (",
                    rows.length,
                    ")"),
                React.createElement("button", { className: filter === 'errors' ? 'active' : '', onClick: () => setFilter('errors') },
                    "Errores (",
                    errors.length,
                    ")"),
                React.createElement("button", { className: filter === 'empty' ? 'active' : '', onClick: () => setFilter('empty') }, "Sin dimensiones")),
            React.createElement("div", { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
                React.createElement(Btn, { variant: "secondary", icon: "download", size: "sm", onClick: exportCSV, disabled: rows.length === 0 }, "Exportar CSV"),
                React.createElement(Btn, { variant: "secondary", icon: "upload", size: "sm", onClick: () => { setPasteText(''); setPasteOpen(true); } }, "Pegar de Excel"))),
        React.createElement("div", { className: "sheet" },
            React.createElement("div", { className: "sheet-scroll" },
                React.createElement("table", { className: "sheet-table" },
                    React.createElement("thead", null,
                        React.createElement("tr", null,
                            React.createElement("th", { style: { width: 30 } }, "#"),
                            React.createElement("th", { style: { minWidth: 130 } }, "Bloque"),
                            React.createElement("th", { style: { minWidth: 110 } }, "Atado"),
                            React.createElement("th", { style: { minWidth: 110 } }, "No. Placa"),
                            React.createElement("th", { style: { width: 110 } }, "Grosor cm"),
                            React.createElement("th", { style: { width: 110 } }, "Largo m"),
                            React.createElement("th", { style: { width: 110 } }, "Alto m"),
                            React.createElement("th", { style: { width: 80 } }, "\u00C1rea m\u00B2"),
                            React.createElement("th", { style: { minWidth: 180 } }, "Contenedor"),
                            anyPlaca && React.createElement("th", { style: { width: 60 } }, "Foto"),
                            React.createElement("th", { style: { minWidth: 170 } }, "Notas"))),
                    React.createElement("tbody", null, visibleRows.flatMap((r, i) => {
                        const hNum = parseFloat(r.h) || 0;
                        const wNum = parseFloat(r.w) || 0;
                        const area = (hNum && wNum) ? (hNum * wNum).toFixed(2) : '';
                        const noH = !hNum;
                        const noW = !wNum;
                        const noC = !r.container;
                        const isProductStart = i === 0 || prodKey(visibleRows[i - 1]) !== prodKey(r);
                        const isBlockStart = isProductStart || visibleRows[i - 1].block !== r.block;
                        const prod = productById[prodKey(r)];
                        const groupHeader = (multiProduct && isProductStart) ? React.createElement("tr", { key: 'grp-' + r.id, className: "product-group", "data-noncommentable": "" },
                            React.createElement("td", { colSpan: anyPlaca ? 11 : 10, style: { background: 'var(--accent-soft)', borderTop: '2px solid var(--accent)', padding: '8px 12px', fontSize: 12.5, letterSpacing: '0.02em', position: 'sticky', left: 0 } },
                                React.createElement("span", { style: { fontWeight: 700, color: 'var(--accent)' } }, (prod && prod.name) || 'Producto'),
                                (prod && prod.ref) ? React.createElement("span", { className: "mono", style: { marginLeft: 8, color: 'var(--ink-3)', fontWeight: 600 } }, prod.ref) : null)) : null;
                        const dataRow = React.createElement("tr", { key: r.id, className: `${isBlockStart ? 'block-start' : ''} ${activeRow === r.id ? 'is-active' : ''}`, onClick: () => setActiveRow(r.id) },
                            React.createElement("td", { style: { textAlign: 'center', color: 'var(--ink-4)', fontSize: 11 } }, rows.indexOf(r) + 1),
                            React.createElement("td", { className: "cell-block" },
                                React.createElement("input", { value: r.block, style: { textTransform: 'uppercase' }, onChange: forceUpper((e) => updRow(r.id, { block: e.target.value })) })),
                            PropCell({ rowId: r.id, field: "atado" },
                                React.createElement("input", { value: r.atado, style: { textTransform: 'uppercase' }, onChange: forceUpper((e) => updRow(r.id, { atado: e.target.value })) })),
                            PropCell({ rowId: r.id, field: "plate" },
                                React.createElement("input", { value: r.plate, style: { textTransform: 'uppercase' }, onChange: forceUpper((e) => updRow(r.id, { plate: e.target.value })) })),
                            PropCell({ rowId: r.id, field: "thickness" },
                                React.createElement("input", { type: "text", inputMode: "decimal", value: r.thickness || '', onChange: (e) => updRow(r.id, { thickness: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') }) })),
                            PropCell({ rowId: r.id, field: "w", errClass: noW ? 'is-error' : '' },
                                React.createElement("input", { type: "text", inputMode: "decimal", value: r.w || '', placeholder: "0.00", onChange: (e) => updRow(r.id, { w: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') }) })),
                            PropCell({ rowId: r.id, field: "h", errClass: noH ? 'is-error' : '' },
                                React.createElement("input", { type: "text", inputMode: "decimal", value: r.h || '', placeholder: "0.00", onChange: (e) => updRow(r.id, { h: e.target.value.replace(/[^0-9.,]/g, '').replace(/,/g, '.') }) })),
                            React.createElement("td", { className: "cell-computed" },
                                React.createElement("input", { readOnly: true, value: area })),
                            PropCell({ rowId: r.id, field: "container", errClass: noC ? 'is-error' : '' },
                                React.createElement("select", { value: r.container, onChange: (e) => updRow(r.id, { container: e.target.value }) },
                                    React.createElement("option", { value: "" }, "\u2014 sin asignar \u2014"),
                                    containers.map(c => React.createElement("option", { key: c, value: c }, c)))),
                            anyPlaca && React.createElement("td", { style: { textAlign: 'center' } }, rowIsPlaca(r)
                                ? React.createElement("label", { className: `row-mini-photo ${r.photo ? 'has' : ''}`, style: { cursor: 'pointer', overflow: 'hidden' }, title: "Subir/Reemplazar foto de la placa", onClick: (e) => e.stopPropagation() },
                                    React.createElement("input", { type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => pickRowPhoto(r, e.target.files && e.target.files[0]) }),
                                    rowPhotoSrc(r)
                                        ? React.createElement("img", { src: rowPhotoSrc(r), alt: "foto", style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 } })
                                        : React.createElement(Icon, { name: "camera", size: 12 }))
                                : React.createElement("span", { className: "text-muted", style: { fontSize: 11 } }, "—")),
                            PropCell({ rowId: r.id, field: "notes" },
                                React.createElement("input", { placeholder: "\u2014", value: r.notes, style: { textTransform: 'uppercase' }, onChange: forceUpper((e) => updRow(r.id, { notes: e.target.value })) })));
                        return groupHeader ? [groupHeader, dataRow] : [dataRow];
                    }))))),
        React.createElement(Callout, { tone: "info", icon: "sparkles", title: "Llena m\u00E1s r\u00E1pido con propagaci\u00F3n" },
            "Pasa el cursor sobre cualquier celda y ver\u00E1s ",
            React.createElement("strong", null, "dos \u00EDconos a la derecha"),
            ":",
            React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, margin: '0 4px' } },
                React.createElement(Icon, { name: "prop_one", size: 11 }),
                " uno"),
            "copia el valor a la siguiente fila del mismo bloque \u00B7",
            React.createElement("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 11, margin: '0 4px' } },
                React.createElement(Icon, { name: "prop_all", size: 11 }),
                " todos"),
            "copia a todas las filas debajo en el mismo bloque. Tambi\u00E9n puedes copiar/pegar desde Excel y usar ",
            React.createElement("kbd", { style: { padding: '2px 5px', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11 } }, "Tab"),
            " entre celdas."),
        pasteOpen && React.createElement("div", { style: { position: 'fixed', inset: 0, zIndex: 2147483001, background: 'oklch(0.2 0.01 60 / 0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }, onClick: (e) => e.target === e.currentTarget && setPasteOpen(false) },
            React.createElement("div", { style: { background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', width: 'min(680px, calc(100vw - 48px))', maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' } },
                React.createElement("div", { style: { padding: '18px 22px 14px', borderBottom: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flex: '0 0 auto' } },
                    React.createElement("div", null,
                        React.createElement("h2", { style: { margin: 0, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' } }, "Pegar desde Excel"),
                        React.createElement("p", { style: { margin: '4px 0 0', fontSize: 13, color: 'var(--ink-3)', maxWidth: '55ch' } },
                            "Copia el rango en Excel (con o sin la fila de headers) y p\u00E9galo aqu\u00ED con ",
                            React.createElement("kbd", { style: { padding: '1px 5px', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11 } }, "Ctrl/Cmd + V"),
                            ". Las filas se actualizan por la columna ",
                            React.createElement("strong", null, "#"),
                            "; si no la incluyes, se aplica por orden.")),
                    React.createElement("button", { className: "icon-btn", onClick: () => setPasteOpen(false), "aria-label": "Cerrar" },
                        React.createElement(Icon, { name: "x", size: 16 }))),
                React.createElement("div", { style: { padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minHeight: 0, overflow: 'auto' } },
                    React.createElement("textarea", { value: pasteText, onChange: (e) => setPasteText(e.target.value), placeholder: 'Pega aqu\u00ED los datos copiados de Excel...\n\nColumnas esperadas (en este orden si no incluyes headers):\n#  Bloque  Atado  No. Placa  Grosor cm  Largo m  Alto m  Contenedor  Notas', autoFocus: true, spellCheck: false, style: { width: '100%', minHeight: 180, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, resize: 'vertical', background: 'var(--surface-alt)', color: 'var(--ink)', lineHeight: 1.5 } }),
                    pastePreview && pastePreview.dataRows.length > 0 && React.createElement("div", { style: { fontSize: 12, color: 'var(--ink-2)', padding: '10px 12px', background: 'var(--ok-soft)', border: '1px solid var(--ok)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
                        React.createElement("div", null,
                            React.createElement("strong", null, pastePreview.dataRows.length),
                            " fila(s) detectada(s) \u00B7 ",
                            pastePreview.hasHeaders ? 'headers reconocidos \u2713' : 'sin headers (mapeo por posici\u00F3n)'),
                        React.createElement("div", { style: { color: 'var(--ink-3)' } }, "Columnas que se aplicar\u00E1n: " + (pastePreview.mapping.filter(m => m && m.field).map(m => m.header).join(', ') || '\u2014'))),
                    pasteText && pastePreview && pastePreview.dataRows.length === 0 && React.createElement("div", { style: { fontSize: 12, color: 'var(--danger)', padding: '10px 12px', background: 'var(--danger-soft, #fff0f0)', border: '1px solid var(--danger)', borderRadius: 8 } }, "No se detectaron filas v\u00E1lidas. Verifica que pegaste el contenido de Excel (celdas separadas por tab).")),
                React.createElement("div", { style: { padding: '14px 22px', borderTop: '1px solid var(--border-soft)', display: 'flex', justifyContent: 'flex-end', gap: 8, flex: '0 0 auto' } },
                    React.createElement(Btn, { variant: "ghost", onClick: () => setPasteOpen(false) }, "Cancelar"),
                    React.createElement(Btn, { variant: "primary", icon: "check", disabled: !pastePreview || pastePreview.dataRows.length === 0, onClick: applyPaste }, "Aplicar a " + (pastePreview ? pastePreview.dataRows.length : 0) + " fila(s)")))) ));
};
window.PackingWizard = PackingWizard;
// ===== src/views/documents.jsx =====
/* global React, Icon, Btn, Badge, Callout, Empty */
// Categorías de documentos generales (alcance Proforma). docType = valor del backend.
const GENERAL_DOC_CATS = [
    { docType: 'proforma_signed', icon: 'file', title: 'Proforma firmada', desc: 'La cotización que enviaste a SOM GROUP, firmada.', required: true },
    { docType: 'contract', icon: 'doc_lines', title: 'Contrato comercial', desc: 'Contrato marco, si aplica.', required: false },
    { docType: 'quality_cert', icon: 'sparkles', title: 'Certificados de calidad', desc: 'Mineralogía, densidad, absorción, etc.', required: true },
    { docType: 'product_photos', icon: 'image', title: 'Fotos del producto', desc: 'Catálogo o muestras a granel del proveedor.', required: false },
    { docType: 'general_other', icon: 'box', title: 'Otros documentos', desc: 'Cualquier otro adjunto general.', required: false },
];
const generalDocAllowed = (file) => file.type === 'application/pdf' || file.type === 'image/jpeg' || file.type === 'image/jpg' || file.type === 'image/png' || /\.(pdf|jpe?g|png)$/i.test(file.name || '');
const Documents = ({ proforma, setProforma, setRoute }) => {
    const [drag, setDrag] = React.useState(false);
    const [docs, setDocs] = React.useState([]);
    const [busy, setBusy] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const api = (typeof window !== 'undefined' && window.__supplierPortalApi) || null;
    const token = api && api.token;
    const fileRef = React.useRef(null);
    const pendingTypeRef = React.useRef('general_other');
    const openPicker = (docType) => { pendingTypeRef.current = docType; if (fileRef.current) {
        fileRef.current.value = '';
        fileRef.current.click();
    } };
    const refresh = React.useCallback(async () => {
        if (!token) {
            setLoading(false);
            return;
        }
        try {
            const res = await portalRpc('/supplier/api/v2/list_documents', { token });
            if (res && res.success)
                setDocs(res.global_documents || []);
        }
        catch (err) {
            console.error('[SupplierPortal] Error listando documentos:', err);
        }
        finally {
            setLoading(false);
        }
    }, [token]);
    React.useEffect(() => { refresh(); }, [refresh]);
    const uploadOne = async (docType, file) => {
        if (!file)
            return false;
        if (!generalDocAllowed(file)) {
            window.alert('"' + file.name + '": solo se permiten archivos PDF, JPG o PNG.');
            return false;
        }
        if (file.size > 10 * 1024 * 1024) {
            window.alert('"' + file.name + '" supera el máximo de 10 MB.');
            return false;
        }
        const { data } = await fileToBase64(file);
        const res = await portalRpc('/supplier/api/v2/upload_document', {
            token,
            document_type: docType,
            file_data: data,
            file_name: file.name || 'documento',
            file_size: file.size || 0,
            mime_type: file.type || '',
        });
        if (!res || !res.success) {
            window.alert((res && res.message) || ('No se pudo subir "' + file.name + '".'));
            return false;
        }
        setDocs(res.documents || []);
        return true;
    };
    const uploadMany = async (docType, fileList) => {
        if (!token) {
            window.alert('No se puede subir: el portal no tiene sesión activa.');
            return;
        }
        const files = Array.from(fileList || []);
        if (!files.length)
            return;
        setBusy(docType);
        try {
            for (const f of files) {
                await uploadOne(docType, f);
            }
        }
        catch (err) {
            console.error('[SupplierPortal] Error subiendo documento general:', err);
            window.alert('Ocurrió un error al subir el documento.');
        }
        finally {
            setBusy(null);
        }
    };
    const removeDoc = async (doc) => {
        if (!token || !doc)
            return;
        if (!window.confirm('¿Eliminar "' + doc.name + '"?'))
            return;
        setBusy(doc.document_type);
        try {
            const res = await portalRpc('/supplier/api/v2/delete_document', { token, document_id: doc.id });
            if (!res || !res.success) {
                window.alert((res && res.message) || 'No se pudo eliminar el documento.');
                return;
            }
            setDocs(res.documents || []);
        }
        catch (err) {
            console.error('[SupplierPortal] Error eliminando documento general:', err);
            window.alert('Ocurrió un error al eliminar el documento.');
        }
        finally {
            setBusy(null);
        }
    };
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Documentos"),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", null, "Documentos generales"),
                React.createElement("p", { className: "lead" }, "Documentos que aplican a toda la Proforma (no a un embarque específico). Los documentos por embarque están dentro de cada embarque."))),
        React.createElement("input", { ref: fileRef, type: "file", accept: "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png", multiple: true, style: { display: 'none' }, onChange: (e) => { const files = Array.from(e.target.files || []); e.target.value = ''; uploadMany(pendingTypeRef.current, files); } }),
        React.createElement("div", { className: `dropzone ${drag ? 'is-drag' : ''}`, style: { cursor: 'pointer' }, onClick: () => openPicker('general_other'), onDragEnter: (e) => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDragOver: (e) => e.preventDefault(), onDrop: (e) => { e.preventDefault(); setDrag(false); uploadMany('general_other', e.dataTransfer.files); } },
            React.createElement("div", { className: "dz-icon" },
                React.createElement(Icon, { name: "upload", size: 28 })),
            React.createElement("h4", null, "Arrastra tus archivos aquí"),
            React.createElement("p", null,
                "PDF, JPG, PNG · máximo 10 MB por archivo · o ",
                React.createElement("span", { style: { color: 'var(--accent)', fontWeight: 600 } }, "elige desde tu computadora"),
                " (se guardan en \"Otros documentos\")")),
        loading ? React.createElement("div", { className: "text-muted", style: { marginTop: 24, fontSize: 13 } }, "Cargando documentos…") : React.createElement("div", { style: { marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 } }, GENERAL_DOC_CATS.map(cat => {
            const catDocs = docs.filter(d => d.document_type === cat.docType);
            const isBusy = busy === cat.docType;
            return (React.createElement("div", { key: cat.docType, className: "card", style: { padding: 16 } },
                React.createElement("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
                    React.createElement("div", { style: { width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)',
                            display: 'grid', placeItems: 'center', flexShrink: 0 } },
                        React.createElement(Icon, { name: cat.icon, size: 16 })),
                    React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                        React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                            React.createElement("strong", null, cat.title),
                            cat.required && React.createElement(Badge, { tone: catDocs.length > 0 ? 'done' : 'warn' }, catDocs.length > 0 ? React.createElement(React.Fragment, null,
                                React.createElement(Icon, { name: "check", size: 10 }),
                                " ",
                                catDocs.length) : 'Obligatorio'),
                            !cat.required && (catDocs.length > 0
                                ? React.createElement(Badge, { tone: "done" }, React.createElement(Icon, { name: "check", size: 10 }), " ", catDocs.length)
                                : React.createElement(Badge, { tone: "draft" }, "Opcional"))),
                        React.createElement("div", { className: "text-muted", style: { fontSize: 12.5, marginBottom: catDocs.length > 0 ? 12 : 0 } }, cat.desc),
                        catDocs.length > 0 && (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, catDocs.map((f) => (React.createElement("div", { key: f.id, className: "doc-row" },
                            React.createElement("div", { className: "doc-icon" },
                                React.createElement(Icon, { name: "file", size: 15 })),
                            React.createElement("div", { className: "doc-meta" },
                                React.createElement("div", { className: "name" }, f.name),
                                React.createElement("div", { className: "meta" },
                                    ((f.file_size || 0) / 1024).toFixed(0),
                                    " KB")),
                            React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", disabled: isBusy, onClick: () => removeDoc(f) }))))))),
                    React.createElement(Btn, { variant: "secondary", size: "sm", icon: "upload", disabled: isBusy, onClick: () => openPicker(cat.docType) }, isBusy ? 'Subiendo…' : 'Subir'))));
        }))));
};
window.Documents = Documents;
// ===== src/views/confirm.jsx =====
/* global React, Icon, Btn, Badge, Callout, ProgressRing */
const Confirm = ({ proforma, status, setRoute, onComplete }) => {
    const allDone = status.overall >= 100;
    const checks = [
        { ok: status.globals_pct === 100, label: 'Datos generales de la Proforma', detail: status.globals_pct === 100 ? 'Completos' : `${status.globals_pct}% — faltan campos requeridos` },
        ...proforma.shipments.map((s, i) => {
            const sst = status.shipments_status[i];
            const miss = [];
            if (!sst.tabs.hasLog)
                miss.push('logística');
            if (!sst.tabs.hasBL)
                miss.push('B/L');
            if (!sst.tabs.hasInv)
                miss.push('invoices');
            if (!sst.tabs.hasContainers)
                miss.push('contenedores');
            if (!sst.tabs.hasPacking)
                miss.push('packing');
            return {
                ok: sst.status === 'done',
                label: `Embarque #${s.number}`,
                detail: sst.status === 'done' ? 'Todo capturado' : `Pendiente: ${miss.join(', ')}`,
            };
        }),
    ];
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Revisar y enviar"),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", null, "Revisar y enviar a SOM GROUP"),
                React.createElement("p", { className: "lead" }, "\u00DAltima revisi\u00F3n antes de marcar la Proforma como completa. Una vez enviada, nuestro equipo recibir\u00E1 una notificaci\u00F3n y empezar\u00E1 la coordinaci\u00F3n de aduanas.")),
            React.createElement("div", { className: "head-actions" },
                React.createElement(ProgressRing, { pct: status.overall, size: 68, stroke: 6, label: "listo" }))),
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Resumen general"),
                    React.createElement("p", { className: "sub" }, "Datos que se enviar\u00E1n como confirmaci\u00F3n."))),
            React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 } },
                React.createElement(StatCard, { label: "Proforma", value: proforma.globals.proforma_number || '—', mono: true }),
                React.createElement(StatCard, { label: "Orden de compra", value: proforma.po_name, mono: true }),
                React.createElement(StatCard, { label: "Destino", value: proforma.globals.port_destination || '—' }),
                React.createElement(StatCard, { label: "Embarques", value: proforma.shipments.length }),
                React.createElement(StatCard, { label: "Total invoices", value: `${proforma.shipments.reduce((a, s) => a + s.invoices.reduce((b, i) => b + (i.amount || 0), 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`, mono: true }))),
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Checklist final"),
                    React.createElement("p", { className: "sub" }, "Verifica que cada secci\u00F3n est\u00E9 completa."))),
            React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 } }, checks.map((c, i) => (React.createElement("div", { key: i, style: {
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid',
                    borderColor: c.ok ? 'var(--ok-border)' : 'var(--warn-border)',
                    background: c.ok ? 'var(--ok-soft)' : 'var(--warn-soft)',
                } },
                React.createElement("div", { style: {
                        width: 28, height: 28, borderRadius: 50, display: 'grid', placeItems: 'center',
                        background: c.ok ? 'var(--ok)' : 'var(--warn)', color: 'white'
                    } },
                    React.createElement(Icon, { name: c.ok ? 'check' : 'minus', size: 14 })),
                React.createElement("div", { style: { flex: 1 } },
                    React.createElement("strong", { style: { fontSize: 14 } }, c.label),
                    React.createElement("div", { className: "text-muted", style: { fontSize: 12.5 } }, c.detail))))))),
        !allDone && (React.createElement(Callout, { tone: "warn", icon: "alert", title: "A\u00FAn no puedes marcar como completa" }, "Termina los puntos pendientes del checklist. Puedes seguir trabajando \u2014 tus datos se guardan autom\u00E1ticamente.")),
        React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 } },
            React.createElement("span", { className: "text-muted text-small" }, "Al marcar como completa, SOM GROUP recibir\u00E1 un correo autom\u00E1tico."),
            React.createElement("div", { style: { display: 'flex', gap: 8 } },
                React.createElement(Btn, { variant: "ghost", onClick: () => setRoute({ section: 'overview' }) }, "Volver"),
                React.createElement(Btn, { variant: "accent", size: "lg", icon: "flag", disabled: !allDone, onClick: onComplete }, allDone ? 'Marcar como completa' : 'Faltan datos requeridos')))));
};
const StatCard = ({ label, value, mono }) => (React.createElement("div", { style: { padding: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-alt)' } },
    React.createElement("div", { className: "text-muted", style: { fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 } }, label),
    React.createElement("div", { className: mono ? 'mono' : '', style: { fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', wordBreak: 'break-word' } }, value)));
window.Confirm = Confirm;
// ===== src/onboarding.jsx =====
/* global React, Icon, Btn, Imgph */
const ONBOARD_STEPS = [
    {
        title: '¡Bienvenido al portal!',
        text: 'Aquí vas a registrar los datos del embarque para SOM GROUP. Te guiaremos paso a paso. No tienes que terminar de una sola vez.',
        art: React.createElement("img", { src: "/stock_lot_packing_import/static/src/img/ilusttraci%C3%B3n.png", alt: "Bienvenido al portal SOM GROUP", style: { maxWidth: 320, maxHeight: 220, width: '100%', height: 'auto', objectFit: 'contain' } }),
    },
    {
        title: 'Tu progreso siempre visible',
        text: 'En el lado izquierdo verás el avance de cada sección con marcas visuales: verde = listo, ámbar = en progreso, gris = pendiente.',
        art: React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 8, width: 280 } }, ['Datos generales', 'Embarque #1', 'Embarque #2', 'Documentos'].map((l, i) => (React.createElement("div", { key: l, style: { display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 } },
            React.createElement("span", { style: { width: 16, height: 16, borderRadius: 8, background: i < 2 ? 'var(--ok)' : i === 2 ? 'var(--warn)' : 'var(--border-strong)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 9 } }, i < 2 ? '✓' : i === 2 ? '–' : ''),
            React.createElement("span", { style: { fontSize: 12 } }, l))))),
    },
    {
        title: 'Ayuda contextual en cada campo',
        text: 'Verás un ícono "?" junto a campos que pueden ser confusos. Pásale el cursor para ver una explicación con ejemplo.',
        art: React.createElement("div", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: 'var(--ink)', color: 'white', borderRadius: 8, fontSize: 12, maxWidth: 320, lineHeight: 1.5 } },
            React.createElement("span", null,
                React.createElement("strong", null, "Incoterm:"),
                " define qui\u00E9n paga el transporte y seguro. ",
                React.createElement("br", null),
                React.createElement("span", { style: { fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.7 } }, "Ej: CIF = t\u00FA pagas hasta el puerto destino"))),
    },
    {
        title: 'El packing list es asistido',
        text: 'En lugar de escribir cientos de líneas, te preguntaremos cuántos bloques cargas y cuántas placas tiene cada uno. Generamos las filas por ti.',
        art: React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 } }, ['1. Productos', '2. Bloques + fotos', '3. Revisión', '4. Llenar placas'].map((l, i) => (React.createElement("div", { key: l, style: { display: 'flex', alignItems: 'center', gap: 8 } },
            React.createElement("span", { style: { width: 22, height: 22, borderRadius: 50, background: i === 0 ? 'var(--accent)' : 'var(--surface)', color: i === 0 ? 'white' : 'var(--ink-3)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, border: i === 0 ? '0' : '1px solid var(--border-strong)' } }, i + 1),
            React.createElement("span", { style: { fontWeight: i === 0 ? 600 : 400 } }, l))))),
    },
    {
        title: '¿Listo para empezar?',
        text: 'Comencemos por los datos generales. Si te trabas, busca el panel de "Guía del paso actual" a la derecha — siempre te dirá qué hacer.',
        art: React.createElement(Btn, { variant: "accent", size: "lg", icon: "play" }, "Iniciar llenado"),
    },
];
const Onboarding = ({ onClose }) => {
    const [step, setStep] = React.useState(0);
    const s = ONBOARD_STEPS[step];
    return (React.createElement("div", { className: "onboard-scrim", onClick: (e) => e.target === e.currentTarget && null },
        React.createElement("div", { className: "onboard-card" },
            React.createElement("div", { className: "ob-art" }, s.art),
            React.createElement("div", { className: "ob-body" },
                React.createElement("div", { className: "ob-step" },
                    "Paso ",
                    step + 1,
                    " de ",
                    ONBOARD_STEPS.length),
                React.createElement("h2", null, s.title),
                React.createElement("p", { className: "ob-text" }, s.text)),
            React.createElement("div", { className: "ob-foot" },
                React.createElement("div", { className: "ob-dots" }, ONBOARD_STEPS.map((_, i) => React.createElement("span", { key: i, className: `d ${i === step ? 'active' : ''}` }))),
                React.createElement("div", { style: { display: 'flex', gap: 8 } },
                    step > 0 && React.createElement(Btn, { variant: "ghost", onClick: () => setStep(step - 1) }, "Atr\u00E1s"),
                    React.createElement(Btn, { variant: "ghost", onClick: onClose }, "Saltar"),
                    step < ONBOARD_STEPS.length - 1
                        ? React.createElement(Btn, { variant: "primary", iconRight: "arrow_right", onClick: () => setStep(step + 1) }, "Siguiente")
                        : React.createElement(Btn, { variant: "accent", icon: "check", onClick: onClose }, "Empezar"))))));
};
window.Onboarding = Onboarding;
// ===== src/app.jsx =====
/* global React, ReactDOM, Icon, Btn, Badge,
   MOCK_PROFORMA, SAMPLE_ROWS, computeStatus, LangCtx, I18N,
   Sidebar, Overview, Globals, ShipmentsList, ShipmentDetail,
   PackingWizard, Documents, Confirm, Onboarding,
   useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, TweakSelect */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
    "lang": "es",
    "accent": "#59473d",
    "validation_style": "inline",
    "show_onboarding": false,
    "show_guide_panel": true,
    "density": "comfortable",
    "show_completed_route": false
} /*EDITMODE-END*/;
const ACCENT_OPTIONS = ['#59473d', '#3F7CD8', '#4F8B6E', '#C56A2F'];
const PORTAL_RAW_PAYLOAD = (window.SupplierReactExactData && window.SupplierReactExactData.raw) || {};
const PORTAL_TOKEN = PORTAL_RAW_PAYLOAD.token || '';
// ── Respaldo local (anti-pérdida) ────────────────────────────────────────────
// Todo cambio se vuelca de forma SÍNCRONA a localStorage. Si la app se cierra,
// se cuelga o se reinicia antes de que el guardado al servidor (debounce 500ms)
// alcance a correr, lo capturado se recupera al volver a abrir. Se guarda también
// el mapa de ids reales para que, al re-sincronizar, se ACTUALICEN los registros
// existentes en Odoo en lugar de duplicarlos.
const PORTAL_DRAFT_VERSION = 1;
function portalDraftKey() {
    return 'supplier_portal_draft_v' + PORTAL_DRAFT_VERSION + ':' + (PORTAL_TOKEN || 'anon');
}
function loadPortalDraft() {
    try {
        const raw = localStorage.getItem(portalDraftKey());
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.proforma)
            return null;
        return parsed;
    }
    catch (_) {
        return null;
    }
}
function savePortalDraft(proforma, idMap, syncedHash) {
    if (!PORTAL_TOKEN || !proforma)
        return;
    try {
        localStorage.setItem(portalDraftKey(), JSON.stringify({
            proforma,
            idMap: idMap || {},
            syncedHash: syncedHash || '',
            ts: Date.now(),
        }));
    }
    catch (_) { /* cuota llena o storage no disponible: best-effort */ }
}
function portalIsRealId(value) {
    return value !== null && value !== undefined && /^\d+$/.test(String(value));
}
function portalToInt(value) {
    return portalIsRealId(value) ? parseInt(value, 10) : 0;
}
// Parser de decimales tolerante a formato internacional. Entiende punto o coma
// como separador decimal (3,18 → 3.18) y separadores de miles. Number("3,18")
// daría NaN→0, lo que provocaba que las medidas no se guardaran.
function portalParseDecimal(value) {
    if (value === null || value === undefined || value === '')
        return 0;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : 0;
    var s = String(value).trim().replace(/[^0-9.,-]/g, '');
    if (!s)
        return 0;
    var neg = s.charAt(0) === '-';
    s = s.replace(/-/g, '');
    var hasC = s.indexOf(',') >= 0, hasD = s.indexOf('.') >= 0;
    if (hasC && hasD) {
        // El último separador es el decimal; el otro es de miles.
        if (s.lastIndexOf(',') > s.lastIndexOf('.'))
            s = s.replace(/\./g, '').replace(',', '.');
        else
            s = s.replace(/,/g, '');
    }
    else if (hasC) {
        // Solo comas: decimal salvo que parezca separador de miles (1,234).
        var p = s.split(',');
        s = (p.length === 2 && p[1].length !== 3) ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    var num = parseFloat(s);
    if (!Number.isFinite(num))
        return 0;
    return neg ? -num : num;
}
function portalScope(value) {
    var scope = (value === null || value === undefined) ? '' : String(value).trim().toLowerCase();
    if (scope === 'specific' || scope === 'specific_container' || scope === 'specific_containers' || scope === 'containers' || scope === 'container') {
        return 'specific_containers';
    }
    return 'full_shipment';
}
async function portalRpc(route, params) {
    const response = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: params || {}, id: Date.now() }),
    });
    if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' en ' + route);
    }
    const payload = await response.json();
    if (payload.error) {
        throw new Error((payload.error.data && payload.error.data.message) || payload.error.message || 'Error JSON-RPC');
    }
    return payload.result !== undefined ? payload.result : payload;
}
// Lee un File como base64 (sin el prefijo data:...;base64,) para enviarlo a los
// campos binarios de Odoo. Devuelve también el data URL para previsualizar.
function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
            const res = String(reader.result || '');
            const comma = res.indexOf(',');
            resolve({ data: comma >= 0 ? res.slice(comma + 1) : res, name: file.name || 'foto.jpg', dataUrl: res });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
function normalizePortalProforma(proforma) {
    const normalizer = window.SupplierReactExactNormalize;
    if (typeof normalizer === 'function') {
        return normalizer(Object.assign({}, PORTAL_RAW_PAYLOAD, { proforma }));
    }
    return (window.SupplierReactExactData && window.SupplierReactExactData.proforma) || MOCK_PROFORMA;
}

function App() {
    const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const t = tweaks;
    // Estado del portal conectado a Odoo. Todo cambio local se sincroniza con
    // /supplier/api/v2/* y queda persistido en supplier.proforma/supplier.shipment.
    const [proforma, setProformaRaw] = React.useState(() => {
        if (t.show_completed_route)
            return completedProforma();
        return (window.SupplierReactExactData && window.SupplierReactExactData.proforma) || MOCK_PROFORMA;
    });
    const [saveState, setSaveState] = React.useState(PORTAL_TOKEN ? 'saved' : 'offline');
    const saveTimerRef = React.useRef(null);
    const savingRef = React.useRef(false);
    const pendingRef = React.useRef(null);
    const proformaRef = React.useRef(proforma);
    const lastHashRef = React.useRef(JSON.stringify(proforma));
    const idMapRef = React.useRef({ shipments: {}, containers: {}, invoices: {}, packings: {}, rows: {} });
    // Imágenes capturadas en el asistente que aún no se suben a Odoo. Se suben de
    // forma diferida en persistSnapshot cuando ya existen el embarque / las filas
    // (y por tanto sus ids reales). blocks: por b.id · rows: por id de fila.
    const pendingImagesRef = React.useRef({ blocks: {}, rows: {} });
    React.useEffect(() => { proformaRef.current = proforma; }, [proforma]);
    const realMappedId = React.useCallback((kind, key, value) => {
        if (portalIsRealId(value))
            return parseInt(value, 10);
        return idMapRef.current[kind][String(key)] || 0;
    }, []);
    const findProduct = React.useCallback((snapshot, productId) => {
        return (snapshot.products || []).find(p => String(p.id) === String(productId)) || (snapshot.products || [])[0] || {};
    }, []);
    const shipmentPayload = React.useCallback((snapshot, ship) => ({
        shipment_type: ship.type || 'maritime',
        shipping_line: ship.shipping_line || '',
        vessel_name: ship.vessel || '',
        port_origin: (snapshot.globals && snapshot.globals.port_origin) || ship.port_origin || '',
        port_destination: (snapshot.globals && snapshot.globals.port_destination) || ship.port_destination || '',
        bl_number: ship.bl_number || '',
        bl_date: ship.bl_date || false,
        etd: ship.etd || false,
        eta: ship.eta || false,
        status: ship.status || 'draft',
        notes: ship.notes || '',
    }), []);
    const buildContainerPayload = React.useCallback((shipmentId, containers) => {
        return (containers || []).map(c => ({
            id: realMappedId('containers', shipmentId + ':' + c.id, c.id),
            container_number: c.number || '',
            seal_number: c.seal || '',
            container_type: c.type || '',
            weight: Number(c.weight || 0),
            volume: Number(c.volume || 0),
            packages: Number(c.packages || 0),
            notes: c.notes || '',
        }));
    }, [realMappedId]);
    const buildInvoicePayload = React.useCallback((shipmentId, invoices) => {
        return (invoices || []).map(inv => ({
            id: realMappedId('invoices', shipmentId + ':' + inv.id, inv.id),
            invoice_number: inv.number || '',
            invoice_date: inv.date || false,
            amount: Number(inv.amount || 0),
            currency_name: inv.currency || inv.currency_name || 'USD',
            scope: portalScope(inv.scope),
            container_ids: (inv.containers || []).map(cid => portalToInt(cid)).filter(Boolean),
        }));
    }, [realMappedId]);
    const containerIdForRow = React.useCallback((shipmentId, ship, row) => {
        if (portalIsRealId(row.container_id))
            return parseInt(row.container_id, 10);
        if (row.container_id && idMapRef.current.containers[shipmentId + ':' + row.container_id])
            return idMapRef.current.containers[shipmentId + ':' + row.container_id];
        const container = (ship.containers || []).find(c => (c.number && c.number === row.container) || String(c.id) === String(row.container_id));
        if (!container)
            return false;
        if (portalIsRealId(container.id))
            return parseInt(container.id, 10);
        return idMapRef.current.containers[shipmentId + ':' + container.id] || false;
    }, []);
    const buildPackingRows = React.useCallback((snapshot, shipmentId, ship, packing, rows) => {
        const packKey = shipmentId + ':' + packing.id;
        const realPackingId = realMappedId('packings', packKey, packing.id);
        return (rows || []).map((row, idx) => {
            const block = (packing.blocks || []).find(b => b.name === row.block) || (packing.blocks || [])[0] || {};
            const productId = row.product_id || block.product || (packing.products || [])[0];
            const product = findProduct(snapshot, productId);
            const kind = (product.kind || row.tipo || 'placa').toLowerCase();
            const tipo = kind.indexOf('placa') >= 0 ? 'Placa' : (kind.indexOf('formato') >= 0 ? 'Formato' : 'Pieza');
            const clientId = row._client_id || row.id || ('row-' + idx);
            const rowMapKey = (realPackingId || packing.id) + ':' + clientId;
            const rowId = portalIsRealId(row._odoo_id || row.id) ? parseInt(row._odoo_id || row.id, 10) : (idMapRef.current.rows[rowMapKey] || 0);
            return {
                id: rowId,
                _client_id: String(clientId),
                product_id: portalToInt(productId),
                container_id: containerIdForRow(shipmentId, ship, row) || false,
                tipo,
                grosor: row.thickness !== undefined ? String(row.thickness || '') : String(row.grosor || ''),
                alto: portalParseDecimal(row.h !== undefined && row.h !== '' ? row.h : row.alto),
                ancho: portalParseDecimal(row.w !== undefined && row.w !== '' ? row.w : row.ancho),
                peso: portalParseDecimal(row.weight !== undefined && row.weight !== '' ? row.weight : row.peso),
                quantity: tipo === 'Placa' ? 0 : Number(row.quantity || row.qty || 1),
                bloque: row.block || row.bloque || '',
                numero_placa: row.plate || row.numero_placa || '',
                atado: row.atado || '',
                color: row.notes || row.color || '',
                grupo_name: row.grupo || row.grupo_name || '',
                pedimento: row.pedimento || '',
                ref_proveedor: row.ref || row.ref_proveedor || product.ref || '',
            };
        });
    }, [containerIdForRow, findProduct, realMappedId]);
    const persistSnapshot = React.useCallback(async (snapshot) => {
        if (!PORTAL_TOKEN || t.show_completed_route)
            return;
        const currentHash = JSON.stringify(snapshot);
        if (currentHash === lastHashRef.current)
            return;
        setSaveState('saving');
        await portalRpc('/supplier/api/v2/save_globals', {
            token: PORTAL_TOKEN,
            globals_data: {
                proforma_number: snapshot.globals.proforma_number || '',
                invoice_global_number: snapshot.globals.invoice_global || '',
                payment_terms: snapshot.globals.payment_terms || '',
                country_origin: snapshot.globals.country_origin || '',
                port_origin: snapshot.globals.port_origin || '',
                port_destination: snapshot.globals.port_destination || '',
                incoterm: snapshot.globals.incoterm || '',
                general_notes: snapshot.globals.general_notes || '',
            },
        });
        for (const ship of (snapshot.shipments || [])) {
            let shipmentId = realMappedId('shipments', ship.id, ship.id);
            if (shipmentId) {
                await portalRpc('/supplier/api/v2/update_shipment', { token: PORTAL_TOKEN, shipment_id: shipmentId, shipment_data: shipmentPayload(snapshot, ship) });
            } else {
                const created = await portalRpc('/supplier/api/v2/create_shipment', { token: PORTAL_TOKEN, shipment_data: shipmentPayload(snapshot, ship) });
                if (!created || !created.success || !created.shipment_id)
                    throw new Error((created && created.message) || 'No se pudo crear el embarque.');
                shipmentId = created.shipment_id;
                idMapRef.current.shipments[String(ship.id)] = shipmentId;
            }
            const containerResult = await portalRpc('/supplier/api/v2/save_containers', { token: PORTAL_TOKEN, shipment_id: shipmentId, containers: buildContainerPayload(shipmentId, ship.containers) });
            if (containerResult && containerResult.success && Array.isArray(containerResult.containers)) {
                (ship.containers || []).forEach((local, idx) => {
                    if (portalIsRealId(local.id)) return;
                    const match = containerResult.containers.find(c => (c.container_number || '') === (local.number || '')) || containerResult.containers[idx];
                    if (match && match.id)
                        idMapRef.current.containers[shipmentId + ':' + local.id] = match.id;
                });
            }
            const invoiceResult = await portalRpc('/supplier/api/v2/save_invoices', { token: PORTAL_TOKEN, shipment_id: shipmentId, invoices: buildInvoicePayload(shipmentId, ship.invoices) });
            if (invoiceResult && invoiceResult.success && Array.isArray(invoiceResult.invoices)) {
                (ship.invoices || []).forEach((local, idx) => {
                    if (portalIsRealId(local.id)) return;
                    const match = invoiceResult.invoices.find(inv => (inv.invoice_number || '') === (local.number || '')) || invoiceResult.invoices[idx];
                    if (match && match.id)
                        idMapRef.current.invoices[shipmentId + ':' + local.id] = match.id;
                });
            }
            for (const packing of (ship.packings || [])) {
                const packKey = shipmentId + ':' + packing.id;
                const packingId = realMappedId('packings', packKey, packing.id);
                const packingResult = await portalRpc('/supplier/api/v2/save_packing', {
                    token: PORTAL_TOKEN,
                    shipment_id: shipmentId,
                    packing_data: { id: packingId || false, packing_number: packing.number || '', packing_date: packing.date || false, scope: 'full_shipment', container_ids: [] },
                    rows: buildPackingRows(snapshot, shipmentId, ship, packing, packing.rows || []),
                });
                if (!packingResult || !packingResult.success)
                    throw new Error((packingResult && packingResult.message) || 'No se pudo guardar el packing list.');
                const realPackingId = packingResult.packing_id;
                if (realPackingId && !portalIsRealId(packing.id))
                    idMapRef.current.packings[packKey] = realPackingId;
                if (Array.isArray(packingResult.rows)) {
                    packingResult.rows.forEach(r => {
                        if (r.client_id && r.id) {
                            idMapRef.current.rows[(realPackingId || packing.id) + ':' + r.client_id] = r.id;
                            idMapRef.current.rows[packing.id + ':' + r.client_id] = r.id;
                        }
                    });
                }
                // Subir fotos de bloque pendientes (solo placas; necesitan el id real del embarque).
                for (const block of (packing.blocks || [])) {
                    const pendB = pendingImagesRef.current.blocks[block.id];
                    if (pendB && block.name && block.needs_photo !== false) {
                        try {
                            const resB = await portalRpc('/supplier/api/v2/upload_block_image', {
                                token: PORTAL_TOKEN, shipment_id: shipmentId, block_name: block.name,
                                product_id: portalToInt(block.product), image_data: pendB.data, image_name: pendB.name,
                            });
                            if (resB && resB.success)
                                delete pendingImagesRef.current.blocks[block.id];
                        }
                        catch (e) { console.error('[SupplierPortal] Error subiendo foto de bloque:', e); }
                    }
                }
                // Subir fotos por fila pendientes (solo placas; ya con id real de la fila).
                for (const row of (packing.rows || [])) {
                    const pendR = pendingImagesRef.current.rows[row.id];
                    if (!pendR)
                        continue;
                    const realRowId = portalIsRealId(row._odoo_id || row.id)
                        ? parseInt(row._odoo_id || row.id, 10)
                        : (idMapRef.current.rows[(realPackingId || packing.id) + ':' + row.id] || 0);
                    if (!realRowId)
                        continue;
                    try {
                        const resR = await portalRpc('/supplier/api/v2/upload_row_image', {
                            token: PORTAL_TOKEN, row_id: realRowId, image_data: pendR.data, image_name: pendR.name,
                        });
                        if (resR && resR.success)
                            delete pendingImagesRef.current.rows[row.id];
                    }
                    catch (e) { console.error('[SupplierPortal] Error subiendo foto de fila:', e); }
                }
            }
        }
        lastHashRef.current = currentHash;
        // El servidor ya tiene este estado: actualiza el respaldo local marcándolo
        // como sincronizado (syncedHash = currentHash) e incluyendo el idMap actual.
        savePortalDraft(snapshot, idMapRef.current, currentHash);
        setSaveState('saved');
    }, [buildContainerPayload, buildInvoicePayload, buildPackingRows, shipmentPayload, realMappedId, t.show_completed_route]);
    const runPersist = React.useCallback(async (snapshot) => {
        if (savingRef.current) {
            pendingRef.current = snapshot;
            return;
        }
        savingRef.current = true;
        try {
            await persistSnapshot(snapshot);
            savingRef.current = false;
            if (pendingRef.current) {
                const next = pendingRef.current;
                pendingRef.current = null;
                runPersist(next);
            }
        } catch (err) {
            savingRef.current = false;
            console.error('[SupplierPortal] Error guardando portal:', err);
            setSaveState('error');
        }
    }, [persistSnapshot]);
    const schedulePersist = React.useCallback((snapshot) => {
        if (!PORTAL_TOKEN || t.show_completed_route)
            return;
        setSaveState('dirty');
        if (saveTimerRef.current)
            clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => runPersist(snapshot), 500);
    }, [runPersist, t.show_completed_route]);
    const setProforma = React.useCallback((nextOrUpdater) => {
        setProformaRaw(prev => {
            const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
            proformaRef.current = next;
            // Respaldo local inmediato (síncrono) ANTES del guardado al servidor.
            if (!t.show_completed_route)
                savePortalDraft(next, idMapRef.current, lastHashRef.current);
            schedulePersist(next);
            return next;
        });
    }, [schedulePersist, t.show_completed_route]);
    const reloadPortal = React.useCallback(async () => {
        if (!PORTAL_TOKEN || t.show_completed_route)
            return;
        try {
            const result = await portalRpc('/supplier/api/v2/reload', { token: PORTAL_TOKEN });
            if (result && result.success && result.proforma) {
                const normalized = normalizePortalProforma(result.proforma);
                proformaRef.current = normalized;
                lastHashRef.current = JSON.stringify(normalized);
                setProformaRaw(normalized);
                setSaveState('saved');
            }
        } catch (err) {
            console.error('[SupplierPortal] Error recargando portal:', err);
            setSaveState('error');
        }
    }, [t.show_completed_route]);
    const flushPersist = React.useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        await persistSnapshot(proformaRef.current);
    }, [persistSnapshot]);
    // API mínima expuesta para las pestañas (subida de documentos): resolver el id
    // real del embarque (los locales tienen id temporal hasta persistir) y forzar
    // el guardado para garantizar que el embarque exista antes de adjuntar el PDF.
    React.useEffect(() => {
        window.__supplierPortalApi = {
            token: PORTAL_TOKEN,
            resolveRealId: (kind, id) => realMappedId(kind, id, id),
            flush: flushPersist,
        };
    }, [flushPersist, realMappedId]);
    const completePortal = React.useCallback(async () => {
        try {
            await flushPersist();
            const result = await portalRpc('/supplier/api/v2/complete', { token: PORTAL_TOKEN });
            if (!result || !result.success)
                throw new Error((result && result.message) || 'No se pudo completar la proforma.');
            await reloadPortal();
            if (result.warning)
                setNotice({ title: 'Operación finalizada con avisos', message: result.warning, tone: 'warn', cta: 'Entendido' });
            else
                setNotice({ title: '¡Listo!', message: 'La proforma se marcó como completa. SOM GROUP recibió la notificación.', tone: 'ok', cta: 'Cerrar' });
        } catch (err) {
            console.error('[SupplierPortal] Error completando portal:', err);
            setNotice({ title: 'No se pudo completar', message: err.message || 'No se pudo completar la proforma.', tone: 'error', cta: 'Cerrar' });
        }
    }, [flushPersist, reloadPortal]);
    // El arranque corre UNA sola vez por montaje. Antes se re-ejecutaba y podía
    // sobrescribir el estado en memoria (reiniciando la vista y perdiendo lo no
    // guardado). El guard evita ese ciclo/reinicio inesperado.
    const bootstrappedRef = React.useRef(false);
    React.useEffect(() => {
        if (t.show_completed_route) {
            const next = completedProforma();
            proformaRef.current = next;
            setProformaRaw(next);
            return;
        }
        if (bootstrappedRef.current)
            return;
        bootstrappedRef.current = true;
        let base = (window.SupplierReactExactData && window.SupplierReactExactData.proforma) || MOCK_PROFORMA;
        proformaRef.current = base;
        lastHashRef.current = JSON.stringify(base);
        setProformaRaw(base);
        (async () => {
            // 1) Verdad del servidor (lo último confirmado en Odoo).
            try {
                const result = await portalRpc('/supplier/api/v2/reload', { token: PORTAL_TOKEN });
                if (result && result.success && result.proforma) {
                    base = normalizePortalProforma(result.proforma);
                    proformaRef.current = base;
                    lastHashRef.current = JSON.stringify(base);
                    setProformaRaw(base);
                    setSaveState('saved');
                }
            }
            catch (err) {
                console.error('[SupplierPortal] Error recargando portal:', err);
            }
            // 2) Recuperación anti-pérdida: si el respaldo local tiene cambios que
            //    nunca llegaron al servidor, se restauran y se reintenta el guardado.
            try {
                const draft = loadPortalDraft();
                if (draft && draft.proforma) {
                    const draftHash = JSON.stringify(draft.proforma);
                    const unsynced = draftHash !== (draft.syncedHash || '') && draftHash !== lastHashRef.current;
                    if (unsynced) {
                        if (draft.idMap)
                            idMapRef.current = Object.assign(idMapRef.current, draft.idMap);
                        proformaRef.current = draft.proforma;
                        lastHashRef.current = draft.syncedHash || '';
                        setProformaRaw(draft.proforma);
                        setSaveState('dirty');
                        schedulePersist(draft.proforma);
                        console.info('[SupplierPortal] Datos recuperados del respaldo local.');
                    }
                }
            }
            catch (err) {
                console.error('[SupplierPortal] Error recuperando respaldo local:', err);
            }
        })();
    }, [t.show_completed_route]);
    // Vuelca lo pendiente al cerrar/ocultar la pestaña. El respaldo local es
    // síncrono (garantizado); además se intenta empujar al servidor best-effort.
    React.useEffect(() => {
        if (!PORTAL_TOKEN || t.show_completed_route)
            return;
        const flushNow = () => {
            try {
                savePortalDraft(proformaRef.current, idMapRef.current, lastHashRef.current);
                if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                runPersist(proformaRef.current);
            }
            catch (_) { }
        };
        const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
        window.addEventListener('beforeunload', flushNow);
        window.addEventListener('pagehide', flushNow);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.removeEventListener('beforeunload', flushNow);
            window.removeEventListener('pagehide', flushNow);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [runPersist, t.show_completed_route]);
    React.useEffect(() => () => {
        if (saveTimerRef.current)
            clearTimeout(saveTimerRef.current);
    }, []);
    const status = React.useMemo(() => computeStatus(proforma), [proforma]);
    // routing: { section, shipmentId?, tab? }
    const [route, setRoute] = React.useState({ section: 'overview' });
    const [packingWiz, setPackingWiz] = React.useState(null);
    const [showOnboard, setShowOnboard] = React.useState(t.show_onboarding);
    const [mobileNav, setMobileNav] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    React.useEffect(() => { setShowOnboard(t.show_onboarding); }, [t.show_onboarding]);
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
    if (typeof window !== 'undefined' && typeof window.__setLang === 'function') {
        window.__setLang(lang);
    }
    const tFn = (k) => (I18N[lang] && I18N[lang][k]) || (I18N.es[k]) || k;
    const openPackingWizard = (shipmentId, packingId) => setPackingWiz({ shipmentId, packingId });
    const closePackingWizard = () => setPackingWiz(null);
    const savePacking = (shipmentId, packingId, draftSnap, rowsSnap) => {
        if (!shipmentId)
            return;
        setProformaRaw(prev => {
            const next = {
                ...prev,
                shipments: prev.shipments.map(s => {
                    if (s.id !== shipmentId)
                        return s;
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
            };

            proformaRef.current = next;
            // Respaldo local inmediato del packing recién capturado (anti-pérdida).
            if (!t.show_completed_route)
                savePortalDraft(next, idMapRef.current, lastHashRef.current);

            // PL-PERSIST-001:
            // El Packing List no debe esperar al debounce global. Al cerrar el
            // asistente, se dispara persistencia inmediata para evitar que un
            // refresh rápido pierda filas recién capturadas.
            if (!t.show_completed_route && PORTAL_TOKEN) {
                if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                runPersist(next);
            } else {
                schedulePersist(next);
            }

            return next;
        });
    };
    // Eliminar un embarque completo: lo quita del estado y, si ya existe en
    // Odoo, llama al endpoint de borrado. Vuelve al listado de embarques.
    const deleteShipment = (shipmentId) => {
        const realId = realMappedId('shipments', shipmentId, shipmentId);
        if (realId && PORTAL_TOKEN && !t.show_completed_route) {
            portalRpc('/supplier/api/v2/delete_shipment', { token: PORTAL_TOKEN, shipment_id: realId })
                .catch(err => console.error('[SupplierPortal] Error eliminando embarque:', err));
        }
        setProforma(prev => ({ ...prev, shipments: prev.shipments.filter(s => s.id !== shipmentId) }));
        setRoute({ section: 'shipments' });
    };
    // Eliminar un packing list: lo quita del embarque y, si ya existe en Odoo,
    // llama al endpoint de borrado.
    const deletePacking = (shipmentId, packingId) => {
        const realShipId = realMappedId('shipments', shipmentId, shipmentId);
        const realPackingId = portalIsRealId(packingId)
            ? parseInt(packingId, 10)
            : (idMapRef.current.packings[realShipId + ':' + packingId] || 0);
        if (realPackingId && PORTAL_TOKEN && !t.show_completed_route) {
            portalRpc('/supplier/api/v2/delete_packing', { token: PORTAL_TOKEN, packing_id: realPackingId })
                .catch(err => console.error('[SupplierPortal] Error eliminando packing:', err));
        }
        setProforma(prev => ({
            ...prev,
            shipments: prev.shipments.map(s => s.id === shipmentId
                ? { ...s, packings: s.packings.filter(p => p.id !== packingId) }
                : s),
        }));
    };
    return (React.createElement(LangCtx.Provider, { value: { lang, t: tFn } },
        React.createElement("div", { className: "app" },
            React.createElement("header", { className: "app-header" },
                React.createElement("button", { className: "icon-btn", style: { display: 'none' }, onClick: () => setMobileNav(!mobileNav), "aria-label": "Men\u00FA" },
                    React.createElement(Icon, { name: "menu", size: 16 })),
                React.createElement("div", { className: "brand" },
                    React.createElement("img", { src: "/stock_lot_packing_import/static/src/img/icon.png", alt: "SOM", className: "brand-logo" }),
                    React.createElement("div", { className: "brand-name" },
                        React.createElement("span", null, "SOM"),
                        React.createElement("small", null, "Portal proveedor"))),
                React.createElement("div", { className: "header-ctx" },
                    React.createElement("span", { className: "header-chip" },
                        React.createElement("span", { className: "dot" }),
                        React.createElement("span", null,
                            tFn('vendor'),
                            ":"),
                        React.createElement("strong", null, proforma.vendor)),
                    React.createElement("span", { className: "header-chip" },
                        React.createElement("span", null,
                            tFn('purchase_order'),
                            ":"),
                        React.createElement("strong", null, proforma.po_name)),
                    React.createElement("div", { className: "lang-pill", role: "tablist", "aria-label": "Idioma" }, ['es', 'en', 'zh', 'it', 'pt'].map(l => (React.createElement("button", { key: l, className: lang === l ? 'active' : '', onClick: () => setTweak({ lang: l }) }, l === 'zh' ? '中' : l.toUpperCase())))),
                    React.createElement("button", { className: "guide-toggle", onClick: () => setShowOnboard(true), title: "Tutorial inicial" },
                        React.createElement(Icon, { name: "play", size: 12 }),
                        React.createElement("span", null, "Tutorial")),
                    React.createElement("div", { className: "user-avatar", title: "ZW" }, "ZW"))),
            React.createElement("div", { className: "app-body guide-collapsed" },
                React.createElement(Sidebar, { proforma: proforma, route: route, setRoute: setRoute, status: status, mobileOpen: mobileNav }),
                React.createElement("main", { className: "main" },
                    route.section === 'overview' && React.createElement(Overview, { proforma: proforma, status: status, setRoute: setRoute }),
                    route.section === 'globals' && React.createElement(Globals, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute, validationStyle: t.validation_style }),
                    route.section === 'shipments' && React.createElement(ShipmentsList, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute }),
                    route.section === 'shipment' && React.createElement(ShipmentDetail, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute, route: route, openPackingWizard: openPackingWizard, onDeleteShipment: deleteShipment, onDeletePacking: deletePacking }),
                    route.section === 'documents' && React.createElement(Documents, { proforma: proforma, setProforma: setProforma, setRoute: setRoute }),
                    route.section === 'review' && React.createElement(Confirm, { proforma: proforma, status: status, setRoute: setRoute, onComplete: completePortal }))),
            packingWiz && (React.createElement(PackingWizard, { proforma: proforma, shipmentId: packingWiz.shipmentId, packingId: packingWiz.packingId, sampleRows: SAMPLE_ROWS, onClose: closePackingWizard, onSave: savePacking, pendingImages: pendingImagesRef })),
            showOnboard && React.createElement(Onboarding, { onClose: () => setShowOnboard(false) }),
            React.createElement(NoticeModal, { notice: notice, onClose: () => setNotice(null) }),
            React.createElement(TweaksPanel, { title: "Tweaks" },
                React.createElement(TweakSection, { label: "Idioma & branding" },
                    React.createElement(TweakRadio, { label: "Idioma", value: t.lang, onChange: (v) => setTweak({ lang: v }), options: [{ value: 'es', label: 'ES' }, { value: 'en', label: 'EN' }, { value: 'zh', label: '中' }, { value: 'it', label: 'IT' }, { value: 'pt', label: 'PT' }] }),
                    React.createElement(TweakColor, { label: "Acento", value: t.accent, options: ACCENT_OPTIONS, onChange: (v) => setTweak({ accent: v }) }),
                    React.createElement(TweakRadio, { label: "Densidad", value: t.density, onChange: (v) => setTweak({ density: v }), options: [{ value: 'comfortable', label: 'Cómoda' }, { value: 'compact', label: 'Compacta' }] })),
                React.createElement(TweakSection, { label: "Onboarding" },
                    React.createElement(TweakToggle, { label: "Mostrar onboarding ahora", value: t.show_onboarding, onChange: (v) => setTweak({ show_onboarding: v }) })),
                React.createElement(TweakSection, { label: "Validaci\u00F3n" },
                    React.createElement(TweakSelect, { label: "Estilo cuando hay errores", value: t.validation_style, onChange: (v) => setTweak({ validation_style: v }), options: [
                            { value: 'inline', label: 'Suave — solo inline en cada campo' },
                            { value: 'sticky', label: 'Inline + banner sticky resumen' },
                            { value: 'block', label: 'Bloquear avance hasta corregir' },
                        ] })),
                React.createElement(TweakSection, { label: "Estado simulado" },
                    React.createElement(TweakToggle, { label: "Mostrar todo completado", value: t.show_completed_route, onChange: (v) => setTweak({ show_completed_route: v }) }))))));
}
function completedProforma() {
    const base = JSON.parse(JSON.stringify(MOCK_PROFORMA));
    base.globals.invoice_global = 'INV-2026-GLOBAL-001';
    base.globals.general_notes = 'Las placas vienen empacadas en bundles de madera dura. Cuidado con esquinas.';
    base.shipments.forEach(s => {
        if (!s.type)
            s.type = 'maritime';
        if (!s.shipping_line)
            s.shipping_line = 'COSCO Shipping Lines';
        if (!s.vessel)
            s.vessel = 'COSCO TAICANG / 044E';
        if (!s.etd)
            s.etd = '2026-07-15';
        if (!s.eta)
            s.eta = '2026-08-07';
        if (!s.bl_number) {
            s.bl_number = 'COSU6817042777';
            s.bl_date = '2026-07-16';
            s.bl_file = 'BL.pdf';
        }
        if (s.invoices.length === 0)
            s.invoices = [{ id: 'i', number: 'INV-2026-090', date: '2026-07-14', amount: 45200, currency: 'USD', scope: 'full', containers: [] }];
        s.invoices.forEach(i => { if (!i.number)
            i.number = 'INV-AUTO'; if (!i.amount)
            i.amount = 12000; if (!i.date)
            i.date = '2026-07-14'; });
        if (s.containers.length === 0)
            s.containers = [{ id: 'cx', number: 'COSU6817044', seal: 'CN8821099', type: '40HQ', weight: 27200, volume: 67.2, packages: 12 }];
        s.containers.forEach(c => { if (!c.number)
            c.number = 'COSU6817099'; });
        if (s.packings.length === 0) {
            s.packings = [{ id: 'pkx', number: 'PK-AUTO-1', date: '2026-07-14', products: ['p1'], blocks: [{ id: 'bx', name: 'B-AUTO', count: 12, photo: true, product: 'p1' }], rows_filled: 12, rows_total: 12 }];
        }
        s.packings.forEach(pk => { pk.rows_filled = pk.rows_total; pk.blocks.forEach(b => b.photo = true); });
    });
    return base;
}
// Límite de error: si algún componente lanza durante el render, en lugar de
// dejar la app en blanco o en un ciclo de remontaje, mostramos un aviso y un
// botón de recarga. Los datos capturados siguen a salvo en el respaldo local,
// así que al recargar se recuperan.
class PortalErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        console.error('[SupplierPortal] Error de render:', error, info);
    }
    render() {
        if (this.state.error) {
            return React.createElement('div', { style: { padding: 24, maxWidth: 520, margin: '48px auto', textAlign: 'center', fontFamily: 'inherit' } }, React.createElement('h2', { style: { marginBottom: 8 } }, 'Ocurrió un problema al mostrar el portal'), React.createElement('p', { style: { color: '#666', lineHeight: 1.5, marginBottom: 16 } }, 'Tus datos capturados están a salvo. Recarga la página para continuar desde donde te quedaste.'), React.createElement('button', { onClick: () => window.location.reload(), style: { padding: '10px 20px', cursor: 'pointer', borderRadius: 8, border: 'none', background: 'var(--accent, #59473d)', color: '#fff', fontWeight: 600 } }, 'Recargar'));
        }
        return this.props.children;
    }
}
const __supplierPortalRoot = document.getElementById('root');
if (__supplierPortalRoot) {
    ReactDOM.createRoot(__supplierPortalRoot).render(React.createElement(PortalErrorBoundary, null, React.createElement(App, null)));
}

})();
//# sourceURL=portal_react_exact.bundle.js
