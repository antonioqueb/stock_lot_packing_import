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

    const PAYMENT_DOC_TYPES = [
        { key: 'advance_payment', label_en: 'Advance Payments', label_es: 'Anticipos', label_zh: '预付款', multiple: true, accept: '.pdf', icon: 'fa-money' },
        { key: 'invoice_payment', label_en: 'Invoice Payments', label_es: 'Pagos por Invoice', label_zh: '发票付款', multiple: true, accept: '.pdf', icon: 'fa-credit-card' },
        { key: 'other_payment', label_en: 'Other Payments', label_es: 'Otros Pagos', label_zh: '其他付款', multiple: true, accept: '.pdf', icon: 'fa-bank' },
    ];

    M.constants.DOC_TYPES = { SHIPMENT_DOC_TYPES, SHIPMENT_EXTRA_DOC_TYPES, PAYMENT_DOC_TYPES };

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
        const allTypes = [...SHIPMENT_DOC_TYPES, ...SHIPMENT_EXTRA_DOC_TYPES, ...PAYMENT_DOC_TYPES];
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
            const pct = progress.percent || 0;

            let color = '#dc2626';
            if (pct >= 80) color = '#16a34a';
            else if (pct >= 50) color = '#d97706';
            else if (pct >= 25) color = '#2563eb';

            bar.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
                    <div style="flex:1;background:#e5e5e5;border-radius:8px;height:10px;overflow:hidden;">
                        <div style="width:${pct}%;height:100%;background:${color};border-radius:8px;transition:width 0.5s ease;"></div>
                    </div>
                    <span style="font-weight:700;font-size:0.85rem;color:${color};min-width:45px;text-align:right;">${pct}%</span>
                </div>`;
        },

        // =================================================================
        //  DOCUMENTS TAB (per shipment)
        // =================================================================

        renderDocumentsTab(el, s) {
            const docs = s.documents || [];
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
            const container = document.getElementById('payments-section-content');
            if (!container) return;

            const docs = this.proforma.global_documents || [];
            const lang = this.currentLang;

            let html = '';

            PAYMENT_DOC_TYPES.forEach(dt => {
                const uploaded = docs.filter(d => d.document_type === dt.key);
                html += this._renderDocSlot(dt, uploaded, null, this.proforma.id, lang);
            });

            container.innerHTML = html;
            this._bindDocumentEvents(container, null, this.proforma.id);
        },

        // =================================================================
        //  DOC SLOT RENDER
        // =================================================================

        _renderDocSlot(dt, uploadedDocs, shipmentId, proformaId, lang) {
            const label = getDocLabel(dt.key, lang);
            const hasDoc = uploadedDocs.length > 0;
            const isRequired = dt.required !== false;

            const borderColor = hasDoc ? '#bbf7d0' : (isRequired ? '#fecaca' : '#e5e5e5');
            const bgColor = hasDoc ? '#f0fdf4' : (isRequired ? '#fef2f2' : '#fafafa');

            const statusIcon = hasDoc
                ? '<i class="fa fa-check-circle" style="color:#16a34a;font-size:1rem;"></i>'
                : (isRequired
                    ? '<i class="fa fa-exclamation-circle" style="color:#dc2626;font-size:1rem;"></i>'
                    : '<i class="fa fa-circle-o" style="color:#999;font-size:1rem;"></i>');

            let docsHtml = '';
            uploadedDocs.forEach(doc => {
                docsHtml += `<div style="display:inline-flex;align-items:center;gap:4px;font-size:0.75rem;color:#16a34a;background:#dcfce7;padding:3px 8px;border-radius:12px;border:1px solid #bbf7d0;margin:2px;">
                    <i class="fa fa-file-pdf-o"></i>
                    <span>${esc(doc.name)}</span>
                    ${doc.dpi_value ? '<span style="color:#888;">[' + doc.dpi_value + ' DPI]</span>' : ''}
                    <button type="button" class="btn-delete-doc" data-doc-id="${doc.id}"
                        style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.75rem;padding:0 2px;" title="Eliminar">
                        <i class="fa fa-times"></i>
                    </button>
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
                    try {
                        const res = await jsonRpc('/supplier/api/v2/delete_document', {
                            token: this.token,
                            document_id: docId,
                        });
                        if (res.success) {
                            this.toast(this.t('msg_saved'), 'success');
                            await this.reloadProforma();
                            this.renderAll();
                        } else {
                            this.toast(this.t('msg_error') + (res.message || ''), 'error');
                        }
                    } catch (e) {
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

            let dpiValue = null;
            if (isPdf) {
                dpiValue = await estimatePdfDpi(file);
            }

            try {
                const fileData = await readFileAsBase64(file);
                const res = await jsonRpc('/supplier/api/v2/upload_document', {
                    token: this.token,
                    proforma_id: proformaId,
                    shipment_id: shipmentId,
                    document_type: docType,
                    name: file.name,
                    data: fileData,
                    dpi_value: dpiValue,
                });
                if (res.success) {
                    this.toast(this.t('msg_saved'), 'success');
                    await this.reloadProforma();
                    this.renderAll();
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        },  
    };
    
}
)();