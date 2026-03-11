/* static/src/js/supplier_portal.js */
/* v3.4 — Container-first Packings + Shared Packing Support */
/* Hierarchical Portal: Proforma → Shipments → Docs → Containers → Packings */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script v3.4 (Container-first Packings) Loaded.");

    // =========================================================================
    //  TRANSLATIONS (i18n)
    // =========================================================================
    const T = {
        en: {
            header_provider: "VENDOR", po_label: "Purchase Order:", receipt_label: "Receipt:",
            sec_proforma_globals: "Proforma Global Data",
            lbl_proforma: "Proforma No. (PI)", ph_proforma: "Ex. PI-9920",
            lbl_invoice_global: "Global Invoice", lbl_payment: "Payment Terms", ph_payment: "Ex. T/T 30%",
            lbl_country: "Country of Origin", ph_country: "Ex. China",
            lbl_port_origin: "Origin Port", ph_origin: "Ex. Shanghai",
            lbl_port_dest: "Destination Port", ph_dest: "Ex. Manzanillo",
            lbl_incoterm: "Incoterm", ph_incoterm: "Ex. CIF",
            lbl_general_notes: "General Notes",
            btn_save_globals: "Save Global Data",
            sec_shipments: "Shipments", btn_add_shipment: "Add Shipment",
            msg_no_shipments: "No shipments registered. Click 'Add Shipment' to start.",
            tab_logistics: "Logistics", tab_bl: "B/L", tab_invoices: "Invoices",
            tab_packings: "Packing Lists", tab_containers: "Containers",
            lbl_shipment_type: "Type", lbl_shipping_line: "Shipping Line", lbl_vessel: "Vessel",
            lbl_etd: "ETD", lbl_eta: "ETA", lbl_status: "Status", lbl_notes: "Notes",
            lbl_bl_number: "B/L Number", lbl_bl_date: "B/L Date", lbl_bl_file: "B/L File",
            btn_save_shipment: "Save Shipment", btn_save_containers: "Save Containers",
            btn_save_invoices: "Save Invoices",
            lbl_inv_number: "Invoice No.", lbl_inv_date: "Date", lbl_inv_amount: "Amount",
            lbl_inv_scope: "Scope", scope_full: "Full Shipment", scope_specific: "Specific Containers",
            lbl_cont_number: "Container No.", lbl_cont_seal: "Seal No.", lbl_cont_type: "Type",
            lbl_cont_weight: "Weight (kg)", lbl_cont_volume: "Volume (m³)", lbl_cont_packages: "Packages",
            lbl_pk_number: "Packing No.", lbl_pk_date: "Date", lbl_pk_scope: "Scope",
            lbl_pk_file: "Packing File",
            btn_add: "Add", btn_remove: "Remove", btn_add_invoice: "+ Invoice", btn_add_container: "+ Container",
            btn_add_packing: "+ Packing List",
            btn_add_packing_single: "+ Packing per Container",
            btn_add_packing_multi: "+ Shared Packing",
            btn_add_packing_full: "+ Shipment Packing",
            btn_save_packing: "Save Packing", btn_delete_packing: "Delete",
            footer_total_shipments: "Shipments:", footer_total_containers: "Containers:",
            footer_total_invoices: "Invoices:", btn_complete: "Mark as Complete",
            requested: "Requested:", btn_add_row: "Add Item", btn_add_multi: "+5 Rows",
            col_block: "Block", col_atado: "Bundle", col_plate_num: "Plate No.",
            col_ref: "Reference", col_thickness: "Thickness", col_height: "Height (m)",
            col_width: "Width (m)", col_area: "Area (m²)", col_notes: "Notes",
            col_qty: "Quantity", col_weight: "Weight (kg)",
            col_photo: "Photo",
            col_container_assign: "Container",
            lbl_type_placa: "Slab/Plate", lbl_type_formato: "Tile/Format", lbl_type_pieza: "Piece/Unit",
            lbl_packages: "N° Packages", lbl_desc_goods: "Description of Goods",
            col_crate_h: "Crate H", col_crate_w: "Crate W", col_crate_t: "Crate T",
            col_fmt_h: "Item Height", col_fmt_w: "Item Width",
            msg_saved: "Saved successfully", msg_error: "Error: ", msg_confirm_delete: "Delete this item?",
            msg_confirm_complete: "Mark proforma as complete? This signals the supplier has finished entering data.",
            msg_confirm_delete_photo: "Delete the photo for this slab?",
            msg_photo_save_first: "Save the packing first to upload photos",
            msg_photo_too_large: "Image is too large (max 5MB)",
            msg_photo_invalid: "Only images are allowed",
            msg_photo_deleted: "Photo deleted",
            msg_loading: "Loading...", msg_saving: "Saving...",
            opt_select: "Select...",
            opt_maritime: "Maritime", opt_air: "Air", opt_land: "Land",
            st_draft: "Draft", st_in_production: "In Production", st_booked: "Booked",
            st_departed: "Departed", st_in_transit: "In Transit", st_arrived: "Arrived", st_delivered: "Delivered",

            // new
            pk_mode_title: "Packing Structure",
            pk_mode_help: "Choose how this packing relates to containers.",
            pk_mode_full: "Shipment-level packing",
            pk_mode_single: "One packing for one container",
            pk_mode_multi: "One packing for multiple containers",
            pk_single_container: "Assigned container",
            pk_multi_containers: "Containers covered by this packing",
            pk_container_first_hint: "Recommended when each container has its own packing list.",
            pk_shared_hint: "Use when one packing list supports multiple containers and materials must be split per container.",
            pk_full_hint: "Use only when the supplier does not yet know container allocation.",
            pk_recommendation_single: "Recommendation: create one packing per container for maximum traceability.",
            pk_recommendation_multi: "Shared packing is useful only if one vendor document supports multiple containers.",
            pk_group_title: "Container-first view",
            pk_group_unassigned: "Shipment-level / unassigned packings",
            pk_no_packings_for_container: "No packings linked to this container yet.",
            pk_scope_detected: "Detected mode",
            pk_detected_single: "Single container",
            pk_detected_multi: "Multiple containers",
            pk_detected_full: "Full shipment",
            msg_need_container_for_single: "Select the container for this packing.",
            msg_need_containers_for_multi: "Select at least one container for this shared packing.",
            msg_need_row_container_for_multi: "All rows must have a container assigned in shared packing mode.",
            msg_need_rows_for_single: "At least one row should belong to the selected container.",
            msg_no_containers_yet: "Create containers first to use container-based packings.",
            lbl_containers_linked: "Linked Containers",
            lbl_mode: "Mode",
            lbl_detected_mode: "Detected",
            btn_expand_rows: "Rows",
            btn_hide_rows: "Hide rows",
            txt_yes: "Yes",
            txt_no: "No",
        },
        es: {
            header_provider: "PROVEEDOR", po_label: "Orden de Compra:", receipt_label: "Recepción:",
            sec_proforma_globals: "Datos Globales de la Proforma",
            lbl_proforma: "No. Proforma (PI)", ph_proforma: "Ej. PI-9920",
            lbl_invoice_global: "Factura Global", lbl_payment: "Condiciones de Pago", ph_payment: "Ej. T/T 30%",
            lbl_country: "País Origen", ph_country: "Ej. China",
            lbl_port_origin: "Puerto Origen", ph_origin: "Ej. Shanghai",
            lbl_port_dest: "Puerto Destino", ph_dest: "Ej. Manzanillo",
            lbl_incoterm: "Incoterm", ph_incoterm: "Ej. CIF",
            lbl_general_notes: "Observaciones Generales",
            btn_save_globals: "Guardar Datos Globales",
            sec_shipments: "Embarques", btn_add_shipment: "Agregar Embarque",
            msg_no_shipments: "No hay embarques registrados. Presione 'Agregar Embarque' para comenzar.",
            tab_logistics: "Logística", tab_bl: "B/L", tab_invoices: "Invoices",
            tab_packings: "Packing Lists", tab_containers: "Contenedores",
            lbl_shipment_type: "Tipo", lbl_shipping_line: "Naviera", lbl_vessel: "Buque",
            lbl_etd: "ETD", lbl_eta: "ETA", lbl_status: "Estatus", lbl_notes: "Observaciones",
            lbl_bl_number: "No. B/L", lbl_bl_date: "Fecha B/L", lbl_bl_file: "Archivo B/L",
            btn_save_shipment: "Guardar Embarque", btn_save_containers: "Guardar Contenedores",
            btn_save_invoices: "Guardar Invoices",
            lbl_inv_number: "No. Invoice", lbl_inv_date: "Fecha", lbl_inv_amount: "Monto",
            lbl_inv_scope: "Alcance", scope_full: "Todo el Embarque", scope_specific: "Contenedores Específicos",
            lbl_cont_number: "No. Contenedor", lbl_cont_seal: "No. Sello", lbl_cont_type: "Tipo",
            lbl_cont_weight: "Peso (kg)", lbl_cont_volume: "Volumen (m³)", lbl_cont_packages: "Paquetes",
            lbl_pk_number: "No. Packing", lbl_pk_date: "Fecha", lbl_pk_scope: "Alcance",
            lbl_pk_file: "Archivo PL",
            btn_add: "Agregar", btn_remove: "Eliminar", btn_add_invoice: "+ Invoice", btn_add_container: "+ Contenedor",
            btn_add_packing: "+ Packing List",
            btn_add_packing_single: "+ Packing por Contenedor",
            btn_add_packing_multi: "+ Packing Compartido",
            btn_add_packing_full: "+ Packing del Embarque",
            btn_save_packing: "Guardar Packing", btn_delete_packing: "Eliminar",
            footer_total_shipments: "Embarques:", footer_total_containers: "Contenedores:",
            footer_total_invoices: "Invoices:", btn_complete: "Marcar como Completa",
            requested: "Solicitado:", btn_add_row: "Agregar Item", btn_add_multi: "+5 Filas",
            col_block: "Bloque", col_atado: "Atado", col_plate_num: "No. Placa",
            col_ref: "Referencia", col_thickness: "Grosor", col_height: "Alto (m)",
            col_width: "Ancho (m)", col_area: "Área (m²)", col_notes: "Notas",
            col_qty: "Cantidad", col_weight: "Peso (kg)",
            col_photo: "Foto",
            col_container_assign: "Contenedor",
            lbl_type_placa: "Placa", lbl_type_formato: "Formato", lbl_type_pieza: "Pieza",
            lbl_packages: "N° Paquetes", lbl_desc_goods: "Desc. Bienes",
            col_crate_h: "Alto Caja", col_crate_w: "Ancho Caja", col_crate_t: "Grosor Caja",
            col_fmt_h: "Alto Item", col_fmt_w: "Ancho Item",
            msg_saved: "Guardado correctamente", msg_error: "Error: ", msg_confirm_delete: "¿Eliminar este registro?",
            msg_confirm_complete: "¿Marcar la proforma como completa? Esto indica que el proveedor terminó de capturar datos.",
            msg_confirm_delete_photo: "¿Eliminar la foto de esta placa?",
            msg_photo_save_first: "Guarde el packing primero para subir fotos",
            msg_photo_too_large: "La imagen es demasiado grande (máx 5MB)",
            msg_photo_invalid: "Solo se permiten imágenes",
            msg_photo_deleted: "Foto eliminada",
            msg_loading: "Cargando...", msg_saving: "Guardando...",
            opt_select: "Seleccionar...",
            opt_maritime: "Marítimo", opt_air: "Aéreo", opt_land: "Terrestre",
            st_draft: "Borrador", st_in_production: "En Producción", st_booked: "Reservado",
            st_departed: "Despachado", st_in_transit: "En Tránsito", st_arrived: "Llegó", st_delivered: "Entregado",

            // new
            pk_mode_title: "Estructura del Packing",
            pk_mode_help: "Seleccione cómo se relaciona este packing con los contenedores.",
            pk_mode_full: "Packing a nivel embarque",
            pk_mode_single: "Un packing para un contenedor",
            pk_mode_multi: "Un packing para varios contenedores",
            pk_single_container: "Contenedor asignado",
            pk_multi_containers: "Contenedores cubiertos por este packing",
            pk_container_first_hint: "Recomendado cuando cada contenedor tiene su propio packing list.",
            pk_shared_hint: "Úselo cuando un mismo packing list avala múltiples contenedores y el material debe dividirse por contenedor.",
            pk_full_hint: "Úselo solo cuando el proveedor aún no conoce la distribución por contenedor.",
            pk_recommendation_single: "Recomendación: crear un packing por contenedor para máxima trazabilidad.",
            pk_recommendation_multi: "El packing compartido solo conviene si un documento del proveedor cubre varios contenedores.",
            pk_group_title: "Vista contenedor primero",
            pk_group_unassigned: "Packings a nivel embarque / sin asignar",
            pk_no_packings_for_container: "Aún no hay packings vinculados a este contenedor.",
            pk_scope_detected: "Modo detectado",
            pk_detected_single: "Contenedor único",
            pk_detected_multi: "Múltiples contenedores",
            pk_detected_full: "Embarque completo",
            msg_need_container_for_single: "Seleccione el contenedor para este packing.",
            msg_need_containers_for_multi: "Seleccione al menos un contenedor para este packing compartido.",
            msg_need_row_container_for_multi: "Todas las filas deben tener un contenedor asignado en modo packing compartido.",
            msg_need_rows_for_single: "Al menos una fila debe pertenecer al contenedor seleccionado.",
            msg_no_containers_yet: "Primero capture contenedores para usar packings por contenedor.",
            lbl_containers_linked: "Contenedores Vinculados",
            lbl_mode: "Modo",
            lbl_detected_mode: "Detectado",
            btn_expand_rows: "Filas",
            btn_hide_rows: "Ocultar filas",
            txt_yes: "Sí",
            txt_no: "No",
        },
        zh: {
            header_provider: "供应商", po_label: "采购订单:", receipt_label: "收货单:",
            sec_proforma_globals: "形式发票全局数据",
            lbl_proforma: "形式发票号", ph_proforma: "例如 PI-9920",
            lbl_invoice_global: "全局发票", lbl_payment: "付款条件", ph_payment: "例如 T/T 30%",
            lbl_country: "原产国", ph_country: "例如 China",
            lbl_port_origin: "起运港", ph_origin: "例如 Shanghai",
            lbl_port_dest: "目的港", ph_dest: "例如 Manzanillo",
            lbl_incoterm: "贸易条款", ph_incoterm: "例如 CIF",
            lbl_general_notes: "一般备注",
            btn_save_globals: "保存全局数据",
            sec_shipments: "发货", btn_add_shipment: "添加发货",
            msg_no_shipments: "没有发货记录。点击'添加发货'开始。",
            tab_logistics: "物流", tab_bl: "提单", tab_invoices: "发票",
            tab_packings: "装箱单", tab_containers: "集装箱",
            lbl_shipment_type: "类型", lbl_shipping_line: "船公司", lbl_vessel: "船名",
            lbl_etd: "预计离港", lbl_eta: "预计到港", lbl_status: "状态", lbl_notes: "备注",
            lbl_bl_number: "提单号", lbl_bl_date: "提单日期", lbl_bl_file: "提单文件",
            btn_save_shipment: "保存发货", btn_save_containers: "保存集装箱",
            btn_save_invoices: "保存发票",
            lbl_inv_number: "发票号", lbl_inv_date: "日期", lbl_inv_amount: "金额",
            lbl_inv_scope: "范围", scope_full: "整批", scope_specific: "指定集装箱",
            lbl_cont_number: "集装箱号", lbl_cont_seal: "封条号", lbl_cont_type: "类型",
            lbl_cont_weight: "重量 (kg)", lbl_cont_volume: "体积 (m³)", lbl_cont_packages: "件数",
            lbl_pk_number: "装箱单号", lbl_pk_date: "日期", lbl_pk_scope: "范围",
            lbl_pk_file: "装箱单文件",
            btn_add: "添加", btn_remove: "删除", btn_add_invoice: "+ 发票", btn_add_container: "+ 集装箱",
            btn_add_packing: "+ 装箱单",
            btn_add_packing_single: "+ 每柜装箱单",
            btn_add_packing_multi: "+ 共享装箱单",
            btn_add_packing_full: "+ 整票装箱单",
            btn_save_packing: "保存装箱单", btn_delete_packing: "删除",
            footer_total_shipments: "发货:", footer_total_containers: "集装箱:",
            footer_total_invoices: "发票:", btn_complete: "标记为完成",
            requested: "需求量:", btn_add_row: "添加", btn_add_multi: "+5行",
            col_block: "荒料号", col_atado: "捆包号", col_plate_num: "板号",
            col_ref: "参考", col_thickness: "厚度", col_height: "高度 (m)",
            col_width: "宽度 (m)", col_area: "面积 (m²)", col_notes: "备注",
            col_qty: "数量", col_weight: "重量 (kg)",
            col_photo: "照片",
            col_container_assign: "集装箱",
            lbl_type_placa: "大板", lbl_type_formato: "规格板", lbl_type_pieza: "件",
            lbl_packages: "包数", lbl_desc_goods: "货物描述",
            col_crate_h: "箱高", col_crate_w: "箱宽", col_crate_t: "箱厚",
            col_fmt_h: "物品高度", col_fmt_w: "物品宽度",
            msg_saved: "保存成功", msg_error: "错误: ", msg_confirm_delete: "删除此记录？",
            msg_confirm_complete: "标记为完成？",
            msg_confirm_delete_photo: "删除这张照片？",
            msg_photo_save_first: "请先保存装箱单再上传照片",
            msg_photo_too_large: "图片太大（最大5MB）",
            msg_photo_invalid: "只允许图片",
            msg_photo_deleted: "照片已删除",
            msg_loading: "加载中...", msg_saving: "保存中...",
            opt_select: "请选择...",
            opt_maritime: "海运", opt_air: "空运", opt_land: "陆运",
            st_draft: "草稿", st_in_production: "生产中", st_booked: "已预订",
            st_departed: "已发运", st_in_transit: "运输中", st_arrived: "已到达", st_delivered: "已交付",

            // new
            pk_mode_title: "装箱单结构",
            pk_mode_help: "选择该装箱单与集装箱的关系。",
            pk_mode_full: "整票装箱单",
            pk_mode_single: "一个装箱单对应一个集装箱",
            pk_mode_multi: "一个装箱单对应多个集装箱",
            pk_single_container: "已分配集装箱",
            pk_multi_containers: "该装箱单覆盖的集装箱",
            pk_container_first_hint: "当每个集装箱都有独立装箱单时推荐使用。",
            pk_shared_hint: "当一个供应商装箱单对应多个集装箱且物料需按集装箱拆分时使用。",
            pk_full_hint: "仅在供应商尚未明确集装箱分配时使用。",
            pk_recommendation_single: "建议：每个集装箱一个装箱单，便于追溯。",
            pk_recommendation_multi: "共享装箱单仅适用于一个供应商文件对应多个集装箱。",
            pk_group_title: "集装箱优先视图",
            pk_group_unassigned: "整票 / 未分配装箱单",
            pk_no_packings_for_container: "该集装箱尚无关联装箱单。",
            pk_scope_detected: "识别模式",
            pk_detected_single: "单集装箱",
            pk_detected_multi: "多集装箱",
            pk_detected_full: "整票",
            msg_need_container_for_single: "请选择该装箱单的集装箱。",
            msg_need_containers_for_multi: "请至少选择一个集装箱。",
            msg_need_row_container_for_multi: "共享装箱单模式下所有行都必须分配集装箱。",
            msg_need_rows_for_single: "至少有一行属于所选集装箱。",
            msg_no_containers_yet: "请先创建集装箱，再使用按集装箱装箱单。",
            lbl_containers_linked: "关联集装箱",
            lbl_mode: "模式",
            lbl_detected_mode: "识别",
            btn_expand_rows: "行",
            btn_hide_rows: "隐藏行",
            txt_yes: "是",
            txt_no: "否",
        }
    };

    // =========================================================================
    //  HELPERS
    // =========================================================================
    function jsonRpc(url, params) {
        console.log(`[Portal][RPC] >>> POST ${url}`, JSON.stringify(params).substring(0, 300));
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Math.floor(Math.random() * 99999) })
        }).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            return r.json();
        }).then(d => {
            if (d.error) {
                const msg = d.error.data?.message || d.error.message || 'RPC Error';
                throw new Error(msg);
            }
            return d.result;
        });
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function asInt(v) {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 0;
    }

    // =========================================================================
    //  MAIN CLASS
    // =========================================================================
    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.proforma = {};
            this.token = '';
            this.currentLang = localStorage.getItem('portal_lang') || 'es';
            this.expandedShipmentId = null;
            this.activeTabByShipment = {};
            this.packingRows = {};
            this.nextRowId = 1;
            this._eventsBound = false;

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        t(key) { return (T[this.currentLang] || T['en'])[key] || key; }

        init() {
            try {
                const langSel = document.getElementById('lang-selector');
                if (langSel) {
                    langSel.value = this.currentLang;
                    langSel.addEventListener('change', e => {
                        this.currentLang = e.target.value;
                        localStorage.setItem('portal_lang', this.currentLang);
                        this.updateStaticI18n();
                        this.renderAll();
                    });
                }

                const el = document.getElementById('portal-data-store');
                if (!el) throw new Error('No payload element #portal-data-store');

                this.data = JSON.parse(el.dataset.payload || '{}');
                this.token = this.data.token || '';
                this.products = this.data.products || [];
                this.proforma = this.data.proforma || {};

                this.updateStaticI18n();
                this.fillHeaderInfo();
                this.fillGlobalsForm();
                this.bindGlobalEvents();
                this.renderAll();
            } catch (err) {
                console.error("[Portal] init() ERROR:", err);
                if (!this._eventsBound) {
                    try { this.bindGlobalEvents(); } catch (_e) {}
                }
                const c = document.getElementById('shipments-container');
                if (c) c.innerHTML = `<div class="empty-state"><p style="color:red">${esc(err.message)}</p></div>`;
            }
        }

        updateStaticI18n() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const k = el.dataset.i18n;
                if (k) el.innerText = this.t(k);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const k = el.dataset.i18nPlaceholder;
                if (k) el.placeholder = this.t(k);
            });
        }

        fillHeaderInfo() {
            const setTxt = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val || '-';
            };
            setTxt('portal-po-name', this.data.po_name || this.data.poName || this.proforma.po_name || '');
            setTxt('portal-picking-name', this.data.picking_name || this.data.pickingName || this.proforma.picking_name || '');
            setTxt('portal-vendor-name', this.data.vendor_name || this.data.partner_name || this.proforma.vendor_name || this.t('header_provider'));
        }

        // =====================================================================
        //  GLOBALS FORM
        // =====================================================================
        fillGlobalsForm() {
            const p = this.proforma;
            const map = {
                'g-proforma-number': 'proforma_number',
                'g-invoice-global': 'invoice_global_number',
                'g-payment-terms': 'payment_terms',
                'g-country-origin': 'country_origin',
                'g-port-origin': 'port_origin',
                'g-port-destination': 'port_destination',
                'g-incoterm': 'incoterm',
                'g-general-notes': 'general_notes',
            };
            for (const [domId, key] of Object.entries(map)) {
                const el = document.getElementById(domId);
                if (el && p[key]) el.value = p[key];
            }
            this.updateStatusBadge();
        }

        getGlobalsFromForm() {
            return {
                proforma_number: document.getElementById('g-proforma-number')?.value || '',
                invoice_global_number: document.getElementById('g-invoice-global')?.value || '',
                payment_terms: document.getElementById('g-payment-terms')?.value || '',
                country_origin: document.getElementById('g-country-origin')?.value || '',
                port_origin: document.getElementById('g-port-origin')?.value || '',
                port_destination: document.getElementById('g-port-destination')?.value || '',
                incoterm: document.getElementById('g-incoterm')?.value || '',
                general_notes: document.getElementById('g-general-notes')?.value || '',
            };
        }

        updateStatusBadge() {
            const badge = document.getElementById('proforma-status-badge');
            if (!badge) return;
            const st = this.proforma.status || 'draft';
            badge.className = `badge-status status-${st}`;
            badge.textContent = st.charAt(0).toUpperCase() + st.slice(1);
        }

        async saveGlobals() {
            const btn = document.getElementById('btn-save-globals');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
            }
            try {
                const res = await jsonRpc('/supplier/api/v2/save_globals', {
                    token: this.token,
                    globals_data: this.getGlobalsFromForm()
                });
                if (res.success) {
                    this.toast(this.t('msg_saved'), 'success');
                    Object.assign(this.proforma, this.getGlobalsFromForm());
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa fa-save me-2"></i> ${this.t('btn_save_globals')}`;
            }
        }

        // =====================================================================
        //  RENDER ALL
        // =====================================================================
        renderAll() {
            this.renderShipments();
            this.updateFooterTotals();
            this.updateStatusBadge();
        }

        // =====================================================================
        //  SHIPMENTS
        // =====================================================================
        renderShipments() {
            const container = document.getElementById('shipments-container');
            if (!container) return;
            const countBadge = document.getElementById('shipment-count-badge');
            const shipments = this.proforma.shipments || [];

            if (countBadge) countBadge.textContent = shipments.length;

            if (shipments.length === 0) {
                container.innerHTML = '';
                container.appendChild(this.createEmptyState());
                return;
            }

            const es = container.querySelector('.empty-state');
            if (es) es.remove();

            const existingIds = new Set();
            shipments.forEach(s => {
                existingIds.add(s.id);
                let block = container.querySelector(`.shipment-block[data-shipment-id="${s.id}"]`);
                if (!block) {
                    block = this.createShipmentBlock(s);
                    container.appendChild(block);
                } else {
                    this.updateShipmentBlockHeader(block, s);
                }
                if (this.expandedShipmentId === s.id) {
                    block.classList.add('expanded');
                    const body = block.querySelector('.shipment-block-body');
                    body.style.display = 'block';
                    this.renderShipmentBody(body, s);
                }
            });

            container.querySelectorAll('.shipment-block').forEach(b => {
                const id = parseInt(b.dataset.shipmentId);
                if (!existingIds.has(id)) b.remove();
            });
        }

        createEmptyState() {
            const d = document.createElement('div');
            d.className = 'empty-state';
            d.id = 'no-shipments-msg';
            d.innerHTML = `<i class="fa fa-inbox fa-3x"></i><p>${this.t('msg_no_shipments')}</p>`;
            return d;
        }

        createShipmentBlock(s) {
            const block = document.createElement('div');
            block.className = 'shipment-block';
            block.dataset.shipmentId = s.id;

            block.innerHTML = `
                <div class="shipment-block-header">
                    <div class="shipment-block-title">
                        <span class="shipment-name">${esc(s.name)}</span>
                        <span class="shipment-status-pill st-${s.status || 'draft'}">${this.t('st_' + (s.status || 'draft'))}</span>
                        <span class="shipment-summary-chips">
                            <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                            <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                            <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>
                        </span>
                    </div>
                    <div class="shipment-block-actions">
                        <button type="button" class="btn-toggle-shipment" title="Expand/Collapse"><i class="fa fa-chevron-down"></i></button>
                        <button type="button" class="btn-delete-shipment" title="Delete"><i class="fa fa-trash"></i></button>
                    </div>
                </div>
                <div class="shipment-block-body" style="display:none;"></div>`;

            block.querySelector('.btn-toggle-shipment').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleShipment(s.id);
            });
            block.querySelector('.shipment-block-header').addEventListener('click', () => {
                this.toggleShipment(s.id);
            });
            block.querySelector('.btn-delete-shipment').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteShipment(s.id);
            });

            return block;
        }

        updateShipmentBlockHeader(block, s) {
            block.querySelector('.shipment-name').textContent = s.name;
            const pill = block.querySelector('.shipment-status-pill');
            pill.className = `shipment-status-pill st-${s.status || 'draft'}`;
            pill.textContent = this.t('st_' + (s.status || 'draft'));
            const chips = block.querySelector('.shipment-summary-chips');
            chips.innerHTML = `
                <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>`;
        }

        toggleShipment(shipmentId) {
            const container = document.getElementById('shipments-container');
            if (!container) return;
            const wasExpanded = this.expandedShipmentId === shipmentId;

            container.querySelectorAll('.shipment-block').forEach(b => {
                b.classList.remove('expanded');
                b.querySelector('.shipment-block-body').style.display = 'none';
            });

            if (wasExpanded) {
                this.expandedShipmentId = null;
            } else {
                this.expandedShipmentId = shipmentId;
                const block = container.querySelector(`.shipment-block[data-shipment-id="${shipmentId}"]`);
                if (block) {
                    block.classList.add('expanded');
                    const body = block.querySelector('.shipment-block-body');
                    body.style.display = 'block';
                    const s = (this.proforma.shipments || []).find(x => x.id === shipmentId);
                    if (s) this.renderShipmentBody(body, s);
                    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }

        async addShipment() {
            try {
                const res = await jsonRpc('/supplier/api/v2/create_shipment', { token: this.token });
                if (res.success) {
                    await this.reloadProforma();
                    this.expandedShipmentId = res.shipment_id;
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        async deleteShipment(shipmentId) {
            if (!confirm(this.t('msg_confirm_delete'))) return;
            try {
                await jsonRpc('/supplier/api/v2/delete_shipment', { token: this.token, shipment_id: shipmentId });
                if (this.expandedShipmentId === shipmentId) this.expandedShipmentId = null;
                await this.reloadProforma();
                this.renderAll();
                this.toast(this.t('msg_saved'), 'success');
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        // =====================================================================
        //  SHIPMENT BODY (tabs)
        // =====================================================================
        renderShipmentBody(bodyEl, s) {
            const activeTab = this.activeTabByShipment[s.id] || 'logistics';

            bodyEl.innerHTML = `
                <div class="shipment-tabs">
                    ${this._tabBtn('logistics', 'fa-truck', this.t('tab_logistics'), activeTab, s.id)}
                    ${this._tabBtn('bl', 'fa-file-text', this.t('tab_bl'), activeTab, s.id)}
                    ${this._tabBtn('invoices', 'fa-file-invoice-dollar', this.t('tab_invoices'), activeTab, s.id, (s.invoices || []).length)}
                    ${this._tabBtn('packings', 'fa-boxes', this.t('tab_packings'), activeTab, s.id, (s.packings || []).length)}
                    ${this._tabBtn('containers', 'fa-cube', this.t('tab_containers'), activeTab, s.id, (s.containers || []).length)}
                </div>
                <div id="stab-logistics-${s.id}" class="shipment-tab-content ${activeTab === 'logistics' ? 'active' : ''}"></div>
                <div id="stab-bl-${s.id}" class="shipment-tab-content ${activeTab === 'bl' ? 'active' : ''}"></div>
                <div id="stab-invoices-${s.id}" class="shipment-tab-content ${activeTab === 'invoices' ? 'active' : ''}"></div>
                <div id="stab-packings-${s.id}" class="shipment-tab-content ${activeTab === 'packings' ? 'active' : ''}"></div>
                <div id="stab-containers-${s.id}" class="shipment-tab-content ${activeTab === 'containers' ? 'active' : ''}"></div>`;

            bodyEl.querySelectorAll('.shipment-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const name = tab.dataset.tab;
                    this.activeTabByShipment[s.id] = name;
                    bodyEl.querySelectorAll('.shipment-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
                    bodyEl.querySelectorAll('.shipment-tab-content').forEach(c => c.classList.toggle('active', c.id === `stab-${name}-${s.id}`));
                    this.renderTabContent(name, s);
                });
            });

            this.renderTabContent(activeTab, s);
        }

        _tabBtn(name, icon, label, active, sid, count) {
            const isActive = active === name ? 'active' : '';
            const countHtml = count !== undefined ? `<span class="tab-count">${count}</span>` : '';
            return `<div class="shipment-tab ${isActive}" data-tab="${name}"><i class="fa ${icon}"></i> ${label} ${countHtml}</div>`;
        }

        renderTabContent(tabName, s) {
            const el = document.getElementById(`stab-${tabName}-${s.id}`);
            if (!el) return;

            switch (tabName) {
                case 'logistics': this.renderLogisticsTab(el, s); break;
                case 'bl': this.renderBLTab(el, s); break;
                case 'invoices': this.renderInvoicesTab(el, s); break;
                case 'packings': this.renderPackingsTab(el, s); break;
                case 'containers': this.renderContainersTab(el, s); break;
            }
        }

        // --- LOGISTICS TAB ---
        renderLogisticsTab(el, s) {
            const statusOpts = ['draft', 'in_production', 'booked', 'departed', 'in_transit', 'arrived', 'delivered']
                .map(v => `<option value="${v}" ${s.status === v ? 'selected' : ''}>${this.t('st_' + v)}</option>`).join('');
            const typeOpts = ['maritime', 'air', 'land']
                .map(v => `<option value="${v}" ${s.shipment_type === v ? 'selected' : ''}>${this.t('opt_' + v)}</option>`).join('');

            el.innerHTML = `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_shipment_type')}</label>
                        <select data-sf="shipment_type"><option value="">${this.t('opt_select')}</option>${typeOpts}</select>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_shipping_line')}</label>
                        <input type="text" data-sf="shipping_line" value="${esc(s.shipping_line)}" placeholder="Ej. MAERSK"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_vessel')}</label>
                        <input type="text" data-sf="vessel_name" value="${esc(s.vessel_name)}" placeholder="Ej. SEALAND VOYAGER"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_etd')}</label>
                        <input type="date" data-sf="etd" value="${esc(s.etd)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_eta')}</label>
                        <input type="date" data-sf="eta" value="${esc(s.eta)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_origin')}</label>
                        <input type="text" data-sf="port_origin" value="${esc(s.port_origin)}" placeholder="${this.t('ph_origin')}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_dest')}</label>
                        <input type="text" data-sf="port_destination" value="${esc(s.port_destination)}" placeholder="${this.t('ph_dest')}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_status')}</label>
                        <select data-sf="status">${statusOpts}</select>
                    </div>
                    <div class="sf-field sf-wide">
                        <label>${this.t('lbl_notes')}</label>
                        <textarea data-sf="notes" rows="2">${esc(s.notes)}</textarea>
                    </div>
                </div>
                <div class="text-end">
                    <button type="button" class="btn-save-section btn-save-shipment-data" data-sid="${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            el.querySelector('.btn-save-shipment-data').addEventListener('click', () => this.saveShipmentData(s.id, el));
        }

        async saveShipmentData(shipmentId, formEl) {
            const data = {};
            formEl.querySelectorAll('[data-sf]').forEach(input => {
                data[input.dataset.sf] = input.value;
            });
            try {
                const res = await jsonRpc('/supplier/api/v2/update_shipment', {
                    token: this.token, shipment_id: shipmentId, shipment_data: data
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        // --- BL TAB ---
        renderBLTab(el, s) {
            el.innerHTML = `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_number')}</label>
                        <input type="text" id="bl-num-${s.id}" value="${esc(s.bl_number)}" placeholder="Ej. COSU123456"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_date')}</label>
                        <input type="date" id="bl-date-${s.id}" value="${esc(s.bl_date)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_file')}</label>
                        <input type="file" id="bl-file-${s.id}" accept=".pdf,.jpg,.jpeg,.png"/>
                    </div>
                </div>
                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section" id="btn-save-bl-${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            document.getElementById(`btn-save-bl-${s.id}`).addEventListener('click', async () => {
                const blData = {
                    bl_number: document.getElementById(`bl-num-${s.id}`).value,
                    bl_date: document.getElementById(`bl-date-${s.id}`).value || false,
                };
                try {
                    await jsonRpc('/supplier/api/v2/update_shipment', {
                        token: this.token, shipment_id: s.id, shipment_data: blData
                    });
                    const fileInput = document.getElementById(`bl-file-${s.id}`);
                    if (fileInput.files.length > 0) {
                        const fileData = await this.readFileAsBase64(fileInput.files[0]);
                        await jsonRpc('/supplier/api/v2/upload_file', {
                            token: this.token, target_model: 'supplier.shipment',
                            target_id: s.id, field_name: 'bl_file',
                            file_data: fileData.data, file_name: fileData.name
                        });
                    }
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } catch (e) {
                    this.toast(this.t('msg_error') + e.message, 'error');
                }
            });
        }

        // --- INVOICES TAB ---
        renderInvoicesTab(el, s) {
            const invoices = s.invoices || [];
            let html = '';
            invoices.forEach((inv, idx) => {
                html += this._invoiceCard(inv, idx, s);
            });
            html += `<button type="button" class="btn-add-sub-item btn-add-inv" data-sid="${s.id}"><i class="fa fa-plus me-2"></i>${this.t('btn_add_invoice')}</button>`;
            html += `<div class="text-end mt-3"><button type="button" class="btn-save-section btn-save-all-invoices" data-sid="${s.id}"><i class="fa fa-save me-2"></i>${this.t('btn_save_invoices')}</button></div>`;
            el.innerHTML = html;

            el.querySelector('.btn-add-inv').addEventListener('click', () => {
                s.invoices = s.invoices || [];
                s.invoices.push({ id: 0, invoice_number: '', invoice_date: '', amount: 0, scope: 'full_shipment', container_ids: [] });
                this.renderTabContent('invoices', s);
            });
            el.querySelectorAll('.btn-remove-inv').forEach(btn => {
                btn.addEventListener('click', () => {
                    s.invoices.splice(parseInt(btn.dataset.idx), 1);
                    this.renderTabContent('invoices', s);
                });
            });
            el.querySelector('.btn-save-all-invoices').addEventListener('click', () => this.saveInvoices(s));
        }

        _invoiceCard(inv, idx, s) {
            return `<div class="sub-item-card">
                <div class="sub-item-header">
                    <span class="sub-item-title">Invoice #${idx + 1}</span>
                    <div class="sub-item-actions"><button type="button" class="btn-remove-inv" data-idx="${idx}"><i class="fa fa-trash"></i></button></div>
                </div>
                <div class="sub-item-grid">
                    <div class="sub-item-field"><label>${this.t('lbl_inv_number')}</label><input type="text" data-inv-idx="${idx}" data-inv-f="invoice_number" value="${esc(inv.invoice_number)}"/></div>
                    <div class="sub-item-field"><label>${this.t('lbl_inv_date')}</label><input type="date" data-inv-idx="${idx}" data-inv-f="invoice_date" value="${esc(inv.invoice_date)}"/></div>
                    <div class="sub-item-field"><label>${this.t('lbl_inv_amount')}</label><input type="number" step="0.01" data-inv-idx="${idx}" data-inv-f="amount" value="${inv.amount || 0}"/></div>
                    <div class="sub-item-field"><label>${this.t('lbl_inv_scope')}</label>
                        <select data-inv-idx="${idx}" data-inv-f="scope">
                            <option value="full_shipment" ${inv.scope === 'full_shipment' ? 'selected' : ''}>${this.t('scope_full')}</option>
                            <option value="specific_containers" ${inv.scope === 'specific_containers' ? 'selected' : ''}>${this.t('scope_specific')}</option>
                        </select>
                    </div>
                </div>
            </div>`;
        }

        async saveInvoices(s) {
            const el = document.getElementById(`stab-invoices-${s.id}`);
            const invoicesData = [];
            (s.invoices || []).forEach((inv, idx) => {
                const data = { id: inv.id || 0 };
                el.querySelectorAll(`[data-inv-idx="${idx}"]`).forEach(input => { data[input.dataset.invF] = input.value; });
                data.amount = parseFloat(data.amount) || 0;
                invoicesData.push(data);
            });
            try {
                const res = await jsonRpc('/supplier/api/v2/save_invoices', { token: this.token, shipment_id: s.id, invoices: invoicesData });
                if (res.success) { await this.reloadProforma(); this.renderAll(); this.toast(this.t('msg_saved'), 'success'); }
            } catch (e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // --- CONTAINERS TAB ---
        renderContainersTab(el, s) {
            const containers = s.containers || [];
            let html = '';
            containers.forEach((c, idx) => {
                html += `<div class="sub-item-card">
                    <div class="sub-item-header">
                        <span class="sub-item-title">${esc(c.container_number) || 'Container #' + (idx + 1)}</span>
                        <div class="sub-item-actions"><button type="button" class="btn-remove-cnt" data-idx="${idx}"><i class="fa fa-trash"></i></button></div>
                    </div>
                    <div class="sub-item-grid">
                        <div class="sub-item-field"><label>${this.t('lbl_cont_number')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="container_number" value="${esc(c.container_number)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_seal')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="seal_number" value="${esc(c.seal_number)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_type')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="container_type" value="${esc(c.container_type)}" placeholder="40HC, 20GP"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_weight')}</label><input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="weight" value="${c.weight || 0}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_volume')}</label><input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="volume" value="${c.volume || 0}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_packages')}</label><input type="number" data-cnt-idx="${idx}" data-cnt-f="packages" value="${c.packages || 0}"/></div>
                    </div>
                </div>`;
            });
            html += `<button type="button" class="btn-add-sub-item btn-add-cnt" data-sid="${s.id}"><i class="fa fa-plus me-2"></i>${this.t('btn_add_container')}</button>`;
            html += `<div class="text-end mt-3"><button type="button" class="btn-save-section btn-save-all-cnts" data-sid="${s.id}"><i class="fa fa-save me-2"></i>${this.t('btn_save_containers')}</button></div>`;
            el.innerHTML = html;

            el.querySelector('.btn-add-cnt').addEventListener('click', () => {
                s.containers = s.containers || [];
                s.containers.push({ id: 0, container_number: '', seal_number: '', container_type: '', weight: 0, volume: 0, packages: 0, notes: '' });
                this.renderTabContent('containers', s);
            });
            el.querySelectorAll('.btn-remove-cnt').forEach(btn => {
                btn.addEventListener('click', () => { s.containers.splice(parseInt(btn.dataset.idx), 1); this.renderTabContent('containers', s); });
            });
            el.querySelector('.btn-save-all-cnts').addEventListener('click', () => this.saveContainers(s));
        }

        async saveContainers(s) {
            const el = document.getElementById(`stab-containers-${s.id}`);
            const containersData = [];
            (s.containers || []).forEach((c, idx) => {
                const data = { id: c.id || 0 };
                el.querySelectorAll(`[data-cnt-idx="${idx}"]`).forEach(input => { data[input.dataset.cntF] = input.value; });
                data.weight = parseFloat(data.weight) || 0;
                data.volume = parseFloat(data.volume) || 0;
                data.packages = parseInt(data.packages) || 0;
                containersData.push(data);
            });
            try {
                const res = await jsonRpc('/supplier/api/v2/save_containers', { token: this.token, shipment_id: s.id, containers: containersData });
                if (res.success) { await this.reloadProforma(); this.renderAll(); this.toast(this.t('msg_saved'), 'success'); }
            } catch (e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // =====================================================================
        //  PACKINGS TAB — CONTAINER-FIRST
        // =====================================================================
        getShipmentContainers(s) {
            return (s.containers || []).map(c => ({
                id: asInt(c.id),
                name: c.container_number || `Container #${c.id || ''}`,
                raw: c
            })).filter(c => c.id > 0 || c.raw.container_number || c.raw.seal_number);
        }

        inferPackingMeta(pk, s) {
            const rows = pk.rows || [];
            const explicitIds = Array.isArray(pk.container_ids) ? pk.container_ids.map(asInt).filter(Boolean) : [];
            const rowIds = [...new Set(rows.map(r => asInt(r.container_id)).filter(Boolean))];
            const mergedIds = [...new Set([...explicitIds, ...rowIds])];

            let uiMode = 'full_shipment';
            if (mergedIds.length === 1) uiMode = 'single_container';
            else if (mergedIds.length > 1) uiMode = 'multi_container';
            else if (pk.scope === 'specific_containers') uiMode = 'single_container';

            return {
                ui_mode: pk.ui_mode || uiMode,
                container_ids: mergedIds,
                primary_container_id: mergedIds.length === 1 ? mergedIds[0] : 0,
                detected_mode: uiMode,
            };
        }

        normalizePackingRowsCache(pk) {
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
                    this.products.forEach(p => {
                        this.packingRows[rowsKey].push(this._newProductRow(p));
                    });
                }
            }
            return this.packingRows[rowsKey];
        }

        renderPackingsTab(el, s) {
            const packings = s.packings || [];
            const containers = this.getShipmentContainers(s);

            let html = `
                <div class="packing-structure-banner">
                    <div class="packing-structure-banner-title">
                        <i class="fa fa-sitemap"></i> ${this.t('pk_mode_title')}
                    </div>
                    <div class="packing-structure-banner-text">
                        ${containers.length > 0 ? this.t('pk_recommendation_single') : this.t('msg_no_containers_yet')}
                    </div>
                </div>
            `;

            html += `
                <div class="packing-toolbar">
                    <button type="button" class="btn-add-sub-item btn-add-pk-single" ${containers.length === 0 ? 'disabled' : ''}>
                        <i class="fa fa-plus me-2"></i>${this.t('btn_add_packing_single')}
                    </button>
                    <button type="button" class="btn-add-sub-item btn-add-pk-multi" ${containers.length === 0 ? 'disabled' : ''}>
                        <i class="fa fa-plus me-2"></i>${this.t('btn_add_packing_multi')}
                    </button>
                    <button type="button" class="btn-add-sub-item btn-add-pk-full">
                        <i class="fa fa-plus me-2"></i>${this.t('btn_add_packing_full')}
                    </button>
                </div>
            `;

            html += `<div class="container-first-title"><i class="fa fa-cubes"></i> ${this.t('pk_group_title')}</div>`;

            containers.forEach(container => {
                const related = packings.filter(pk => this.packingBelongsToContainer(pk, container.id, s));
                html += `
                    <div class="container-packing-group">
                        <div class="container-packing-group-header">
                            <div class="container-packing-group-title">${esc(container.name)}</div>
                            <div class="container-packing-group-meta">
                                <span class="chip">${related.length} packings</span>
                            </div>
                        </div>
                        <div class="container-packing-group-body">
                            ${related.length ? related.map((pk, idx) => this._packingCard(pk, idx, s, containers)).join('') : `<div class="empty-inline">${this.t('pk_no_packings_for_container')}</div>`}
                        </div>
                    </div>
                `;
            });

            const unassigned = packings.filter(pk => !this.packingHasAnyContainer(pk, s));
            html += `
                <div class="container-packing-group unassigned-group">
                    <div class="container-packing-group-header">
                        <div class="container-packing-group-title">${this.t('pk_group_unassigned')}</div>
                    </div>
                    <div class="container-packing-group-body">
                        ${unassigned.length ? unassigned.map((pk, idx) => this._packingCard(pk, idx, s, containers)).join('') : `<div class="empty-inline">—</div>`}
                    </div>
                </div>
            `;

            el.innerHTML = html;

            const btnSingle = el.querySelector('.btn-add-pk-single');
            const btnMulti = el.querySelector('.btn-add-pk-multi');
            const btnFull = el.querySelector('.btn-add-pk-full');

            if (btnSingle) btnSingle.addEventListener('click', async () => this.createPacking(s, 'single_container'));
            if (btnMulti) btnMulti.addEventListener('click', async () => this.createPacking(s, 'multi_container'));
            if (btnFull) btnFull.addEventListener('click', async () => this.createPacking(s, 'full_shipment'));

            el.querySelectorAll('.btn-delete-pk').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(this.t('msg_confirm_delete'))) return;
                    try {
                        await jsonRpc('/supplier/api/v2/delete_packing', { token: this.token, packing_id: parseInt(btn.dataset.pkId) });
                        await this.reloadProforma();
                        this.renderAll();
                        this.toast(this.t('msg_saved'), 'success');
                    } catch (e) { this.toast(this.t('msg_error') + e.message, 'error'); }
                });
            });

            el.querySelectorAll('.btn-save-pk').forEach(btn => {
                btn.addEventListener('click', () => this.savePacking(parseInt(btn.dataset.pkId), parseInt(btn.dataset.sid), el));
            });

            el.querySelectorAll('.btn-toggle-packing-rows').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pkId = parseInt(btn.dataset.pkId);
                    const area = document.getElementById(`pk-rows-${pkId}`);
                    if (!area) return;
                    const wasVisible = area.style.display !== 'none';
                    area.style.display = wasVisible ? 'none' : 'block';
                    btn.innerHTML = `<i class="fa fa-table me-1"></i>${wasVisible ? this.t('btn_expand_rows') : this.t('btn_hide_rows')}`;
                    if (!wasVisible) {
                        const pk = packings.find(p => p.id === pkId);
                        this.renderPackingRows(area, pk, s);
                    }
                });
            });

            el.querySelectorAll('.pk-mode-select').forEach(sel => {
                sel.addEventListener('change', () => {
                    const pkId = parseInt(sel.dataset.pkId);
                    const pk = packings.find(p => p.id === pkId);
                    if (pk) {
                        pk.ui_mode = sel.value;
                        this.renderTabContent('packings', s);
                    }
                });
            });

            packings.forEach(pk => {
                const area = document.getElementById(`pk-rows-${pk.id}`);
                if (area) this.renderPackingRows(area, pk, s);
            });
        }

        packingHasAnyContainer(pk, s) {
            const meta = this.inferPackingMeta(pk, s);
            return (meta.container_ids || []).length > 0;
        }

        packingBelongsToContainer(pk, containerId, s) {
            const meta = this.inferPackingMeta(pk, s);
            return (meta.container_ids || []).includes(asInt(containerId));
        }

        _packingCard(pk, idx, s, containers) {
            const meta = this.inferPackingMeta(pk, s);
            pk.ui_mode = pk.ui_mode || meta.ui_mode;
            pk.container_ids = pk.container_ids || meta.container_ids || [];

            const linkedIds = [...new Set((pk.container_ids || meta.container_ids || []).map(asInt).filter(Boolean))];
            const linkedBadges = linkedIds.length
                ? linkedIds.map(cid => {
                    const c = containers.find(x => x.id === cid);
                    return `<span class="mini-chip">${esc(c ? c.name : `#${cid}`)}</span>`;
                }).join('')
                : `<span class="text-muted">—</span>`;

            const modeOptions = `
                <option value="full_shipment" ${pk.ui_mode === 'full_shipment' ? 'selected' : ''}>${this.t('pk_mode_full')}</option>
                <option value="single_container" ${pk.ui_mode === 'single_container' ? 'selected' : ''}>${this.t('pk_mode_single')}</option>
                <option value="multi_container" ${pk.ui_mode === 'multi_container' ? 'selected' : ''}>${this.t('pk_mode_multi')}</option>
            `;

            const singleSelect = `
                <div class="sub-item-field">
                    <label>${this.t('pk_single_container')}</label>
                    <select data-pk-id="${pk.id}" data-pk-f="single_container_id" class="pk-single-container-select">
                        <option value="">${this.t('opt_select')}</option>
                        ${containers.map(c => `<option value="${c.id}" ${linkedIds.length === 1 && linkedIds[0] === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                    </select>
                </div>
            `;

            const multiChecks = `
                <div class="sub-item-field sub-item-field-wide">
                    <label>${this.t('pk_multi_containers')}</label>
                    <div class="pk-multi-container-list">
                        ${containers.map(c => `
                            <label class="pk-checkbox-item">
                                <input type="checkbox" class="pk-multi-container-check" data-pk-id="${pk.id}" value="${c.id}" ${linkedIds.includes(c.id) ? 'checked' : ''}/>
                                <span>${esc(c.name)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;

            const hintMap = {
                full_shipment: this.t('pk_full_hint'),
                single_container: this.t('pk_container_first_hint'),
                multi_container: this.t('pk_shared_hint'),
            };

            return `<div class="sub-item-card packing-card" data-packing-id="${pk.id}">
                <div class="sub-item-header">
                    <span class="sub-item-title">${esc(pk.packing_number) || 'Packing #' + (idx + 1)} <small class="text-muted">(${(pk.rows || []).length} rows)</small></span>
                    <div class="sub-item-actions">
                        <button type="button" class="btn-toggle-packing-rows" data-pk-id="${pk.id}" title="${this.t('btn_expand_rows')}"><i class="fa fa-table me-1"></i>${this.t('btn_expand_rows')}</button>
                        <button type="button" class="btn-delete-pk" data-pk-id="${pk.id}"><i class="fa fa-trash"></i></button>
                    </div>
                </div>

                <div class="packing-mode-box">
                    <div class="packing-mode-box-head">
                        <strong>${this.t('pk_mode_title')}</strong>
                        <span class="mode-detected-pill">${this.t('lbl_detected_mode')}: ${this.t(meta.detected_mode === 'single_container' ? 'pk_detected_single' : meta.detected_mode === 'multi_container' ? 'pk_detected_multi' : 'pk_detected_full')}</span>
                    </div>
                    <div class="packing-mode-box-note">${hintMap[pk.ui_mode] || ''}</div>
                </div>

                <div class="sub-item-grid">
                    <div class="sub-item-field">
                        <label>${this.t('lbl_pk_number')}</label>
                        <input type="text" data-pk-id="${pk.id}" data-pk-f="packing_number" value="${esc(pk.packing_number)}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_pk_date')}</label>
                        <input type="date" data-pk-id="${pk.id}" data-pk-f="packing_date" value="${esc(pk.packing_date)}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_mode')}</label>
                        <select data-pk-id="${pk.id}" class="pk-mode-select">${modeOptions}</select>
                    </div>
                    <div class="sub-item-field sub-item-field-wide">
                        <label>${this.t('lbl_containers_linked')}</label>
                        <div class="linked-container-badges">${linkedBadges}</div>
                    </div>
                    ${pk.ui_mode === 'single_container' ? singleSelect : ''}
                    ${pk.ui_mode === 'multi_container' ? multiChecks : ''}
                </div>

                <div class="packing-rows-area" id="pk-rows-${pk.id}" style="display:none; margin-top: 1rem;"></div>

                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section btn-save-pk" data-pk-id="${pk.id}" data-sid="${s.id}" style="font-size:0.8rem;padding:6px 16px;">
                        <i class="fa fa-save me-1"></i> ${this.t('btn_save_packing')}
                    </button>
                </div>
            </div>`;
        }

        async createPacking(s, mode) {
            try {
                const payload = { packing_number: '', scope: mode === 'full_shipment' ? 'full_shipment' : 'specific_containers' };
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: s.id,
                    packing_data: payload,
                    rows: []
                });
                if (res.success) {
                    await this.reloadProforma();
                    const shipment = (this.proforma.shipments || []).find(x => x.id === s.id);
                    const created = shipment && shipment.packings && shipment.packings.length
                        ? shipment.packings[shipment.packings.length - 1]
                        : null;
                    if (created) created.ui_mode = mode;
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        getPackingModeAndContainers(packingId, formEl, s, pk) {
            const modeSel = formEl.querySelector(`.pk-mode-select[data-pk-id="${packingId}"]`);
            const uiMode = modeSel ? modeSel.value : (pk.ui_mode || 'full_shipment');

            let containerIds = [];
            if (uiMode === 'single_container') {
                const sel = formEl.querySelector(`.pk-single-container-select[data-pk-id="${packingId}"]`);
                const cid = sel ? asInt(sel.value) : 0;
                if (cid) containerIds = [cid];
            } else if (uiMode === 'multi_container') {
                containerIds = [...formEl.querySelectorAll(`.pk-multi-container-check[data-pk-id="${packingId}"]:checked`)].map(ch => asInt(ch.value)).filter(Boolean);
            }

            const scope = uiMode === 'full_shipment' ? 'full_shipment' : 'specific_containers';
            return { uiMode, containerIds, scope };
        }

        async savePacking(packingId, shipmentId, formEl) {
            const shipment = (this.proforma.shipments || []).find(x => x.id === shipmentId);
            const pk = ((shipment && shipment.packings) || []).find(x => x.id === packingId);
            const pkData = {};
            formEl.querySelectorAll(`[data-pk-id="${packingId}"][data-pk-f]`).forEach(input => {
                pkData[input.dataset.pkF] = input.value;
            });
            pkData.id = packingId;

            const { uiMode, containerIds, scope } = this.getPackingModeAndContainers(packingId, formEl, shipment, pk || {});
            pkData.scope = scope;
            pkData.ui_mode = uiMode;
            pkData.container_ids = containerIds;

            const rowsKey = `pk_${packingId}`;
            const rows = this.packingRows[rowsKey] || [];

            if (uiMode === 'single_container' && containerIds.length !== 1) {
                this.toast(this.t('msg_need_container_for_single'), 'error');
                return;
            }
            if (uiMode === 'multi_container' && containerIds.length === 0) {
                this.toast(this.t('msg_need_containers_for_multi'), 'error');
                return;
            }

            const rowsPayload = rows.filter(r => {
                if (r.tipo === 'Placa') return (r.alto > 0 && r.ancho > 0) || r.ref_proveedor || r.numero_placa || r.bloque;
                return (r.quantity > 0) || r.ref_proveedor || r.color;
            }).map(r => {
                let rowContainerId = asInt(r.container_id || 0);
                if (uiMode === 'single_container') rowContainerId = containerIds[0] || 0;

                return {
                    id: r.id || 0,
                    product_id: r.product_id,
                    container_id: rowContainerId,
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
                    crate_h: r.crate_h || '',
                    crate_w: r.crate_w || '',
                    crate_t: r.crate_t || '',
                    fmt_h: r.fmt_h || '',
                    fmt_w: r.fmt_w || '',
                };
            });

            if (uiMode === 'multi_container') {
                const someMissing = rowsPayload.some(r => !asInt(r.container_id));
                if (someMissing) {
                    this.toast(this.t('msg_need_row_container_for_multi'), 'error');
                    return;
                }
            }
            if (uiMode === 'single_container' && rowsPayload.length > 0) {
                const matches = rowsPayload.some(r => asInt(r.container_id) === containerIds[0]);
                if (!matches) {
                    this.toast(this.t('msg_need_rows_for_single'), 'error');
                    return;
                }
            }

            try {
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: shipmentId,
                    packing_data: pkData,
                    rows: rowsPayload.length > 0 ? rowsPayload : []
                });
                if (res.success) {
                    delete this.packingRows[rowsKey];
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        // =====================================================================
        //  PACKING ROWS (product detail lines) — with CONTAINER column + PHOTO
        // =====================================================================
        renderPackingRows(area, pk, s) {
            if (!pk) return;

            const rowsKey = `pk_${pk.id}`;
            const rows = this.normalizePackingRowsCache(pk);
            const containers = this.getShipmentContainers(s);
            const meta = this.inferPackingMeta(pk, s);
            pk.ui_mode = pk.ui_mode || meta.ui_mode;
            pk.container_ids = pk.container_ids || meta.container_ids || [];

            let html = '';

            this.products.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const pRows = rows.filter(r => r.product_id === product.id);

                html += `<div class="product-section">
                    <div class="product-header">
                        <div>
                            <h3>${esc(product.name)} <span class="text-muted small ms-2">(${esc(product.code)})</span>
                            <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span></h3>
                        </div>
                        <div class="meta">${this.t('requested')} <strong class="text-dark">${product.qty_ordered} ${product.uom}</strong></div>
                    </div>
                    <div class="table-responsive">
                        <table class="portal-table">
                            <thead>
                                <tr>`;

                if (pk.ui_mode === 'single_container' || pk.ui_mode === 'multi_container') {
                    html += `<th>${this.t('col_container_assign')}</th>`;
                }

                if (unitType === 'Placa') {
                    html += `<th>${this.t('col_block')}</th><th>${this.t('col_atado')}</th><th>${this.t('col_plate_num')}</th><th>${this.t('col_ref')}</th><th>${this.t('col_thickness')}</th><th>${this.t('col_height')}</th><th>${this.t('col_width')}</th><th>${this.t('col_area')}</th><th>${this.t('col_notes')}</th>`;
                } else if (unitType === 'Formato') {
                    html += `<th>${this.t('lbl_packages')}</th><th>${this.t('col_qty')}</th><th class="bg-light">${this.t('col_crate_h')}</th><th class="bg-light">${this.t('col_crate_w')}</th><th class="bg-light">${this.t('col_crate_t')}</th><th>${this.t('col_thickness')}</th><th>${this.t('col_weight')}</th><th class="bg-light">${this.t('col_fmt_h')}</th><th class="bg-light">${this.t('col_fmt_w')}</th>`;
                } else {
                    html += `<th>${this.t('lbl_packages')}</th><th>${this.t('col_qty')}</th><th>${this.t('col_ref')}</th><th>${this.t('col_weight')}</th><th>${this.t('lbl_desc_goods')}</th>`;
                }

                html += `<th style="width:60px">${this.t('col_photo')}</th>`;
                html += `<th style="width:50px"></th></tr></thead><tbody>`;

                pRows.forEach(row => {
                    const rid = row._id;
                    const serverRowId = row.id || 0;
                    const hasImage = row.has_image || false;

                    html += `<tr data-row-id="${rid}" data-pk-key="${rowsKey}">`;

                    const inp = (field, val, ph, type = 'text', step = '') =>
                        `<div class="input-group-portal"><input type="${type}" step="${step}" class="input-field" data-field="${field}" value="${esc(val || '')}" placeholder="${ph}">
                         <button type="button" class="btn-fill-down" data-row-id="${rid}" data-field="${field}" data-pk-key="${rowsKey}" tabindex="-1"><i class="fa fa-arrow-down"></i></button></div>`;

                    if (pk.ui_mode === 'single_container') {
                        const containerLabel = (() => {
                            const cid = (pk.container_ids && pk.container_ids[0]) || (meta.container_ids && meta.container_ids[0]) || 0;
                            const c = containers.find(x => x.id === cid);
                            row.container_id = cid || 0;
                            return c ? esc(c.name) : '—';
                        })();
                        html += `<td data-label="${this.t('col_container_assign')}"><span class="fixed-container-badge">${containerLabel}</span></td>`;
                    } else if (pk.ui_mode === 'multi_container') {
                        const allowedIds = (pk.container_ids || meta.container_ids || []).map(asInt).filter(Boolean);
                        const available = containers.filter(c => allowedIds.length === 0 || allowedIds.includes(c.id));
                        html += `<td data-label="${this.t('col_container_assign')}">
                            <select class="row-container-select" data-row-id="${rid}" data-pk-key="${rowsKey}">
                                <option value="">${this.t('opt_select')}</option>
                                ${available.map(c => `<option value="${c.id}" ${asInt(row.container_id) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                            </select>
                        </td>`;
                    }

                    if (unitType === 'Placa') {
                        const areaVal = ((row.alto || 0) * (row.ancho || 0)).toFixed(2);
                        html += `<td data-label="${this.t('col_block')}">${inp('bloque', row.bloque, '')}</td>
                            <td data-label="${this.t('col_atado')}">${inp('atado', row.atado, '')}</td>
                            <td data-label="${this.t('col_plate_num')}">${inp('numero_placa', row.numero_placa, '')}</td>
                            <td data-label="${this.t('col_ref')}">${inp('ref_proveedor', row.ref_proveedor, '')}</td>
                            <td data-label="${this.t('col_thickness')}">${inp('grosor', row.grosor, '', 'text')}</td>
                            <td data-label="${this.t('col_height')}">${inp('alto', row.alto, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_width')}">${inp('ancho', row.ancho, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${areaVal}</span></td>
                            <td data-label="${this.t('col_notes')}">${inp('color', row.color, '')}</td>`;
                    } else if (unitType === 'Formato') {
                        html += `<td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('crate_h', row.crate_h || '', '', 'text')}</td>
                            <td>${inp('crate_w', row.crate_w || '', '', 'text')}</td>
                            <td>${inp('crate_t', row.crate_t || '', '', 'text')}</td>
                            <td>${inp('grosor', row.grosor, '', 'text')}</td>
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>
                            <td>${inp('fmt_h', row.fmt_h || '', '', 'text')}</td>
                            <td>${inp('fmt_w', row.fmt_w || '', '', 'text')}</td>`;
                    } else {
                        html += `<td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('ref_proveedor', row.ref_proveedor, '')}</td>
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
                                <input type="file" accept="image/*" capture="environment"
                                       data-server-row-id="${serverRowId}" data-row-id="${rid}"
                                       class="photo-file-input" style="display:none"/>
                            </label>
                        </td>`;
                    }

                    html += `<td class="text-center"><button class="btn-action btn-delete-row" type="button"><i class="fa fa-trash"></i></button></td></tr>`;
                });

                html += `</tbody></table>
                    <div class="table-actions">
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" type="button"><i class="fa fa-plus-circle me-2"></i>${this.t('btn_add_row')}</button>
                        <button class="btn-add-row ms-2 action-add-pk-multi" data-product-id="${product.id}" data-pk-key="${rowsKey}" type="button">${this.t('btn_add_multi')}</button>
                    </div>
                </div></div>`;
            });

            area.innerHTML = html;

            if (!area._portalEventsBound) {
                area._portalEventsBound = true;

                area.addEventListener('input', e => {
                    if (e.target.classList.contains('input-field')) {
                        const tr = e.target.closest('tr');
                        const rid = parseInt(tr.dataset.rowId);
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
                            if (span) span.textContent = ((row.alto || 0) * (row.ancho || 0)).toFixed(2);
                        }
                    }
                });

                area.addEventListener('change', e => {
                    if (e.target.classList.contains('row-container-select')) {
                        const rid = parseInt(e.target.dataset.rowId);
                        const key = e.target.dataset.pkKey;
                        const row = (this.packingRows[key] || []).find(r => r._id === rid);
                        if (row) row.container_id = asInt(e.target.value);
                    }

                    if (e.target.classList.contains('photo-file-input')) {
                        const fileInput = e.target;
                        const serverRowId = parseInt(fileInput.dataset.serverRowId);
                        const localRowId = parseInt(fileInput.dataset.rowId);
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

                        this.uploadRowImage(serverRowId, localRowId, rowsKey, file, area, pk, s);
                    }
                });

                area.addEventListener('click', e => {
                    const delBtn = e.target.closest('.btn-delete-row');
                    const addBtn = e.target.closest('.action-add-pk-row');
                    const addMulti = e.target.closest('.action-add-pk-multi');
                    const fillBtn = e.target.closest('.btn-fill-down');
                    const photoDoneBtn = e.target.closest('.btn-photo-done');

                    if (photoDoneBtn) {
                        const serverRowId = parseInt(photoDoneBtn.dataset.serverRowId);
                        const localRowId = parseInt(photoDoneBtn.dataset.rowId);
                        this.deleteRowImage(serverRowId, localRowId, rowsKey, area, pk, s);
                        return;
                    }

                    if (delBtn) {
                        const tr = delBtn.closest('tr');
                        const rid = parseInt(tr.dataset.rowId);
                        const key = tr.dataset.pkKey;
                        this.packingRows[key] = (this.packingRows[key] || []).filter(r => r._id !== rid);
                        this.renderPackingRows(area, pk, s);
                    } else if (addBtn) {
                        const pid = parseInt(addBtn.dataset.productId);
                        const key = addBtn.dataset.pkKey;
                        const p = this.products.find(x => x.id === pid);
                        if (p) { this.packingRows[key].push(this._newProductRow(p)); this.renderPackingRows(area, pk, s); }
                    } else if (addMulti) {
                        const pid = parseInt(addMulti.dataset.productId);
                        const key = addMulti.dataset.pkKey;
                        const p = this.products.find(x => x.id === pid);
                        if (p) { for (let i = 0; i < 5; i++) this.packingRows[key].push(this._newProductRow(p)); this.renderPackingRows(area, pk, s); }
                    } else if (fillBtn) {
                        const rid = parseInt(fillBtn.dataset.rowId);
                        const field = fillBtn.dataset.field;
                        const key = fillBtn.dataset.pkKey;
                        const rws = this.packingRows[key] || [];
                        const src = rws.find(r => r._id === rid);
                        if (!src) return;
                        let started = false;
                        rws.forEach(r => {
                            if (r._id === rid) { started = true; return; }
                            if (started && r.product_id === src.product_id) {
                                r[field] = src[field];
                                if (field === 'container_id') r[field] = src[field];
                            }
                        });
                        this.renderPackingRows(area, pk, s);
                    }
                });
            }
        }

        _newProductRow(product) {
            const unitType = product.unit_type || 'Placa';
            return {
                _id: this.nextRowId++,
                id: 0,
                product_id: product.id,
                tipo: unitType,
                bloque: '', numero_placa: '', atado: '', grosor: '',
                alto: 0, ancho: 0, peso: 0, quantity: 0, weight: 0,
                color: '', ref_proveedor: '', grupo_name: '', pedimento: '',
                crate_h: '', crate_w: '', crate_t: '', fmt_h: '', fmt_w: '',
                container_id: 0,
                has_image: false,
            };
        }

        // =====================================================================
        //  PHOTO UPLOAD / DELETE
        // =====================================================================
        async uploadRowImage(serverRowId, localRowId, pkKey, file, area, pk, s) {
            try {
                const fileData = await this.readFileAsBase64(file);
                const res = await jsonRpc('/supplier/api/v2/upload_row_image', {
                    token: this.token,
                    row_id: serverRowId,
                    image_data: fileData.data,
                    image_name: fileData.name,
                });
                if (res.success) {
                    const rows = this.packingRows[pkKey] || [];
                    const row = rows.find(r => r._id === localRowId);
                    if (row) row.has_image = true;
                    this.toast('📷 ' + this.t('msg_saved'), 'success');
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, true);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                console.error("[Portal] uploadRowImage ERROR:", e);
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        async deleteRowImage(serverRowId, localRowId, pkKey, area, pk, s) {
            if (!confirm(this.t('msg_confirm_delete_photo'))) return;
            try {
                const res = await jsonRpc('/supplier/api/v2/delete_row_image', {
                    token: this.token,
                    row_id: serverRowId,
                });
                if (res.success) {
                    const rows = this.packingRows[pkKey] || [];
                    const row = rows.find(r => r._id === localRowId);
                    if (row) row.has_image = false;
                    this.toast(this.t('msg_photo_deleted'), 'success');
                    this._updatePhotoCellInPlace(area, localRowId, serverRowId, false);
                } else {
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        _updatePhotoCellInPlace(area, localRowId, serverRowId, hasImage) {
            if (!area) return;
            const tr = area.querySelector(`tr[data-row-id="${localRowId}"]`);
            if (!tr) return;

            const tds = tr.querySelectorAll('td');
            const photoTd = tds[tds.length - 2];
            if (!photoTd) return;

            if (hasImage) {
                photoTd.innerHTML = `
                    <button class="btn-photo-done" type="button" data-server-row-id="${serverRowId}" data-row-id="${localRowId}" title="${this.t('msg_confirm_delete_photo')}">
                        <i class="fa fa-check-circle" style="color:#16a34a;font-size:1.1rem"></i>
                    </button>`;
            } else {
                photoTd.innerHTML = `
                    <label class="btn-photo-upload" title="${this.t('col_photo')}" style="cursor:pointer;margin:0">
                        <i class="fa fa-camera" style="color:#8B5A2B;font-size:1rem"></i>
                        <input type="file" accept="image/*" capture="environment"
                               data-server-row-id="${serverRowId}" data-row-id="${localRowId}"
                               class="photo-file-input" style="display:none"/>
                    </label>`;
            }
        }

        // =====================================================================
        //  RELOAD & FOOTER
        // =====================================================================
        async reloadProforma() {
            try {
                const res = await jsonRpc('/supplier/api/v2/reload', { token: this.token });
                if (res.success && res.proforma) {
                    this.proforma = res.proforma;
                    this.packingRows = {};
                }
            } catch (e) {
                console.error('[Portal] reloadProforma ERROR:', e.message);
            }
        }

        updateFooterTotals() {
            const shipments = this.proforma.shipments || [];
            let totalContainers = 0, totalInvoices = 0;
            shipments.forEach(s => {
                totalContainers += (s.containers || []).length;
                totalInvoices += (s.invoices || []).length;
            });

            const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            setEl('total-shipments', shipments.length);
            setEl('total-containers', totalContainers);
            setEl('total-invoices', totalInvoices);

            const btn = document.getElementById('btn-complete-proforma');
            if (btn) btn.disabled = shipments.length === 0;
        }

        async completeProforma() {
            if (!confirm(this.t('msg_confirm_complete'))) return;
            try {
                await jsonRpc('/supplier/api/v2/complete', { token: this.token });
                await this.reloadProforma();
                this.renderAll();
                this.toast(this.t('msg_saved'), 'success');
            } catch (e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // =====================================================================
        //  GLOBAL EVENTS
        // =====================================================================
        bindGlobalEvents() {
            if (this._eventsBound) return;
            this._eventsBound = true;

            const btnSaveGlobals = document.getElementById('btn-save-globals');
            const btnAddShipment = document.getElementById('btn-add-shipment');
            const btnComplete = document.getElementById('btn-complete-proforma');

            if (btnSaveGlobals) {
                const parentForm = btnSaveGlobals.closest('form');
                if (parentForm) parentForm.addEventListener('submit', (e) => { e.preventDefault(); });
                btnSaveGlobals.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    this.saveGlobals();
                });
            }

            if (btnAddShipment) {
                const parentForm = btnAddShipment.closest('form');
                if (parentForm) parentForm.addEventListener('submit', (e) => { e.preventDefault(); });
                btnAddShipment.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    this.addShipment();
                });
            }

            if (btnComplete) {
                btnComplete.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    this.completeProforma();
                });
            }
        }

        // =====================================================================
        //  UTILITIES
        // =====================================================================
        readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve({ name: file.name, data: e.target.result.split(',')[1] });
                reader.onerror = () => reject(new Error('File read failed'));
                reader.readAsDataURL(file);
            });
        }

        toast(msg, type = 'info') {
            let toastEl = document.querySelector('.portal-toast');
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.className = 'portal-toast';
                document.body.appendChild(toastEl);
            }
            toastEl.className = `portal-toast toast-${type}`;
            toastEl.textContent = msg;
            requestAnimationFrame(() => { toastEl.classList.add('show'); });
            setTimeout(() => { toastEl.classList.remove('show'); }, 3000);
        }
    }

    window.supplierPortal = new SupplierPortal();
})();