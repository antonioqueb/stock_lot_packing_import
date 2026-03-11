// shipment_tabs.js - JS module for rendering shipment details tabs in supplier portal
(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { jsonRpc, esc, asInt, readFileAsBase64 } = M.utils;

    M.mixins.ShipmentTabsMixin = {
        renderShipmentBody(bodyEl, s) {
            const activeTab = this.activeTabByShipment[s.id] || 'logistics';
            const tabOrder = ['logistics', 'bl', 'containers', 'invoices', 'packings'];
            const tabIcons = {
                logistics: 'fa-truck',
                bl: 'fa-file-text',
                containers: 'fa-cube',
                invoices: 'fa-file-invoice-dollar',
                packings: 'fa-boxes',
            };
            const tabLabels = {
                logistics: this.t('tab_logistics'),
                bl: this.t('tab_bl'),
                containers: this.t('tab_containers'),
                invoices: this.t('tab_invoices'),
                packings: this.t('tab_packings'),
            };
            const tabCounts = {
                containers: (s.containers || []).length,
                invoices: (s.invoices || []).length,
                packings: (s.packings || []).length,
            };

            let tabsHtml = '<div class="shipment-tabs">';
            let contentHtml = '';

            for (const name of tabOrder) {
                const isActive = activeTab === name;
                const countHtml = tabCounts[name] !== undefined ? `<span class="tab-count">${tabCounts[name]}</span>` : '';
                tabsHtml += `<div class="shipment-tab ${isActive ? 'active' : ''}" data-tab="${name}">
                    <i class="fa ${tabIcons[name]}"></i> ${tabLabels[name]} ${countHtml}
                </div>`;
                contentHtml += `<div id="stab-${name}-${s.id}" class="shipment-tab-content ${isActive ? 'active' : ''}"></div>`;
            }

            tabsHtml += '</div>';
            bodyEl.innerHTML = tabsHtml + contentHtml;

            bodyEl.querySelectorAll('.shipment-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const name = tab.dataset.tab;
                    this.activeTabByShipment[s.id] = name;

                    bodyEl.querySelectorAll('.shipment-tab').forEach(t => {
                        t.classList.toggle('active', t.dataset.tab === name);
                    });

                    bodyEl.querySelectorAll('.shipment-tab-content').forEach(c => {
                        c.classList.toggle('active', c.id === `stab-${name}-${s.id}`);
                    });

                    this.renderTabContent(name, s);
                });
            });

            this.renderTabContent(activeTab, s);
        },

        renderTabContent(tabName, s) {
            const el = document.getElementById(`stab-${tabName}-${s.id}`);
            if (!el) return;

            switch (tabName) {
                case 'logistics':
                    this.renderLogisticsTab(el, s);
                    break;
                case 'bl':
                    this.renderBLTab(el, s);
                    break;
                case 'invoices':
                    this.renderInvoicesTab(el, s);
                    break;
                case 'packings':
                    this.renderPackingsTab(el, s);
                    break;
                case 'containers':
                    this.renderContainersTab(el, s);
                    break;
            }
        },

        renderLogisticsTab(el, s) {
            const typeOpts = ['maritime', 'air', 'land']
                .map(v => `<option value="${v}" ${s.shipment_type === v ? 'selected' : ''}>${this.t('opt_' + v)}</option>`)
                .join('');

            el.innerHTML = `
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
                        <input type="date" data-sf="etd" value="${esc(s.etd)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_eta')}</label>
                        <input type="date" data-sf="eta" value="${esc(s.eta)}"/>
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
                </div>
                <div class="text-end">
                    <button type="button" class="btn-save-section btn-save-shipment-data" data-sid="${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            el.querySelector('.btn-save-shipment-data')
                .addEventListener('click', () => this.saveShipmentData(s.id, el));
        },

        async saveShipmentData(shipmentId, formEl) {
            const data = {};
            formEl.querySelectorAll('[data-sf]').forEach(input => {
                data[input.dataset.sf] = input.value;
            });

            try {
                const res = await jsonRpc('/supplier/api/v2/update_shipment', {
                    token: this.token,
                    shipment_id: shipmentId,
                    shipment_data: data,
                });

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
        },

        renderBLTab(el, s) {
            el.innerHTML = `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_number')}</label>
                        <input type="text" id="bl-num-${s.id}" value="${esc(s.bl_number)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_date')}</label>
                        <input type="date" id="bl-date-${s.id}" value="${esc(s.bl_date)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_file')}</label>
                        <input type="file" id="bl-file-${s.id}" accept=".pdf,.jpg,.jpeg,.png"/>
                    </div>
                </div>
                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section" id="btn-save-bl-${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            document.getElementById(`btn-save-bl-${s.id}`).addEventListener('click', async () => {
                const blData = {
                    bl_number: document.getElementById(`bl-num-${s.id}`).value,
                    bl_date: document.getElementById(`bl-date-${s.id}`).value || false,
                };

                try {
                    await jsonRpc('/supplier/api/v2/update_shipment', {
                        token: this.token,
                        shipment_id: s.id,
                        shipment_data: blData,
                    });

                    const fileInput = document.getElementById(`bl-file-${s.id}`);
                    if (fileInput.files.length > 0) {
                        const fileData = await readFileAsBase64(fileInput.files[0]);
                        await jsonRpc('/supplier/api/v2/upload_file', {
                            token: this.token,
                            target_model: 'supplier.shipment',
                            target_id: s.id,
                            field_name: 'bl_file',
                            file_data: fileData.data,
                            file_name: fileData.name,
                        });
                    }

                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } catch (e) {
                    this.toast(this.t('msg_error') + e.message, 'error');
                }
            });
        },

        renderInvoicesTab(el, s) {
            const invoices = s.invoices || [];
            let html = '';

            invoices.forEach((inv, idx) => {
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
                            <label>${this.t('lbl_inv_number')}</label>
                            <input type="text" data-inv-idx="${idx}" data-inv-f="invoice_number" value="${esc(inv.invoice_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_inv_date')}</label>
                            <input type="date" data-inv-idx="${idx}" data-inv-f="invoice_date" value="${esc(inv.invoice_date)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_inv_amount')}</label>
                            <input type="number" step="0.01" data-inv-idx="${idx}" data-inv-f="amount" value="${inv.amount || 0}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_inv_scope')}</label>
                            <select data-inv-idx="${idx}" data-inv-f="scope">
                                <option value="full_shipment" ${inv.scope === 'full_shipment' ? 'selected' : ''}>${this.t('scope_full')}</option>
                                <option value="specific_containers" ${inv.scope === 'specific_containers' ? 'selected' : ''}>${this.t('scope_specific')}</option>
                            </select>
                        </div>
                    </div>
                </div>`;
            });

            html += `<button type="button" class="btn-add-sub-item btn-add-inv" data-sid="${s.id}">
                <i class="fa fa-plus me-2"></i>${this.t('btn_add_invoice')}
            </button>`;
            html += `<div class="text-end mt-3">
                <button type="button" class="btn-save-section btn-save-all-invoices" data-sid="${s.id}">
                    <i class="fa fa-save me-2"></i>${this.t('btn_save_invoices')}
                </button>
            </div>`;

            el.innerHTML = html;

            el.querySelector('.btn-add-inv').addEventListener('click', () => {
                s.invoices = s.invoices || [];
                s.invoices.push({
                    id: 0,
                    invoice_number: '',
                    invoice_date: '',
                    amount: 0,
                    scope: 'full_shipment',
                    container_ids: [],
                });
                this.renderTabContent('invoices', s);
            });

            el.querySelectorAll('.btn-remove-inv').forEach(btn => {
                btn.addEventListener('click', () => {
                    s.invoices.splice(parseInt(btn.dataset.idx, 10), 1);
                    this.renderTabContent('invoices', s);
                });
            });

            el.querySelector('.btn-save-all-invoices')
                .addEventListener('click', () => this.saveInvoices(s));
        },

        async saveInvoices(s) {
            const el = document.getElementById(`stab-invoices-${s.id}`);
            const invoicesData = [];

            (s.invoices || []).forEach((inv, idx) => {
                const data = { id: inv.id || 0 };
                el.querySelectorAll(`[data-inv-idx="${idx}"]`).forEach(input => {
                    data[input.dataset.invF] = input.value;
                });
                data.amount = parseFloat(data.amount) || 0;
                invoicesData.push(data);
            });

            try {
                const res = await jsonRpc('/supplier/api/v2/save_invoices', {
                    token: this.token,
                    shipment_id: s.id,
                    invoices: invoicesData,
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

        renderContainersTab(el, s) {
            const containers = s.containers || [];
            let html = '';

            containers.forEach((c, idx) => {
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
                            <label>${this.t('lbl_cont_number')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="container_number" value="${esc(c.container_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_cont_seal')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="seal_number" value="${esc(c.seal_number)}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_cont_type')}</label>
                            <input type="text" data-cnt-idx="${idx}" data-cnt-f="container_type" value="${esc(c.container_type)}" placeholder="40HC, 20GP"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_cont_weight')}</label>
                            <input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="weight" value="${c.weight || 0}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_cont_volume')}</label>
                            <input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="volume" value="${c.volume || 0}"/>
                        </div>
                        <div class="sub-item-field">
                            <label>${this.t('lbl_cont_packages')}</label>
                            <input type="number" data-cnt-idx="${idx}" data-cnt-f="packages" value="${c.packages || 0}"/>
                        </div>
                    </div>
                </div>`;
            });

            html += `<button type="button" class="btn-add-sub-item btn-add-cnt" data-sid="${s.id}">
                <i class="fa fa-plus me-2"></i>${this.t('btn_add_container')}
            </button>`;
            html += `<div class="text-end mt-3">
                <button type="button" class="btn-save-section btn-save-all-cnts" data-sid="${s.id}">
                    <i class="fa fa-save me-2"></i>${this.t('btn_save_containers')}
                </button>
            </div>`;

            el.innerHTML = html;

            el.querySelector('.btn-add-cnt').addEventListener('click', () => {
                s.containers = s.containers || [];
                s.containers.push({
                    id: 0,
                    container_number: '',
                    seal_number: '',
                    container_type: '',
                    weight: 0,
                    volume: 0,
                    packages: 0,
                });
                this.renderTabContent('containers', s);
            });

            el.querySelectorAll('.btn-remove-cnt').forEach(btn => {
                btn.addEventListener('click', () => {
                    s.containers.splice(parseInt(btn.dataset.idx, 10), 1);
                    this.renderTabContent('containers', s);
                });
            });

            el.querySelector('.btn-save-all-cnts')
                .addEventListener('click', () => this.saveContainers(s));
        },

        async saveContainers(s) {
            const el = document.getElementById(`stab-containers-${s.id}`);
            const containersData = [];

            (s.containers || []).forEach((c, idx) => {
                const data = { id: c.id || 0 };
                el.querySelectorAll(`[data-cnt-idx="${idx}"]`).forEach(input => {
                    data[input.dataset.cntF] = input.value;
                });
                data.weight = parseFloat(data.weight) || 0;
                data.volume = parseFloat(data.volume) || 0;
                data.packages = parseInt(data.packages, 10) || 0;
                containersData.push(data);
            });

            try {
                const res = await jsonRpc('/supplier/api/v2/save_containers', {
                    token: this.token,
                    shipment_id: s.id,
                    containers: containersData,
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

        renderPackingsTab(el, s) {
            const packings = s.packings || [];

            let html = '';
            packings.forEach((pk, idx) => {
                html += this._packingCard(pk, idx, s);
            });

            html += `<button type="button" class="btn-add-sub-item btn-add-pk">
                <i class="fa fa-plus me-2"></i>${this.t('btn_add_packing')}
            </button>`;

            el.innerHTML = html;

            el.querySelector('.btn-add-pk')
                .addEventListener('click', () => this.createPacking(s));

            el.querySelectorAll('.btn-delete-pk').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(this.t('msg_confirm_delete'))) return;

                    try {
                        await jsonRpc('/supplier/api/v2/delete_packing', {
                            token: this.token,
                            packing_id: parseInt(btn.dataset.pkId, 10),
                        });
                        this.expandedPackingIds.delete(parseInt(btn.dataset.pkId, 10));
                        await this.reloadProforma();
                        this.renderAll();
                        this.toast(this.t('msg_saved'), 'success');
                    } catch (e) {
                        this.toast(this.t('msg_error') + e.message, 'error');
                    }
                });
            });

            el.querySelectorAll('.btn-save-pk').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.savePacking(
                        parseInt(btn.dataset.pkId, 10),
                        parseInt(btn.dataset.sid, 10),
                        el
                    );
                });
            });

            el.querySelectorAll('.btn-toggle-packing-rows').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pkId = parseInt(btn.dataset.pkId, 10);
                    const area = document.getElementById(`pk-rows-${pkId}`);
                    if (!area) return;

                    const isExpanded = this.expandedPackingIds.has(pkId);

                    if (isExpanded) {
                        this.expandedPackingIds.delete(pkId);
                        area.style.display = 'none';
                        btn.innerHTML = `<i class="fa fa-table me-1"></i>${this.t('btn_expand_rows')}`;
                    } else {
                        this.expandedPackingIds.add(pkId);
                        area.style.display = 'block';
                        btn.innerHTML = `<i class="fa fa-table me-1"></i>${this.t('btn_hide_rows')}`;
                        const pk = packings.find(p => p.id === pkId);
                        if (pk) this.renderPackingRows(area, pk, s);
                    }
                });
            });

            packings.forEach(pk => {
                if (!this.expandedPackingIds.has(pk.id)) return;
                const area = document.getElementById(`pk-rows-${pk.id}`);
                if (area) {
                    area.style.display = 'block';
                    this.renderPackingRows(area, pk, s);
                }
                const btn = el.querySelector(`.btn-toggle-packing-rows[data-pk-id="${pk.id}"]`);
                if (btn) {
                    btn.innerHTML = `<i class="fa fa-table me-1"></i>${this.t('btn_hide_rows')}`;
                }
            });
        },

        _packingCard(pk, idx, s) {
            const isExpanded = this.expandedPackingIds.has(pk.id);
            const rowCount = (pk.rows || []).length;

            return `<div class="sub-item-card packing-card" data-packing-id="${pk.id}">
                <div class="sub-item-header">
                    <span class="sub-item-title">
                        ${esc(pk.packing_number) || 'Packing #' + (idx + 1)}
                        <small class="text-muted">(${rowCount} rows)</small>
                    </span>
                    <div class="sub-item-actions">
                        <button type="button" class="btn-toggle-packing-rows" data-pk-id="${pk.id}">
                            <i class="fa fa-table me-1"></i>${isExpanded ? this.t('btn_hide_rows') : this.t('btn_expand_rows')}
                        </button>
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
                        <input type="date" data-pk-id="${pk.id}" data-pk-f="packing_date" value="${esc(pk.packing_date)}"/>
                    </div>
                </div>
                <div class="packing-rows-area" id="pk-rows-${pk.id}" style="display:none;"></div>
                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section btn-save-pk" data-pk-id="${pk.id}" data-sid="${s.id}" style="font-size:0.8rem;padding:6px 16px;">
                        <i class="fa fa-save me-1"></i> ${this.t('btn_save_packing')}
                    </button>
                </div>
            </div>`;
        },

        async createPacking(s) {
            try {
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: s.id,
                    packing_data: { packing_number: '', scope: 'full_shipment' },
                    rows: [],
                });

                if (res.success) {
                    this.expandedPackingIds.add(res.packing_id);
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },

        async savePacking(packingId, shipmentId, formEl) {
            const pkData = { id: packingId };

            formEl.querySelectorAll(`[data-pk-id="${packingId}"][data-pk-f]`).forEach(input => {
                pkData[input.dataset.pkF] = input.value;
            });

            const rowsKey = `pk_${packingId}`;
            const rows = this.packingRows[rowsKey] || [];

            // Derive container_ids from the rows themselves
            const usedContainerIds = [...new Set(
                rows.map(r => asInt(r.container_id)).filter(Boolean)
            )];

            pkData.scope = usedContainerIds.length > 0 ? 'specific_containers' : 'full_shipment';
            pkData.container_ids = usedContainerIds;

            const rowsPayload = rows.filter(r => {
                if (r.tipo === 'Placa') {
                    return (r.alto > 0 && r.ancho > 0) || r.ref_proveedor || r.numero_placa || r.bloque;
                }
                return (r.quantity > 0) || r.ref_proveedor || r.color;
            }).map(r => ({
                id: r.id || 0,
                product_id: r.product_id,
                container_id: asInt(r.container_id || 0),
                tipo: r.tipo,
                grosor: r.grosor || '',
                alto: r.alto || 0,
                ancho: r.ancho || 0,
                peso: r.peso || 0,
                quantity: r.quantity || 0,
                bloque: r.bloque || '',
                numero_placa: r.numero_placa || '',
                atado: r.atado || '',
                color: r.color || '',
                grupo_name: r.grupo_name || '',
                pedimento: r.pedimento || '',
                ref_proveedor: r.ref_proveedor || '',
            }));

            try {
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: shipmentId,
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

        async uploadRowImage(serverRowId, localRowId, pkKey, file, area) {
            try {
                const fileData = await readFileAsBase64(file);
                const res = await jsonRpc('/supplier/api/v2/upload_row_image', {
                    token: this.token,
                    row_id: serverRowId,
                    image_data: fileData.data,
                    image_name: fileData.name,
                });

                if (res.success) {
                    const rows = this.packingRows[pkKey] || [];
                    const row = rows.find(r => r._id === localRowId);
                    if (row) row.has_image = true;
                    this.toast('📷 ' + this.t('msg_saved'), 'success');
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
                const res = await jsonRpc('/supplier/api/v2/delete_row_image', {
                    token: this.token,
                    row_id: serverRowId,
                });

                if (res.success) {
                    const rows = this.packingRows[pkKey] || [];
                    const row = rows.find(r => r._id === localRowId);
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