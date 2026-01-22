# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import io
import base64
import logging
import json

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    # --- Campos de Packing List (PL) ---
    packing_list_file = fields.Binary(string='Packing List (Archivo)', attachment=True, copy=False)
    packing_list_filename = fields.Char(string='Nombre del archivo', copy=False)
    spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Packing List', copy=False)
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False, copy=False)
    
    # --- Campos para el Worksheet (WS) ---
    ws_spreadsheet_id = fields.Many2one('documents.document', string='Spreadsheet Worksheet', copy=False)
    worksheet_file = fields.Binary(string='Worksheet Exportado', attachment=True, copy=False)
    worksheet_filename = fields.Char(string='Nombre del Worksheet', copy=False)
    worksheet_imported = fields.Boolean(string='Worksheet Importado', default=False, copy=False)

    # --- NUEVO: Acceso a Portal Proveedor (Solo lectura/informativo en Picking) ---
    supplier_access_ids = fields.One2many('stock.picking.supplier.access', 'picking_id', string="Links Proveedor")
    
    @api.depends('packing_list_file', 'spreadsheet_id', 'supplier_access_ids')
    def _compute_has_packing_list(self):
        for rec in self:
            # Se considera que tiene PL si hay un archivo, un spreadsheet generado o un link de proveedor creado
            rec.has_packing_list = bool(rec.packing_list_file or rec.spreadsheet_id or rec.supplier_access_ids)

    # -------------------------------------------------------------------------
    # FUNCIONALIDAD PORTAL PROVEEDOR (PROCESAMIENTO)
    # NOTA: La generación del link se movió a purchase.order
    # -------------------------------------------------------------------------

    def process_external_pl_data(self, json_data):
        """ 
        Recibe la data JSON desde el portal del proveedor y crea los lotes.
        Esta función es llamada por el Controlador cuando el proveedor envía el formulario.
        """
        self.ensure_one()
        _logger.info(f"Procesando PL Externo para {self.name} con {len(json_data)} registros.")

        # 1. Limpieza de datos previos (Borrar y reescribir para evitar duplicados)
        old_move_lines = self.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        # Resetear cantidades hechas
        old_move_lines.write({'qty_done': 0})
        
        # Eliminar Quants fantasmas si existen
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            quants.sudo().unlink()

        # Eliminar lineas viejas
        old_move_lines.unlink()
        
        # Eliminar lotes huérfanos creados anteriormente para esta operación
        for lot in old_lots:
            # Verificar si el lote se usa en otros movimientos fuera de este picking
            if self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)]) == 0:
                try:
                    lot.unlink()
                except Exception as e:
                    _logger.warning(f"No se pudo eliminar lote {lot.name}: {e}")

        # 2. Lógica de Prefijos y Contenedores
        # Buscamos el último prefijo numérico global (Ej: si el ultimo fue 104-XX, el siguiente es 105)
        self.env.cr.execute("""SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num FROM stock_lot WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s ORDER BY prefix_num DESC LIMIT 1""", (self.company_id.id,))
        res = self.env.cr.fetchone()
        next_prefix = (res[0] + 1) if res and res[0] else 1
        
        containers_map = {} # Mapa para controlar prefijos por contenedor: {'CONT1': {'prefix': '105', 'seq': 1}}
        move_lines_created = 0

        # 3. Procesamiento de filas
        for row in json_data:
            # Validar producto
            try:
                product_id = int(row.get('product_id'))
                product = self.env['product.product'].browse(product_id)
            except (ValueError, TypeError):
                continue

            if not product.exists(): 
                continue
            
            # Buscar el movimiento original (Stock Move) para asociar
            move = self.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move: 
                continue

            # Gestión de Contenedor y Numeración
            cont_raw = (row.get('contenedor') or 'SN').strip().upper()
            
            if cont_raw not in containers_map:
                containers_map[cont_raw] = {
                    'prefix': str(next_prefix), 
                    'seq': 1 
                }
                next_prefix += 1 # Siguiente contenedor tendrá siguiente prefijo numérico global
            
            # Generar Nombre Lote: PREFIJO-CONSECUTIVO (Ej: 105-01)
            current_prefix = containers_map[cont_raw]['prefix']
            current_seq = containers_map[cont_raw]['seq']
            l_name = f"{current_prefix}-{current_seq:02d}"
            
            # Parsear valores numéricos
            try:
                grosor = float(row.get('grosor', 0))
                alto = float(row.get('alto', 0))
                ancho = float(row.get('ancho', 0))
            except ValueError:
                grosor = alto = ancho = 0.0

            # Crear Lote
            lot_vals = {
                'name': l_name, 
                'product_id': product.id, 
                'company_id': self.company_id.id,
                'x_grosor': grosor, 
                'x_alto': alto, 
                'x_ancho': ancho,
                'x_color': row.get('color', ''), 
                'x_bloque': row.get('bloque', ''), 
                'x_tipo': row.get('tipo', 'placa'), 
                'x_contenedor': cont_raw, 
                # 'x_referencia_proveedor': row.get('ref_prov', ''), # Descomentar si tu modelo lo tiene
            }
            lot = self.env['stock.lot'].create(lot_vals)
            
            # Calcular cantidad (M2)
            qty = round(alto * ancho, 3)
            if qty <= 0: qty = 1.0

            # Crear Move Line (Asignación al Picking)
            self.env['stock.move.line'].create({
                'move_id': move.id, 
                'product_id': product.id, 
                'lot_id': lot.id,
                'qty_done': qty,
                'location_id': self.location_id.id, 
                'location_dest_id': self.location_dest_id.id,
                'picking_id': self.id,
                # Campos temp para trazabilidad (si tu modulo base los usa)
                'x_grosor_temp': lot.x_grosor, 
                'x_alto_temp': lot.x_alto,
                'x_ancho_temp': lot.x_ancho, 
                'x_color_temp': lot.x_color,
                'x_bloque_temp': lot.x_bloque, 
                'x_contenedor_temp': lot.x_contenedor
            })
            
            containers_map[cont_raw]['seq'] += 1
            move_lines_created += 1

        self.write({'packing_list_imported': True})
        return True

    # -------------------------------------------------------------------------
    # FUNCIONES DE SEGURIDAD PARA SPREADSHEET (EVITA ERROR STARTSWITH)
    # -------------------------------------------------------------------------

    def _format_cell_val(self, val):
        """ Garantiza que el valor sea SIEMPRE un string válido para o-spreadsheet. """
        if val is None or val is False:
            return ""
        if isinstance(val, (int, float)):
            return str(val)
        result = str(val).strip()
        return result if result else ""

    def _make_cell(self, val, style=None):
        content = self._format_cell_val(val)
        cell = {"content": content}
        if style is not None:
            cell["style"] = style
        return cell

    def _get_col_letter(self, n):
        string = ""
        while n >= 0:
            n, remainder = divmod(n, 26)
            string = chr(65 + remainder) + string
            n -= 1
        return string

    # -------------------------------------------------------------------------
    # GESTIÓN DE PACKING LIST INTERNO (ETAPA 1)
    # -------------------------------------------------------------------------
    
    def action_open_packing_list_spreadsheet(self):
        """ Crea o abre el Spreadsheet para el Packing List inicial. """
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Esta acción solo está disponible para Recepciones (Entradas).')
        
        if self.worksheet_imported:
            raise UserError('El Worksheet ya fue procesado. No es posible modificar el Packing List.')
            
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products:
                raise UserError('No hay productos cargados en esta operación.')

            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            headers = [
                'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 
                'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas'
            ]
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_name = self._format_cell_val(product.name)
                p_code = self._format_cell_val(product.default_code)
                cells["B1"] = self._make_cell(f"{p_name} ({p_code})")
                
                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    cells[f"{col_letter}3"] = self._make_cell(header, style=1)

                sheet_name = (product.default_code or product.name)[:31]
                if any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{sheet_name[:25]}_{product.id}"

                sheets.append({
                    "id": f"pl_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 12,
                    "rowNumber": 250,
                    "isProtected": True,
                    "protectedRanges": [{"range": "A4:L250", "isProtected": False}]
                })

            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": {
                    "1": {"bold": True, "fillColor": "#366092", "textColor": "#FFFFFF", "align": "center"}
                }
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
            if folder:
                vals['folder_id'] = folder.id

            self.spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.spreadsheet_id)

    # -------------------------------------------------------------------------
    # GESTIÓN DE WORKSHEET (ETAPA 2)
    # -------------------------------------------------------------------------

    def action_open_worksheet_spreadsheet(self):
        """ Crea un Spreadsheet independiente para el Worksheet con datos bloqueados. """
        self.ensure_one()
        if not self.packing_list_imported:
            raise UserError('Debe procesar primero el Packing List para generar el Worksheet.')

        if not self.ws_spreadsheet_id:
            products = self.move_line_ids.mapped('product_id')
            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)

            headers = [
                'Nº Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 
                'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov.', 
                'ALTO REAL (m)', 'ANCHO REAL (m)'
            ]
            
            sheets = []
            for product in products:
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_name = self._format_cell_val(product.name)
                p_code = self._format_cell_val(product.default_code)
                cells["B1"] = self._make_cell(f"{p_name} ({p_code})")
                
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
                    cells[f"G{row_idx}"] = self._make_cell(lot.x_atado)
                    cells[f"H{row_idx}"] = self._make_cell(lot.x_tipo)
                    cells[f"I{row_idx}"] = self._make_cell(", ".join(lot.x_grupo.mapped('name')) if lot.x_grupo else "")
                    cells[f"J{row_idx}"] = self._make_cell(lot.x_pedimento)
                    cells[f"K{row_idx}"] = self._make_cell(lot.x_contenedor)
                    cells[f"L{row_idx}"] = self._make_cell(lot.x_referencia_proveedor)
                    row_idx += 1

                sheet_name = (product.default_code or product.name)[:31]
                sheets.append({
                    "id": f"ws_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 14,
                    "rowNumber": max(row_idx + 20, 100),
                    "isProtected": True,
                    "protectedRanges": [{"range": f"M4:N{row_idx + 100}", "isProtected": False}]
                })

            spreadsheet_data = {
                "version": 16,
                "sheets": sheets,
                "styles": {
                    "2": {"bold": True, "fillColor": "#1f5b13", "textColor": "#FFFFFF", "align": "center"}
                }
            }

            vals = {
                'name': f'WS: {self.name}.osheet',
                'type': 'binary', 
                'handler': 'spreadsheet',
                'mimetype': 'application/o-spreadsheet',
                'spreadsheet_data': json.dumps(spreadsheet_data, ensure_ascii=False, default=str),
                'res_model': 'stock.picking',
                'res_id': self.id,
            }
            if folder:
                vals['folder_id'] = folder.id

            self.ws_spreadsheet_id = self.env['documents.document'].create(vals)

        return self._action_launch_spreadsheet(self.ws_spreadsheet_id)

    # -------------------------------------------------------------------------
    # FUNCIONES DE APOYO Y EXPORTACIÓN EXCEL
    # -------------------------------------------------------------------------

    def _action_launch_spreadsheet(self, doc):
        """ Dispara la apertura del documento. """
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
        """ Descarga Excel para el Packing List. """
        self.ensure_one()
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl')
            
        wb = Workbook(); wb.remove(wb.active)
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        
        for product in self.move_ids.mapped('product_id'):
            ws = wb.create_sheet(title=(product.default_code or product.name)[:31])
            ws['A1'] = 'PRODUCTO:'; ws['B1'] = f'{product.name} ({product.default_code or ""})'
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            for row in range(4, 54):
                for col in range(1, 13): ws.cell(row=row, column=col).border = border
                
        output = io.BytesIO(); wb.save(output)
        filename = f'Plantilla_PL_{self.name}.xlsx'
        self.write({'packing_list_file': base64.b64encode(output.getvalue()), 'packing_list_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true', 'target': 'self'}

    def action_download_worksheet(self):
        """ Descarga Excel para el Worksheet. """
        self.ensure_one()
        if not self.packing_list_imported: raise UserError('Importe primero el Packing List.')
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Border, Side
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
            headers = ['Lote', 'Grosor', 'Alto Teo.', 'Ancho Teo.', 'Color', 'Bloque', 'Atado', 'Tipo', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Prov', 'Cantidad', 'Alto Real', 'Ancho Real']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num); cell.value = header; cell.fill = header_fill; cell.font = header_font; cell.border = border
            
            curr = 4
            for ml in self.move_line_ids.filtered(lambda x: x.product_id == product):
                ws.cell(row=curr, column=1, value=ml.lot_id.name).fill = data_fill
                ws.cell(row=curr, column=2, value=ml.lot_id.x_grosor).fill = data_fill
                ws.cell(row=curr, column=3, value=ml.lot_id.x_alto).fill = data_fill
                ws.cell(row=curr, column=4, value=ml.lot_id.x_ancho).fill = data_fill
                ws.cell(row=curr, column=13, value=ml.qty_done).fill = data_fill
                for col in range(1, 14): ws.cell(row=curr, column=col).border = border
                ws.cell(row=curr, column=14).fill = editable_fill; ws.cell(row=curr, column=14).border = border
                ws.cell(row=curr, column=15).fill = editable_fill; ws.cell(row=curr, column=15).border = border
                curr += 1
                
        output = io.BytesIO(); wb.save(output)
        filename = f'Worksheet_{self.name}.xlsx'
        self.write({'worksheet_file': base64.b64encode(output.getvalue()), 'worksheet_filename': filename})
        return {'type': 'ir.actions.act_url', 'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true', 'target': 'self'}

    # -------------------------------------------------------------------------
    # ACCIONES DE WIZARDS
    # -------------------------------------------------------------------------

    def action_import_packing_list(self):
        self.ensure_one()
        
        if self.worksheet_imported:
            raise UserError('El Worksheet ya fue procesado. No es posible reprocesar el Packing List.')
        
        title = 'Aplicar Cambios al PL' if self.packing_list_imported else 'Importar Packing List'
        return {
            'name': title, 
            'type': 'ir.actions.act_window', 
            'res_model': 'packing.list.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }
    
    def action_import_worksheet(self):
        self.ensure_one()
        return {
            'name': 'Procesar Worksheet (Medidas Reales)', 
            'type': 'ir.actions.act_window', 
            'res_model': 'worksheet.import.wizard', 
            'view_mode': 'form', 
            'target': 'new', 
            'context': {'default_picking_id': self.id}
        }