// modern_portal.js
// PORTAL-REDESIGN-002:
// Nueva app frontend para el portal de proveedores.
// Mantiene el backend y los endpoints JSON-RPC existentes del módulo.

(function () {
    "use strict";

    const M = window.SupplierPortalModules = window.SupplierPortalModules || { constants: {}, utils: {}, mixins: {} };
    const U = M.utils || {};

    const jsonRpc = U.jsonRpc || (async function (url, params) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: params || {}, id: Date.now() }),
        });
        const payload = await response.json();
        if (payload.error) {
            throw new Error(payload.error.data?.message || payload.error.message || "RPC Error");
        }
        return payload.result;
    });

    const esc = U.esc || function (value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    const asInt = U.asInt || function (value) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : 0;
    };

    const readFileAsBase64 = U.readFileAsBase64 || function (file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function () {
                const raw = String(reader.result || "");
                resolve({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: raw.includes(",") ? raw.split(",")[1] : raw,
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const STATUS_LABEL = {
        draft: "Borrador",
        in_production: "En producción",
        booked: "Reservado",
        departed: "Despachado",
        in_transit: "En tránsito",
        arrived: "Llegó",
        delivered: "Entregado",
        complete: "Completo",
    };

    const STATUS_TONE = {
        draft: "draft",
        in_production: "partial",
        booked: "accent",
        departed: "accent",
        in_transit: "accent",
        arrived: "done",
        delivered: "done",
        complete: "done",
    };

    const DOC_TYPES_REQUIRED = [
        { key: "bl", label: "Bill of Lading (B/L)", required: true, accept: ".pdf" },
        { key: "invoice", label: "Invoice / Factura", required: true, accept: ".pdf" },
        { key: "packing_list", label: "Packing List", required: true, accept: ".pdf,.xlsx,.xls,.csv" },
    ];

    const DOC_TYPES_EXTRA = [
        { key: "eur1", label: "EUR1", required: false, accept: ".pdf" },
        { key: "certificate_origin", label: "Certificado de Origen", required: false, accept: ".pdf" },
        { key: "fumigation", label: "Comprobante de Fumigación", required: false, accept: ".pdf" },
    ];

    const SHIP_TABS = [
        { id: "logistics", label: "Logística + B/L", icon: "fa-ship" },
        { id: "invoices", label: "Invoices", icon: "fa-file-text-o" },
        { id: "containers", label: "Contenedores", icon: "fa-cubes" },
        { id: "packings", label: "Packing List", icon: "fa-list-alt" },
        { id: "documents", label: "Documentos", icon: "fa-file-pdf-o" },
    ];

    const GUIDE_CONTENT = {
        overview: {
            label: "Guía",
            title: "Tu llenado en 4 etapas",
            sub: "Te recomendamos seguir este orden. Si necesitas saltar a otra sección, también puedes.",
            illustration: "ilustración guía",
            steps: [
                ["Datos generales", "Una sola vez al inicio. Identificación de la Proforma, país, incoterm y pagos."],
                ["Embarques", "Crea uno o varios. Cada uno con logística, B/L, invoices, contenedores y packing."],
                ["Documentos", "Sube documentos obligatorios y de soporte por embarque."],
                ["Revisar y enviar", "Última verificación y notificación a SOM GROUP."],
            ],
        },
        globals: {
            label: "Guía",
            title: "Datos de la Proforma",
            sub: "Esta sección define identidad, pago e información general. Si no sabes algo, puedes volver después.",
            illustration: "mapa de ruta",
            steps: [
                ["Número de Proforma", "Es el ID que tu sistema usa. Suele comenzar con PI-."],
                ["País de origen", "País desde donde sale la mercancía."],
                ["Incoterm", "Define quién paga qué. Lo acordaste con tu contacto de SOM GROUP."],
                ["Pagos y notas", "Términos de pago y observaciones generales."],
            ],
        },
        shipments: {
            label: "Guía",
            title: "Embarques",
            sub: "Un embarque = un viaje. Puedes dividir la OC si la producción sale en fechas distintas.",
            illustration: "embarques",
            steps: [
                ["Agrega un embarque", "Hazlo en cuanto tengas el buque, vuelo o camión asignado."],
                ["Llena las 5 secciones", "Logística, B/L, invoices, contenedores y packing list."],
                ["Sube documentos", "B/L, invoice, packing list y documentos de soporte."],
            ],
        },
        shipment: {
            label: "Guía del embarque",
            title: "Captura por pestañas",
            sub: "Sigue las pestañas de izquierda a derecha. El packing list es lo más detallado.",
            illustration: "captura por pestañas",
            steps: [
                ["Logística + B/L", "Naviera, buque, fechas y número de B/L."],
                ["Invoices", "Factura(s) comercial(es). Puede ser una global o varias parciales."],
                ["Contenedores", "Los números físicos pintados en cada contenedor."],
                ["Packing list", "Asistente paso a paso. Captura placa por placa."],
                ["Documentos", "B/L, invoice, packing list, CO, fumigación, etc."],
            ],
        },
        documents: {
            label: "Guía",
            title: "Documentos",
            sub: "Los documentos se gestionan por embarque para conservar trazabilidad VUCEM.",
            illustration: "documentos",
            steps: [
                ["B/L", "Obligatorio por embarque."],
                ["Invoice", "Obligatorio por embarque."],
                ["Packing List", "Obligatorio por embarque."],
                ["Soporte", "EUR1, certificado de origen, fumigación u otros."],
            ],
        },
        review: {
            label: "Antes de enviar",
            title: "Verifica todo",
            sub: "Al marcar como completa, SOM GROUP recibe una notificación.",
            illustration: "checklist final",
            steps: [
                ["Resumen general", "Datos clave que se enviarán."],
                ["Checklist por sección", "Si algo está en ámbar, vuelve a esa sección."],
                ["Marcar como completa", "Solo debería usarse cuando el expediente esté listo."],
            ],
        },
    };

    const I18N = {
        es: {
            msg_saved: "Cambios guardados",
            msg_saving: "Guardando…",
            msg_error: "Error: ",
            msg_confirm_complete: "¿Marcar esta Proforma como completa?",
            msg_confirm_delete: "¿Eliminar este registro?",
            msg_confirm_delete_photo: "¿Eliminar la fotografía?",
            msg_photo_too_large: "La fotografía excede 5 MB.",
            msg_photo_invalid: "El archivo debe ser una imagen.",
            msg_photo_save_first: "Guarda primero la fila para subir fotografía.",
            btn_cancel: "Cancelar",
            setup_modal_title: "Configurar packing",
            setup_modal_subtitle: "Define bloques, cantidad de placas/piezas y fotografía por bloque antes de capturar.",
            setup_count_label_slabs: "Placas dentro del bloque",
            setup_count_label_units: "Piezas dentro del bloque",
            setup_blocks_qty: "¿Cuántos bloques se cargarán?",
            setup_photo_ok: "Foto cargada",
            setup_photo_missing: "Foto pendiente",
            setup_upload_photo: "Subir foto",
            setup_apply: "Generar filas",
            setup_empty_title: "Configura primero la estructura del packing",
            setup_empty_desc: "Antes de capturar filas, indica por producto cuántos bloques se cargarán, cuántas placas/piezas tendrá cada bloque y sube la fotografía correspondiente.",
            setup_open_wizard: "Configurar packing",
            setup_rows_generated: "filas generadas",
            setup_blocks_label_short: "bloques",
            setup_rows_label_short: "filas",
            setup_block_label: "Bloque",
            setup_block_name_placeholder: "Ej. B-01",
            setup_select_product_error: "Selecciona al menos un producto para este packing.",
            setup_blocks_required_error: "debes indicar al menos un bloque.",
            setup_block_name_required: "falta el nombre del bloque.",
            setup_block_count_required: "la cantidad debe ser mayor a cero.",
            setup_block_photo_required: "debes subir una foto del bloque.",
            setup_no_rows_error: "La configuración no genera filas.",
            col_photo: "Foto",
            col_container_assign: "Contenedor",
            col_block: "Bloque",
            col_atado: "Atado",
            col_plate_num: "Placa",
            col_thickness: "Grosor",
            col_height: "Alto",
            col_width: "Ancho",
            col_area: "Área",
            col_qty: "Cantidad",
            col_weight: "Peso",
            lbl_packages: "Paquetes",
            lbl_desc_goods: "Descripción",
            lbl_type_placa: "Placa",
            lbl_type_formato: "Formato",
            lbl_type_pieza: "Pieza",
            requested: "Solicitado",
            opt_select: "Selecciona…",
            btn_add_row: "Agregar fila",
            btn_add_5: "Agregar 5",
            btn_add_10: "Agregar 10",
        },
        en: {},
        zh: {},
    };

    function icon(name) {
        const map = {
            home: "fa-home",
            globe: "fa-globe",
            ship: "fa-ship",
            file: "fa-file-text-o",
            flag: "fa-flag",
            check: "fa-check",
            plus: "fa-plus",
            minus: "fa-minus",
            alert: "fa-exclamation-triangle",
            box: "fa-cube",
            upload: "fa-upload",
            trash: "fa-trash",
            pencil: "fa-pencil",
            sparkles: "fa-magic",
            play: "fa-play",
            menu: "fa-bars",
            x: "fa-times",
            save: "fa-save",
            chevron_right: "fa-chevron-right",
        };
        return `<i class="fa ${map[name] || name}"></i>`;
    }

    function badge(tone, html, dot) {
        return `<span class="spm-badge ${tone || "draft"}">${dot ? '<span class="dot"></span>' : ""}${html}</span>`;
    }

    function statusDot(status) {
        const st = status || "todo";
        const ic = st === "done" ? "check" : st === "partial" ? "minus" : st === "error" ? "alert" : "plus";
        return `<span class="spm-status-dot ${st}">${icon(ic)}</span>`;
    }

    function progressRing(pct, size) {
        const s = size || 52;
        const stroke = s > 80 ? 10 : 5;
        const r = (s - stroke) / 2;
        const c = 2 * Math.PI * r;
        const done = Math.max(0, Math.min(100, Number(pct || 0)));
        const dash = (c * done / 100).toFixed(2);
        const rest = (c - dash).toFixed(2);
        const lg = s > 80 ? " spm-ring-lg" : "";
        return `
            <div class="spm-ring${lg}" style="width:${s}px;height:${s}px">
                <svg viewBox="0 0 ${s} ${s}">
                    <circle class="spm-ring-track" cx="${s/2}" cy="${s/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
                    <circle class="spm-ring-fill" cx="${s/2}" cy="${s/2}" r="${r}" fill="none" stroke-width="${stroke}"
                            stroke-dasharray="${dash} ${rest}" stroke-linecap="round"/>
                </svg>
                <div class="spm-ring-label">${s > 80 ? `<strong>${done}%</strong><span>${done >= 100 ? "listo" : "completo"}</span>` : `${done}%`}</div>
            </div>`;
    }

    function field(label, id, value, opts) {
        opts = opts || {};
        const required = opts.required ? `<span class="req">*</span>` : "";
        const optional = opts.optional ? `<span class="opt">opcional</span>` : "";
        const cls = opts.full ? " full" : "";
        const mono = opts.mono ? " spm-mono" : "";
        const name = opts.name || id;
        if (opts.type === "textarea") {
            return `<div class="spm-field${cls}">
                <label for="${id}">${esc(label)}${required}${optional}</label>
                <textarea id="${id}" data-field="${esc(name)}" class="spm-textarea" rows="${opts.rows || 3}" placeholder="${esc(opts.placeholder || "")}">${esc(value || "")}</textarea>
            </div>`;
        }
        if (opts.options) {
            return `<div class="spm-field${cls}">
                <label for="${id}">${esc(label)}${required}${optional}</label>
                <select id="${id}" data-field="${esc(name)}" class="spm-select${mono}">
                    ${(opts.options || []).map(o => {
                        const val = typeof o === "object" ? o.value : o;
                        const text = typeof o === "object" ? o.label : o;
                        return `<option value="${esc(val)}" ${String(value || "") === String(val) ? "selected" : ""}>${esc(text)}</option>`;
                    }).join("")}
                </select>
            </div>`;
        }
        return `<div class="spm-field${cls}">
            <label for="${id}">${esc(label)}${required}${optional}</label>
            <input id="${id}" data-field="${esc(name)}" class="spm-input${mono}" type="${opts.type || "text"}"
                   value="${esc(value || "")}" placeholder="${esc(opts.placeholder || "")}"/>
        </div>`;
    }

    class ModernSupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.proforma = {};
            this.token = "";
            this.currentLang = localStorage.getItem("portal_lang") || "es";
            this.route = { section: "overview" };
            this.guideOpen = localStorage.getItem("portal_guide_open") !== "0";
            this.mobileNav = false;
            this.activeTabByShipment = {};
            this.packingRows = {};
            this.packingSetupState = {};
            this.productCollapseState = {};
            this.pendingUi = { packingsByShipment: {}, documentsByShipment: {} };
            this.nextRowId = 1;
            this._clientSeq = 1;
            this._bound = false;

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => this.init());
            } else {
                this.init();
            }
        }

        t(key) {
            const dict = I18N[this.currentLang] || I18N.es;
            return dict[key] || I18N.es[key] || key;
        }

        init() {
            const store = document.getElementById("portal-data-store");
            const root = document.getElementById("supplier-modern-root");
            if (!store || !root) {
                console.error("[ModernPortal] Faltan #portal-data-store o #supplier-modern-root.");
                return;
            }

            try {
                const raw = store.dataset.payload || store.textContent || "{}";
                this.data = JSON.parse(raw);
            } catch (err) {
                this.data = {};
                console.error("[ModernPortal] Payload inválido.", err);
            }

            this.token = this.data.token || "";
            this.products = this.normalizeProducts(this.data.products || []);
            this.proforma = this.normalizeProforma(this.data.proforma || {});
            this.root = root;
            this.render();
        }

        normalizeProducts(products) {
            return (products || []).map(p => ({
                id: asInt(p.id),
                name: p.name || p.product_name || "",
                code: p.code || p.default_code || p.ref || "",
                qty_ordered: Number(p.qty_ordered || p.requested_qty || 0),
                qty_available: p.qty_available !== undefined ? Number(p.qty_available || 0) : undefined,
                qty_current_shipment: Number(p.qty_current_shipment || 0),
                qty_remaining_after: p.qty_remaining_after !== undefined ? Number(p.qty_remaining_after || 0) : undefined,
                uom: p.uom || p.unit || "",
                unit_type: p.unit_type || p.kind || "Placa",
            }));
        }

        normalizeProforma(proforma) {
            const p = proforma || {};
            const shipments = (p.shipments || []).map((s, idx) => this.normalizeShipment(s, idx));
            return {
                id: p.id || false,
                vendor: this.data.vendor_name || this.data.partner_name || "",
                companyName: this.data.companyName || "",
                poName: this.data.poName || this.data.po_name || "",
                pickingName: this.data.pickingName || this.data.picking_name || "",
                proforma_number: p.proforma_number || this.data.header?.proforma_number || "",
                invoice_global_number: p.invoice_global_number || this.data.header?.invoice_number || "",
                payment_terms: p.payment_terms || this.data.header?.payment_terms || "",
                country_origin: p.country_origin || this.data.header?.country_origin || "",
                incoterm: p.incoterm || this.data.header?.incoterm || "",
                general_notes: p.general_notes || this.data.header?.general_notes || "",
                status: p.status || "draft",
                progress: p.progress || { percent: 0, sections: {} },
                quantity_balance: p.quantity_balance || [],
                shipments: shipments,
                global_documents: p.global_documents || [],
            };
        }

        normalizeShipment(s, idx) {
            const products = this.normalizeProducts(s.products || []);
            return {
                id: s.id,
                number: s.sequence || idx + 1,
                name: s.name || `Embarque #${idx + 1}`,
                shipment_type: s.shipment_type || "maritime",
                shipping_line: s.shipping_line || "",
                vessel_name: s.vessel_name || "",
                etd: s.etd || "",
                eta: s.eta || "",
                port_origin: s.port_origin || "",
                port_destination: s.port_destination || "",
                bl_number: s.bl_number || "",
                bl_date: s.bl_date || "",
                status: s.status || "draft",
                notes: s.notes || "",
                containers: s.containers || [],
                invoices: s.invoices || [],
                packings: s.packings || [],
                documents: s.documents || [],
                block_images: s.block_images || [],
                products: products.length ? products : this.products,
                picking_id: s.picking_id || false,
                picking_name: s.picking_name || "",
                picking_state: s.picking_state || "",
            };
        }

        getGlobalPayload() {
            return {
                proforma_number: document.getElementById("g-proforma-number")?.value || "",
                invoice_global_number: document.getElementById("g-invoice-global")?.value || "",
                payment_terms: document.getElementById("g-payment-terms")?.value || "",
                country_origin: document.getElementById("g-country-origin")?.value || "",
                incoterm: document.getElementById("g-incoterm")?.value || "",
                general_notes: document.getElementById("g-general-notes")?.value || "",
            };
        }

        getStatus() {
            const g = this.proforma || {};
            const req = ["proforma_number", "payment_terms", "country_origin", "incoterm"];
            const filled = req.filter(k => String(g[k] || "").trim()).length;
            const globals_pct = Math.round(filled / req.length * 100);
            const globals_status = globals_pct === 100 ? "done" : globals_pct > 0 ? "partial" : "todo";

            const shipments_status = (this.proforma.shipments || []).map(s => {
                const docs = this._getDisplayDocuments(s);
                const docTypes = new Set(docs.filter(d => !d._error && !d._deleting).map(d => d.document_type));
                const hasLog = !!((s.shipping_line || s.vessel_name) && (s.etd || s.eta));
                const hasBL = !!s.bl_number || docTypes.has("bl");
                const hasInv = (s.invoices || []).length > 0 && (s.invoices || []).some(i => i.invoice_number || i.amount);
                const hasContainers = (s.containers || []).length > 0 && (s.containers || []).some(c => c.container_number);
                const hasPacking = (s.packings || []).length > 0 && (s.packings || []).some(p => (p.row_count || (p.rows || []).length) > 0);
                const hasDocs = ["bl", "invoice", "packing_list"].filter(d => docTypes.has(d)).length;
                const score = [hasLog, hasBL, hasInv, hasContainers, hasPacking].filter(Boolean).length;
                return {
                    id: s.id,
                    pct: Math.round(score / 5 * 100),
                    status: score === 5 ? "done" : score > 0 ? "partial" : "todo",
                    tabs: { hasLog, hasBL, hasInv, hasContainers, hasPacking, hasDocs },
                };
            });

            const ship_done = shipments_status.filter(s => s.status === "done").length;
            const ship_pct = shipments_status.length
                ? Math.round(shipments_status.reduce((a, s) => a + s.pct, 0) / shipments_status.length)
                : 0;
            const ship_overall = ship_pct === 100 ? "done" : ship_pct > 0 ? "partial" : "todo";
            const backendPct = Number(this.proforma.progress?.percent || 0);
            const overall = backendPct || Math.round((globals_pct + ship_pct) / 2);

            return { globals_pct, globals_status, ship_pct, ship_overall, ship_done, shipments_status, overall };
        }

        sectionStatus(id, status) {
            if (id === "overview") return null;
            if (id === "globals") return status.globals_status;
            if (id === "shipments") return status.ship_overall;
            if (id === "documents") {
                const allDocs = (this.proforma.shipments || []).flatMap(s => this._getDisplayDocuments(s));
                return allDocs.length ? "partial" : "todo";
            }
            if (id === "review") return status.overall >= 100 ? "done" : "todo";
            return "todo";
        }

        render() {
            const status = this.getStatus();
            this.root.innerHTML = `
                <div class="spm-app">
                    ${this.renderHeader()}
                    <div class="spm-body ${!this.guideOpen ? "spm-guide-collapsed" : ""}">
                        ${this.renderSidebar(status)}
                        <main class="spm-main">${this.renderMain(status)}</main>
                        ${this.guideOpen ? this.renderGuide() : ""}
                    </div>
                </div>
            `;
            this.bind();
            this.afterRender();
        }

        renderHeader() {
            const initials = (this.proforma.vendor || "SG").split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "SG";
            return `
                <header class="spm-header">
                    <button class="spm-icon-btn" data-action="toggle-mobile-nav" aria-label="Menú">${icon("menu")}</button>
                    <div class="spm-brand">
                        <div class="spm-brand-mark">SG</div>
                        <div class="spm-brand-name">
                            <strong>SOM</strong>
                            <span>Portal proveedor</span>
                        </div>
                    </div>
                    <div class="spm-header-context">
                        <span class="spm-chip"><span class="spm-chip-dot"></span><span>Proveedor:</span><strong>${esc(this.proforma.vendor || "—")}</strong></span>
                        <span class="spm-chip"><span>Orden de Compra:</span><strong>${esc(this.proforma.poName || "—")}</strong></span>
                        <div class="spm-lang" role="tablist">
                            ${["es", "en", "zh"].map(l => `<button class="${this.currentLang === l ? "is-active" : ""}" data-action="set-lang" data-lang="${l}">${l === "zh" ? "中" : l.toUpperCase()}</button>`).join("")}
                        </div>
                        <button class="spm-guide-toggle ${this.guideOpen ? "is-active" : ""}" data-action="toggle-guide">
                            ${icon("sparkles")}<span>${this.guideOpen ? "Ocultar guía" : "Mostrar guía"}</span>
                        </button>
                        <button class="spm-guide-toggle" data-action="show-onboarding">${icon("play")}<span>Tutorial</span></button>
                        <div class="spm-avatar">${esc(initials)}</div>
                    </div>
                </header>
            `;
        }

        renderSidebar(status) {
            const sections = [
                ["overview", "Vista general", "home"],
                ["globals", "Datos de la Proforma", "globe"],
                ["shipments", "Embarques", "ship"],
                ["documents", "Documentos generales", "file"],
                ["review", "Revisar y enviar", "flag"],
            ];
            return `
                <aside class="spm-sidebar ${this.mobileNav ? "is-open" : ""}">
                    <div class="spm-progress-card">
                        ${progressRing(status.overall, 52)}
                        <div class="spm-progress-info">
                            <span class="label">Progreso global</span>
                            <span class="value">${status.overall}% completado</span>
                            <span class="meta">${esc(this.proforma.proforma_number || "PI sin número")}</span>
                        </div>
                    </div>
                    <nav>
                        <div class="spm-nav-title">Llenado de la Proforma</div>
                        <div class="spm-nav-list">
                            ${sections.map(([id, label, ic]) => {
                                const st = this.sectionStatus(id, status);
                                const active = this.route.section === id;
                                const prefix = st ? statusDot(st) : icon(ic);
                                const count = id === "shipments" ? `<span class="spm-nav-count">${status.ship_done}/${this.proforma.shipments.length}</span>` : "";
                                const children = id === "shipments" && (active || this.route.section === "shipment")
                                    ? `<div class="spm-nav-list">
                                        ${(this.proforma.shipments || []).map((s, idx) => {
                                            const sst = status.shipments_status[idx] || { status: "todo", pct: 0 };
                                            const isActive = this.route.section === "shipment" && Number(this.route.shipmentId) === Number(s.id);
                                            return `<button class="spm-nav-item spm-nav-child ${isActive ? "is-active" : ""}" data-route="shipment" data-shipment-id="${s.id}">
                                                ${statusDot(sst.status)}
                                                <span>Embarque #${s.number}</span>
                                                <span class="spm-nav-count">${sst.pct}%</span>
                                            </button>`;
                                        }).join("")}
                                    </div>`
                                    : "";
                                return `<button class="spm-nav-item ${active ? "is-active" : ""}" data-route="${id}">
                                    ${prefix}<span>${label}</span>${count}
                                </button>${children}`;
                            }).join("")}
                        </div>
                    </nav>
                </aside>
            `;
        }

        renderGuide() {
            const key = this.route.section === "shipment" ? "shipment" : this.route.section;
            const c = GUIDE_CONTENT[key] || GUIDE_CONTENT.overview;
            return `
                <aside class="spm-guide">
                    <div class="spm-guide-head">
                        <span class="spm-guide-label">${esc(c.label)}</span>
                        <button class="spm-icon-btn" data-action="toggle-guide" aria-label="Ocultar guía">${icon("x")}</button>
                    </div>
                    <div>
                        <h3>${esc(c.title)}</h3>
                        <p class="sub">${esc(c.sub)}</p>
                    </div>
                    <div class="spm-guide-illustration">${esc(c.illustration || "ilustración")}</div>
                    <div class="spm-guide-steps">
                        ${c.steps.map((s, idx) => `
                            <div class="spm-guide-step ${idx === 0 ? "is-active" : ""}">
                                <span class="num">${idx + 1}</span>
                                <div class="body"><strong>${esc(s[0])}</strong>${esc(s[1])}</div>
                            </div>
                        `).join("")}
                    </div>
                </aside>
            `;
        }

        renderMain(status) {
            if (this.route.section === "globals") return this.viewGlobals(status);
            if (this.route.section === "shipments") return this.viewShipments(status);
            if (this.route.section === "shipment") return this.viewShipment(status);
            if (this.route.section === "documents") return this.viewDocuments(status);
            if (this.route.section === "review") return this.viewReview(status);
            return this.viewOverview(status);
        }

        viewOverview(status) {
            const pending = [];
            if (status.globals_pct < 100) {
                pending.push({ route: "globals", tone: "partial", title: "Completar datos generales de la Proforma", desc: `${100 - status.globals_pct}% restante en datos generales.` });
            }
            (this.proforma.shipments || []).forEach((s, idx) => {
                const sst = status.shipments_status[idx];
                if (!sst || sst.status === "done") return;
                const reasons = [];
                if (!sst.tabs.hasLog) reasons.push("logística");
                if (!sst.tabs.hasBL) reasons.push("B/L");
                if (!sst.tabs.hasInv) reasons.push("invoices");
                if (!sst.tabs.hasContainers) reasons.push("contenedores");
                if (!sst.tabs.hasPacking) reasons.push("packing list");
                pending.push({ route: "shipment", shipmentId: s.id, tone: sst.status, title: `Embarque #${s.number} — ${sst.pct}% completo`, desc: reasons.length ? `Pendiente: ${reasons.join(", ")}.` : "Sin pendientes." });
            });

            const totalContainers = this.proforma.shipments.reduce((a, s) => a + (s.containers || []).length, 0);
            const totalInvoices = this.proforma.shipments.reduce((a, s) => a + (s.invoices || []).length, 0);
            const products = this.getProductsForOverview();

            return `
                <div class="spm-crumb">${icon("home")} Vista general</div>
                <section class="spm-hero">
                    <div>
                        <p class="spm-greet">Hola, equipo de ${esc(this.proforma.vendor || "proveedor")}</p>
                        <h1>Bienvenido al portal del proveedor</h1>
                        <p class="spm-lead">
                            Aquí vas a registrar todos los datos del envío para la Orden de Compra
                            <strong class="spm-mono">${esc(this.proforma.poName || "—")}</strong>.
                            No tienes que terminar de una sola vez; puedes guardar y volver después.
                        </p>
                        <div class="spm-hero-meta">
                            <div class="item"><strong>${this.proforma.shipments.length}</strong>embarques</div>
                            <div class="item"><strong>${totalContainers}</strong>contenedores</div>
                            <div class="item"><strong>${totalInvoices}</strong>invoices</div>
                            <div class="item"><strong>${products.reduce((a, p) => a + Number(p.qty_ordered || 0), 0).toFixed(2)}</strong>solicitado</div>
                        </div>
                    </div>
                    ${progressRing(status.overall, 148)}
                </section>

                ${status.overall < 100 ? `
                <section class="spm-card">
                    <div class="spm-card-head no-divider">
                        <div><h2>Lo que falta para terminar</h2><p class="sub">Ordenado de lo más general a lo más detallado.</p></div>
                        <button class="spm-btn spm-btn-accent" data-route="${pending[0]?.route || "globals"}" ${pending[0]?.shipmentId ? `data-shipment-id="${pending[0].shipmentId}"` : ""}>${icon("play")} Continuar donde quedé</button>
                    </div>
                    <div class="spm-check-list">
                        ${pending.map(p => `
                            <div class="spm-check-item" data-route="${p.route}" ${p.shipmentId ? `data-shipment-id="${p.shipmentId}"` : ""}>
                                <span class="spm-check-icon ${p.tone}">${icon(p.tone === "done" ? "check" : p.tone === "partial" ? "minus" : "plus")}</span>
                                <div class="spm-check-body"><div class="title">${esc(p.title)}</div><div class="desc">${esc(p.desc)}</div></div>
                                ${icon("chevron_right")}
                            </div>
                        `).join("")}
                    </div>
                </section>` : ""}

                <section class="spm-card">
                    <div class="spm-card-head no-divider">
                        <div><h3>Productos solicitados en esta Proforma</h3><p class="sub">Esto es lo que SOM GROUP pidió. El packing list debe registrarse contra estos productos.</p></div>
                    </div>
                    ${this.renderProductsTable(products)}
                </section>

                <div class="spm-callout"><div class="ico">${icon("sparkles")}</div><div><strong>Tip: el packing list es lo más detallado.</strong>Configura bloques primero; después captura medidas y contenedores por fila.</div></div>
            `;
        }

        getProductsForOverview() {
            const balance = this.proforma.quantity_balance || [];
            if (balance.length) {
                return balance.map(x => ({
                    id: x.product_id,
                    code: x.product_code || "",
                    name: x.product_name || "",
                    unit_type: "Producto",
                    qty_ordered: x.qty_ordered || 0,
                    uom: x.uom || "",
                }));
            }
            return this.products;
        }

        renderProductsTable(products) {
            if (!products.length) {
                return `<div class="spm-callout warn"><div class="ico">${icon("alert")}</div><div><strong>Sin productos.</strong>No se recibieron líneas de compra en el payload.</div></div>`;
            }
            return `
                <table class="spm-table">
                    <thead><tr><th>Referencia</th><th>Producto</th><th>Tipo</th><th style="text-align:right">Solicitado</th></tr></thead>
                    <tbody>
                        ${products.map(p => `
                            <tr>
                                <td class="spm-mono">${esc(p.code || "—")}</td>
                                <td><strong>${esc(p.name || "—")}</strong></td>
                                <td class="spm-text-muted">${esc(p.unit_type || "Producto")}</td>
                                <td style="text-align:right" class="spm-mono"><strong>${Number(p.qty_ordered || 0).toFixed(2)}</strong> <span class="spm-text-muted">${esc(p.uom || "")}</span></td>
                            </tr>`).join("")}
                    </tbody>
                </table>`;
        }

        viewGlobals(status) {
            const p = this.proforma;
            return `
                <div class="spm-crumb"><a data-route="overview">Vista general</a>${icon("chevron_right")} Datos de la Proforma</div>
                <div class="spm-page-head">
                    <div><h1>Datos generales de la Proforma</h1><p class="spm-lead">Información que se aplica a toda la Orden de Compra. Los puertos y datos específicos se capturan por embarque.</p></div>
                    ${badge(status.globals_status === "done" ? "done" : status.globals_status === "partial" ? "partial" : "todo", `${icon(status.globals_status === "done" ? "check" : "minus")} ${status.globals_pct}% completo`)}
                </div>

                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Identificación</h2><p class="sub">Cómo identifica este lote tu sistema y SOM GROUP.</p></div></div>
                    <div class="spm-form-grid">
                        ${field("Número de Proforma", "g-proforma-number", p.proforma_number, { required: true, mono: true, placeholder: "PI-9920-A" })}
                        ${field("Factura global", "g-invoice-global", p.invoice_global_number, { optional: true, mono: true, placeholder: "INV-2026-001" })}
                    </div>
                </section>

                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Condiciones generales</h2><p class="sub">Datos generales de origen, incoterm y pago.</p></div></div>
                    <div class="spm-form-grid cols-3">
                        ${field("País de origen", "g-country-origin", p.country_origin, { required: true, placeholder: "Ej. China" })}
                        ${field("Incoterm", "g-incoterm", p.incoterm, { required: true, options: ["", "EXW", "FOB", "CIF", "CFR", "DAP", "DDP"] })}
                        ${field("Condiciones de pago", "g-payment-terms", p.payment_terms, { required: true, placeholder: "T/T 30% advance, 70% B/L copy" })}
                    </div>
                </section>

                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Observaciones generales</h2><p class="sub">Restricciones, demoras o cuidados especiales.</p></div></div>
                    ${field("Observaciones", "g-general-notes", p.general_notes, { optional: true, type: "textarea", full: true, placeholder: "Ej. Las placas vienen empacadas en bundles de madera dura." })}
                </section>

                <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:24px">
                    <span class="spm-text-muted spm-small">${icon("check")} Guardado manual con sincronización a Odoo</span>
                    <div style="display:flex;gap:8px">
                        <button class="spm-btn spm-btn-ghost" data-route="overview">Volver</button>
                        <button class="spm-btn spm-btn-primary" data-action="save-globals">${icon("save")} Guardar y continuar</button>
                    </div>
                </div>`;
        }

        viewShipments(status) {
            return `
                <div class="spm-crumb"><a data-route="overview">Vista general</a>${icon("chevron_right")} Embarques</div>
                <div class="spm-page-head">
                    <div><h1>Embarques</h1><p class="spm-lead">Cada embarque es un viaje físico: buque, vuelo o camión. Puedes dividir la OC en uno o varios embarques.</p></div>
                    <button class="spm-btn spm-btn-primary" data-action="add-shipment">${icon("plus")} Agregar embarque</button>
                </div>

                ${(this.proforma.shipments || []).length ? `
                    <div style="display:flex;flex-direction:column;gap:12px">
                        ${(this.proforma.shipments || []).map((s, idx) => this.renderShipmentCard(s, status.shipments_status[idx] || {})).join("")}
                    </div>` : `
                    <div class="spm-card" style="text-align:center;padding:44px">
                        <div style="font-size:32px;color:var(--spm-ink-4);margin-bottom:10px">${icon("ship")}</div>
                        <h2>No hay embarques registrados todavía</h2>
                        <p class="spm-text-muted">Cuando sepas la fecha aproximada del envío, agrega un embarque y empieza a capturar logística y packing list.</p>
                        <button class="spm-btn spm-btn-accent" data-action="add-shipment">${icon("plus")} Crear el primer embarque</button>
                    </div>`}

                <div class="spm-callout"><div class="ico">${icon("alert")}</div><div><strong>¿Cuándo dividir en varios embarques?</strong>Si la producción sale en fechas distintas o en barcos diferentes, crea un embarque por cada viaje.</div></div>`;
        }

        renderShipmentCard(s, sst) {
            const route = `${esc(s.port_origin || "—")} → ${esc(s.port_destination || "—")}`;
            return `
                <div class="spm-ship-card" data-route="shipment" data-shipment-id="${s.id}">
                    <div class="spm-ship-num">#${esc(s.number)}</div>
                    <div class="spm-ship-meta">
                        <div class="spm-ship-title">
                            <span>${s.vessel_name ? esc(s.vessel_name) : '<span class="spm-text-muted">Sin buque asignado</span>'}</span>
                            ${badge(STATUS_TONE[s.status] || "draft", `<span class="dot"></span>${esc(STATUS_LABEL[s.status] || "Borrador")}`)}
                            ${sst.status === "done" ? badge("done", `${icon("check")} Completo`) : sst.status === "partial" ? badge("partial", `${icon("minus")} ${sst.pct || 0}%`) : badge("todo", "Sin datos")}
                        </div>
                        <div class="spm-ship-route">
                            <span>${icon("ship")} ${esc(s.shipping_line || "Sin naviera")}</span>
                            <span class="spm-mono">${route}</span>
                            <span>ETD <span class="spm-mono">${esc(s.etd || "—")}</span></span>
                            <span>ETA <span class="spm-mono">${esc(s.eta || "—")}</span></span>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:16px">
                        <div style="text-align:right"><div class="spm-mono" style="font-weight:820;font-size:16px">${sst.pct || 0}%</div><div class="spm-text-muted" style="font-size:11px">completo</div></div>
                        <div class="spm-completion" title="Logística · B/L · Invoices · Contenedores · Packing">
                            <span class="${sst.tabs?.hasLog ? "done" : ""}"></span>
                            <span class="${sst.tabs?.hasBL ? "done" : ""}"></span>
                            <span class="${sst.tabs?.hasInv ? "done" : ""}"></span>
                            <span class="${sst.tabs?.hasContainers ? "done" : ""}"></span>
                            <span class="${sst.tabs?.hasPacking ? "done" : ""}"></span>
                        </div>
                        ${icon("chevron_right")}
                    </div>
                </div>`;
        }

        viewShipment(status) {
            const ship = this.getShipment(this.route.shipmentId);
            if (!ship) {
                return `<div class="spm-card"><h2>Embarque no encontrado</h2><button class="spm-btn spm-btn-primary" data-route="shipments">Volver</button></div>`;
            }
            const idx = this.proforma.shipments.findIndex(s => Number(s.id) === Number(ship.id));
            const sst = status.shipments_status[idx] || { pct: 0, tabs: {} };
            const tab = this.activeTabByShipment[ship.id] || this.route.tab || "logistics";

            return `
                <div class="spm-crumb"><a data-route="overview">Vista general</a>${icon("chevron_right")}<a data-route="shipments">Embarques</a>${icon("chevron_right")} Embarque #${ship.number}</div>
                <div class="spm-page-head">
                    <div>
                        <h1 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                            Embarque #${ship.number}
                            ${badge(STATUS_TONE[ship.status] || "draft", `<span class="dot"></span>${esc(STATUS_LABEL[ship.status] || "Borrador")}`)}
                        </h1>
                        <p class="spm-lead">${ship.vessel_name ? `Buque <strong class="spm-mono">${esc(ship.vessel_name)}</strong> de <strong>${esc(ship.shipping_line || "—")}</strong>.` : "Aún sin buque ni naviera. Empieza por Logística + B/L."}</p>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center">
                        <span class="spm-text-muted spm-small">${sst.pct}% completo</span>
                        <button class="spm-btn spm-btn-danger-ghost" data-action="delete-shipment" data-shipment-id="${ship.id}">${icon("trash")} Eliminar</button>
                    </div>
                </div>

                <div class="spm-tabs">
                    ${SHIP_TABS.map(t => {
                        const count = t.id === "invoices" ? (ship.invoices || []).length
                            : t.id === "containers" ? (ship.containers || []).length
                            : t.id === "packings" ? this._getDisplayPackings(ship).length
                            : t.id === "documents" ? this._getDisplayDocuments(ship).length : null;
                        return `<button class="spm-tab ${tab === t.id ? "is-active" : ""}" data-action="set-tab" data-shipment-id="${ship.id}" data-tab="${t.id}">
                            <i class="fa ${t.icon}"></i>${esc(t.label)}${count ? badge("accent", String(count)) : ""}
                        </button>`;
                    }).join("")}
                </div>

                <div class="spm-tab-content" id="stab-${tab}-${ship.id}">
                    ${this.renderShipmentTab(tab, ship)}
                </div>`;
        }

        renderShipmentTab(tab, ship) {
            if (tab === "invoices") return this.tabInvoices(ship);
            if (tab === "containers") return this.tabContainers(ship);
            if (tab === "packings") return this.tabPackings(ship);
            if (tab === "documents") return this.tabDocuments(ship);
            return this.tabLogistics(ship);
        }

        tabLogistics(ship) {
            return `
                <section class="spm-card" data-section="logistics" data-shipment-id="${ship.id}">
                    <div class="spm-card-head">
                        <div><h2>Datos de logística</h2><p class="sub">Información del transporte y fechas estimadas.</p></div>
                        <button class="spm-btn spm-btn-primary spm-btn-sm" data-action="save-logistics" data-shipment-id="${ship.id}">${icon("save")} Guardar</button>
                    </div>
                    <div class="spm-form-grid cols-3">
                        ${field("Tipo de transporte", "ship-type", ship.shipment_type, { required: true, name: "shipment_type", options: [{value:"",label:"Selecciona…"},{value:"maritime",label:"Marítimo"},{value:"air",label:"Aéreo"},{value:"land",label:"Terrestre"}] })}
                        ${field("Naviera / Aerolínea", "ship-line", ship.shipping_line, { required: true, name: "shipping_line", placeholder: "Ej. COSCO Shipping Lines" })}
                        ${field("Buque + viaje", "ship-vessel", ship.vessel_name, { required: true, name: "vessel_name", mono: true, placeholder: "Ej. COSCO TAICANG / 042E" })}
                    </div>
                    <div class="spm-form-grid cols-4" style="margin-top:16px">
                        ${field("Puerto origen", "ship-port-origin", ship.port_origin, { name: "port_origin", placeholder: "Shanghai" })}
                        ${field("Puerto destino", "ship-port-dest", ship.port_destination, { name: "port_destination", placeholder: "Manzanillo" })}
                        ${field("ETD", "ship-etd", ship.etd, { required: true, name: "etd", type: "date" })}
                        ${field("ETA", "ship-eta", ship.eta, { required: true, name: "eta", type: "date" })}
                    </div>
                    <div class="spm-form-grid cols-3" style="margin-top:16px">
                        ${field("Estado actual", "ship-status", ship.status, { required: true, name: "status", options: Object.entries(STATUS_LABEL).filter(([k]) => k !== "complete").map(([value,label]) => ({value,label})) })}
                        ${field("Número de B/L", "ship-bl", ship.bl_number, { required: true, name: "bl_number", mono: true, placeholder: "COSU6817042500" })}
                        ${field("Fecha de B/L", "ship-bl-date", ship.bl_date, { name: "bl_date", type: "date" })}
                    </div>
                    <div style="margin-top:16px">
                        ${field("Observaciones", "ship-notes", ship.notes, { optional: true, name: "notes", type: "textarea", full: true, placeholder: "Ej. Cambio de buque por sobrecupo." })}
                    </div>
                </section>
                <div class="spm-callout"><div class="ico">${icon("file")}</div><div><strong>Archivo de B/L.</strong>El PDF se sube en la pestaña Documentos como tipo Bill of Lading (B/L). Así queda en VUCEM y en el checklist.</div></div>`;
        }

        tabInvoices(ship) {
            return `
                <section class="spm-card" data-section="invoices" data-shipment-id="${ship.id}">
                    <div class="spm-card-head">
                        <div><h2>Invoices</h2><p class="sub">Factura comercial del embarque. Puede ser una o varias parciales.</p></div>
                        <div style="display:flex;gap:8px">
                            <button class="spm-btn spm-btn-secondary spm-btn-sm" data-action="add-invoice-row">${icon("plus")} Agregar invoice</button>
                            <button class="spm-btn spm-btn-primary spm-btn-sm" data-action="save-invoices" data-shipment-id="${ship.id}">${icon("save")} Guardar</button>
                        </div>
                    </div>
                    <div id="spm-invoice-list" style="display:flex;flex-direction:column;gap:14px">
                        ${(ship.invoices || []).map((inv, idx) => this.invoiceCard(inv, idx)).join("") || this.emptySmall("file", "Aún no hay invoices", "Agrega al menos una factura comercial para este embarque.")}
                    </div>
                </section>`;
        }

        invoiceCard(inv, idx) {
            const id = inv.id || 0;
            return `
                <div class="spm-card tight spm-invoice-card" data-invoice-id="${id}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                        <strong>Invoice ${idx + 1}</strong>
                        <button class="spm-btn spm-btn-danger-ghost spm-btn-sm" data-action="remove-row-card">${icon("trash")} Eliminar</button>
                    </div>
                    <div class="spm-form-grid cols-3">
                        ${field("No. Invoice", `inv-number-${idx}`, inv.invoice_number, { required: true, name: "invoice_number", mono: true, placeholder: "JQ-INV-2026-088" })}
                        ${field("Fecha", `inv-date-${idx}`, inv.invoice_date, { required: true, name: "invoice_date", type: "date" })}
                        ${field("Monto", `inv-amount-${idx}`, inv.amount || "", { required: true, name: "amount", type: "number", mono: true, placeholder: "62400" })}
                    </div>
                </div>`;
        }

        tabContainers(ship) {
            return `
                <section class="spm-card" data-section="containers" data-shipment-id="${ship.id}">
                    <div class="spm-card-head">
                        <div><h2>Contenedores</h2><p class="sub">Cada caja física que viaja en el embarque.</p></div>
                        <div style="display:flex;gap:8px">
                            <button class="spm-btn spm-btn-secondary spm-btn-sm" data-action="add-container-row">${icon("plus")} Agregar contenedor</button>
                            <button class="spm-btn spm-btn-primary spm-btn-sm" data-action="save-containers" data-shipment-id="${ship.id}">${icon("save")} Guardar</button>
                        </div>
                    </div>
                    <div id="spm-container-list" style="display:flex;flex-direction:column;gap:14px">
                        ${(ship.containers || []).map((c, idx) => this.containerCard(c, idx)).join("") || this.emptySmall("box", "Sin contenedores", "Captura los números cuando te los entregue tu agente.")}
                    </div>
                </section>`;
        }

        containerCard(c, idx) {
            return `
                <div class="spm-card tight spm-container-card" data-container-id="${c.id || 0}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                        <strong>${esc(c.container_number || `Contenedor ${idx + 1}`)}</strong>
                        <button class="spm-btn spm-btn-danger-ghost spm-btn-sm" data-action="remove-row-card">${icon("trash")} Eliminar</button>
                    </div>
                    <div class="spm-form-grid cols-3">
                        ${field("No. Contenedor", `cnt-number-${idx}`, c.container_number, { required: true, name: "container_number", mono: true, placeholder: "COSU6817042" })}
                        ${field("No. de Sello", `cnt-seal-${idx}`, c.seal_number, { required: true, name: "seal_number", mono: true, placeholder: "CN8821044" })}
                        ${field("Tipo", `cnt-type-${idx}`, c.container_type || "40HQ", { required: true, name: "container_type", options: ["20GP","40GP","40HQ","45HQ"] })}
                    </div>
                    <div class="spm-form-grid cols-3" style="margin-top:14px">
                        ${field("Peso bruto (kg)", `cnt-weight-${idx}`, c.weight || "", { name: "weight", type: "number", mono: true })}
                        ${field("Volumen (m³)", `cnt-volume-${idx}`, c.volume || "", { name: "volume", type: "number", mono: true })}
                        ${field("No. de paquetes", `cnt-packages-${idx}`, c.packages || "", { name: "packages", type: "number", mono: true })}
                    </div>
                </div>`;
        }

        tabPackings(ship) {
            const packings = this._getDisplayPackings(ship);
            return `
                <section class="spm-card">
                    <div class="spm-card-head">
                        <div><h2>Packing Lists</h2><p class="sub">Configura bloques y captura placa por placa o pieza por pieza.</p></div>
                        <button class="spm-btn spm-btn-primary" data-action="add-packing" data-shipment-id="${ship.id}">${icon("plus")} Nuevo packing list</button>
                    </div>
                    ${packings.length ? `<div id="spm-packings-list">${packings.map(pk => this.packingCard(pk, ship)).join("")}</div>` : this.emptySmall("box", "Aún no hay packing lists", "Crea uno y usa el asistente para generar filas por bloque.")}
                </section>
                <div class="spm-callout"><div class="ico">${icon("sparkles")}</div><div><strong>Asistente de packing.</strong>Primero define producto, bloques, cantidad de placas/piezas y foto por bloque; después captura medidas y contenedor.</div></div>`;
        }

        packingCard(pk, ship) {
            const rowCount = pk.row_count || (pk.rows || []).length || 0;
            const pkId = pk.id || pk._client_id;
            const numberField = field("No. Packing", `pk-number-${pkId}`, pk.packing_number || "", { name: "packing_number", mono: true, placeholder: "PK-2026-088-A" }).replace("data-field=", `data-pk-id="${pkId}" data-pk-f=`);
            const dateField = field("Fecha", `pk-date-${pkId}`, pk.packing_date || "", { name: "packing_date", type: "date" }).replace("data-field=", `data-pk-id="${pkId}" data-pk-f=`);
            const scopeField = field("Alcance", `pk-scope-${pkId}`, pk.scope || "full_shipment", { name: "scope", options: [{value:"full_shipment",label:"Todo el embarque"},{value:"specific_containers",label:"Contenedores específicos"}] }).replace("data-field=", `data-pk-id="${pkId}" data-pk-f=`);
            return `
                <div class="packing-card" data-packing-id="${pkId}">
                    <div class="packing-card-head">
                        <div style="flex:1">
                            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
                                <strong class="spm-mono">${esc(pk.packing_number || `PK-${pkId}`)}</strong>
                                ${badge(rowCount ? "partial" : "todo", `${rowCount} filas`)}
                                <span class="pk-autosave-indicator pk-autosave-idle">${icon("sparkles")} Autoguardado</span>
                            </div>
                            <div class="spm-form-grid cols-3">${numberField}${dateField}${scopeField}</div>
                        </div>
                        <button class="spm-btn spm-btn-secondary spm-btn-sm" data-action="open-packing-setup" data-shipment-id="${ship.id}" data-packing-id="${pkId}">${icon("pencil")} Configurar</button>
                    </div>
                    <div class="packing-rows-area" id="pk-rows-${pkId}"></div>
                </div>`;
        }

        tabDocuments(ship) {
            const docs = this._getDisplayDocuments(ship);
            const section = (title, types) => `
                <div style="margin-bottom:20px">
                    <h3 style="font-size:15px;margin:0 0 12px">${esc(title)}</h3>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        ${types.map(dt => this.documentSlot(dt, docs, ship.id)).join("")}
                    </div>
                </div>`;
            return `
                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Documentos del embarque</h2><p class="sub">Sube los documentos legales y de calidad que acompañan este embarque.</p></div></div>
                    ${section("Documentos obligatorios", DOC_TYPES_REQUIRED)}
                    ${section("Documentación adicional", DOC_TYPES_EXTRA)}
                </section>`;
        }

        documentSlot(dt, docs, shipmentId) {
            const uploaded = docs.filter(d => d.document_type === dt.key);
            const hasDoc = uploaded.some(d => !d._error && !d._deleting);
            return `
                <div class="spm-doc-row" data-doc-type="${dt.key}">
                    <div class="spm-doc-icon">${icon(hasDoc ? "check" : "file")}</div>
                    <div class="spm-doc-meta">
                        <div class="name">${esc(dt.label)} ${dt.required ? '<span style="color:var(--spm-danger)">*</span>' : ""}</div>
                        <div class="meta">${hasDoc ? `${uploaded.length} archivo(s)` : (dt.required ? "Pendiente" : "Opcional")}</div>
                        ${uploaded.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">
                            ${uploaded.map(d => `
                                <span class="spm-badge ${d._error ? "error" : d._pending ? "partial" : "done"}">
                                    ${d._pending ? '<i class="fa fa-spinner fa-spin"></i>' : icon(d._error ? "alert" : "file")}
                                    ${esc(d.name || "archivo")}
                                    ${d.id && !d._pending ? `<button type="button" data-action="delete-document" data-doc-id="${d.id}" data-shipment-id="${shipmentId}" style="border:0;background:transparent;color:inherit;padding:0 0 0 4px">${icon("x")}</button>` : ""}
                                </span>`).join("")}
                        </div>` : ""}
                    </div>
                    <label class="spm-btn spm-btn-secondary spm-btn-sm">
                        ${icon("upload")} Subir
                        <input type="file" style="display:none" accept="${esc(dt.accept)}" data-action="upload-document" data-doc-type="${dt.key}" data-shipment-id="${shipmentId}"/>
                    </label>
                </div>`;
        }

        viewDocuments() {
            const shipments = this.proforma.shipments || [];
            return `
                <div class="spm-crumb"><a data-route="overview">Vista general</a>${icon("chevron_right")} Documentos generales</div>
                <div class="spm-page-head"><div><h1>Documentos generales</h1><p class="spm-lead">En esta implementación los documentos se gestionan por embarque para mantener trazabilidad VUCEM.</p></div></div>
                <section class="spm-card">
                    <div class="spm-card-head no-divider"><div><h2>Accesos rápidos por embarque</h2><p class="sub">Abre un embarque para subir B/L, invoice, packing list y documentos de soporte.</p></div></div>
                    <div style="display:flex;flex-direction:column;gap:12px">
                        ${shipments.map(s => `
                            <div class="spm-check-item" data-route="shipment" data-shipment-id="${s.id}" data-tab="documents">
                                <span class="spm-check-icon partial">${icon("file")}</span>
                                <div class="spm-check-body"><div class="title">Embarque #${esc(s.number)} — ${esc(s.name)}</div><div class="desc">${this._getDisplayDocuments(s).length} documento(s) cargado(s)</div></div>
                                ${icon("chevron_right")}
                            </div>`).join("") || this.emptySmall("file", "Sin embarques", "Crea primero un embarque para subir documentos.")}
                    </div>
                </section>`;
        }

        viewReview(status) {
            const checks = [];
            checks.push({ ok: status.globals_pct === 100, label: "Datos generales de la Proforma", detail: status.globals_pct === 100 ? "Completos" : `${status.globals_pct}% — faltan campos requeridos`, route: "globals" });
            (this.proforma.shipments || []).forEach((s, idx) => {
                const sst = status.shipments_status[idx] || { tabs: {}, status: "todo" };
                const miss = [];
                if (!sst.tabs.hasLog) miss.push("logística");
                if (!sst.tabs.hasBL) miss.push("B/L");
                if (!sst.tabs.hasInv) miss.push("invoices");
                if (!sst.tabs.hasContainers) miss.push("contenedores");
                if (!sst.tabs.hasPacking) miss.push("packing");
                checks.push({ ok: sst.status === "done", label: `Embarque #${s.number}`, detail: sst.status === "done" ? "Todo capturado" : `Pendiente: ${miss.join(", ")}`, route: "shipment", shipmentId: s.id });
            });
            const allDone = checks.length > 0 && checks.every(c => c.ok);
            return `
                <div class="spm-crumb"><a data-route="overview">Vista general</a>${icon("chevron_right")} Revisar y enviar</div>
                <div class="spm-page-head"><div><h1>Revisar y enviar a SOM GROUP</h1><p class="spm-lead">Última revisión antes de marcar la Proforma como completa.</p></div>${progressRing(status.overall, 68)}</div>
                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Resumen general</h2><p class="sub">Datos que se enviarán como confirmación.</p></div></div>
                    <div class="spm-form-grid cols-3">
                        ${this.stat("Proforma", this.proforma.proforma_number || "—")}
                        ${this.stat("Orden de compra", this.proforma.poName || "—")}
                        ${this.stat("Incoterm", this.proforma.incoterm || "—")}
                        ${this.stat("Embarques", this.proforma.shipments.length)}
                        ${this.stat("Contenedores", this.proforma.shipments.reduce((a,s) => a + (s.containers || []).length, 0))}
                        ${this.stat("Invoices", this.proforma.shipments.reduce((a,s) => a + (s.invoices || []).length, 0))}
                    </div>
                </section>
                <section class="spm-card">
                    <div class="spm-card-head"><div><h2>Checklist final</h2><p class="sub">Verifica que cada sección esté completa.</p></div></div>
                    <div style="display:flex;flex-direction:column;gap:10px">
                        ${checks.map(c => `
                            <div class="spm-check-item" data-route="${c.route}" ${c.shipmentId ? `data-shipment-id="${c.shipmentId}"` : ""}>
                                <span class="spm-check-icon ${c.ok ? "done" : "partial"}">${icon(c.ok ? "check" : "minus")}</span>
                                <div class="spm-check-body"><div class="title">${esc(c.label)}</div><div class="desc">${esc(c.detail)}</div></div>
                            </div>`).join("")}
                    </div>
                </section>
                ${!allDone ? `<div class="spm-callout warn"><div class="ico">${icon("alert")}</div><div><strong>Aún hay puntos pendientes.</strong>Puedes marcar como completa cuando tengas el expediente validado.</div></div>` : ""}
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:24px">
                    <span class="spm-text-muted spm-small">SOM GROUP recibirá la notificación al completar.</span>
                    <div style="display:flex;gap:8px"><button class="spm-btn spm-btn-ghost" data-route="overview">Volver</button><button class="spm-btn spm-btn-accent spm-btn-lg" data-action="complete-proforma">${icon("flag")} Marcar como completa</button></div>
                </div>`;
        }

        stat(label, value) {
            return `<div style="padding:14px;border:1px solid var(--spm-border);border-radius:12px;background:var(--spm-surface-alt)">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--spm-ink-3);font-weight:820;margin-bottom:4px">${esc(label)}</div>
                <div class="spm-mono" style="font-weight:820;font-size:16px">${esc(value)}</div>
            </div>`;
        }

        emptySmall(ic, title, body) {
            return `<div class="spm-card tight" style="text-align:center;background:var(--spm-surface-alt);border-style:dashed">
                <div style="font-size:24px;color:var(--spm-ink-4);margin-bottom:8px">${icon(ic)}</div>
                <strong>${esc(title)}</strong>
                <div class="spm-text-muted spm-small">${esc(body)}</div>
            </div>`;
        }

        bind() {
            if (!this.root || this._bound) return;
            this._bound = true;

            this.root.addEventListener("click", (e) => {
                const routeEl = e.target.closest("[data-route]");
                const actionEl = e.target.closest("[data-action]");

                if (routeEl && !actionEl) {
                    e.preventDefault();
                    this.go(routeEl.dataset.route, routeEl.dataset);
                    return;
                }

                if (!actionEl) return;
                const action = actionEl.dataset.action;

                if (action === "toggle-mobile-nav") {
                    this.mobileNav = !this.mobileNav;
                    this.renderAll();
                } else if (action === "toggle-guide") {
                    this.guideOpen = !this.guideOpen;
                    localStorage.setItem("portal_guide_open", this.guideOpen ? "1" : "0");
                    this.renderAll();
                } else if (action === "set-lang") {
                    this.currentLang = actionEl.dataset.lang || "es";
                    localStorage.setItem("portal_lang", this.currentLang);
                    this.renderAll();
                } else if (action === "show-onboarding") {
                    this.showOnboarding();
                } else if (action === "save-globals") {
                    this.saveGlobals();
                } else if (action === "add-shipment") {
                    this.addShipment();
                } else if (action === "delete-shipment") {
                    this.deleteShipment(actionEl.dataset.shipmentId);
                } else if (action === "set-tab") {
                    this.activeTabByShipment[actionEl.dataset.shipmentId] = actionEl.dataset.tab;
                    this.route = { section: "shipment", shipmentId: actionEl.dataset.shipmentId, tab: actionEl.dataset.tab };
                    this.renderAll();
                } else if (action === "save-logistics") {
                    this.saveLogistics(actionEl.dataset.shipmentId);
                } else if (action === "add-invoice-row") {
                    this.addInvoiceRow();
                } else if (action === "save-invoices") {
                    this.saveInvoices(actionEl.dataset.shipmentId);
                } else if (action === "add-container-row") {
                    this.addContainerRow();
                } else if (action === "save-containers") {
                    this.saveContainers(actionEl.dataset.shipmentId);
                } else if (action === "remove-row-card") {
                    actionEl.closest(".spm-card.tight")?.remove();
                } else if (action === "add-packing") {
                    this.addPacking(actionEl.dataset.shipmentId);
                } else if (action === "open-packing-setup") {
                    this.openPackingSetup(actionEl.dataset.shipmentId, actionEl.dataset.packingId);
                } else if (action === "delete-document") {
                    this.deleteDocument(actionEl.dataset.shipmentId, actionEl.dataset.docId);
                } else if (action === "complete-proforma") {
                    this.completeProforma();
                }
            });

            this.root.addEventListener("change", (e) => {
                const input = e.target.closest('input[type="file"][data-action="upload-document"]');
                if (input) {
                    this.uploadDocument(input.dataset.shipmentId, input.dataset.docType, input.files && input.files[0]);
                    input.value = "";
                }
            });
        }

        afterRender() {
            if (this.route.section === "shipment") {
                const ship = this.getShipment(this.route.shipmentId);
                const tab = this.activeTabByShipment[ship?.id] || this.route.tab || "logistics";
                if (ship && tab === "packings") {
                    setTimeout(() => this.activatePackingAreas(ship.id), 0);
                }
            }
        }

        go(section, dataset) {
            const route = { section };
            if (dataset?.shipmentId) route.shipmentId = dataset.shipmentId;
            if (dataset?.tab) {
                route.tab = dataset.tab;
                this.activeTabByShipment[dataset.shipmentId] = dataset.tab;
            }
            this.route = route;
            this.mobileNav = false;
            this.renderAll();
        }

        getShipment(id) {
            return (this.proforma.shipments || []).find(s => Number(s.id) === Number(id));
        }

        _getFreshShipment(id) { return this.getShipment(id); }
        _updateShipmentBodyRef() { return; }
        updateShipmentBlockHeader() { return; }

        makeClientId(prefix) {
            this._clientSeq += 1;
            return `${prefix || "tmp"}_${Date.now()}_${this._clientSeq}_${Math.random().toString(36).slice(2, 8)}`;
        }

        _pendingList(kind, shipmentId) {
            const sid = String(shipmentId || 0);
            const bucket = kind === "document" ? "documentsByShipment" : "packingsByShipment";
            this.pendingUi[bucket] = this.pendingUi[bucket] || {};
            this.pendingUi[bucket][sid] = this.pendingUi[bucket][sid] || [];
            return this.pendingUi[bucket][sid];
        }

        _getPendingPackings(shipmentId) { return this._pendingList("packing", shipmentId).filter(x => !x._hidden); }
        _getDisplayPackings(shipment) { return (shipment?.packings || []).concat(this._getPendingPackings(shipment?.id)); }
        _getPendingDocuments(shipmentId) { return this._pendingList("document", shipmentId).filter(x => !x._hidden); }
        _addPendingDocument(shipmentId, documentData) { this._pendingList("document", shipmentId).push(documentData); }
        _updatePendingDocument(shipmentId, clientId, patch) {
            const item = this._pendingList("document", shipmentId).find(x => String(x._client_id || x.id) === String(clientId));
            if (item) Object.assign(item, patch || {});
        }
        _removePendingDocument(shipmentId, clientId) {
            const list = this._pendingList("document", shipmentId);
            const idx = list.findIndex(x => String(x._client_id || x.id) === String(clientId));
            if (idx >= 0) list.splice(idx, 1);
        }
        _getDisplayDocuments(shipment) { return (shipment?.documents || []).concat(this._getPendingDocuments(shipment?.id)); }

        async reloadProforma(options) {
            options = options || {};
            const preserve = options.preservePackingRows !== false;
            const rows = preserve ? { ...this.packingRows } : {};
            const setup = { ...this.packingSetupState };
            const collapse = { ...this.productCollapseState };

            const res = await jsonRpc("/supplier/api/v2/reload", { token: this.token });
            if (res.success && res.proforma) {
                this.proforma = this.normalizeProforma(res.proforma);
                if (preserve) {
                    this.packingRows = rows;
                    this.packingSetupState = setup;
                    this.productCollapseState = collapse;
                }
            }
            return res;
        }

        renderAll() {
            this._bound = false;
            this.render();
        }

        async saveGlobals() {
            try {
                const payload = this.getGlobalPayload();
                const res = await jsonRpc("/supplier/api/v2/save_globals", { token: this.token, globals_data: payload });
                if (!res.success) throw new Error(res.message || "No se pudo guardar.");
                Object.assign(this.proforma, payload);
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipments");
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async addShipment() {
            try {
                const res = await jsonRpc("/supplier/api/v2/create_shipment", { token: this.token, shipment_data: { shipment_type: "maritime", status: "draft" } });
                if (!res.success) throw new Error(res.message || "No se pudo crear el embarque.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipment", { shipmentId: res.shipment_id });
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async deleteShipment(shipmentId) {
            if (!confirm(this.t("msg_confirm_delete"))) return;
            try {
                const res = await jsonRpc("/supplier/api/v2/delete_shipment", { token: this.token, shipment_id: asInt(shipmentId) });
                if (!res.success) throw new Error(res.message || "No se pudo eliminar.");
                await this.reloadProforma({ preservePackingRows: false });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipments");
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async saveLogistics(shipmentId) {
            const wrap = document.querySelector(`[data-section="logistics"][data-shipment-id="${shipmentId}"]`);
            if (!wrap) return;
            const data = {};
            wrap.querySelectorAll("[data-field]").forEach(el => { data[el.dataset.field] = el.value || ""; });
            try {
                const res = await jsonRpc("/supplier/api/v2/update_shipment", { token: this.token, shipment_id: asInt(shipmentId), shipment_data: data });
                if (!res.success) throw new Error(res.message || "No se pudo guardar.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipment", { shipmentId, tab: "invoices" });
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        addInvoiceRow() {
            const list = document.getElementById("spm-invoice-list");
            if (!list) return;
            const idx = list.querySelectorAll(".spm-invoice-card").length;
            const empty = list.querySelector(".spm-card[style*='text-align:center']");
            if (empty) empty.remove();
            list.insertAdjacentHTML("beforeend", this.invoiceCard({ id: 0, invoice_number: "", invoice_date: "", amount: 0 }, idx));
        }

        async saveInvoices(shipmentId) {
            const rows = [...document.querySelectorAll(".spm-invoice-card")].map(card => ({
                id: asInt(card.dataset.invoiceId || 0),
                invoice_number: card.querySelector('[data-field="invoice_number"]')?.value || "",
                invoice_date: card.querySelector('[data-field="invoice_date"]')?.value || "",
                amount: parseFloat(card.querySelector('[data-field="amount"]')?.value || "0") || 0,
                currency_name: "USD",
                scope: "full_shipment",
                container_ids: [],
            }));
            try {
                const res = await jsonRpc("/supplier/api/v2/save_invoices", { token: this.token, shipment_id: asInt(shipmentId), invoices: rows });
                if (!res.success) throw new Error(res.message || "No se pudieron guardar invoices.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipment", { shipmentId, tab: "containers" });
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        addContainerRow() {
            const list = document.getElementById("spm-container-list");
            if (!list) return;
            const idx = list.querySelectorAll(".spm-container-card").length;
            const empty = list.querySelector(".spm-card[style*='text-align:center']");
            if (empty) empty.remove();
            list.insertAdjacentHTML("beforeend", this.containerCard({ id: 0, container_type: "40HQ" }, idx));
        }

        async saveContainers(shipmentId) {
            const rows = [...document.querySelectorAll(".spm-container-card")].map(card => ({
                id: asInt(card.dataset.containerId || 0),
                container_number: (card.querySelector('[data-field="container_number"]')?.value || "").toUpperCase(),
                seal_number: (card.querySelector('[data-field="seal_number"]')?.value || "").toUpperCase(),
                container_type: card.querySelector('[data-field="container_type"]')?.value || "40HQ",
                weight: parseFloat(card.querySelector('[data-field="weight"]')?.value || "0") || 0,
                volume: parseFloat(card.querySelector('[data-field="volume"]')?.value || "0") || 0,
                packages: parseInt(card.querySelector('[data-field="packages"]')?.value || "0", 10) || 0,
                notes: "",
            }));
            try {
                const res = await jsonRpc("/supplier/api/v2/save_containers", { token: this.token, shipment_id: asInt(shipmentId), containers: rows });
                if (!res.success) throw new Error(res.message || "No se pudieron guardar contenedores.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipment", { shipmentId, tab: "packings" });
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async addPacking(shipmentId) {
            try {
                const number = `PK-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
                const today = new Date().toISOString().slice(0, 10);
                const res = await jsonRpc("/supplier/api/v2/save_packing", {
                    token: this.token,
                    shipment_id: asInt(shipmentId),
                    packing_data: { packing_number: number, packing_date: today, scope: "full_shipment", container_ids: [] },
                    rows: [],
                });
                if (!res.success) throw new Error(res.message || "No se pudo crear el packing.");
                await this.reloadProforma({ preservePackingRows: false });
                this.toast(this.t("msg_saved"), "success");
                this.go("shipment", { shipmentId, tab: "packings" });
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        activatePackingAreas(shipmentId) {
            const ship = this.getShipment(shipmentId);
            if (!ship || typeof this.renderPackingRows !== "function") return;
            (this._getDisplayPackings(ship) || []).forEach(pk => {
                const area = document.getElementById(`pk-rows-${pk.id}`);
                if (area) {
                    area._portalEventsBound = false;
                    this.renderPackingRows(area, pk, ship);
                }
            });
        }

        openPackingSetup(shipmentId, packingId) {
            const ship = this.getShipment(shipmentId);
            const pk = (this._getDisplayPackings(ship) || []).find(p => Number(p.id) === Number(packingId));
            if (ship && pk && typeof this.openPackingSetupModal === "function") {
                this.openPackingSetupModal(pk, ship);
            }
        }

        async uploadDocument(shipmentId, docType, file) {
            if (!file) return;
            const pendingId = this.makeClientId("doc");
            this._addPendingDocument(shipmentId, {
                id: pendingId,
                _client_id: pendingId,
                _pending: true,
                document_type: docType,
                name: file.name,
                file_size: file.size,
                mime_type: file.type || "",
            });
            this.renderAll();

            try {
                const fileData = await readFileAsBase64(file);
                const res = await jsonRpc("/supplier/api/v2/upload_document", {
                    token: this.token,
                    shipment_id: asInt(shipmentId),
                    document_type: docType,
                    file_name: file.name,
                    file_data: fileData.data,
                    file_size: file.size || 0,
                    mime_type: file.type || "",
                    dpi_value: 0,
                    notes: "",
                });
                if (!res.success) throw new Error(res.message || "No se pudo subir el documento.");
                this._removePendingDocument(shipmentId, pendingId);
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.renderAll();
            } catch (err) {
                this._updatePendingDocument(shipmentId, pendingId, { _pending: false, _error: true, _error_message: err.message });
                this.toast(this.t("msg_error") + err.message, "error");
                this.renderAll();
            }
        }

        async deleteDocument(shipmentId, docId) {
            if (!confirm(this.t("msg_confirm_delete"))) return;
            try {
                const res = await jsonRpc("/supplier/api/v2/delete_document", { token: this.token, document_id: asInt(docId) });
                if (!res.success) throw new Error(res.message || "No se pudo eliminar el documento.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.renderAll();
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async completeProforma() {
            if (!confirm(this.t("msg_confirm_complete"))) return;
            try {
                const res = await jsonRpc("/supplier/api/v2/complete", { token: this.token });
                if (!res.success) throw new Error(res.message || "No se pudo completar.");
                await this.reloadProforma({ preservePackingRows: true });
                this.toast(this.t("msg_saved"), "success");
                this.renderAll();
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async uploadRowImage(serverRowId, localRowId, rowsKey, file, area) {
            if (!serverRowId) {
                this.toast(this.t("msg_photo_save_first"), "warning");
                return;
            }
            try {
                const fileData = await readFileAsBase64(file);
                const res = await jsonRpc("/supplier/api/v2/upload_row_image", {
                    token: this.token,
                    row_id: asInt(serverRowId),
                    image_data: fileData.data,
                    image_name: fileData.name,
                });
                if (!res.success) throw new Error(res.message || "No se pudo subir fotografía.");
                const row = (this.packingRows[rowsKey] || []).find(r => Number(r._id) === Number(localRowId));
                if (row) row.has_image = true;
                if (typeof this._updatePhotoCellInPlace === "function") {
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, true);
                }
                this.toast(this.t("msg_saved"), "success");
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        async deleteRowImage(serverRowId, localRowId, rowsKey, area) {
            if (!confirm(this.t("msg_confirm_delete_photo"))) return;
            try {
                const res = await jsonRpc("/supplier/api/v2/delete_row_image", {
                    token: this.token,
                    row_id: asInt(serverRowId),
                });
                if (!res.success) throw new Error(res.message || "No se pudo eliminar fotografía.");
                const row = (this.packingRows[rowsKey] || []).find(r => Number(r._id) === Number(localRowId));
                if (row) row.has_image = false;
                if (typeof this._updatePhotoCellInPlace === "function") {
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, false);
                }
                this.toast(this.t("msg_saved"), "success");
            } catch (err) {
                this.toast(this.t("msg_error") + err.message, "error");
            }
        }

        showOnboarding() {
            const existing = document.getElementById("spm-onboarding");
            if (existing) existing.remove();

            const el = document.createElement("div");
            el.id = "spm-onboarding";
            el.className = "spm-onboard-scrim show";
            el.innerHTML = `
                <div class="spm-onboard-card">
                    <div class="spm-modal-head">
                        <div><h2>Bienvenido al portal</h2><p>El llenado se organiza en datos generales, embarques, documentos y revisión final.</p></div>
                        <button class="spm-icon-btn" data-close-onboarding>${icon("x")}</button>
                    </div>
                    <div class="spm-modal-body">
                        <div class="spm-check-list">
                            <div class="spm-check-item"><span class="spm-check-icon done">${icon("check")}</span><div class="spm-check-body"><div class="title">Progreso visible</div><div class="desc">La barra lateral muestra qué falta por completar.</div></div></div>
                            <div class="spm-check-item"><span class="spm-check-icon partial">${icon("minus")}</span><div class="spm-check-body"><div class="title">Ayuda contextual</div><div class="desc">La guía derecha cambia según la sección actual.</div></div></div>
                            <div class="spm-check-item"><span class="spm-check-icon todo">${icon("plus")}</span><div class="spm-check-body"><div class="title">Packing asistido</div><div class="desc">Configura bloques y genera filas antes de capturar medidas.</div></div></div>
                        </div>
                    </div>
                    <div class="spm-modal-foot" style="justify-content:flex-end"><button class="spm-btn spm-btn-accent" data-close-onboarding>${icon("play")} Empezar</button></div>
                </div>`;
            document.body.appendChild(el);
            el.addEventListener("click", (e) => {
                if (e.target === el || e.target.closest("[data-close-onboarding]")) el.remove();
            });
        }

        toast(message, type) {
            let el = document.querySelector(".spm-toast");
            if (!el) {
                el = document.createElement("div");
                el.className = "spm-toast";
                document.body.appendChild(el);
            }
            el.className = `spm-toast ${type || "info"}`;
            el.textContent = message || "";
            requestAnimationFrame(() => el.classList.add("show"));
            setTimeout(() => el.classList.remove("show"), 3200);
        }
    }

    if (M.mixins && M.mixins.PackingRowsMixin) {
        Object.assign(ModernSupplierPortal.prototype, M.mixins.PackingRowsMixin);
    }

    M.ModernSupplierPortal = ModernSupplierPortal;
})();
