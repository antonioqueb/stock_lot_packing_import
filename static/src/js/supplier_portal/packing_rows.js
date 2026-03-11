(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { esc, asInt } = M.utils;

    M.mixins.PackingRowsMixin = {
        _newProductRow(product) {
            const unitType = product.unit_type || 'Placa';
            return {
                _id: this.nextRowId++,
                id: 0,
                product_id: product.id,
                tipo: unitType,
                bloque: '',
                numero_placa: '',
                atado: '',
                grosor: '',
                alto: 0,
                ancho: 0,
                peso: 0,
                quantity: 0,
                weight: 0,
                color: '',
                ref_proveedor: '',
                grupo_name: '',
                pedimento: '',
                crate_h: '',
                crate_w: '',
                crate_t: '',
                fmt_h: '',
                fmt_w: '',
                container_id: 0,
                has_image: false,
            };
        },

        normalizePackingRowsCache(pk) {
            const rowsKey = `pk_${pk.id}`;
            if (!this.packingRows[rowsKey]) {
                if (pk.rows && pk.rows.length > 0) {
                    this.packingRows[rowsKey] = pk.rows.map(r => ({
                        ...r,
                        _id: this.nextRowId++,
                        container_id: asInt(r.container_id || 0),
                        has_image: !!r.has_image,
                    }));
                } else {
                    this.packingRows[rowsKey] = [];
                    this.products.forEach(p => {
                        this.packingRows[rowsKey].push(this._newProductRow(p));
                    });
                }
            }
            return this.packingRows[rowsKey];
        },

        renderPackingRows(area, pk, s) {
            if (!pk) return;

            const rowsKey = `pk_${pk.id}`;
            const rows = this.normalizePackingRowsCache(pk);
            const containers = (s.containers || []).filter(c => c.id && (c.container_number || c.seal_number));

            let html = '';

            this.products.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const pRows = rows.filter(r => r.product_id === product.id);

                html += `<div class="product-section">
                    <div class="product-header">
                        <div>
                            <h3>${esc(product.name)}
                                <span class="text-muted small ms-2">(${esc(product.code)})</span>
                                <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span>
                            </h3>
                        </div>
                        <div class="meta">${this.t('requested')} <strong class="text-dark">${product.qty_ordered} ${product.uom}</strong></div>
                    </div>
                    <div class="table-responsive">
                        <table class="portal-table">
                            <thead>
                                <tr>
                                    <th>${this.t('col_container_assign')}</th>`;

                if (unitType === 'Placa') {
                    html += `<th>${this.t('col_block')}</th>
                             <th>${this.t('col_atado')}</th>
                             <th>${this.t('col_plate_num')}</th>
                             <th>${this.t('col_thickness')}</th>
                             <th>${this.t('col_height')}</th>
                             <th>${this.t('col_width')}</th>
                             <th>${this.t('col_area')}</th>`;
                } else if (unitType === 'Formato') {
                    html += `<th>${this.t('lbl_packages')}</th>
                             <th>${this.t('col_qty')}</th>
                             <th class="bg-light">${this.t('col_crate_h')}</th>
                             <th class="bg-light">${this.t('col_crate_w')}</th>
                             <th class="bg-light">${this.t('col_crate_t')}</th>
                             <th>${this.t('col_thickness')}</th>
                             <th>${this.t('col_weight')}</th>
                             <th class="bg-light">${this.t('col_fmt_h')}</th>
                             <th class="bg-light">${this.t('col_fmt_w')}</th>`;
                } else {
                    html += `<th>${this.t('lbl_packages')}</th>
                             <th>${this.t('col_qty')}</th>
                             <th>${this.t('col_ref')}</th>
                             <th>${this.t('col_weight')}</th>
                             <th>${this.t('lbl_desc_goods')}</th>`;
                }

                html += `<th style="width:60px">${this.t('col_photo')}</th>
                         <th style="width:50px"></th>
                         </tr>
                            </thead>
                            <tbody>`;

                pRows.forEach(row => {
                    const rid = row._id;
                    const serverRowId = row.id || 0;
                    const hasImage = row.has_image || false;

                    html += `<tr data-row-id="${rid}" data-pk-key="${rowsKey}">`;

                    const inp = (field, val, ph, type = 'text', step = '') =>
                        `<div class="input-group-portal">
                            <input type="${type}" step="${step}" class="input-field" data-field="${field}" value="${esc(val || '')}" placeholder="${ph}">
                            <button type="button" class="btn-fill-down" data-row-id="${rid}" data-field="${field}" data-pk-key="${rowsKey}" tabindex="-1">
                                <i class="fa fa-arrow-down"></i>
                            </button>
                        </div>`;

                    // Container column - always first
                    html += `<td data-label="${this.t('col_container_assign')}">
                        <div class="input-group-portal">
                            <select class="row-container-select input-field" data-field="container_id" data-row-id="${rid}" data-pk-key="${rowsKey}">
                                <option value="">${this.t('opt_select')}</option>
                                ${containers.map(c => `
                                    <option value="${c.id}" ${asInt(row.container_id) === c.id ? 'selected' : ''}>
                                        ${esc(c.container_number || '#' + c.id)}
                                    </option>
                                `).join('')}
                            </select>
                            <button type="button" class="btn-fill-down" data-row-id="${rid}" data-field="container_id" data-pk-key="${rowsKey}" tabindex="-1">
                                <i class="fa fa-arrow-down"></i>
                            </button>
                        </div>
                    </td>`;

                    if (unitType === 'Placa') {
                        const areaVal = ((row.alto || 0) * (row.ancho || 0)).toFixed(2);
                        html += `
                            <td data-label="${this.t('col_block')}">${inp('bloque', row.bloque, '')}</td>
                            <td data-label="${this.t('col_atado')}">${inp('atado', row.atado, '')}</td>
                            <td data-label="${this.t('col_plate_num')}">${inp('numero_placa', row.numero_placa, '')}</td>
                            <td data-label="${this.t('col_thickness')}">${inp('grosor', row.grosor, '', 'text')}</td>
                            <td data-label="${this.t('col_height')}">${inp('alto', row.alto, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_width')}">${inp('ancho', row.ancho, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${areaVal}</span></td>`;
                    } else if (unitType === 'Formato') {
                        html += `
                            <td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('crate_h', row.crate_h || '', '', 'text')}</td>
                            <td>${inp('crate_w', row.crate_w || '', '', 'text')}</td>
                            <td>${inp('crate_t', row.crate_t || '', '', 'text')}</td>
                            <td>${inp('grosor', row.grosor, '', 'text')}</td>
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>
                            <td>${inp('fmt_h', row.fmt_h || '', '', 'text')}</td>
                            <td>${inp('fmt_w', row.fmt_w || '', '', 'text')}</td>`;
                    } else {
                        html += `
                            <td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('ref_proveedor', row.ref_proveedor, '')}</td>
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>
                            <td>${inp('color', row.color, '')}</td>`;
                    }

                    if (!serverRowId) {
                        html += `<td data-label="${this.t('col_photo')}" class="text-center">
                            <span class="text-muted" style="font-size:0.7rem" title="${this.t('msg_photo_save_first')}">—</span>
                        </td>`;
                    } else if (hasImage) {
                        html += `<td data-label="${this.t('col_photo')}" class="text-center">
                            <button class="btn-photo-done" type="button" data-server-row-id="${serverRowId}" data-row-id="${rid}" title="${this.t('msg_confirm_delete_photo')}">
                                <i class="fa fa-check-circle" style="color:#16a34a;font-size:1.1rem"></i>
                            </button>
                        </td>`;
                    } else {
                        html += `<td data-label="${this.t('col_photo')}" class="text-center">
                            <label class="btn-photo-upload" title="${this.t('col_photo')}" style="cursor:pointer;margin:0">
                                <i class="fa fa-camera" style="color:#8B5A2B;font-size:1rem"></i>
                                <input type="file" accept="image/*" capture="environment" data-server-row-id="${serverRowId}" data-row-id="${rid}" class="photo-file-input" style="display:none"/>
                            </label>
                        </td>`;
                    }

                    html += `<td class="text-center">
                        <button class="btn-action btn-delete-row" type="button"><i class="fa fa-trash"></i></button>
                    </td>`;

                    html += `</tr>`;
                });

                html += `</tbody></table>
                    <div class="table-actions">
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" data-count="1" type="button">
                            ${this.t('btn_add_row')}
                        </button>
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" data-count="5" type="button">
                            ${this.t('btn_add_5')}
                        </button>
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" data-count="15" type="button">
                            ${this.t('btn_add_15')}
                        </button>
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" data-count="30" type="button">
                            ${this.t('btn_add_30')}
                        </button>
                    </div>
                </div></div>`;
            });

            area.innerHTML = html;
            this.bindPackingRowsEvents(area, pk, s, rowsKey);
        },

        bindPackingRowsEvents(area, pk, s, rowsKey) {
            if (area._portalEventsBound) return;
            area._portalEventsBound = true;

            area.addEventListener('input', e => {
                if (!e.target.classList.contains('input-field')) return;

                const tr = e.target.closest('tr');
                const rid = parseInt(tr.dataset.rowId, 10);
                const key = tr.dataset.pkKey;
                const field = e.target.dataset.field;
                const rws = this.packingRows[key];
                const row = rws?.find(r => r._id === rid);
                if (!row) return;

                if (['alto', 'ancho', 'quantity', 'peso', 'weight'].includes(field)) {
                    row[field] = parseFloat(e.target.value) || 0;
                } else {
                    row[field] = e.target.value;
                }

                if ((field === 'alto' || field === 'ancho') && row.tipo === 'Placa') {
                    const span = tr.querySelector('.area-display');
                    if (span) {
                        span.textContent = ((row.alto || 0) * (row.ancho || 0)).toFixed(2);
                    }
                }
            });

            area.addEventListener('change', e => {
                if (e.target.classList.contains('row-container-select')) {
                    const rid = parseInt(e.target.dataset.rowId, 10);
                    const key = e.target.dataset.pkKey;
                    const row = (this.packingRows[key] || []).find(r => r._id === rid);
                    if (row) row.container_id = asInt(e.target.value);
                    return;
                }

                if (e.target.classList.contains('photo-file-input')) {
                    const fileInput = e.target;
                    const serverRowId = parseInt(fileInput.dataset.serverRowId, 10);
                    const localRowId = parseInt(fileInput.dataset.rowId, 10);
                    const file = fileInput.files[0];
                    if (!file) return;

                    if (file.size > 5 * 1024 * 1024) {
                        this.toast(this.t('msg_photo_too_large'), 'error');
                        fileInput.value = '';
                        return;
                    }
                    if (!file.type.startsWith('image/')) {
                        this.toast(this.t('msg_photo_invalid'), 'error');
                        fileInput.value = '';
                        return;
                    }

                    this.uploadRowImage(serverRowId, localRowId, rowsKey, file, area);
                }
            });

            area.addEventListener('click', e => {
                const delBtn = e.target.closest('.btn-delete-row');
                const addBtn = e.target.closest('.action-add-pk-row');
                const fillBtn = e.target.closest('.btn-fill-down');
                const photoDoneBtn = e.target.closest('.btn-photo-done');

                if (photoDoneBtn) {
                    this.deleteRowImage(
                        parseInt(photoDoneBtn.dataset.serverRowId, 10),
                        parseInt(photoDoneBtn.dataset.rowId, 10),
                        rowsKey,
                        area
                    );
                    return;
                }

                if (delBtn) {
                    const tr = delBtn.closest('tr');
                    const rid = parseInt(tr.dataset.rowId, 10);
                    const key = tr.dataset.pkKey;
                    this.packingRows[key] = (this.packingRows[key] || []).filter(r => r._id !== rid);
                    this.renderPackingRows(area, pk, s);
                    return;
                }

                if (addBtn) {
                    const pid = parseInt(addBtn.dataset.productId, 10);
                    const key = addBtn.dataset.pkKey;
                    const count = parseInt(addBtn.dataset.count, 10) || 1;
                    const p = this.products.find(x => x.id === pid);
                    if (p) {
                        for (let i = 0; i < count; i++) {
                            this.packingRows[key].push(this._newProductRow(p));
                        }
                        this.renderPackingRows(area, pk, s);
                    }
                    return;
                }

                if (fillBtn) {
                    const rid = parseInt(fillBtn.dataset.rowId, 10);
                    const field = fillBtn.dataset.field;
                    const key = fillBtn.dataset.pkKey;
                    const rws = this.packingRows[key] || [];
                    const src = rws.find(r => r._id === rid);
                    if (!src) return;

                    let started = false;
                    rws.forEach(r => {
                        if (r._id === rid) {
                            started = true;
                            return;
                        }
                        if (started && r.product_id === src.product_id) {
                            r[field] = src[field];
                        }
                    });

                    this.renderPackingRows(area, pk, s);
                }
            });
        },

        _updatePhotoCellInPlace(area, localRowId, serverRowId, hasImage) {
            if (!area) return;
            const tr = area.querySelector(`tr[data-row-id="${localRowId}"]`);
            if (!tr) return;

            const tds = tr.querySelectorAll('td');
            const photoTd = tds[tds.length - 2];
            if (!photoTd) return;

            if (hasImage) {
                photoTd.innerHTML = `<button class="btn-photo-done" type="button" data-server-row-id="${serverRowId}" data-row-id="${localRowId}" title="${this.t('msg_confirm_delete_photo')}">
                    <i class="fa fa-check-circle" style="color:#16a34a;font-size:1.1rem"></i>
                </button>`;
            } else {
                photoTd.innerHTML = `<label class="btn-photo-upload" title="${this.t('col_photo')}" style="cursor:pointer;margin:0">
                    <i class="fa fa-camera" style="color:#8B5A2B;font-size:1rem"></i>
                    <input type="file" accept="image/*" capture="environment" data-server-row-id="${serverRowId}" data-row-id="${localRowId}" class="photo-file-input" style="display:none"/>
                </label>`;
            }
        },
    };
})();