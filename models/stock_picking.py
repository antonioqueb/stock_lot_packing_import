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

    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'picking_id', string="Links Proveedor")

    # --- DATOS DE EMBARQUE (CABECERA) ---
    supplier_invoice_number = fields.Char(string="No. de factura")
    supplier_shipment_date = fields.Date(string="Fecha de embarque")
    supplier_proforma_number = fields.Char(string="No. de Proforma (PI)")
    supplier_bl_number = fields.Char(string="No. de Conocimiento de Embarque (B/L)")
    supplier_origin = fields.Char(string="Origen (puerto/ciudad)")
    supplier_destination = fields.Char(string="Destino (puerto/ciudad)")
    supplier_country_origin = fields.Char(string="País de origen de la mercancía")
    supplier_vessel = fields.Char(string="Buque")
    
    # Separación de Incoterm y Pago
    supplier_incoterm_payment = fields.Char(string="Incoterm") 
    supplier_payment_terms = fields.Char(string="Términos de pago")

    supplier_merchandise_desc = fields.Text(string="Descripción de mercancía")
    
    # Estos campos almacenarán la concatenación/suma de todos los contenedores
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

    def get_packing_list_data_for_portal(self):
        """
        Lee el Spreadsheet actual para mostrar al proveedor lo que ya ha llenado.
        Recupera filas y datos de cabecera implícitos en las columnas.
        """
        self.ensure_one()
        rows = []
        
        if not self.spreadsheet_id:
            return rows

        # Obtener el estado actual real del spreadsheet (Snapshot + Revisiones)
        data = self._get_current_spreadsheet_state(self.spreadsheet_id)
        if not data:
            return rows

        sheets = data.get('sheets', [])
        
        for sheet in sheets:
            cells = sheet.get('cells', {})
            # Buscar Producto en celda B1
            b1_val = cells.get("B1", {}).get("content", "")
            
            if not b1_val: continue

            p_ref = str(b1_val).split('(')[0].strip()
            product = self.env['product.product'].search([
                '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
            ], limit=1)
            
            if not product: continue

            # --- LOGICA AUTOMATICA: Obtener tipo desde el TEMPLATE del producto ---
            # Se usa product_tmpl_id porque el campo x_unidad_del_producto está en el modelo product.template
            default_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'

            # Leer filas desde la fila 4 (index 3)
            row_idx = 3
            while True:
                idx_str = str(row_idx + 1)
                
                # Chequeo simple de fin de datos
                b_cell = cells.get(f"B{idx_str}", {})
                if not b_cell or not b_cell.get("content"):
                    if not cells.get(f"C{idx_str}", {}).get("content"):
                        # Lookahead para evitar falsos positivos por filas vacías intermedias
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

                alto = get_val("B", float)
                ancho = get_val("C", float)

                if alto > 0 and ancho > 0:
                    rows.append({
                        'product_id': product.id,
                        'grosor': get_val("A"),
                        'alto': alto,
                        'ancho': ancho,
                        'color': get_val("D"),   # Notas
                        'bloque': get_val("E"),
                        'numero_placa': get_val("F"),
                        'atado': get_val("G"),   
                        # AQUI SE APLICA: Si la celda H está vacía, usa el del template
                        'tipo': get_val("H") or default_type, 
                        'contenedor': get_val("K"), # Recuperar contenedor asignado     
                    })
                
                row_idx += 1
                if row_idx > 2000: break # Safety break

        return rows

    def _get_current_spreadsheet_state(self, doc):
        """
        Obtiene los datos más recientes combinando Snapshot y Revisiones pendientes.
        """
        data = {}
        
        # 1. Intentar cargar Snapshot
        if doc.spreadsheet_snapshot:
            try:
                raw = doc.spreadsheet_snapshot
                data = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
            except Exception as e:
                _logger.warning(f"[PL_DEBUG] Error leyendo snapshot: {e}")

        # 2. Si falla, cargar Data Base
        if not data and doc.spreadsheet_data:
            try:
                raw = doc.spreadsheet_data
                data = json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)
            except Exception as e:
                return {}

        if not data: return {}

        # 3. Obtener y Aplicar Revisiones
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
        Recibe filas consolidadas (lista plana de todos los contenedores).
        El JS ya asignó el campo 'contenedor' correcto a cada fila.
        """
        self.ensure_one()
        
        # --- A. GUARDAR CABECERA CONSOLIDADA ---
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
                
                # Campos acumulados/concatenados
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
        
        # Cargar estado actual
        data = self._get_current_spreadsheet_state(doc)
        if not data: return True

        product_sheet_map = {} 
        sheets = data.get('sheets', [])
        
        # Mapear productos a hojas y limpiar datos viejos
        for sheet in sheets:
            cells = sheet.get('cells', {})
            b1_val = cells.get("B1", {}).get("content", "")
            if b1_val:
                p_ref = str(b1_val).split('(')[0].strip()
                product = self.env['product.product'].search([
                    '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
                ], limit=1)
                
                if product:
                    product_sheet_map[product.id] = sheet
                    # Limpieza segura de datos viejos (filas >= 4)
                    keys_to_remove = []
                    for key in list(cells.keys()):
                        match = re.match(r'^([A-Z]+)(\d+)$', key)
                        if match:
                            row_num = int(match.group(2))
                            if row_num >= 4:
                                keys_to_remove.append(key)
                    for k in keys_to_remove:
                        del cells[k]

        # Agrupar filas recibidas por producto
        rows_by_product = {}
        for row in rows:
            try:
                pid = int(row.get('product_id'))
                if pid not in rows_by_product: rows_by_product[pid] = []
                rows_by_product[pid].append(row)
            except: continue

        # Escribir en el JSON
        for pid, prod_rows in rows_by_product.items():
            sheet = product_sheet_map.get(pid)
            if not sheet: continue
            
            # --- LOGICA AUTOMATICA: Buscar el tipo por defecto del producto (TEMPLATE) ---
            product_obj = self.env['product.product'].browse(pid)
            default_type = product_obj.product_tmpl_id.x_unidad_del_producto or 'Placa'

            current_row = 4
            for row in prod_rows:
                def set_c(col_letter, val):
                    if val is not None:
                        if 'cells' not in sheet: sheet['cells'] = {}
                        sheet['cells'][f"{col_letter}{current_row}"] = {"content": str(val)}

                set_c("A", row.get('grosor', ''))
                set_c("B", row.get('alto', ''))
                set_c("C", row.get('ancho', ''))
                set_c("D", row.get('color', ''))
                set_c("E", row.get('bloque', ''))
                set_c("F", row.get('numero_placa', '')) 
                set_c("G", row.get('atado', ''))
                
                # AQUI SE APLICA: Si el valor 'tipo' viene vacio del portal, asignamos el del template
                tipo_val = row.get('tipo')
                if not tipo_val:
                    tipo_val = default_type
                set_c("H", tipo_val)
                
                # CRITICO: Escribir el contenedor en Columna K
                set_c("K", row.get('contenedor', '')) 
                
                set_c("M", "Actualizado Portal")
                current_row += 1

        # Guardar cambios
        new_json = json.dumps(data)
        doc.write({
            'spreadsheet_data': new_json,
            'spreadsheet_snapshot': False, 
        })
        
        # Eliminar revisiones pendientes para consolidar
        self.env['spreadsheet.revision'].sudo().search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ]).unlink()

        return True

    def _process_portal_attachments(self, files_list):
        """
        Procesa la lista de archivos adjuntos enviada desde el portal.
        files_list = [{'name': '...', 'type': '...', 'data': 'base64...', 'container_ref': '...'}, ...]
        """
        Attachment = self.env['ir.attachment']
        for file_data in files_list:
            try:
                raw_name = file_data.get('name', 'unknown')
                container_ref = file_data.get('container_ref', '')
                
                # Prefijo para organizar archivos por contenedor
                final_name = f"[{container_ref}] {raw_name}" if container_ref else raw_name
                
                Attachment.create({
                    'name': final_name,
                    'type': 'binary',
                    'datas': file_data.get('data'), # Ya viene en base64 puro desde JS
                    'res_model': 'stock.picking',
                    'res_id': self.id,
                    'mimetype': file_data.get('type')
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

    def action_open_packing_list_spreadsheet(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming' and not self.packing_list_imported: 
            raise UserError('Solo disponible para Recepciones o Transferencias con Packing List ya cargado.')
        
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products: raise UserError('Sin productos.')

            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            
            # Headers Spreadsheet (Index 10 = Contenedor)
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Notas', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Ref. Interna']
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_str = f"{product.name} ({product.default_code or ''})"
                cells["B1"] = self._make_cell(p_str)
                
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=1)

                sheet_name = (product.default_code or product.name)[:31]
                # Manejo de nombres duplicados de hojas
                count = 1
                base_name = sheet_name
                while any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{base_name[:28]}_{count}"
                    count += 1

                sheets.append({
                    "id": f"pl_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 13, 
                    "rowNumber": 250,
                    "isProtected": True,
                    "protectedRanges": [{"range": "A4:M250", "isProtected": False}] 
                })

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

        return self._action_launch_spreadsheet(self.spreadsheet_id)

    def action_open_worksheet_spreadsheet(self):
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Primero debe importar (o heredar) el Packing List.')
        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            
            headers = ['Nº Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.', 'ALTO REAL (m)', 'ANCHO REAL (m)']
            sheets = []
            for product in products:
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_str = f"{product.name} ({product.default_code or ''})"
                cells["B1"] = self._make_cell(p_str)
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=2)
                
                move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
                
                row_idx = 4
                for ml in move_lines:
                    lot = ml.lot_id
                    cells[f"A{row_idx}"] = self._make_cell(lot.name)
                    cells[f"B{row_idx}"] = self._make_cell(lot.x_grosor)
                    cells[f"C{row_idx}"] = self._make_cell(lot.x_alto)
                    cells[f"D{row_idx}"] = self._make_cell(lot.x_ancho)
                    cells[f"E{row_idx}"] = self._make_cell(lot.x_color)
                    cells[f"F{row_idx}"] = self._make_cell(lot.x_bloque)
                    cells[f"G{row_idx}"] = self._make_cell(lot.x_numero_placa) 
                    cells[f"H{row_idx}"] = self._make_cell(lot.x_atado)
                    cells[f"I{row_idx}"] = self._make_cell(lot.x_tipo)
                    cells[f"J{row_idx}"] = self._make_cell(", ".join(lot.x_grupo.mapped('name')) if lot.x_grupo else "")
                    cells[f"K{row_idx}"] = self._make_cell(lot.x_pedimento)
                    cells[f"L{row_idx}"] = self._make_cell(lot.x_contenedor)
                    cells[f"M{row_idx}"] = self._make_cell(lot.x_referencia_proveedor)
                    row_idx += 1
                sheet_name = (product.default_code or product.name)[:31]
                sheets.append({
                    "id": f"ws_sheet_{product.id}", "name": sheet_name, "cells": cells,
                    "colNumber": 15, "rowNumber": max(row_idx+20, 100), "isProtected": True,
                    "protectedRanges": [{"range": f"N4:O{row_idx+100}", "isProtected": False}]
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
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            for row in range(4, 54):
                for col in range(1, 14): ws.cell(row=row, column=col).border = border
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
            headers = ['Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 'Cantidad', 'Alto Real', 'Ancho Real']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            curr = 4
            for ml in self.move_line_ids.filtered(lambda x: x.product_id == product):
                ws.cell(row=curr, column=1, value=ml.lot_id.name).fill = data_fill
                ws.cell(row=curr, column=2, value=ml.lot_id.x_grosor).fill = data_fill
                ws.cell(row=curr, column=3, value=ml.lot_id.x_alto).fill = data_fill
                ws.cell(row=curr, column=4, value=ml.lot_id.x_ancho).fill = data_fill
                ws.cell(row=curr, column=14, value=ml.qty_done).fill = data_fill
                for col in range(1, 15): ws.cell(row=curr, column=col).border = border
                ws.cell(row=curr, column=15).fill = editable_fill; ws.cell(row=curr, column=15).border = border
                ws.cell(row=curr, column=16).fill = editable_fill; ws.cell(row=curr, column=16).border = border
                curr += 1
        output = io.BytesIO(); wb.save(output)
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': base64.b64encode(output.getvalue()), 'worksheet_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 'target': 'self'}

    def action_import_packing_list(self):
        self.ensure_one()
        if self.worksheet_imported: raise UserError('El Worksheet ya fue procesado.')
        title = 'Aplicar Cambios al PL' if self.packing_list_imported else 'Importar Packing List'
        return {'name': title, 'type': 'ir.actions.act_window', 'res_model': 'packing.list.import.wizard', 'view_mode': 'form', 'target': 'new', 'context': {'default_picking_id': self.id}}
    
    def action_import_worksheet(self):
        self.ensure_one()
        return {'name': 'Procesar Worksheet', 'type': 'ir.actions.act_window', 'res_model': 'worksheet.import.wizard', 'view_mode': 'form', 'target': 'new', 'context': {'default_picking_id': self.id}}

    def process_external_pl_data(self, json_data):
        return True