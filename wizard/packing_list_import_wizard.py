# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging
import pprint

_logger = logging.getLogger(__name__)

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    # ---------------------------------------------------------
    # LÓGICA DE NUMERACIÓN (Mantenida por estabilidad)
    # ---------------------------------------------------------
    def _get_next_global_prefix(self):
        self.env.cr.execute("""
            SELECT CAST(SUBSTRING(sl.name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name ~ '^[0-9]+-[0-9]+$' AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY prefix_num DESC LIMIT 1
        """, (self.picking_id.company_id.id,))
        result = self.env.cr.fetchone()
        return (result[0] + 1) if result and result[0] else 1
    
    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute("""
            SELECT sl.name FROM stock_lot sl
            INNER JOIN stock_move_line sml ON sml.lot_id = sl.id
            INNER JOIN stock_picking sp ON sp.id = sml.picking_id
            WHERE sl.name LIKE %s AND sp.state = 'done' AND sp.company_id = %s
            ORDER BY CAST(SUBSTRING(sl.name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1
        """, (f'{prefix}-%', self.picking_id.company_id.id))
        result = self.env.cr.fetchone()
        if result:
            try: return int(result[0].split('-')[1]) + 1
            except: pass
        return 1
    
    def _format_lot_name(self, prefix, number):
        return f'{prefix}-{number:02d}' if number < 100 else f'{prefix}-{number}'

    # ---------------------------------------------------------
    # ACCIÓN DE IMPORTACIÓN (EL MOTOR)
    # ---------------------------------------------------------
    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=" * 60)
        _logger.info("=== INICIANDO PROCESAMIENTO DE PACKING LIST ===")
        _logger.info("=" * 60)
        
        rows_to_process = []
        
        # Si hay un archivo manual, tiene prioridad total
        if self.excel_file:
            _logger.info("MODO: Archivo Excel manual detectado")
            rows_to_process = self._get_data_from_excel_file()
        # Si no, intentamos leer la hoja de cálculo
        elif self.picking_id.spreadsheet_id:
            _logger.info("MODO: Spreadsheet nativo de Odoo detectado")
            _logger.info(f"  Spreadsheet ID: {self.picking_id.spreadsheet_id.id}")
            _logger.info(f"  Spreadsheet Name: {self.picking_id.spreadsheet_id.name}")
            rows_to_process = self._get_data_from_spreadsheet()
        else:
            raise UserError('No hay datos. Cargue un archivo Excel o llene la plantilla PL.')

        _logger.info(f"RESULTADO: {len(rows_to_process)} filas detectadas para procesar")
        
        if not rows_to_process:
            raise UserError('No se detectaron datos en las filas. Revise los logs del servidor para más detalles sobre la estructura del spreadsheet.')

        # Limpieza de líneas previas
        _logger.info("Limpiando líneas de movimiento previas...")
        self.picking_id.move_line_ids.unlink()

        # Procesamiento
        move_lines_created = 0
        next_global_prefix = self._get_next_global_prefix()
        container_counters = {}
        
        for idx, data in enumerate(rows_to_process):
            _logger.info(f"Procesando fila {idx + 1}: {data}")
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                _logger.warning(f"  No se encontró movimiento para producto: {product.name}")
                continue

            cont = data['contenedor'] or 'SN'
            if cont not in container_counters:
                container_counters[cont] = {
                    'prefix': str(next_global_prefix),
                    'next_num': self._get_next_lot_number_for_prefix(str(next_global_prefix))
                }
                next_global_prefix += 1

            prefix = container_counters[cont]['prefix']
            lot_num = container_counters[cont]['next_num']
            lot_name = self._format_lot_name(prefix, lot_num)
            
            # Evitar duplicados
            while self.env['stock.lot'].search_count([('name', '=', lot_name), ('product_id', '=', product.id)]):
                lot_num += 1
                lot_name = self._format_lot_name(prefix, lot_num)

            lot = self.env['stock.lot'].create({
                'name': lot_name, 'product_id': product.id, 'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'], 'x_alto': data['alto'], 'x_ancho': data['ancho'],
                'x_bloque': data['bloque'], 'x_atado': data['atado'], 'x_tipo': data['tipo'],
                'x_pedimento': data['pedimento'], 'x_contenedor': cont, 'x_referencia_proveedor': data['ref_proveedor'],
            })
            _logger.info(f"  Lote creado: {lot_name}")
            
            self.env['stock.move.line'].create({
                'move_id': move.id, 'product_id': product.id, 'lot_id': lot.id, 'qty_done': data['alto'] * data['ancho'] or 1.0,
                'location_id': self.picking_id.location_id.id, 'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
            })
            container_counters[cont]['next_num'] = lot_num + 1
            move_lines_created += 1

        self.picking_id.write({'packing_list_imported': True})
        _logger.info(f"=== PROCESO FINALIZADO: {move_lines_created} lotes creados ===")
        
        return {'type': 'ir.actions.client', 'tag': 'display_notification', 'params': {
            'title': 'Éxito', 'message': f'Importación finalizada: {move_lines_created} lotes creados.',
            'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
        }}

    # ---------------------------------------------------------
    # LECTOR SPREADSHEET - VERSIÓN DEBUG EXHAUSTIVO
    # ---------------------------------------------------------
    def _get_data_from_spreadsheet(self):
        doc = self.picking_id.spreadsheet_id
        
        _logger.info("-" * 50)
        _logger.info("INICIANDO LECTURA DE SPREADSHEET")
        _logger.info("-" * 50)
        
        # =====================================================
        # PASO 1: Obtener data cruda del documento
        # =====================================================
        raw_data = None
        
        # Intentar múltiples campos donde Odoo 19 puede guardar la data
        possible_fields = ['spreadsheet_data', 'raw', 'data', 'datas']
        
        for field_name in possible_fields:
            if hasattr(doc, field_name):
                field_value = getattr(doc, field_name)
                if field_value:
                    _logger.info(f"Campo '{field_name}' encontrado con datos")
                    _logger.info(f"  Tipo: {type(field_value)}")
                    if isinstance(field_value, bytes):
                        _logger.info(f"  Longitud (bytes): {len(field_value)}")
                        raw_data = field_value.decode('utf-8')
                    elif isinstance(field_value, str):
                        _logger.info(f"  Longitud (str): {len(field_value)}")
                        raw_data = field_value
                    else:
                        _logger.info(f"  Valor: {field_value}")
                    break
            else:
                _logger.info(f"Campo '{field_name}' NO existe en el documento")
        
        if not raw_data:
            _logger.error("NO SE ENCONTRÓ DATA EN NINGÚN CAMPO DEL DOCUMENTO")
            return []
        
        # =====================================================
        # PASO 2: Parsear JSON
        # =====================================================
        try:
            data_json = json.loads(raw_data)
            _logger.info(f"JSON parseado correctamente")
            _logger.info(f"  Claves de nivel raíz: {list(data_json.keys())}")
        except json.JSONDecodeError as e:
            _logger.error(f"Error parseando JSON: {e}")
            _logger.error(f"Primeros 500 caracteres del raw_data: {raw_data[:500]}")
            return []
        
        # =====================================================
        # PASO 3: Explorar estructura de sheets
        # =====================================================
        sheets = data_json.get('sheets', [])
        _logger.info(f"Número de sheets: {len(sheets)}")
        
        if not sheets:
            _logger.error("No hay sheets en el documento")
            return []
        
        # Analizar primer sheet
        sheet = sheets[0]
        _logger.info(f"Analizando Sheet 0:")
        _logger.info(f"  Claves: {list(sheet.keys())}")
        _logger.info(f"  ID: {sheet.get('id')}")
        _logger.info(f"  Name: {sheet.get('name')}")
        
        # =====================================================
        # PASO 4: Explorar estructura de celdas
        # =====================================================
        cells = sheet.get('cells', {})
        _logger.info(f"Estructura de 'cells':")
        _logger.info(f"  Tipo: {type(cells)}")
        _logger.info(f"  Cantidad de entradas: {len(cells)}")
        
        if cells:
            # Mostrar primeras 20 celdas para entender la estructura
            _logger.info("  Primeras 20 entradas de cells:")
            for i, (key, value) in enumerate(cells.items()):
                if i >= 20:
                    _logger.info("  ... (truncado)")
                    break
                _logger.info(f"    [{key}] = {value}")
        
        # =====================================================
        # PASO 5: Buscar revisiones/historial de cambios
        # =====================================================
        _logger.info("-" * 30)
        _logger.info("BUSCANDO REVISIONES EN LA BASE DE DATOS")
        _logger.info("-" * 30)
        
        # Buscar en spreadsheet.revision si existe
        try:
            revision_model = self.env['spreadsheet.revision'].sudo()
            # Buscar por múltiples criterios
            all_revisions = revision_model.search([])
            _logger.info(f"Total revisiones en sistema: {len(all_revisions)}")
            
            # Buscar específicamente para este documento
            doc_revisions = revision_model.search([('res_id', '=', doc.id)])
            _logger.info(f"Revisiones para documento {doc.id}: {len(doc_revisions)}")
            
            # Buscar por res_model
            model_revisions = revision_model.search([('res_model', '=', 'documents.document')])
            _logger.info(f"Revisiones para modelo 'documents.document': {len(model_revisions)}")
            
            # Si hay revisiones, mostrar contenido
            for rev in doc_revisions[:5]:
                _logger.info(f"  Revision ID {rev.id}:")
                _logger.info(f"    res_model: {rev.res_model if hasattr(rev, 'res_model') else 'N/A'}")
                _logger.info(f"    res_id: {rev.res_id if hasattr(rev, 'res_id') else 'N/A'}")
                if hasattr(rev, 'commands'):
                    _logger.info(f"    commands (primeros 500 chars): {str(rev.commands)[:500]}")
                    
        except Exception as e:
            _logger.warning(f"Error buscando revisiones: {e}")
        
        # =====================================================
        # PASO 6: Intentar diferentes formatos de clave de celda
        # =====================================================
        _logger.info("-" * 30)
        _logger.info("PROBANDO DIFERENTES FORMATOS DE ACCESO A CELDAS")
        _logger.info("-" * 30)
        
        # Formato 1: "A4", "B4" (notación A1)
        test_keys_a1 = ["A4", "B4", "C4", "A5", "B5"]
        for key in test_keys_a1:
            val = cells.get(key)
            _logger.info(f"  Formato A1 - cells['{key}']: {val}")
        
        # Formato 2: "col,row" donde col y row son índices numéricos
        test_keys_numeric = ["0,3", "1,3", "2,3", "0,4", "1,4"]
        for key in test_keys_numeric:
            val = cells.get(key)
            _logger.info(f"  Formato numérico - cells['{key}']: {val}")
        
        # Formato 3: Tupla o lista
        test_keys_tuple = [(0, 3), (1, 3), (2, 3)]
        for key in test_keys_tuple:
            val = cells.get(key) or cells.get(str(key))
            _logger.info(f"  Formato tupla - cells[{key}]: {val}")
        
        # Formato 4: Celdas anidadas por fila
        # Odoo a veces usa: cells[row_index][col_index]
        if isinstance(cells, dict):
            for row_key in ["3", "4", "5", 3, 4, 5]:
                row_data = cells.get(row_key)
                if row_data:
                    _logger.info(f"  Fila como clave - cells[{row_key}]: {type(row_data)} = {row_data}")
        
        # =====================================================
        # PASO 7: Analizar todas las claves de celdas existentes
        # =====================================================
        _logger.info("-" * 30)
        _logger.info("ANÁLISIS DE PATRONES DE CLAVES")
        _logger.info("-" * 30)
        
        if cells:
            all_keys = list(cells.keys())
            _logger.info(f"Todas las claves ({len(all_keys)}): {all_keys[:50]}")
            
            # Detectar patrón
            sample_key = all_keys[0] if all_keys else None
            if sample_key:
                _logger.info(f"Ejemplo de clave: '{sample_key}' (tipo: {type(sample_key)})")
                
                # Determinar formato
                if isinstance(sample_key, str):
                    if ',' in sample_key:
                        _logger.info("PATRÓN DETECTADO: 'col,row' (numérico)")
                    elif sample_key[0].isalpha():
                        _logger.info("PATRÓN DETECTADO: 'A1' (notación estándar)")
                    elif sample_key.isdigit():
                        _logger.info("PATRÓN DETECTADO: Índices de fila")
        
        # =====================================================
        # PASO 8: Leer datos usando el patrón detectado
        # =====================================================
        _logger.info("-" * 30)
        _logger.info("EXTRAYENDO DATOS DE FILAS")
        _logger.info("-" * 30)
        
        rows = []
        default_product = self.picking_id.move_ids.mapped('product_id')[:1]
        
        if not default_product:
            _logger.error("No hay producto por defecto (no hay movimientos)")
            return []
        
        _logger.info(f"Producto por defecto: {default_product.name} (ID: {default_product.id})")
        
        # Detectar el formato de clave
        all_keys = list(cells.keys()) if cells else []
        key_format = None
        
        if all_keys:
            sample = all_keys[0]
            if isinstance(sample, str):
                if ',' in sample:
                    key_format = 'numeric_comma'  # "0,3"
                elif sample[0].isalpha():
                    key_format = 'a1'  # "A4"
                else:
                    key_format = 'unknown'
        
        _logger.info(f"Formato de clave detectado: {key_format}")
        
        # Mapeo de columnas
        col_map = {
            'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4,
            'F': 5, 'G': 6, 'H': 7, 'I': 8, 'J': 9
        }
        
        def get_cell_value(col_letter, row_num):
            """Obtiene el valor de una celda probando múltiples formatos."""
            col_idx = col_map.get(col_letter, 0)
            row_idx = row_num - 1  # A1 = row 1, pero índice 0
            
            # Probar diferentes formatos de clave
            possible_keys = [
                f"{col_letter}{row_num}",           # A4
                f"{col_idx},{row_idx}",             # 0,3
                f"{col_idx},{row_num}",             # 0,4
                (col_idx, row_idx),                 # (0, 3)
            ]
            
            for key in possible_keys:
                cell = cells.get(key)
                if cell is not None:
                    if isinstance(cell, dict):
                        return cell.get('content') or cell.get('value') or cell.get('text')
                    return cell
            
            return None
        
        # Procesar filas desde la 4 hasta la 200
        for row_num in range(4, 201):
            grosor = get_cell_value('A', row_num)
            alto = get_cell_value('B', row_num)
            ancho = get_cell_value('C', row_num)
            
            # Log para primeras 10 filas
            if row_num <= 13:
                _logger.info(f"Fila {row_num}: grosor={grosor}, alto={alto}, ancho={ancho}")
            
            # Si no hay datos en las 3 primeras columnas, la fila está vacía
            if grosor is None and alto is None and ancho is None:
                continue
            
            try:
                row_data = {
                    'product': default_product,
                    'grosor': float(str(grosor or 0).replace(',', '.')),
                    'alto': float(str(alto or 0).replace(',', '.')),
                    'ancho': float(str(ancho or 0).replace(',', '.')),
                    'bloque': str(get_cell_value('D', row_num) or '').strip(),
                    'atado': str(get_cell_value('E', row_num) or '').strip(),
                    'tipo': 'formato' if str(get_cell_value('F', row_num) or '').lower() == 'formato' else 'placa',
                    'pedimento': str(get_cell_value('G', row_num) or '').strip(),
                    'contenedor': str(get_cell_value('H', row_num) or 'SN').strip(),
                    'ref_proveedor': str(get_cell_value('I', row_num) or '').strip(),
                }
                rows.append(row_data)
                _logger.info(f"  -> Fila {row_num} agregada: {row_data}")
            except Exception as e:
                _logger.warning(f"Error procesando fila {row_num}: {e}")
                continue
        
        _logger.info(f"Total filas extraídas: {len(rows)}")
        return rows

    # ---------------------------------------------------------
    # LECTOR EXCEL (EL MÉTODO INFALIBLE)
    # ---------------------------------------------------------
    def _get_data_from_excel_file(self):
        try:
            from openpyxl import load_workbook
        except:
            raise UserError('Instale openpyxl')
        
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info: continue
            # Buscar producto por código en paréntesis o nombre
            p_code = str(p_info).split('(')[1].split(')')[0].strip() if '(' in str(p_info) else ''
            product = self.env['product.product'].search(['|', ('default_code', '=', p_code), ('name', '=', str(p_info).split('(')[0].strip())], limit=1)
            if not product: continue

            for r in range(4, sheet.max_row + 1):
                if not sheet.cell(r, 1).value and not sheet.cell(r, 2).value: continue
                rows.append({
                    'product': product,
                    'grosor': float(sheet.cell(r, 1).value or 0),
                    'alto': float(sheet.cell(r, 2).value or 0),
                    'ancho': float(sheet.cell(r, 3).value or 0),
                    'bloque': str(sheet.cell(r, 4).value or ''),
                    'atado': str(sheet.cell(r, 5).value or ''),
                    'tipo': 'formato' if str(sheet.cell(r, 6).value).lower() == 'formato' else 'placa',
                    'pedimento': str(sheet.cell(r, 7).value or ''),
                    'contenedor': str(sheet.cell(r, 8).value or 'SN').strip(),
                    'ref_proveedor': str(sheet.cell(r, 9).value or ''),
                })
        return rows