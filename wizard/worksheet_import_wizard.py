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
    _description = 'Importar Worksheet (Spreadsheet o Excel)'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel (Opcional)', attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        # VALIDACIONES PREVIAS
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones.')

        if self.picking_id.state == 'done':
            raise UserError('La recepción ya está validada. No se puede procesar el Worksheet sobre lotes históricos.')

        if not self.spreadsheet_id and not self.excel_file:
            raise UserError('No se encontró un Spreadsheet activo ni se subió un archivo Excel.')

        # 1. OBTENER DATOS (De Spreadsheet o Excel)
        rows_data = []
        if self.excel_file:
            rows_data = self._get_data_from_excel()
        else:
            rows_data = self._get_data_from_spreadsheet()

        if not rows_data:
            raise UserError('No se encontraron datos válidos en las columnas de Medidas Reales (Alto/Ancho Real).')

        # 2. PROCESAR Y ACTUALIZAR
        lines_updated = 0
        total_missing_pieces = 0
        total_missing_m2 = 0
        container_lots = {} # Para la renumeración posterior

        for data in rows_data:
            product = data['product']
            # Buscamos el lote basándonos en los datos únicos del Packing List
            # (Bloque, Atado y Contenedor son los identificadores más fiables antes de renumerar)
            move_line = self.env['stock.move.line'].search([
                ('picking_id', '=', self.picking_id.id),
                ('product_id', '=', product.id),
                ('lot_id.x_bloque', '=', data['bloque']),
                ('lot_id.x_atado', '=', data['atado']),
                ('lot_id.x_contenedor', '=', data['contenedor'])
            ], limit=1)

            if not move_line or not move_line.lot_id:
                _logger.warning(f"No se encontró el lote para el producto {product.name} (Bloque: {data['bloque']}, Atado: {data['atado']})")
                continue

            lot = move_line.lot_id
            alto_real = data['alto_real']
            ancho_real = data['ancho_real']

            # CASO A: Material que NO llegó (Medidas en 0)
            if alto_real == 0.0 and ancho_real == 0.0:
                m2_faltante = lot.x_alto * lot.x_ancho
                total_missing_pieces += 1
                total_missing_m2 += m2_faltante
                
                # Desvincular y eliminar
                move_line.unlink()
                # Solo borrar el lote si no se ha usado en otras operaciones (doble seguridad)
                other_ops = self.env['stock.move.line'].search([('lot_id', '=', lot.id), ('id', '!=', move_line.id)])
                if not other_ops:
                    lot.unlink()
            
            # CASO B: Material que llegó (Se actualizan medidas)
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
                
                # Agrupar por contenedor para renumerar al final
                cont = lot.x_contenedor or 'SN'
                if cont not in container_lots:
                    container_lots[cont] = []
                container_lots[cont].append(lot)
                lines_updated += 1

        # 3. RENUMERACIÓN SECUENCIAL (Tu lógica original mejorada)
        for cont, lots in container_lots.items():
            if not lots: continue
            
            # Ordenar por el nombre actual para mantener el orden de entrada
            lots.sort(key=lambda l: l.name)
            
            # Extraer el prefijo del primer lote (ej: "1" de "1-01")
            prefix = lots[0].name.split('-')[0] if '-' in lots[0].name else "1"
            
            for idx, lot in enumerate(lots, start=1):
                new_name = f"{prefix}-{idx:02d}"
                lot.write({'name': new_name})

        # 4. NOTIFICACIÓN FINAL
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
        """Lee el Spreadsheet nativo detectando cambios manuales"""
        # Reutilizamos la lógica del Wizard de PL para ser consistentes
        pl_wizard = self.env['packing.list.import.wizard'].create({'picking_id': self.picking_id.id})
        doc = self.spreadsheet_id
        
        # Carga del JSON y las revisiones (cambios sin guardar en el binario)
        data = pl_wizard._load_spreadsheet_json(doc)
        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'), ('res_id', '=', doc.id)
        ], order='id asc')

        # Usamos el ayudante de indexación de celdas (debe estar en el archivo de PL o importado)
        from .packing_list_import_wizard import _PLCellsIndex
        
        all_rows = []
        for sheet in data.get('sheets', []):
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            
            # Aplicamos revisiones del usuario
            for rev in revisions:
                try:
                    cmds = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
                    if isinstance(cmds, dict) and cmds.get('type') == 'REMOTE_REVISION':
                        idx.apply_revision_commands(cmds.get('commands', []), sheet.get('id'))
                except: continue
            
            product = pl_wizard._identify_product_from_sheet(idx)
            if not product: continue

            # Columnas Worksheet: M=12 (Alto Real), N=13 (Ancho Real)
            # También necesitamos: E=4 (Bloque), F=5 (Atado), J=9 (Contenedor) para identificar el lote
            for r in range(3, 250): # Procesar hasta 250 filas
                alto_r = self._to_float(idx.value(12, r))
                ancho_r = self._to_float(idx.value(13, r))
                
                # Solo procesamos si hay alguna medida real escrita o si queremos marcar como faltante
                # Para evitar procesar filas vacías, validamos que haya un bloque
                bloque = str(idx.value(4, r) or '').strip()
                if not bloque: continue

                all_rows.append({
                    'product': product,
                    'alto_real': alto_r,
                    'ancho_real': ancho_r,
                    'bloque': bloque,
                    'atado': str(idx.value(5, r) or '').strip(),
                    'contenedor': str(idx.value(9, r) or 'SN').strip(),
                })
        return all_rows

    def _get_data_from_excel(self):
        """Lógica para leer el archivo Excel subido manualmente"""
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl')
            
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        all_rows = []
        
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            
            # Identificación de producto (Buscando código entre paréntesis)
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search([
                '|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())
            ], limit=1)
            
            if not product: continue

            # En el Excel de Worksheet: 
            # Col 5: Bloque, Col 6: Atado, Col 11: Contenedor, Col 14: Alto Real, Col 15: Ancho Real
            for r in range(4, sheet.max_row + 1):
                bloque = str(sheet.cell(r, 6).value or '').strip() # Basado en tu Excel anterior
                if not bloque: continue
                
                all_rows.append({
                    'product': product,
                    'bloque': bloque,
                    'atado': str(sheet.cell(r, 7).value or '').strip(),
                    'contenedor': str(sheet.cell(r, 11).value or 'SN').strip(),
                    'alto_real': self._to_float(sheet.cell(r, 14).value),
                    'ancho_real': self._to_float(sheet.cell(r, 15).value),
                })
        return all_rows

    def _to_float(self, val):
        if val is None or val == '': return 0.0
        try: return float(str(val).replace(',', '.'))
        except: return 0.0