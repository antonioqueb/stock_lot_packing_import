/** @odoo-module **/

import { Component, useState, mount, xml } from "@odoo/owl";
import { templates } from "@web/core/assets";

class SupplierPortalApp extends Component {
    setup() {
        this.state = useState({
            data: window.portalData || {},
            products: window.portalData.products || [],
            rows: [], // Almacena todas las filas {id, product_id, ...}
            isSubmitting: false,
            nextId: 1
        });

        // Cargar datos guardados en LocalStorage por seguridad
        this.loadLocalState();
        
        // Si no hay filas, crear al menos una por producto
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
                // Recuperar ID máximo
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
        // Clonar datos de la última fila de este producto para agilizar (ej. mismo contenedor/bloque)
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
        for(let i=0; i<count; i++) this.addRow(productId);
    }

    deleteRow(rowId) {
        this.state.rows = this.state.rows.filter(r => r.id !== rowId);
        this.saveState();
    }

    get totalPlates() {
        // Contar solo filas que tengan dimensiones válidas
        return this.state.rows.filter(r => r.alto > 0 && r.ancho > 0).length;
    }

    get totalArea() {
        return this.state.rows.reduce((acc, r) => acc + (r.alto * r.ancho), 0).toFixed(2);
    }

    async submitData() {
        if (!confirm("¿Está seguro de enviar el Packing List? Esto actualizará la recepción en el sistema.")) return;

        this.state.isSubmitting = true;
        const cleanData = this.state.rows
            .filter(r => r.alto > 0 && r.ancho > 0) // Solo enviar filas con datos
            .map(r => ({
                product_id: r.product_id,
                contenedor: r.contenedor,
                bloque: r.bloque,
                grosor: r.grosor,
                alto: r.alto,
                ancho: r.ancho,
                color: r.color,
                atado: '', // O agregar campo si es necesario
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
                localStorage.removeItem(`pl_portal_${this.state.data.token}`); // Limpiar cache
                window.location.reload(); // O redirigir a página de éxito
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

SupplierPortalApp.template = "stock_lot_dimensions.SupplierPortalApp";

// Montaje de la app cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById("supplier-portal-app");
    if (root) {
        mount(SupplierPortalApp, root, { templates });
    }
});