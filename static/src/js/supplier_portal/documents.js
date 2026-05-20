(function () {
    "use strict";

    const M = window.SupplierPortalModules;
    const { esc, jsonRpc, readFileAsBase64 } = M.utils;

    // Document type definitions
    const SHIPMENT_DOC_TYPES = [
        { key: 'bl', label_en: 'Bill of Lading (B/L)', label_es: 'Conocimiento de Embarque (B/L)', label_zh: '提单 (B/L)', required: true, accept: '.pdf', icon: 'fa-file-text' },
        { key: 'invoice', label_en: 'Invoice', label_es: 'Invoice / Factura', label_zh: '发票', required: true, accept: '.pdf', icon: 'fa-file-text-o' },
        { key: 'packing_list', label_en: 'Packing List', label_es: 'Packing List', label_zh: '装箱单', required: true, accept: '.pdf,.xlsx,.xls,.csv', icon: 'fa-list-alt' },
    ];

    const SHIPMENT_EXTRA_DOC_TYPES = [
        { key: 'eur1', label_en: 'EUR1', label_es: 'EUR1', label_zh: 'EUR1', required: false, accept: '.pdf', icon: 'fa-certificate' },
        { key: 'certificate_origin', label_en: 'Certificate of Origin', label_es: 'Certificado de Origen', label_zh: '原产地证书', required: false, accept: '.pdf', icon: 'fa-globe' },
        { key: 'fumigation', label_en: 'Fumigation Certificate', label_es: 'Comprobante de Fumigacion', label_zh: '熏蒸证书', required: false, accept: '.pdf', icon: 'fa-leaf' },
    ];

    M.constants.DOC_TYPES = { SHIPMENT_DOC_TYPES, SHIPMENT_EXTRA_DOC_TYPES };

    /**
     * Extracts DPI from a PDF file using image metadata heuristics.
     * Looks for /XObject image Width/Height vs MediaBox to estimate DPI.
     * Returns 0 if unable to determine.
     */
    async function estimatePdfDpi(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const text = new TextDecoder('latin1').decode(bytes);

            const mediaBoxMatch = text.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
            if (!mediaBoxMatch) return 0;

            const pageWidthPt = parseFloat(mediaBoxMatch[3]) - parseFloat(mediaBoxMatch[1]);
            const pageHeightPt = parseFloat(mediaBoxMatch[4]) - parseFloat(mediaBoxMatch[2]);

            if (pageWidthPt <= 0 || pageHeightPt <= 0) return 0;

            const pageWidthIn = pageWidthPt / 72.0;
            const pageHeightIn = pageHeightPt / 72.0;

            const widthMatches = [...text.matchAll(/\/Width\s+(\d+)/g)];
            const heightMatches = [...text.matchAll(/\/Height\s+(\d+)/g)];

            if (widthMatches.length === 0) return 0;

            let maxDpi = 0;
            for (let i = 0; i < Math.min(widthMatches.length, heightMatches.length); i++) {
                const imgW = parseInt(widthMatches[i][1], 10);
                const imgH = parseInt(heightMatches[i][1], 10);

                if (imgW > 100 && imgH > 100) {
                    const dpiW = imgW / pageWidthIn;
                    const dpiH = imgH / pageHeightIn;
                    const avgDpi = (dpiW + dpiH) / 2;
                    if (avgDpi > maxDpi) maxDpi = avgDpi;
                }
            }

            return Math.round(maxDpi);
        } catch (e) {
            console.warn('[Portal] DPI estimation failed:', e.message);
            return 0;
        }
    }

    function getDocLabel(docType, lang) {
        const allTypes = [...SHIPMENT_DOC_TYPES, ...SHIPMENT_EXTRA_DOC_TYPES];
        const def = allTypes.find(d => d.key === docType);
        if (!def) return docType;
        if (lang === 'es') return def.label_es;
        if (lang === 'zh') return def.label_zh;
        return def.label_en;
    }

    M.mixins.DocumentsMixin = {

        // =================================================================
        //  PROGRESS BAR
        // =================================================================

        renderProgressBar() {
            const bar = document.getElementById('progress-bar-container');
            if (!bar) return;

            const progress = this.proforma.progress || { percent: 0 };
            const pct = Math.max(0, Math.min(100, progress.percent || 0));

            let color = '#dc2626';
            if (pct >= 100) {
                color = '#16a34a';
            } else if (pct >= 75) {
                color = '#65a30d';
            } else if (pct >= 50) {
                color = '#d97706';
            } else if (pct >= 25) {
                color = '#2563eb';
            }

            const fill = bar.querySelector('.portal-progress-fill');
            if (!fill) return;

            fill.style.width = `${pct}%`;
            fill.style.background = color;
        },

        // =================================================================
        //  DOCUMENTS TAB (per shipment)
        // =================================================================

        renderDocumentsTab(el, s) {
            const docs = this._getDisplayDocuments ? this._getDisplayDocuments(s) : (s.documents || []);
            const lang = this.currentLang;

            let html = '';

            html += `<h4 style="margin:0 0 12px;font-size:0.88rem;color:#111;font-weight:700;">
                <i class="fa fa-file-pdf-o" style="color:#dc2626;"></i>
                ${lang === 'es' ? 'Documentos Obligatorios' : lang === 'zh' ? '必填文件' : 'Required Documents'}
            </h4>`;

            SHIPMENT_DOC_TYPES.forEach(dt => {
                const uploaded = docs.filter(d => d.document_type === dt.key);
                html += this._renderDocSlot(dt, uploaded, s.id, null, lang);
            });

            html += `<h4 style="margin:20px 0 12px;font-size:0.88rem;color:#111;font-weight:700;">
                <i class="fa fa-folder-open" style="color:#6B4226;"></i>
                ${lang === 'es' ? 'Documentacion' : lang === 'zh' ? '文档' : 'Documentation'}
            </h4>`;

            SHIPMENT_EXTRA_DOC_TYPES.forEach(dt => {
                const uploaded = docs.filter(d => d.document_type === dt.key);
                html += this._renderDocSlot(dt, uploaded, s.id, null, lang);
            });

            el.innerHTML = html;
            this._bindDocumentEvents(el, s.id, null);
        },

        // =================================================================
        //  PAYMENTS SECTION (global, below shipments)
        // =================================================================

        renderPaymentsSection() {
            // Los pagos ya no se gestionan desde el portal.
            return;
        },

        // =================================================================
        //  DOC SLOT RENDER
        // =================================================================

        _renderDocSlot(dt, uploadedDocs, shipmentId, proformaId, lang) {
            const label = getDocLabel(dt.key, lang);
            const hasServerDoc = uploadedDocs.some(d => !d._pending && !d._error && !d._deleting);
            const hasPendingDoc = uploadedDocs.some(d => d._pending || d._deleting);
            const hasErrorDoc = uploadedDocs.some(d => d._error);
            const hasDoc = hasServerDoc || hasPendingDoc;
            const isRequired = dt.required !== false;

            const borderColor = hasServerDoc
                ? '#bbf7d0'
                : hasPendingDoc
                    ? '#fde68a'
                    : hasErrorDoc
                        ? '#fecaca'
                        : (isRequired ? '#fecaca' : '#e5e5e5');
            const bgColor = hasServerDoc
                ? '#f0fdf4'
                : hasPendingDoc
                    ? '#fffbeb'
                    : hasErrorDoc
                        ? '#fef2f2'
                        : (isRequired ? '#fef2f2' : '#fafafa');

            const statusIcon = hasServerDoc
                ? '<i class="fa fa-check-circle" style="color:#16a34a;font-size:1rem;"></i>'
                : hasPendingDoc
                    ? '<i class="fa fa-spinner fa-spin" style="color:#d97706;font-size:1rem;"></i>'
                    : (isRequired
                        ? '<i class="fa fa-exclamation-circle" style="color:#dc2626;font-size:1rem;"></i>'
                        : '<i class="fa fa-circle-o" style="color:#999;font-size:1rem;"></i>');

            let docsHtml = '';
            uploadedDocs.forEach(doc => {
                const pending = !!doc._pending;
                const deleting = !!doc._deleting;
                const failed = !!doc._error;
                const chipColor = failed ? '#dc2626' : pending || deleting ? '#d97706' : '#16a34a';
                const chipBg = failed ? '#fef2f2' : pending || deleting ? '#fffbeb' : '#dcfce7';
                const chipBorder = failed ? '#fecaca' : pending || deleting ? '#fde68a' : '#bbf7d0';
                const icon = failed
                    ? 'fa-exclamation-triangle'
                    : pending || deleting
                        ? 'fa-spinner fa-spin'
                        : 'fa-file-pdf-o';
                const status = failed
                    ? (doc._error_message ? ` — ${esc(doc._error_message)}` : '')
                    : pending
                        ? (lang === 'es' ? ' — subiendo' : lang === 'zh' ? ' — 上传中' : ' — uploading')
                        : deleting
                            ? (lang === 'es' ? ' — eliminando' : lang === 'zh' ? ' — 删除中' : ' — deleting')
                            : '';

                docsHtml += `<div style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:${chipColor};background:${chipBg};padding:3px 8px;border-radius:12px;border:1px solid ${chipBorder};margin:2px;max-width:100%;">
                    <i class="fa ${icon}"></i>
                    <span style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(doc.name)}${status}</span>
                    ${doc.dpi_value ? '<span style="color:#888;">[' + doc.dpi_value + ' DPI]</span>' : ''}
                    ${(!pending && !failed && !deleting && doc.id) ? `<button type="button" class="btn-delete-doc" data-doc-id="${doc.id}"
                        style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.75rem;padding:0 2px;" title="Eliminar">
                        <i class="fa fa-times"></i>
                    </button>` : ''}
                </div>`;
            });

            const dataAttrs = shipmentId
                ? `data-shipment-id="${shipmentId}"`
                : `data-proforma-id="${proformaId}"`;

            const acceptAttr = dt.accept || '.pdf';

            return `<div class="doc-slot" style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px;background:${bgColor};border:1px solid ${borderColor};border-radius:8px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:8px;min-width:200px;">
                    ${statusIcon}
                    <i class="fa ${dt.icon}" style="color:#6B4226;"></i>
                    <strong style="font-size:0.82rem;color:#1f2937;">${esc(label)}</strong>
                    ${isRequired ? '<span style="color:#dc2626;font-size:0.65rem;font-weight:700;">*</span>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;">
                    ${docsHtml}
                </div>
                <label style="cursor:pointer;margin:0;display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border:1.5px dashed ${hasDoc && !dt.multiple ? '#d4d4d0' : '#6B4226'};border-radius:6px;font-size:0.78rem;color:#6B4226;background:#fff;">
                    <i class="fa fa-upload"></i>
                    ${lang === 'es' ? 'Subir' : lang === 'zh' ? '上传' : 'Upload'}
                    <input type="file" accept="${acceptAttr}" class="doc-file-input"
                        data-doc-type="${dt.key}"
                        ${dataAttrs}
                        style="display:none"
                        ${dt.multiple ? 'multiple' : ''}/>
                </label>
            </div>`;
        },

        _refreshDocumentsUI(shipmentId) {
            const freshS = this._getFreshShipment ? this._getFreshShipment(shipmentId) : null;
            const shipment = freshS || (this.proforma.shipments || []).find(s => s.id === shipmentId);
            if (!shipment) return;

            const block = document.querySelector(`.shipment-block[data-shipment-id="${shipmentId}"]`);
            if (block) {
                this.updateShipmentBlockHeader(block, shipment);
                this._updateShipmentBodyRef?.(shipmentId, shipment);
            }

            const el = document.getElementById(`stab-documents-${shipmentId}`);
            if (el && el.classList.contains('active')) {
                this.renderDocumentsTab(el, shipment);
            }

            this.renderProgressBar();
        },

        // =================================================================
        //  BIND DOCUMENT EVENTS
        // =================================================================

        _bindDocumentEvents(container, defaultShipmentId, defaultProformaId) {
            container.querySelectorAll('.doc-file-input').forEach(input => {
                if (input._docBound) return;
                input._docBound = true;

                input.addEventListener('change', async (e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;

                    const docType = input.dataset.docType;
                    const shipmentId = parseInt(input.dataset.shipmentId, 10) || defaultShipmentId;
                    const proformaId = parseInt(input.dataset.proformaId, 10) || defaultProformaId;

                    for (let i = 0; i < files.length; i++) {
                        await this._processDocUpload(files[i], docType, shipmentId, proformaId);
                    }

                    e.target.value = '';
                });
            });

            container.querySelectorAll('.btn-delete-doc').forEach(btn => {
                if (btn._docBound) return;
                btn._docBound = true;

                btn.addEventListener('click', async () => {
                    const lang = this.currentLang;
                    const msg = lang === 'es' ? 'Eliminar este documento?' : 'Delete this document?';
                    if (!confirm(msg)) return;

                    const docId = parseInt(btn.dataset.docId, 10);
                    const shipmentId = parseInt(btn.closest('.doc-slot')?.querySelector('.doc-file-input')?.dataset.shipmentId, 10) || defaultShipmentId;

                    const shipment = this._getFreshShipment ? this._getFreshShipment(shipmentId) : (this.proforma.shipments || []).find(s => s.id === shipmentId);
                    let removedDoc = null;
                    let removedIdx = -1;

                    // LIVE-PORTAL-003:
                    // Eliminación optimista: se marca inmediatamente para que el usuario
                    // no tenga que esperar el roundtrip del backend.
                    if (shipment && Array.isArray(shipment.documents)) {
                        removedIdx = shipment.documents.findIndex(d => parseInt(d.id, 10) === docId);
                        if (removedIdx >= 0) {
                            removedDoc = { ...shipment.documents[removedIdx] };
                            shipment.documents[removedIdx] = {
                                ...shipment.documents[removedIdx],
                                _deleting: true,
                            };
                            this._refreshDocumentsUI(shipmentId);
                        }
                    }

                    try {
                        const res = await jsonRpc('/supplier/api/v2/delete_document', {
                            token: this.token,
                            document_id: docId,
                        });

                        if (res.success) {
                            if (shipment && Array.isArray(res.documents)) {
                                shipment.documents = res.documents;
                            }
                            await this.reloadProforma({ preservePackingRows: true });
                            this.renderAll();
                            this.toast(this.t('msg_saved'), 'success');
                        } else {
                            if (shipment && removedDoc && removedIdx >= 0) {
                                shipment.documents[removedIdx] = removedDoc;
                                this._refreshDocumentsUI(shipmentId);
                            }
                            this.toast(this.t('msg_error') + (res.message || ''), 'error');
                        }
                    } catch (e) {
                        if (shipment && removedDoc && removedIdx >= 0) {
                            shipment.documents[removedIdx] = removedDoc;
                            this._refreshDocumentsUI(shipmentId);
                        }
                        this.toast(this.t('msg_error') + e.message, 'error');
                    }
                });
            });
        },

        // =================================================================
        //  PROCESS SINGLE DOC UPLOAD
        // =================================================================

        async _processDocUpload(file, docType, shipmentId, proformaId) {
            const lang = this.currentLang;

            if (file.size > 15 * 1024 * 1024) {
                this.toast(lang === 'es' ? 'Archivo demasiado grande (max 15MB)' : 'File too large (max 15MB)', 'error');
                return;
            }

            const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
            const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(file.name);

            if (docType !== 'packing_list' && !isPdf) {
                this.toast(
                    lang === 'es' ? 'Solo se permiten archivos PDF.' : 'Only PDF files are allowed.',
                    'error'
                );
                return;
            }

            if (docType === 'packing_list' && !isPdf && !isSpreadsheet) {
                this.toast(
                    lang === 'es' ? 'Solo PDF u hojas de calculo.' : 'Only PDF or spreadsheet files.',
                    'error'
                );
                return;
            }

            let dpiValue = 0;
            if (isPdf) {
                dpiValue = await estimatePdfDpi(file);
            }

            const pendingId = this.makeClientId ? this.makeClientId('doc') : `doc_${Date.now()}`;
            const pendingDoc = {
                id: pendingId,
                _client_id: pendingId,
                _pending: true,
                document_type: docType,
                name: file.name,
                file_size: file.size || 0,
                mime_type: file.type || '',
                dpi_value: dpiValue || 0,
                upload_token: '',
                notes: '',
            };

            // LIVE-PORTAL-002:
            // UI optimista: el documento aparece en la pestaña en cuanto el usuario lo
            // selecciona. Si el backend falla, el chip cambia a error en lugar de
            // desaparecer silenciosamente.
            if (shipmentId) {
                this._addPendingDocument?.(shipmentId, pendingDoc);
                this._refreshDocumentsUI(shipmentId);
            }

            try {
                const fileData = await readFileAsBase64(file);

                const res = await jsonRpc('/supplier/api/v2/upload_document', {
                    token: this.token,
                    shipment_id: shipmentId || false,
                    document_type: docType,
                    file_name: file.name,
                    file_data: fileData.data,
                    file_size: file.size || 0,
                    mime_type: file.type || '',
                    dpi_value: dpiValue || 0,
                    notes: '',
                });

                if (res.success) {
                    this._removePendingDocument?.(shipmentId, pendingId);

                    const shipment = this._getFreshShipment ? this._getFreshShipment(shipmentId) : (this.proforma.shipments || []).find(s => s.id === shipmentId);
                    if (shipment && Array.isArray(res.documents)) {
                        shipment.documents = res.documents;
                    }

                    await this.reloadProforma({ preservePackingRows: true });
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this._updatePendingDocument?.(shipmentId, pendingId, {
                        _pending: false,
                        _error: true,
                        _error_message: res.message || '',
                    });
                    this._refreshDocumentsUI(shipmentId);
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this._updatePendingDocument?.(shipmentId, pendingId, {
                    _pending: false,
                    _error: true,
                    _error_message: e.message || '',
                });
                this._refreshDocumentsUI(shipmentId);
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },
    };

})();