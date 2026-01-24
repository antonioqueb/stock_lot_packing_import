/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script cargado.");

    // --- DICCIONARIO DE TRADUCCIONES ---
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
            sec_logistics: "Logistics",
            lbl_origin: "Origin (Port)",
            ph_origin: "Ex. Shanghai",
            lbl_dest: "Destination (Port)",
            ph_dest: "Ex. Manzanillo",
            lbl_country: "Country of Origin",
            ph_country: "Ex. China",
            lbl_vessel: "Vessel / Voyage",
            ph_vessel: "Ex. MAERSK SEALAND",
            lbl_incoterm: "Incoterm / Payment",
            ph_incoterm: "Ex. CIF / T/T",
            lbl_status: "Status",
            opt_select: "Select...",
            opt_production: "In Production",
            opt_origin_port: "In Origin Port",
            opt_transit: "In Transit",
            opt_dest_port: "In Destination Port",
            sec_cargo: "Cargo Details",
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
            pl_title: "Packing List Details",
            pl_instruction: "Enter dimensions for each item. Area is calculated automatically.",
            loading: "Loading...",
            footer_total_plates: "Total Plates:",
            footer_total_area: "Total Area:",
            btn_submit: "Save & Submit",
            // JS Dynamic
            requested: "Requested:",
            col_container: "Container",
            col_block: "Block",
            col_thickness: "Thickness (cm)",
            col_height: "Height (m)",
            col_width: "Width (m)",
            col_area: "Area (m²)",
            col_notes: "Color / Notes",
            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_opt: "Optional",
            btn_add: "Add Item",
            btn_add_multi: "+5 Rows",
            msg_saving: "Saving...",
            msg_success: "✅ Saved successfully.",
            msg_error: "❌ Error: ",
            msg_confirm: "Save and send data to Odoo?",
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
            sec_logistics: "Logística",
            lbl_origin: "Origen (Puerto)",
            ph_origin: "Ej. Shanghai",
            lbl_dest: "Destino (Puerto)",
            ph_dest: "Ej. Manzanillo",
            lbl_country: "País Origen",
            ph_country: "Ej. China",
            lbl_vessel: "Buque / Viaje",
            ph_vessel: "Ej. MAERSK SEALAND",
            lbl_incoterm: "Incoterm / Pago",
            ph_incoterm: "Ej. CIF / T/T",
            lbl_status: "Estatus",
            opt_select: "Seleccionar...",
            opt_production: "En Producción",
            opt_origin_port: "En Puerto Origen",
            opt_transit: "En Tránsito",
            opt_dest_port: "En Puerto Destino",
            sec_cargo: "Detalles de Carga",
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
            pl_title: "Detalle de Placas (Packing List)",
            pl_instruction: "Ingrese las dimensiones de cada placa. El área se calculará automáticamente.",
            loading: "Cargando...",
            footer_total_plates: "Total Placas:",
            footer_total_area: "Total Área:",
            btn_submit: "Guardar y Enviar",
            // JS Dynamic
            requested: "Solicitado:",
            col_container: "Contenedor",
            col_block: "Bloque",
            col_thickness: "Grosor (cm)",
            col_height: "Alto (m)",
            col_width: "Ancho (m)",
            col_area: "Área (m²)",
            col_notes: "Color / Notas",
            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_opt: "Opcional",
            btn_add: "Agregar Placa",
            btn_add_multi: "+5 Filas",
            msg_saving: "Guardando...",
            msg_success: "✅ Guardado correctamente.",
            msg_error: "❌ Error: ",
            msg_confirm: "¿Guardar y enviar los datos a Odoo?",
            empty_products: "No hay productos pendientes de recepción en esta orden.",
            err_token: "Token no encontrado.",
            err_payload: "Payload vacío."
        },
        pt: {
            header_provider: "FORNECEDOR",
            po_label: "Pedido de Compra:",
            receipt_label: "Recebimento:",
            shipment_data_title: "Dados de Embarque",
            lbl_invoice: "Nº da Fatura",
            ph_invoice: "Ex. INV-2024-001",
            lbl_date: "Data de Embarque",
            lbl_proforma: "Nº Proforma (PI)",
            ph_proforma: "Ex. PI-9920",
            lbl_bl: "Nº B/L",
            ph_bl: "Ex. COSU123456",
            sec_logistics: "Logística",
            lbl_origin: "Origem (Porto)",
            ph_origin: "Ex. Xangai",
            lbl_dest: "Destino (Porto)",
            ph_dest: "Ex. Santos",
            lbl_country: "País de Origem",
            ph_country: "Ex. China",
            lbl_vessel: "Navio / Viagem",
            ph_vessel: "Ex. MAERSK SEALAND",
            lbl_incoterm: "Incoterm / Pagamento",
            ph_incoterm: "Ex. CIF / T/T",
            lbl_status: "Status",
            opt_select: "Selecionar...",
            opt_production: "Em Produção",
            opt_origin_port: "No Porto de Origem",
            opt_transit: "Em Trânsito",
            opt_dest_port: "No Porto de Destino",
            sec_cargo: "Detalhes da Carga",
            lbl_container: "Nº Contêiner",
            ph_container: "Ex. MSKU1234567",
            lbl_seal: "Nº Lacre",
            ph_seal: "Ex. 123456",
            lbl_cont_type: "Tipo Contêiner",
            ph_cont_type: "Ex. 40HC, 20GP",
            lbl_packages: "Total Pacotes",
            lbl_weight: "Peso Bruto (kg)",
            lbl_volume: "Volume (m³)",
            lbl_desc: "Descrição da Mercadoria",
            ph_desc: "Descrição geral da carga...",
            pl_title: "Detalhes do Packing List",
            pl_instruction: "Insira as dimensões de cada item. A área é calculada automaticamente.",
            loading: "Carregando...",
            footer_total_plates: "Total Placas:",
            footer_total_area: "Área Total:",
            btn_submit: "Salvar e Enviar",
            // JS Dynamic
            requested: "Solicitado:",
            col_container: "Contêiner",
            col_block: "Bloco",
            col_thickness: "Espessura (cm)",
            col_height: "Altura (m)",
            col_width: "Largura (m)",
            col_area: "Área (m²)",
            col_notes: "Cor / Notas",
            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_opt: "Opcional",
            btn_add: "Adicionar Item",
            btn_add_multi: "+5 Linhas",
            msg_saving: "Salvando...",
            msg_success: "✅ Salvo com sucesso.",
            msg_error: "❌ Erro: ",
            msg_confirm: "Salvar e enviar dados para o Odoo?",
            empty_products: "Sem produtos pendentes neste pedido.",
            err_token: "Token não encontrado.",
            err_payload: "Payload vazio."
        },
        it: {
            header_provider: "FORNITORE",
            po_label: "Ordine d'Acquisto:",
            receipt_label: "Ricezione:",
            shipment_data_title: "Dati di Spedizione",
            lbl_invoice: "N. Fattura",
            ph_invoice: "Es. INV-2024-001",
            lbl_date: "Data Spedizione",
            lbl_proforma: "N. Proforma (PI)",
            ph_proforma: "Es. PI-9920",
            lbl_bl: "N. B/L",
            ph_bl: "Es. COSU123456",
            sec_logistics: "Logistica",
            lbl_origin: "Origine (Porto)",
            ph_origin: "Es. Shanghai",
            lbl_dest: "Destinazione (Porto)",
            ph_dest: "Es. Genova",
            lbl_country: "Paese d'Origine",
            ph_country: "Es. Cina",
            lbl_vessel: "Nave / Viaggio",
            ph_vessel: "Es. MAERSK SEALAND",
            lbl_incoterm: "Incoterm / Pagamento",
            ph_incoterm: "Es. CIF / T/T",
            lbl_status: "Stato",
            opt_select: "Selezionare...",
            opt_production: "In Produzione",
            opt_origin_port: "Al Porto d'Origine",
            opt_transit: "In Transito",
            opt_dest_port: "Al Porto di Destinazione",
            sec_cargo: "Dettagli Carico",
            lbl_container: "N. Container",
            ph_container: "Es. MSKU1234567",
            lbl_seal: "N. Sigillo",
            ph_seal: "Es. 123456",
            lbl_cont_type: "Tipo Container",
            ph_cont_type: "Es. 40HC, 20GP",
            lbl_packages: "Totale Colli",
            lbl_weight: "Peso Lordo (kg)",
            lbl_volume: "Volume (m³)",
            lbl_desc: "Descrizione Merce",
            ph_desc: "Descrizione generale del carico...",
            pl_title: "Dettagli Packing List",
            pl_instruction: "Inserisci le dimensioni. L'area viene calcolata automaticamente.",
            loading: "Caricamento...",
            footer_total_plates: "Totale Lastre:",
            footer_total_area: "Area Totale:",
            btn_submit: "Salva e Invia",
            // JS Dynamic
            requested: "Richiesto:",
            col_container: "Container",
            col_block: "Blocco",
            col_thickness: "Spessore (cm)",
            col_height: "Altezza (m)",
            col_width: "Larghezza (m)",
            col_area: "Area (m²)",
            col_notes: "Colore / Note",
            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_opt: "Opzionale",
            btn_add: "Aggiungi Voce",
            btn_add_multi: "+5 Righe",
            msg_saving: "Salvataggio...",
            msg_success: "✅ Salvato con successo.",
            msg_error: "❌ Errore: ",
            msg_confirm: "Salvare e inviare i dati a Odoo?",
            empty_products: "Nessun prodotto in attesa in questo ordine.",
            err_token: "Token non trovato.",
            err_payload: "Payload vuoto."
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
            sec_logistics: "物流信息",
            lbl_origin: "起运港",
            ph_origin: "例如 Shanghai",
            lbl_dest: "目的港",
            ph_dest: "例如 Manzanillo",
            lbl_country: "原产国",
            ph_country: "例如 China",
            lbl_vessel: "船名 / 航次",
            ph_vessel: "例如 MAERSK SEALAND",
            lbl_incoterm: "贸易条款 / 付款方式",
            ph_incoterm: "例如 CIF / T/T",
            lbl_status: "状态",
            opt_select: "请选择...",
            opt_production: "生产中",
            opt_origin_port: "在起运港",
            opt_transit: "运输途中",
            opt_dest_port: "在目的港",
            sec_cargo: "货物详情",
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
            pl_title: "装箱单明细",
            pl_instruction: "输入每件物品的尺寸。面积将自动计算。",
            loading: "加载中...",
            footer_total_plates: "总板数:",
            footer_total_area: "总面积:",
            btn_submit: "保存并发送",
            // JS Dynamic
            requested: "需求量:",
            col_container: "集装箱",
            col_block: "荒料号",
            col_thickness: "厚度 (cm)",
            col_height: "高度 (m)",
            col_width: "宽度 (m)",
            col_area: "面积 (m²)",
            col_notes: "颜色 / 备注",
            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_opt: "选填",
            btn_add: "添加板材",
            btn_add_multi: "+5 行",
            msg_saving: "保存中...",
            msg_success: "✅ 保存成功。",
            msg_error: "❌ 错误: ",
            msg_confirm: "保存并发送数据到 Odoo？",
            empty_products: "此订单中没有待收货的产品。",
            err_token: "未找到令牌。",
            err_payload: "数据为空。"
        }
    };

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];
            this.header = {}; 
            this.nextId = 1;
            
            // Idioma por defecto: Inglés
            this.currentLang = localStorage.getItem('portal_lang') || 'en';
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        // --- TRADUCCIÓN ---
        t(key) {
            return TRANSLATIONS[this.currentLang][key] || key;
        }

        changeLanguage(lang) {
            if (!TRANSLATIONS[lang]) return;
            this.currentLang = lang;
            localStorage.setItem('portal_lang', lang);
            this.updateStaticText();
            this.render(); // Re-renderizar tabla dinámica
        }

        updateStaticText() {
            // Actualizar textos simples con data-i18n
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.dataset.i18n;
                if (key) el.innerText = this.t(key);
            });

            // Actualizar placeholders con data-i18n-placeholder
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.dataset.i18nPlaceholder;
                if (key) el.placeholder = this.t(key);
            });
            
            // Actualizar Botón Submit si existe
            const btnSubmit = document.getElementById('btn-submit-pl');
            if(btnSubmit) {
                // Buscamos el span dentro del botón si queremos mantener el icono
                const span = btnSubmit.querySelector('span');
                if(span) span.innerText = this.t('btn_submit');
            }
        }

        init() {
            console.log("[Portal] Iniciando...");
            
            try {
                // Configurar selector de idioma
                const langSelector = document.getElementById('lang-selector');
                if (langSelector) {
                    langSelector.value = this.currentLang;
                    langSelector.addEventListener('change', (e) => {
                        this.changeLanguage(e.target.value);
                    });
                }
                
                // Aplicar traducción inicial a elementos estáticos
                this.updateStaticText();

                // 1. LEER DATOS DEL DOM
                const dataEl = document.getElementById('portal-data-store');
                if (!dataEl) throw new Error(this.t('err_payload'));
                const rawJson = dataEl.dataset.payload;
                if (!rawJson) throw new Error(this.t('err_payload'));

                this.data = JSON.parse(rawJson);
                this.products = this.data.products || [];
                
                // CARGA INICIAL DESDE SERVIDOR (Odoo)
                const serverHeader = this.data.header || {};
                this.header = { ...serverHeader };

                if (!this.data.token) throw new Error(this.t('err_token'));

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

                // --- ESTRATEGIA DE CARGA DE FILAS (PRIORIDAD ODOO) ---
                const serverRows = this.data.existing_rows || [];

                // MODIFICACIÓN CLAVE: Si Odoo trae filas, tienen prioridad sobre localStorage
                // Esto permite que el usuario interno corrija el PL y el proveedor vea los cambios.
                if (serverRows.length > 0) {
                    console.log(`[Portal] Usando filas del SERVIDOR (Prioridad Odoo).`);
                    this.rows = serverRows.map(r => ({
                        ...r,
                        id: this.nextId++
                    }));
                    
                    // Actualizamos localStorage para sincronizar
                    this.saveState();

                } else if (localData && localData.rows && localData.rows.length > 0) {
                    // Prioridad 2: Datos locales (trabajo en progreso del proveedor)
                    console.log("[Portal] Usando filas locales.");
                    this.rows = localData.rows;
                    
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;

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

            let updatedCount = 0;

            this.rows.forEach(r => {
                if (r.id === sourceId) {
                    startCopying = true;
                } else if (startCopying && r.product_id === productId) {
                    r[field] = valueToCopy;
                    updatedCount++;
                }
            });

            if (updatedCount > 0) {
                this.saveState();
                this.render();
                this.bindGlobalEvents();
                console.log(`[Portal] Copiado '${valueToCopy}' a ${updatedCount} filas.`);
            }
        }

        // --- RENDERIZADO ---

        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) return;

            if (this.products.length === 0) {
                container.innerHTML = `<div class="alert alert-warning text-center p-5">${this.t('empty_products')}</div>`;
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
                                ${this.t('requested')} <strong class="text-white">${product.qty_ordered} ${product.uom}</strong>
                            </div>
                        </div>

                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>
                                        <th>${this.t('col_container')}</th>
                                        <th>${this.t('col_block')}</th>
                                        <th>${this.t('col_thickness')}</th>
                                        <th>${this.t('col_height')}</th>
                                        <th>${this.t('col_width')}</th>
                                        <th>${this.t('col_area')}</th>
                                        <th>${this.t('col_notes')}</th>
                                        <th style="width: 50px;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                // Helper para generar el grupo input+botón
                const renderInput = (rowId, field, value, placeholderKey = "", type = "text", step = "", cssClass = "") => {
                    const ph = placeholderKey ? this.t(placeholderKey) : "";
                    return `
                        <div class="input-group-portal">
                            <input type="${type}" step="${step}" class="input-field ${cssClass}" 
                                   data-field="${field}" value="${value || ''}" placeholder="${ph}">
                            <button type="button" class="btn-fill-down" data-row-id="${rowId}" data-field="${field}" title="Copy Down">
                                <i class="fa fa-arrow-down"></i>
                            </button>
                        </div>
                    `;
                };

                productRows.forEach(row => {
                    const area = (row.alto * row.ancho).toFixed(2);
                    
                    html += `
                        <tr data-row-id="${row.id}">
                            <td>${renderInput(row.id, 'contenedor', row.contenedor, 'ph_cnt', 'text', '', 'short text-uppercase')}</td>
                            <td>${renderInput(row.id, 'bloque', row.bloque, 'ph_block', 'text', '', 'short text-uppercase')}</td>
                            <td>${renderInput(row.id, 'grosor', row.grosor, '', 'number', '0.01', 'short')}</td>
                            <td>${renderInput(row.id, 'alto', row.alto, '', 'number', '0.01', 'short')}</td>
                            <td>${renderInput(row.id, 'ancho', row.ancho, '', 'number', '0.01', 'short')}</td>
                            
                            <td><span class="fw-bold text-white area-display">${area}</span></td>
                            
                            <td>${renderInput(row.id, 'color', row.color, 'ph_opt')}</td>
                            
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
                                    <i class="fa fa-plus-circle"></i> ${this.t('btn_add')}
                                </button>
                                <button class="btn-add-row ms-2 action-add-multi" data-product-id="${product.id}" type="button">
                                    ${this.t('btn_add_multi')}
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
            if (!confirm(this.t('msg_confirm'))) return;

            const btn = document.getElementById('btn-submit-pl');
            const originalText = btn.querySelector('span') ? btn.querySelector('span').innerText : btn.innerText;
            
            // Loader translation
            btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
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
                    alert(this.t('msg_success'));
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error?.data?.message || result.result?.message || "Error desconocido";
                    alert(this.t('msg_error') + msg);
                    btn.innerHTML = `<i class="fa fa-paper-plane me-2"/> <span>${originalText}</span>`;
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert("Connection Error");
                btn.innerHTML = `<i class="fa fa-paper-plane me-2"/> <span>${originalText}</span>`;
                btn.disabled = false;
            }
        }
    }

    window.supplierPortal = new SupplierPortal();
})();