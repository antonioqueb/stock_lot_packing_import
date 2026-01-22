/** @odoo-module **/

import { Component, useState, mount } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";

class SupplierPortalApp extends Component {
    static template = "stock_lot_packing_import.SupplierPortalApp";
    
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
        if (!confirm("¿Está seguro de enviar el Packing List? Esto actualizará la recepción en el sistema.")) return;

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
                    params: {
                        token: this.state.data.token,
                        rows: cleanData
                    },
                    id: Math.floor(Math.random() * 1000)
                })
            });

            const result = await response.json();
            if (result.result && result.result.success) {
                alert("✅ Packing List enviado correctamente. Gracias.");
                localStorage.removeItem(`pl_portal_${this.state.data.token}`);
                window.location.reload();
            } else {
                const msg = result.error ? result.error.data.message : result.result.message;
                alert("❌ Error al procesar: " + msg);
            }
        } catch (error) {
            console.error(error);
            alert("Error de conexión.");
        } finally {
            this.state.isSubmitting = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById("supplier-portal-app");
    if (root) {
        // Esperar a que los templates estén cargados
        await loadBundle("web.assets_frontend");
        const { templates } = owl;
        mount(SupplierPortalApp, root, { templates });
    }
});