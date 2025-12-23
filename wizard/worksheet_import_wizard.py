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
    # IMPORTANTE: Ahora apunta al ws_spreadsheet_id (el documento específico del Worksheet)
    ws_spreadsheet_id = fields.Many2one('documents.document', related='picking_id.ws_spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel (Opcional)', attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        # VALIDACIONES PREVIAS
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones.')

        if self.picking_id.state == 'done':
            raise UserError('La recepción ya está validada. No se puede procesar el Worksheet sobre lotes históricos.')

        if not self.ws_spreadsheet_id and not self.excel_file:
            raise UserError('No se encontró el Spreadsheet del Worksheet ni se subió un archivo Excel.')

        # 1. OBTENER DATOS (De Spreadsheet WS o Excel)
        rows_data = []
        if self.excel_file:
            rows_data = self._get_data_from_excel()
        else:
            rows_data = self._get_data_from_spreadsheet()

        if not rows_data:
            raise UserError('No se encontraron datos de medidas reales (Alto/Ancho Real) para procesar.')

        # 2. PROCESAR Y ACTUALIZAR
        lines_updated = 0
        total_missing_pieces = 0
        total_missing_m2 = 0
        container_lots = {} # Para la renumeración posterior

        for data in rows_data:
            product = data['product']
            lot_name = data['lot_name']

            # Buscamos el lote directamente por su nombre y producto en este picking
            # ya que el Worksheet Spreadsheet se genera con estos nombres precargados en la Col A
            move_line = self.env['stock.move.line'].search([
                ('picking_id', '=', self.picking_id.id),
                ('product_id', '=', product.id),
                ('lot_id.name', '=', lot_name)
            ], limit=1)

            if not move_line or not move_line.lot_id:
                _logger.warning(f"No se encontró el lote '{lot_name}' para el producto {product.name} en esta recepción.")
                continue

            lot = move_line.lot_id
            alto_real = data['alto_real']
            ancho_real = data['ancho_real']

            # CASO A: Material que NO llegó (Medidas en 0)
            if alto_real == 0.0 and ancho_real == 0.0:
                m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                total_missing_pieces += 1
                total_missing_m2 += m2_faltante
                
                # Desvincular de la recepción y eliminar
                move_line.unlink()
                # Borrar el lote solo si no tiene historial en otras operaciones
                other_ops = self.env['stock.move.line'].search([('lot_id', '=', lot.id), ('id', '!=', move_line.id)])
                if not other_ops:
                    lot.unlink()
            
            # CASO B: Material que llegó (Se actualizan medidas reales)
            else:
                lot.write({
                    'x_alto': alto_real,
                    'x_ancho': ancho_real
                })
                move_line.write({
                    'qty_done': alto_real * ancho_real,
                    'x_alto_temp': alto_real,
                    'x_ancho_temp': ancho_real,
                })
                
                # Agrupar por contenedor para renumerar al final y mantener orden
                cont = lot.x_contenedor or 'SN'
                if cont not in container_lots:
                    container_lots[cont] = []
                container_lots[cont].append(lot)
                lines_updated += 1

        # 3. RENUMERACIÓN SECUENCIAL
        # Tras eliminar faltantes, reordenamos los nombres (ej. 1-01, 1-02...)
        for cont, lots in container_lots.items():
            if not lots: continue
            
            # Ordenar por el nombre original para no perder la secuencia
            lots.sort(key=lambda l: l.name)
            
            # Extraer prefijo (ej: "1" de "1-01")
            prefix = lots[0].name.split('-')[0] if '-' in lots[0].name else "1"
            
            for idx, lot in enumerate(lots, start=1):
                new_name = f"{prefix}-{idx:02d}"
                lot.write({'name': new_name})

        # 4. MARCAR WORKSHEET COMO PROCESADO (Bloquea reprocesamiento del PL)
        self.picking_id.write({'worksheet_imported': True})

        # 5. NOTIFICACIÓN FINAL
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
        # Reutilizamos la función de carga de JSON del wizard de PL
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
            
            # Aplicar revisiones pendientes del usuario
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet.get('id'))
                except: continue
            
            product = pl_wizard._identify_product_from_sheet(idx)
            if not product: continue

            # En el WS Spreadsheet generado:
            # Col A (0) = Nombre del Lote
            # Col M (12) = Alto Real
            # Col N (13) = Ancho Real
            for r in range(3, 250): # Procesar hasta la fila 250
                lot_name = str(idx.value(0, r) or '').strip()
                if not lot_name or lot_name == 'Nº Lote': continue

                alto_r = self._to_float(idx.value(12, r))
                ancho_r = self._to_float(idx.value(13, r))
                
                # Procesamos si hay valores reales
                if alto_r > 0 or ancho_r > 0:
                    all_rows.append({
                        'product': product,
                        'lot_name': lot_name,
                        'alto_real': alto_r,
                        'ancho_real': ancho_r,
                    })
                # Caso especial: Si el lote existe en la tabla pero las celdas reales están en 0
                # se incluye para la lógica de eliminación de piezas faltantes
                elif lot_name:
                     all_rows.append({
                        'product': product,
                        'lot_name': lot_name,
                        'alto_real': 0.0,
                        'ancho_real': 0.0,
                    })
        return all_rows

    def _get_data_from_excel(self):
        """Lógica para leer el archivo Excel del Worksheet (Etapa 2)"""
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

            # En el Excel exportado de Worksheet: 
            # Col 1: Lote, Col 14: Alto Real, Col 15: Ancho Real
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