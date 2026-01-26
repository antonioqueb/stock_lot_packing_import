# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError
import base64
import io
import json
import logging

_logger = logging.getLogger(__name__)

class WorksheetImportWizard(models.TransientModel):
    _name = 'worksheet.import.wizard'
    _description = 'Importar Worksheet (Spreadsheet WS o Excel)'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    ws_spreadsheet_id = fields.Many2one('documents.document', related='picking_id.ws_spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel (Opcional)', attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        # MODIFICADO: Se eliminó la validación estricta de 'incoming' para permitir transferencias internas.
        
        if self.picking_id.state == 'done':
            raise UserError('La recepción ya está validada. No se puede procesar el Worksheet sobre lotes históricos.')

        if not self.ws_spreadsheet_id and not self.excel_file:
            raise UserError('No se encontró el Spreadsheet del Worksheet ni se subió un archivo Excel.')

        rows_data = []
        if self.excel_file:
            rows_data = self._get_data_from_excel()
        else:
            rows_data = self._get_data_from_spreadsheet()

        if not rows_data:
            raise UserError('No se encontraron datos de medidas reales (Alto/Ancho Real) para procesar.')

        lines_updated = 0
        total_missing_pieces = 0
        total_missing_m2 = 0
        
        container_lots = {}
        lots_to_delete = []
        move_lines_to_delete = []

        for data in rows_data:
            product = data['product']
            lot_name = data['lot_name']

            # --- CORRECCIÓN CRÍTICA DE BÚSQUEDA ---
            # 1. Intentar búsqueda precisa: Picking + Lote + Producto
            # Esto es lo ideal, pero puede fallar si la detección del producto en el spreadsheet (por nombre)
            # no coincide exactamente con la variante guardada en la línea (e.g. variante vs plantilla).
            
            domain_base = [
                ('picking_id', '=', self.picking_id.id),
                ('lot_id.name', '=', lot_name)
            ]
            
            move_line = self.env['stock.move.line'].search(domain_base + [('product_id', '=', product.id)], limit=1)

            # 2. Fallback: Si no encuentra por producto, buscar solo por Picking + Lote
            # Esto asume que el nombre del lote es único dentro de la misma recepción, lo cual es estándar.
            if not move_line:
                _logger.info(f"Fallback búsqueda lote: '{lot_name}' sin filtro de producto.")
                move_line = self.env['stock.move.line'].search(domain_base, limit=1)

            if not move_line or not move_line.lot_id:
                _logger.warning(f"No se encontró el lote '{lot_name}' para el producto {product.name} en esta recepción (Picking ID: {self.picking_id.id}).")
                continue

            lot = move_line.lot_id
            alto_real = data['alto_real']
            ancho_real = data['ancho_real']

            # CASO A: Material que NO llegó (Medidas en 0)
            if alto_real == 0.0 and ancho_real == 0.0:
                m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                total_missing_pieces += 1
                total_missing_m2 += m2_faltante
                
                move_lines_to_delete.append(move_line)
                lots_to_delete.append(lot)
            
            # CASO B: Material que llegó (Se actualizan medidas reales)
            else:
                lot.write({
                    'x_alto': alto_real,
                    'x_ancho': ancho_real
                })
                # Calcular cantidad hecha basada en medidas reales
                new_qty = round(alto_real * ancho_real, 3)
                move_line.write({
                    'qty_done': new_qty,
                    'x_alto_temp': alto_real,
                    'x_ancho_temp': ancho_real,
                })
                
                cont = lot.x_contenedor or 'SN'
                if cont not in container_lots:
                    container_lots[cont] = []
                container_lots[cont].append({
                    'lot': lot,
                    'original_name': lot.name,
                    'move_line': move_line
                })
                lines_updated += 1

        # ELIMINAR LOTES QUE NO LLEGARON
        for ml in move_lines_to_delete:
            ml.write({'qty_done': 0})
        
        for lot in lots_to_delete:
            quants = self.env['stock.quant'].sudo().search([('lot_id', '=', lot.id)])
            if quants:
                quants.sudo().write({'quantity': 0, 'reserved_quantity': 0})
                quants.sudo().unlink()
        
        for ml in move_lines_to_delete:
            ml.unlink()
        
        for lot in lots_to_delete:
            other_ops = self.env['stock.move.line'].search([('lot_id', '=', lot.id)])
            if not other_ops:
                remaining_quants = self.env['stock.quant'].sudo().search([('lot_id', '=', lot.id)])
                if remaining_quants:
                    remaining_quants.sudo().unlink()
                lot.unlink()

        # RENUMERACIÓN SECUENCIAL de los lotes que SÍ llegaron
        for cont, lot_data_list in container_lots.items():
            if not lot_data_list:
                continue
            
            lot_data_list.sort(key=lambda x: x['original_name'])
            
            first_name = lot_data_list[0]['original_name']
            prefix = first_name.split('-')[0] if '-' in first_name else "1"
            
            for idx, lot_data in enumerate(lot_data_list, start=1):
                new_name = f"{prefix}-{idx:02d}"
                lot_data['lot'].write({'name': new_name})

        self.picking_id.write({'worksheet_imported': True})

        message = f'✓ Se actualizaron {lines_updated} lotes con medidas reales.'
        if total_missing_pieces > 0:
            message += f'\n⚠️ MATERIAL FALTANTE:\n• Piezas eliminadas: {total_missing_pieces}\n• Total m² reducidos: {total_missing_m2:.2f} m²'

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Worksheet Procesado Correctamente',
                'message': message,
                'type': 'warning' if total_missing_pieces > 0 else 'success',
                'sticky': True if total_missing_pieces > 0 else False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }

    def _get_data_from_spreadsheet(self):
        """Lee el documento ws_spreadsheet_id (Worksheet) detectando cambios manuales"""
        pl_wizard = self.env['packing.list.import.wizard'].create({'picking_id': self.picking_id.id})
        doc = self.ws_spreadsheet_id 
        
        data = pl_wizard._load_spreadsheet_json(doc)
        if not data: return []

        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)
        ], order='id asc')

        from .packing_list_import_wizard import _PLCellsIndex
        
        all_rows = []
        for sheet in data.get('sheets', []):
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet.get('id'))
                except: continue
            
            product = pl_wizard._identify_product_from_sheet(idx)
            if not product: continue

            # Col A (0) = Nombre del Lote
            # Col M (12) = Alto Real
            # Col N (13) = Ancho Real
            for r in range(3, 250):
                lot_name = str(idx.value(0, r) or '').strip()
                if not lot_name or lot_name == 'Nº Lote': continue

                alto_r = self._to_float(idx.value(12, r))
                ancho_r = self._to_float(idx.value(13, r))
                
                # Incluir TODOS los lotes encontrados (con o sin medidas)
                all_rows.append({
                    'product': product,
                    'lot_name': lot_name,
                    'alto_real': alto_r,
                    'ancho_real': ancho_r,
                })
                    
        return all_rows

    def _get_data_from_excel(self):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl')
            
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        all_rows = []
        
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search([
                '|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())
            ], limit=1)
            
            if not product: continue

            for r in range(4, sheet.max_row + 1):
                lot_name = str(sheet.cell(r, 1).value or '').strip()
                if not lot_name: continue
                
                all_rows.append({
                    'product': product,
                    'lot_name': lot_name,
                    'alto_real': self._to_float(sheet.cell(r, 14).value),
                    'ancho_real': self._to_float(sheet.cell(r, 15).value),
                })
        return all_rows

    def _to_float(self, val):
        if val is None or val == '': return 0.0
        try:
            return float(str(val).replace(',', '.'))
        except:
            return 0.0