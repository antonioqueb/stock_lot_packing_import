(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { esc, asInt, readFileAsBase64, jsonRpc } = M.utils;

    M.mixins.PackingRowsMixin = {
        _newProductRow(product, defaults = {}) {
            const unitType = defaults.tipo || product.unit_type || 'Placa';
            return {
                _id: this.nextRowId++,
                id: 0,
                product_id: product.id,
                tipo: unitType,
                bloque: defaults.bloque || '',
                numero_placa: defaults.numero_placa || '',
                atado: defaults.atado || '',
                grosor: defaults.grosor || '',
                alto: defaults.alto || 0,
                ancho: defaults.ancho || 0,
                peso: defaults.peso || 0,
                quantity: defaults.quantity !== undefined ? defaults.quantity : 0,
                weight: defaults.weight || 0,
                color: defaults.color || '',
                ref_proveedor: defaults.ref_proveedor || '',
                grupo_name: defaults.grupo_name || '',
                pedimento: defaults.pedimento || '',
                crate_h: defaults.crate_h || '',
                crate_w: defaults.crate_w || '',
                crate_t: defaults.crate_t || '',
                fmt_h: defaults.fmt_h || '',
                fmt_w: defaults.fmt_w || '',
                container_id: asInt(defaults.container_id || 0),
                has_image: !!defaults.has_image,
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
                }
            }
            return this.packingRows[rowsKey];
        },

        async reloadProformaKeepingRows() {
            try {
                const res = await jsonRpc('/supplier/api/v2/reload', { token: this.token });
                if (res.success && res.proforma) {
                    const savedRows = { ...this.packingRows };
                    const savedSetup = { ...this.packingSetupState };
                    const savedCollapse = { ...this.productCollapseState };
                    this.proforma = res.proforma;
                    this.packingRows = savedRows;
                    this.packingSetupState = savedSetup;
                    this.productCollapseState = savedCollapse;
                }
            } catch (e) {
                console.error('[Portal] reloadProformaKeepingRows ERROR:', e.message);
            }
        },

        async _refreshBlockPhotosInPlace(area, pk, s, rowsKey) {
            await this.reloadProformaKeepingRows();
            // Block photo sections no longer rendered inline — managed in setup modal
        },

        _getShipmentProducts(s) {
            return (s.products && s.products.length) ? s.products : this.products;
        },

        _getPackingSetupState(pk, s) {
            if (!this.packingSetupState[pk.id]) {
                const shipmentProducts = this._getShipmentProducts(s);
                this.packingSetupState[pk.id] = {
                    packing_id: pk.id,
                    shipment_id: s.id,
                    products: shipmentProducts.map(p => ({
                        product_id: p.id,
                        product_name: p.name,
                        product_code: p.code || '',
                        unit_type: p.unit_type || 'Placa',
                        enabled: false,
                        blocks: [],
                    })),
                };
            }
            return this.packingSetupState[pk.id];
        },

        _ensureSetupBlocksLength(productState, targetCount) {
            const count = Math.max(0, parseInt(targetCount, 10) || 0);
            const current = productState.blocks || [];

            if (current.length < count) {
                for (let i = current.length; i < count; i++) {
                    current.push({
                        uid: `${productState.product_id}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
                        block_name: '',
                        slab_count: 0,
                        uploaded_file_name: '',
                    });
                }
            } else if (current.length > count) {
                current.splice(count);
            }

            productState.blocks = current;
        },

        _getBlockImagesForShipment(shipment, productId, blockName) {
            const target = String(blockName || '').trim().toLowerCase();
            if (!target) return [];
            return (shipment.block_images || []).filter(img => {
                return asInt(img.product_id) === asInt(productId) &&
                    String(img.block_name || '').trim().toLowerCase() === target;
            });
        },

        _getProductCollapseKey(pkId, productId) {
            return `pk_${pkId}_product_${productId}`;
        },

        _isProductCollapsed(pkId, productId) {
            const key = this._getProductCollapseKey(pkId, productId);
            if (this.productCollapseState[key] === undefined) {
                return false;
            }
            return !!this.productCollapseState[key];
        },

        _toggleProductCollapsed(pkId, productId) {
            const key = this._getProductCollapseKey(pkId, productId);
            this.productCollapseState[key] = !this.productCollapseState[key];
        },

        _adjustStickyTheadPositions(area) {
            // NO-OP
        },

        // =================================================================
        //  AUTO-SAVE PACKING after generating rows
        // =================================================================

        async _autoSavePackingRows(packingId, shipmentId, formEl) {
            const pkData = { id: packingId };

            // Leer metadatos del packing si hay inputs en el DOM
            if (formEl) {
                formEl.querySelectorAll('[data-pk-id="' + packingId + '"][data-pk-f]').forEach(function (input) {
                    pkData[input.dataset.pkF] = input.value;
                });
            }

            const rowsKey = 'pk_' + packingId;
            const rows = this.packingRows[rowsKey] || [];

            if (!rows.length) {
                return { success: false, message: 'No hay filas para guardar.' };
            }

            const usedContainerIds = [...new Set(rows.map(r => asInt(r.container_id)).filter(Boolean))];
            pkData.scope = usedContainerIds.length > 0 ? 'specific_containers' : 'full_shipment';
            pkData.container_ids = usedContainerIds;

            const rowsPayload = rows.map(function (r) {
                return {
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
                };
            });

            try {
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: shipmentId,
                    packing_data: pkData,
                    rows: rowsPayload,
                });
                return res;
            } catch (e) {
                return { success: false, message: e.message };
            }
        },

        // =================================================================
        //  SETUP MODAL
        // =================================================================

        openPackingSetupModal(pk, s) {
            const freshShipment = this._getFreshShipment ? (this._getFreshShipment(s.id) || s) : s;
            const state = this._getPackingSetupState(pk, freshShipment);

            let overlay = document.getElementById('portal-packing-setup-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'portal-packing-setup-overlay';
                overlay.className = 'portal-modal-overlay';
                document.body.appendChild(overlay);
            }

            const shipmentProducts = this._getShipmentProducts(freshShipment);

            let html = `
                <div class="portal-modal">
                    <div class="portal-modal-header">
                        <div>
                            <h3>${this.t('setup_modal_title') || 'Configurar packing'}</h3>
                            <p>${this.t('setup_modal_subtitle') || 'Define bloques, cantidad de placas y fotografía por bloque antes de capturar.'}</p>
                        </div>
                        <button type="button" class="portal-modal-close" data-action="close-setup-modal">
                            <i class="fa fa-times"></i>
                        </button>
                    </div>
                    <div class="portal-modal-body">`;

            state.products.forEach(productState => {
                const product = shipmentProducts.find(p => p.id === productState.product_id) || {
                    id: productState.product_id,
                    name: productState.product_name,
                    code: productState.product_code,
                    unit_type: productState.unit_type,
                };

                const countLabel = product.unit_type === 'Placa'
                    ? (this.t('setup_count_label_slabs') || 'Placas dentro del bloque')
                    : (this.t('setup_count_label_units') || 'Piezas dentro del bloque');

                html += `
                    <div class="setup-product-card ${productState.enabled ? 'is-enabled' : ''}" data-product-id="${product.id}">
                        <div class="setup-product-header">
                            <label class="setup-product-check">
                                <input type="checkbox"
                                       class="setup-product-enable"
                                       data-product-id="${product.id}"
                                       ${productState.enabled ? 'checked' : ''}/>
                                <span>${esc(product.name)}</span>
                                <small>${esc(product.code || '')}</small>
                            </label>
                            <span class="setup-product-badge">${esc(product.unit_type || 'Placa')}</span>
                        </div>`;

                if (productState.enabled) {
                    html += `
                        <div class="setup-product-body">
                            <div class="setup-product-controls">
                                <div class="setup-inline-field">
                                    <label>${this.t('setup_blocks_qty') || '¿Cuántos bloques se cargarán?'}</label>
                                    <input type="number"
                                           min="0"
                                           class="setup-block-count"
                                           data-product-id="${product.id}"
                                           value="${productState.blocks.length || ''}"/>
                                </div>
                            </div>`;

                    if ((productState.blocks || []).length > 0) {
                        html += `<div class="setup-blocks-list">`;
                        productState.blocks.forEach((block, idx) => {
                            const existingImgs = this._getBlockImagesForShipment(freshShipment, product.id, block.block_name);
                            const hasPhoto = existingImgs.length > 0;
                            const photoStatus = hasPhoto
                                ? `<span class="setup-photo-status ok"><i class="fa fa-check-circle"></i> ${this.t('setup_photo_ok') || 'Foto cargada'} (${existingImgs.length})</span>`
                                : `<span class="setup-photo-status missing"><i class="fa fa-exclamation-circle"></i> ${this.t('setup_photo_missing') || 'Foto pendiente'}</span>`;

                            html += `
                                <div class="setup-block-row" data-product-id="${product.id}" data-block-index="${idx}">
                                    <div class="setup-block-title">
                                        ${this.t('setup_block_label') || 'Bloque'} ${idx + 1}
                                    </div>

                                    <div class="setup-block-grid">
                                        <div class="setup-inline-field">
                                            <label>${this.t('col_block') || 'Bloque'}</label>
                                            <input type="text"
                                                   class="setup-block-name"
                                                   data-product-id="${product.id}"
                                                   data-block-index="${idx}"
                                                   value="${esc(block.block_name || '')}"
                                                   placeholder="${this.t('setup_block_name_placeholder') || 'Ej. B-01'}"/>
                                        </div>

                                        <div class="setup-inline-field">
                                            <label>${countLabel}</label>
                                            <input type="number"
                                                   min="0"
                                                   class="setup-block-slab-count"
                                                   data-product-id="${product.id}"
                                                   data-block-index="${idx}"
                                                   value="${block.slab_count ? esc(block.slab_count) : ''}"/>
                                        </div>

                                        <div class="setup-inline-field setup-photo-field">
                                            <label>${this.t('col_photo') || 'Foto'}</label>
                                            <div class="setup-photo-upload">
                                                <label class="setup-photo-button">
                                                    <i class="fa fa-camera"></i>
                                                    <span>${this.t('setup_upload_photo') || 'Subir foto'}</span>
                                                    <input type="file"
                                                           accept="image/*"
                                                           capture="environment"
                                                           class="setup-block-photo-input"
                                                           data-product-id="${product.id}"
                                                           data-block-index="${idx}"
                                                           style="display:none"/>
                                                </label>
                                                ${photoStatus}
                                            </div>
                                        </div>
                                    </div>
                                </div>`;
                        });
                        html += `</div>`;
                    }
                    html += `</div>`;
                }

                html += `</div>`;
            });

            html += `
                    </div>
                    <div class="portal-modal-footer">
                        <button type="button" class="btn-add-row" data-action="close-setup-modal">
                            ${this.t('btn_cancel') || 'Cancelar'}
                        </button>
                        <button type="button" class="btn-save-section" data-action="apply-setup" data-packing-id="${pk.id}" data-shipment-id="${freshShipment.id}">
                            <i class="fa fa-check"></i> ${this.t('setup_apply') || 'Generar filas'}
                        </button>
                    </div>
                </div>`;

            overlay.innerHTML = html;
            overlay.classList.add('show');

            overlay.querySelectorAll('[data-action="close-setup-modal"]').forEach(btn => {
                btn.addEventListener('click', () => this.closePackingSetupModal());
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closePackingSetupModal();
            }, { once: true });

            overlay.querySelectorAll('.setup-product-enable').forEach(input => {
                input.addEventListener('change', () => {
                    const productId = asInt(input.dataset.productId);
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const productState = setupState.products.find(p => p.product_id === productId);
                    if (!productState) return;
                    productState.enabled = !!input.checked;
                    if (productState.enabled && !productState.blocks.length) {
                        // No auto-create blocks — let user type the count
                    }
                    this.openPackingSetupModal(pk, freshShipment);
                });
            });

            overlay.querySelectorAll('.setup-block-count').forEach(input => {
                input.addEventListener('input', () => {
                    const productId = asInt(input.dataset.productId);
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const productState = setupState.products.find(p => p.product_id === productId);
                    if (!productState) return;
                    this._ensureSetupBlocksLength(productState, input.value);
                    this.openPackingSetupModal(pk, freshShipment);
                });
            });

            overlay.querySelectorAll('.setup-block-name').forEach(input => {
                input.addEventListener('input', () => {
                    const productId = asInt(input.dataset.productId);
                    const blockIndex = asInt(input.dataset.blockIndex);
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const productState = setupState.products.find(p => p.product_id === productId);
                    if (!productState || !productState.blocks[blockIndex]) return;
                    productState.blocks[blockIndex].block_name = input.value || '';
                });
            });

            overlay.querySelectorAll('.setup-block-slab-count').forEach(input => {
                input.addEventListener('input', () => {
                    const productId = asInt(input.dataset.productId);
                    const blockIndex = asInt(input.dataset.blockIndex);
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const productState = setupState.products.find(p => p.product_id === productId);
                    if (!productState || !productState.blocks[blockIndex]) return;
                    productState.blocks[blockIndex].slab_count = parseInt(input.value, 10) || 0;
                });
            });

            overlay.querySelectorAll('.setup-block-photo-input').forEach(input => {
                input.addEventListener('change', async () => {
                    const file = input.files && input.files[0];
                    if (!file) return;

                    if (file.size > 5 * 1024 * 1024) {
                        this.toast(this.t('msg_photo_too_large'), 'error');
                        input.value = '';
                        return;
                    }
                    if (!file.type.startsWith('image/')) {
                        this.toast(this.t('msg_photo_invalid'), 'error');
                        input.value = '';
                        return;
                    }

                    const productId = asInt(input.dataset.productId);
                    const blockIndex = asInt(input.dataset.blockIndex);
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const productState = setupState.products.find(p => p.product_id === productId);
                    const blockState = productState && productState.blocks ? productState.blocks[blockIndex] : null;

                    if (!blockState || !String(blockState.block_name || '').trim()) {
                        this.toast(this.t('setup_block_name_required') || 'Primero escribe el nombre del bloque.', 'error');
                        input.value = '';
                        return;
                    }

                    try {
                        const fileData = await readFileAsBase64(file);
                        const res = await jsonRpc('/supplier/api/v2/upload_block_image', {
                            token: this.token,
                            shipment_id: freshShipment.id,
                            block_name: blockState.block_name,
                            product_id: productId,
                            image_data: fileData.data,
                            image_name: fileData.name,
                        });

                        if (res.success) {
                            blockState.uploaded_file_name = fileData.name;
                            this.toast(this.t('msg_saved'), 'success');
                            await this.reloadProformaKeepingRows();
                            const updatedShipment = (this.proforma.shipments || []).find(x => x.id === freshShipment.id) || freshShipment;
                            this.openPackingSetupModal(pk, updatedShipment);
                        } else {
                            this.toast(this.t('msg_error') + (res.message || ''), 'error');
                        }
                    } catch (e) {
                        this.toast(this.t('msg_error') + e.message, 'error');
                    } finally {
                        input.value = '';
                    }
                });
            });

            // ═══════════════════════════════════════════════════════════════
            //  APPLY SETUP — Generate rows AND auto-save to server
            // ═══════════════════════════════════════════════════════════════
            const applyBtn = overlay.querySelector('[data-action="apply-setup"]');
            if (applyBtn) {
                applyBtn.addEventListener('click', async () => {
                    const setupState = this._getPackingSetupState(pk, freshShipment);
                    const validation = this._validatePackingSetup(setupState, freshShipment);
                    if (!validation.valid) {
                        this.toast(validation.message, 'error');
                        return;
                    }

                    const rowsKey = `pk_${pk.id}`;
                    const shipmentProductsMap = {};
                    this._getShipmentProducts(freshShipment).forEach(p => {
                        shipmentProductsMap[p.id] = p;
                    });

                    const generatedRows = [];
                    setupState.products
                        .filter(p => p.enabled)
                        .forEach(productState => {
                            const product = shipmentProductsMap[productState.product_id];
                            if (!product) return;

                            (productState.blocks || []).forEach(block => {
                                const blockName = String(block.block_name || '').trim();
                                const count = parseInt(block.slab_count, 10) || 0;
                                if (!blockName || count <= 0) return;

                                for (let i = 0; i < count; i++) {
                                    generatedRows.push(this._newProductRow(product, {
                                        bloque: blockName,
                                        numero_placa: product.unit_type === 'Placa' ? String(i + 1) : '',
                                        quantity: product.unit_type === 'Placa' ? 0 : 1,
                                        tipo: product.unit_type || 'Placa',
                                    }));
                                }
                            });
                        });

                    this.packingRows[rowsKey] = generatedRows;

                    // ── Disable button and show saving state ──
                    applyBtn.disabled = true;
                    const originalBtnHtml = applyBtn.innerHTML;
                    applyBtn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> ${this.t('msg_saving') || 'Guardando...'}`;

                    // ── AUTO-SAVE to server ──
                    try {
                        const saveRes = await this._autoSavePackingRows(pk.id, freshShipment.id, null);

                        if (saveRes && saveRes.success) {
                            // Clear local cache so reload picks up server data
                            delete this.packingRows[rowsKey];
                            delete this.packingSetupState[pk.id];

                            this.closePackingSetupModal();
                            await this.reloadProforma();
                            this.renderAll();
                            this.toast(this.t('msg_saved'), 'success');
                        } else {
                            // Save failed — keep rows in memory so user doesn't lose work
                            this.toast(this.t('msg_error') + (saveRes.message || ''), 'error');
                            applyBtn.disabled = false;
                            applyBtn.innerHTML = originalBtnHtml;

                            // Still close modal and render local rows
                            this.closePackingSetupModal();
                            const area = document.getElementById(`pk-rows-${pk.id}`);
                            if (area) {
                                const updatedShipment = (this.proforma.shipments || []).find(x => x.id === freshShipment.id) || freshShipment;
                                this.renderPackingRows(area, pk, updatedShipment);
                                area.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        }
                    } catch (e) {
                        this.toast(this.t('msg_error') + e.message, 'error');
                        applyBtn.disabled = false;
                        applyBtn.innerHTML = originalBtnHtml;

                        // Still close and render local
                        this.closePackingSetupModal();
                        const area = document.getElementById(`pk-rows-${pk.id}`);
                        if (area) {
                            const updatedShipment = (this.proforma.shipments || []).find(x => x.id === freshShipment.id) || freshShipment;
                            this.renderPackingRows(area, pk, updatedShipment);
                            area.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }
                });
            }
        },

        closePackingSetupModal() {
            const overlay = document.getElementById('portal-packing-setup-overlay');
            if (overlay) {
                overlay.classList.remove('show');
                overlay.innerHTML = '';
            }
        },

        _validatePackingSetup(setupState, shipment) {
            const enabledProducts = (setupState.products || []).filter(p => p.enabled);
            if (!enabledProducts.length) {
                return {
                    valid: false,
                    message: this.t('setup_select_product_error') || 'Selecciona al menos un producto para este packing.',
                };
            }

            let hasAnyRow = false;

            for (const productState of enabledProducts) {
                if (!productState.blocks || !productState.blocks.length) {
                    return {
                        valid: false,
                        message: `${productState.product_name}: ${this.t('setup_blocks_required_error') || 'debes indicar al menos un bloque.'}`,
                    };
                }

                for (const block of productState.blocks) {
                    const blockName = String(block.block_name || '').trim();
                    const count = parseInt(block.slab_count, 10) || 0;

                    if (!blockName) {
                        return {
                            valid: false,
                            message: `${productState.product_name}: ${this.t('setup_block_name_required') || 'falta el nombre del bloque.'}`,
                        };
                    }

                    if (count <= 0) {
                        return {
                            valid: false,
                            message: `${productState.product_name} / ${blockName}: ${this.t('setup_block_count_required') || 'la cantidad debe ser mayor a cero.'}`,
                        };
                    }

                    const imgs = this._getBlockImagesForShipment(shipment, productState.product_id, blockName);
                    if (!imgs.length) {
                        return {
                            valid: false,
                            message: `${productState.product_name} / ${blockName}: ${this.t('setup_block_photo_required') || 'debes subir una foto del bloque.'}`,
                        };
                    }

                    hasAnyRow = true;
                }
            }

            if (!hasAnyRow) {
                return {
                    valid: false,
                    message: this.t('setup_no_rows_error') || 'La configuración no genera filas.',
                };
            }

            return { valid: true };
        },

        // =================================================================
        //  MAIN RENDER — UNIFIED STICKY BLOCK (header + thead glued)
        // =================================================================

        renderPackingRows(area, pk, s) {
            if (!pk) return;

            const rowsKey = `pk_${pk.id}`;
            const shipmentProducts = this._getShipmentProducts(s);
            const rows = this.normalizePackingRowsCache(pk, shipmentProducts);
            const containers = (s.containers || []).filter(c => c.id && (c.container_number || c.seal_number));

            if (!rows.length) {
                area.innerHTML = `
                    <div class="packing-setup-empty">
                        <div class="packing-setup-empty-icon">
                            <i class="fa fa-list-alt"></i>
                        </div>
                        <div class="packing-setup-empty-body">
                            <h4>${this.t('setup_empty_title') || 'Configura primero la estructura del packing'}</h4>
                            <p>${this.t('setup_empty_desc') || 'Antes de capturar filas, indica por producto cuántos bloques se cargarán, cuántas placas/piezas tendrá cada bloque y sube la fotografía correspondiente.'}</p>
                            <button type="button" class="btn-save-section btn-open-packing-setup" data-packing-id="${pk.id}">
                                <i class="fa fa-sliders"></i> ${this.t('setup_open_wizard') || 'Configurar packing'}
                            </button>
                        </div>
                    </div>`;
                area.querySelector('.btn-open-packing-setup')?.addEventListener('click', () => {
                    this.openPackingSetupModal(pk, s);
                });
                return;
            }

            const productsWithRows = shipmentProducts.filter(product => rows.some(r => r.product_id === product.id));

            let html = `
                <div class="packing-top-toolbar">
                    <div class="packing-top-toolbar-left">
                        <span class="packing-toolbar-chip">
                            <i class="fa fa-list"></i> ${rows.length} ${this.t('setup_rows_generated') || 'filas generadas'}
                        </span>
                    </div>
                </div>
                <div class="packing-products-list">`;

            productsWithRows.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const pRows = rows.filter(r => r.product_id === product.id);
                const uniqueBlocks = [...new Set(pRows.map(r => String(r.bloque || '').trim()).filter(Boolean))];
                const isCollapsed = this._isProductCollapsed(pk.id, product.id);

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

                html += `<div class="ps-product-wrapper ${isCollapsed ? 'ps-collapsed' : 'ps-expanded'}" data-product-id="${product.id}" data-pk-id="${pk.id}">`;

                html += `<div class="ps-sticky-block">`;

                html += `<div class="ps-product-sticky-header" data-product-id="${product.id}" data-pk-id="${pk.id}">
                    <div class="ps-header-left">
                        <button type="button" class="ps-toggle-btn" data-product-id="${product.id}" data-pk-id="${pk.id}">
                            <i class="fa ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
                        </button>
                        <div class="ps-header-info">
                            <div class="ps-product-name">
                                ${esc(product.name)}
                                <span class="ps-product-code">${esc(product.code)}</span>
                                <span class="ps-type-badge">${typeLabel}</span>
                            </div>
                            <div class="ps-product-chips">
                                <span class="packing-toolbar-chip"><i class="fa fa-cubes"></i> ${uniqueBlocks.length} ${this.t('setup_blocks_label_short') || 'bloques'}</span>
                                <span class="packing-toolbar-chip"><i class="fa fa-list-ol"></i> ${pRows.length} ${this.t('setup_rows_label_short') || 'filas'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="ps-header-right">
                        <div class="ps-qty-chips">
                            <span class="ps-qty-chip">${this.t('requested')} <strong>${qtyOrdered.toFixed(2)}</strong> ${esc(product.uom || '')}</span>
                            <span class="ps-qty-chip">${this.currentLang === 'es' ? 'Disponible' : 'Available'}: <strong class="${isOverAssigned ? 'text-danger' : ''}">${qtyAvailable.toFixed(2)}</strong></span>
                            <span class="ps-qty-chip">${this.currentLang === 'es' ? 'Embarque' : 'Shipment'}: <strong class="${isOverAssigned ? 'text-danger' : ''}">${qtyCurrent.toFixed(2)}</strong></span>
                            <span class="ps-qty-chip">${this.currentLang === 'es' ? 'Remanente' : 'Remaining'}: <strong class="${isOverAssigned ? 'text-danger' : ''}">${qtyRemainingAfter.toFixed(2)}</strong></span>
                        </div>
                    </div>
                </div>`;

                if (!isCollapsed) {
                    html += `<div class="ps-sticky-thead">
                        <table class="portal-table ps-data-table ps-thead-only" style="margin:0;">
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
                        </table>
                    </div>`;
                }

                html += `</div>`;

                html += `<div class="ps-product-body" style="${isCollapsed ? 'display:none;' : ''}">`;

                html += `<div class="ps-table-scroll">
                    <table class="portal-table ps-data-table ps-tbody-only">
                        <thead style="visibility:collapse;">
                            <tr>
                                <th></th>`;

                if (unitType === 'Placa') {
                    html += `<th></th><th></th><th></th><th></th><th></th><th></th><th></th>`;
                } else if (unitType === 'Formato') {
                    html += `<th></th><th></th><th></th>`;
                } else {
                    html += `<th></th><th></th><th></th><th></th>`;
                }
                html += `<th style="width:60px"></th><th style="width:50px"></th></tr>
                        </thead>
                        <tbody>`;

                let lastBlockName = null;
                let blockIndex = 0;
                const blockColors = ['#6B4226', '#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#be185d'];

                pRows.forEach((row, rowIdx) => {
                    const rid = row._id;
                    const serverRowId = row.id || 0;
                    const hasImage = row.has_image || false;
                    const currentBlock = String(row.bloque || '').trim();

                    // ── Block separator when block name changes ──
                    if (currentBlock && currentBlock !== lastBlockName) {
                        const colCount = unitType === 'Placa' ? 10 : unitType === 'Formato' ? 6 : 7;
                        const blockColor = blockColors[blockIndex % blockColors.length];
                        const rowsInBlock = pRows.filter(r => String(r.bloque || '').trim() === currentBlock).length;
                        html += `<tr class="block-separator-row">
                            <td colspan="${colCount}" style="padding:0;border-bottom:none;">
                                <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 6px;margin-top:${rowIdx === 0 ? '0' : '6px'};">
                                    <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:100px;background:${blockColor};color:#fff;font-size:0.72rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;">
                                        <i class="fa fa-cube"></i> ${esc(currentBlock)}
                                    </span>
                                    <span style="font-size:0.7rem;color:#888;font-weight:600;">${rowsInBlock} ${unitType === 'Placa' ? (this.t('setup_rows_label_short') || 'filas') : (this.t('setup_rows_label_short') || 'filas')}</span>
                                    <span style="flex:1;height:1px;background:linear-gradient(to right, ${blockColor}33, transparent);"></span>
                                </div>
                            </td>
                        </tr>`;
                        lastBlockName = currentBlock;
                        blockIndex++;
                    }

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

                html += `</tbody></table></div>`;

                html += `<div class="table-actions">
                    <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" data-count="1" type="button">
                        ${this.t('btn_add_row')}
                    </button>
                </div>`;

                html += `</div>`;
                html += `</div>`;
            });

            html += `</div>`;
            area.innerHTML = html;
            this.bindPackingRowsEvents(area, pk, s, rowsKey);
            // Block photo sections removed — photos are now managed in the setup modal
            this._adjustStickyTheadPositions(area);
        },

        bindPackingRowsEvents(area, pk, s, rowsKey) {
            if (area._portalEventsBound) return;
            area._portalEventsBound = true;

            area.addEventListener('input', e => {
                if (!e.target.classList.contains('input-field')) return;

                const tr = e.target.closest('tr');
                if (!tr) return;

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

                // Block photo refresh removed — photos managed in setup modal
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
                const openSetupBtn = e.target.closest('.btn-open-packing-setup');
                const toggleProductBtn = e.target.closest('.ps-toggle-btn');
                const stickyHeader = e.target.closest('.ps-product-sticky-header');

                if (openSetupBtn) {
                    this.openPackingSetupModal(pk, s);
                    return;
                }

                if (toggleProductBtn || (stickyHeader && !e.target.closest('button') && !e.target.closest('a'))) {
                    const header = toggleProductBtn ? toggleProductBtn.closest('.ps-product-sticky-header') : stickyHeader;
                    if (!header) return;
                    const productId = asInt(header.dataset.productId);
                    const packingId = asInt(header.dataset.pkId);
                    this._toggleProductCollapsed(packingId, productId);
                    this.renderPackingRows(area, pk, s);
                    return;
                }

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
                    const productPool = this._getShipmentProducts(s);
                    const p = productPool.find(x => x.id === pid) || this.products.find(x => x.id === pid);
                    if (p) {
                        const lastProductRow = [...(this.packingRows[key] || [])].reverse().find(r => r.product_id === pid);
                        for (let i = 0; i < count; i++) {
                            this.packingRows[key].push(this._newProductRow(p, lastProductRow ? {
                                bloque: lastProductRow.bloque || '',
                                atado: lastProductRow.atado || '',
                                container_id: lastProductRow.container_id || 0,
                                quantity: p.unit_type === 'Placa' ? 0 : 1,
                            } : {}));
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
    };
})();