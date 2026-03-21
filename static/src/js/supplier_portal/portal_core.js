(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { T } = M.constants;
    const { jsonRpc, esc } = M.utils;

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.proforma = {};
            this.token = '';
            this.currentLang = localStorage.getItem('portal_lang') || 'es';
            this.expandedShipmentId = null;
            this.activeTabByShipment = {};
            this.packingRows = {};
            this.expandedPackingIds = new Set();
            this.nextRowId = 1;
            this._eventsBound = false;

            // NUEVO
            this.packingSetupState = {};
            this.productCollapseState = {};
            this.autoOpenPackingSetupId = null;

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        t(key) {
            return (T[this.currentLang] || T.en)[key] || key;
        }

        init() {
            try {
                console.log("[Portal] Modular Supplier Portal Loaded.");

                const langSel = document.getElementById('lang-selector');
                if (langSel) {
                    langSel.value = this.currentLang;
                    langSel.addEventListener('change', e => {
                        this.currentLang = e.target.value;
                        localStorage.setItem('portal_lang', this.currentLang);
                        this.updateStaticI18n();
                        this.renderAll();
                    });
                }

                const el = document.getElementById('portal-data-store');
                if (!el) throw new Error('No payload element #portal-data-store');

                this.data = JSON.parse(el.dataset.payload || '{}');
                this.token = this.data.token || '';
                this.products = this.data.products || [];
                this.proforma = this.data.proforma || {};

                this.updateStaticI18n();
                this.fillHeaderInfo();
                this.fillGlobalsForm();
                this.bindGlobalEvents();
                this.renderAll();
            } catch (err) {
                console.error("[Portal] init() ERROR:", err);
                if (!this._eventsBound) {
                    try {
                        this.bindGlobalEvents();
                    } catch (_e) {}
                }
                const c = document.getElementById('shipments-container');
                if (c) {
                    c.innerHTML = `<div class="empty-state"><p style="color:red">${esc(err.message)}</p></div>`;
                }
            }
        }

        updateStaticI18n() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const k = el.dataset.i18n;
                if (k) el.innerText = this.t(k);
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const k = el.dataset.i18nPlaceholder;
                if (k) el.placeholder = this.t(k);
            });
        }

        fillHeaderInfo() {
            const setTxt = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || '-';
            };

            setTxt('portal-po-name', this.data.po_name || this.data.poName || '');
            setTxt('portal-picking-name', this.data.picking_name || this.data.pickingName || '');
            setTxt('portal-vendor-name', this.data.vendor_name || this.data.partner_name || this.t('header_provider'));
        }

        fillGlobalsForm() {
            const p = this.proforma || {};
            const map = {
                'g-proforma-number': 'proforma_number',
                'g-invoice-global': 'invoice_global_number',
                'g-payment-terms': 'payment_terms',
                'g-country-origin': 'country_origin',
                'g-incoterm': 'incoterm',
                'g-general-notes': 'general_notes',
            };

            for (const [domId, key] of Object.entries(map)) {
                const el = document.getElementById(domId);
                if (el) el.value = p[key] || '';
            }

            this.updateStatusBadge();
        }

        getGlobalsFromForm() {
            return {
                proforma_number: document.getElementById('g-proforma-number')?.value || '',
                invoice_global_number: document.getElementById('g-invoice-global')?.value || '',
                payment_terms: document.getElementById('g-payment-terms')?.value || '',
                country_origin: document.getElementById('g-country-origin')?.value || '',
                incoterm: document.getElementById('g-incoterm')?.value || '',
                general_notes: document.getElementById('g-general-notes')?.value || '',
            };
        }

        updateStatusBadge() {
            const badge = document.getElementById('proforma-status-badge');
            if (!badge) return;

            const st = this.proforma.status || 'draft';
            badge.className = `badge-status status-${st}`;
            badge.textContent = st.charAt(0).toUpperCase() + st.slice(1);
        }

        async saveGlobals() {
            const btn = document.getElementById('btn-save-globals');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
            }

            try {
                const payload = this.getGlobalsFromForm();
                const res = await jsonRpc('/supplier/api/v2/save_globals', {
                    token: this.token,
                    globals_data: payload,
                });

                if (res.success) {
                    this.toast(this.t('msg_saved'), 'success');
                    Object.assign(this.proforma, payload);
                    await this.reloadProforma();
                    this.renderAll();
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }

            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa fa-save me-2"></i> ${this.t('btn_save_globals')}`;
            }
        }

        renderAll() {
            this.renderProgressBar();
            this.renderShipments();
            this.updateFooterTotals();
            this.updateStatusBadge();
        }

        renderShipments() {
            const container = document.getElementById('shipments-container');
            if (!container) return;

            const countBadge = document.getElementById('shipment-count-badge');
            const shipments = this.proforma.shipments || [];

            if (countBadge) countBadge.textContent = shipments.length;

            if (shipments.length === 0) {
                container.innerHTML = '';
                container.appendChild(this.createEmptyState());
                return;
            }

            const es = container.querySelector('.empty-state');
            if (es) es.remove();

            const existingIds = new Set();

            shipments.forEach(s => {
                existingIds.add(s.id);
                let block = container.querySelector(`.shipment-block[data-shipment-id="${s.id}"]`);
                if (!block) {
                    block = this.createShipmentBlock(s);
                    container.appendChild(block);
                } else {
                    this.updateShipmentBlockHeader(block, s);
                }

                if (this.expandedShipmentId === s.id) {
                    block.classList.add('expanded');
                    const body = block.querySelector('.shipment-block-body');
                    body.style.display = 'block';
                    this.renderShipmentBody(body, s);
                }
            });

            container.querySelectorAll('.shipment-block').forEach(b => {
                const id = parseInt(b.dataset.shipmentId, 10);
                if (!existingIds.has(id)) b.remove();
            });
        }

        createEmptyState() {
            const d = document.createElement('div');
            d.className = 'empty-state';
            d.innerHTML = `<i class="fa fa-inbox fa-3x"></i><p>${this.t('msg_no_shipments')}</p>`;
            return d;
        }

        createShipmentBlock(s) {
            const block = document.createElement('div');
            block.className = 'shipment-block';
            block.dataset.shipmentId = s.id;

            const shipDocs = s.documents || [];
            const requiredTypes = ['bl', 'invoice', 'packing_list'];
            const hasMissing = requiredTypes.some(rt => !shipDocs.find(d => d.document_type === rt));
            const docIndicator = hasMissing
                ? '<span class="chip" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;"><i class="fa fa-exclamation-triangle"></i> docs</span>'
                : '<span class="chip" style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;"><i class="fa fa-check"></i> docs</span>';

            block.innerHTML = `
                <div class="shipment-block-header">
                    <div class="shipment-block-title">
                        <span class="shipment-name">${esc(s.name)}</span>
                        <span class="shipment-status-pill st-${s.status || 'draft'}">${this.t('st_' + (s.status || 'draft'))}</span>
                        <span class="shipment-summary-chips">
                            <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                            <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                            <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>
                            ${docIndicator}
                        </span>
                    </div>
                    <div class="shipment-block-actions">
                        <button type="button" class="btn-toggle-shipment" title="Expand/Collapse">
                            <i class="fa fa-chevron-down"></i>
                        </button>
                        <button type="button" class="btn-delete-shipment" title="Delete">
                            <i class="fa fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="shipment-block-body" style="display:none;"></div>`;

            block.querySelector('.btn-toggle-shipment')
                .addEventListener('click', e => {
                    e.stopPropagation();
                    this.toggleShipment(s.id);
                });

            block.querySelector('.shipment-block-header')
                .addEventListener('click', () => this.toggleShipment(s.id));

            block.querySelector('.btn-delete-shipment')
                .addEventListener('click', e => {
                    e.stopPropagation();
                    this.deleteShipment(s.id);
                });

            return block;
        }

        updateShipmentBlockHeader(block, s) {
            block.querySelector('.shipment-name').textContent = s.name;

            const pill = block.querySelector('.shipment-status-pill');
            pill.className = `shipment-status-pill st-${s.status || 'draft'}`;
            pill.textContent = this.t('st_' + (s.status || 'draft'));

            const shipDocs = s.documents || [];
            const requiredTypes = ['bl', 'invoice', 'packing_list'];
            const hasMissing = requiredTypes.some(rt => !shipDocs.find(d => d.document_type === rt));
            const docIndicator = hasMissing
                ? '<span class="chip" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;"><i class="fa fa-exclamation-triangle"></i> docs</span>'
                : '<span class="chip" style="background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;"><i class="fa fa-check"></i> docs</span>';

            const chips = block.querySelector('.shipment-summary-chips');
            chips.innerHTML = `
                <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>
                ${docIndicator}`;
        }

        toggleShipment(shipmentId) {
            const container = document.getElementById('shipments-container');
            if (!container) return;

            const wasExpanded = this.expandedShipmentId === shipmentId;

            container.querySelectorAll('.shipment-block').forEach(b => {
                b.classList.remove('expanded');
                b.querySelector('.shipment-block-body').style.display = 'none';
            });

            if (wasExpanded) {
                this.expandedShipmentId = null;
                return;
            }

            this.expandedShipmentId = shipmentId;
            const block = container.querySelector(`.shipment-block[data-shipment-id="${shipmentId}"]`);
            if (!block) return;

            block.classList.add('expanded');
            const body = block.querySelector('.shipment-block-body');
            body.style.display = 'block';

            const s = (this.proforma.shipments || []).find(x => x.id === shipmentId);
            if (s) this.renderShipmentBody(body, s);

            block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        async addShipment() {
            try {
                const res = await jsonRpc('/supplier/api/v2/create_shipment', { token: this.token });
                if (res.success) {
                    await this.reloadProforma();
                    this.expandedShipmentId = res.shipment_id;
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        async deleteShipment(shipmentId) {
            if (!confirm(this.t('msg_confirm_delete'))) return;

            try {
                const res = await jsonRpc('/supplier/api/v2/delete_shipment', {
                    token: this.token,
                    shipment_id: shipmentId,
                });

                if (!res.success) {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                    return;
                }

                if (this.expandedShipmentId === shipmentId) {
                    this.expandedShipmentId = null;
                }

                await this.reloadProforma();
                this.renderAll();
                this.toast(this.t('msg_saved'), 'success');
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        async reloadProforma() {
            try {
                const res = await jsonRpc('/supplier/api/v2/reload', { token: this.token });
                if (res.success && res.proforma) {
                    this.proforma = res.proforma;
                    this.packingRows = {};
                }
            } catch (e) {
                console.error('[Portal] reloadProforma ERROR:', e.message);
            }
        }

        updateFooterTotals() {
            const shipments = this.proforma.shipments || [];
            let totalContainers = 0;
            let totalInvoices = 0;

            shipments.forEach(s => {
                totalContainers += (s.containers || []).length;
                totalInvoices += (s.invoices || []).length;
            });

            const setEl = (id, val) => {
                const e = document.getElementById(id);
                if (e) e.textContent = val;
            };

            setEl('total-shipments', shipments.length);
            setEl('total-containers', totalContainers);
            setEl('total-invoices', totalInvoices);

            const btn = document.getElementById('btn-complete-proforma');
            if (btn) btn.disabled = shipments.length === 0;
        }

        async completeProforma() {
            if (!confirm(this.t('msg_confirm_complete'))) return;

            try {
                const res = await jsonRpc('/supplier/api/v2/complete', { token: this.token });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        bindGlobalEvents() {
            if (this._eventsBound) return;
            this._eventsBound = true;

            const btnSaveGlobals = document.getElementById('btn-save-globals');
            const btnAddShipment = document.getElementById('btn-add-shipment');
            const btnComplete = document.getElementById('btn-complete-proforma');

            if (btnSaveGlobals) {
                const parentForm = btnSaveGlobals.closest('form');
                if (parentForm) {
                    parentForm.addEventListener('submit', e => e.preventDefault());
                }
                btnSaveGlobals.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.saveGlobals();
                });
            }

            if (btnAddShipment) {
                const parentForm = btnAddShipment.closest('form');
                if (parentForm) {
                    parentForm.addEventListener('submit', e => e.preventDefault());
                }
                btnAddShipment.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.addShipment();
                });
            }

            if (btnComplete) {
                btnComplete.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.completeProforma();
                });
            }
        }

        toast(msg, type = 'info') {
            let toastEl = document.querySelector('.portal-toast');
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.className = 'portal-toast';
                document.body.appendChild(toastEl);
            }

            toastEl.className = `portal-toast toast-${type}`;
            toastEl.textContent = msg;

            requestAnimationFrame(() => {
                toastEl.classList.add('show');
            });

            setTimeout(() => {
                toastEl.classList.remove('show');
            }, 3000);
        }
    }

    Object.assign(
        SupplierPortal.prototype,
        M.mixins.PackingRowsMixin,
        M.mixins.DocumentsMixin,
        M.mixins.ShipmentTabsMixin
    );

    M.SupplierPortal = SupplierPortal;
})();