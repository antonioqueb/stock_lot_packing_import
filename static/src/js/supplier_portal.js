/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script cargado.");

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];
            this.header = {}; 
            this.nextId = 1;
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        init() {
            console.log("[Portal] Iniciando...");
            
            try {
                // 1. LEER DATOS DEL DOM
                const dataEl = document.getElementById('portal-data-store');
                if (!dataEl) throw new Error("Datos no encontrados en HTML.");
                const rawJson = dataEl.dataset.payload;
                if (!rawJson) throw new Error("Payload vacío.");

                this.data = JSON.parse(rawJson);
                this.products = this.data.products || [];
                
                // CARGA INICIAL DESDE SERVIDOR (Odoo)
                const serverHeader = this.data.header || {};
                this.header = { ...serverHeader };

                if (!this.data.token) throw new Error("Token no encontrado.");

                console.log(`[Portal] Token: ...${this.data.token.slice(-4)}`);
                
                // 2. RECUPERAR MEMORIA LOCAL
                const localData = this.loadLocalState();
                
                // --- FUSIÓN DE CABECERA ---
                if (localData && localData.header) {
                    for (const [key, val] of Object.entries(localData.header)) {
                        const isZero = val === 0 || val === "0" || val === 0.0;
                        if (val !== "" && val !== null && val !== undefined && !isZero) {
                            this.header[key] = val;
                        }
                    }
                }

                // --- ESTRATEGIA DE CARGA DE FILAS ---
                const serverRows = this.data.existing_rows || [];

                if (localData && localData.rows && localData.rows.length > 0) {
                    // Prioridad 1: Datos locales
                    console.log("[Portal] Usando filas locales.");
                    this.rows = localData.rows;
                    
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;

                } else if (serverRows.length > 0) {
                    // Prioridad 2: Datos del servidor
                    console.log(`[Portal] Usando filas del servidor.`);
                    this.rows = serverRows.map(r => ({
                        ...r,
                        id: this.nextId++
                    }));
                    this.saveState();

                } else {
                    // Prioridad 3: Inicio limpio
                    console.log("[Portal] Iniciando desde cero.");
                    if (this.products.length > 0) {
                        this.products.forEach(p => this.createRowInternal(p.id));
                    }
                }

                // 3. RENDERIZADO EN PANTALLA
                this.fillHeaderForm();
                this.render();         
                this.bindGlobalEvents();

                console.log("[Portal] ✅ Interfaz lista.");

            } catch (error) {
                console.error("[Portal] 🛑 Error Fatal:", error);
                const container = document.getElementById('portal-rows-container');
                if (container) {
                    container.innerHTML = `<div class="alert alert-danger text-center p-5"><h4>Error</h4><p>${error.message}</p></div>`;
                }
            }
        }

        // --- GESTIÓN DE ESTADO (LOCAL STORAGE) ---

        loadLocalState() {
            if (!this.data.token) return null;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        return { rows: parsed, header: {} };
                    }
                    return parsed;
                } catch (e) {
                    console.error("Error leyendo localStorage", e);
                    return null;
                }
            }
            return null;
        }

        saveState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            
            const state = {
                rows: this.rows,
                header: this.getHeaderDataFromDOM() 
            };
            
            localStorage.setItem(key, JSON.stringify(state));
            this.updateTotalsUI(); 
        }

        // --- CABECERA (Lectura/Escritura DOM) ---

        fillHeaderForm() {
            const map = {
                'h-invoice': 'invoice_number',
                'h-date': 'shipment_date',
                'h-proforma': 'proforma_number',
                'h-bl': 'bl_number',
                'h-origin': 'origin',
                'h-dest': 'destination',
                'h-country': 'country_origin',
                'h-vessel': 'vessel',
                'h-incoterm': 'incoterm_payment',
                'h-desc': 'merchandise_desc',
                'h-cont-no': 'container_no',
                'h-seal': 'seal_no',
                'h-type': 'container_type',
                'h-status': 'status',
                'h-pkgs': 'total_packages',
                'h-weight': 'gross_weight',
                'h-volume': 'volume'
            };

            for (const [domId, dataKey] of Object.entries(map)) {
                const el = document.getElementById(domId);
                if (el && this.header[dataKey] !== undefined && this.header[dataKey] !== null) {
                    el.value = this.header[dataKey];
                }
            }
        }

        getHeaderDataFromDOM() {
            return {
                invoice_number: document.getElementById('h-invoice')?.value || "",
                shipment_date: document.getElementById('h-date')?.value || "",
                proforma_number: document.getElementById('h-proforma')?.value || "",
                bl_number: document.getElementById('h-bl')?.value || "",
                origin: document.getElementById('h-origin')?.value || "",
                destination: document.getElementById('h-dest')?.value || "",
                country_origin: document.getElementById('h-country')?.value || "",
                vessel: document.getElementById('h-vessel')?.value || "",
                incoterm_payment: document.getElementById('h-incoterm')?.value || "",
                merchandise_desc: document.getElementById('h-desc')?.value || "",
                container_no: document.getElementById('h-cont-no')?.value || "",
                seal_no: document.getElementById('h-seal')?.value || "",
                container_type: document.getElementById('h-type')?.value || "",
                status: document.getElementById('h-status')?.value || "",
                total_packages: document.getElementById('h-pkgs')?.value || 0,
                gross_weight: document.getElementById('h-weight')?.value || 0.0,
                volume: document.getElementById('h-volume')?.value || 0.0,
            };
        }

        // --- LÓGICA DE FILAS (CRUD) ---

        createRowInternal(productId) {
            const productRows = this.rows.filter(r => r.product_id === productId);
            let defaults = { contenedor: '', bloque: '', grosor: 0 };
            
            if (productRows.length > 0) {
                const last = productRows[productRows.length - 1];
                defaults = { 
                    contenedor: last.contenedor, 
                    bloque: last.bloque, 
                    grosor: last.grosor 
                };
            }

            const newRow = {
                id: this.nextId++,
                product_id: productId,
                contenedor: defaults.contenedor,
                bloque: defaults.bloque,
                grosor: defaults.grosor,
                alto: 0,
                ancho: 0,
                color: '',
                ref_prov: ''
            };
            
            this.rows.push(newRow);
            return newRow;
        }

        deleteRowInternal(id) {
            this.rows = this.rows.filter(r => r.id !== parseInt(id));
        }

        updateRowData(id, field, value) {
            const row = this.rows.find(r => r.id === parseInt(id));
            if (row) {
                if (['grosor', 'alto', 'ancho'].includes(field)) {
                    row[field] = parseFloat(value) || 0;
                } else {
                    row[field] = value;
                }
                this.saveState();
            }
        }

        fillDownInternal(rowId, field) {
            const sourceId = parseInt(rowId);
            const sourceRow = this.rows.find(r => r.id === sourceId);
            
            if (!sourceRow) return;

            const valueToCopy = sourceRow[field];
            const productId = sourceRow.product_id;
            let startCopying = false;

            // Iteramos sobre las filas del mismo producto
            // Empezamos a copiar SOLO después de encontrar la fila origen
            let updatedCount = 0;

            this.rows.forEach(r => {
                if (r.id === sourceId) {
                    startCopying = true; // Habilitar bandera, copiar en las SIGUIENTES
                } else if (startCopying && r.product_id === productId) {
                    r[field] = valueToCopy;
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                this.saveState();
                this.render();
                this.bindGlobalEvents();
                // Feedback visual sutil (opcional)
                console.log(`[Portal] Copiado '${valueToCopy}' a ${updatedCount} filas.`);
            }
        }

        // --- RENDERIZADO ---

        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) return;

            if (this.products.length === 0) {
                container.innerHTML = '<div class="alert alert-warning text-center p-5">No hay productos pendientes de recepción en esta orden.</div>';
                return;
            }

            let html = '';

            this.products.forEach(product => {
                const productRows = this.rows.filter(r => r.product_id === product.id);
                
                html += `
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3>${product.name} <span class="text-muted small ms-2">(${product.code})</span></h3>
                            </div>
                            <div class="meta">
                                Solicitado: <strong class="text-white">${product.qty_ordered} ${product.uom}</strong>
                            </div>
                        </div>

                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>
                                        <th>Contenedor</th>
                                        <th>Bloque</th>
                                        <th>Grosor (cm)</th>
                                        <th>Alto (m)</th>
                                        <th>Ancho (m)</th>
                                        <th>Área (m²)</th>
                                        <th>Color / Notas</th>
                                        <th style="width: 50px;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                // Helper para generar el grupo input+botón
                const renderInput = (rowId, field, value, placeholder = "", type = "text", step = "", cssClass = "") => {
                    return `
                        <div class="input-group-portal">
                            <input type="${type}" step="${step}" class="input-field ${cssClass}" 
                                   data-field="${field}" value="${value || ''}" placeholder="${placeholder}">
                            <button type="button" class="btn-fill-down" data-row-id="${rowId}" data-field="${field}" title="Copiar hacia abajo">
                                <i class="fa fa-arrow-down"></i>
                            </button>
                        </div>
                    `;
                };

                productRows.forEach(row => {
                    const area = (row.alto * row.ancho).toFixed(2);
                    
                    html += `
                        <tr data-row-id="${row.id}">
                            <td>${renderInput(row.id, 'contenedor', row.contenedor, 'CNT01', 'text', '', 'short text-uppercase')}</td>
                            <td>${renderInput(row.id, 'bloque', row.bloque, 'B-01', 'text', '', 'short text-uppercase')}</td>
                            <td>${renderInput(row.id, 'grosor', row.grosor, '', 'number', '0.01', 'short')}</td>
                            <td>${renderInput(row.id, 'alto', row.alto, '', 'number', '0.01', 'short')}</td>
                            <td>${renderInput(row.id, 'ancho', row.ancho, '', 'number', '0.01', 'short')}</td>
                            
                            <td><span class="fw-bold text-white area-display">${area}</span></td>
                            
                            <td>${renderInput(row.id, 'color', row.color, 'Opcional')}</td>
                            
                            <td class="text-center">
                                <button class="btn-action btn-delete" type="button"><i class="fa fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                });

                html += `
                                </tbody>
                            </table>
                            <div class="mt-2">
                                <button class="btn-add-row action-add" data-product-id="${product.id}" type="button">
                                    <i class="fa fa-plus-circle"></i> Agregar Placa
                                </button>
                                <button class="btn-add-row ms-2 action-add-multi" data-product-id="${product.id}" type="button">
                                    +5 Filas
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
            this.updateTotalsUI();
        }

        bindGlobalEvents() {
            const container = document.getElementById('portal-rows-container');
            const headerForm = document.getElementById('shipment-info-form');
            const submitBtn = document.getElementById('btn-submit-pl');
            
            // Clonar nodos para limpiar eventos antiguos
            const newContainer = container.cloneNode(true);
            container.parentNode.replaceChild(newContainer, container);
            
            const activeContainer = document.getElementById('portal-rows-container');

            // 1. Inputs Tabla (Change & Input)
            activeContainer.addEventListener('input', (e) => {
                if (e.target.classList.contains('input-field')) {
                    const tr = e.target.closest('tr');
                    const rowId = tr.dataset.rowId;
                    const field = e.target.dataset.field;
                    this.updateRowData(rowId, field, e.target.value);
                    
                    if (field === 'alto' || field === 'ancho') {
                        const row = this.rows.find(r => r.id === parseInt(rowId));
                        const areaSpan = tr.querySelector('.area-display');
                        if (areaSpan && row) {
                            areaSpan.innerText = (row.alto * row.ancho).toFixed(2);
                        }
                        this.updateTotalsUI();
                    }
                }
            });

            // 2. Click Buttons Tabla (Delete, Add, AddMulti, FILL DOWN)
            activeContainer.addEventListener('click', (e) => {
                const target = e.target;
                
                // --- BOTÓN FILL DOWN ---
                const fillBtn = target.closest('.btn-fill-down');
                if (fillBtn) {
                    const rowId = fillBtn.dataset.rowId;
                    const field = fillBtn.dataset.field;
                    this.fillDownInternal(rowId, field);
                    return;
                }

                // --- BOTÓN ELIMINAR ---
                const delBtn = target.closest('.btn-delete');
                if (delBtn) {
                    this.deleteRowInternal(delBtn.closest('tr').dataset.rowId);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                // --- BOTÓN AGREGAR ---
                const addBtn = target.closest('.action-add');
                if (addBtn) {
                    this.createRowInternal(parseInt(addBtn.dataset.productId));
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                // --- BOTÓN AGREGAR MULTI ---
                const addMulti = target.closest('.action-add-multi');
                if (addMulti) {
                    const pid = parseInt(addMulti.dataset.productId);
                    for(let i=0; i<5; i++) this.createRowInternal(pid);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                }
            });

            // 3. Inputs Header (Auto-save local al escribir)
            if (headerForm) {
                const newHeaderForm = headerForm.cloneNode(true);
                headerForm.parentNode.replaceChild(newHeaderForm, headerForm);
                
                document.getElementById('shipment-info-form').addEventListener('input', () => {
                    this.saveState();
                });
            }

            // 4. Submit
            if (submitBtn) {
                const newBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newBtn, submitBtn);
                newBtn.addEventListener('click', () => this.submitData());
            }
        }

        updateTotalsUI() {
            const validRows = this.rows.filter(r => r.alto > 0 && r.ancho > 0);
            const count = validRows.length;
            const totalArea = validRows.reduce((acc, r) => acc + (r.alto * r.ancho), 0);

            const countEl = document.getElementById('total-plates');
            const areaEl = document.getElementById('total-area');
            const btn = document.getElementById('btn-submit-pl');

            if (countEl) countEl.innerText = count;
            if (areaEl) areaEl.innerText = totalArea.toFixed(2);
            
            if (btn) {
                btn.removeAttribute('disabled');
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }

        async submitData() {
            if (!confirm("¿Guardar y enviar los datos a Odoo?")) return;

            const btn = document.getElementById('btn-submit-pl');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i> Guardando...';
            btn.disabled = true;

            const cleanData = this.rows
                .filter(r => r.alto > 0 && r.ancho > 0)
                .map(r => ({
                    product_id: r.product_id,
                    contenedor: r.contenedor,
                    bloque: r.bloque,
                    grosor: r.grosor,
                    alto: r.alto,
                    ancho: r.ancho,
                    color: r.color,
                    tipo: 'placa'
                }));

            const headerData = this.getHeaderDataFromDOM();

            try {
                const res = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { 
                            token: this.data.token, 
                            rows: cleanData,
                            header: headerData 
                        },
                        id: Math.floor(Math.random()*1000)
                    })
                });

                const result = await res.json();
                
                if (result.result && result.result.success) {
                    alert("✅ Guardado correctamente.");
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error?.data?.message || result.result?.message || "Error desconocido";
                    alert("❌ Error: " + msg);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert("Error de conexión");
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    window.supplierPortal = new SupplierPortal();
})();