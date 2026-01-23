/* static/src/js/supplier_portal.js */
/* NOTA: No agregamos header de odoo-module para que corra como JS nativo */

(function () {
    "use strict";

    console.log("[Portal] 🚀 Cargando script JS...");

    class SupplierPortal {
        constructor() {
            this.data = window.portalData || {};
            this.products = this.data.products || [];
            this.rows = [];
            this.nextId = 1;
            
            // Detección del estado del DOM para iniciar
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        init() {
            console.log("[Portal] Ejecutando init()...");
            
            try {
                // 1. Validaciones iniciales
                if (!window.portalData) {
                    throw new Error("No se recibieron datos del servidor (window.portalData es undefined).");
                }
                
                if (!this.data.token) {
                    console.error("[Portal] Token no encontrado.");
                    // No lanzamos error fatal aquí para permitir debug, pero es crítico
                }

                // 2. Cargar estado local (localStorage)
                this.loadLocalState();

                // 3. Si no hay filas guardadas, crear filas por defecto
                console.log(`[Portal] Productos encontrados: ${this.products.length}`);
                if (this.rows.length === 0 && this.products.length > 0) {
                    console.log("[Portal] Generando filas iniciales...");
                    this.products.forEach(p => this.createRowInternal(p.id));
                }

                // 4. Renderizar
                this.render();
                
                // 5. Vincular eventos
                this.bindGlobalEvents();

                console.log("[Portal] ✅ Inicialización completa.");

            } catch (error) {
                console.error("[Portal] 🛑 Error CRÍTICO en init():", error);
                const container = document.getElementById('portal-rows-container');
                if (container) {
                    container.innerHTML = `
                        <div class="alert alert-danger text-center">
                            <h4>Error de carga</h4>
                            <p>${error.message}</p>
                            <small>Revise la consola del navegador (F12) para más detalles.</small>
                        </div>
                    `;
                }
            }
        }

        // --- GESTIÓN DE ESTADO ---

        loadLocalState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    this.rows = JSON.parse(saved);
                    if (this.rows.length > 0) {
                        const maxId = this.rows.reduce((max, r) => Math.max(max, r.id), 0);
                        this.nextId = maxId + 1;
                    }
                    console.log(`[Portal] ${this.rows.length} filas recuperadas de memoria.`);
                } catch (e) {
                    console.error("[Portal] Error leyendo localStorage:", e);
                    this.rows = [];
                }
            }
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

        // --- RENDERIZADO (HTML) ---

        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) {
                console.warn("[Portal] No se encontró el contenedor #portal-rows-container");
                return;
            }

            if (this.products.length === 0) {
                container.innerHTML = '<div class="text-center text-muted p-5">No hay productos en esta recepción.</div>';
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
                    // IMPORTANTE: data-row-id debe ser el ID único de la fila temporal
                    html += `
                        <tr data-row-id="${row.id}">
                            <td><input type="text" class="short text-uppercase input-field" data-field="contenedor" value="${row.contenedor}" placeholder="CNT01"></td>
                            <td><input type="text" class="short text-uppercase input-field" data-field="bloque" value="${row.bloque}" placeholder="B-01"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="grosor" value="${row.grosor || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="alto" value="${row.alto || ''}"></td>
                            <td><input type="number" step="0.01" class="short input-field" data-field="ancho" value="${row.ancho || ''}"></td>
                            <td><span class="fw-bold text-white area-display">${area}</span></td>
                            <td><input type="text" class="input-field" data-field="color" value="${row.color}" placeholder="Opcional"></td>
                            <td class="text-center">
                                <button class="btn-action btn-delete" type="button"><i class="fa fa-trash"></i></button>
                            </td>
                        </tr>
                    `;
                });

                // Botones de acción
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

        // --- EVENTOS (Delegación) ---

        bindGlobalEvents() {
            const container = document.getElementById('portal-rows-container');
            const submitBtn = document.getElementById('btn-submit-pl');

            // Clonar nodos para eliminar eventos previos si se llama init múltiples veces (seguridad)
            const newContainer = container.cloneNode(true);
            container.parentNode.replaceChild(newContainer, container);
            
            // Reasignar la referencia
            const activeContainer = document.getElementById('portal-rows-container');

            // 1. Inputs (Change & Input)
            activeContainer.addEventListener('input', (e) => {
                if (e.target.classList.contains('input-field')) {
                    const tr = e.target.closest('tr');
                    if (!tr) return;
                    
                    const rowId = tr.dataset.rowId;
                    const field = e.target.dataset.field;
                    this.updateRowData(rowId, field, e.target.value);
                    
                    // Cálculo visual inmediato
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

            // 2. Click Buttons
            activeContainer.addEventListener('click', (e) => {
                const target = e.target;

                // Eliminar
                const deleteBtn = target.closest('.btn-delete');
                if (deleteBtn) {
                    const rowId = deleteBtn.closest('tr').dataset.rowId;
                    this.deleteRowInternal(rowId);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents(); // Re-bind necesario tras render completo
                    return;
                }

                // Agregar Simple
                const addBtn = target.closest('.action-add');
                if (addBtn) {
                    const pid = parseInt(addBtn.dataset.productId);
                    this.createRowInternal(pid);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }

                // Agregar Múltiple
                const addMultiBtn = target.closest('.action-add-multi');
                if (addMultiBtn) {
                    const pid = parseInt(addMultiBtn.dataset.productId);
                    for(let i=0; i<5; i++) this.createRowInternal(pid);
                    this.saveState();
                    this.render();
                    this.bindGlobalEvents();
                    return;
                }
            });

            // 3. Submit
            if (submitBtn) {
                // Clonar botón para limpiar eventos previos
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
                if (count > 0) {
                    btn.removeAttribute('disabled');
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                } else {
                    btn.setAttribute('disabled', 'disabled');
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                }
            }
        }

        async submitData() {
            if (!confirm("¿Está seguro de enviar el Packing List? Esto actualizará la recepción en el sistema.")) return;

            const btn = document.getElementById('btn-submit-pl');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin me-2"></i> Enviando...';
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
                const response = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: {
                            token: this.data.token,
                            rows: cleanData
                        },
                        id: Math.floor(Math.random() * 1000)
                    })
                });

                const result = await response.json();
                
                if (result.result && result.result.success) {
                    alert("✅ Packing List enviado correctamente. Gracias.");
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error ? result.error.data.message : (result.result ? result.result.message : "Error desconocido");
                    alert("❌ Error al procesar: " + msg);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (error) {
                console.error(error);
                alert("Error de conexión con el servidor.");
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    }

    // Instanciar globalmente
    window.supplierPortal = new SupplierPortal();

})();