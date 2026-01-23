/** @odoo-module **/

import { Component, useState, mount, xml } from "@odoo/owl";

class SupplierPortalApp extends Component {
    static template = xml`
        <div class="o_portal_wrapper">
            <header class="o_portal_header">
                <div class="brand">
                    <i class="fa fa-cubes me-2"/>PORTAL <span class="ms-1">PROVEEDOR</span>
                </div>
                <div class="po-info">
                    <div><span class="label">Orden de Compra:</span> <span class="value" t-esc="state.data.poName"/></div>
                    <div><span class="label">Recepción:</span> <span class="value" t-esc="state.data.pickingName"/></div>
                </div>
            </header>

            <div class="o_portal_container pb-5 mb-5">
                <div class="alert alert-info bg-dark border-secondary text-light mb-4">
                    <i class="fa fa-info-circle me-2 text-warning"/>
                    Por favor ingrese las dimensiones y detalles de cada placa o bloque.
                </div>

                <t t-foreach="state.products" t-as="product" t-key="product.id">
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3><t t-esc="product.name"/> <span class="text-muted small ms-2">(<t t-esc="product.code"/>)</span></h3>
                            </div>
                            <div class="meta">
                                Solicitado: <strong class="text-white"><t t-esc="product.qty_ordered"/> <t t-esc="product.uom"/></strong>
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
                                    <t t-foreach="getProductRows(product.id)" t-as="row" t-key="row.id">
                                        <tr>
                                            <td>
                                                <input type="text" class="short text-uppercase" placeholder="CNT01" 
                                                       t-att-value="row.contenedor" t-on-input="(ev) => this.updateRow(row.id, 'contenedor', ev.target.value)"/>
                                            </td>
                                            <td>
                                                <input type="text" class="short text-uppercase" placeholder="B-01" 
                                                       t-att-value="row.bloque" t-on-input="(ev) => this.updateRow(row.id, 'bloque', ev.target.value)"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-att-value="row.grosor" t-on-input="(ev) => this.updateRow(row.id, 'grosor', parseFloat(ev.target.value) || 0)"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-att-value="row.alto" t-on-input="(ev) => this.updateRow(row.id, 'alto', parseFloat(ev.target.value) || 0)"/>
                                            </td>
                                            <td>
                                                <input type="number" step="0.01" class="short" 
                                                       t-att-value="row.ancho" t-on-input="(ev) => this.updateRow(row.id, 'ancho', parseFloat(ev.target.value) || 0)"/>
                                            </td>
                                            <td>
                                                <span class="fw-bold text-white">
                                                    <t t-esc="(row.alto * row.ancho).toFixed(2)"/>
                                                </span>
                                            </td>
                                            <td>
                                                <input type="text" placeholder="Opcional" t-att-value="row.color" t-on-input="(ev) => this.updateRow(row.id, 'color', ev.target.value)"/>
                                            </td>
                                            <td class="text-center">
                                                <button class="btn-action" t-on-click="() => this.deleteRow(row.id)">
                                                    <i class="fa fa-trash"/>
                                                </button>
                                            </td>
                                        </tr>
                                    </t>
                                </tbody>
                            </table>
                            
                            <div class="mt-2">
                                <button class="btn-add-row" t-on-click="() => this.addRow(product.id)">
                                    <i class="fa fa-plus-circle"/> Agregar Placa
                                </button>
                                <button class="btn-add-row ms-2" t-on-click="() => this.addMultipleRows(product.id, 5)">
                                    +5 Filas
                                </button>
                            </div>
                        </div>
                    </div>
                </t>
            </div>

            <div class="submit-footer">
                <div class="summary">
                    Total Placas: <span t-esc="totalPlates"/> | 
                    Total Área: <span t-esc="totalArea"/> m²
                </div>
                <button class="btn-primary-custom" 
                        t-on-click="submitData" 
                        t-att-disabled="state.isSubmitting || totalPlates === 0">
                    <t t-if="state.isSubmitting">
                        <i class="fa fa-spinner fa-spin me-2"/> Enviando...
                    </t>
                    <t t-else="">
                        <i class="fa fa-paper-plane me-2"/> Enviar Packing List
                    </t>
                </button>
            </div>
        </div>
    `;
    
    setup() {
        this.state = useState({
            data: window.portalData || {},
            products: window.portalData?.products || [],
            rows: [],
            isSubmitting: false,
            nextId: 1
        });

        this.loadLocalState();
        
        if (this.state.rows.length === 0) {
            this.state.products.forEach(p => this.addRow(p.id));
        }
    }

    loadLocalState() {
        const key = `pl_portal_${this.state.data.token}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            try {
                this.state.rows = JSON.parse(saved);
                const maxId = this.state.rows.reduce((max, r) => Math.max(max, r.id), 0);
                this.state.nextId = maxId + 1;
            } catch(e) {}
        }
    }

    saveState() {
        const key = `pl_portal_${this.state.data.token}`;
        localStorage.setItem(key, JSON.stringify(this.state.rows));
    }

    updateRow(rowId, field, value) {
        const row = this.state.rows.find(r => r.id === rowId);
        if (row) {
            row[field] = value;
            this.saveState();
        }
    }

    getProductRows(productId) {
        return this.state.rows.filter(r => r.product_id === productId);
    }

    addRow(productId) {
        const existing = this.getProductRows(productId);
        let defaultData = { contenedor: '', bloque: '', grosor: 0, alto: 0, ancho: 0 };
        
        if (existing.length > 0) {
            const last = existing[existing.length - 1];
            defaultData = { 
                contenedor: last.contenedor, 
                bloque: last.bloque,
                grosor: last.grosor,
                alto: 0, ancho: 0 
            };
        }

        this.state.rows.push({
            id: this.state.nextId++,
            product_id: productId,
            ...defaultData,
            color: '',
            ref_prov: ''
        });
        this.saveState();
    }

    addMultipleRows(productId, count) {
        for(let i = 0; i < count; i++) this.addRow(productId);
    }

    deleteRow(rowId) {
        this.state.rows = this.state.rows.filter(r => r.id !== rowId);
        this.saveState();
    }

    get totalPlates() {
        return this.state.rows.filter(r => r.alto > 0 && r.ancho > 0).length;
    }

    get totalArea() {
        return this.state.rows.reduce((acc, r) => acc + (r.alto * r.ancho), 0).toFixed(2);
    }

    async submitData() {
        if (!confirm("¿Está seguro de enviar el Packing List?")) return;

        this.state.isSubmitting = true;
        const cleanData = this.state.rows
            .filter(r => r.alto > 0 && r.ancho > 0)
            .map(r => ({
                product_id: r.product_id,
                contenedor: r.contenedor,
                bloque: r.bloque,
                grosor: r.grosor,
                alto: r.alto,
                ancho: r.ancho,
                color: r.color,
                atado: '',
                tipo: 'placa'
            }));

        try {
            const response = await fetch('/supplier/pl/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "call",
                    params: { token: this.state.data.token, rows: cleanData },
                    id: Math.floor(Math.random() * 1000)
                })
            });

            const result = await response.json();
            if (result.result?.success) {
                alert("✅ Packing List enviado correctamente.");
                localStorage.removeItem(`pl_portal_${this.state.data.token}`);
                window.location.reload();
            } else {
                alert("❌ Error: " + (result.error?.data?.message || result.result?.message));
            }
        } catch (error) {