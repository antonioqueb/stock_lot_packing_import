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
        var byKey = {};
        rows.forEach(function (r) {
            var block = s(r.bloque || r.block || 'SIN BLOQUE').trim() || 'SIN BLOQUE';
            var pid = r.product_id || (fallbackProducts[0] && fallbackProducts[0].id);
            var key = String(pid) + '::' + block.toLowerCase();
            if (!byKey[key])
                byKey[key] = { id: key, name: block, count: 0, photo: hasBlockImage(pid, block) || !!r.has_image, product: pid };
            byKey[key].count += 1;
            if (r.has_image)
                byKey[key].photo = true;
        });
        var blocks = Object.keys(byKey).map(function (k) { return byKey[k]; });
        var productIds = uniq(rows.map(function (r) { return r.product_id; })).filter(Boolean);
        if (!productIds.length && arr(pk.products).length)
            productIds = pk.products;
        if (!productIds.length && fallbackProducts.length)
            productIds = [fallbackProducts[0].id];
        var total = n(pk.row_count || pk.rows_total || rows.length || blocks.reduce(function (a, b) { return a + n(b.count); }, 0), 0);
        var filled = rows.filter(function (r) {
            var tipo = s(r.tipo || 'Placa').toLowerCase();
            var hasMeasure = tipo.indexOf('placa') >= 0 ? (n(r.alto) > 0 && n(r.ancho) > 0) : (n(r.quantity) > 0);
            return hasMeasure;
        }).length;
        return {
            id: pk.id || pk._client_id || ('pk-' + Math.random().toString(36).slice(2)),
            number: s(pk.packing_number || pk.number || pk.name, 'PK'),
            date: s(pk.packing_date || pk.date, ''),
            products: productIds,
            blocks: blocks,
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
                number: sh.sequence || sh.number || (idx + 1),
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
                port_origin: s(firstShipment.port_origin || '', ''),
                port_destination: s(firstShipment.port_destination || '', ''),
                incoterm: s(p.incoterm || (payload.header && payload.header.incoterm), ''),
                general_notes: s(p.general_notes || (payload.header && payload.header.general_notes), '')
            },
            products: products,
            shipments: shipments
        };
    }
    var rawPayload = parsePayload();
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
    { id: 'r11', block: 'B-2024-119', atado: 'A-03', plate: 'P-011', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto', 'Falta ancho', 'Asignar contenedor'] },
    { id: 'r12', block: 'B-2024-119', atado: 'A-03', plate: 'P-012', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto', 'Falta ancho', 'Asignar contenedor'] },
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
    const required = ['proforma_number', 'payment_terms', 'country_origin', 'port_origin', 'port_destination', 'incoterm'];
    const filled = required.filter(k => (g[k] || '').toString().trim().length > 0).length;
    const globals_pct = Math.round(filled / required.length * 100);
    const globals_status = globals_pct === 100 ? 'done' : globals_pct > 0 ? 'partial' : 'todo';
    const shipments_status = proforma.shipments.map(s => {
        const hasLog = s.type && s.shipping_line && s.vessel && s.etd && s.eta;
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
// Minimal i18n — only the strings we use in this redesign.
// English/Chinese fallbacks; the design language is Spanish first.
const I18N = {
    es: {
        portal: 'Portal del Proveedor',
        welcome_back: 'Bienvenido de vuelta',
        welcome_first: 'Bienvenido',
        progress: 'Progreso',
        completed: 'completado',
        next_action: 'Siguiente paso recomendado',
        save: 'Guardar',
        saved: 'Cambios guardados',
        autosaving: 'Guardando…',
        cancel: 'Cancelar',
        continue: 'Continuar',
        back: 'Atrás',
        next: 'Siguiente',
        add: 'Agregar',
        delete: 'Eliminar',
        edit: 'Editar',
        open: 'Abrir',
        upload_photo: 'Subir foto',
        upload_doc: 'Subir documento',
        purchase_order: 'Orden de Compra',
        receipt: 'Recepción',
        vendor: 'Proveedor',
        optional: 'opcional',
        required: 'obligatorio',
        show_guide: 'Mostrar guía',
        hide_guide: 'Ocultar guía',
        help: 'Ayuda',
    },
    en: {
        portal: 'Supplier Portal',
        welcome_back: 'Welcome back',
        welcome_first: 'Welcome',
        progress: 'Progress',
        completed: 'complete',
        next_action: 'Next recommended step',
        save: 'Save',
        saved: 'Changes saved',
        autosaving: 'Saving…',
        cancel: 'Cancel',
        continue: 'Continue',
        back: 'Back',
        next: 'Next',
        add: 'Add',
        delete: 'Delete',
        edit: 'Edit',
        open: 'Open',
        upload_photo: 'Upload photo',
        upload_doc: 'Upload document',
        purchase_order: 'Purchase Order',
        receipt: 'Receipt',
        vendor: 'Vendor',
        optional: 'optional',
        required: 'required',
        show_guide: 'Show guide',
        hide_guide: 'Hide guide',
        help: 'Help',
    },
    zh: {
        portal: '供应商门户',
        welcome_back: '欢迎回来',
        welcome_first: '欢迎',
        progress: '进度',
        completed: '已完成',
        next_action: '下一步建议',
        save: '保存',
        saved: '已保存',
        autosaving: '保存中…',
        cancel: '取消',
        continue: '继续',
        back: '返回',
        next: '下一步',
        add: '添加',
        delete: '删除',
        edit: '编辑',
        open: '打开',
        upload_photo: '上传照片',
        upload_doc: '上传文件',
        purchase_order: '采购订单',
        receipt: '收货单',
        vendor: '供应商',
        optional: '可选',
        required: '必填',
        show_guide: '显示指南',
        hide_guide: '隐藏指南',
        help: '帮助',
    },
};
const LangCtx = React.createContext({ lang: 'es', t: (k) => k });
const useT = () => React.useContext(LangCtx);
window.I18N = I18N;
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
const Input = (p) => React.createElement("input", { className: `input ${p.mono ? 'mono' : ''} ${p.className || ''}`, ...p });
const Select = ({ children, className = '', ...p }) => React.createElement("select", { className: `select ${className}`, ...p }, children);
const Textarea = (p) => React.createElement("textarea", { className: `textarea ${p.className || ''}`, ...p });
const Badge = ({ tone = 'draft', children, dot }) => (React.createElement("span", { className: `badge ${tone}` },
    dot && React.createElement("span", { className: "dot" }),
    children));
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
            desc: `Te faltan ${Math.ceil((100 - status.globals_pct) / 14)} campos: incoterm, puerto destino y otros.`,
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
                        "piezas solicitadas"))),
            React.createElement(ProgressRing, { pct: status.overall, size: 148, stroke: 10, label: status.overall === 100 ? 'listo' : 'completo' })),
        status.overall < 100 && (React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head no-divider" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Lo que te falta para terminar"),
                    React.createElement("p", { className: "sub" }, "Ordenados de lo m\u00E1s f\u00E1cil a lo m\u00E1s detallado. Comienza por el primero.")),
                React.createElement(Btn, { variant: "accent", icon: "play", onClick: () => { var _a; return (_a = pending[0]) === null || _a === void 0 ? void 0 : _a.action(); } }, "Continuar donde qued\u00E9")),
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
    // simulated validation
    if (g.proforma_number && !/^PI-/i.test(g.proforma_number))
        errors.proforma_number = 'El número debería empezar con "PI-" para identificar una Proforma.';
    if (!g.incoterm)
        errors.incoterm = 'Falta este dato: define quién paga y se hace cargo del transporte.';
    if (!g.port_destination)
        errors.port_destination = 'Es necesario para coordinar la llegada del embarque.';
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
                    React.createElement("h2", null, "Log\u00EDstica internacional"),
                    React.createElement("p", { className: "sub" }, "Ruta y t\u00E9rminos del env\u00EDo. Estos datos van impresos en la documentaci\u00F3n de aduanas."))),
            React.createElement("div", { className: "fld-row cols-3" },
                React.createElement(Field, { label: "Pa\u00EDs de origen", required: true, help: "Pa\u00EDs desde donde sale la mercanc\u00EDa." },
                    React.createElement(Input, { placeholder: "Ej. China", value: g.country_origin, onChange: (e) => update('country_origin', e.target.value) })),
                React.createElement(Field, { label: "Puerto de origen", required: true, help: "Puerto mar\u00EDtimo o aeropuerto desde donde zarpa el embarque.", helpExample: "Ej: Shanghai, Ningbo" },
                    React.createElement(Input, { placeholder: "Ej. Shanghai", value: g.port_origin, onChange: (e) => update('port_origin', e.target.value) })),
                React.createElement(Field, { label: "Puerto destino", required: true, help: "El puerto mexicano donde llegar\u00E1 el embarque.", helpExample: "Ej: Manzanillo, Veracruz, L\u00E1zaro C\u00E1rdenas", error: errors.port_destination },
                    React.createElement(Input, { placeholder: "Ej. Manzanillo", value: g.port_destination, onChange: (e) => update('port_destination', e.target.value) }))),
            React.createElement("div", { className: "fld-row", style: { marginTop: 16 } },
                React.createElement(Field, { label: "Incoterm", required: true, help: "Define qu\u00E9 parte (proveedor o cliente) cubre el transporte, seguro y aduanas. Si no est\u00E1s seguro, pregunta a tu contacto de SOM GROUP.", helpExample: "CIF = t\u00FA pagas hasta el puerto destino, incluyendo seguro", error: errors.incoterm },
                    React.createElement(Select, { value: g.incoterm, onChange: (e) => update('incoterm', e.target.value) },
                        React.createElement("option", { value: "" }, "Selecciona\u2026"),
                        React.createElement("option", null, "EXW"),
                        React.createElement("option", null, "FOB"),
                        React.createElement("option", null, "CIF"),
                        React.createElement("option", null, "CFR"),
                        React.createElement("option", null, "DAP"),
                        React.createElement("option", null, "DDP"))),
                React.createElement(Field, { label: "Condiciones de pago", required: true, help: "C\u00F3mo y cu\u00E1ndo te van a pagar.", helpExample: "T/T 30% advance, 70% B/L copy" },
                    React.createElement(Input, { placeholder: "Ej. T/T 30% advance, 70% B/L copy", value: g.payment_terms, onChange: (e) => update('payment_terms', e.target.value) })))),
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
        proforma.shipments.length === 0 ? (React.createElement(Empty, { icon: "ship", title: "No hay embarques registrados todav\u00EDa", action: React.createElement(Btn, { variant: "accent", icon: "plus" }, "Crear el primer embarque") }, "Cuando sepas la fecha aproximada del env\u00EDo, agrega un embarque y empieza a capturar log\u00EDstica y packing list.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, proforma.shipments.map((s, idx) => {
            const sst = status.shipments_status[idx];
            return (React.createElement("div", { key: s.id, className: "ship-card", onClick: () => setRoute({ section: 'shipment', shipmentId: s.id }) },
                React.createElement("div", { className: "num" },
                    "#",
                    s.number),
                React.createElement("div", { className: "meta" },
                    React.createElement("div", { className: "title" },
                        React.createElement("span", null, s.vessel || React.createElement("span", { className: "text-muted" }, "Sin buque asignado")),
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
                            " ",
                            s.shipping_line || 'Sin naviera'),
                        React.createElement("span", { className: "arrow" }, "\u00B7"),
                        React.createElement("span", { className: "mono" }, proforma.globals.port_origin || '—'),
                        React.createElement(Icon, { name: "arrow_right", size: 11, className: "arrow" }),
                        React.createElement("span", { className: "mono" }, proforma.globals.port_destination || '—'),
                        React.createElement("span", { className: "arrow" }, "\u00B7"),
                        React.createElement("span", null,
                            "ETD ",
                            React.createElement("span", { className: "mono" }, s.etd || '—')),
                        React.createElement("span", null,
                            "ETA ",
                            React.createElement("span", { className: "mono" }, s.eta || '—')))),
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
        React.createElement(Callout, { tone: "info", icon: "info", title: "\u00BFCu\u00E1ndo divido en varios embarques?" }, "Si tu producci\u00F3n se va a embarcar en fechas distintas o en barcos diferentes, crea un embarque por cada uno. Si todo sale en el mismo barco, un solo embarque est\u00E1 bien.")));
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
const ShipmentDetail = ({ proforma, setProforma, status, setRoute, route, openPackingWizard }) => {
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
                React.createElement("p", { className: "lead" }, ship.vessel ? React.createElement("span", null,
                    "Buque ",
                    React.createElement("strong", { className: "mono" }, ship.vessel),
                    " de ",
                    React.createElement("strong", null, ship.shipping_line),
                    ".") :
                    React.createElement("span", null, "A\u00FAn sin buque ni naviera. Empieza por la pesta\u00F1a de Log\u00EDstica."))),
            React.createElement("div", { className: "head-actions" },
                React.createElement("span", { className: "text-muted text-small" },
                    sst.pct,
                    "% completo"),
                React.createElement(Btn, { variant: "ghost", icon: "trash", className: "btn-danger-ghost" }, "Eliminar embarque"))),
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
        tab === 'packings' && React.createElement(TabPackings, { ship: ship, updateShip: updateShip, openPackingWizard: openPackingWizard, proforma: proforma }),
        tab === 'documents' && React.createElement(TabDocuments, { ship: ship, updateShip: updateShip })));
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
            React.createElement(Field, { label: "Buque + viaje", required: true, help: "Nombre del buque seguido del n\u00FAmero de viaje.", helpExample: "COSCO TAICANG / 042E" },
                React.createElement(Input, { mono: true, placeholder: "Ej. COSCO TAICANG / 042E", value: ship.vessel, onChange: (e) => updateShip({ vessel: e.target.value }) }))),
        React.createElement("div", { className: "fld-row cols-3", style: { marginTop: 16 } },
            React.createElement(Field, { label: "ETD", required: true, help: "Estimated Time of Departure \u2014 fecha estimada de salida del puerto origen." },
                React.createElement(Input, { type: "date", value: ship.etd, onChange: (e) => updateShip({ etd: e.target.value }) })),
            React.createElement(Field, { label: "ETA", required: true, help: "Estimated Time of Arrival \u2014 fecha estimada de llegada al puerto destino." },
                React.createElement(Input, { type: "date", value: ship.eta, onChange: (e) => updateShip({ eta: e.target.value }) })),
            React.createElement(Field, { label: "Estado actual", required: true },
                React.createElement(Select, { value: ship.status, onChange: (e) => updateShip({ status: e.target.value }) }, Object.entries(STATUS_LABEL).map(([k, v]) => React.createElement("option", { key: k, value: k }, v))))),
        React.createElement(Field, { label: "Observaciones", optional: true, className: "fld-full", hint: "Notas internas sobre el viaje.", style: { marginTop: 16 } },
            React.createElement(Textarea, { rows: 2, value: ship.notes, placeholder: "Ej. Cambio de buque por sobrecupo. Reasignado a TAICANG.", onChange: (e) => updateShip({ notes: e.target.value }) }))),
    React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Bill of Lading (B/L)"),
                React.createElement("p", { className: "sub" }, "El B/L es el documento que prueba que la naviera recibi\u00F3 tu mercanc\u00EDa. S\u00FAbelo en cuanto lo recibas \u2014 sin \u00E9l, aduanas no libera el embarque.")),
            React.createElement(Badge, { tone: ship.bl_number ? 'done' : 'todo' }, ship.bl_number ? React.createElement(React.Fragment, null,
                React.createElement(Icon, { name: "check", size: 11 }),
                " Cargado") : 'Pendiente')),
        React.createElement("div", { className: "fld-row cols-3" },
            React.createElement(Field, { label: "N\u00FAmero de B/L", required: true, help: "El n\u00FAmero \u00FAnico que asigna la naviera a tu embarque.", helpExample: "COSU6817042500" },
                React.createElement(Input, { mono: true, placeholder: "Ej. COSU6817042500", value: ship.bl_number, onChange: (e) => updateShip({ bl_number: e.target.value }) })),
            React.createElement(Field, { label: "Fecha de B/L", required: true, help: "Fecha que aparece impresa en el documento." },
                React.createElement(Input, { type: "date", value: ship.bl_date, onChange: (e) => updateShip({ bl_date: e.target.value }) })),
            React.createElement(Field, { label: "Archivo PDF", required: true, help: "Sube el PDF original. Aceptamos m\u00E1ximo 10 MB." }, ship.bl_file ? (React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' } },
                React.createElement(Icon, { name: "file", size: 14, style: { color: 'var(--accent)' } }),
                React.createElement("span", { className: "mono", style: { fontSize: 13 } }, ship.bl_file),
                React.createElement(Btn, { variant: "ghost", size: "sm", icon: "x", onClick: () => updateShip({ bl_file: '' }) }))) : (React.createElement(Btn, { variant: "secondary", icon: "upload" }, "Subir PDF")))))));
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
    return (React.createElement("div", null,
        React.createElement("div", { className: "card" },
            React.createElement("div", { className: "card-head" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Invoices (Facturas comerciales)"),
                    React.createElement("p", { className: "sub" }, "La factura comercial que emites para el embarque. Puede ser una global o varias parciales.")),
                React.createElement(Btn, { variant: "primary", icon: "plus", size: "sm", onClick: addInvoice }, "Agregar invoice")),
            ship.invoices.length === 0 ? (React.createElement(Empty, { icon: "invoice", title: "A\u00FAn no hay invoices", action: React.createElement(Btn, { variant: "accent", icon: "plus", onClick: addInvoice }, "Agregar primer invoice") }, "Crea al menos una factura comercial por cada embarque. Puedes asignarla a todo el embarque o solo a contenedores espec\u00EDficos.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
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
                        React.createElement(Field, { label: "Monto + moneda", required: true },
                            React.createElement("div", { style: { display: 'flex', gap: 8 } },
                                React.createElement(Input, { mono: true, style: { flex: 1 }, placeholder: "62400", value: inv.amount || '', onChange: (e) => updInv(inv.id, { amount: parseFloat(e.target.value || 0) }) }),
                                React.createElement(Select, { style: { width: 90 }, value: inv.currency, onChange: (e) => updInv(inv.id, { currency: e.target.value }) }, ['USD', 'EUR', 'CNY', 'MXN'].map(c => React.createElement("option", { key: c }, c))))))))),
                React.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-soft)' } },
                    React.createElement("span", { className: "text-muted text-small" }, "Total facturado en este embarque"),
                    React.createElement("strong", { className: "mono", style: { fontSize: 18 } },
                        ship.invoices.reduce((a, i) => a + (i.amount || 0), 0).toLocaleString(),
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
        ship.containers.length === 0 ? (React.createElement(Empty, { icon: "container", title: "Sin contenedores", action: React.createElement(Btn, { variant: "accent", icon: "plus", onClick: addC }, "Agregar primer contenedor") }, "Captura los n\u00FAmeros de contenedor en cuanto te los entregue tu agente. Los necesitas antes del packing list.")) : (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, ship.containers.map((c, i) => {
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
                    React.createElement(Field, { label: "Peso bruto (kg)", required: true },
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
const TabPackings = ({ ship, updateShip, openPackingWizard, proforma }) => {
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
            ship.packings.length === 0 ? (React.createElement(Empty, { icon: "box", title: "Sin packing lists todav\u00EDa", action: React.createElement(Btn, { variant: "accent", icon: "sparkles", onClick: () => openPackingWizard(ship.id, null) }, "Empezar con el asistente") },
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
                    React.createElement(Btn, { variant: "secondary", icon: "pencil", onClick: () => openPackingWizard(ship.id, pk.id) }, "Editar")));
            })))),
        React.createElement(Callout, { tone: "info", icon: "sparkles", title: "C\u00F3mo funciona el asistente" },
            "En lugar de que escribas mil l\u00EDneas a mano, el asistente ",
            React.createElement("strong", null, "genera las filas autom\u00E1ticamente"),
            " con base en los bloques que configures. T\u00FA solo agregas dimensiones y subes una foto por bloque.")));
};
/* ============================================================
   Documents tab (per shipment)
   ============================================================ */
const TabDocuments = ({ ship, updateShip }) => {
    const DOC_TYPES = [
        { kind: 'CO', label: 'Certificate of Origin', desc: 'Certifica el país donde se fabricó la mercancía. Lo emite la Cámara de Comercio local.' },
        { kind: 'PHYTO', label: 'Certificado fitosanitario', desc: 'Si la mercancía incluye empaque de madera, certifica que está fumigada (HT/MB).' },
        { kind: 'INSPEC', label: 'Reporte de inspección', desc: 'Reporte de inspección de calidad pre-embarque (SGS, Bureau Veritas, etc).' },
        { kind: 'OTHER', label: 'Otros documentos', desc: 'Cualquier otro documento relevante para aduanas.' },
    ];
    return (React.createElement("div", { className: "card" },
        React.createElement("div", { className: "card-head" },
            React.createElement("div", null,
                React.createElement("h2", null, "Documentos del embarque"),
                React.createElement("p", { className: "sub" }, "Sube los documentos legales y de calidad que acompa\u00F1an este embarque."))),
        React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 18 } }, DOC_TYPES.map(dt => {
            const doc = ship.documents.find(d => d.kind === dt.kind);
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
                        : React.createElement(Badge, { tone: "todo" }, "Pendiente")),
                doc ? (React.createElement("div", { className: "doc-row", style: { padding: '8px 10px' } },
                    React.createElement("div", { className: "doc-icon", style: { width: 28, height: 28 } },
                        React.createElement(Icon, { name: "file", size: 14 })),
                    React.createElement("div", { className: "doc-meta" },
                        React.createElement("div", { className: "name", style: { fontSize: 12.5 } }, doc.name),
                        React.createElement("div", { className: "meta" },
                            (doc.size / 1024).toFixed(0),
                            " KB \u00B7 ",
                            doc.uploaded)),
                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "eye" }),
                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost" }))) : (React.createElement(Btn, { variant: "secondary", icon: "upload", size: "sm" }, "Subir PDF"))));
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
const PackingWizard = ({ proforma, shipmentId, packingId, onClose, onSave, sampleRows }) => {
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
        number: 'PK-' + new Date().getFullYear() + '-' + Math.floor(Math.random() * 900 + 100),
        date: new Date().toISOString().slice(0, 10),
        products: [],
        blocks: [],
    });
    // rows for spreadsheet (only used in step 4)
    const [rows, setRows] = React.useState(() => existing && existing.id === 'pk1' ? [...sampleRows] : []);
    // generate empty rows from blocks if rows is empty when entering step 4
    React.useEffect(() => {
        if (step === 4 && rows.length === 0 && draft.blocks.length > 0) {
            const generated = [];
            draft.blocks.forEach((b, bi) => {
                for (let i = 0; i < b.count; i++) {
                    generated.push({
                        id: `r-${b.id}-${i}`,
                        block: b.name, atado: `A-${String(bi + 1).padStart(2, '0')}`,
                        plate: `P-${String(generated.length + 1).padStart(3, '0')}`,
                        ref: '', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: [],
                        blockStart: i === 0,
                    });
                }
            });
            setRows(generated);
        }
    }, [step]);
    const canNext = () => {
        if (step === 1)
            return draft.products.length > 0;
        if (step === 2)
            return draft.blocks.length > 0 && draft.blocks.every(b => b.name && b.count > 0);
        return true;
    };
    return (React.createElement("div", { className: "modal-scrim", onClick: (e) => e.target === e.currentTarget && onClose() },
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
                React.createElement("button", { className: "icon-btn", onClick: onClose, "aria-label": "Cerrar" },
                    React.createElement(Icon, { name: "x", size: 16 }))),
            React.createElement("div", { className: "modal-body", style: { background: step === 4 ? 'var(--bg)' : 'var(--surface)' } },
                React.createElement("div", { className: "stepper" }, WIZARD_STEPS.map((s, i) => (React.createElement(React.Fragment, { key: s.id },
                    React.createElement("div", { className: `step ${step === s.id ? 'active' : step > s.id ? 'done' : ''}` },
                        React.createElement("span", { className: "n" }, step > s.id ? React.createElement(Icon, { name: "check", size: 12 }) : s.id),
                        React.createElement("span", null, s.label)),
                    i < WIZARD_STEPS.length - 1 && React.createElement("span", { className: "step-sep" }))))),
                step === 1 && React.createElement(Step1Products, { proforma: proforma, draft: draft, setDraft: setDraft }),
                step === 2 && React.createElement(Step2Blocks, { proforma: proforma, draft: draft, setDraft: setDraft }),
                step === 3 && React.createElement(Step3Review, { proforma: proforma, draft: draft }),
                step === 4 && React.createElement(Step4Sheet, { proforma: proforma, draft: draft, rows: rows, setRows: setRows, ship: ship })),
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
                    step === 4 && (React.createElement(Btn, { variant: "primary", icon: "check", onClick: onClose }, "Listo, volver al embarque")))))));
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
                React.createElement(Input, { mono: true, value: draft.number, onChange: (e) => setDraft({ ...draft, number: e.target.value }) })),
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
const Step2Blocks = ({ proforma, draft, setDraft }) => {
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
    return (React.createElement("div", null,
        React.createElement(Callout, { tone: "info", icon: "info", title: "\u00BFQu\u00E9 es un bloque?" }, "Un bloque es la piedra original de cantera, antes de cortarse. De cada bloque salen varias placas. Si tienes 3 bloques con 18, 16 y 14 placas, este paso generar\u00E1 autom\u00E1ticamente 48 filas para llenar."),
        React.createElement("div", { style: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 24 } }, products.map(p => {
            const productBlocks = draft.blocks.filter(b => b.product === p.id);
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
                productBlocks.length === 0 ? (React.createElement(Empty, { icon: "cube", title: "Sin bloques a\u00FAn", action: React.createElement(Btn, { variant: "accent", size: "sm", icon: "plus", onClick: () => addBlock(p.id) }, "Crear primer bloque") }, "Empieza con uno. Puedes agregar tantos como necesites.")) : (React.createElement("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 } }, productBlocks.map((b, bi) => (React.createElement("div", { key: b.id, className: "block-card" },
                    React.createElement("div", { className: `block-photo ${b.photo ? 'has-photo' : ''}`, onClick: () => updBlock(b.id, { photo: !b.photo }) }, b.photo ? (React.createElement(Imgph, { style: { width: '100%', height: '100%', borderRadius: 8 } }, "foto bloque")) : (React.createElement("div", { style: { textAlign: 'center' } },
                        React.createElement(Icon, { name: "camera", size: 20 }),
                        React.createElement("div", { style: { fontSize: 10, marginTop: 4, fontWeight: 600 } }, "Subir foto")))),
                    React.createElement("div", { className: "block-fields" },
                        React.createElement(Field, { label: `Nombre del bloque #${bi + 1}`, required: true },
                            React.createElement(Input, { mono: true, placeholder: "Ej. B-2024-117", value: b.name, onChange: (e) => updBlock(b.id, { name: e.target.value }) })),
                        React.createElement("div", { className: "block-fields-row" },
                            React.createElement(Field, { label: "Placas / piezas", required: true },
                                React.createElement(Input, { mono: true, type: "number", min: 1, value: b.count || '', placeholder: "18", onChange: (e) => updBlock(b.id, { count: +e.target.value }) })),
                            React.createElement(Field, { label: "Estado" },
                                React.createElement("div", { style: { display: 'flex', gap: 6, alignItems: 'center', padding: '8px 0' } },
                                    b.photo
                                        ? React.createElement(Badge, { tone: "done" },
                                            React.createElement(Icon, { name: "check", size: 10 }),
                                            " Foto OK")
                                        : React.createElement(Badge, { tone: "partial" },
                                            React.createElement(Icon, { name: "camera", size: 10 }),
                                            " Falta foto"),
                                    React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost", onClick: () => delBlock(b.id) }))))))))))));
        }))));
};
/* ====================== Step 3 ====================== */
const Step3Review = ({ proforma, draft }) => {
    const totalPlates = draft.blocks.reduce((a, b) => a + (+b.count || 0), 0);
    const photosMissing = draft.blocks.filter(b => !b.photo).length;
    const products = proforma.products.filter(p => draft.products.includes(p.id));
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
                            background: b.photo ? 'var(--ok-soft)' : 'var(--warn-soft)',
                            border: `1px solid ${b.photo ? 'var(--ok-border)' : 'var(--warn-border)'}`,
                            fontSize: 12.5,
                        } },
                        React.createElement(Icon, { name: b.photo ? 'check' : 'camera', size: 11 }),
                        React.createElement("span", { className: "mono", style: { fontWeight: 600 } }, b.name),
                        React.createElement("span", { className: "text-muted", style: { fontSize: 11 } },
                            "\u00D7 ",
                            b.count)))))));
            })))));
};
/* ====================== Step 4: Spreadsheet ====================== */
const Step4Sheet = ({ proforma, draft, rows, setRows, ship }) => {
    const [filter, setFilter] = React.useState('all');
    const [activeRow, setActiveRow] = React.useState(null);
    const errors = rows.filter(r => r.errors && r.errors.length > 0);
    const completeRows = rows.filter(r => r.h > 0 && r.w > 0 && r.container);
    const filtered = filter === 'all' ? rows : filter === 'errors' ? errors : filter === 'empty' ? rows.filter(r => !r.h || !r.w) : rows;
    const updRow = (id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
    // PROPAGATION — copy the value of `field` from `sourceId` either to the next row
    // in the same block, or to every row below it inside the same block.
    const propagate = (sourceId, field, mode) => {
        const idx = rows.findIndex(r => r.id === sourceId);
        if (idx < 0)
            return;
        const src = rows[idx];
        const block = src.block;
        if (mode === 'next') {
            for (let i = idx + 1; i < rows.length; i++) {
                if (rows[i].block === block) {
                    const targetId = rows[i].id;
                    setRows(prev => prev.map(r => r.id === targetId ? { ...r, [field]: src[field] } : r));
                    return;
                }
            }
        }
        else {
            const targetIds = new Set();
            for (let i = idx + 1; i < rows.length; i++) {
                if (rows[i].block === block)
                    targetIds.add(rows[i].id);
            }
            setRows(prev => prev.map(r => targetIds.has(r.id) ? { ...r, [field]: src[field] } : r));
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
    const PropCell = ({ rowId, field, children, extra, errClass }) => {
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
                React.createElement(Btn, { variant: "secondary", icon: "download", size: "sm" }, "Exportar CSV"),
                React.createElement(Btn, { variant: "secondary", icon: "upload", size: "sm" }, "Pegar de Excel"))),
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
                            React.createElement("th", { style: { width: 110 } }, "Alto m"),
                            React.createElement("th", { style: { width: 110 } }, "Ancho m"),
                            React.createElement("th", { style: { width: 80 } }, "\u00C1rea m\u00B2"),
                            React.createElement("th", { style: { minWidth: 180 } }, "Contenedor"),
                            React.createElement("th", { style: { width: 60 } }, "Foto"),
                            React.createElement("th", { style: { minWidth: 170 } }, "Notas"))),
                    React.createElement("tbody", null, filtered.map((r, i) => {
                        const area = (r.h && r.w) ? (r.h * r.w).toFixed(2) : '';
                        const noH = !r.h;
                        const noW = !r.w;
                        const noC = !r.container;
                        const isBlockStart = i === 0 || filtered[i - 1].block !== r.block;
                        return (React.createElement("tr", { key: r.id, className: `${isBlockStart ? 'block-start' : ''} ${activeRow === r.id ? 'is-active' : ''}`, onClick: () => setActiveRow(r.id) },
                            React.createElement("td", { style: { textAlign: 'center', color: 'var(--ink-4)', fontSize: 11 } }, rows.indexOf(r) + 1),
                            React.createElement("td", { className: "cell-block" },
                                React.createElement("input", { value: r.block, onChange: (e) => updRow(r.id, { block: e.target.value }) })),
                            React.createElement(PropCell, { rowId: r.id, field: "atado" },
                                React.createElement("input", { value: r.atado, onChange: (e) => updRow(r.id, { atado: e.target.value }) })),
                            React.createElement(PropCell, { rowId: r.id, field: "plate" },
                                React.createElement("input", { value: r.plate, onChange: (e) => updRow(r.id, { plate: e.target.value }) })),
                            React.createElement(PropCell, { rowId: r.id, field: "thickness" },
                                React.createElement("input", { type: "number", step: "0.1", value: r.thickness, onChange: (e) => updRow(r.id, { thickness: +e.target.value }) })),
                            React.createElement(PropCell, { rowId: r.id, field: "h", errClass: noH ? 'is-error' : '' },
                                React.createElement("input", { type: "number", step: "0.01", value: r.h || '', placeholder: "0.00", onChange: (e) => updRow(r.id, { h: +e.target.value }) })),
                            React.createElement(PropCell, { rowId: r.id, field: "w", errClass: noW ? 'is-error' : '' },
                                React.createElement("input", { type: "number", step: "0.01", value: r.w || '', placeholder: "0.00", onChange: (e) => updRow(r.id, { w: +e.target.value }) })),
                            React.createElement("td", { className: "cell-computed" },
                                React.createElement("input", { readOnly: true, value: area })),
                            React.createElement(PropCell, { rowId: r.id, field: "container", errClass: noC ? 'is-error' : '' },
                                React.createElement("select", { value: r.container, onChange: (e) => updRow(r.id, { container: e.target.value }) },
                                    React.createElement("option", { value: "" }, "\u2014 sin asignar \u2014"),
                                    containers.map(c => React.createElement("option", { key: c, value: c }, c)))),
                            React.createElement("td", { style: { textAlign: 'center' } },
                                React.createElement("div", { className: `row-mini-photo ${r.photo ? 'has' : ''}`, onClick: (e) => { e.stopPropagation(); updRow(r.id, { photo: !r.photo }); } },
                                    React.createElement(Icon, { name: r.photo ? 'check' : 'camera', size: 12 }))),
                            React.createElement(PropCell, { rowId: r.id, field: "notes" },
                                React.createElement("input", { placeholder: "\u2014", value: r.notes, onChange: (e) => updRow(r.id, { notes: e.target.value }) }))));
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
            " entre celdas.")));
};
window.PackingWizard = PackingWizard;
// ===== src/views/documents.jsx =====
/* global React, Icon, Btn, Badge, Callout, Empty */
const Documents = ({ proforma, setProforma, setRoute }) => {
    const [drag, setDrag] = React.useState(false);
    const CATEGORIES = [
        { id: 'proforma', icon: 'file', title: 'Proforma Invoice (PI)', desc: 'La cotización que enviaste a SOM GROUP firmada.', required: true, files: [
                { name: 'PI-9920-A-signed.pdf', size: 412000, uploaded: '2026-05-15' },
            ] },
        { id: 'contract', icon: 'doc_lines', title: 'Contrato comercial', desc: 'Contrato marco si aplica.', required: false, files: [] },
        { id: 'quality', icon: 'sparkles', title: 'Certificados de calidad', desc: 'Mineralogía, densidad, absorción, etc.', required: true, files: [
                { name: 'Mineralogy-CG.pdf', size: 188000, uploaded: '2026-05-22' },
                { name: 'Density-test.pdf', size: 92000, uploaded: '2026-05-22' },
            ] },
        { id: 'photos', icon: 'image', title: 'Fotografías del producto', desc: 'Catálogo o muestras a granel del proveedor.', required: false, files: [] },
        { id: 'other', icon: 'box', title: 'Otros documentos', desc: 'Cualquier otro adjunto general.', required: false, files: [] },
    ];
    return (React.createElement("div", null,
        React.createElement("div", { className: "crumb" },
            React.createElement("a", { onClick: () => setRoute({ section: 'overview' }) }, "Vista general"),
            React.createElement(Icon, { name: "chevron_right", size: 10 }),
            "Documentos"),
        React.createElement("div", { className: "page-head" },
            React.createElement("div", { className: "text" },
                React.createElement("h1", null, "Documentos generales"),
                React.createElement("p", { className: "lead" }, "Documentos que aplican a toda la Proforma (no a un embarque espec\u00EDfico). Los documentos por embarque est\u00E1n dentro de cada embarque."))),
        React.createElement("div", { className: `dropzone ${drag ? 'is-drag' : ''}`, onDragEnter: (e) => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDragOver: (e) => e.preventDefault(), onDrop: (e) => { e.preventDefault(); setDrag(false); } },
            React.createElement("div", { className: "dz-icon" },
                React.createElement(Icon, { name: "upload", size: 28 })),
            React.createElement("h4", null, "Arrastra tus archivos aqu\u00ED"),
            React.createElement("p", null,
                "PDF, JPG, PNG \u00B7 m\u00E1ximo 10 MB por archivo \u00B7 o ",
                React.createElement("a", { href: "#", onClick: (e) => e.preventDefault(), style: { color: 'var(--accent)', fontWeight: 600 } }, "elige desde tu computadora"))),
        React.createElement("div", { style: { marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 } }, CATEGORIES.map(cat => (React.createElement("div", { key: cat.id, className: "card", style: { padding: 16 } },
            React.createElement("div", { style: { display: 'flex', alignItems: 'flex-start', gap: 14 } },
                React.createElement("div", { style: { width: 40, height: 40, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)',
                        display: 'grid', placeItems: 'center', flexShrink: 0 } },
                    React.createElement(Icon, { name: cat.icon, size: 16 })),
                React.createElement("div", { style: { flex: 1 } },
                    React.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                        React.createElement("strong", null, cat.title),
                        cat.required && React.createElement(Badge, { tone: cat.files.length > 0 ? 'done' : 'todo' }, cat.files.length > 0 ? React.createElement(React.Fragment, null,
                            React.createElement(Icon, { name: "check", size: 10 }),
                            " ",
                            cat.files.length) : 'Obligatorio'),
                        !cat.required && React.createElement(Badge, { tone: "draft" }, "Opcional")),
                    React.createElement("div", { className: "text-muted", style: { fontSize: 12.5, marginBottom: cat.files.length > 0 ? 12 : 0 } }, cat.desc),
                    cat.files.length > 0 && (React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, cat.files.map((f, i) => (React.createElement("div", { key: i, className: "doc-row" },
                        React.createElement("div", { className: "doc-icon" },
                            React.createElement(Icon, { name: "file", size: 15 })),
                        React.createElement("div", { className: "doc-meta" },
                            React.createElement("div", { className: "name" }, f.name),
                            React.createElement("div", { className: "meta" },
                                (f.size / 1024).toFixed(0),
                                " KB \u00B7 subido ",
                                f.uploaded)),
                        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "download" }),
                        React.createElement(Btn, { variant: "ghost", size: "sm", icon: "trash", className: "btn-danger-ghost" }))))))),
                React.createElement(Btn, { variant: "secondary", size: "sm", icon: "upload" }, "Subir"))))))));
};
window.Documents = Documents;
// ===== src/views/confirm.jsx =====
/* global React, Icon, Btn, Badge, Callout, ProgressRing */
const Confirm = ({ proforma, status, setRoute }) => {
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
                React.createElement(StatCard, { label: "Incoterm", value: proforma.globals.incoterm || '—' }),
                React.createElement(StatCard, { label: "Origen \u2192 Destino", value: `${proforma.globals.port_origin || '?'} → ${proforma.globals.port_destination || '?'}` }),
                React.createElement(StatCard, { label: "Embarques", value: proforma.shipments.length }),
                React.createElement(StatCard, { label: "Total invoices", value: `${proforma.shipments.reduce((a, s) => a + s.invoices.reduce((b, i) => b + (i.amount || 0), 0), 0).toLocaleString()} USD`, mono: true }))),
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
                React.createElement(Btn, { variant: "accent", size: "lg", icon: "flag", disabled: !allDone }, allDone ? 'Marcar como completa' : 'Faltan datos requeridos')))));
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
// ===== src/guide_panel.jsx =====
/* global React, Icon, Btn, Imgph */
// Contextual right-side guidance panel — changes based on current route
const GUIDE_CONTENT = {
    overview: {
        label: 'Guía',
        title: 'Tu llenado en 4 etapas',
        sub: 'Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.',
        steps: [
            { num: 1, title: 'Datos generales', body: 'Una sola vez al inicio. Identificación de la Proforma, puertos e incoterm.' },
            { num: 2, title: 'Embarques', body: 'Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing.' },
            { num: 3, title: 'Documentos', body: 'Sube certificados de calidad y otros papeles generales.' },
            { num: 4, title: 'Revisar y enviar', body: 'Última verificación y notificación a SOM GROUP.' },
        ],
    },
    globals: {
        label: 'Guía',
        title: 'Datos de la Proforma',
        sub: 'Esta sección define identidad y ruta. Si no sabes algo, pregunta a tu agente o déjalo vacío y vuelve después.',
        steps: [
            { num: 1, title: 'Número de Proforma', body: 'Es el ID que tu sistema usa. Suele comenzar con "PI-".' },
            { num: 2, title: 'Origen y destino', body: 'País y puerto de salida + puerto donde llegará.' },
            { num: 3, title: 'Incoterm', body: 'Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP.' },
            { num: 4, title: 'Pagos y notas', body: 'Términos de pago y observaciones generales.' },
        ],
        illustration: 'mapa de ruta',
    },
    shipments: {
        label: 'Guía',
        title: 'Embarques',
        sub: 'Un embarque = un viaje. Puedes dividir la PO en varios embarques si la producción sale en fechas distintas.',
        steps: [
            { num: 1, title: 'Agrega un embarque', body: 'Hazlo en cuanto tengas el buque o vuelo asignado.' },
            { num: 2, title: 'Llena las 5 secciones', body: 'Logística, B/L, invoices, contenedores y packing list.' },
            { num: 3, title: 'Sube documentos', body: 'Certificado de origen, fitosanitario, etc.' },
        ],
    },
    shipment: {
        label: 'Guía del embarque',
        title: 'Captura por pestañas',
        sub: 'Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado — déjalo para el final.',
        steps: [
            { num: 1, title: 'Logística + B/L', body: 'Naviera, buque, fechas y el documento B/L.' },
            { num: 2, title: 'Invoices', body: 'Factura(s) comercial(es). Puede ser una global o varias parciales.' },
            { num: 3, title: 'Contenedores', body: 'Los números físicos pintados en cada contenedor.' },
            { num: 4, title: 'Packing list', body: 'Asistente paso a paso. Captura placa por placa.' },
            { num: 5, title: 'Documentos', body: 'CO, fitosanitario, inspección.' },
        ],
    },
    documents: {
        label: 'Guía',
        title: 'Documentos generales',
        sub: 'Documentos que aplican a toda la Proforma. Acepta PDF, JPG, PNG hasta 10 MB.',
        steps: [
            { num: 1, title: 'Proforma firmada', body: 'La que enviaste a SOM GROUP con firma.' },
            { num: 2, title: 'Certificados de calidad', body: 'Pruebas técnicas: mineralogía, densidad, absorción.' },
            { num: 3, title: 'Fotos del producto', body: 'Catálogo o muestras a granel.' },
        ],
    },
    review: {
        label: 'Antes de enviar',
        title: 'Verifica todo',
        sub: 'Una vez marcada como completa, SOM GROUP recibe una notificación. Si después necesitas editar, pídeselo a tu contacto.',
        steps: [
            { num: 1, title: 'Resumen general', body: 'Datos clave que se enviarán.' },
            { num: 2, title: 'Checklist por sección', body: 'Si algo está en ámbar, vuelve a esa sección.' },
            { num: 3, title: 'Marcar como completa', body: 'Solo se habilita cuando todo está en verde.' },
        ],
    },
};
const GuidePanel = ({ route, onClose }) => {
    const key = route.section === 'shipment' ? 'shipment' : route.section;
    const content = GUIDE_CONTENT[key] || GUIDE_CONTENT.overview;
    return (React.createElement("aside", { className: "guide" },
        React.createElement("div", { className: "guide-head" },
            React.createElement("span", { className: "label" }, content.label),
            React.createElement("button", { className: "icon-btn", onClick: onClose, "aria-label": "Ocultar gu\u00EDa" },
                React.createElement(Icon, { name: "x", size: 14 }))),
        React.createElement("div", null,
            React.createElement("h3", null, content.title),
            React.createElement("p", { className: "sub" }, content.sub)),
        React.createElement("div", { className: "guide-illustration" },
            React.createElement("img", { src: "/stock_lot_packing_import/static/src/img/ilusttraci%C3%B3n.png", alt: content.illustration || 'ilustración guía', style: { width: '100%', height: '100%', objectFit: 'contain' } })),
        React.createElement("div", { className: "guide-steps" }, content.steps.map((s, i) => (React.createElement("div", { key: s.num, className: `guide-step ${i === 0 ? 'active' : ''}` },
            React.createElement("span", { className: "num" }, s.num),
            React.createElement("div", { className: "body" },
                React.createElement("strong", null, s.title),
                s.body))))),
        React.createElement("div", { style: { marginTop: 'auto' } })));
};
window.GuidePanel = GuidePanel;
// ===== src/app.jsx =====
/* global React, ReactDOM, Icon, Btn, Badge,
   MOCK_PROFORMA, SAMPLE_ROWS, computeStatus, LangCtx, I18N,
   Sidebar, Overview, Globals, ShipmentsList, ShipmentDetail,
   PackingWizard, Documents, Confirm, Onboarding, GuidePanel,
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
function App() {
    const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const t = tweaks;
    // simulate a completed proforma if requested
    const [proforma, setProforma] = React.useState(() => {
        if (t.show_completed_route)
            return completedProforma();
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
    const tFn = (k) => (I18N[lang] && I18N[lang][k]) || (I18N.es[k]) || k;
    const openPackingWizard = (shipmentId, packingId) => setPackingWiz({ shipmentId, packingId });
    const closePackingWizard = () => setPackingWiz(null);
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
                    React.createElement("div", { className: "lang-pill", role: "tablist", "aria-label": "Idioma" }, ['es', 'en', 'zh'].map(l => (React.createElement("button", { key: l, className: lang === l ? 'active' : '', onClick: () => setTweak({ lang: l }) }, l === 'zh' ? '中' : l.toUpperCase())))),
                    React.createElement("button", { className: `guide-toggle ${guideOpen ? 'is-active' : ''}`, onClick: () => setGuideOpen(!guideOpen), title: guideOpen ? tFn('hide_guide') : tFn('show_guide') },
                        React.createElement(Icon, { name: "sparkles", size: 14 }),
                        React.createElement("span", null, guideOpen ? 'Ocultar guía' : 'Mostrar guía')),
                    React.createElement("button", { className: "guide-toggle", onClick: () => setShowOnboard(true), title: "Tutorial inicial" },
                        React.createElement(Icon, { name: "play", size: 12 }),
                        React.createElement("span", null, "Tutorial")),
                    React.createElement("div", { className: "user-avatar", title: "ZW" }, "ZW"))),
            React.createElement("div", { className: `app-body ${!guideOpen ? 'guide-collapsed' : ''}` },
                React.createElement(Sidebar, { proforma: proforma, route: route, setRoute: setRoute, status: status, mobileOpen: mobileNav }),
                React.createElement("main", { className: "main" },
                    route.section === 'overview' && React.createElement(Overview, { proforma: proforma, status: status, setRoute: setRoute }),
                    route.section === 'globals' && React.createElement(Globals, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute, validationStyle: t.validation_style }),
                    route.section === 'shipments' && React.createElement(ShipmentsList, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute }),
                    route.section === 'shipment' && React.createElement(ShipmentDetail, { proforma: proforma, setProforma: setProforma, status: status, setRoute: setRoute, route: route, openPackingWizard: openPackingWizard }),
                    route.section === 'documents' && React.createElement(Documents, { proforma: proforma, setProforma: setProforma, setRoute: setRoute }),
                    route.section === 'review' && React.createElement(Confirm, { proforma: proforma, status: status, setRoute: setRoute })),
                guideOpen && React.createElement(GuidePanel, { route: route, onClose: () => setGuideOpen(false) })),
            packingWiz && (React.createElement(PackingWizard, { proforma: proforma, shipmentId: packingWiz.shipmentId, packingId: packingWiz.packingId, sampleRows: SAMPLE_ROWS, onClose: closePackingWizard, onSave: () => { } })),
            showOnboard && React.createElement(Onboarding, { onClose: () => setShowOnboard(false) }),
            React.createElement(TweaksPanel, { title: "Tweaks" },
                React.createElement(TweakSection, { label: "Idioma & branding" },
                    React.createElement(TweakRadio, { label: "Idioma", value: t.lang, onChange: (v) => setTweak({ lang: v }), options: [{ value: 'es', label: 'ES' }, { value: 'en', label: 'EN' }, { value: 'zh', label: '中' }] }),
                    React.createElement(TweakColor, { label: "Acento", value: t.accent, options: ACCENT_OPTIONS, onChange: (v) => setTweak({ accent: v }) }),
                    React.createElement(TweakRadio, { label: "Densidad", value: t.density, onChange: (v) => setTweak({ density: v }), options: [{ value: 'comfortable', label: 'Cómoda' }, { value: 'compact', label: 'Compacta' }] })),
                React.createElement(TweakSection, { label: "Gu\u00EDa y onboarding" },
                    React.createElement(TweakToggle, { label: "Panel gu\u00EDa a la derecha", value: t.show_guide_panel, onChange: (v) => setTweak({ show_guide_panel: v }) }),
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
const __supplierPortalRoot = document.getElementById('root');
if (__supplierPortalRoot) {
    ReactDOM.createRoot(__supplierPortalRoot).render(React.createElement(App, null));
}

})();
//# sourceURL=portal_react_exact.bundle.js
