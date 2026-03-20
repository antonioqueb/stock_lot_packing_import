// shipment_tabs.js
(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { jsonRpc, esc, asInt, readFileAsBase64 } = M.utils;

    const CURRENCY_CODES = ['USD', 'EUR', 'CNY', 'MXN', 'GBP', 'JPY', 'INR', 'BRL', 'KRW', 'AUD', 'CAD', 'CHF'];

    // =========================================================================
    //  HELPERS DE UI
    // =========================================================================

    function makeAutosaveBar(lang) {
        const label = lang === 'es' ? 'Guardado automático'
                    : lang === 'zh' ? '自动保存'
                    : 'Autosave';
        return `<div class="autosave-bar">
            <span class="autosave-label"><i class="fa fa-magic"></i> ${label}</span>
            <span class="autosave-indicator"></span>
        </div>`;
    }

    function modernDate(attrs, value) {
        return `<div class="modern-date-wrapper">
            <input type="date" ${attrs} value="${esc(value || '')}" class="modern-date-input"/>
            <i class="fa fa-calendar modern-date-icon"></i>
        </div>`;
    }

    // =========================================================================
    //  MIXIN
    // =========================================================================

    M.mixins.ShipmentTabsMixin = {

        // ------------------------------------------------------------------
        //  MOTOR DE AUTOSAVE GENÉRICO
        //  Recibe: el contenedor DOM, función async saveFn(), delay en ms
        //  saveFn debe retornar { success, message? }
        // ------------------------------------------------------------------
        _bindAutosave(el, saveFn, delay) {
            delay = delay || 900;
            const indicator = el.querySelector('.autosave-indicator');
            let timer = null;

            const trigger = () => {
                if (timer) clearTimeout(timer);
                timer = setTimeout(async () => {
                    if (indicator) {
                        indicator.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
                        indicator.style.color = '#888';
                    }
                    try {
                        const res = await saveFn();
                        if (res && res.success === false) throw new Error(res.message || 'Error');
                        if (indicator) {
                            indicator.innerHTML = '<i class="fa fa-check"></i> Guardado';
                            indicator.style.color = '#16a34a';
                            setTimeout(() => { if (indicator) indicator.innerHTML = ''; }, 2500);
                        }
                    } catch (err) {
                        if (indicator) {
                            indicator.innerHTML = '<i class="fa fa-exclamation-triangle"></i> ' + (err.message || 'Error');
                            indicator.style.color = '#dc2626';
                        }
                    }
                }, delay);
            };

            el.querySelectorAll('input, select, textarea').forEach(function (input) {
                var evt = (input.tagName === 'SELECT' || input.type === 'date' || input.type === 'checkbox')
                    ? 'change' : 'input';
                input.addEventListener(evt, trigger);
            });
        },

        // ------------------------------------------------------------------
        //  SHELL DE PESTAÑAS
        // ------------------------------------------------------------------

        renderShipmentBody(bodyEl, s) {
            var activeTab = this.activeTabByShipment[s.id] || 'logistics';
            var tabOrder = ['logistics', 'bl', 'containers', 'invoices', 'packings', 'documents'];
            var tabIcons = {
                logistics: 'fa-truck', bl: 'fa-file-text', containers: 'fa-cube',
                invoices: 'fa-file-invoice-dollar', packings: 'fa-boxes', documents: 'fa-folder-open',
            };
            var tabLabels = {
                logistics: this.t('tab_logistics'), bl: this.t('tab_bl'),
                containers: this.t('tab_containers'), invoices: this.t('tab_invoices'),
                packings: this.t('tab_packings'), documents: this.t('tab_documents') || 'Documentos',
            };

            var shipDocs = s.documents || [];
            var tabCounts = {
                containers: (s.containers || []).length,
                invoices: (s.invoices || []).length,
                packings: (s.packings || []).length,
                documents: shipDocs.length,
            };

            var tabsHtml = '<div class="shipment-tabs">';
            var contentHtml = '';

            for (var i = 0; i < tabOrder.length; i++) {
                var name = tabOrder[i];
                var isActive = activeTab === name;
                var countHtml = tabCounts[name] !== undefined
                    ? '<span class="tab-count">' + tabCounts[name] + '</span>' : '';
                var extraClass = '';
                if (name === 'documents') {
                    var req = ['bl', 'invoice', 'packing_list'];
                    for (var ri = 0; ri < req.length; ri++) {
                        if (!shipDocs.find(function (d) { return d.document_type === req[ri]; })) {
                            extraClass = ' tab-warning'; break;
                        }
                    }
                }
                tabsHtml += '<div class="shipment-tab ' + (isActive ? 'active' : '') + extraClass + '" data-tab="' + name + '">'
                    + '<i class="fa ' + tabIcons[name] + '"></i> ' + tabLabels[name] + ' ' + countHtml + '</div>';
                contentHtml += '<div id="stab-' + name + '-' + s.id + '" class="shipment-tab-content ' + (isActive ? 'active' : '') + '"></div>';
            }
            tabsHtml += '</div>';
            bodyEl.innerHTML = tabsHtml + contentHtml;

            var self = this;
            bodyEl.querySelectorAll('.shipment-tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    var tname = tab.dataset.tab;
                    self.activeTabByShipment[s.id] = tname;
                    bodyEl.querySelectorAll('.shipment-tab').forEach(function (t) {
                        t.classList.toggle('active', t.dataset.tab === tname);
                    });
                    bodyEl.querySelectorAll('.shipment-tab-content').forEach(function (c) {
                        c.classList.toggle('active', c.id === 'stab-' + tname + '-' + s.id);
                    });
                    self.renderTabContent(tname, s);
                });
            });

            this.renderTabContent(activeTab, s);
        },

        renderTabContent(tabName, s) {
            var el = document.getElementById('stab-' + tabName + '-' + s.id);
            if (!el) return;
            switch (tabName) {
                case 'logistics':  this.renderLogisticsTab(el, s); break;
                case 'bl':         this.renderBLTab(el, s); break;
                case 'invoices':   this.renderInvoicesTab(el, s); break;
                case 'packings':   this.renderPackingsTab(el, s); break;
                case 'containers': this.renderContainersTab(el, s); break;
                case 'documents':  this.renderDocumentsTab(el, s); break;
            }
        },

        // ------------------------------------------------------------------
        //  SYNC DOM → MEMORY
        // ------------------------------------------------------------------

        _syncContainersFromDOM(s) {
            var el = document.getElementById('stab-containers-' + s.id);
            if (!el) return;
            (s.containers || []).forEach(function (c, idx) {
                el.querySelectorAll('[data-cnt-idx="' + idx + '"]').forEach(function (input) {
                    var f = input.dataset.cntF;
                    if (!f) return;
                    c[f] = ['weight','volume'].includes(f) ? (parseFloat(input.value)||0)
                          : f === 'packages' ? (parseInt(input.value,10)||0)
                          : (input.value||'');
                });
            });
        },

        _syncInvoicesFromDOM(s) {
            var el = document.getElementById('stab-invoices-' + s.id);
            if (!el) return;
            (s.invoices || []).forEach(function (inv, idx) {
                el.querySelectorAll('[data-inv-idx="' + idx + '"]').forEach(function (input) {
                    var f = input.dataset.invF;
                    if (!f) return;
                    inv[f] = f === 'amount' ? (parseFloat(input.value)||0) : (input.value||'');
                });
            });
        },

        _syncPackingsFromDOM(s) {
            var el = document.getElementById('stab-packings-' + s.id);
            if (!el) return;
            (s.packings || []).forEach(function (pk) {
                el.querySelectorAll('[data-pk-id="' + pk.id + '"][data-pk-f]').forEach(function (input) {
                    var f = input.dataset.pkF;
                    if (f) pk[f] = input.value || '';
                });
            });
        },

        // ------------------------------------------------------------------
        //  LOGISTICS TAB — autosave, modern dates, sin botón guardar
        // ------------------------------------------------------------------

        renderLogisticsTab(el, s) {
            var typeOpts = ['maritime', 'air', 'land'].map(function (v) {
                return '<option value="' + v + '" ' + (s.shipment_type === v ? 'selected' : '') + '>' + this.t('opt_' + v) + '</option>';
            }, this).join('');

            el.innerHTML = makeAutosaveBar(this.currentLang) + `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_shipment_type')}</label>
                        <select data-sf="shipment_type">
                            <option value="">${this.t('opt_select')}</option>
                            ${typeOpts}
                        </select>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_shipping_line')}</label>
                        <input type="text" data-sf="shipping_line" value="${esc(s.shipping_line)}" placeholder="Ej. MAERSK"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_vessel')}</label>
                        <input type="text" data-sf="vessel_name" value="${esc(s.vessel_name)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_etd')}</label>
                        ${modernDate('data-sf="etd"', s.etd)}
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_eta')}</label>
                        ${modernDate('data-sf="eta"', s.eta)}
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_origin')}</label>
                        <input type="text" data-sf="port_origin" value="${esc(s.port_origin)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_dest')}</label>
                        <input type="text" data-sf="port_destination" value="${esc(s.port_destination)}"/>
                    </div>
                    <div class="sf-field sf-wide">
                        <label>${this.t('lbl_notes')}</label>
                        <textarea data-sf="notes" rows="2">${esc(s.notes)}</textarea>
                    </div>
                </div>`;

            var self = this;
            this._bindAutosave(el, function () {
                var data = {};
                el.querySelectorAll('[data-sf]').forEach(function (i) { data[i.dataset.sf] = i.value; });
                return jsonRpc('/supplier/api/v2/update_shipment', {
                    token: self.token, shipment_id: s.id, shipment_data: data,
                });
            });
        },

        // ------------------------------------------------------------------
        //  B/L TAB — solo número y fecha, sin upload, autosave
        // ------------------------------------------------------------------

        renderBLTab(el, s) {
            var infoMsg = this.currentLang === 'es'
                ? 'El archivo B/L se sube en la pestaña <strong>Documentos</strong>.'
                : this.currentLang === 'zh'
                ? '提单文件请在<strong>文件</strong>标签页上传。'
                : 'Upload the B/L file in the <strong>Documents</strong> tab.';

            el.innerHTML = makeAutosaveBar(this.currentLang) + `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_number')}</label>
                        <input type="text" data-sf="bl_number" value="${esc(s.bl_number)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_date')}</label>
                        ${modernDate('data-sf="bl_date"', s.bl_date)}
                    </div>
                </div>
                <div class="info-hint">
                    <i class="fa fa-info-circle"></i> ${infoMsg}
                </div>`;

            var self = this;
            this._bindAutosave(el, function () {
                var data = {};
                el.querySelectorAll('[data-sf]').forEach(function (i) {
                    data[i.dataset.sf] = i.value || false;
                });
                return jsonRpc('/supplier/api/v2/update_shipment', {
                    token: self.token, shipment_id: s.id, shipment_data: data,
                });
            });
        },

        // ------------------------------------------------------------------
        //  INVOICES TAB — con divisa, autosave
        // ------------------------------------------------------------------

        renderInvoicesTab(el, s) {
            var invoices = s.invoices || [];
            var self = this;

            var html = '';
            invoices.forEach(function (inv, idx) {
                var selCur = inv.currency_name || 'USD';
                var currencySelHtml = CURRENCY_CODES.map(function (c) {
                    return '<option value="' + c + '" ' + (selCur === c ? 'selected' : '') + '>' + c + '</option>';
                }).join('');

                html += `<div class="sub-item-card">
                    <div class="sub-item-header">
                        <span class="sub-item-title">Invoice #${idx + 1}</span>
                        <div class="sub-item-actions">
                            <button type="button" class="btn-remove-inv" data-idx="${idx}">
                                <i class="fa fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="sub-item-grid">
                        <div class="sub-item-field">
                            <label>${self.t('lbl_inv_number')}</label>
                            <input type="text" data-inv-idx="${idx}" data-inv-f="invoice_number" value="${esc(inv.invoice_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_inv_date')}</label>
                            ${modernDate('data-inv-idx="' + idx + '" data-inv-f="invoice_date"', inv.invoice_date)}
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_inv_amount')}</label>
                            <div style="display:flex;gap:6px;">
                                <select data-inv-idx="${idx}" data-inv-f="currency_name" style="width:88px;flex-shrink:0;">${currencySelHtml}</select>
                                <input type="number" step="0.01" data-inv-idx="${idx}" data-inv-f="amount" value="${inv.amount || 0}" style="flex:1;"/>
                            </div>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_inv_scope')}</label>
                            <select data-inv-idx="${idx}" data-inv-f="scope">
                                <option value="full_shipment" ${inv.scope === 'full_shipment' ? 'selected' : ''}>${self.t('scope_full')}</option>
                                <option value="specific_containers" ${inv.scope === 'specific_containers' ? 'selected' : ''}>${self.t('scope_specific')}</option>
                            </select>
                        </div>
                    </div>
                </div>`;
            });

            html += '<button type="button" class="btn-add-sub-item btn-add-inv">' + this.t('btn_add_invoice') + '</button>';
            html += makeAutosaveBar(this.currentLang);
            el.innerHTML = html;

            var buildPayload = function () {
                return (s.invoices || []).map(function (inv, idx) {
                    var data = { id: inv.id || 0 };
                    el.querySelectorAll('[data-inv-idx="' + idx + '"]').forEach(function (input) {
                        data[input.dataset.invF] = input.value;
                    });
                    data.amount = parseFloat(data.amount) || 0;
                    return data;
                });
            };

            var doSave = function () {
                return jsonRpc('/supplier/api/v2/save_invoices', {
                    token: self.token, shipment_id: s.id, invoices: buildPayload(),
                });
            };

            this._bindAutosave(el, doSave, 1200);

            el.querySelector('.btn-add-inv').addEventListener('click', function () {
                self._syncInvoicesFromDOM(s);
                s.invoices = s.invoices || [];
                s.invoices.push({ id: 0, invoice_number: '', invoice_date: '',
                    amount: 0, currency_name: 'USD', scope: 'full_shipment', container_ids: [] });
                self.renderTabContent('invoices', s);
            });

            el.querySelectorAll('.btn-remove-inv').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    self._syncInvoicesFromDOM(s);
                    s.invoices.splice(parseInt(btn.dataset.idx, 10), 1);
                    try {
                        await jsonRpc('/supplier/api/v2/save_invoices', {
                            token: self.token, shipment_id: s.id, invoices: buildPayload(),
                        });
                        await self.reloadProforma();
                        self.renderAll();
                        self.toast(self.t('msg_saved'), 'success');
                    } catch (e) {
                        self.toast(self.t('msg_error') + e.message, 'error');
                    }
                });
            });
        },

        // ------------------------------------------------------------------
        //  CONTAINERS TAB — autosave
        // ------------------------------------------------------------------

        renderContainersTab(el, s) {
            var containers = s.containers || [];
            var self = this;
            var html = '';

            containers.forEach(function (c, idx) {
                html += `<div class="sub-item-card">
                    <div class="sub-item-header">
                        <span class="sub-item-title">${esc(c.container_number) || 'Container #' + (idx + 1)}</span>
                        <div class="sub-item-actions">
                            <button type="button" class="btn-remove-cnt" data-idx="${idx}">
                                <i class="fa fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="sub-item-grid">
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_number')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="container_number" value="${esc(c.container_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_seal')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="seal_number" value="${esc(c.seal_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_type')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="container_type" value="${esc(c.container_type)}" placeholder="40HC, 20GP"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_weight')}</label>
                            <input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="weight" value="${c.weight || 0}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_volume')}</label>
                            <input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="volume" value="${c.volume || 0}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${self.t('lbl_cont_packages')}</label>
                            <input type="number" data-cnt-idx="${idx}" data-cnt-f="packages" value="${c.packages || 0}"/>
                        </div>
                    </div>
                </div>`;
            });

            html += '<button type="button" class="btn-add-sub-item btn-add-cnt">' + this.t('btn_add_container') + '</button>';
            html += makeAutosaveBar(this.currentLang);
            el.innerHTML = html;

            var buildPayload = function () {
                return (s.containers || []).map(function (c, idx) {
                    var data = { id: c.id || 0 };
                    el.querySelectorAll('[data-cnt-idx="' + idx + '"]').forEach(function (input) {
                        data[input.dataset.cntF] = input.value;
                    });
                    data.weight = parseFloat(data.weight) || 0;
                    data.volume = parseFloat(data.volume) || 0;
                    data.packages = parseInt(data.packages, 10) || 0;
                    return data;
                });
            };

            var doSave = function () {
                return jsonRpc('/supplier/api/v2/save_containers', {
                    token: self.token, shipment_id: s.id, containers: buildPayload(),
                });
            };

            this._bindAutosave(el, doSave, 1200);

            el.querySelector('.btn-add-cnt').addEventListener('click', function () {
                self._syncContainersFromDOM(s);
                s.containers = s.containers || [];
                s.containers.push({ id: 0, container_number: '', seal_number: '',
                    container_type: '', weight: 0, volume: 0, packages: 0 });
                self.renderTabContent('containers', s);
            });

            el.querySelectorAll('.btn-remove-cnt').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    self._syncContainersFromDOM(s);
                    s.containers.splice(parseInt(btn.dataset.idx, 10), 1);
                    try {
                        await jsonRpc('/supplier/api/v2/save_containers', {
                            token: self.token, shipment_id: s.id, containers: buildPayload(),
                        });
                        await self.reloadProforma();
                        self.renderAll();
                        self.toast(self.t('msg_saved'), 'success');
                    } catch (e) {
                        self.toast(self.t('msg_error') + e.message, 'error');
                    }
                });
            });
        },

        // ------------------------------------------------------------------
        //  PACKINGS TAB
        //  - Número/fecha: autosave
        //  - Filas: botón guardar explícito (son muchas y complejas)
        // ------------------------------------------------------------------

        renderPackingsTab(el, s) {
            var packings = s.packings || [];
            var self = this;
            var html = '';
            packings.forEach(function (pk, idx) { html += self._packingCard(pk, idx, s); });
            html += '<button type="button" class="btn-add-sub-item btn-add-pk">' + this.t('btn_add_packing') + '</button>';
            el.innerHTML = html;

            el.querySelector('.btn-add-pk').addEventListener('click', function () {
                self._syncPackingsFromDOM(s);
                self.createPacking(s);
            });

            el.querySelectorAll('.btn-delete-pk').forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    if (!confirm(self.t('msg_confirm_delete'))) return;
                    try {
                        await jsonRpc('/supplier/api/v2/delete_packing', {
                            token: self.token, packing_id: parseInt(btn.dataset.pkId, 10),
                        });
                        await self.reloadProforma();
                        self.renderAll();
                        self.toast(self.t('msg_saved'), 'success');
                    } catch (e) {
                        self.toast(self.t('msg_error') + e.message, 'error');
                    }
                });
            });

            // Autosave per-packing para número y fecha
            packings.forEach(function (pk) {
                var pkCard = el.querySelector('.packing-card[data-packing-id="' + pk.id + '"]');
                if (!pkCard) return;

                var indicator = pkCard.querySelector('.pk-autosave-indicator');
                var timer = null;

                var doSaveMeta = function () {
                    var pkData = { id: pk.id };
                    pkCard.querySelectorAll('[data-pk-id="' + pk.id + '"][data-pk-f]').forEach(function (input) {
                        pkData[input.dataset.pkF] = input.value;
                    });
                    return jsonRpc('/supplier/api/v2/save_packing', {
                        token: self.token, shipment_id: s.id,
                        packing_data: pkData, rows: null,
                    });
                };

                pkCard.querySelectorAll('[data-pk-id="' + pk.id + '"][data-pk-f]').forEach(function (input) {
                    var evt = input.type === 'date' ? 'change' : 'input';
                    input.addEventListener(evt, function () {
                        if (timer) clearTimeout(timer);
                        timer = setTimeout(async function () {
                            if (indicator) {
                                indicator.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
                                indicator.style.color = '#888';
                            }
                            try {
                                var res = await doSaveMeta();
                                if (res && res.success === false) throw new Error(res.message);
                                if (indicator) {
                                    indicator.innerHTML = '<i class="fa fa-check"></i>';
                                    indicator.style.color = '#16a34a';
                                    setTimeout(function () { if (indicator) indicator.innerHTML = ''; }, 2000);
                                }
                            } catch (err) {
                                if (indicator) {
                                    indicator.innerHTML = '<i class="fa fa-exclamation-triangle"></i>';
                                    indicator.style.color = '#dc2626';
                                }
                            }
                        }, 900);
                    });
                });

                // Botón guardar filas
                var btnSavePk = pkCard.querySelector('.btn-save-pk');
                if (btnSavePk) {
                    btnSavePk.addEventListener('click', function () {
                        self.savePacking(
                            parseInt(btnSavePk.dataset.pkId, 10),
                            parseInt(btnSavePk.dataset.sid, 10),
                            el
                        );
                    });
                }
            });

            packings.forEach(function (pk) {
                var area = document.getElementById('pk-rows-' + pk.id);
                if (area) self.renderPackingRows(area, pk, s);
            });
        },

        _packingCard(pk, idx, s) {
            var rowCount = (pk.rows || []).length;
            return `<div class="sub-item-card packing-card" data-packing-id="${pk.id}">
                <div class="sub-item-header">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span class="sub-item-title">
                            ${esc(pk.packing_number) || 'Packing #' + (idx + 1)}
                            <small class="text-muted">(${rowCount} rows)</small>
                        </span>
                        <span class="pk-autosave-indicator" style="font-size:0.74rem;"></span>
                    </div>
                    <div class="sub-item-actions">
                        <button type="button" class="btn-delete-pk" data-pk-id="${pk.id}">
                            <i class="fa fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="sub-item-grid">
                    <div class="sub-item-field">
                        <label>${this.t('lbl_pk_number')}</label>
                        <input type="text" data-pk-id="${pk.id}" data-pk-f="packing_number" value="${esc(pk.packing_number)}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_pk_date')}</label>
                        ${modernDate('data-pk-id="' + pk.id + '" data-pk-f="packing_date"', pk.packing_date)}
                    </div>
                </div>
                <div class="packing-rows-area" id="pk-rows-${pk.id}"></div>
                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section btn-save-pk" data-pk-id="${pk.id}" data-sid="${s.id}" style="font-size:0.8rem;padding:6px 16px;">
                        <i class="fa fa-save me-1"></i> ${this.t('btn_save_packing')}
                    </button>
                </div>
            </div>`;
        },

        async createPacking(s) {
            try {
                var res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token, shipment_id: s.id,
                    packing_data: { packing_number: '', scope: 'full_shipment' }, rows: [],
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },

        async savePacking(packingId, shipmentId, formEl) {
            var pkData = { id: packingId };
            formEl.querySelectorAll('[data-pk-id="' + packingId + '"][data-pk-f]').forEach(function (input) {
                pkData[input.dataset.pkF] = input.value;
            });

            var rowsKey = 'pk_' + packingId;
            var rows = this.packingRows[rowsKey] || [];

            var usedContainerIds = [...new Set(rows.map(r => asInt(r.container_id)).filter(Boolean))];
            pkData.scope = usedContainerIds.length > 0 ? 'specific_containers' : 'full_shipment';
            pkData.container_ids = usedContainerIds;

            var rowsPayload = rows.filter(function (r) {
                if (r.tipo === 'Placa') return (r.alto > 0 && r.ancho > 0) || r.ref_proveedor || r.numero_placa || r.bloque;
                return (r.quantity > 0) || r.ref_proveedor || r.color;
            }).map(function (r) {
                return {
                    id: r.id || 0, product_id: r.product_id,
                    container_id: asInt(r.container_id || 0), tipo: r.tipo,
                    grosor: r.grosor || '', alto: r.alto || 0, ancho: r.ancho || 0,
                    peso: r.peso || 0, quantity: r.quantity || 0,
                    bloque: r.bloque || '', numero_placa: r.numero_placa || '',
                    atado: r.atado || '', color: r.color || '',
                    grupo_name: r.grupo_name || '', pedimento: r.pedimento || '',
                    ref_proveedor: r.ref_proveedor || '',
                };
            });

            try {
                var res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token, shipment_id: shipmentId,
                    packing_data: pkData,
                    rows: rowsPayload.length > 0 ? rowsPayload : [],
                });
                if (res.success) {
                    delete this.packingRows[rowsKey];
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },

        // ------------------------------------------------------------------
        //  PHOTO UPLOAD / DELETE
        // ------------------------------------------------------------------

        async uploadRowImage(serverRowId, localRowId, pkKey, file, area) {
            try {
                var fileData = await readFileAsBase64(file);
                var res = await jsonRpc('/supplier/api/v2/upload_row_image', {
                    token: this.token, row_id: serverRowId,
                    image_data: fileData.data, image_name: fileData.name,
                });
                if (res.success) {
                    var rows = this.packingRows[pkKey] || [];
                    var row = rows.find(function (r) { return r._id === localRowId; });
                    if (row) row.has_image = true;
                    this.toast(this.t('msg_saved'), 'success');
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, true);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },

        async deleteRowImage(serverRowId, localRowId, pkKey, area) {
            if (!confirm(this.t('msg_confirm_delete_photo'))) return;
            try {
                var res = await jsonRpc('/supplier/api/v2/delete_row_image', {
                    token: this.token, row_id: serverRowId,
                });
                if (res.success) {
                    var rows = this.packingRows[pkKey] || [];
                    var row = rows.find(function (r) { return r._id === localRowId; });
                    if (row) row.has_image = false;
                    this.toast(this.t('msg_photo_deleted'), 'success');
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, false);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },
    };
})();