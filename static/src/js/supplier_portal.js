/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script Multi-Contenedor (Tipos Unidades) cargado.");

    // --- DICCIONARIO DE TRADUCCIONES COMPLETO ---
    const TRANSLATIONS = {
        en: {
            header_provider: "VENDOR",
            po_label: "Purchase Order:",
            receipt_label: "Receipt:",
            shipment_data_title: "Shipment Data",
            lbl_invoice: "Invoice No.",
            ph_invoice: "Ex. INV-2024-001",
            lbl_date: "Shipment Date",
            lbl_proforma: "Proforma No. (PI)",
            ph_proforma: "Ex. PI-9920",
            lbl_bl: "B/L No.",
            ph_bl: "Ex. COSU123456",
            sec_logistics: "Logistics (Global)",
            lbl_origin: "Origin (Port)",
            ph_origin: "Ex. Shanghai",
            lbl_dest: "Destination (Port)",
            ph_dest: "Ex. Manzanillo",
            lbl_country: "Country of Origin",
            ph_country: "Ex. China",
            lbl_vessel: "Vessel / Voyage",
            ph_vessel: "Ex. MAERSK SEALAND",
            lbl_incoterm: "Incoterm",
            ph_incoterm: "Ex. CIF",
            lbl_payment: "Payment Terms",
            ph_payment: "Ex. T/T 30%",
            lbl_status: "Status",
            opt_select: "Select...",
            opt_production: "In Production",
            opt_origin_port: "In Origin Port",
            opt_transit: "In Transit",
            opt_dest_port: "In Destination Port",
            // Multi-Container Specifics
            msg_multi_pl_info: "Logistics and Documentation data remain global. Only update 'Cargo Details' and 'Products' for each Packing List/Container.",
            sec_cargo: "Cargo Details (Current Container)",
            lbl_container: "Container No.",
            ph_container: "Ex. MSKU1234567",
            lbl_seal: "Seal No.",
            ph_seal: "Ex. 123456",
            lbl_cont_type: "Container Type",
            ph_cont_type: "Ex. 40HC, 20GP",
            lbl_packages: "Total Packages",
            lbl_weight: "Gross Weight (kg)",
            lbl_volume: "Volume (m³)",
            lbl_desc: "Merchandise Desc.",
            ph_desc: "General cargo description...",
            lbl_files: "Attach Container Documents",
            lbl_staged_title: "Containers Ready to Submit",
            
            pl_title: "Packing List Details",
            pl_instruction: "Enter dimensions. 'Container' field is auto-filled based on Cargo Details.",
            loading: "Loading...",
            
            // Totales Nuevos
            footer_total_plates: "Total Items:",
            footer_total_area: "Total Area (m²):",
            footer_total_pieces: "Total Pieces:",
            
            btn_add_next: "Save Container & Add Next",
            btn_submit: "Finish & Submit All",
            
            msg_confirm_stage: "Are you sure you want to save this container and add another one?",
            msg_container_required: "Container Number is required in Cargo Details.",
            msg_rows_required: "Please add at least one product line with dimensions/quantity.",
            msg_staged_success: "Container added to list. You can now enter the next one.",
            msg_remove_staged: "Remove this container?",
            
            requested: "Requested:",
            
            // Columnas Nuevas
            col_container: "Container",
            col_block: "Block",
            col_plate_num: "Plate No.",
            col_atado: "Bundle",
            col_thickness: "Thickness (cm)",
            col_height: "Height (m)",
            col_width: "Width (m)",
            col_area: "Area (m²)",
            col_qty: "Quantity",
            col_notes: "Notes",
            
            // Tipos
            lbl_type_placa: "Plate",
            lbl_type_formato: "Tile/Format",
            lbl_type_pieza: "Piece",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "Notes",
            btn_add: "Add Item",
            btn_add_multi: "+5 Rows",
            msg_saving: "Saving...",
            msg_success: "✅ Saved successfully.",
            msg_error: "❌ Error: ",
            msg_confirm: "Save and send ALL data to Odoo?",
            empty_products: "No products pending receipt in this order.",
            err_token: "Token not found.",
            err_payload: "Empty payload."
        },
        es: {
            header_provider: "PROVEEDOR",
            po_label: "Orden de Compra:",
            receipt_label: "Recepción:",
            shipment_data_title: "Datos de Embarque",
            lbl_invoice: "No. de Factura",
            ph_invoice: "Ej. INV-2024-001",
            lbl_date: "Fecha Embarque",
            lbl_proforma: "No. Proforma (PI)",
            ph_proforma: "Ej. PI-9920",
            lbl_bl: "No. B/L",
            ph_bl: "Ej. COSU123456",
            sec_logistics: "Logística (Global)",
            lbl_origin: "Origen (Puerto)",
            ph_origin: "Ej. Shanghai",
            lbl_dest: "Destino (Puerto)",
            ph_dest: "Ej. Manzanillo",
            lbl_country: "País Origen",
            ph_country: "Ej. China",
            lbl_vessel: "Buque / Viaje",
            ph_vessel: "Ej. MAERSK SEALAND",
            lbl_incoterm: "Incoterm",
            ph_incoterm: "Ej. CIF",
            lbl_payment: "Forma de Pago",
            ph_payment: "Ej. T/T 30%",
            lbl_status: "Estatus",
            opt_select: "Seleccionar...",
            opt_production: "En Producción",
            opt_origin_port: "En Puerto Origen",
            opt_transit: "En Tránsito",
            opt_dest_port: "En Puerto Destino",
            // Multi-Contenedor
            msg_multi_pl_info: "Los datos de Documentación y Logística son globales. Solo actualice 'Detalles de Carga' y 'Productos' por cada Packing List.",
            sec_cargo: "Detalles de Carga (Contenedor Actual)",
            lbl_container: "No. Contenedor",
            ph_container: "Ej. MSKU1234567",
            lbl_seal: "No. Sello",
            ph_seal: "Ej. 123456",
            lbl_cont_type: "Tipo Contenedor",
            ph_cont_type: "Ej. 40HC, 20GP",
            lbl_packages: "Total Paquetes",
            lbl_weight: "Peso Bruto (kg)",
            lbl_volume: "Volumen (m³)",
            lbl_desc: "Descripción Mercancía",
            ph_desc: "Descripción general de la carga...",
            lbl_files: "Adjuntar Documentos del Contenedor",
            lbl_staged_title: "Contenedores Listos para Enviar",
            
            pl_title: "Detalle de Placas (Packing List)",
            pl_instruction: "Ingrese dimensiones. El campo 'Contenedor' se asignará automáticamente.",
            loading: "Cargando...",
            
            // Totales Nuevos
            footer_total_plates: "Items (Actual):",
            footer_total_area: "Total Área (m²):",
            footer_total_pieces: "Total Piezas:",

            btn_add_next: "Guardar Contenedor y Agregar Otro",
            btn_submit: "Finalizar y Enviar Todo",
            
            msg_confirm_stage: "¿Seguro que desea guardar este contenedor y agregar otro?",
            msg_container_required: "El Número de Contenedor es obligatorio.",
            msg_rows_required: "Agregue al menos una línea de producto con dimensiones/cantidad.",
            msg_staged_success: "Contenedor agregado a la lista. Ahora puede ingresar el siguiente.",
            msg_remove_staged: "¿Eliminar este contenedor de la lista?",
            
            requested: "Solicitado:",
            
            col_container: "Contenedor",
            col_block: "Bloque",
            col_plate_num: "No. Placa",
            col_atado: "Atado",
            col_thickness: "Grosor (cm)",
            col_height: "Alto (m)",
            col_width: "Ancho (m)",
            col_area: "Área (m²)",
            col_qty: "Cantidad",
            col_notes: "Notas",

            // Tipos
            lbl_type_placa: "Placa",
            lbl_type_formato: "Formato",
            lbl_type_pieza: "Pieza",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "Notas",
            btn_add: "Agregar Item",
            btn_add_multi: "+5 Filas",
            msg_saving: "Guardando...",
            msg_success: "✅ Guardado correctamente.",
            msg_error: "❌ Error: ",
            msg_confirm: "¿Guardar y enviar TODOS los datos a Odoo?",
            empty_products: "No hay productos pendientes de recepción en esta orden.",
            err_token: "Token no encontrado.",
            err_payload: "Payload vacío."
        },
        zh: {
            header_provider: "供应商",
            po_label: "采购订单:",
            receipt_label: "收货单:",
            shipment_data_title: "发货数据",
            lbl_invoice: "发票号码",
            ph_invoice: "例如 INV-2024-001",
            lbl_date: "发货日期",
            lbl_proforma: "形式发票号 (PI)",
            ph_proforma: "例如 PI-9920",
            lbl_bl: "提单号 (B/L)",
            ph_bl: "例如 COSU123456",
            sec_logistics: "物流信息 (全球)",
            lbl_origin: "起运港",
            ph_origin: "例如 Shanghai",
            lbl_dest: "目的港",
            ph_dest: "例如 Manzanillo",
            lbl_country: "原产国",
            ph_country: "例如 China",
            lbl_vessel: "船名 / 航次",
            ph_vessel: "例如 MAERSK SEALAND",
            lbl_incoterm: "贸易条款",
            ph_incoterm: "例如 CIF",
            lbl_payment: "付款方式",
            ph_payment: "例如 T/T 30%",
            lbl_status: "状态",
            opt_select: "请选择...",
            opt_production: "生产中",
            opt_origin_port: "在起运港",
            opt_transit: "运输途中",
            opt_dest_port: "在目的港",
            // Multi-Container
            msg_multi_pl_info: "文档和物流数据保持全局。仅需为每个装箱单/集装箱更新“货物详情”和“产品”。",
            sec_cargo: "货物详情 (当前集装箱)",
            lbl_container: "集装箱号",
            ph_container: "例如 MSKU1234567",
            lbl_seal: "封条号",
            ph_seal: "例如 123456",
            lbl_cont_type: "集装箱类型",
            ph_cont_type: "例如 40HC, 20GP",
            lbl_packages: "总件数",
            lbl_weight: "毛重 (kg)",
            lbl_volume: "体积 (m³)",
            lbl_desc: "货物描述",
            ph_desc: "货物一般描述...",
            lbl_files: "附上集装箱文件",
            lbl_staged_title: "准备提交的集装箱",
            
            pl_title: "装箱单明细",
            pl_instruction: "输入尺寸。“集装箱”字段将根据货物详情自动填写。",
            loading: "加载中...",
            
            // Totales Nuevos
            footer_total_plates: "当前项目数:",
            footer_total_area: "当前面积:",
            footer_total_pieces: "当前件数:",
            
            btn_add_next: "保存集装箱并添加下一个",
            btn_submit: "完成并全部提交",
            
            msg_confirm_stage: "您确定要保存此集装箱并添加另一个吗？",
            msg_container_required: "货物详情中必须填写集装箱号。",
            msg_rows_required: "请至少添加一行带有尺寸的产品。",
            msg_staged_success: "集装箱已添加到列表。现在可以输入下一个。",
            msg_remove_staged: "删除此集装箱？",
            
            requested: "需求量:",
            
            col_container: "集装箱",
            col_block: "荒料号",
            col_plate_num: "板号",
            col_atado: "捆包号",
            col_thickness: "厚度 (cm)",
            col_height: "高度 (m)",
            col_width: "宽度 (m)",
            col_area: "面积 (m²)",
            col_qty: "数量",
            col_notes: "备注",

            // Tipos
            lbl_type_placa: "大板",
            lbl_type_formato: "规格板",
            lbl_type_pieza: "件",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "备注",
            btn_add: "添加板材",
            btn_add_multi: "+5 行",
            msg_saving: "保存中...",
            msg_success: "✅ 保存成功。",
            msg_error: "❌ 错误: ",
            msg_confirm: "保存并将所有数据发送到 Odoo？",
            empty_products: "此订单中没有待收货的产品。",
            err_token: "未找到令牌。",
            err_payload: "数据为空。"
        }
    };

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];       // Filas actuales en pantalla (Container activo)
            this.header = {};     // Datos de cabecera (mezcla de Global y Actual)
            this.nextId = 1;
            
            // Almacén de contenedores confirmados ("Staged")
            this.stagedContainers = []; 
            
            this.currentLang = localStorage.getItem('portal_lang') || 'en';
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        t(key) {
            const langObj = TRANSLATIONS[this.currentLang] || TRANSLATIONS['en'];
            return langObj[key] || key;
        }

        changeLanguage(lang) {
            if (!TRANSLATIONS[lang]) return;
            this.currentLang = lang;
            localStorage.setItem('portal_lang', lang);
            this.updateStaticText();
            this.render(); 
            this.renderStagedTable(); 
        }

        updateStaticText() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.dataset.i18n;
                if (key) el.innerText = this.t(key);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.dataset.i18nPlaceholder;
                if (key) el.placeholder = this.t(key);
            });
        }

        init() {
            console.log("[Portal] Iniciando...");
            try {
                const langSelector = document.getElementById('lang-selector');
                if (langSelector) {
                    langSelector.value = this.currentLang;
                    langSelector.addEventListener('change', (e) => this.changeLanguage(e.target.value));
                }
                
                this.updateStaticText();

                const dataEl = document.getElementById('portal-data-store');
                if (!dataEl) throw new Error(this.t('err_payload'));
                
                const rawPayload = dataEl.dataset.payload;
                if(!rawPayload) throw new Error("Dataset Empty");

                this.data = JSON.parse(rawPayload);
                this.products = this.data.products || [];
                
                // Carga inicial de cabecera desde servidor
                const serverHeader = this.data.header || {};
                this.header = { ...serverHeader };

                // Recuperar estado local (si existe crash o recarga)
                const localData = this.loadLocalState();
                if (localData) {
                    if (localData.header) this.header = { ...this.header, ...localData.header };
                    if (localData.rows) this.rows = localData.rows;
                    // Recuperar contenedores ya agregados pero no enviados
                    if (localData.stagedContainers) this.stagedContainers = localData.stagedContainers;
                    
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;
                } else if (this.data.existing_rows && this.data.existing_rows.length > 0) {
                    // Si viene del servidor (modo edición), cargamos las filas
                    this.rows = this.data.existing_rows.map(r => ({...r, id: this.nextId++}));
                } else {
                    // Iniciar filas vacías por defecto si no hay nada
                    if (this.products.length > 0) {
                        this.products.forEach(p => this.createRowInternal(p.id));
                    }
                }

                this.fillHeaderForm();
                this.render();         
                this.renderStagedTable();
                this.bindGlobalEvents();

                console.log("[Portal] Init Complete.");

            } catch (error) {
                console.error("[Portal] Error:", error);
                const container = document.getElementById('portal-rows-container');
                if (container) container.innerHTML = `<div class="alert alert-danger text-center p-5">${error.message}</div>`;
            }
        }

        loadLocalState() {
            if (!this.data.token) return null;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try { return JSON.parse(saved); } catch (e) { return null; }
            }
            return null;
        }

        saveState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            const state = {
                rows: this.rows,
                header: this.getHeaderDataFromDOM(),
                stagedContainers: this.stagedContainers // Guardamos también lo acumulado
            };
            localStorage.setItem(key, JSON.stringify(state));
            this.updateTotalsUI(); 
        }

        // --- MANEJO DE CABECERA Y FORMULARIO ---

        fillHeaderForm() {
            const map = {
                // Globales
                'h-invoice': 'invoice_number', 'h-date': 'shipment_date', 'h-proforma': 'proforma_number',
                'h-bl': 'bl_number', 'h-origin': 'origin', 'h-dest': 'destination',
                'h-country': 'country_origin', 'h-vessel': 'vessel', 'h-incoterm': 'incoterm', 
                'h-payment': 'payment_terms', 'h-status': 'status', 
                // Contenedor Actual (Variables)
                'h-desc': 'merchandise_desc',
                'h-cont-no': 'container_no', 'h-seal': 'seal_no', 'h-type': 'container_type',
                'h-pkgs': 'total_packages', 'h-weight': 'gross_weight', 'h-volume': 'volume'
            };
            for (const [domId, dataKey] of Object.entries(map)) {
                const el = document.getElementById(domId);
                // Solo llenar si tiene valor, para no borrar placeholders o inputs vacíos intencionalmente
                if (el && this.header[dataKey] !== undefined && this.header[dataKey] !== null) {
                    el.value = this.header[dataKey];
                }
            }
        }

        getHeaderDataFromDOM() {
            return {
                // Global
                invoice_number: document.getElementById('h-invoice')?.value || "",
                shipment_date: document.getElementById('h-date')?.value || "",
                proforma_number: document.getElementById('h-proforma')?.value || "",
                bl_number: document.getElementById('h-bl')?.value || "",
                origin: document.getElementById('h-origin')?.value || "",
                destination: document.getElementById('h-dest')?.value || "",
                country_origin: document.getElementById('h-country')?.value || "",
                vessel: document.getElementById('h-vessel')?.value || "",
                incoterm: document.getElementById('h-incoterm')?.value || "",
                payment_terms: document.getElementById('h-payment')?.value || "",
                status: document.getElementById('h-status')?.value || "",
                
                // Specific to Current Container
                merchandise_desc: document.getElementById('h-desc')?.value || "",
                container_no: document.getElementById('h-cont-no')?.value || "",
                seal_no: document.getElementById('h-seal')?.value || "",
                container_type: document.getElementById('h-type')?.value || "",
                total_packages: document.getElementById('h-pkgs')?.value || 0,
                gross_weight: document.getElementById('h-weight')?.value || 0.0,
                volume: document.getElementById('h-volume')?.value || 0.0,
            };
        }

        // --- CRUD FILAS PRODUCTOS ---
        createRowInternal(productId) {
            const product = this.products.find(p => p.id === productId);
            const unitType = product ? (product.unit_type || 'Placa') : 'Placa';

            // Heredar valores de la última fila de ese producto para agilizar captura
            const productRows = this.rows.filter(r => r.product_id === productId);
            let defaults = { bloque: '', grosor: 0, atado: '' };
            if (productRows.length > 0) {
                const last = productRows[productRows.length - 1];
                defaults = { 
                    bloque: last.bloque, 
                    grosor: last.grosor,
                    atado: last.atado
                };
            }
            const newRow = {
                id: this.nextId++, product_id: productId,
                contenedor: '', // Se llenará al guardar/stager
                bloque: defaults.bloque,
                numero_placa: '', atado: defaults.atado,
                grosor: defaults.grosor, alto: 0, ancho: 0, color: '', ref_prov: '',
                tipo: unitType // Guardamos el tipo para referencia lógica
            };

            // Ajuste para Pieza: Ancho fijo en 1 para que Alto sirva de Cantidad
            if (unitType === 'Pieza') {
                newRow.ancho = 1;
            }

            this.rows.push(newRow);
            return newRow;
        }

        updateRowData(id, field, value) {
            const row = this.rows.find(r => r.id === parseInt(id));
            if (row) {
                if (['grosor', 'alto', 'ancho'].includes(field)) row[field] = parseFloat(value) || 0;
                else row[field] = value;
                this.saveState();
            }
        }

        // --- GESTIÓN DE ETAPAS (STAGING) ---

        async stageCurrentContainer() {
            // 1. Validaciones
            const currentHeader = this.getHeaderDataFromDOM();
            
            // Validar contenedor
            if (!currentHeader.container_no) {
                alert(this.t('msg_container_required'));
                document.getElementById('h-cont-no').focus();
                return;
            }

            // Validar al menos una fila con dimensiones/cantidad
            const validRows = this.rows.filter(r => r.alto > 0 && r.ancho > 0);
            if (validRows.length === 0) {
                alert(this.t('msg_rows_required'));
                return;
            }

            if (!confirm(this.t('msg_confirm_stage'))) return;

            // 2. Procesar Archivos (Leer y convertir a Base64)
            const fileInput = document.getElementById('h-files');
            const files = await this.readFiles(fileInput);

            // 3. Preparar filas con el número de contenedor forzado
            // El usuario no necesita escribirlo en cada fila, se toma de la cabecera
            const stagedRows = validRows.map(r => ({
                ...r,
                contenedor: currentHeader.container_no
            }));

            // 4. Guardar Objeto Contenedor
            const containerObj = {
                id: Date.now(),
                header: { ...currentHeader }, // Copia del estado actual de cabecera
                rows: stagedRows,
                files: files,
                summary: {
                    container_no: currentHeader.container_no,
                    type: currentHeader.container_type,
                    weight: parseFloat(currentHeader.gross_weight || 0),
                    volume: parseFloat(currentHeader.volume || 0),
                    lines_count: stagedRows.length,
                    files_count: files.length
                }
            };

            this.stagedContainers.push(containerObj);

            // 5. Limpiar UI para el siguiente (Solo campos específicos de carga)
            this.rows = []; 
            // Reiniciar con 1 fila vacía por producto
            if (this.products.length > 0) {
                this.products.forEach(p => this.createRowInternal(p.id));
            }

            // Limpiar campos variables
            const inputsToClear = ['h-cont-no', 'h-seal', 'h-pkgs', 'h-weight', 'h-volume', 'h-desc', 'h-files'];
            inputsToClear.forEach(id => {
                const el = document.getElementById(id);
                if(el) el.value = '';
            });

            // NOTA: No limpiamos Logística ni Documentación Global.

            this.saveState();
            this.render();
            this.renderStagedTable();
            this.bindGlobalEvents(); 
            
            alert(this.t('msg_staged_success'));
            
            // Scroll a la tabla de staged para que vean que se agregó
            const stagedArea = document.getElementById('staged-containers-area');
            if(stagedArea) {
                stagedArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        readFiles(inputElement) {
            return new Promise((resolve) => {
                if (!inputElement || !inputElement.files || inputElement.files.length === 0) {
                    resolve([]);
                    return;
                }
                const filesData = [];
                const files = Array.from(inputElement.files);
                let processed = 0;

                files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        filesData.push({
                            name: file.name,
                            type: file.type,
                            data: e.target.result.split(',')[1] // Obtener solo la parte Base64
                        });
                        processed++;
                        if (processed === files.length) resolve(filesData);
                    };
                    reader.onerror = () => {
                        console.error("Error reading file", file.name);
                        processed++;
                        if (processed === files.length) resolve(filesData);
                    };
                    reader.readAsDataURL(file);
                });
            });
        }

        removeStagedContainer(id) {
            if(!confirm(this.t('msg_remove_staged'))) return;
            this.stagedContainers = this.stagedContainers.filter(c => c.id !== id);
            this.saveState();
            this.renderStagedTable();
        }

        renderStagedTable() {
            const area = document.getElementById('staged-containers-area');
            const tbody = document.getElementById('staged-containers-tbody');
            
            if (!area || !tbody) return;

            if (this.stagedContainers.length === 0) {
                area.classList.add('d-none');
                return;
            }
            area.classList.remove('d-none');
            tbody.innerHTML = '';

            this.stagedContainers.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="text-warning fw-bold">${c.summary.container_no}</td>
                    <td>${c.summary.type || '-'}</td>
                    <td>${c.summary.weight.toFixed(2)}</td>
                    <td>${c.summary.volume.toFixed(2)}</td>
                    <td>${c.summary.lines_count}</td>
                    <td>${c.summary.files_count} <i class="fa fa-paperclip text-muted"></i></td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-danger btn-remove-stage" data-id="${c.id}">
                            <i class="fa fa-trash"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Bind delete buttons
            document.querySelectorAll('.btn-remove-stage').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = parseInt(e.currentTarget.dataset.id);
                    this.removeStagedContainer(id);
                });
            });
        }

        // --- SUBMIT FINAL ---

        async submitAllData() {
            // 1. Obtener datos actuales de pantalla
            const currentHeader = this.getHeaderDataFromDOM();
            const currentValidRows = this.rows.filter(r => r.alto > 0 && r.ancho > 0);
            
            // Verificar si el usuario tiene datos "pendientes" en pantalla que no ha agregado a Staged
            let pendingOnScreen = false;
            if (currentValidRows.length > 0) {
                if (!currentHeader.container_no) {
                     alert(this.t('msg_container_required'));
                     return;
                }
                pendingOnScreen = true;
            }

            if (!confirm(this.t('msg_confirm'))) return;

            // 2. Preparar Payload Unificado
            let finalRows = [];
            let finalFiles = [];
            
            // A. Agregar contenedores Staged
            this.stagedContainers.forEach(c => {
                finalRows = [...finalRows, ...c.rows];
                // Files: agregar info del contenedor al objeto file para que Odoo sepa de quién es
                c.files.forEach(f => {
                    finalFiles.push({ ...f, container_ref: c.summary.container_no });
                });
            });

            // B. Agregar contenedor actual (implicito) si existe
            if (pendingOnScreen) {
                const fileInput = document.getElementById('h-files');
                const filesCurrent = await this.readFiles(fileInput);
                
                // Forzamos el contenedor en las filas actuales
                currentValidRows.forEach(r => r.contenedor = currentHeader.container_no);
                
                finalRows = [...finalRows, ...currentValidRows];
                filesCurrent.forEach(f => {
                    finalFiles.push({ ...f, container_ref: currentHeader.container_no });
                });
            }

            if (finalRows.length === 0) {
                alert("No data to submit.");
                return;
            }

            // 3. Consolidar Header (Sumas y Concatenaciones)
            // Usamos el header actual como base para Doc/Logística (Global)
            const finalHeader = { ...currentHeader };
            
            // Recalcular totales acumulados de todos los contenedores
            let totalPkg = 0;
            let totalW = 0.0;
            let totalV = 0.0;
            const containerNames = new Set();
            const containerTypes = new Set();
            const sealNos = new Set();

            const addMetrics = (h) => {
                totalPkg += parseInt(h.total_packages || 0);
                totalW += parseFloat(h.gross_weight || 0);
                totalV += parseFloat(h.volume || 0);
                if(h.container_no) containerNames.add(h.container_no);
                if(h.container_type) containerTypes.add(h.container_type);
                if(h.seal_no) sealNos.add(h.seal_no);
            };

            // Iterar Staged
            this.stagedContainers.forEach(c => addMetrics(c.header));
            
            // Iterar Actual (solo si es válido y se va a enviar)
            if (pendingOnScreen) {
                addMetrics(currentHeader);
            }

            // Sobrescribir campos agregados en el header final
            finalHeader.container_no = Array.from(containerNames).join(', ');
            finalHeader.container_type = Array.from(containerTypes).join(', ');
            finalHeader.seal_no = Array.from(sealNos).join(', ');
            finalHeader.total_packages = totalPkg;
            finalHeader.gross_weight = totalW;
            finalHeader.volume = totalV;

            // UI Bloqueo
            const btn = document.getElementById('btn-submit-pl');
            const btnNext = document.getElementById('btn-add-next');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
            btn.disabled = true;
            if(btnNext) btnNext.disabled = true;

            try {
                const res = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { 
                            token: this.data.token, 
                            rows: finalRows,
                            header: finalHeader,
                            files: finalFiles
                        },
                        id: Math.floor(Math.random()*1000)
                    })
                });

                const result = await res.json();
                
                if (result.result && result.result.success) {
                    alert(this.t('msg_success'));
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error?.data?.message || result.result?.message || "Unknown Error";
                    alert(this.t('msg_error') + msg);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    if(btnNext) btnNext.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert("Connection Error");
                btn.innerHTML = originalText;
                btn.disabled = false;
                if(btnNext) btnNext.disabled = false;
            }
        }

        // --- RENDERIZADO Y EVENTOS ---
        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) return;

            let html = '';
            this.products.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabelKey = `lbl_type_${unitType.toLowerCase()}`;
                const typeLabel = this.t(typeLabelKey);

                const productRows = this.rows.filter(r => r.product_id === product.id);
                
                html += `
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3>${product.name} 
                                    <span class="text-muted small ms-2">(${product.code})</span>
                                    <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span>
                                </h3>
                            </div>
                            <div class="meta">${this.t('requested')} <strong class="text-white">${product.qty_ordered} ${product.uom}</strong></div>
                        </div>
                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>`;
                
                // --- CABECERAS DINÁMICAS POR TIPO ---
                if (unitType === 'Placa') {
                    html += `
                        <th>${this.t('col_block')}</th>
                        <th>${this.t('col_atado')}</th>
                        <th>${this.t('col_plate_num')}</th>
                        <th>${this.t('col_thickness')}</th>
                        <th>${this.t('col_height')}</th>
                        <th>${this.t('col_width')}</th>
                        <th>${this.t('col_area')}</th>`;
                } else if (unitType === 'Formato') {
                    html += `
                        <th>${this.t('col_height')}</th>
                        <th>${this.t('col_width')}</th>
                        <th>${this.t('col_area')}</th>`;
                } else if (unitType === 'Pieza') {
                    html += `
                        <th>${this.t('col_qty')}</th>`;
                }

                html += `       <th>${this.t('col_notes')}</th>
                                <th style="width: 50px;"></th>
                            </tr>
                        </thead>
                        <tbody>`;
                
                const renderInput = (rowId, field, value, ph, type="text", step="") => `
                    <div class="input-group-portal">
                        <input type="${type}" step="${step}" class="input-field" 
                               data-field="${field}" value="${value||''}" placeholder="${ph ? this.t(ph) : ''}">
                        <button type="button" class="btn-fill-down" data-row-id="${rowId}" data-field="${field}">
                            <i class="fa fa-arrow-down"></i>
                        </button>
                    </div>`;

                productRows.forEach(row => {
                    const area = (row.alto * row.ancho).toFixed(2);
                    html += `<tr data-row-id="${row.id}">`;
                    
                    // --- CELDAS DINÁMICAS POR TIPO ---
                    if (unitType === 'Placa') {
                        html += `
                            <td data-label="${this.t('col_block')}">${renderInput(row.id, 'bloque', row.bloque, 'ph_block', 'text', '', 'short text-uppercase')}</td>
                            <td data-label="${this.t('col_atado')}">${renderInput(row.id, 'atado', row.atado, 'ph_atado', 'text', '', 'short text-uppercase')}</td>
                            <td data-label="${this.t('col_plate_num')}">${renderInput(row.id, 'numero_placa', row.numero_placa, 'ph_plate', 'text', '', 'short')}</td>
                            <td data-label="${this.t('col_thickness')}">${renderInput(row.id, 'grosor', row.grosor, '', 'number', '0.01', 'short')}</td>
                            <td data-label="${this.t('col_height')}">${renderInput(row.id, 'alto', row.alto, '', 'number', '0.01', 'short')}</td>
                            <td data-label="${this.t('col_width')}">${renderInput(row.id, 'ancho', row.ancho, '', 'number', '0.01', 'short')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${area}</span></td>`;
                    } else if (unitType === 'Formato') {
                        html += `
                            <td data-label="${this.t('col_height')}">${renderInput(row.id, 'alto', row.alto, '', 'number', '0.01', 'short')}</td>
                            <td data-label="${this.t('col_width')}">${renderInput(row.id, 'ancho', row.ancho, '', 'number', '0.01', 'short')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${area}</span></td>`;
                    } else if (unitType === 'Pieza') {
                        // Hack: Mapeamos Cantidad -> 'alto', y 'ancho' fijo en 1 (oculto)
                        html += `
                            <td data-label="${this.t('col_qty')}">${renderInput(row.id, 'alto', row.alto, '', 'number', '1', 'short')}</td>`;
                    }

                    html += `
                            <td data-label="${this.t('col_notes')}">${renderInput(row.id, 'color', row.color, 'ph_opt')}</td>
                            <td class="text-center"><button class="btn-action btn-delete" type="button"><i class="fa fa-trash"></i></button></td>
                        </tr>`;
                });

                html += `</tbody></table>
                        <div class="table-actions">
                            <button class="btn-add-row action-add" data-product-id="${product.id}" type="button"><i class="fa fa-plus-circle me-2"></i> ${this.t('btn_add')}</button>
                            <button class="btn-add-row ms-2 action-add-multi" data-product-id="${product.id}" type="button">${this.t('btn_add_multi')}</button>
                        </div></div></div>`;
            });

            container.innerHTML = html;
            this.updateTotalsUI();
        }

        bindGlobalEvents() {
            // Reemplazar eventos del contenedor de tabla para evitar duplicados
            const activeContainer = document.getElementById('portal-rows-container');
            if(activeContainer) {
                const newContainer = activeContainer.cloneNode(true);
                activeContainer.parentNode.replaceChild(newContainer, activeContainer);
                
                newContainer.addEventListener('input', (e) => {
                    if (e.target.classList.contains('input-field')) {
                        const tr = e.target.closest('tr');
                        const rowId = tr.dataset.rowId;
                        const field = e.target.dataset.field;
                        this.updateRowData(rowId, field, e.target.value);
                        if (field === 'alto' || field === 'ancho') {
                            const r = this.rows.find(x => x.id == rowId);
                            if(r) {
                                // Solo actualizar display si existe el span (Formato/Placa)
                                const areaSpan = tr.querySelector('.area-display');
                                if(areaSpan) areaSpan.innerText = (r.alto * r.ancho).toFixed(2);
                            }
                            this.updateTotalsUI();
                        }
                    }
                });

                newContainer.addEventListener('click', (e) => {
                    const target = e.target;
                    const fillBtn = target.closest('.btn-fill-down');
                    const delBtn = target.closest('.btn-delete');
                    const addBtn = target.closest('.action-add');
                    const addMultiBtn = target.closest('.action-add-multi');

                    if(fillBtn) {
                        this.fillDownInternal(fillBtn.dataset.rowId, fillBtn.dataset.field);
                    } else if(delBtn) {
                        this.deleteRowInternal(delBtn.closest('tr').dataset.rowId);
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    } else if(addBtn) {
                        this.createRowInternal(parseInt(addBtn.dataset.productId));
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    } else if(addMultiBtn) {
                        const pid = parseInt(addMultiBtn.dataset.productId);
                        for(let i=0; i<5; i++) this.createRowInternal(pid);
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    }
                });
            }

            // Botones Footer
            const btnSubmit = document.getElementById('btn-submit-pl');
            if (btnSubmit) {
                const b = btnSubmit.cloneNode(true);
                btnSubmit.parentNode.replaceChild(b, btnSubmit);
                b.addEventListener('click', () => this.submitAllData());
            }

            const btnNext = document.getElementById('btn-add-next');
            if (btnNext) {
                const b = btnNext.cloneNode(true);
                btnNext.parentNode.replaceChild(b, btnNext);
                b.addEventListener('click', () => this.stageCurrentContainer());
            }

            // Input Header Save (Auto save header on input)
            const headerForm = document.getElementById('shipment-info-form');
            if(headerForm) {
                 headerForm.addEventListener('input', () => this.saveState());
            }
        }

        fillDownInternal(rowId, field) {
            const sourceId = parseInt(rowId);
            const sourceRow = this.rows.find(r => r.id === sourceId);
            if (!sourceRow) return;
            let start = false;
            let count = 0;
            this.rows.forEach(r => {
                if (r.id === sourceId) start = true;
                else if (start && r.product_id === sourceRow.product_id) {
                    r[field] = sourceRow[field];
                    count++;
                }
            });
            if(count > 0) {
                this.saveState(); this.render(); this.bindGlobalEvents();
            }
        }

        deleteRowInternal(id) {
            this.rows = this.rows.filter(r => r.id !== parseInt(id));
        }

        updateTotalsUI() {
            // Contar líneas válidas actuales
            const validRows = this.rows.filter(r => r.alto > 0 && r.ancho > 0);
            
            // Separar totales por lógica
            let totalM2 = 0;
            let totalItems = 0; // Items de Placa/Formato
            let totalPieces = 0; // Cantidad de Piezas

            validRows.forEach(r => {
                const product = this.products.find(p => p.id === r.product_id);
                const unitType = product ? (product.unit_type || 'Placa') : 'Placa';

                if (unitType === 'Pieza') {
                    // En Pieza, 'alto' guarda la Cantidad. 'ancho' es 1.
                    totalPieces += r.alto;
                } else {
                    // Placa o Formato
                    totalM2 += (r.alto * r.ancho);
                    totalItems++;
                }
            });
            
            document.getElementById('total-plates').innerText = totalItems;
            document.getElementById('total-area').innerText = totalM2.toFixed(2);
            
            // Inyectar el contenedor de piezas si no existe (ya que el HTML base quizás no lo tiene)
            let piecesContainer = document.getElementById('summary-pieces-container');
            if (!piecesContainer) {
                const summaryDiv = document.querySelector('.submit-footer .summary');
                if (summaryDiv) {
                    piecesContainer = document.createElement('div');
                    piecesContainer.id = 'summary-pieces-container';
                    // Separador visual
                    piecesContainer.style.borderLeft = "1px solid #444";
                    piecesContainer.style.paddingLeft = "20px";
                    
                    piecesContainer.innerHTML = `<span data-i18n="footer_total_pieces">${this.t('footer_total_pieces')}</span> <span id="total-pieces" class="text-warning fw-bold">0</span>`;
                    summaryDiv.appendChild(piecesContainer);
                }
            }
            const piecesVal = document.getElementById('total-pieces');
            if(piecesVal) piecesVal.innerText = totalPieces;
            
            // Habilitar botones si hay algo en Staged o en Actual
            const hasStaged = this.stagedContainers.length > 0;
            const hasCurrent = validRows.length > 0;
            const canSubmit = hasStaged || hasCurrent;

            const btnSubmit = document.getElementById('btn-submit-pl');
            if (btnSubmit) {
                btnSubmit.disabled = !canSubmit;
            }
        }
    }

    window.supplierPortal = new SupplierPortal();
})();