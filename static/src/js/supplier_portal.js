/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script cargado.");

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];
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

                if (!this.data.token) throw new Error("Token no encontrado.");

                console.log(`[Portal] Token: ...${this.data.token.slice(-4)}`);
                
                // 2. ESTRATEGIA DE CARGA DE DATOS (Bidireccional)
                // Prioridad: 
                // A. LocalStorage (Trabajo en curso del usuario no enviado)
                // B. Datos del Servidor (Cargados desde Spreadsheet previo)
                // C. Default (Filas vacías)
                
                const localData = this.loadLocalState();
                const serverData = this.data.existing_rows || [];

                if (localData && localData.length > 0) {
                    console.log("[Portal] Usando datos locales (borrador en progreso).");
                    this.rows = localData;
                    // Recalcular nextId para no pisar IDs
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;

                } else if (serverData.length > 0) {
                    console.log(`[Portal] Usando datos del servidor (${serverData.length} filas recuperadas).`);
                    // Asignar IDs temporales a los datos que vienen del servidor para gestionarlos en el DOM
                    this.rows = serverData.map(r => ({
                        ...r,
                        id: this.nextId++
                    }));
                    // Guardar inmediatamente en local para que sean editables
                    this.saveState();

                } else {
                    console.log("[Portal] Iniciando desde cero (sin datos previos).");
                    if (this.products.length > 0) {
                        this.products.forEach(p => this.createRowInternal(p.id));
                    }
                }

                // 3. RENDERIZADO
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

        // --- GESTIÓN DE ESTADO ---

        loadLocalState() {
            if (!this.data.token) return null;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    return JSON.parse(saved);
                } catch (e) {
                    console.error("Error localStorage", e);
                    return null;
                }
            }
            return null;
        }

        saveState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            localStorage.setItem(key, JSON.stringify(this.rows));
            this.updateTotalsUI(); 
        }

        // --- LÓGICA DE DATOS ---

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

                productRows.forEach(row => {
                    const area = (row.alto * row.ancho).toFixed(2);
                    html += `
                        <tr data-row-id="${row.id}">
                            <td><input type="text" class="short text-uppercase input-field" data-field="contenedor" value="${row.contenedor || ''}" placeholder="CNT01"></td>
                            <td><input type="text" class="short text-uppercase input-field" data-field="bloque" value="${row.bloque || ''}" placeholder="B-01"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="grosor" value="${row.grosor || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="alto" value="${row.alto || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="ancho" value="${row.ancho || ''}"></td>
                            <td><span class="fw-bold text-white area-display">${area}</span></td>
                            <td><input type="text" class="input-field" data-field="color" value="${row.color || ''}" placeholder="Opcional"></td>
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
            const submitBtn = document.getElementById('btn-submit-pl');
            
            const newContainer = container.cloneNode(true);
            container.parentNode.replaceChild(newContainer, container);
            
            const activeContainer = document.getElementById('portal-rows-container');

            activeContainer.addEventListener('input', (e) => {
                if (e.target.classList.contains('input-field')) {
                    const tr = e.target.closest('tr');
                    const rowId = tr.dataset.rowId;
                    const field = e.target.dataset.field;
                    this.updateRowData(rowId, field, e.target.value);
                    
                    if (field === 'alto' || field === 'ancho') {
                        const row = this.rows.find(r => r.id === parseInt(rowId));
                        const areaSpan = tr.querySelector('.area-display');
                        if (areaSpan) areaSpan.innerText = (row.alto * row.ancho).toFixed(2);
                        this.updateTotalsUI();
                    }
                }
            });

            activeContainer.addEventListener('click', (e) => {
                const target = e.target;
                
                const delBtn = target.closest('.btn-delete');
                if (delBtn) {
                    this.deleteRowInternal(delBtn.closest('tr').dataset.rowId);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                const addBtn = target.closest('.action-add');
                if (addBtn) {
                    this.createRowInternal(parseInt(addBtn.dataset.productId));
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                const addMulti = target.closest('.action-add-multi');
                if (addMulti) {
                    const pid = parseInt(addMulti.dataset.productId);
                    for(let i=0; i<5; i++) this.createRowInternal(pid);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                }
            });

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
                btn.disabled = count === 0;
                btn.style.opacity = count === 0 ? '0.5' : '1';
                btn.style.cursor = count === 0 ? 'not-allowed' : 'pointer';
            }
        }

        async submitData() {
            if (!confirm("¿Está seguro de enviar el Packing List?")) return;
            const btn = document.getElementById('btn-submit-pl');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...';
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

            try {
                const res = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { token: this.data.token, rows: cleanData },
                        id: Math.floor(Math.random()*1000)
                    })
                });
                const result = await res.json();
                if (result.result && result.result.success) {
                    alert("✅ Enviado correctamente. Se ha actualizado el documento en Odoo.");
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