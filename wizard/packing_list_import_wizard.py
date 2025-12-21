# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging

_logger = logging.getLogger(__name__)

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def _get_next_global_prefix(self):
        self.env['stock.lot'].flush_model()
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(sl.name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name ~ '^[0-9]+-[0-9]+$'
            AND sp.state = 'done'
            AND sp.company_id = %s
            ORDER BY prefix_num DESC
            LIMIT 1
        """, (self.picking_id.company_id.id,))
        result = self.env.cr.fetchone()
        return (result[0] + 1) if result and result[0] else 1
    
    def _get_next_lot_number_for_prefix(self, prefix):
        self.env['stock.lot'].flush_model()
        self.env.cr.execute("""
            SELECT sl.name
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name LIKE %s
            AND sp.state = 'done'
            AND sp.company_id = %s
            ORDER BY CAST(SUBSTRING(sl.name FROM '-([0-9]+)$') AS INTEGER) DESC
            LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        result = self.env.cr.fetchone()
        if result:
            try: return int(result[0].split('-')[1]) + 1
            except: pass
        return 1
    
    def _format_lot_name(self, prefix, number):
        return f'{prefix}-{number:02d}' if number < 100 else f'{prefix}-{number}'

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== INICIANDO EXTRACCIÓN DE DATOS ODOO 19 ===")
        
        if self.picking_id.state == 'done':
             raise UserError('La recepción ya está validada.')
             
        rows_to_process = []
        if self.picking_id.spreadsheet_id:
            rows_to_process = self._get_data_from_spreadsheet()
        elif self.excel_file:
            rows_to_process = self._get_data_from_excel_file()
        else:
            raise UserError('No hay datos. Llene la plantilla Spreadsheet o suba un archivo Excel.')

        if not rows_to_process:
            raise UserError('No se encontraron filas con datos (Grosor, Alto o Ancho). Asegúrese de haber escrito los valores y que la nube esté en verde.')

        # Limpieza y Procesamiento igual...
        lots_to_delete = self.picking_id.move_line_ids.mapped('lot_id')
        self.picking_id.move_line_ids.unlink()
        for lot in lots_to_delete:
            if not self.env['stock.move.line'].search_count([('lot_id', '=', lot.id), ('picking_id', '!=', self.picking_id.id)]):
                lot.unlink()

        move_lines_created = 0
        next_global_prefix = self._get_next_global_prefix()
        container_counters = {}
        
        for data in rows_to_process:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                move = self.env['stock.move'].create({
                    'name': product.name, 'product_id': product.id, 'product_uom_qty': 0,
                    'product_uom': product.uom_id.id, 'picking_id': self.picking_id.id,
                    'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                })
            cont = data['contenedor'] or 'SN'
            if cont not in container_counters:
                container_counters[cont] = {'prefix': str(next_global_prefix), 'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))}
                next_global_prefix += 1
            prefix = container_counters[cont]['prefix']
            lot_num = container_counters[cont]['next_num']
            lot_name = self._format_lot_name(prefix, lot_num)
            while self.env['stock.lot'].search_count([('name', '=', lot_name), ('product_id', '=', product.id)]):
                lot_num += 1
                lot_name = self._format_lot_name(prefix, lot_num)
            lot = self.env['stock.lot'].create({
                'name': lot_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            self.env['stock.move.line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {'title': 'Éxito', 'message': f'Se crearon {move_lines_created} lotes.', 'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}}}

    def _get_data_from_spreadsheet(self):
        """Lector Forense para Odoo 19: Busca en snapshot, adjuntos y revisiones"""
        doc = self.picking_id.spreadsheet_id
        if not doc: return []

        _logger.info(f"MODO FORENSE: Buscando datos en Doc {doc.id}")

        # 1. Intentar cargar el Snapshot oficial (Odoo 19 guarda aquí el estado final)
        data_json = {}
        try:
            if hasattr(doc, 'get_spreadsheet_snapshot'):
                data_json = doc.get_spreadsheet_snapshot()
                _logger.info("Datos obtenidos de get_spreadsheet_snapshot")
            else:
                # Si spreadsheet_data es binario (base64), lo decodificamos
                raw_data = doc.spreadsheet_data
                if isinstance(raw_data, bytes):
                    raw_data = raw_data.decode('utf-8')
                try:
                    data_json = json.loads(raw_data or '{}')
                except:
                    # Si falla, podría ser Base64 puro
                    data_json = json.loads(base64.b64decode(raw_data).decode('utf-8'))
        except:
            _logger.warning("Fallo al leer spreadsheet_data base.")

        # 2. Si no hay celdas nuevas, buscar en los adjuntos de Odoo (A veces el snapshot vive ahí)
        cells = {}
        if data_json:
            for sheet in data_json.get('sheets', []):
                cells.update(sheet.get('cells', {}))

        # 3. FUSIÓN DE REVISIONES (Búsqueda por cualquier modelo)
        revisions = self.env['spreadsheet.revision'].sudo().search([('res_id', '=', doc.id)], order='id asc')
        if not revisions:
            # Reintentar por el ID del Picking si la hoja se guardó vinculada a él
            revisions = self.env['spreadsheet.revision'].sudo().search([('res_id', '=', self.picking_id.id), ('res_model', '=', 'stock.picking')], order='id asc')

        for rev in revisions:
            try:
                for cmd in json.loads(rev.commands):
                    if cmd.get('type') in ('UPDATE_CELL', 'SET_CELL_CONTENT'):
                        c, r = cmd.get('col'), cmd.get('row')
                        val = cmd.get('content') or cmd.get('cell', {}).get('content')
                        if c is not None and r is not None:
                            cells[f"{c},{r}"] = {'content': val}
            except: continue

        _logger.info(f"CELDAS TOTALES ENCONTRADAS: {len(cells)}")

        # 4. EXTRACCIÓN
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        rows = []
        col_map = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7, 'I': 8}

        for r in range(4, 501):
            row_idx = r - 1
            def gv(col_letter):
                c_idx = col_map[col_letter]
                # Probamos todos los formatos de llave que usa Odoo 19 (A1, 0,3 , y anidado)
                cell = cells.get(f"{c_idx},{row_idx}") or cells.get(f"{col_letter}{r}")
                if not cell:
                    row_data = cells.get(str(row_idx)) or cells.get(row_idx)
                    if isinstance(row_data, dict):
                        cell = row_data.get(str(c_idx)) or row_data.get(c_idx)
                
                if not cell: return None
                return cell.get('content') if cell.get('content') is not None else cell.get('value')

            grosor, alto, ancho = gv('A'), gv('B'), gv('C')
            if grosor is None and alto is None and ancho is None: continue

            try:
                def to_f(v):
                    if v is None or str(v).strip() == '': return 0.0
                    return float(str(v).replace('=', '').replace(',', '.').strip())

                rows.append({
                    'product': default_product,
                    'grosor': to_f(grosor), 'alto': to_f(alto), 'ancho': to_f(ancho),
                    'bloque': str(gv('D') or '').strip(), 'atado': str(gv('E') or '').strip(),
                    'tipo': 'formato' if str(gv('F') or '').lower() == 'formato' else 'placa',
                    'pedimento': str(gv('G') or '').strip(), 'contenedor': str(gv('H') or 'SN').strip(),
                    'ref_proveedor': str(gv('I') or '').strip(),
                })
            except: continue

        _logger.info(f"FILAS VÁLIDAS EXTRAÍDAS: {len(rows)}")
        return rows

    def _get_data_from_excel_file(self):
        try: from openpyxl import load_workbook
        except: raise UserError('Instale openpyxl')
        excel_data = base64.b64decode(self.excel_file)
        wb = load_workbook(io.BytesIO(excel_data), data_only=True)
        rows = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            product_info = ws['B1'].value
            if not product_info: continue
            product_code = str(product_info).split('(')[1].split(')')[0].strip() if '(' in str(product_info) else None
            product = self.env['product.product'].search([('|'), ('default_code', '=', product_code), ('barcode', '=', product_code)], limit=1)
            if not product: product = self.env['product.product'].search([('name', 'ilike', str(product_info).split('(')[0].strip())], limit=1)
            if not product: continue
            for r in range(4, ws.max_row + 1):
                if not ws.cell(row=r, column=1).value and not ws.cell(row=r, column=2).value: continue
                rows.append({
                    'product': product,
                    'grosor': float(ws.cell(row=r, column=1).value or 0),
                    'alto': float(ws.cell(row=r, column=2).value or 0),
                    'ancho': float(ws.cell(row=r, column=3).value or 0),
                    'bloque': str(ws.cell(row=r, column=4).value or ''),
                    'atado': str(ws.cell(row=r, column=5).value or ''),
                    'tipo': 'formato' if str(ws.cell(row=r, column=6).value).lower() == 'formato' else 'placa',
                    'pedimento': str(ws.cell(row=r, column=7).value or ''),
                    'contenedor': str(ws.cell(row=r, column=8).value or 'SN').strip(),
                    'ref_proveedor': str(ws.cell(row=r, column=9).value or ''),
                })
        return rows