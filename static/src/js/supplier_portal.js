/** @odoo-module **/
/* static/src/js/supplier_portal.js */

class SupplierPortal {
    constructor() {
        this.data = window.portalData || {};
        this.products = this.data.products || [];
        this.rows = [];
        this.nextId = 1;
        
        // Esperar a que el DOM esté listo
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        console.log("🚀 Iniciando Portal Proveedor (JS Puro)");
        
        if (!this.data.token) {
            console.error("No se encontró token de seguridad.");
            return;
        }

        this.loadLocalState();

        // Si no hay filas guardadas, inicializar con 1 fila por producto
        if (this.rows.length === 0) {
            this.products.forEach(p => this.createRowInternal(p.id));
        }

        this.render();
        this.bindGlobalEvents();
    }

    // --- GESTIÓN DE ESTADO ---

    loadLocalState() {
        const key = `pl_portal_${this.data.token}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                this.rows = JSON.parse(saved);
                // Recuperar el nextId más alto para no duplicar IDs
                if (this.rows.length > 0) {
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id), 0);
                    this.nextId = maxId + 1;
                }
            } catch (e) {
                console.error("Error cargando estado local", e);
                this.rows = [];
            }
        }
    }

    saveState() {
        const key = `pl_portal_${this.data.token}`;
        localStorage.setItem(key, JSON.stringify(this.rows));
        this.updateTotalsUI(); // Actualizar totales visuales al guardar
    }

    // --- LÓGICA DE DATOS ---

    createRowInternal(productId) {
        // Buscar última fila de este producto para copiar contenedor/bloque
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
        if (!container) return;

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

        // 1. Inputs (Change & Input)
        container.addEventListener('input', (e) => {
            if (e.target.classList.contains('input-field')) {
                const rowId = e.target.closest('tr').dataset.rowId;
                const field = e.target.dataset.field;
                this.updateRowData(rowId, field, e.target.value);
                
                // Actualizar área en tiempo real si cambia dimensión
                if (field === 'alto' || field === 'ancho') {
                    const row = this.rows.find(r => r.id === parseInt(rowId));
                    const areaSpan = e.target.closest('tr').querySelector('.area-display');
                    if (areaSpan && row) {
                        areaSpan.innerText = (row.alto * row.ancho).toFixed(2);
                    }
                    this.updateTotalsUI(); // Recalcular total global
                }
            }
        });

        // 2. Click Buttons (Add / Delete)
        container.addEventListener('click', (e) => {
            // Eliminar
            const deleteBtn = e.target.closest('.btn-delete');
            if (deleteBtn) {
                const rowId = deleteBtn.closest('tr').dataset.rowId;
                this.deleteRowInternal(rowId);
                this.saveState();
                this.render(); // Re-render completo es seguro y rápido aquí
                return;
            }

            // Agregar Simple
            const addBtn = e.target.closest('.action-add');
            if (addBtn) {
                const pid = parseInt(addBtn.dataset.productId);
                this.createRowInternal(pid);
                this.saveState();
                this.render();
                return;
            }

            // Agregar Múltiple
            const addMultiBtn = e.target.closest('.action-add-multi');
            if (addMultiBtn) {
                const pid = parseInt(addMultiBtn.dataset.productId);
                for(let i=0; i<5; i++) this.createRowInternal(pid);
                this.saveState();
                this.render();
                return;
            }
        });

        // 3. Submit
        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.submitData());
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
            } else {
                btn.setAttribute('disabled', 'disabled');
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
            alert("Error de conexión.");
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// Instanciar
window.supplierPortal = new SupplierPortal();