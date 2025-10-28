## ./__init__.py
```py
# -*- coding: utf-8 -*-
from . import models
from . import wizard
```

## ./__manifest__.py
```py
# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List',
    'version': '18.0.1.0.0',
    'category': 'Inventory/Inventory',
    'summary': 'Importación Excel de lotes con numeración automática',
    'author': 'Alphaqueb Consulting',
    'website': 'https://alphaqueb.com',
    'depends': ['stock_lot_dimensions'],
    'data': [
        'security/ir.model.access.csv',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}
```

## ./models/__init__.py
```py
# -*- coding: utf-8 -*-
from . import stock_picking
```

## ./models/stock_picking.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import UserError
import io
import base64

class StockPicking(models.Model):
    _inherit = 'stock.picking'
    
    packing_list_file = fields.Binary(string='Packing List', attachment=True)
    packing_list_filename = fields.Char(string='Nombre del archivo')
    has_packing_list = fields.Boolean(string='Tiene Packing List', compute='_compute_has_packing_list', store=True)
    packing_list_imported = fields.Boolean(string='Packing List Importado', default=False)
    
    # Nuevos campos para el Worksheet
    worksheet_file = fields.Binary(string='Worksheet', attachment=True)
    worksheet_filename = fields.Char(string='Nombre del Worksheet')
    
    @api.depends('packing_list_file')
    def _compute_has_packing_list(self):
        for rec in self:
            rec.has_packing_list = bool(rec.packing_list_file)
    
    def action_download_packing_template(self):
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para recepciones')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        products = self.move_ids.mapped('product_id')
        if not products:
            raise UserError('No hay productos en esta recepción')
        
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for product in products:
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            ws['A1'] = 'PRODUCTO:'
            ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:F1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Formato', 'Notas']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            ws.column_dimensions['A'].width = 15
            ws.column_dimensions['B'].width = 12
            ws.column_dimensions['C'].width = 12
            ws.column_dimensions['D'].width = 15
            ws.column_dimensions['E'].width = 15
            ws.column_dimensions['F'].width = 30
            
            for row in range(4, 54):
                for col in range(1, 7):
                    ws.cell(row=row, column=col).border = border
                    ws.cell(row=row, column=col).alignment = Alignment(horizontal='center', vertical='center')
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        excel_data = base64.b64encode(output.read())
        
        filename = f'Packing_List_{self.name}.xlsx'
        self.write({
            'packing_list_file': excel_data,
            'packing_list_filename': filename
        })
        
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=packing_list_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_download_worksheet(self):
        """Generar Worksheet con los lotes ya creados y columnas para medidas reales"""
        self.ensure_one()
        
        if self.picking_type_code != 'incoming':
            raise UserError('Solo disponible para recepciones')
        
        if not self.packing_list_imported:
            raise UserError('Debe importar primero un Packing List')
        
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        wb = Workbook()
        wb.remove(wb.active)
        
        # Obtener productos que tienen move lines con lotes
        products = self.move_line_ids.mapped('product_id')
        
        if not products:
            raise UserError('No hay lotes creados en esta recepción')
        
        header_fill = PatternFill(start_color='366092', end_color='366092', fill_type='solid')
        header_font = Font(color='FFFFFF', bold=True)
        data_fill = PatternFill(start_color='E7E6E6', end_color='E7E6E6', fill_type='solid')
        editable_fill = PatternFill(start_color='FFFF00', end_color='FFFF00', fill_type='solid')
        border = Border(
            left=Side(style='thin'),
            right=Side(style='thin'),
            top=Side(style='thin'),
            bottom=Side(style='thin')
        )
        
        for product in products:
            sheet_name = product.default_code[:31] if product.default_code else f'Prod_{product.id}'[:31]
            ws = wb.create_sheet(title=sheet_name)
            
            # Encabezado del producto
            ws['A1'] = 'PRODUCTO:'
            ws['A1'].font = Font(bold=True)
            ws.merge_cells('B1:F1')
            ws['B1'] = f'{product.name} ({product.default_code or ""})'
            ws['B1'].font = Font(bold=True, color='0000FF')
            ws['B1'].alignment = Alignment(horizontal='left', vertical='center')
            
            # Headers
            headers = ['Nº Lote', 'Grosor (cm)', 'Alto (m)', 'Ancho (m)', 'Bloque', 'Formato', 'Cantidad', 'Alto Real (m)', 'Ancho Real (m)']
            for col_num, header in enumerate(headers, 1):
                cell = ws.cell(row=3, column=col_num)
                cell.value = header
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            
            # Configurar anchos de columna
            ws.column_dimensions['A'].width = 12  # Nº Lote
            ws.column_dimensions['B'].width = 12  # Grosor
            ws.column_dimensions['C'].width = 12  # Alto
            ws.column_dimensions['D'].width = 12  # Ancho
            ws.column_dimensions['E'].width = 15  # Bloque
            ws.column_dimensions['F'].width = 15  # Formato
            ws.column_dimensions['G'].width = 12  # Cantidad
            ws.column_dimensions['H'].width = 15  # Alto Real
            ws.column_dimensions['I'].width = 15  # Ancho Real
            
            # Obtener move lines de este producto
            move_lines = self.move_line_ids.filtered(lambda ml: ml.product_id == product and ml.lot_id)
            
            current_row = 4
            for ml in move_lines:
                lot = ml.lot_id
                
                # Columna A: Número de Lote (solo lectura)
                cell = ws.cell(row=current_row, column=1)
                cell.value = lot.name
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna B: Grosor (solo lectura)
                cell = ws.cell(row=current_row, column=2)
                cell.value = lot.x_grosor
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna C: Alto (solo lectura)
                cell = ws.cell(row=current_row, column=3)
                cell.value = lot.x_alto
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna D: Ancho (solo lectura)
                cell = ws.cell(row=current_row, column=4)
                cell.value = lot.x_ancho
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna E: Bloque (solo lectura)
                cell = ws.cell(row=current_row, column=5)
                cell.value = lot.x_bloque
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna F: Formato (solo lectura)
                cell = ws.cell(row=current_row, column=6)
                cell.value = lot.x_formato
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna G: Cantidad (solo lectura)
                cell = ws.cell(row=current_row, column=7)
                cell.value = ml.qty_done
                cell.fill = data_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna H: Alto Real (editable - VACÍA)
                cell = ws.cell(row=current_row, column=8)
                cell.value = None
                cell.fill = editable_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                # Columna I: Ancho Real (editable - VACÍA)
                cell = ws.cell(row=current_row, column=9)
                cell.value = None
                cell.fill = editable_fill
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
                
                current_row += 1
        
        # IMPORTANTE: Guardar el archivo en el campo worksheet_file
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        excel_data = base64.b64encode(output.read())
        
        filename = f'Worksheet_{self.name}.xlsx'
        
        # Guardar el archivo en el registro
        self.write({
            'worksheet_file': excel_data,
            'worksheet_filename': filename
        })
        
        # Retornar la descarga usando el campo correcto
        return {
            'type': 'ir.actions.act_url',
            'url': f'/web/content?model=stock.picking&id={self.id}&field=worksheet_file&filename={filename}&download=true',
            'target': 'self',
        }
    
    def action_import_packing_list(self):
        self.ensure_one()
        
        return {
            'name': 'Importar Packing List',
            'type': 'ir.actions.act_window',
            'res_model': 'packing.list.import.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_picking_id': self.id}
        }
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        return {
            'name': 'Importar Worksheet',
            'type': 'ir.actions.act_window',
            'res_model': 'worksheet.import.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_picking_id': self.id}
        }```

## ./views/stock_picking_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_picking_form_inherit_packing_import" model="ir.ui.view">
        <field name="name">stock.picking.form.inherit.packing.import</field>
        <field name="model">stock.picking</field>
        <field name="inherit_id" ref="stock.view_picking_form"/>
        <field name="arch" type="xml">
            <field name="partner_id" position="after">
                <field name="has_packing_list" invisible="1"/>
                <field name="packing_list_imported" invisible="1"/>
                <field name="packing_list_file" invisible="1"/>
                <field name="packing_list_filename" invisible="1"/>
                <field name="worksheet_file" invisible="1"/>
                <field name="worksheet_filename" invisible="1"/>
            </field>
            
            <xpath expr="//header/button[@name='action_assign']" position="after">
                <!-- Descargar Plantilla: solo visible si NO se ha importado el Packing List -->
                <button name="action_download_packing_template"
                        string="Descargar Plantilla Packing List"
                        type="object"
                        class="btn-secondary"
                        invisible="state != 'assigned' or picking_type_code != 'incoming' or packing_list_imported"/>
                
                <!-- Cargar Packing List: siempre visible -->
                <button name="action_import_packing_list"
                        string="Cargar Packing List"
                        type="object"
                        class="btn-primary"
                        invisible="state != 'assigned' or picking_type_code != 'incoming'"/>
                
                <!-- Descargar Worksheet: solo visible si YA se importó el Packing List -->
                <button name="action_download_worksheet"
                        string="Descargar Worksheet"
                        type="object"
                        class="btn-info"
                        invisible="state != 'assigned' or picking_type_code != 'incoming' or not packing_list_imported"/>
                
                <!-- Importar Worksheet: solo visible si YA se importó el Packing List -->
                <button name="action_import_worksheet"
                        string="Cargar Worksheet"
                        type="object"
                        class="btn-warning"
                        invisible="state != 'assigned' or picking_type_code != 'incoming' or not packing_list_imported"/>
            </xpath>
        </field>
    </record>
</odoo>```

## ./wizard/__init__.py
```py
# -*- coding: utf-8 -*-
from . import packing_list_import_wizard
from . import worksheet_import_wizard
```

## ./wizard/packing_list_import_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields
from odoo.exceptions import UserError
import base64
import io
import re

class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List Excel'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=True, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def _get_next_lot_number_global(self):
        """Obtener el siguiente número de lote GLOBAL (no por producto)"""
        last_lot = self.env['stock.lot'].search([], order='name desc', limit=1)
        if last_lot:
            match = re.search(r'^(\d+)$', last_lot.name)
            if match:
                return int(match.group(1)) + 1
        return 1
    
    def _format_lot_name(self, number):
        return f'{number:05d}'
    
    def action_import_excel(self):
        self.ensure_one()
        
        if not self.excel_file:
            raise UserError('Debe seleccionar un archivo Excel')
        
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones')
        
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        try:
            excel_data = base64.b64decode(self.excel_file)
            wb = load_workbook(io.BytesIO(excel_data))
        except Exception as e:
            raise UserError(f'Error al leer el archivo Excel: {str(e)}')
        
        move_lines_created = 0
        errors = []
        
        # Obtener el número inicial GLOBAL una sola vez
        next_lot_num = self._get_next_lot_number_global()
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: No se encontró información del producto en B1')
                continue
            
            # Extraer código del producto o usar el nombre de la hoja
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            # Si no hay código en paréntesis, extraer el nombre del producto antes del paréntesis
            if not product_code:
                product_name = str(product_info).split('(')[0].strip()
                # Buscar por nombre
                product = self.env['product.product'].search([
                    ('name', 'ilike', product_name)
                ], limit=1)
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto "{product_name}"')
                    continue
            else:
                # Buscar por código
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
                if not product:
                    errors.append(f'Hoja {sheet_name}: No se encontró el producto con código "{product_code}"')
                    continue
            
            # Buscar o crear el move
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)
            if not move:
                move = self.env['stock.move'].create({
                    'name': product.name,
                    'product_id': product.id,
                    'product_uom_qty': 0,
                    'product_uom': product.uom_id.id,
                    'picking_id': self.picking_id.id,
                    'location_id': self.picking_id.location_id.id,
                    'location_dest_id': self.picking_id.location_dest_id.id,
                })
            
            rows_processed = 0
            for row in range(4, ws.max_row + 1):
                grosor_val = ws.cell(row=row, column=1).value
                alto_val = ws.cell(row=row, column=2).value
                ancho_val = ws.cell(row=row, column=3).value
                
                if grosor_val is None and alto_val is None and ancho_val is None:
                    continue
                
                try:
                    grosor = float(grosor_val) if grosor_val is not None else 0.0
                    alto = float(alto_val) if alto_val is not None else 0.0
                    ancho = float(ancho_val) if ancho_val is not None else 0.0
                except (ValueError, TypeError):
                    continue
                
                bloque_val = ws.cell(row=row, column=4).value
                formato_val = ws.cell(row=row, column=5).value
                
                # Convertir bloque (puede venir como float 567.0)
                if bloque_val is not None:
                    if isinstance(bloque_val, (int, float)):
                        bloque = str(int(bloque_val))
                    else:
                        bloque = str(bloque_val).strip()
                else:
                    bloque = ''
                
                # Formato
                if formato_val is not None:
                    formato = str(formato_val).strip().lower()
                else:
                    formato = 'placa'
                
                # Crear lote con numeración global continua
                lot_name = self._format_lot_name(next_lot_num)
                lot = self.env['stock.lot'].create({
                    'name': lot_name,
                    'product_id': product.id,
                    'company_id': self.picking_id.company_id.id,
                    'x_grosor': grosor,
                    'x_alto': alto,
                    'x_ancho': ancho,
                    'x_bloque': bloque,
                    'x_formato': formato,
                })
                
                qty_done = alto * ancho if (alto and ancho) else 1.0
                
                self.env['stock.move.line'].create({
                    'move_id': move.id,
                    'product_id': product.id,
                    'lot_id': lot.id,
                    'product_uom_id': product.uom_id.id,
                    'location_id': self.picking_id.location_id.id,
                    'location_dest_id': self.picking_id.location_dest_id.id,
                    'picking_id': self.picking_id.id,
                    'qty_done': qty_done,
                    'x_grosor_temp': grosor,
                    'x_alto_temp': alto,
                    'x_ancho_temp': ancho,
                    'x_bloque_temp': bloque,
                    'x_formato_temp': formato,
                })
                
                # Incrementar el contador GLOBAL
                next_lot_num += 1
                move_lines_created += 1
                rows_processed += 1
        
        if move_lines_created == 0:
            error_msg = 'No se encontraron datos válidos en el archivo Excel'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        # IMPORTANTE: Marcar que el Packing List ya fue importado
        self.picking_id.write({'packing_list_imported': True})
        
        message = f'Se crearon {move_lines_created} lotes con numeración automática'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación Exitosa!',
                'message': message,
                'type': 'success',
                'sticky': False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }```

## ./wizard/packing_list_import_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_packing_list_import_wizard_form" model="ir.ui.view">
        <field name="name">packing.list.import.wizard.form</field>
        <field name="model">packing.list.import.wizard</field>
        <field name="arch" type="xml">
            <form>
                <sheet>
                    <group>
                        <field name="picking_id" readonly="1"/>
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename"/>
                    </group>
                    <group>
                        <div class="alert alert-info">
                            <p><strong>Instrucciones:</strong></p>
                            <ul>
                                <li>Seleccione el archivo Excel que descargó previamente</li>
                                <li>El archivo debe contener una hoja por producto</li>
                                <li>Complete los datos de grosor, alto, ancho, bloque y formato</li>
                                <li>Los lotes se crearán automáticamente con numeración secuencial</li>
                            </ul>
                        </div>
                    </group>
                </sheet>
                <footer>
                    <button string="Importar" name="action_import_excel" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>
```

## ./wizard/worksheet_import_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields
from odoo.exceptions import UserError
import base64
import io

class WorksheetImportWizard(models.TransientModel):
    _name = 'worksheet.import.wizard'
    _description = 'Importar Worksheet Excel'
    
    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=True, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')
    
    def action_import_worksheet(self):
        self.ensure_one()
        
        if not self.excel_file:
            raise UserError('Debe seleccionar un archivo Excel')
        
        if self.picking_id.picking_type_code != 'incoming':
            raise UserError('Solo se puede importar en recepciones')
        
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise UserError('Instale openpyxl: pip install openpyxl --break-system-packages')
        
        try:
            excel_data = base64.b64decode(self.excel_file)
            wb = load_workbook(io.BytesIO(excel_data))
        except Exception as e:
            raise UserError(f'Error al leer el archivo Excel: {str(e)}')
        
        lines_updated = 0
        errors = []
        
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            
            # Extraer información del producto desde B1
            product_info = ws['B1'].value
            if not product_info:
                errors.append(f'Hoja {sheet_name}: No se encontró información del producto en B1')
                continue
            
            # Extraer código del producto
            product_code = None
            if '(' in str(product_info) and ')' in str(product_info):
                code_part = str(product_info).split('(')[1].split(')')[0].strip()
                if code_part:
                    product_code = code_part
            
            # Buscar producto
            if not product_code:
                product_name = str(product_info).split('(')[0].strip()
                product = self.env['product.product'].search([
                    ('name', 'ilike', product_name)
                ], limit=1)
            else:
                product = self.env['product.product'].search([
                    '|', ('default_code', '=', product_code), ('barcode', '=', product_code)
                ], limit=1)
            
            if not product:
                errors.append(f'Hoja {sheet_name}: No se encontró el producto')
                continue
            
            # Procesar filas (empezando desde fila 4)
            for row in range(4, ws.max_row + 1):
                # Leer número de lote de la columna A
                lot_name_val = ws.cell(row=row, column=1).value
                
                if lot_name_val is None:
                    continue
                
                # Formatear el nombre del lote
                if isinstance(lot_name_val, (int, float)):
                    lot_name = f'{int(lot_name_val):05d}'
                else:
                    lot_name = str(lot_name_val).strip()
                
                # Buscar el lote existente
                lot = self.env['stock.lot'].search([
                    ('name', '=', lot_name),
                    ('product_id', '=', product.id)
                ], limit=1)
                
                if not lot:
                    continue
                
                # Leer las nuevas medidas (columnas H=Alto Real, I=Ancho Real)
                alto_real_val = ws.cell(row=row, column=8).value  # Columna H
                ancho_real_val = ws.cell(row=row, column=9).value  # Columna I
                
                # Si hay medidas nuevas, actualizar
                if alto_real_val is not None or ancho_real_val is not None:
                    try:
                        alto_real = float(alto_real_val) if alto_real_val is not None else lot.x_alto
                        ancho_real = float(ancho_real_val) if ancho_real_val is not None else lot.x_ancho
                        
                        # Actualizar el lote con las medidas reales
                        lot.write({
                            'x_alto': alto_real,
                            'x_ancho': ancho_real,
                        })
                        
                        # Actualizar el move line correspondiente
                        move_line = self.env['stock.move.line'].search([
                            ('picking_id', '=', self.picking_id.id),
                            ('lot_id', '=', lot.id),
                            ('product_id', '=', product.id)
                        ], limit=1)
                        
                        if move_line:
                            # Recalcular qty_done con las nuevas medidas
                            qty_done = alto_real * ancho_real if (alto_real and ancho_real) else move_line.qty_done
                            
                            move_line.write({
                                'qty_done': qty_done,
                                'x_alto_temp': alto_real,
                                'x_ancho_temp': ancho_real,
                            })
                        
                        lines_updated += 1
                    
                    except (ValueError, TypeError) as e:
                        errors.append(f'Hoja {sheet_name}, Fila {row}: Error en las medidas - {str(e)}')
                        continue
        
        if lines_updated == 0:
            error_msg = 'No se actualizaron medidas. Verifique que el archivo contenga lotes válidos con medidas reales.'
            if errors:
                error_msg += '\n\nDetalles:\n' + '\n'.join(errors)
            raise UserError(error_msg)
        
        message = f'Se actualizaron {lines_updated} lotes con las medidas reales del Worksheet'
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': '¡Importación de Worksheet Exitosa!',
                'message': message,
                'type': 'success',
                'sticky': False,
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }```

## ./wizard/worksheet_import_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_worksheet_import_wizard_form" model="ir.ui.view">
        <field name="name">worksheet.import.wizard.form</field>
        <field name="model">worksheet.import.wizard</field>
        <field name="arch" type="xml">
            <form>
                <sheet>
                    <group>
                        <field name="picking_id" readonly="1"/>
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename"/>
                    </group>
                    <group>
                        <div class="alert alert-info">
                            <p><strong>Instrucciones para Worksheet:</strong></p>
                            <ul>
                                <li>Este archivo contiene los lotes ya creados desde el Packing List</li>
                                <li>Las cantidades y lotes NO se modificarán</li>
                                <li>Complete ÚNICAMENTE las columnas "Alto Real (m)" y "Ancho Real (m)"</li>
                                <li>Si no coloca medidas, se mantendrán las del Packing List original</li>
                                <li>Si coloca medidas nuevas, se actualizarán en los lotes existentes</li>
                            </ul>
                        </div>
                    </group>
                </sheet>
                <footer>
                    <button string="Importar Worksheet" name="action_import_worksheet" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>```

