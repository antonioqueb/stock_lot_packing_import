(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { esc, asInt, readFileAsBase64, jsonRpc } = M.utils;

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

        normalizePackingRowsCache(pk, shipmentProducts) {
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
                    (shipmentProducts || []).forEach(p => {
                        this.packingRows[rowsKey].push(this._newProductRow(p));
                    });
                }
            }
            return this.packingRows[rowsKey];
        },

        // Recarga proforma sin limpiar el caché de filas
        async reloadProformaKeepingRows() {
            try {
                const res = await jsonRpc('/supplier/api/v2/reload', { token: this.token });
                if (res.success && res.proforma) {
                    const savedRows = { ...this.packingRows };
                    this.proforma = res.proforma;
                    this.packingRows = savedRows;
                }
            } catch (e) {
                console.error('[Portal] reloadProformaKeepingRows ERROR:', e.message);
            }
        },

        // Refresca SOLO la sección de fotos de bloque dentro del area,
        // sin tocar la tabla de filas ni perder datos no guardados.
        async _refreshBlockPhotosInPlace(area, pk, s, rowsKey) {
            await this.reloadProformaKeepingRows();

            const updatedShipment = (this.proforma.shipments || []).find(x => x.id === s.id);
            if (!updatedShipment) return;

            const updatedPacking = (updatedShipment.packings || []).find(p => p.id === pk.id) || pk;

            // Quitar sección anterior y volver a insertarla con datos frescos
            const existing = area.querySelector('.block-photos-section');
            if (existing) existing.remove();

            this._renderBlockPhotoSections(area, updatedPacking, updatedShipment, rowsKey);
        },

        renderPackingRows(area, pk, s) {
            if (!pk) return;

            const rowsKey = `pk_${pk.id}`;
            const shipmentProducts = (s.products && s.products.length) ? s.products : this.products;
            const rows = this.normalizePackingRowsCache(pk, shipmentProducts);
            const containers = (s.containers || []).filter(c => c.id && (c.container_number || c.seal_number));

            const lblAvailable = this.currentLang === 'es' ? 'Disponible' : (this.currentLang === 'zh' ? '可分配' : 'Available');
            const lblCurrent = this.currentLang === 'es' ? 'En este embarque' : (this.currentLang === 'zh' ? '当前发货' : 'Current shipment');
            const lblRemaining = this.currentLang === 'es' ? 'Remanente' : (this.currentLang === 'zh' ? '剩余' : 'Remaining');

            let html = '';

            shipmentProducts.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const pRows = rows.filter(r => r.product_id === product.id);

                const qtyOrdered = Number(product.qty_ordered || 0);
                const qtyAvailable = Number(
                    product.qty_available !== undefined ? product.qty_available : qtyOrdered
                );
                const qtyCurrent = Number(product.qty_current_shipment || 0);
                const qtyRemainingAfter = Number(
                    product.qty_remaining_after !== undefined
                        ? product.qty_remaining_after
                        : (qtyAvailable - qtyCurrent)
                );
                const isOverAssigned = !!product.is_over_assigned || (qtyRemainingAfter < -0.000001);

                html += `<div class="product-section">
                    <div class="product-header">
                        <div>
                            <h3>${esc(product.name)}
                                <span class="text-muted small ms-2">(${esc(product.code)})</span>
                                <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span>
                            </h3>
                        </div>
                        <div class="meta" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
                            <span>${this.t('requested')} <strong class="text-dark">${qtyOrdered.toFixed(2)} ${esc(product.uom || '')}</strong></span>
                            <span>${lblAvailable}: <strong class="${isOverAssigned ? 'text-danger' : 'text-dark'}">${qtyAvailable.toFixed(2)} ${esc(product.uom || '')}</strong></span>
                            <span>${lblCurrent}: <strong class="${isOverAssigned ? 'text-danger' : 'text-dark'}">${qtyCurrent.toFixed(2)} ${esc(product.uom || '')}</strong></span>
                            <span>${lblRemaining}: <strong class="${isOverAssigned ? 'text-danger' : 'text-dark'}">${qtyRemainingAfter.toFixed(2)} ${esc(product.uom || '')}</strong></span>
                        </div>
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
                             <th>${this.t('col_weight')}</th>`;
                } else {
                    html += `<th>${this.t('lbl_packages')}</th>
                             <th>${this.t('col_qty')}</th>
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
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>`;
                    } else {
                        html += `
                            <td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
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
            this._renderBlockPhotoSections(area, pk, s, rowsKey);
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

                // Cuando cambia el campo bloque, refrescar la sección de fotos
                // para que aparezca/desaparezca el slot del bloque de inmediato
                if (field === 'bloque') {
                    clearTimeout(this._bloqueRefreshTimer);
                    this._bloqueRefreshTimer = setTimeout(() => {
                        const existing = area.querySelector('.block-photos-section');
                        if (existing) existing.remove();
                        this._renderBlockPhotoSections(area, pk, s, rowsKey);
                    }, 600);
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
                    const productPool = (s.products && s.products.length) ? s.products : this.products;
                    const p = productPool.find(x => x.id === pid) || this.products.find(x => x.id === pid);
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

                    if (field === 'numero_placa') {
                        const baseVal = parseInt(src[field], 10);
                        if (!isNaN(baseVal)) {
                            let seq = baseVal;
                            rws.forEach(r => {
                                if (r._id === rid) { started = true; return; }
                                if (started && r.product_id === src.product_id) {
                                    seq++;
                                    r[field] = String(seq);
                                }
                            });
                        }
                    } else {
                        rws.forEach(r => {
                            if (r._id === rid) { started = true; return; }
                            if (started && r.product_id === src.product_id) {
                                r[field] = src[field];
                            }
                        });
                    }

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

        // =================================================================
        //  FOTOS DE BLOQUE
        // =================================================================

        _renderBlockPhotoSections(area, pk, s, rowsKey) {
            const rows = this.packingRows[rowsKey] || [];
            const productPool = (s.products && s.products.length) ? s.products : this.products;

            const blocksByKey = {};
            rows.forEach(r => {
                const bloque = (r.bloque || '').trim();
                if (!bloque) return;
                const key = `${r.product_id}__${bloque}`;
                if (!blocksByKey[key]) {
                    blocksByKey[key] = { product_id: r.product_id, block_name: bloque };
                }
            });

            const uniqueBlocks = Object.values(blocksByKey);
            if (uniqueBlocks.length === 0) return;

            const existingImages = (s.block_images || []);
            const imagesByBlock = {};
            existingImages.forEach(img => {
                const key = `${img.product_id}__${img.block_name}`;
                if (!imagesByBlock[key]) imagesByBlock[key] = [];
                imagesByBlock[key].push(img);
            });

            const titleText = this.t('block_photos_title') || 'Fotografias por Bloque';
            const requiredText = this.t('block_photos_required') || 'obligatorio por bloque';
            const addText = this.t('block_photos_add') || 'Subir foto';

            let blockHtml = `<div class="block-photos-section" style="margin-top:16px;padding:14px 16px;border:1.5px dashed #d4d4d0;border-radius:10px;background:#fafaf9;">
                <h4 style="margin:0 0 12px;font-size:0.9rem;color:#6B4226;display:flex;align-items:center;gap:8px;">
                    <i class="fa fa-camera"></i> ${esc(titleText)}
                    <span style="font-size:0.72rem;color:#888;font-weight:400;">(${esc(requiredText)})</span>
                </h4>`;

            uniqueBlocks.forEach(({ product_id, block_name }) => {
                const key = `${product_id}__${block_name}`;
                const imgs = imagesByBlock[key] || [];
                const hasPhoto = imgs.length > 0;
                const product = productPool.find(p => p.id === product_id) || this.products.find(p => p.id === product_id);
                const productName = product ? product.name : '';

                const borderColor = hasPhoto ? '#bbf7d0' : '#fecaca';
                const bgColor = hasPhoto ? '#f0fdf4' : '#fef2f2';

                blockHtml += `<div class="block-photo-item" style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px;background:${bgColor};border:1px solid ${borderColor};border-radius:8px;flex-wrap:wrap;">
                    <div style="flex:1;min-width:150px;">
                        <strong style="color:#1f2937;">${esc(block_name)}</strong>
                        <span style="font-size:0.72rem;color:#888;margin-left:8px;">${esc(productName)}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">`;

                if (hasPhoto) {
                    imgs.forEach(img => {
                        blockHtml += `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:#16a34a;background:#dcfce7;padding:3px 8px;border-radius:12px;border:1px solid #bbf7d0;">
                            <i class="fa fa-check-circle"></i> ${esc(img.image_filename || 'foto')}
                            <button type="button" class="btn-delete-block-photo" data-block-image-id="${img.id}" data-shipment-id="${s.id}"
                                style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.75rem;padding:0 2px;margin-left:4px;" title="Eliminar">
                                <i class="fa fa-times"></i>
                            </button>
                        </span>`;
                    });
                } else {
                    blockHtml += `<span style="font-size:0.72rem;color:#dc2626;"><i class="fa fa-exclamation-circle"></i> ${this.t('block_photos_missing') || 'Foto requerida'}</span>`;
                }

                blockHtml += `<label style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border:1.5px dashed ${hasPhoto ? '#d4d4d0' : '#f87171'};border-radius:6px;font-size:0.8rem;color:#6B4226;background:#fff;transition:border-color 0.15s;">
                    <i class="fa fa-plus-circle"></i> ${esc(addText)}
                    <input type="file" accept="image/*" capture="environment" class="block-photo-input"
                        data-block-name="${esc(block_name)}"
                        data-product-id="${product_id}"
                        data-shipment-id="${s.id}"
                        data-packing-id="${pk.id}"
                        style="display:none"/>
                </label>`;

                blockHtml += `</div></div>`;
            });

            blockHtml += `</div>`;

            area.insertAdjacentHTML('beforeend', blockHtml);
            this._bindBlockPhotoEvents(area, pk, s, rowsKey);
        },

        _bindBlockPhotoEvents(area, pk, s, rowsKey) {
            area.querySelectorAll('.block-photo-input').forEach(input => {
                if (input._blockBound) return;
                input._blockBound = true;

                input.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    if (file.size > 5 * 1024 * 1024) {
                        this.toast(this.t('msg_photo_too_large'), 'error');
                        e.target.value = '';
                        return;
                    }
                    if (!file.type.startsWith('image/')) {
                        this.toast(this.t('msg_photo_invalid'), 'error');
                        e.target.value = '';
                        return;
                    }

                    const shipmentId = parseInt(input.dataset.shipmentId, 10);
                    const blockName = input.dataset.blockName;
                    const productId = parseInt(input.dataset.productId, 10);
                    const packingId = parseInt(input.dataset.packingId, 10);
                    this._uploadBlockImage(shipmentId, blockName, productId, file, pk, s, area, rowsKey, packingId);
                });
            });

            area.querySelectorAll('.btn-delete-block-photo').forEach(btn => {
                if (btn._blockBound) return;
                btn._blockBound = true;

                btn.addEventListener('click', () => {
                    if (!confirm(this.t('msg_confirm_delete_photo') || 'Eliminar foto?')) return;
                    const blockImageId = parseInt(btn.dataset.blockImageId, 10);
                    const shipmentId = parseInt(btn.dataset.shipmentId, 10);
                    this._deleteBlockImage(blockImageId, shipmentId, pk, s, area, rowsKey);
                });
            });
        },

        async _uploadBlockImage(shipmentId, blockName, productId, file, pk, s, area, rowsKey, packingId) {
            try {
                const fileData = await readFileAsBase64(file);
                const res = await jsonRpc('/supplier/api/v2/upload_block_image', {
                    token: this.token,
                    shipment_id: shipmentId,
                    block_name: blockName,
                    product_id: productId,
                    image_data: fileData.data,
                    image_name: fileData.name,
                });

                if (res.success) {
                    this.toast(this.t('msg_saved'), 'success');
                    await this._refreshBlockPhotosInPlace(area, pk, s, rowsKey);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },

        async _deleteBlockImage(blockImageId, shipmentId, pk, s, area, rowsKey) {
            try {
                const res = await jsonRpc('/supplier/api/v2/delete_block_image', {
                    token: this.token,
                    block_image_id: blockImageId,
                });

                if (res.success) {
                    this.toast(this.t('msg_photo_deleted') || 'Foto eliminada', 'success');
                    await this._refreshBlockPhotosInPlace(area, pk, s, rowsKey);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },
    };
})();