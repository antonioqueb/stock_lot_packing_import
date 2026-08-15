# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import io
import base64
import logging
import json
import re

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    # --- Campos de Archivos y Estado ---
    packing_list_file = fields.Binary(string='Packing List (Archivo)', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Packing List', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    ws_spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Worksheet', copy=False)
    worksheet_file = fields.Binary(string='Worksheet Exportado', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    worksheet_imported = fields.Boolean(string='Worksheet Importado', default=False, copy=False)
    worksheet_printed = fields.Boolean(string='Worksheet Impreso', default=False, copy=False)

    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'picking_id', string="Links Proveedor")

    # Factura de carga multi-PO: cada PO de la carga tiene SU PROPIA recepción.
    # Este campo identifica a qué orden pertenece este picking dentro del
    # embarque (supplier_shipment_id agrupa; supplier_cargo_po_id separa).
    supplier_cargo_po_id = fields.Many2one(
        'purchase.order', string='OC de esta recepción',
        index=True, copy=False,
        help='Orden de compra específica que recibe con este picking cuando '
             'el embarque ampara varias PO (factura de carga).',
    )

    # --- DATOS DE EMBARQUE (CABECERA) ---
    supplier_invoice_number = fields.Char(string="No. de factura")
    supplier_shipment_date = fields.Date(string="Fecha de embarque")
    supplier_proforma_number = fields.Char(string="No. de Proforma (PI)")
    supplier_bl_number = fields.Char(string="No. de Conocimiento de Embarque (B/L)")
    supplier_origin = fields.Char(string="Origen (puerto/ciudad)")
    supplier_destination = fields.Char(string="Destino (puerto/ciudad)")
    supplier_country_origin = fields.Char(string="País de origen de la mercancía")
    supplier_vessel = fields.Char(string="Buque")
    
    supplier_incoterm_payment = fields.Char(string="Incoterm") 
    supplier_payment_terms = fields.Char(string="Términos de pago")

    supplier_merchandise_desc = fields.Text(string="Descripción de mercancía")
    
    supplier_container_no = fields.Char(string="No. de contenedor")
    supplier_seal_no = fields.Char(string="No. de sello")
    supplier_container_type = fields.Char(string="Tipo de contenedor")
    supplier_total_packages = fields.Integer(string="Total de paquetes")
    supplier_gross_weight = fields.Float(string="Peso bruto (kg)")
    supplier_volume = fields.Float(string="Volumen (m³)")
    supplier_status = fields.Char(string="Estatus (en stock)")
    
    @api.depends('packing_list_file', 'spreadsheet_id', 'supplier_access_ids')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id or rec.supplier_access_ids)

    # -------------------------------------------------------------------------
    #  LOGICA DE LECTURA (Server -> Portal)
    # -------------------------------------------------------------------------

    def _resolve_sheet_product(self, sheet):
        """Resuelve el producto al que pertenece una hoja del spreadsheet.

        Prioriza el id determinista de la hoja (``pl_sheet_<id>`` /
        ``ws_sheet_<id>``) que se asigna al generar la plantilla. Solo si no
        se puede resolver por id se recurre a la búsqueda difusa por el nombre
        impreso en B1.

        Esto es CLAVE cuando hay más de un producto: dos productos con nombres
        parecidos (p. ej. variantes de un mismo material) resolvían ambos al
        mismo registro con la búsqueda ``ilike ... limit=1``, colapsando varias
        hojas en un solo producto y perdiendo las filas de los demás.
        """
        sheet_id = str(sheet.get('id') or '')
        match = re.search(r'_sheet_(\d+)$', sheet_id)
        if match:
            product = self.env['product.product'].browse(int(match.group(1)))
            if product.exists():
                return product

        b1_val = sheet.get('cells', {}).get("B1", {}).get("content", "")
        if not b1_val:
            return self.env['product.product']
        p_ref = str(b1_val).split('(')[0].strip()
        return self.env['product.product'].search([
            '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
        ], limit=1)

    def get_packing_list_data_for_portal(self):
        """
        Lee el Spreadsheet actual.
        Lógica dinámica: Si es Pieza, las columnas se recorren a la izquierda (Peso está en C).
        Si es Placa, Peso está en D.
        """
        self.ensure_one()
        rows = []
        
        if not self.spreadsheet_id:
            return rows

        data = self._get_current_spreadsheet_state(self.spreadsheet_id)
        if not data:
            return rows

        sheets = data.get('sheets', [])
        
        for sheet in sheets:
            cells = sheet.get('cells', {})

            product = self._resolve_sheet_product(sheet)
            if not product: continue

            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'

            row_idx = 3
            while True:
                idx_str = str(row_idx + 1)
                
                # Verificación de fin de datos:
                # Si es Placa, miramos B (Alto). Si es Pieza, miramos B (Cantidad).
                b_cell = cells.get(f"B{idx_str}", {})
                if not b_cell or not b_cell.get("content"):
                    found_next = False
                    for lookahead in range(1, 4):
                        if cells.get(f"B{row_idx + 1 + lookahead}", {}).get("content"):
                            found_next = True
                            break
                    if not found_next:
                        break
                    else:
                        row_idx += 1
                        continue

                def get_val(col, type_cast=str):
                    val = cells.get(f"{col}{idx_str}", {}).get("content", "")
                    if type_cast == float:
                        try: 
                            val_str = str(val).replace(',', '.')
                            return float(val_str)
                        except: 
                            return 0.0
                    return str(val).strip()

                # --- LECTURA SEGÚN TIPO (COLUMNAS RECORRIDAS) ---

                # Inicializar variables
                grosor = ""
                alto = 0.0
                ancho = 0.0
                qty = 0.0
                peso = 0.0
                color = ""
                bloque = ""
                placa = ""
                atado = ""
                grupo = ""
                pedimento = ""
                contenedor = ""
                ref_prov = ""

                if unit_type == 'Placa':
                    # Mapeo Estandar:
                    # A=Largo, B=Alto, C=Grosor, D=Peso, E=Notas, F=Bloque, G=Placa, H=Atado, I=Grupo, J=Pedimento, K=Contenedor, L=RefProv
                    ancho = get_val("A", float)
                    alto = get_val("B", float)
                    grosor = get_val("C")
                    peso = get_val("D", float)
                    color = get_val("E")
                    bloque = get_val("F")
                    placa = get_val("G")
                    atado = get_val("H")
                    grupo = get_val("I")
                    pedimento = get_val("J")
                    contenedor = get_val("K")
                    ref_prov = get_val("L")
                else:
                    # Mapeo Recorrido (Sin Ancho):
                    # A=Grosor, B=Cantidad, C=Peso, D=Notas, E=Bloque, F=Placa, G=Atado, H=Grupo, I=Pedimento, J=Contenedor, K=RefProv
                    grosor = get_val("A")
                    qty = get_val("B", float)
                    peso = get_val("C", float) # Recorrido de D a C
                    color = get_val("D")       # Recorrido de E a D
                    bloque = get_val("E")      # Recorrido de F a E
                    placa = get_val("F")       # Recorrido de G a F
                    atado = get_val("G")       # Recorrido de H a G
                    grupo = get_val("H")       # Recorrido de I a H
                    pedimento = get_val("I")   # Recorrido de J a I
                    contenedor = get_val("J")  # Recorrido de K a J
                    ref_prov = get_val("K")    # Recorrido de L a K

                row_data = {
                    'product_id': product.id,
                    'grosor': grosor,
                    'peso': peso,
                    'color': color,
                    'bloque': bloque,
                    'numero_placa': placa,
                    'atado': atado,
                    'grupo_name': grupo,      
                    'pedimento': pedimento,       
                    'contenedor': contenedor,      
                    'ref_proveedor': ref_prov,   
                    'tipo': unit_type,
                }

                if unit_type == 'Placa':
                    if alto > 0 and ancho > 0:
                        row_data.update({'alto': alto, 'ancho': ancho, 'quantity': 0})
                        rows.append(row_data)
                else:
                    if qty > 0:
                        row_data.update({'alto': 0, 'ancho': 0, 'quantity': qty})
                        rows.append(row_data)
                
                row_idx += 1
                if row_idx > 2000: break 

        return rows

    def _get_current_spreadsheet_state(self, doc):
        data = {}
        if doc.spreadsheet_snapshot:
            try:
                raw = doc.spreadsheet_snapshot
                data = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
            except Exception as e:
                _logger.warning(f"[PL_DEBUG] Error leyendo snapshot: {e}")

        if not data and doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                data = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
            except Exception as e:
                return {}

        if not data: return {}

        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')

        if not revisions: return data

        for rev in revisions:
            try:
                cmds_payload = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                cmds = cmds_payload.get('commands', []) if isinstance(cmds_payload, dict) else (cmds_payload if isinstance(cmds_payload, list) else [cmds_payload])

                for cmd in cmds:
                    if cmd.get('type') == 'UPDATE_CELL':
                        self._apply_update_cell(data, cmd)
                    elif cmd.get('type') in ('DELETE_CONTENT', 'CLEAR_CELL'):
                        self._apply_clear_cell(data, cmd)
            except Exception:
                continue
        
        return data

    def _apply_update_cell(self, data, cmd):
        sheet_id = cmd.get('sheetId')
        col, row = cmd.get('col'), cmd.get('row')
        content = cmd.get('content', '')
        target_sheet = next((s for s in data.get('sheets', []) if s.get('id') == sheet_id), None)
        
        if target_sheet and col is not None and row is not None:
            col_letter = self._get_col_letter(col)
            cell_key = f"{col_letter}{row + 1}"
            if 'cells' not in target_sheet: target_sheet['cells'] = {}
            if content in (None, ""):
                if cell_key in target_sheet['cells']: del target_sheet['cells'][cell_key]
            else:
                target_sheet['cells'][cell_key] = {'content': str(content)}

    def _apply_clear_cell(self, data, cmd):
        sheet_id = cmd.get('sheetId')
        target_sheet = next((s for s in data.get('sheets', []) if s.get('id') == sheet_id), None)
        if not target_sheet or 'cells' not in target_sheet: return
        zones = cmd.get('zones') or cmd.get('target') or []
        if isinstance(zones, dict): zones = [zones]

        for zone in zones:
            for r in range(zone.get('top', 0), zone.get('bottom', 0) + 1):
                for c in range(zone.get('left', 0), zone.get('right', 0) + 1):
                    cell_key = f"{self._get_col_letter(c)}{r + 1}"
                    if cell_key in target_sheet['cells']:
                        del target_sheet['cells'][cell_key]

    # -------------------------------------------------------------------------
    #  LOGICA DE ESCRITURA (Portal -> Odoo)
    # -------------------------------------------------------------------------

    def update_packing_list_from_portal(self, rows, header_data=None):
        """
        Recibe filas consolidadas.
        Escribe en el Spreadsheet. Si es Pieza/Formato, recorre las columnas para no dejar huecos.
        """
        self.ensure_one()
        
        # --- A. GUARDAR CABECERA ---
        if header_data:
            vals = {
                'supplier_invoice_number': header_data.get('invoice_number'),
                'supplier_shipment_date': header_data.get('shipment_date') or False,
                'supplier_proforma_number': header_data.get('proforma_number'),
                'supplier_bl_number': header_data.get('bl_number'),
                'supplier_origin': header_data.get('origin'),
                'supplier_destination': header_data.get('destination'),
                'supplier_country_origin': header_data.get('country_origin'),
                'supplier_vessel': header_data.get('vessel'),
                'supplier_incoterm_payment': header_data.get('incoterm'),
                'supplier_payment_terms': header_data.get('payment_terms'),
                'supplier_merchandise_desc': header_data.get('merchandise_desc'),
                'supplier_container_no': header_data.get('container_no'),
                'supplier_seal_no': header_data.get('seal_no'),
                'supplier_container_type': header_data.get('container_type'),
                'supplier_total_packages': int(header_data.get('total_packages') or 0),
                'supplier_gross_weight': float(header_data.get('gross_weight') or 0.0),
                'supplier_volume': float(header_data.get('volume') or 0.0),
                'supplier_status': header_data.get('status'),
            }
            self.write(vals)

        # --- B. ACTUALIZAR SPREADSHEET ---
        if not rows: return True
        if not self.spreadsheet_id: self.action_open_packing_list_spreadsheet()
        
        doc = self.spreadsheet_id
        data = self._get_current_spreadsheet_state(doc)
        if not data: return True

        product_sheet_map = {} 
        sheets = data.get('sheets', [])
        
        # Mapear productos a hojas y limpiar datos viejos
        for sheet in sheets:
            cells = sheet.get('cells', {})
            product = self._resolve_sheet_product(sheet)

            if product:
                product_sheet_map[product.id] = sheet
                keys_to_remove = []
                for key in list(cells.keys()):
                    match = re.match(r'^([A-Z]+)(\d+)$', key)
                    if match:
                        row_num = int(match.group(2))
                        if row_num >= 4:
                            keys_to_remove.append(key)
                for k in keys_to_remove:
                    del cells[k]

        rows_by_product = {}
        for row in rows:
            try:
                pid = int(row.get('product_id'))
                if pid not in rows_by_product: rows_by_product[pid] = []
                rows_by_product[pid].append(row)
            except: continue

        for pid, prod_rows in rows_by_product.items():
            sheet = product_sheet_map.get(pid)
            if not sheet: continue
            
            product_obj = self.env['product.product'].browse(pid)
            unit_type = product_obj.product_tmpl_id.x_unidad_del_producto or 'Placa'

            current_row = 4
            for row in prod_rows:
                def set_c(col_letter, val):
                    if val is not None:
                        if 'cells' not in sheet: sheet['cells'] = {}
                        sheet['cells'][f"{col_letter}{current_row}"] = {"content": str(val)}

                # --- ESCRITURA CON RECORRIDO ---
                if unit_type == 'Placa':
                    # PLACA: Estructura Completa
                    # A=Largo, B=Alto, C=Grosor, D=Peso, E=Notas, F=Bloque, G=Placa, H=Atado, I=Grupo, J=Pedimento, K=Contenedor, L=RefProv
                    set_c("A", row.get('ancho', ''))
                    set_c("B", row.get('alto', ''))
                    set_c("C", row.get('grosor', ''))
                    set_c("D", row.get('peso', ''))
                    set_c("E", row.get('color', ''))
                    set_c("F", row.get('bloque', ''))
                    set_c("G", row.get('numero_placa', ''))
                    set_c("H", row.get('atado', ''))
                    set_c("I", row.get('grupo_name', '')) 
                    set_c("J", row.get('pedimento', ''))  
                    set_c("K", row.get('contenedor', '')) 
                    set_c("L", row.get('ref_proveedor', '')) 
                    set_c("M", "Actualizado Portal")
                else:
                    # PIEZA: Estructura Recorrida (Se salta la columna de ancho "extra")
                    # A=Grosor, B=Cantidad. C=Peso (Antes D). D=Notas (Antes E)...
                    set_c("A", row.get('grosor', ''))
                    set_c("B", row.get('quantity'))
                    set_c("C", row.get('peso', ''))    # Recorrido
                    set_c("D", row.get('color', ''))   # Recorrido
                    set_c("E", row.get('bloque', ''))  # Recorrido
                    set_c("F", row.get('numero_placa', '')) # Recorrido
                    set_c("G", row.get('atado', ''))   # Recorrido
                    set_c("H", row.get('grupo_name', '')) # Recorrido
                    set_c("I", row.get('pedimento', ''))  # Recorrido
                    set_c("J", row.get('contenedor', '')) # Recorrido
                    set_c("K", row.get('ref_proveedor', '')) # Recorrido
                    set_c("L", "Actualizado Portal") # Recorrido

                current_row += 1

        new_json = json.dumps(data)
        doc.write({
            'spreadsheet_data': new_json,
            'spreadsheet_snapshot': False, 
        })
        
        self.env['spreadsheet.revision'].sudo().search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ]).unlink()

        return True

    def _process_portal_attachments(self, files_list):
        Attachment = self.env['ir.attachment']
        for file_data in files_list:
            try:
                raw_name = file_data.get('name', 'unknown')
                container_ref = file_data.get('container_ref', '')
                final_name = f"[{container_ref}] {raw_name}" if container_ref else raw_name
                Attachment.create({
                    'name': final_name, 'type': 'binary',
                    'datas': file_data.get('data'), 'res_model': 'stock.picking',
                    'res_id': self.id, 'mimetype': file_data.get('type')
                })
            except Exception as e:
                _logger.warning(f"Error guardando adjunto {file_data.get('name')}: {e}")

    # -------------------------------------------------------------------------
    # UTILS Y ACCIONES
    # -------------------------------------------------------------------------

    def _format_cell_val(self, val):
        if val is None or val is False: return ""
        if isinstance(val, (int, float)): return str(val)
        return str(val).strip()

    def _make_cell(self, val, style=None):
        cell = {"content": self._format_cell_val(val)}
        if style is not None: cell["style"] = style
        return cell

    def _get_col_letter(self, n):
        string = ""
        n = int(n) + 1 
        while n > 0:
            n, remainder = divmod(n - 1, 26)
            string = chr(65 + remainder) + string
        return string

    def _build_pl_sheet(self, product, taken_names):
        """Construye la definición de una hoja del spreadsheet de PL para un
        producto (cabeceras según placa/pieza). ``taken_names`` evita nombres de
        hoja duplicados."""
        common_headers_suffix = ['Peso (kg)', 'Notas', 'Bloque', 'No. Placa', 'Atado', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Ref. Interna']
        cells = {}
        cells["A1"] = self._make_cell("PRODUCTO:")
        cells["B1"] = self._make_cell(f"{product.name} ({product.default_code or ''})")

        unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
        if unit_type == 'Placa':
            headers = ['Largo (m)', 'Alto (m)', 'Grosor (cm)'] + common_headers_suffix
        else:
            headers = ['Grosor (cm)', 'Cantidad'] + common_headers_suffix

        for i, header in enumerate(headers):
            if header:
                cells[f"{self._get_col_letter(i)}3"] = self._make_cell(header, style=1)

        sheet_name = (product.default_code or product.name)[:31]
        base_name = sheet_name
        count = 1
        while sheet_name in taken_names:
            sheet_name = f"{base_name[:28]}_{count}"
            count += 1
        taken_names.add(sheet_name)

        return {
            "id": f"pl_sheet_{product.id}",
            "name": sheet_name,
            "cells": cells,
            "colNumber": 14,
            "rowNumber": 250,
            "isProtected": True,
            "protectedRanges": [{"range": "A4:N250", "isProtected": False}],
        }

    def _ensure_pl_sheets_for_products(self, products):
        """Agrega al spreadsheet ya existente una hoja por cada producto del
        picking que todavía no la tenga, preservando hojas y datos capturados.

        El spreadsheet se crea una sola vez; si se agregan productos después
        (p. ej. desde el portal), sin esto la importación solo vería las hojas
        que existían al generarlo y reflejaría un solo material.
        """
        doc = self.spreadsheet_id
        if not doc:
            return
        data = self._get_current_spreadsheet_state(doc)
        if not data or not data.get('sheets'):
            return

        existing_product_ids = set()
        for sheet in data['sheets']:
            prod = self._resolve_sheet_product(sheet)
            if prod:
                existing_product_ids.add(prod.id)

        taken_names = {s.get('name') for s in data['sheets']}
        added = False
        for product in products:
            if product.id in existing_product_ids:
                continue
            data['sheets'].append(self._build_pl_sheet(product, taken_names))
            existing_product_ids.add(product.id)
            added = True

        if not added:
            return

        # Reescribimos la base con el estado fusionado (datos + revisiones) más
        # las hojas nuevas, y limpiamos revisiones para mantener consistencia.
        doc.write({
            'spreadsheet_data': json.dumps(data, ensure_ascii=False, default=str),
            'spreadsheet_snapshot': False,
        })
        self.env['spreadsheet.revision'].sudo().search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id),
        ]).unlink()

    def action_open_packing_list_spreadsheet(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming' and not self.packing_list_imported:
            raise UserError('Solo disponible para Recepciones o Transferencias con Packing List ya cargado.')

        products = self.move_ids.mapped('product_id')
        if not products:
            raise UserError('Sin productos.')

        if not self.spreadsheet_id:
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            taken_names = set()
            sheets = [self._build_pl_sheet(product, taken_names) for product in products]

            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": { "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"} }
            }

            vals = {
                'name': f'PL: {self.name}.osheet',
                'type': 'binary',
                'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet',
                'spreadsheet_data': json.dumps(spreadsheet_data, ensure_ascii=False, default=str),
                'res_model': 'stock.picking',
                'res_id': self.id,
            }
            if folder: vals['folder_id'] = folder.id
            self.spreadsheet_id = self.env['documents.document'].create(vals)
        else:
            # Ya existe: asegúrate de que tenga una hoja por cada producto actual.
            self._ensure_pl_sheets_for_products(products)

        return self._action_launch_spreadsheet(self.spreadsheet_id)

    def _ws_move_line_qty(self, ml):
        """Cantidad teórica de una línea de recepción, robusta entre
        versiones: en Odoo 19 el campo real del core es quantity; qty_done
        puede existir como compatibilidad pero leerse en 0."""
        qty = 0.0
        if 'qty_done' in ml._fields:
            qty = ml.qty_done or 0.0
        if not qty and 'quantity' in ml._fields:
            qty = ml.quantity or 0.0
        return qty

    def _ws_product_is_placa(self, product):
        """True si el producto se captura por dimensiones (placas).
        Para formatos/piezas el worksheet solo corrobora la cantidad real
        contra la teórica, igual que el PL de formatos."""
        unit = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
        return str(unit).strip().lower() == 'placa'

    def _ws_get_source_po_name(self):
        """Folio de la OC de ORIGEN de esta recepción: en cargas multi-PO
        cada picking trae su supplier_cargo_po_id; fallback al search
        clásico por picking_ids y al origin."""
        self.ensure_one()
        po = getattr(self, 'supplier_cargo_po_id', False)
        if not po:
            po = self.env['purchase.order'].search(
                [('picking_ids', 'in', self.id)], limit=1)
        return po.name if po else (self.origin or '')

    def action_open_worksheet_spreadsheet(self):
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Primero debe importar (o heredar) el Packing List.')
        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            
            base_headers = ['Nº Lote', 'Largo Teo.', 'Alto Teo.', 'Grosor', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.']
            sheets = []
            for product in products:
                is_placa = self._ws_product_is_placa(product)
                if is_placa:
                    headers = base_headers + ['LARGO R.', 'ALTO R.']
                else:
                    # Formatos: solo cantidad real contra teórica.
                    headers = base_headers + ['CANT. TEÓRICA', 'CANT. REAL']
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_str = f"{product.name} ({product.default_code or ''})"
                cells["B1"] = self._make_cell(p_str)
                cells["D1"] = self._make_cell("ORDEN DE COMPRA:")
                cells["E1"] = self._make_cell(self._ws_get_source_po_name())
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=2)
                
                move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
                
                row_idx = 4
                for ml in move_lines:
                    lot = ml.lot_id
                    cells[f"A{row_idx}"] = self._make_cell(lot.name)
                    cells[f"B{row_idx}"] = self._make_cell(lot.x_ancho)
                    cells[f"C{row_idx}"] = self._make_cell(lot.x_alto)
                    cells[f"D{row_idx}"] = self._make_cell(lot.x_grosor)
                    cells[f"E{row_idx}"] = self._make_cell(lot.x_color)
                    cells[f"F{row_idx}"] = self._make_cell(lot.x_bloque)
                    cells[f"G{row_idx}"] = self._make_cell(lot.x_numero_placa) 
                    cells[f"H{row_idx}"] = self._make_cell(lot.x_atado)
                    cells[f"I{row_idx}"] = self._make_cell(lot.x_tipo)
                    cells[f"J{row_idx}"] = self._make_cell(", ".join(lot.x_grupo.mapped('name')) if lot.x_grupo else "")
                    cells[f"K{row_idx}"] = self._make_cell(lot.x_pedimento)
                    cells[f"L{row_idx}"] = self._make_cell(lot.x_contenedor)
                    cells[f"M{row_idx}"] = self._make_cell(lot.x_referencia_proveedor)
                    if not is_placa:
                        cells[f"N{row_idx}"] = self._make_cell(self._ws_move_line_qty(ml))
                    row_idx += 1
                sheet_name = (product.default_code or product.name)[:31]
                sheets.append({
                    "id": f"ws_sheet_{product.id}", "name": sheet_name, "cells": cells,
                    "colNumber": 15, "rowNumber": max(row_idx+20, 100), "isProtected": True,
                    "protectedRanges": [
                        {"range": (f"N4:O{row_idx+100}" if is_placa else f"O4:O{row_idx+100}"), "isProtected": False},
                        # Pedimento capturable/corregible desde el WS.
                        {"range": f"K4:K{row_idx+100}", "isProtected": False},
                    ]
                })
            vals = {
                'name': f'WS: {self.name}.osheet', 'type': 'binary', 'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet', 'res_model': 'stock.picking', 'res_id': self.id,
                'spreadsheet_data': json.dumps({"version": 16, "sheets": sheets, "styles": {"2": {"bold": True, "fillColor": "#1f5b13", "textColor": "#FFFFFF", "align": "center"}}}, ensure_ascii=False, default=str)
            }
            if folder: vals['folder_id'] = folder.id
            self.ws_spreadsheet_id = self.env['documents.document'].create(vals)
            
        return self._action_launch_spreadsheet(self.ws_spreadsheet_id)

    def _action_launch_spreadsheet(self, doc):
        doc_sudo = doc.sudo()
        for method in ["action_open_spreadsheet", "action_open", "access_content"]:
            if hasattr(doc_sudo, method):
                try:
                    action = getattr(doc_sudo, method)()
                    if action: return action
                except: continue
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'documents.document',
            'res_id': doc.id,
            'view_mode': 'form',
            'target': 'current',
            'context': {'request_handler': 'spreadsheet'}
        }
    
    def action_download_packing_template(self):
        self.ensure_one()
        try: from openpyxl import Workbook; from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError: raise UserError('Instale openpyxl')
        wb = Workbook(); wb.remove(wb.active)
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in self.move_ids.mapped('product_id'):
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
            common_headers_suffix = ['Peso (kg)', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            
            # --- HEADERS DINÁMICOS EXCEL SIN HUECOS ---
            headers = []
            if unit_type == 'Placa':
                headers = ['Largo (m)', 'Alto (m)', 'Grosor (cm)'] + common_headers_suffix
            else:
                # Pieza: [Grosor, Cantidad] + Comunes (sin huecos)
                headers = ['Grosor (cm)', 'Cantidad'] + common_headers_suffix
            
            for col_num, header in enumerate(headers, 1):
                if header:
                    cell = ws.cell(row=3, column=col_num)
                    cell.value = header
                    cell.fill = header_fill
                    cell.font = header_font
                    cell.border = border
            
            for row in range(4, 54):
                for col in range(1, 15): ws.cell(row=row, column=col).border = border

        output = io.BytesIO(); wb.save(output)
        filename = f'Plantilla_PL_{self.name}.xlsx'
        self.write({'packing_list_file': base64.b64encode(output.getvalue()), 'packing_list_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true', 'target': 'self'}

    def action_download_worksheet(self):
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Importe primero el Packing List.')
        try: from openpyxl import Workbook; from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError: raise UserError('Instale openpyxl')
        wb = Workbook(); wb.remove(wb.active)
        header_fill = PatternFill(start_color='1f5b13', end_color='1f5b13', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        data_fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')
        editable_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        for product in self.move_line_ids.mapped('product_id'):
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['D1'] = 'ORDEN DE COMPRA:'; ws['E1'] = self._ws_get_source_po_name()
            is_placa = self._ws_product_is_placa(product)
            if is_placa:
                headers = ['Lote', 'Largo Teo.', 'Alto Teo.', 'Grosor', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 'Cantidad', 'Largo Real', 'Alto Real']
            else:
                headers = ['Lote', 'Largo Teo.', 'Alto Teo.', 'Grosor', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 'Cant. Teórica', 'CANT. REAL']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            curr = 4
            for ml in self.move_line_ids.filtered(lambda x: x.product_id == product):
                ws.cell(row=curr, column=1, value=ml.lot_id.name).fill = data_fill
                ws.cell(row=curr, column=2, value=ml.lot_id.x_ancho).fill = data_fill
                ws.cell(row=curr, column=3, value=ml.lot_id.x_alto).fill = data_fill
                ws.cell(row=curr, column=4, value=ml.lot_id.x_grosor).fill = data_fill
                ws.cell(row=curr, column=14, value=self._ws_move_line_qty(ml)).fill = data_fill
                for col in range(1, 15): ws.cell(row=curr, column=col).border = border
                ws.cell(row=curr, column=15).fill = editable_fill; ws.cell(row=curr, column=15).border = border
                if is_placa:
                    ws.cell(row=curr, column=16).fill = editable_fill; ws.cell(row=curr, column=16).border = border
                curr += 1
        output = io.BytesIO(); wb.save(output)
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': base64.b64encode(output.getvalue()), 'worksheet_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 'target': 'self'}

    def action_som_release_shipment_link(self):
        """Recepción equivocada (validada+devuelta, o cancelada): libera el
        vínculo con el embarque del portal y re-sincroniza, para que las
        placas capturadas en el PL se asignen a una recepción NUEVA.

        La recepción liberada conserva su historia; el embarque crea/adopta
        una recepción fresca con las filas del PL, lista para 'Procesar PL'
        (o para el auto-proceso al volver a Marcar como completado)."""
        for pick in self:
            shipment = pick.supplier_shipment_id
            if not shipment:
                raise UserError(_(
                    'Esta recepción no está vinculada a un embarque del portal.'))
            if pick.state not in ('done', 'cancel'):
                raise UserError(_(
                    'Esta recepción sigue abierta: el PL puede reprocesarse '
                    'aquí mismo. Liberar el embarque solo aplica a recepciones '
                    'validadas (devueltas) o canceladas.'))

            pick.sudo().write({'supplier_shipment_id': False})
            pick.message_post(body=_(
                'Se liberó el vínculo con el embarque %s: las placas del PL '
                'del portal se reasignarán a una recepción nueva.'
            ) % (shipment.display_name,))

            # La recepción liberada deja de COMPONER el viaje de Torre de
            # Control (embarque compartido multi-proforma): la recepción
            # nueva tomará su lugar y alimentará el mismo viaje.
            if 'stock.transit.voyage' in self.env.registry.models:
                Voyage = self.env['stock.transit.voyage'].sudo()
                voyages = Voyage.search([
                    ('custom_status', '!=', 'cancel'),
                    '|',
                    ('picking_id', '=', pick.id),
                    ('picking_ids', 'in', pick.id),
                ])
                for voyage in voyages:
                    vals = {}
                    if 'picking_ids' in voyage._fields \
                            and pick.id in voyage.picking_ids.ids:
                        vals['picking_ids'] = [(3, pick.id)]
                    if voyage.picking_id.id == pick.id:
                        others = voyage.picking_ids - pick \
                            if 'picking_ids' in voyage._fields \
                            else voyage.picking_id.browse()
                        vals['picking_id'] = others[:1].id if others else False
                    if vals:
                        voyage.write(vals)
                        voyage.message_post(body=_(
                            'La recepción %s se liberó del embarque del '
                            'portal: deja de componer este viaje; la '
                            'recepción nueva lo alimentará.'
                        ) % pick.name)

            # Re-sincronizar de inmediato: crea la recepción nueva con las
            # filas del PL. Si falla (p. ej. sin contexto HTTP), el siguiente
            # 'Marcar como completado' del portal la crea de todas formas.
            try:
                from ..services.supplier_portal_sync import SupplierPortalSyncService
                new_picking = SupplierPortalSyncService().sync_shipment(shipment)
                if new_picking:
                    pick.message_post(body=_(
                        'Recepción nueva del embarque: %s.') % new_picking.display_name)
            except Exception:
                _logger.exception(
                    '[Portal] Resync tras liberar embarque %s falló; se creará '
                    'al completar la proforma.', shipment.id)
        return True

    def button_validate(self):
        """COSECHA DE PEDIMENTO al validar la recepción: lo capturado en el
        spreadsheet del Worksheet (columna Pedimento, editable) se estampa a
        los lotes AUNQUE no se haya corrido 'Procesar Worksheet'. Sin esto,
        capturar el pedimento en la hoja y validar directo lo dejaba fuera
        del inventario (quant.x_pedimento es related del lote)."""
        res = super().button_validate()
        for picking in self:
            if picking.state == 'done':
                try:
                    picking._som_apply_ws_pedimentos()
                except Exception:
                    _logger.exception(
                        '[WS_PEDIMENTO] Falló la cosecha de pedimentos al '
                        'validar %s.', picking.name)
        return res

    def _som_apply_ws_pedimentos(self):
        self.ensure_one()
        if not self.ws_spreadsheet_id:
            return
        wizard = self.env['worksheet.import.wizard'].create({
            'picking_id': self.id,
        })
        rows = wizard._get_data_from_spreadsheet() or []
        ped_by_lot = {}
        for row in rows:
            name = (row.get('lot_name') or '').strip()
            ped = (row.get('pedimento') or '').strip()
            if name and ped:
                ped_by_lot[name] = ped
        if not ped_by_lot:
            return
        updated = []
        for lot in self.move_line_ids.mapped('lot_id'):
            ped = ped_by_lot.get((lot.name or '').strip())
            if ped and ped != (lot.x_pedimento or ''):
                lot.sudo().write({'x_pedimento': ped})
                updated.append('%s → %s' % (lot.name, ped))
        if updated:
            self.message_post(body=(
                'Pedimentos aplicados desde el Worksheet al validar: %s'
            ) % ', '.join(updated))
            _logger.info(
                '[WS_PEDIMENTO] %s: %d lote(s) actualizados.',
                self.name, len(updated))

    def action_import_packing_list(self):
        self.ensure_one()
        if self.worksheet_imported: raise UserError('El Worksheet ya fue procesado.')
        title = 'Aplicar Cambios al PL' if self.packing_list_imported else 'Importar Packing List'
        return {'name': title, 'type': 'ir.actions.act_window', 'res_model': 'packing.list.import.wizard', 'view_mode': 'form', 'target': 'new', 'context': {'default_picking_id': self.id}}
    
    def action_import_worksheet(self):
        self.ensure_one()

        wizard = self.env['worksheet.import.wizard'].create({
            'picking_id': self.id,
        })

        # Con spreadsheet: DIRECTO al resumen previo (un solo popup, con las
        # opciones de Editar Worksheet / Confirmar). El paso de captura solo
        # aplica cuando no hay spreadsheet y se debe subir un Excel.
        if self.ws_spreadsheet_id:
            return wizard.action_review_worksheet()

        return {
            'name': 'Procesar Worksheet',
            'type': 'ir.actions.act_window',
            'res_model': 'worksheet.import.wizard',
            'res_id': wizard.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def process_external_pl_data(self, json_data):
        return True