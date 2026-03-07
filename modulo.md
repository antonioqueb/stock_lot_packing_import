## ./__init__.py
```py
# -*- coding: utf-8 -*-
from . import models
from . import wizard
from . import controllers
```

## ./__manifest__.py
```py
# -*- coding: utf-8 -*-
{
    'name': 'Importación Masiva de Lotes via Packing List & Portal Proveedor',
    'version': '19.0.2.1.0',
    'depends': ['stock', 'purchase', 'stock_lot_dimensions', 'documents', 'documents_spreadsheet', 'web'],
    'author': 'Alphaqueb Consulting',
    'category': 'Inventory/Inventory',
    'data': [
        'security/stock_lot_hold_security.xml',
        'security/ir.model.access.csv',
        'wizard/packing_list_import_wizard_views.xml',
        'wizard/worksheet_import_wizard_views.xml',
        'wizard/supplier_link_wizard_views.xml',
        'views/purchase_order_views.xml',
        'views/stock_picking_views.xml',
        'views/supplier_portal_templates.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'stock_lot_packing_import/static/src/scss/supplier_portal.scss',
            # ELIMINADO: 'stock_lot_packing_import/static/src/xml/supplier_portal.xml',
            'stock_lot_packing_import/static/src/js/supplier_portal.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}```

## ./controllers/__init__.py
```py
# -*- coding: utf-8 -*-
from . import supplier_portal```

## ./controllers/supplier_portal.py
```py
# -*- coding: utf-8 -*-
import json
import base64
from odoo import http
from odoo.http import request
from markupsafe import Markup
import logging

_logger = logging.getLogger(__name__)

class SupplierPortalController(http.Controller):

    def _get_picking_moves_for_portal(self, picking):
        moves = False
        if hasattr(picking, "move_ids_without_package"):
            moves = picking.move_ids_without_package
        if not moves:
            moves = picking.move_ids
        return moves.filtered(lambda m: m.state != "cancel")

    def _build_products_payload(self, picking):
        moves = self._get_picking_moves_for_portal(picking)
        bucket = {}
        for move in moves:
            product = move.product_id
            if not product: continue
            pid = product.id
            if pid not in bucket:
                # --- CAMBIO: Obtener tipo de unidad desde el template ---
                u_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
                
                bucket[pid] = {
                    "id": pid,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (move.product_uom and move.product_uom.name) or "",
                    "unit_type": u_type, # Nuevo campo para JS
                }
            bucket[pid]["qty_ordered"] += (move.product_uom_qty or 0.0)
        products = list(bucket.values())
        products.sort(key=lambda x: (x.get("name") or "").lower())
        return products

    # ... (El resto del archivo view_supplier_portal y submit_pl_data queda IGUAL) ...
    @http.route('/supplier/pl/<string:token>', type='http', auth='public', website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        # ... (código existente) ...
        # Asegúrate de copiar todo el método view_supplier_portal original si sobrescribes el archivo
        # Solo asegúrate de que use self._build_products_payload actualizado.
        return super().view_supplier_portal(token, **kwargs) if False else self._view_supplier_portal_impl(token)

    # Helper interno para no repetir código en el ejemplo (usar tu implementación actual)
    def _view_supplier_portal_impl(self, token):
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)
        if not access: return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired: return request.render('stock_lot_packing_import.portal_expired')

        if access.purchase_id:
            po = access.purchase_id
            pickings = po.picking_ids.filtered(lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel'))
            if pickings:
                target_picking = pickings.sorted(key=lambda p: p.id, reverse=True)[0]
                if access.picking_id.id != target_picking.id:
                    access.write({'picking_id': target_picking.id})

        picking = access.picking_id
        if not picking: return request.render('stock_lot_packing_import.portal_not_found')

        products = self._build_products_payload(picking) # Aquí ya trae unit_type
        if not products: products = []

        existing_rows = []
        if picking.spreadsheet_id:
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet: {e}")
                existing_rows = []

        header_data = {
            'invoice_number': picking.supplier_invoice_number or "",
            'shipment_date': str(picking.supplier_shipment_date) if picking.supplier_shipment_date else "",
            'proforma_number': picking.supplier_proforma_number or "",
            'bl_number': picking.supplier_bl_number or "",
            'origin': picking.supplier_origin or "",
            'destination': picking.supplier_destination or "",
            'country_origin': picking.supplier_country_origin or "",
            'vessel': picking.supplier_vessel or "",
            'incoterm': picking.supplier_incoterm_payment or "",
            'payment_terms': picking.supplier_payment_terms or "",
            'merchandise_desc': picking.supplier_merchandise_desc or "",
            'container_no': picking.supplier_container_no or "",
            'seal_no': picking.supplier_seal_no or "",
            'container_type': picking.supplier_container_type or "",
            'total_packages': picking.supplier_total_packages or 0,
            'gross_weight': picking.supplier_gross_weight or 0.0,
            'volume': picking.supplier_volume or 0.0,
            'status': picking.supplier_status or ""
        }

        full_data = {
            'products': products,
            'existing_rows': existing_rows,
            'header': header_data,
            'token': token,
            'poName': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
            'pickingName': picking.name or "",
            'companyName': picking.company_id.name or ""
        }

        values = {
            'picking': picking,
            'portal_json': Markup(json.dumps(full_data, ensure_ascii=False)),
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', values)

    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows, header=None, files=None):
        access = request.env['stock.picking.supplier.access'].sudo().search([('access_token', '=', token)], limit=1)
        if not access or access.is_expired:
            return {'success': False, 'message': 'Token inválido.'}
        
        picking = access.picking_id
        if not picking: return {'success': False, 'message': 'Picking no encontrado.'}
        if picking.state in ('done', 'cancel'): 
            return {'success': False, 'message': 'La recepción ya fue procesada.'}

        try:
            picking.sudo().update_packing_list_from_portal(rows, header_data=header)
            if files:
                picking.sudo()._process_portal_attachments(files)
            return {'success': True}
        except Exception as e:
            _logger.exception("Error en submit_pl_data")
            return {'success': False, 'message': str(e)}```

## ./models/__init__.py
```py
# -*- coding: utf-8 -*-
from . import stock_picking
from . import purchase_order
from . import supplier_access```

## ./models/purchase_order.py
```py
# -*- coding: utf-8 -*-
from datetime import timedelta
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    x_qty_solicitada_original = fields.Float(
        string="Cant. Solicitada Original",
        digits='Product Unit of Measure',
        copy=False,
        readonly=True,
        help="Se congela la primera vez que se procesa el Packing List.",
    )
    x_qty_embarcada = fields.Float(
        string="Cant. Embarcada (PL)",
        digits='Product Unit of Measure',
        copy=False,
        readonly=True,
        help="Cantidad según Packing List. Es la cantidad a pagar al proveedor.",
    )


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    supplier_access_ids = fields.One2many(
        'stock.picking.supplier.access', 'purchase_id', string="Links Proveedor"
    )

    def _get_target_incoming_picking_for_supplier_portal(self):
        """Devuelve la recepción 'vigente' para el portal:
        - Incoming
        - No done/cancel
        - Preferimos la más reciente (backorder actual suele ser el último).
        """
        self.ensure_one()

        pickings = self.picking_ids.filtered(
            lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
        )
        if not pickings:
            return False

        return pickings.sorted(key=lambda p: p.id, reverse=True)[0]

    def _get_or_create_supplier_access(self, target_picking):
        """Garantiza 1 acceso por PO (token estable).
        - Si ya existe, NO cambia token.
        - Actualiza picking_id a la recepción vigente.
        - Renueva expiración (opcional: aquí se renueva siempre).
        """
        self.ensure_one()

        access = self.env['stock.picking.supplier.access'].sudo().search(
            [('purchase_id', '=', self.id)], limit=1
        )

        vals_update = {}
        if target_picking and (not access or access.picking_id.id != target_picking.id):
            vals_update['picking_id'] = target_picking.id

        vals_update['expiration_date'] = fields.Datetime.now() + timedelta(days=15)

        if access:
            if vals_update:
                access.write(vals_update)
            return access

        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        return self.env['stock.picking.supplier.access'].sudo().create({
            'purchase_id': self.id,
            'picking_id': target_picking.id,
            'expiration_date': vals_update['expiration_date'],
        })

    def action_open_supplier_link_wizard(self):
        """Abre wizard para copiar el link (y de paso asegura el access único por PO)."""
        self.ensure_one()

        if self.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de enviar el link al proveedor."))

        target_picking = self._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        self._get_or_create_supplier_access(target_picking)

        return {
            'type': 'ir.actions.act_window',
            'name': _('Link Portal Proveedor'),
            'res_model': 'purchase.supplier.portal.link.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_purchase_id': self.id,
            }
        }```

## ./models/stock_picking.py
```py
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
            b1_val = cells.get("B1", {}).get("content", "")
            
            if not b1_val: continue

            p_ref = str(b1_val).split('(')[0].strip()
            product = self.env['product.product'].search([
                '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
            ], limit=1)
            
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
                
                # Datos comunes base (Grosor siempre es A)
                grosor = get_val("A")
                
                # Inicializar variables
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
                    # A=Grosor, B=Alto, C=Ancho, D=Peso, E=Notas, F=Bloque, G=Placa, H=Atado, I=Grupo, J=Pedimento, K=Contenedor, L=RefProv
                    alto = get_val("B", float)
                    ancho = get_val("C", float)
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
            b1_val = cells.get("B1", {}).get("content", "")
            if b1_val:
                p_ref = str(b1_val).split('(')[0].strip()
                product = self.env['product.product'].search([
                    '|', ('name', 'ilike', p_ref), ('default_code', 'ilike', p_ref)
                ], limit=1)
                
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

                # Columna A siempre es Grosor
                set_c("A", row.get('grosor', ''))
                
                # --- ESCRITURA CON RECORRIDO ---
                if unit_type == 'Placa':
                    # PLACA: Estructura Completa
                    # B=Alto, C=Ancho, D=Peso, E=Notas, F=Bloque, G=Placa, H=Atado, I=Grupo, J=Pedimento, K=Contenedor, L=RefProv
                    set_c("B", row.get('alto', ''))
                    set_c("C", row.get('ancho', ''))
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
                    # B=Cantidad. C=Peso (Antes D). D=Notas (Antes E)...
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

    def action_open_packing_list_spreadsheet(self):
        self.ensure_one()
        if self.picking_type_code != 'incoming' and not self.packing_list_imported: 
            raise UserError('Solo disponible para Recepciones o Transferencias con Packing List ya cargado.')
        
        if not self.spreadsheet_id:
            products = self.move_ids.mapped('product_id')
            if not products: raise UserError('Sin productos.')

            folder = self.env['documents.document'].search([('type', '=', 'folder')], limit=1)
            
            # --- DEFINICIÓN DE COLUMNAS SIN ESPACIOS VACÍOS ---
            # Cabeceras Base (se moverán según el tipo)
            # Orden: [Variable Dimensión], Peso, Notas, Bloque, Placa, Atado, Grupo, Pedimento, Contenedor, RefProv, RefInt
            common_headers_suffix = ['Peso (kg)', 'Notas', 'Bloque', 'No. Placa', 'Atado', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Ref. Interna']
            
            sheets = []
            for index, product in enumerate(products):
                cells = {}
                cells["A1"] = self._make_cell("PRODUCTO:")
                p_str = f"{product.name} ({product.default_code or ''})"
                cells["B1"] = self._make_cell(p_str)
                
                unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
                
                # Cabeceras Dinámicas
                headers = []
                # Columna A siempre es Grosor
                
                if unit_type == 'Placa':
                    # Placa: [Grosor, Alto, Ancho] + Comunes
                    headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)'] + common_headers_suffix
                else:
                    # Pieza: [Grosor, Cantidad] + Comunes
                    # Aquí se elimina la columna vacía. "Peso" pasa a ser la columna C.
                    headers = ['Grosor (cm)', 'Cantidad'] + common_headers_suffix

                for i, header in enumerate(headers):
                    col_letter = self._get_col_letter(i)
                    if header: 
                        cells[f"{col_letter}3"] = self._make_cell(header, style=1)

                sheet_name = (product.default_code or product.name)[:31]
                count = 1
                base_name = sheet_name
                while any(s['name'] == sheet_name for s in sheets):
                    sheet_name = f"{base_name[:28]}_{count}"
                    count += 1

                sheets.append({
                    "id": f"pl_sheet_{product.id}",
                    "name": sheet_name,
                    "cells": cells,
                    "colNumber": 14, 
                    "rowNumber": 250,
                    "isProtected": True,
                    "protectedRanges": [{"range": "A4:N250", "isProtected": False}] 
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
            
            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
            common_headers_suffix = ['Peso (kg)', 'Color', 'Bloque', 'No. Placa', 'Atado', 'Grupo', 'Pedimento', 'Contenedor', 'Ref. Proveedor', 'Notas']
            
            # --- HEADERS DINÁMICOS EXCEL SIN HUECOS ---
            headers = []
            if unit_type == 'Placa':
                headers = ['Grosor (cm)', 'Alto (m)', 'Ancho (m)'] + common_headers_suffix
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
        return True```

## ./models/supplier_access.py
```py
# -*- coding: utf-8 -*-
import uuid
from datetime import timedelta
from odoo import models, fields, api


class SupplierAccess(models.Model):
    _name = 'stock.picking.supplier.access'
    _description = 'Token de Acceso a Portal de Proveedor'
    _order = 'create_date desc'

    picking_id = fields.Many2one('stock.picking', string="Recepción", required=True, ondelete='cascade')
    purchase_id = fields.Many2one('purchase.order', string="Orden de Compra", ondelete='cascade')

    access_token = fields.Char(
        string="Token", required=True, default=lambda self: str(uuid.uuid4()), readonly=True, copy=False
    )
    expiration_date = fields.Datetime(
        string="Expira",
        required=True,
        default=lambda self: fields.Datetime.now() + timedelta(days=15),
        copy=False
    )
    is_expired = fields.Boolean(compute="_compute_expired", store=False)
    portal_url = fields.Char(compute="_compute_url", store=False)

    _sql_constraints = [
        # 1 link por PO. (PostgreSQL permite múltiples NULL en UNIQUE, así que no rompe casos sin purchase_id)
        ('supplier_access_unique_purchase', 'unique(purchase_id)', 'Ya existe un link para esta Orden de Compra.'),
    ]

    @api.depends('expiration_date')
    def _compute_expired(self):
        now = fields.Datetime.now()
        for rec in self:
            rec.is_expired = bool(rec.expiration_date and rec.expiration_date < now)

    @api.depends('access_token')
    def _compute_url(self):
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            rec.portal_url = f"{base_url}/supplier/pl/{rec.access_token}"
```

## ./security/stock_lot_hold_security.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <data noupdate="1">
        <!-- Regla multi-compañía para packing.list.import.wizard -->
        <record id="packing_list_import_wizard_comp_rule" model="ir.rule">
            <field name="name">Packing List Import Wizard: multi-company</field>
            <field name="model_id" ref="model_packing_list_import_wizard"/>
            <field name="domain_force">[('picking_id.company_id', 'in', company_ids)]</field>
            <field name="global" eval="True"/>
        </record>

        <!-- Regla multi-compañía para worksheet.import.wizard -->
        <record id="worksheet_import_wizard_comp_rule" model="ir.rule">
            <field name="name">Worksheet Import Wizard: multi-company</field>
            <field name="model_id" ref="model_worksheet_import_wizard"/>
            <field name="domain_force">[('picking_id.company_id', 'in', company_ids)]</field>
            <field name="global" eval="True"/>
        </record>
    </data>
</odoo>```

## ./static/src/js/supplier_portal.js
```js
/* static/src/js/supplier_portal.js */
(function () {
    "use strict";

    console.log("[Portal] 🚀 Script v2.0 (Multi-Type: Placa/Formato/Pieza + Logic) Loaded.");

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
            sec_logistics: "Logistics (Global)",
            lbl_origin: "Origin (Port)",
            ph_origin: "Ex. Shanghai",
            lbl_dest: "Destination (Port)",
            ph_dest: "Ex. Manzanillo",
            lbl_country: "Country of Origin",
            ph_country: "Ex. China",
            lbl_vessel: "Vessel / Voyage",
            ph_vessel: "Ex. MAERSK SEALAND",
            lbl_incoterm: "Incoterm",
            ph_incoterm: "Ex. CIF",
            lbl_payment: "Payment Terms",
            ph_payment: "Ex. T/T 30%",
            lbl_status: "Status",
            opt_select: "Select...",
            opt_production: "In Production",
            opt_origin_port: "In Origin Port",
            opt_transit: "In Transit",
            opt_dest_port: "In Destination Port",
            
            // Multi-Container Specifics
            msg_multi_pl_info: "Logistics and Documentation data remain global. Only update 'Cargo Details' and 'Products' for each Packing List/Container.",
            sec_cargo: "Cargo Details (Current Container)",
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
            lbl_files: "Attach Container Documents",
            lbl_staged_title: "Containers Ready to Submit",
            
            pl_title: "Packing List Details",
            pl_instruction: "Enter details below.",
            loading: "Loading...",
            
            // Totales
            footer_total_plates: "Total Items:",
            footer_total_area: "Total Area (m²):",
            footer_total_pieces: "Total Qty:",
            
            btn_add_next: "Save Container & Add Next",
            btn_submit: "Finish & Submit All",
            
            msg_confirm_stage: "Are you sure you want to save this container and add another one?",
            msg_container_required: "Container Number is required in Cargo Details.",
            msg_rows_required: "Please add at least one product line.",
            msg_staged_success: "Container added to list. You can now enter the next one.",
            msg_remove_staged: "Remove this container?",
            
            requested: "Requested:",
            
            // Columnas Generales
            col_container: "Container",
            col_block: "Block",
            col_plate_num: "Plate No.",
            col_atado: "Bundle",
            col_thickness: "Thickness",
            col_height: "Height (m)",
            col_width: "Width (m)",
            col_area: "Area (m²)",
            col_qty: "Quantity", 
            col_notes: "Notes",
            col_weight: "Weight (kg)",
            col_ref: "Reference",

            // Etiquetas Específicas (Requerimiento)
            lbl_packages: "N° Packages", // Para Formatos y Piezas
            lbl_desc_goods: "Description of Goods", // Para Piezas
            
            // Columnas Visuales Formatos
            col_crate_h: "Crate H",
            col_crate_w: "Crate W",
            col_crate_t: "Crate T",
            col_fmt_h: "Item Height",
            col_fmt_w: "Item Width",
            
            // Tipos
            lbl_type_placa: "Slab/Plate",
            lbl_type_formato: "Tile/Format",
            lbl_type_pieza: "Piece/Unit",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "Notes",
            btn_add: "Add Item",
            btn_add_multi: "+5 Rows",
            msg_saving: "Saving...",
            msg_success: "✅ Saved successfully.",
            msg_error: "❌ Error: ",
            msg_confirm: "Save and send ALL data to Odoo?",
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
            sec_logistics: "Logística (Global)",
            lbl_origin: "Origen (Puerto)",
            ph_origin: "Ej. Shanghai",
            lbl_dest: "Destino (Puerto)",
            ph_dest: "Ej. Manzanillo",
            lbl_country: "País Origen",
            ph_country: "Ej. China",
            lbl_vessel: "Buque / Viaje",
            ph_vessel: "Ej. MAERSK SEALAND",
            lbl_incoterm: "Incoterm",
            ph_incoterm: "Ej. CIF",
            lbl_payment: "Forma de Pago",
            ph_payment: "Ej. T/T 30%",
            lbl_status: "Estatus",
            opt_select: "Seleccionar...",
            opt_production: "En Producción",
            opt_origin_port: "En Puerto Origen",
            opt_transit: "En Tránsito",
            opt_dest_port: "En Puerto Destino",
            // Multi-Contenedor
            msg_multi_pl_info: "Los datos de Documentación y Logística son globales. Solo actualice 'Detalles de Carga' y 'Productos' por cada Packing List.",
            sec_cargo: "Detalles de Carga (Contenedor Actual)",
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
            lbl_files: "Adjuntar Documentos del Contenedor",
            lbl_staged_title: "Contenedores Listos para Enviar",
            
            pl_title: "Detalle de Placas (Packing List)",
            pl_instruction: "Ingrese dimensiones.",
            loading: "Cargando...",
            
            // Totales
            footer_total_plates: "Items (Actual):",
            footer_total_area: "Total Área (m²):",
            footer_total_pieces: "Cantidad Total:",

            btn_add_next: "Guardar Contenedor y Agregar Otro",
            btn_submit: "Finalizar y Enviar Todo",
            
            msg_confirm_stage: "¿Seguro que desea guardar este contenedor y agregar otro?",
            msg_container_required: "El Número de Contenedor es obligatorio.",
            msg_rows_required: "Agregue al menos una línea de producto.",
            msg_staged_success: "Contenedor agregado a la lista. Ahora puede ingresar el siguiente.",
            msg_remove_staged: "¿Eliminar este contenedor de la lista?",
            
            requested: "Solicitado:",
            
            col_container: "Contenedor",
            col_block: "Bloque",
            col_plate_num: "No. Placa",
            col_atado: "Atado",
            col_thickness: "Grosor",
            col_height: "Alto (m)",
            col_width: "Ancho (m)",
            col_area: "Área (m²)",
            col_qty: "Cantidad", 
            col_notes: "Notas",
            col_weight: "Peso (kg)",
            col_ref: "Referencia",

            // Etiquetas Específicas
            lbl_packages: "N° Paquetes",
            lbl_desc_goods: "Desc. Bienes",
            
            // Columnas Visuales Formatos
            col_crate_h: "Alto Caja",
            col_crate_w: "Ancho Caja",
            col_crate_t: "Grosor Caja",
            col_fmt_h: "Alto Item",
            col_fmt_w: "Ancho Item",

            // Tipos
            lbl_type_placa: "Placa",
            lbl_type_formato: "Formato",
            lbl_type_pieza: "Pieza",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "Notas",
            btn_add: "Agregar Item",
            btn_add_multi: "+5 Filas",
            msg_saving: "Guardando...",
            msg_success: "✅ Guardado correctamente.",
            msg_error: "❌ Error: ",
            msg_confirm: "¿Guardar y enviar TODOS los datos a Odoo?",
            empty_products: "No hay productos pendientes de recepción en esta orden.",
            err_token: "Token no encontrado.",
            err_payload: "Payload vacío."
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
            sec_logistics: "物流信息 (全球)",
            lbl_origin: "起运港",
            ph_origin: "例如 Shanghai",
            lbl_dest: "目的港",
            ph_dest: "例如 Manzanillo",
            lbl_country: "原产国",
            ph_country: "例如 China",
            lbl_vessel: "船名 / 航次",
            ph_vessel: "例如 MAERSK SEALAND",
            lbl_incoterm: "贸易条款",
            ph_incoterm: "例如 CIF",
            lbl_payment: "付款方式",
            ph_payment: "例如 T/T 30%",
            lbl_status: "状态",
            opt_select: "请选择...",
            opt_production: "生产中",
            opt_origin_port: "在起运港",
            opt_transit: "运输途中",
            opt_dest_port: "在目的港",
            // Multi-Container
            msg_multi_pl_info: "文档和物流数据保持全局。仅需为每个装箱单/集装箱更新“货物详情”和“产品”。",
            sec_cargo: "货物详情 (当前集装箱)",
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
            lbl_files: "附上集装箱文件",
            lbl_staged_title: "准备提交的集装箱",
            
            pl_title: "装箱单明细",
            pl_instruction: "输入尺寸。“集装箱”字段将根据货物详情自动填写。",
            loading: "加载中...",
            
            // Totales Nuevos
            footer_total_plates: "当前项目数:",
            footer_total_area: "当前面积:",
            footer_total_pieces: "当前件数:",
            
            btn_add_next: "保存集装箱并添加下一个",
            btn_submit: "完成并全部提交",
            
            msg_confirm_stage: "您确定要保存此集装箱并添加另一个吗？",
            msg_container_required: "货物详情中必须填写集装箱号。",
            msg_rows_required: "请至少添加一行带有尺寸的产品。",
            msg_staged_success: "集装箱已添加到列表。现在可以输入下一个。",
            msg_remove_staged: "删除此集装箱？",
            
            requested: "需求量:",
            
            col_container: "集装箱",
            col_block: "荒料号",
            col_plate_num: "板号",
            col_atado: "捆包号",
            col_thickness: "厚度 (cm)",
            col_height: "高度 (m)",
            col_width: "宽度 (m)",
            col_area: "面积 (m²)",
            col_qty: "数量", 
            col_notes: "备注",
            col_weight: "重量 (kg)",
            col_ref: "参考",

            // Etiquetas Específicas
            lbl_packages: "包数",
            lbl_desc_goods: "货物描述",
            
            // Columnas Visuales
            col_crate_h: "箱高",
            col_crate_w: "箱宽",
            col_crate_t: "箱厚",
            col_fmt_h: "物品高度",
            col_fmt_w: "物品宽度",

            // Tipos
            lbl_type_placa: "大板",
            lbl_type_formato: "规格板",
            lbl_type_pieza: "件",

            ph_cnt: "CNT01",
            ph_block: "B-01",
            ph_plate: "1",
            ph_atado: "A-1",
            ph_opt: "备注",
            btn_add: "添加板材",
            btn_add_multi: "+5 行",
            msg_saving: "保存中...",
            msg_success: "✅ 保存成功。",
            msg_error: "❌ 错误: ",
            msg_confirm: "保存并将所有数据发送到 Odoo？",
            empty_products: "此订单中没有待收货的产品。",
            err_token: "未找到令牌。",
            err_payload: "数据为空。"
        }
    };

    class SupplierPortal {
        constructor() {
            this.data = {};
            this.products = [];
            this.rows = [];       // Filas actuales en pantalla (Container activo)
            this.header = {};     // Datos de cabecera (mezcla de Global y Actual)
            this.nextId = 1;
            
            // Almacén de contenedores confirmados ("Staged")
            this.stagedContainers = []; 
            
            this.currentLang = localStorage.getItem('portal_lang') || 'en';
            
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                this.init();
            }
        }

        t(key) {
            const langObj = TRANSLATIONS[this.currentLang] || TRANSLATIONS['en'];
            return langObj[key] || key;
        }

        changeLanguage(lang) {
            if (!TRANSLATIONS[lang]) return;
            this.currentLang = lang;
            localStorage.setItem('portal_lang', lang);
            this.updateStaticText();
            this.render(); 
            this.renderStagedTable(); 
        }

        updateStaticText() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.dataset.i18n;
                if (key) el.innerText = this.t(key);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.dataset.i18nPlaceholder;
                if (key) el.placeholder = this.t(key);
            });
        }

        init() {
            console.log("[Portal] Iniciando...");
            try {
                const langSelector = document.getElementById('lang-selector');
                if (langSelector) {
                    langSelector.value = this.currentLang;
                    langSelector.addEventListener('change', (e) => this.changeLanguage(e.target.value));
                }
                
                this.updateStaticText();

                const dataEl = document.getElementById('portal-data-store');
                if (!dataEl) throw new Error(this.t('err_payload'));
                
                const rawPayload = dataEl.dataset.payload;
                if(!rawPayload) throw new Error("Dataset Empty");

                this.data = JSON.parse(rawPayload);
                this.products = this.data.products || [];
                
                // Carga inicial de cabecera desde servidor
                const serverHeader = this.data.header || {};
                this.header = { ...serverHeader };

                // Recuperar estado local (si existe crash o recarga)
                const localData = this.loadLocalState();
                if (localData) {
                    if (localData.header) this.header = { ...this.header, ...localData.header };
                    if (localData.rows) this.rows = localData.rows;
                    if (localData.stagedContainers) this.stagedContainers = localData.stagedContainers;
                    
                    const maxId = this.rows.reduce((max, r) => Math.max(max, r.id || 0), 0);
                    this.nextId = maxId + 1;
                } else if (this.data.existing_rows && this.data.existing_rows.length > 0) {
                    this.rows = this.data.existing_rows.map(r => ({...r, id: this.nextId++}));
                } else {
                    if (this.products.length > 0) {
                        this.products.forEach(p => this.createRowInternal(p.id));
                    }
                }

                this.fillHeaderForm();
                this.render();         
                this.renderStagedTable();
                this.bindGlobalEvents();

                console.log("[Portal] Init Complete.");

            } catch (error) {
                console.error("[Portal] Error:", error);
                const container = document.getElementById('portal-rows-container');
                if (container) container.innerHTML = `<div class="alert alert-danger text-center p-5">${error.message}</div>`;
            }
        }

        loadLocalState() {
            if (!this.data.token) return null;
            const key = `pl_portal_${this.data.token}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try { return JSON.parse(saved); } catch (e) { return null; }
            }
            return null;
        }

        saveState() {
            if (!this.data.token) return;
            const key = `pl_portal_${this.data.token}`;
            const state = {
                rows: this.rows,
                header: this.getHeaderDataFromDOM(),
                stagedContainers: this.stagedContainers
            };
            localStorage.setItem(key, JSON.stringify(state));
            this.updateTotalsUI(); 
        }

        // --- MANEJO DE CABECERA Y FORMULARIO ---
        fillHeaderForm() {
            const map = {
                // Globales
                'h-invoice': 'invoice_number', 'h-date': 'shipment_date', 'h-proforma': 'proforma_number',
                'h-bl': 'bl_number', 'h-origin': 'origin', 'h-dest': 'destination',
                'h-country': 'country_origin', 'h-vessel': 'vessel', 'h-incoterm': 'incoterm', 
                'h-payment': 'payment_terms', 'h-status': 'status', 
                // Contenedor Actual
                'h-desc': 'merchandise_desc',
                'h-cont-no': 'container_no', 'h-seal': 'seal_no', 'h-type': 'container_type',
                'h-pkgs': 'total_packages', 'h-weight': 'gross_weight', 'h-volume': 'volume'
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
                incoterm: document.getElementById('h-incoterm')?.value || "",
                payment_terms: document.getElementById('h-payment')?.value || "",
                status: document.getElementById('h-status')?.value || "",
                merchandise_desc: document.getElementById('h-desc')?.value || "",
                container_no: document.getElementById('h-cont-no')?.value || "",
                seal_no: document.getElementById('h-seal')?.value || "",
                container_type: document.getElementById('h-type')?.value || "",
                total_packages: document.getElementById('h-pkgs')?.value || 0,
                gross_weight: document.getElementById('h-weight')?.value || 0.0,
                volume: document.getElementById('h-volume')?.value || 0.0,
            };
        }

        // --- CRUD FILAS PRODUCTOS ---
        createRowInternal(productId) {
            const product = this.products.find(p => p.id === productId);
            const unitType = product ? (product.unit_type || 'Placa') : 'Placa';

            // Heredar valores
            const productRows = this.rows.filter(r => r.product_id === productId);
            let defaults = { bloque: '', grosor: '', atado: '' };
            if (productRows.length > 0) {
                const last = productRows[productRows.length - 1];
                defaults = { 
                    bloque: last.bloque, 
                    grosor: last.grosor,
                    atado: last.atado
                };
            }
            const newRow = {
                id: this.nextId++, product_id: productId,
                contenedor: '',
                bloque: defaults.bloque,
                numero_placa: '', 
                atado: defaults.atado,
                grosor: defaults.grosor, // Ahora admite texto (para Formatos)
                alto: 0, 
                ancho: 0, 
                color: '',   // Mapping: Notes / Descripcion / Item Dims
                ref_prov: '',// Mapping: Reference / Crate Dims
                tipo: unitType,
                quantity: 0,
                weight: 0,
                
                // Campos Visuales para Formatos (Crate Dimensions) -> Concatenados en ref_prov
                crate_h: '', crate_w: '', crate_t: '',
                // Campos Visuales para Formatos (Item Dimensions) -> Concatenados en color
                fmt_h: '', fmt_w: ''
            };

            if (unitType === 'Pieza' || unitType === 'Formato') {
                newRow.ancho = 1;
            }

            this.rows.push(newRow);
            return newRow;
        }

        updateRowData(id, field, value) {
            const row = this.rows.find(r => r.id === parseInt(id));
            if (!row) return;

            if (['alto', 'ancho', 'quantity', 'weight'].includes(field)) {
                row[field] = parseFloat(value) || 0;
            } else {
                row[field] = value;
            }

            // --- LÓGICA DE CONCATENACIÓN AUTOMÁTICA (FORMATOS) ---
            if (row.tipo === 'Formato') {
                // Si cambian dimensiones de caja -> Actualizar Referencia (ref_prov)
                if (field.startsWith('crate_')) {
                    const h = row.crate_h || '-';
                    const w = row.crate_w || '-';
                    const t = row.crate_t || '-';
                    row.ref_prov = `Crate: ${h}x${w}x${t}`;
                }
                // Si cambian dimensiones visuales de item -> Actualizar Notas (color)
                if (field.startsWith('fmt_')) {
                    const fh = row.fmt_h || '-';
                    const fw = row.fmt_w || '-';
                    row.color = `Item Dim: ${fh}x${fw}`;
                }
            }

            this.saveState();
        }

        // --- GESTIÓN DE ETAPAS (STAGING) ---
        async stageCurrentContainer() {
            const currentHeader = this.getHeaderDataFromDOM();
            
            if (!currentHeader.container_no) {
                alert(this.t('msg_container_required'));
                document.getElementById('h-cont-no').focus();
                return;
            }

            // Validar filas
            const validRows = this.rows.filter(r => {
                if (r.tipo === 'Placa') return r.alto > 0 && r.ancho > 0;
                return r.quantity > 0; // Para Pieza/Formato
            });
            
            if (validRows.length === 0) {
                alert(this.t('msg_rows_required'));
                return;
            }

            if (!confirm(this.t('msg_confirm_stage'))) return;

            const fileInput = document.getElementById('h-files');
            const files = await this.readFiles(fileInput);

            const stagedRows = validRows.map(r => ({
                ...r,
                contenedor: currentHeader.container_no
            }));

            const containerObj = {
                id: Date.now(),
                header: { ...currentHeader },
                rows: stagedRows,
                files: files,
                summary: {
                    container_no: currentHeader.container_no,
                    type: currentHeader.container_type,
                    weight: parseFloat(currentHeader.gross_weight || 0),
                    volume: parseFloat(currentHeader.volume || 0),
                    lines_count: stagedRows.length,
                    files_count: files.length
                }
            };

            this.stagedContainers.push(containerObj);

            // Limpiar UI
            this.rows = []; 
            if (this.products.length > 0) {
                this.products.forEach(p => this.createRowInternal(p.id));
            }

            ['h-cont-no', 'h-seal', 'h-pkgs', 'h-weight', 'h-volume', 'h-desc', 'h-files'].forEach(id => {
                const el = document.getElementById(id);
                if(el) el.value = '';
            });

            this.saveState();
            this.render();
            this.renderStagedTable();
            this.bindGlobalEvents(); 
            
            alert(this.t('msg_staged_success'));
            const stagedArea = document.getElementById('staged-containers-area');
            if(stagedArea) stagedArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        readFiles(inputElement) {
            return new Promise((resolve) => {
                if (!inputElement || !inputElement.files || inputElement.files.length === 0) {
                    resolve([]);
                    return;
                }
                const filesData = [];
                const files = Array.from(inputElement.files);
                let processed = 0;

                files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        filesData.push({
                            name: file.name,
                            type: file.type,
                            data: e.target.result.split(',')[1]
                        });
                        processed++;
                        if (processed === files.length) resolve(filesData);
                    };
                    reader.onerror = () => { processed++; if (processed === files.length) resolve(filesData); };
                    reader.readAsDataURL(file);
                });
            });
        }

        removeStagedContainer(id) {
            if(!confirm(this.t('msg_remove_staged'))) return;
            this.stagedContainers = this.stagedContainers.filter(c => c.id !== id);
            this.saveState();
            this.renderStagedTable();
        }

        renderStagedTable() {
            const area = document.getElementById('staged-containers-area');
            const tbody = document.getElementById('staged-containers-tbody');
            if (!area || !tbody) return;
            if (this.stagedContainers.length === 0) { area.classList.add('d-none'); return; }
            area.classList.remove('d-none');
            tbody.innerHTML = '';
            this.stagedContainers.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="text-warning fw-bold">${c.summary.container_no}</td>
                    <td>${c.summary.type || '-'}</td>
                    <td>${c.summary.weight.toFixed(2)}</td>
                    <td>${c.summary.volume.toFixed(2)}</td>
                    <td>${c.summary.lines_count}</td>
                    <td>${c.summary.files_count} <i class="fa fa-paperclip text-muted"></i></td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-danger btn-remove-stage" data-id="${c.id}"><i class="fa fa-trash"></i></button>
                    </td>`;
                tbody.appendChild(tr);
            });
            document.querySelectorAll('.btn-remove-stage').forEach(btn => {
                btn.addEventListener('click', (e) => this.removeStagedContainer(parseInt(e.currentTarget.dataset.id)));
            });
        }

        async submitAllData() {
            const currentHeader = this.getHeaderDataFromDOM();
            const currentValidRows = this.rows.filter(r => {
                if (r.tipo === 'Placa') return r.alto > 0 && r.ancho > 0;
                return r.quantity > 0;
            });
            
            let pendingOnScreen = false;
            if (currentValidRows.length > 0) {
                if (!currentHeader.container_no) { alert(this.t('msg_container_required')); return; }
                pendingOnScreen = true;
            }

            if (!confirm(this.t('msg_confirm'))) return;

            let finalRows = [];
            let finalFiles = [];
            
            this.stagedContainers.forEach(c => {
                finalRows = [...finalRows, ...c.rows];
                c.files.forEach(f => finalFiles.push({ ...f, container_ref: c.summary.container_no }));
            });

            if (pendingOnScreen) {
                const fileInput = document.getElementById('h-files');
                const filesCurrent = await this.readFiles(fileInput);
                currentValidRows.forEach(r => r.contenedor = currentHeader.container_no);
                finalRows = [...finalRows, ...currentValidRows];
                filesCurrent.forEach(f => finalFiles.push({ ...f, container_ref: currentHeader.container_no }));
            }

            if (finalRows.length === 0) { alert("No data to submit."); return; }

            const finalHeader = { ...currentHeader };
            // Agregación básica para totales globales de cabecera (opcional)
            let totalPkg=0, totalW=0.0, totalV=0.0;
            const containerNames=new Set(), containerTypes=new Set(), sealNos=new Set();
            const addMetrics = (h) => {
                totalPkg += parseInt(h.total_packages||0); totalW += parseFloat(h.gross_weight||0); totalV += parseFloat(h.volume||0);
                if(h.container_no) containerNames.add(h.container_no);
                if(h.container_type) containerTypes.add(h.container_type);
                if(h.seal_no) sealNos.add(h.seal_no);
            };
            this.stagedContainers.forEach(c => addMetrics(c.header));
            if (pendingOnScreen) addMetrics(currentHeader);
            
            finalHeader.container_no = Array.from(containerNames).join(', ');
            finalHeader.container_type = Array.from(containerTypes).join(', ');
            finalHeader.seal_no = Array.from(sealNos).join(', ');
            finalHeader.total_packages = totalPkg;
            finalHeader.gross_weight = totalW;
            finalHeader.volume = totalV;

            // UI Block
            const btn = document.getElementById('btn-submit-pl');
            const btnNext = document.getElementById('btn-add-next');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
            btn.disabled = true;
            if(btnNext) btnNext.disabled = true;

            try {
                const res = await fetch('/supplier/pl/submit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { token: this.data.token, rows: finalRows, header: finalHeader, files: finalFiles },
                        id: Math.floor(Math.random()*1000)
                    })
                });
                const result = await res.json();
                if (result.result && result.result.success) {
                    alert(this.t('msg_success'));
                    localStorage.removeItem(`pl_portal_${this.data.token}`);
                    window.location.reload();
                } else {
                    const msg = result.error?.data?.message || result.result?.message || "Unknown Error";
                    alert(this.t('msg_error') + msg);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    if(btnNext) btnNext.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert("Connection Error");
                btn.innerHTML = originalText;
                btn.disabled = false;
                if(btnNext) btnNext.disabled = false;
            }
        }

        // --- RENDERIZADO Y EVENTOS ---
        render() {
            const container = document.getElementById('portal-rows-container');
            if (!container) return;

            let html = '';
            this.products.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const productRows = this.rows.filter(r => r.product_id === product.id);
                
                html += `
                    <div class="product-section">
                        <div class="product-header">
                            <div>
                                <h3>${product.name} 
                                    <span class="text-muted small ms-2">(${product.code})</span>
                                    <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span>
                                </h3>
                            </div>
                            <div class="meta">${this.t('requested')} <strong class="text-dark">${product.qty_ordered} ${product.uom}</strong></div>
                        </div>
                        <div class="table-responsive">
                            <table class="portal-table">
                                <thead>
                                    <tr>`;
                
                // --- CABECERAS POR TIPO ---
                if (unitType === 'Placa') {
                    // PLACAS (Slabs)
                    html += `
                        <th>${this.t('col_block')}</th>
                        <th>${this.t('col_atado')}</th>
                        <th>${this.t('col_plate_num')}</th>
                        <th>${this.t('col_ref')}</th> <!-- Nuevo Campo -->
                        <th>${this.t('col_thickness')}</th>
                        <th>${this.t('col_height')}</th>
                        <th>${this.t('col_width')}</th>
                        <th>${this.t('col_area')}</th>
                        <th>${this.t('col_notes')}</th>`;
                } else if (unitType === 'Formato') {
                    // FORMATOS (Tiles)
                    html += `
                        <th>${this.t('lbl_packages')}</th> <!-- Atado renamed -->
                        <th>${this.t('col_qty')}</th>
                        <!-- Crate Dimensions (Visual) -->
                        <th class="bg-light border-end">${this.t('col_crate_h')}</th>
                        <th class="bg-light border-end">${this.t('col_crate_w')}</th>
                        <th class="bg-light border-end">${this.t('col_crate_t')}</th>
                        
                        <th>${this.t('col_thickness')}</th>
                        <th>${this.t('col_weight')}</th>
                        
                        <!-- Item Dimensions (Visual) -->
                        <th class="bg-light border-start">${this.t('col_fmt_h')}</th>
                        <th class="bg-light">${this.t('col_fmt_w')}</th>`;
                } else {
                    // PIEZAS (Units)
                    html += `
                        <th>${this.t('lbl_packages')}</th> <!-- Atado renamed -->
                        <th>${this.t('col_qty')}</th>
                        <th>${this.t('col_ref')}</th>
                        <th>${this.t('col_weight')}</th>
                        <th>${this.t('lbl_desc_goods')}</th> <!-- Notes renamed -->`;
                }

                html += `       <th style="width: 50px;"></th>
                            </tr>
                        </thead>
                        <tbody>`;
                
                const renderInput = (rowId, field, value, ph, type="text", step="") => `
                    <div class="input-group-portal">
                        <input type="${type}" step="${step}" class="input-field" 
                               data-field="${field}" value="${value||''}" placeholder="${ph ? this.t(ph) : ''}">
                        <button type="button" class="btn-fill-down" data-row-id="${rowId}" data-field="${field}" tabindex="-1">
                            <i class="fa fa-arrow-down"></i>
                        </button>
                    </div>`;

                productRows.forEach(row => {
                    html += `<tr data-row-id="${row.id}">`;
                    
                    if (unitType === 'Placa') {
                        const area = (row.alto * row.ancho).toFixed(2);
                        html += `
                            <td data-label="${this.t('col_block')}">${renderInput(row.id, 'bloque', row.bloque, 'ph_block')}</td>
                            <td data-label="${this.t('col_atado')}">${renderInput(row.id, 'atado', row.atado, 'ph_atado')}</td>
                            <td data-label="${this.t('col_plate_num')}">${renderInput(row.id, 'numero_placa', row.numero_placa, 'ph_plate')}</td>
                            <td data-label="${this.t('col_ref')}">${renderInput(row.id, 'ref_prov', row.ref_prov, '')}</td>
                            <td data-label="${this.t('col_thickness')}">${renderInput(row.id, 'grosor', row.grosor, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_height')}">${renderInput(row.id, 'alto', row.alto, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_width')}">${renderInput(row.id, 'ancho', row.ancho, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${area}</span></td>
                            <td data-label="${this.t('col_notes')}">${renderInput(row.id, 'color', row.color, 'ph_opt')}</td>`;
                    } else if (unitType === 'Formato') {
                        html += `
                            <td data-label="${this.t('lbl_packages')}">${renderInput(row.id, 'atado', row.atado, '')}</td>
                            <td data-label="${this.t('col_qty')}">${renderInput(row.id, 'quantity', row.quantity, '', 'number', '1')}</td>
                            
                            <!-- Visual Crate Dims -->
                            <td data-label="${this.t('col_crate_h')}">${renderInput(row.id, 'crate_h', row.crate_h, '', 'text')}</td>
                            <td data-label="${this.t('col_crate_w')}">${renderInput(row.id, 'crate_w', row.crate_w, '', 'text')}</td>
                            <td data-label="${this.t('col_crate_t')}">${renderInput(row.id, 'crate_t', row.crate_t, '', 'text')}</td>
                            
                            <td data-label="${this.t('col_thickness')}">${renderInput(row.id, 'grosor', row.grosor, '', 'text')}</td> <!-- Text allowed -->
                            <td data-label="${this.t('col_weight')}">${renderInput(row.id, 'weight', row.weight, '', 'number', '0.01')}</td>
                            
                            <!-- Visual Note Split -->
                            <td data-label="${this.t('col_fmt_h')}">${renderInput(row.id, 'fmt_h', row.fmt_h, '', 'text')}</td>
                            <td data-label="${this.t('col_fmt_w')}">${renderInput(row.id, 'fmt_w', row.fmt_w, '', 'text')}</td>`;
                    } else {
                        // Piezas
                        html += `
                            <td data-label="${this.t('lbl_packages')}">${renderInput(row.id, 'atado', row.atado, '')}</td>
                            <td data-label="${this.t('col_qty')}">${renderInput(row.id, 'quantity', row.quantity, '', 'number', '1')}</td>
                            <td data-label="${this.t('col_ref')}">${renderInput(row.id, 'ref_prov', row.ref_prov, '')}</td>
                            <td data-label="${this.t('col_weight')}">${renderInput(row.id, 'weight', row.weight, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('lbl_desc_goods')}">${renderInput(row.id, 'color', row.color, '')}</td>`;
                    }

                    html += `
                            <td class="text-center"><button class="btn-action btn-delete" type="button"><i class="fa fa-trash"></i></button></td>
                        </tr>`;
                });

                html += `</tbody></table>
                        <div class="table-actions">
                            <button class="btn-add-row action-add" data-product-id="${product.id}" type="button"><i class="fa fa-plus-circle me-2"></i> ${this.t('btn_add')}</button>
                            <button class="btn-add-row ms-2 action-add-multi" data-product-id="${product.id}" type="button">${this.t('btn_add_multi')}</button>
                        </div></div></div>`;
            });

            container.innerHTML = html;
            this.updateTotalsUI();
        }

        bindGlobalEvents() {
            const activeContainer = document.getElementById('portal-rows-container');
            if(activeContainer) {
                const newContainer = activeContainer.cloneNode(true);
                activeContainer.parentNode.replaceChild(newContainer, activeContainer);
                
                newContainer.addEventListener('input', (e) => {
                    if (e.target.classList.contains('input-field')) {
                        const tr = e.target.closest('tr');
                        const rowId = tr.dataset.rowId;
                        const field = e.target.dataset.field;
                        this.updateRowData(rowId, field, e.target.value);
                        
                        if (field === 'alto' || field === 'ancho') {
                            const r = this.rows.find(x => x.id == rowId);
                            if(r && r.tipo === 'Placa') {
                                const areaSpan = tr.querySelector('.area-display');
                                if(areaSpan) areaSpan.innerText = (r.alto * r.ancho).toFixed(2);
                            }
                            this.updateTotalsUI();
                        } else if (field === 'quantity') {
                            this.updateTotalsUI();
                        }
                    }
                });

                newContainer.addEventListener('click', (e) => {
                    const target = e.target;
                    const fillBtn = target.closest('.btn-fill-down');
                    const delBtn = target.closest('.btn-delete');
                    const addBtn = target.closest('.action-add');
                    const addMultiBtn = target.closest('.action-add-multi');

                    if(fillBtn) {
                        this.fillDownInternal(fillBtn.dataset.rowId, fillBtn.dataset.field);
                    } else if(delBtn) {
                        this.deleteRowInternal(delBtn.closest('tr').dataset.rowId);
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    } else if(addBtn) {
                        this.createRowInternal(parseInt(addBtn.dataset.productId));
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    } else if(addMultiBtn) {
                        const pid = parseInt(addMultiBtn.dataset.productId);
                        for(let i=0; i<5; i++) this.createRowInternal(pid);
                        this.saveState(); this.render(); this.bindGlobalEvents();
                    }
                });
            }

            const btnSubmit = document.getElementById('btn-submit-pl');
            if (btnSubmit) {
                const b = btnSubmit.cloneNode(true);
                btnSubmit.parentNode.replaceChild(b, btnSubmit);
                b.addEventListener('click', () => this.submitAllData());
            }

            const btnNext = document.getElementById('btn-add-next');
            if (btnNext) {
                const b = btnNext.cloneNode(true);
                btnNext.parentNode.replaceChild(b, btnNext);
                b.addEventListener('click', () => this.stageCurrentContainer());
            }

            const headerForm = document.getElementById('shipment-info-form');
            if(headerForm) {
                 headerForm.addEventListener('input', () => this.saveState());
            }
        }

        fillDownInternal(rowId, field) {
            const sourceId = parseInt(rowId);
            const sourceRow = this.rows.find(r => r.id === sourceId);
            if (!sourceRow) return;
            let start = false;
            let count = 0;
            this.rows.forEach(r => {
                if (r.id === sourceId) start = true;
                else if (start && r.product_id === sourceRow.product_id) {
                    r[field] = sourceRow[field];
                    // Si se copia un campo visual en Formatos, actualizar la concatenación
                    if (r.tipo === 'Formato') {
                         if (field.startsWith('crate_')) r.ref_prov = `Crate: ${r.crate_h||'-'}x${r.crate_w||'-'}x${r.crate_t||'-'}`;
                         if (field.startsWith('fmt_')) r.color = `Item Dim: ${r.fmt_h||'-'}x${r.fmt_w||'-'}`;
                    }
                    count++;
                }
            });
            if(count > 0) {
                this.saveState(); this.render(); this.bindGlobalEvents();
            }
        }

        deleteRowInternal(id) {
            this.rows = this.rows.filter(r => r.id !== parseInt(id));
        }

        updateTotalsUI() {
            const validRows = this.rows.filter(r => {
                if (r.tipo === 'Placa') return r.alto > 0 && r.ancho > 0;
                return r.quantity > 0;
            });
            
            let totalM2 = 0;
            let totalItems = 0; 
            let totalPieces = 0; 

            validRows.forEach(r => {
                if (r.tipo === 'Pieza' || r.tipo === 'Formato') {
                    totalPieces += r.quantity;
                } else {
                    totalM2 += (r.alto * r.ancho);
                    totalItems++;
                }
            });
            
            document.getElementById('total-plates').innerText = totalItems;
            document.getElementById('total-area').innerText = totalM2.toFixed(2);
            
            let piecesContainer = document.getElementById('summary-pieces-container');
            if (!piecesContainer) {
                const summaryDiv = document.querySelector('.submit-footer .summary');
                if (summaryDiv) {
                    piecesContainer = document.createElement('div');
                    piecesContainer.id = 'summary-pieces-container';
                    // Estilo simple por código (el CSS ya maneja el diseño general)
                    piecesContainer.innerHTML = `<span data-i18n="footer_total_pieces">${this.t('footer_total_pieces')}</span> <span id="total-pieces" class="text-warning fw-bold">0</span>`;
                    summaryDiv.appendChild(piecesContainer);
                }
            }
            const piecesVal = document.getElementById('total-pieces');
            if(piecesVal) piecesVal.innerText = totalPieces;
            
            const hasStaged = this.stagedContainers.length > 0;
            const hasCurrent = validRows.length > 0;
            const btnSubmit = document.getElementById('btn-submit-pl');
            if (btnSubmit) btnSubmit.disabled = !(hasStaged || hasCurrent);
        }
    }

    window.supplierPortal = new SupplierPortal();
})();```

## ./static/src/scss/supplier_portal.scss
```scss
/* static/src/scss/supplier_portal.scss */

/* --- Variables: Palette Cream & Wood --- */
$bg-body: #F9F9F7;       /* Crema muy suave para el fondo general */
$bg-card: #FFFFFF;       /* Blanco puro para tarjetas */
$bg-input: #FFFFFF;      /* Blanco para inputs */
$primary-wood: #8B5A2B;  /* Tono Madera (Marrón cálido/Dorado oscuro) */
$primary-hover: #6D4C41; /* Tono madera más oscuro para hover */
$secondary-wood: #D7CCC8; /* Beige suave para bordes/separadores */

$text-main: #2C2C2C;     /* Gris casi negro para lectura clara */
$text-muted: #666666;    /* Gris medio para etiquetas */
$border-color: #E0E0E0;  /* Gris claro para bordes */
$input-border: #CCCCCC;  /* Borde de inputs */

@mixin mobile {
    @media (max-width: 767.98px) { @content; }
}

@mixin tablet {
    @media (min-width: 768px) and (max-width: 1024px) { @content; }
}

body {
    background-color: $bg-body;
    color: $text-main;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 0.95rem;
    overflow-x: hidden;
    margin: 0;
}

/* --- HEADER --- */
.o_portal_header {
    background: rgba(255, 255, 255, 0.98); /* Fondo blanco translúcido */
    border-bottom: 2px solid $primary-wood;
    padding: 0.6rem 1.2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 1000;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 15px rgba(139, 90, 43, 0.08);
    flex-wrap: wrap;
    gap: 10px;

    .brand {
        font-size: 1.25rem;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: $primary-wood;
        display: flex;
        align-items: center;
        white-space: nowrap;
        text-transform: uppercase;
        
        img {
            height: 35px;
            width: auto; 
            margin-right: 12px;
        }
    }

    .header-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
    }
    
    .po-info {
        text-align: right;
        min-width: 120px;

        .label { 
            font-size: 0.7rem; 
            color: $text-muted; 
            text-transform: uppercase; 
            display: block;
            margin-bottom: 2px;
        }
        .value { 
            font-weight: 700; 
            color: $text-main; 
            font-size: 0.95rem;
        }
    }

    .lang-selector-wrapper {
        display: flex;
        align-items: center;
        background: #F0F0F0;
        padding: 5px 10px;
        border-radius: 6px;
        border: 1px solid #DDD;

        .lang-select {
            background: transparent;
            color: $text-main;
            border: none;
            font-size: 0.9rem;
            cursor: pointer;
            outline: none;
            max-width: 100px;
            option { background: #FFF; color: #333; }
        }
    }

    @include mobile {
        padding: 0.8rem 1rem;
        flex-direction: column;
        align-items: flex-start;
        
        .brand { 
            width: 100%;
            justify-content: center; 
            margin-bottom: 0.8rem;
        }
        
        .header-controls {
            width: 100%;
            justify-content: space-between;
            gap: 10px;
        }
        .po-info { text-align: right; }
    }
}

.o_portal_container {
    max-width: 98%; 
    margin: 2rem auto;
    padding: 0 1rem;
    padding-bottom: 140px; 

    @include mobile {
        padding: 0 0.5rem 150px 0.5rem;
        margin-top: 1rem;
    }
}

/* --- SHIPMENT CARD & FORMS --- */
.shipment-card {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 10px;
    margin-bottom: 2rem;
    box-shadow: 0 5px 20px rgba(0,0,0,0.03);
    overflow: hidden;

    .card-header {
        background: #F4F0EB; /* Crema ligeramente más oscuro/Beige */
        padding: 1rem 1.5rem;
        border-bottom: 1px solid $secondary-wood;
        display: flex;
        align-items: center;
        gap: 12px;

        i { color: $primary-wood; font-size: 1.1rem; }
        h3 {
            margin: 0; font-size: 1.05rem; color: $primary-wood; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.5px;
        }
    }

    .card-body { padding: 1.5rem; }
    
    @include mobile {
        .card-body { padding: 1rem; }
    }
}

/* Títulos de secciones internas */
.form-section-title {
    color: $primary-wood;
    font-size: 0.85rem;
    text-transform: uppercase;
    font-weight: 700;
    border-bottom: 2px solid $secondary-wood;
    padding-bottom: 6px;
    margin-bottom: 15px;
    margin-top: 10px;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    width: 100%;
}

.modern-form-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr); 
    gap: 1.2rem;
    
    @include tablet {
        grid-template-columns: repeat(2, 1fr);
    }

    @include mobile {
        grid-template-columns: 1fr;
        gap: 1rem;
    }
    
    .form-group {
        display: flex;
        flex-direction: column;
        
        label {
            color: $text-muted;
            font-size: 0.8rem;
            margin-bottom: 0.4rem;
            font-weight: 600;
            display: flex; align-items: center; gap: 6px;
        }

        .form-control {
            background-color: $bg-input !important;
            border: 1px solid $input-border !important;
            color: $text-main !important;
            border-radius: 5px;
            padding: 8px 10px;
            font-size: 0.9rem;
            transition: all 0.2s ease;
            width: 100%;
            box-sizing: border-box;

            &:focus {
                border-color: $primary-wood !important;
                box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.15);
                outline: none;
            }
            &::placeholder { color: #BBB; }
        }
    }

    .full-width { 
        grid-column: 1 / -1; 
    }
}

/* --- TABLAS RESPONSIVAS --- */
.product-section {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 10px;
    margin-bottom: 2rem;
    overflow: hidden;
    box-shadow: 0 4px 15px rgba(0,0,0,0.04);

    .product-header {
        background: #F4F0EB;
        padding: 1rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid $secondary-wood;
        flex-wrap: wrap;
        gap: 10px;

        h3 { margin: 0; font-size: 1.1rem; color: $primary-wood; font-weight: 700; }
        .badge { 
            background-color: $primary-wood; 
            color: #FFF; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-weight: 500;
            font-size: 0.75rem;
        }
        .meta { color: $text-muted; font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
    }
    .table-responsive { padding: 0; overflow-x: auto; }
}

.portal-table {
    width: 100%;
    border-collapse: collapse;
    color: $text-main;
    min-width: 900px; /* Asegura scroll en pantallas pequeñas */

    thead {
        background: #FAFAFA;
        th {
            text-align: left;
            padding: 0.8rem 0.6rem;
            color: $primary-wood;
            font-size: 0.75rem; 
            font-weight: 800;
            text-transform: uppercase;
            border-bottom: 2px solid $secondary-wood;
            white-space: nowrap; 
        }
    }

    tbody td {
        padding: 0.5rem 0.6rem;
        border-bottom: 1px solid $border-color;
        vertical-align: middle;
        
        .area-display {
            color: $primary-wood;
            font-weight: 700;
            font-family: monospace;
            font-size: 0.9rem;
        }
    }

    /* Colorear ligeramente celdas de dimensiones visuales si se desea */
    .bg-light { background-color: #FCFCFC; }

    @include mobile {
        display: block;
        min-width: auto;
        
        thead { display: none; }
        tbody { display: block; }
        
        tr {
            display: block;
            background: #FFF;
            margin: 1rem 0;
            border-radius: 8px;
            border: 1px solid $border-color;
            padding: 1rem;
            position: relative;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }

        td {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem 0;
            border: none;
            text-align: right;
            
            &::before {
                content: attr(data-label);
                font-size: 0.8rem;
                text-transform: uppercase;
                color: $primary-wood;
                font-weight: 700;
                margin-right: 15px;
                text-align: left;
            }
        }

        td:last-child {
            position: absolute;
            top: 10px; right: 10px;
            padding: 0; width: auto;
            &::before { content: none; }
            .btn-action { width: 32px; height: 32px; font-size: 1rem; }
        }
        
        td[data-label*="Área"], td[data-label*="Area"] { 
             background: rgba(139, 90, 43, 0.08);
             border-radius: 6px;
             padding: 8px;
             margin-top: 5px;
        }

        .input-group-portal { width: 60%; }
    }
}

.input-group-portal {
    display: flex;
    align-items: center;
    gap: 4px; 
    width: 100%;
    
    input {
        background: $bg-input;
        border: 1px solid $input-border;
        color: $text-main;
        padding: 6px 8px; 
        border-radius: 4px;
        width: 100%;
        font-family: 'Inter', monospace;
        font-size: 0.85rem; 

        &:focus {
            outline: none;
            border-color: $primary-wood;
            background: #FFFEFA;
        }
    }

    .btn-fill-down {
        background: #F0F0F0;
        border: 1px solid #D0D0D0;
        color: $primary-wood;
        padding: 4px 8px;
        border-radius: 4px;
        min-width: 26px;
        font-size: 0.8rem;
        cursor: pointer;
        
        &:hover { color: #FFF; background: $primary-wood; }
        &:active { transform: translateY(1px); }
        @include mobile { display: none; }
    }
}

.btn-action {
    width: 32px; height: 32px;
    border-radius: 6px;
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer;
    background: #FFEBEE;
    color: #C62828;
    border: 1px solid #FFCDD2;
    transition: all 0.2s;
    font-size: 0.9rem;
    
    &:hover { background: #FFCDD2; }
}

.table-actions {
    padding: 1rem;
    display: flex;
    gap: 10px;
    background: #FAFAFA;
    border-top: 1px solid $border-color;
    
    .btn-add-row {
        flex: 1;
        display: flex; justify-content: center; align-items: center;
        padding: 10px;
        border-radius: 6px;
        background: #FFF;
        border: 1px dashed $primary-wood;
        color: $primary-wood;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
        
        &:hover { background: rgba(139, 90, 43, 0.08); }
    }
}

/* --- FOOTER --- */
.submit-footer {
    position: fixed;
    bottom: 0; left: 0; width: 100%;
    background: rgba(255, 255, 255, 0.98);
    padding: 1rem 2rem;
    border-top: 3px solid $primary-wood;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 999;
    backdrop-filter: blur(10px);
    box-shadow: 0 -5px 20px rgba(0,0,0,0.1);

    .summary {
        color: $text-main;
        font-size: 0.9rem;
        display: flex; gap: 25px;
        
        div { display: flex; align-items: center; gap: 8px; font-weight: 600; }
        span { color: $primary-wood; font-weight: 800; font-size: 1.1rem; }
    }

    @include mobile {
        flex-direction: column;
        gap: 15px;
        padding: 1rem;
        
        .summary {
            width: 100%;
            justify-content: space-between;
            font-size: 0.85rem;
            background: #F5F5F5;
            padding: 10px;
            border-radius: 8px;
        }
        .btn-primary-custom { width: 100%; padding: 14px; font-size: 1rem; }
    }
}

.btn-primary-custom {
    background: $primary-wood;
    color: #FFF;
    border: none;
    padding: 10px 30px;
    border-radius: 30px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.9rem;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(139, 90, 43, 0.3);
    transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
    
    &:hover { background: $primary-hover; }
    &:active { transform: scale(0.98); }
    &:disabled { background: #CCC; color: #888; box-shadow: none; cursor: not-allowed; }
}```

## ./static/src/xml/supplier_portal.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<templates xml:space="preserve">
    <t t-name="stock_lot_packing_import.SupplierPortalApp">
        <div class="o_portal_wrapper">
            
            <!-- HEADER -->
            <header class="o_portal_header">
                <div class="brand">
                    <i class="fa fa-cubes me-2"/>PORTAL <span class="ms-1">PROVEEDOR</span>
                </div>
                <div class="po-info">
                    <div><span class="label">Orden de Compra:</span> <span class="value" t-esc="state.data.poName"/></div>
                    <div><span class="label">Recepción:</span> <span class="value" t-esc="state.data.pickingName"/></div>
                </div>
            </header>

            <!-- CONTENIDO -->
            <div class="o_portal_container pb-5 mb-5">
                
                <!-- SECCIÓN: DATOS DE EMBARQUE -->
                <div class="shipment-card">
                    <div class="card-header">
                        <i class="fa fa-ship fa-lg"></i>
                        <h3 data-i18n="shipment_data_title">Datos de Embarque</h3>
                    </div>
                    <div class="card-body" id="shipment-info-form">
                        
                        <!-- NOTA INFORMATIVA -->
                        <div class="alert alert-info mb-3 p-2" style="font-size: 0.85rem;">
                            <i class="fa fa-info-circle me-1"></i> 
                            <span data-i18n="msg_multi_pl_info">Los datos de Documentación y Logística se mantendrán para todos los contenedores. Solo debe actualizar la sección 'Detalles de Carga' y 'Productos' por cada Packing List.</span>
                        </div>

                        <div class="modern-form-grid">
                            
                            <!-- SECCIÓN DOCUMENTACIÓN (GLOBAL) -->
                            <div class="full-width form-section-title">
                                <i class="fa fa-file-text-o me-2"></i> Documentación (Global)
                            </div>
                            
                            <div class="form-group">
                                <label><span data-i18n="lbl_invoice">No. de Factura</span></label>
                                <input type="text" id="h-invoice" class="form-control" data-i18n-placeholder="ph_invoice" placeholder="Ej. INV-2024-001"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_date">Fecha Embarque</span></label>
                                <input type="date" id="h-date" class="form-control"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_proforma">No. Proforma (PI)</span></label>
                                <input type="text" id="h-proforma" class="form-control" data-i18n-placeholder="ph_proforma" placeholder="Ej. PI-9920"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_bl">No. B/L</span></label>
                                <input type="text" id="h-bl" class="form-control" data-i18n-placeholder="ph_bl" placeholder="Ej. COSU123456"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_payment">Forma de Pago</span></label>
                                <input type="text" id="h-payment" class="form-control" data-i18n-placeholder="ph_payment" placeholder="Ej. T/T 30%"/>
                            </div>

                            <!-- SECCIÓN LOGÍSTICA (GLOBAL) -->
                            <div class="full-width form-section-title mt-3">
                                <i class="fa fa-globe me-2"></i> <span data-i18n="sec_logistics">Logística (Global)</span>
                            </div>

                            <div class="form-group">
                                <label><span data-i18n="lbl_origin">Origen (Puerto)</span></label>
                                <input type="text" id="h-origin" class="form-control" data-i18n-placeholder="ph_origin" placeholder="Ej. Shanghai"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_dest">Destino (Puerto)</span></label>
                                <input type="text" id="h-dest" class="form-control" data-i18n-placeholder="ph_dest" placeholder="Ej. Manzanillo"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_country">País Origen</span></label>
                                <input type="text" id="h-country" class="form-control" data-i18n-placeholder="ph_country" placeholder="Ej. China"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_vessel">Buque / Viaje</span></label>
                                <input type="text" id="h-vessel" class="form-control" data-i18n-placeholder="ph_vessel" placeholder="Ej. MAERSK SEALAND"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_incoterm">Incoterm</span></label>
                                <input type="text" id="h-incoterm" class="form-control" data-i18n-placeholder="ph_incoterm" placeholder="Ej. CIF"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_status">Estatus</span></label>
                                <select id="h-status" class="form-control">
                                    <option value="" data-i18n="opt_select">Seleccionar...</option>
                                    <option value="En Producción" data-i18n="opt_production">En Producción</option>
                                    <option value="En Puerto Origen" data-i18n="opt_origin_port">En Puerto Origen</option>
                                    <option value="En Tránsito" data-i18n="opt_transit">En Tránsito</option>
                                    <option value="En Puerto Destino" data-i18n="opt_dest_port">En Puerto Destino</option>
                                </select>
                            </div>

                            <!-- SECCIÓN CARGA (VARIABLE POR CONTENEDOR) -->
                            <div class="full-width form-section-title mt-3 text-warning">
                                <i class="fa fa-cubes me-2"></i> <span data-i18n="sec_cargo">Detalles de Carga (Contenedor Actual)</span>
                            </div>

                            <div class="form-group">
                                <label class="text-warning"><span data-i18n="lbl_container">No. Contenedor</span> *</label>
                                <input type="text" id="h-cont-no" class="form-control border-warning" data-i18n-placeholder="ph_container" placeholder="Ej. MSKU1234567"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_seal">No. Sello</span></label>
                                <input type="text" id="h-seal" class="form-control" data-i18n-placeholder="ph_seal" placeholder="Ej. 123456"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_cont_type">Tipo Contenedor</span></label>
                                <input type="text" id="h-type" class="form-control" data-i18n-placeholder="ph_cont_type" placeholder="Ej. 40HC, 20GP"/>
                            </div>
                            
                            <div class="form-group">
                                <label><span data-i18n="lbl_packages">Total Paquetes</span></label>
                                <input type="number" id="h-pkgs" class="form-control" placeholder="0"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_weight">Peso Bruto (kg)</span></label>
                                <input type="number" step="0.01" id="h-weight" class="form-control" placeholder="0.00"/>
                            </div>
                            <div class="form-group">
                                <label><span data-i18n="lbl_volume">Volumen (m³)</span></label>
                                <input type="number" step="0.01" id="h-volume" class="form-control" placeholder="0.00"/>
                            </div>

                            <div class="form-group full-width">
                                <label><span data-i18n="lbl_desc">Descripción Mercancía</span></label>
                                <textarea id="h-desc" class="form-control" rows="2" data-i18n-placeholder="ph_desc" placeholder="Descripción general de la carga..."></textarea>
                            </div>
                            
                            <!-- NUEVO: SUBIDA DE ARCHIVOS -->
                            <div class="form-group full-width mt-2">
                                <label><i class="fa fa-paperclip me-1"></i> <span data-i18n="lbl_files">Adjuntar Documentos del Contenedor (PDF, Imágenes, Excel)</span></label>
                                <input type="file" id="h-files" class="form-control" multiple="multiple" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"/>
                                <small class="text-muted">Seleccione múltiples archivos si es necesario.</small>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- LISTA DE CONTENEDORES YA AGREGADOS (STAGED) -->
                <div id="staged-containers-area" class="mb-4 d-none">
                    <h5 class="text-white mb-2"><i class="fa fa-check-square-o me-2 text-success"></i> <span data-i18n="lbl_staged_title">Contenedores Listos para Enviar</span></h5>
                    <div class="table-responsive">
                        <table class="table table-dark table-sm table-bordered">
                            <thead>
                                <tr class="bg-secondary">
                                    <th>Contenedor</th>
                                    <th>Tipo</th>
                                    <th>Peso (kg)</th>
                                    <th>Vol (m³)</th>
                                    <th>Líneas</th>
                                    <th>Archivos</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="staged-containers-tbody">
                                <!-- JS llenará esto -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- PACKING LIST -->
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h4 class="text-white m-0"><i class="fa fa-list-ul me-2 text-warning"/> <span data-i18n="pl_title">Detalle de Placas (Packing List)</span></h4>
                </div>

                <div class="alert alert-dark border border-secondary text-light mb-4" style="background: #1a1a1a;">
                    <small><i class="fa fa-info-circle text-warning me-1"/> <span data-i18n="pl_instruction">Ingrese las dimensiones de cada placa. El campo 'Contenedor' se llenará automáticamente al agregar el Packing List.</span></small>
                </div>

                <div id="portal-rows-container">
                    <div class="text-center py-5 text-muted">
                        <i class="fa fa-circle-o-notch fa-spin fa-2x"></i>
                        <p class="mt-2" data-i18n="loading">Cargando...</p>
                    </div>
                </div>
            </div>

            <!-- FOOTER CON NUEVOS BOTONES -->
            <div class="submit-footer">
                <div class="summary">
                    <div><span data-i18n="footer_total_plates">Total Placas (Actual):</span> <span id="total-plates">0</span></div>
                    <div>
                        <span data-i18n="footer_total_area">Total Área (Actual):</span> 
                        <span id="total-area">0.00</span> 
                        <span>m²</span>
                    </div>
                </div>
                
                <div class="d-flex gap-2">
                    <!-- BOTÓN AGREGAR SIGUIENTE -->
                    <button id="btn-add-next" class="btn btn-warning rounded-pill px-4 fw-bold">
                        <i class="fa fa-plus me-2"/> <span data-i18n="btn_add_next">Guardar Contenedor y Agregar Otro</span>
                    </button>

                    <!-- BOTÓN FINALIZAR -->
                    <button id="btn-submit-pl" class="btn-primary-custom" disabled="disabled">
                        <i class="fa fa-paper-plane me-2"/> <span data-i18n="btn_submit">Finalizar y Enviar Todo</span>
                    </button>
                </div>
            </div>

        </div>
    </t>
</templates>```

## ./views/purchase_order_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_purchase_order_form_inherit_supplier_portal" model="ir.ui.view">
        <field name="name">purchase.order.form.inherit.supplier.portal</field>
        <field name="model">purchase.order</field>
        <field name="inherit_id" ref="purchase.purchase_order_form"/>
        <field name="arch" type="xml">

            <xpath expr="//header" position="inside">
                <button name="action_open_supplier_link_wizard"
                        string="Portal Proveedor (PL)"
                        type="object"
                        class="btn-dark"
                        icon="fa-share-alt"
                        invisible="state not in ('purchase', 'done')"/>
            </xpath>

            <!-- Columnas adicionales en la tabla de líneas -->
            <xpath expr="//field[@name='order_line']/list/field[@name='product_qty']" position="after">
                <field name="x_qty_solicitada_original"
                       string="Solicitado Original"
                       optional="show"
                       readonly="1"/>
                <field name="x_qty_embarcada"
                       string="Embarcado (PL)"
                       optional="show"
                       readonly="1"/>
            </xpath>

            <xpath expr="//notebook" position="inside">
                <page string="Links Portal" invisible="not supplier_access_ids">
                    <field name="supplier_access_ids">
                        <list create="0" delete="0" edit="0">
                            <field name="create_date" string="Generado"/>
                            <field name="picking_id" string="Para Recepción"/>
                            <field name="expiration_date"/>
                            <field name="is_expired" widget="boolean_toggle"/>
                            <field name="portal_url" widget="CopyClipboardChar" readonly="1"/>
                        </list>
                    </field>
                </page>
            </xpath>

        </field>
    </record>
</odoo>```

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
                <field name="worksheet_imported" invisible="1"/>
                <field name="spreadsheet_id" invisible="1"/>
                <field name="ws_spreadsheet_id" invisible="1"/>
                <field name="packing_list_file" invisible="1"/>
                <field name="packing_list_filename" invisible="1"/>
                <field name="worksheet_file" invisible="1"/>
                <field name="worksheet_filename" invisible="1"/>
                <field name="supplier_access_ids" invisible="1"/>
            </field>
            
            <xpath expr="//header/button[@name='action_assign']" position="after">
                <button name="action_open_packing_list_spreadsheet"
                        string="Abrir PL"
                        type="object"
                        class="btn-primary"
                        icon="fa-table"
                        invisible="state in ('done', 'cancel', 'draft') or (picking_type_code != 'incoming' and not packing_list_imported) or packing_list_imported or worksheet_imported"/>

                <button name="action_import_packing_list"
                        string="Procesar PL"
                        type="object"
                        class="btn-secondary"
                        icon="fa-cogs"
                        invisible="state in ('done', 'cancel', 'draft') or (picking_type_code != 'incoming' and not packing_list_imported) or packing_list_imported or not spreadsheet_id or worksheet_imported"/>

                <button name="action_open_packing_list_spreadsheet"
                        string="Corregir PL"
                        type="object"
                        class="btn-warning"
                        icon="fa-edit"
                        invisible="state in ('done', 'cancel', 'draft') or not packing_list_imported or worksheet_imported"/>

                <button name="action_import_packing_list"
                        string="Reprocesar PL"
                        type="object"
                        class="btn-warning"
                        icon="fa-refresh"
                        invisible="state in ('done', 'cancel', 'draft') or not packing_list_imported or worksheet_imported"/>

                <button name="action_open_worksheet_spreadsheet"
                        string="Abrir WS"
                        type="object"
                        class="btn-info"
                        icon="fa-balance-scale"
                        invisible="state in ('done', 'cancel', 'draft') or not packing_list_imported"/>

                <button name="action_import_worksheet"
                        string="Procesar WS"
                        type="object"
                        class="btn-success"
                        icon="fa-check-square-o"
                        invisible="state in ('done', 'cancel', 'draft') or not packing_list_imported or not ws_spreadsheet_id"/>
            </xpath>

            <!-- Nueva Pestaña: Datos de Embarque -->
            <xpath expr="//notebook" position="inside">
                <page string="Datos de Embarque" invisible="(picking_type_code != 'incoming' and not packing_list_imported)">
                    <group>
                        <group string="Documentación">
                            <field name="supplier_invoice_number"/>
                            <field name="supplier_shipment_date"/>
                            <field name="supplier_proforma_number"/>
                            <field name="supplier_bl_number"/>
                            <field name="supplier_payment_terms"/> <!-- Nuevo Campo -->
                        </group>
                        <group string="Logística">
                            <field name="supplier_origin"/>
                            <field name="supplier_destination"/>
                            <field name="supplier_country_origin"/>
                            <field name="supplier_vessel"/>
                            <field name="supplier_incoterm_payment" string="Incoterm"/> <!-- Renombrado String -->
                            <field name="supplier_status"/>
                        </group>
                    </group>
                    <group string="Detalles de Carga">
                        <group>
                            <field name="supplier_container_no"/>
                            <field name="supplier_seal_no"/>
                            <field name="supplier_container_type"/>
                        </group>
                        <group>
                            <field name="supplier_total_packages"/>
                            <field name="supplier_gross_weight"/>
                            <field name="supplier_volume"/>
                        </group>
                    </group>
                    <group string="Descripción">
                        <field name="supplier_merchandise_desc" nolabel="1" placeholder="Descripción general de la mercancía..."/>
                    </group>
                </page>

                <page string="Acceso Proveedor" invisible="not supplier_access_ids">
                    <field name="supplier_access_ids" readonly="1">
                        <list create="0" delete="0" edit="0">
                            <field name="create_date" string="Generado"/>
                            <field name="purchase_id" string="Desde OC"/>
                            <field name="is_expired" widget="boolean_toggle"/>
                            <field name="portal_url" widget="CopyClipboardChar"/>
                        </list>
                    </field>
                </page>
            </xpath>

        </field>
    </record>
</odoo>```

## ./views/supplier_portal_templates.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <template id="portal_layout">
        <t t-call="web.frontend_layout">
            <t t-set="no_header" t-value="True"/>
            <t t-set="no_footer" t-value="True"/>
            <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"/>
            
            <t t-set="head">
                <t t-call-assets="web.assets_frontend" t-css="true" t-js="true"/>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&amp;display=swap" rel="stylesheet"/>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css"/>
            </t>
            <div class="supplier-portal-body">
                <t t-out="0"/>
            </div>
        </t>
    </template>

    <template id="supplier_portal_view">
        <t t-call="stock_lot_packing_import.portal_layout">
            
            <!-- Payload de datos para JS -->
            <div id="portal-data-store" style="display:none;" t-att-data-payload="portal_json"></div>

            <div class="o_portal_wrapper">
                <!-- HEADER ESTATICO -->
                <header class="o_portal_header">
                    <div class="brand">
                        <img src="/stock_lot_packing_import/static/description/icon.png" 
                             alt="Logo" 
                             class="me-3" 
                             style="height: 40px; width: auto; object-fit: contain;"/>
                        <span>PORTAL <span class="ms-1" data-i18n="header_provider">PROVEEDOR</span></span>
                    </div>

                    <div class="header-controls">
                        <!-- SELECTOR DE IDIOMA -->
                        <div class="lang-selector-wrapper">
                            <i class="fa fa-globe text-muted me-2"></i>
                            <select id="lang-selector" class="lang-select">
                                <option value="en" selected="selected">EN</option>
                                <option value="es">ES</option>
                                <option value="pt">PT</option>
                                <option value="it">IT</option>
                                <option value="zh">ZH</option>
                            </select>
                        </div>

                        <!-- INFO DE ORDEN -->
                        <div class="po-info">
                            <div><span class="label" data-i18n="po_label">Orden:</span> <span class="value" t-esc="picking.origin or 'N/A'"/></div>
                            <div><span class="label" data-i18n="receipt_label">Recep:</span> <span class="value" t-esc="picking.name"/></div>
                        </div>
                    </div>
                </header>

                <div class="o_portal_container">
                    
                    <!-- SECCIÓN: DATOS DE EMBARQUE -->
                    <div class="shipment-card">
                        <div class="card-header">
                            <i class="fa fa-ship fa-lg"></i>
                            <h3 data-i18n="shipment_data_title">Datos de Embarque</h3>
                        </div>
                        <div class="card-body" id="shipment-info-form">
                            
                            <!-- NOTA INFORMATIVA MULTI-CONTENEDOR -->
                            <div class="alert alert-info mb-3 p-2" style="font-size: 0.85rem;">
                                <i class="fa fa-info-circle me-1"></i> 
                                <span data-i18n="msg_multi_pl_info">Los datos de Documentación y Logística se mantendrán para todos los contenedores. Solo debe actualizar la sección 'Detalles de Carga' y 'Productos' por cada Packing List.</span>
                            </div>

                            <!-- SECCIÓN 1: DOCUMENTACIÓN (GLOBAL) -->
                            <div class="form-section-title">
                                <i class="fa fa-file-invoice me-2"></i> Documentación (Global)
                            </div>
                            <div class="modern-form-grid mb-4">
                                <div class="form-group">
                                    <label><span data-i18n="lbl_invoice">No. de Factura</span></label>
                                    <input type="text" id="h-invoice" class="form-control" data-i18n-placeholder="ph_invoice" placeholder="Ej. INV-2024-001"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_date">Fecha Embarque</span></label>
                                    <input type="date" id="h-date" class="form-control"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_proforma">No. Proforma (PI)</span></label>
                                    <input type="text" id="h-proforma" class="form-control" data-i18n-placeholder="ph_proforma" placeholder="Ej. PI-9920"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_bl">No. B/L</span></label>
                                    <input type="text" id="h-bl" class="form-control" data-i18n-placeholder="ph_bl" placeholder="Ej. COSU123456"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_payment">Forma de Pago</span></label>
                                    <input type="text" id="h-payment" class="form-control" data-i18n-placeholder="ph_payment" placeholder="Ej. T/T 30%"/>
                                </div>
                            </div>

                            <!-- SECCIÓN 2: LOGÍSTICA (GLOBAL) -->
                            <div class="form-section-title">
                                <i class="fa fa-globe me-2"></i> <span data-i18n="sec_logistics">Logística (Global)</span>
                            </div>
                            <div class="modern-form-grid mb-4">
                                <div class="form-group">
                                    <label><span data-i18n="lbl_origin">Origen (Puerto)</span></label>
                                    <input type="text" id="h-origin" class="form-control" data-i18n-placeholder="ph_origin" placeholder="Ej. Shanghai"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_dest">Destino (Puerto)</span></label>
                                    <input type="text" id="h-dest" class="form-control" data-i18n-placeholder="ph_dest" placeholder="Ej. Manzanillo"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_country">País Origen</span></label>
                                    <input type="text" id="h-country" class="form-control" data-i18n-placeholder="ph_country" placeholder="Ej. China"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_vessel">Buque / Viaje</span></label>
                                    <input type="text" id="h-vessel" class="form-control" data-i18n-placeholder="ph_vessel" placeholder="Ej. MAERSK SEALAND"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_incoterm">Incoterm</span></label>
                                    <input type="text" id="h-incoterm" class="form-control" data-i18n-placeholder="ph_incoterm" placeholder="Ej. CIF"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_status">Estatus</span></label>
                                    <select id="h-status" class="form-control">
                                        <option value="" data-i18n="opt_select">Seleccionar...</option>
                                        <option value="En Producción" data-i18n="opt_production">En Producción</option>
                                        <option value="En Puerto Origen" data-i18n="opt_origin_port">En Puerto Origen</option>
                                        <option value="En Tránsito" data-i18n="opt_transit">En Tránsito</option>
                                        <option value="En Puerto Destino" data-i18n="opt_dest_port">En Puerto Destino</option>
                                    </select>
                                </div>
                            </div>

                            <!-- SECCIÓN 3: DETALLES DE CARGA (VARIABLE) -->
                            <div class="form-section-title text-warning">
                                <i class="fa fa-cubes me-2"></i> <span data-i18n="sec_cargo">Detalles de Carga (Contenedor Actual)</span>
                            </div>
                            <div class="modern-form-grid">
                                <div class="form-group">
                                    <label class="text-warning"><span data-i18n="lbl_container">No. Contenedor</span> *</label>
                                    <input type="text" id="h-cont-no" class="form-control border-warning" data-i18n-placeholder="ph_container" placeholder="Ej. MSKU1234567"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_seal">No. Sello</span></label>
                                    <input type="text" id="h-seal" class="form-control" data-i18n-placeholder="ph_seal" placeholder="Ej. 123456"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_cont_type">Tipo Contenedor</span></label>
                                    <input type="text" id="h-type" class="form-control" data-i18n-placeholder="ph_cont_type" placeholder="Ej. 40HC, 20GP"/>
                                </div>
                                
                                <div class="form-group">
                                    <label><span data-i18n="lbl_packages">Total Paquetes</span></label>
                                    <input type="number" id="h-pkgs" class="form-control" placeholder="0"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_weight">Peso Bruto (kg)</span></label>
                                    <input type="number" step="0.01" id="h-weight" class="form-control" placeholder="0.00"/>
                                </div>
                                <div class="form-group">
                                    <label><span data-i18n="lbl_volume">Volumen (m³)</span></label>
                                    <input type="number" step="0.01" id="h-volume" class="form-control" placeholder="0.00"/>
                                </div>

                                <div class="form-group full-width">
                                    <label><span data-i18n="lbl_desc">Descripción Mercancía</span></label>
                                    <textarea id="h-desc" class="form-control" rows="2" data-i18n-placeholder="ph_desc" placeholder="Descripción general de la carga..."></textarea>
                                </div>

                                <!-- SUBIDA DE ARCHIVOS -->
                                <div class="form-group full-width mt-2">
                                    <label><i class="fa fa-paperclip me-1"></i> <span data-i18n="lbl_files">Adjuntar Documentos del Contenedor (PDF, Imágenes, Excel)</span></label>
                                    <input type="file" id="h-files" class="form-control" multiple="multiple" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"/>
                                    <small class="text-muted">Seleccione múltiples archivos si es necesario.</small>
                                </div>
                            </div>
                            
                        </div>
                    </div>

                    <!-- NUEVO: LISTA DE CONTENEDORES YA AGREGADOS (STAGED) -->
                    <!-- El JS le quita el d-none cuando agregas el primero -->
                    <div id="staged-containers-area" class="mb-4 d-none">
                        <h5 class="text-white mb-2"><i class="fa fa-check-square-o me-2 text-success"></i> <span data-i18n="lbl_staged_title">Contenedores Listos para Enviar</span></h5>
                        <div class="table-responsive">
                            <table class="table table-dark table-sm table-bordered">
                                <thead>
                                    <tr class="bg-secondary">
                                        <th>Contenedor</th>
                                        <th>Tipo</th>
                                        <th>Peso (kg)</th>
                                        <th>Vol (m³)</th>
                                        <th>Líneas</th>
                                        <th>Archivos</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody id="staged-containers-tbody">
                                    <!-- JS llenará esto -->
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- TITULO PACKING LIST -->
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h4 class="text-white m-0"><i class="fa fa-list-ul me-2 text-warning"/> <span data-i18n="pl_title">Detalle de Placas (Packing List)</span></h4>
                    </div>

                    <div class="alert alert-dark border border-secondary text-light mb-4" style="background: #1a1a1a;">
                        <small><i class="fa fa-info-circle text-warning me-1"/> <span data-i18n="pl_instruction">Ingrese las dimensiones de cada placa. El campo 'Contenedor' se llenará automáticamente al agregar el Packing List.</span></small>
                    </div>

                    <!-- TABLAS JS -->
                    <div id="portal-rows-container">
                        <div class="text-center py-5 text-muted">
                            <i class="fa fa-circle-o-notch fa-spin fa-2x"></i>
                            <p class="mt-2" data-i18n="loading">Cargando...</p>
                        </div>
                    </div>
                </div>

                <!-- FOOTER CON DOS BOTONES -->
                <div class="submit-footer">
                    <div class="summary">
                        <div><span data-i18n="footer_total_plates">Total Placas (Actual):</span> <span id="total-plates">0</span></div>
                        <div>
                            <span data-i18n="footer_total_area">Total Área (Actual):</span> 
                            <span id="total-area">0.00</span> 
                            <span>m²</span>
                        </div>
                    </div>
                    
                    <div class="d-flex gap-2">
                        <!-- BOTÓN MAGICO -->
                        <button id="btn-add-next" type="button" class="btn btn-warning rounded-pill px-4 fw-bold">
                            <i class="fa fa-plus me-2"/> <span data-i18n="btn_add_next">Guardar Contenedor y Agregar Otro</span>
                        </button>

                        <!-- BOTÓN FINALIZAR -->
                        <button id="btn-submit-pl" type="button" class="btn-primary-custom" disabled="disabled">
                            <i class="fa fa-paper-plane me-2"/> <span data-i18n="btn_submit">Finalizar y Enviar Todo</span>
                        </button>
                    </div>
                </div>
            </div>
        </t>
    </template>

    <template id="portal_not_found">
        <t t-call="stock_lot_packing_import.portal_layout">
            <div class="container text-center py-5">
                <h1 class="display-1 text-danger">404</h1>
                <p class="lead">Invalid Link.</p>
            </div>
        </t>
    </template>

    <template id="portal_expired">
        <t t-call="stock_lot_packing_import.portal_layout">
            <div class="container text-center py-5">
                <h1 class="display-1 text-warning"><i class="fa fa-clock-o"/></h1>
                <p class="lead">Link Expired.</p>
            </div>
        </t>
    </template>
</odoo>```

## ./wizard/__init__.py
```py
# -*- coding: utf-8 -*-
from . import packing_list_import_wizard
from . import worksheet_import_wizard
from . import supplier_link_wizard
```

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
                    <!-- Campo invisible para controlar la lógica visual -->
                    <field name="spreadsheet_id" invisible="1"/>
                    
                    <group>
                        <field name="picking_id" readonly="1"/>
                        
                        <!-- Mostramos el cargador de archivos SOLO si NO hay Spreadsheet -->
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename" 
                               invisible="spreadsheet_id != False" 
                               required="spreadsheet_id == False"/>
                    </group>

                    <group>
                        <!-- Mensaje informativo cuando se usa Spreadsheet -->
                        <div class="alert alert-success" role="alert" invisible="spreadsheet_id == False">
                            <p><strong><i class="fa fa-table"></i> Hoja de Cálculo detectada:</strong></p>
                            <p>El sistema procesará los datos que ingresaste en la plantilla nativa de Odoo. No es necesario subir ningún archivo.</p>
                        </div>

                        <!-- Instrucciones cuando se usa Archivo Excel -->
                        <div class="alert alert-info" role="alert" invisible="spreadsheet_id != False">
                            <p><strong>Instrucciones:</strong></p>
                            <ul>
                                <li>Suba el archivo Excel del Packing List.</li>
                                <li>Los lotes se crearán automáticamente con numeración secuencial.</li>
                            </ul>
                        </div>
                    </group>
                </sheet>
                <footer>
                    <button string="Procesar e Importar" name="action_import_excel" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>```

## ./wizard/packing_list_import_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, _, api
from odoo.exceptions import UserError
import base64
import io
import json
import logging
import re

_logger = logging.getLogger(__name__)


class _PLCellsIndex:
    """Clase para normalizar el acceso a celdas de Odoo Spreadsheet"""

    def __init__(self):
        self._cells = {}

    def put(self, col, row, content, source="unknown"):
        if col is not None and row is not None:
            if content in (None, False, ""):
                if (int(col), int(row)) in self._cells:
                    del self._cells[(int(col), int(row))]
            else:
                self._cells[(int(col), int(row))] = str(content)

    def ingest_cells(self, raw_cells):
        if not raw_cells:
            return
        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is not None and row is not None:
                content = self._extract_content(cell_data)
                if content:
                    self.put(col, row, content, source="snapshot")

    def _parse_cell_key(self, key):
        if isinstance(key, str) and key and key[0].isalpha():
            match = re.match(r'^([A-Z]+)(\d+)$', key.upper())
            if match:
                col_str, row_str = match.groups()
                col = 0
                for char in col_str:
                    col = col * 26 + (ord(char) - ord('A') + 1)
                return col - 1, int(row_str) - 1
        if isinstance(key, str) and ',' in key:
            parts = key.split(',')
            if len(parts) == 2:
                try:
                    return int(parts[0]), int(parts[1])
                except:
                    pass
        return None, None

    def _extract_content(self, cell_data):
        if isinstance(cell_data, dict):
            return cell_data.get('content') or cell_data.get('value') or cell_data.get('text') or ""
        return cell_data or ""

    def apply_revision_commands(self, commands, target_sheet_id):
        applied = 0
        for cmd in commands:
            if isinstance(cmd, list):
                applied += self.apply_revision_commands(cmd, target_sheet_id)
                continue
            if cmd.get('sheetId') and cmd.get('sheetId') != target_sheet_id:
                continue
            cmd_type = cmd.get('type')
            if cmd_type == 'UPDATE_CELL':
                col, row = cmd.get('col'), cmd.get('row')
                if col is not None and row is not None:
                    content = self._extract_content(cmd)
                    self.put(col, row, content, source="UPDATE_CELL_REV")
                    applied += 1
            elif cmd_type == 'REMOVE_COLUMNS_ROWS':
                if cmd.get('dimension') == 'row':
                    elements = sorted(cmd.get('elements', []), reverse=True)
                    for row_idx in elements:
                        self._shift_rows_up(row_idx)
                    applied += 1
            elif cmd_type in ('DELETE_CONTENT', 'CLEAR_CELL'):
                zones = cmd.get('zones') or cmd.get('target') or []
                for zone in zones:
                    for r in range(zone.get('top', 0), zone.get('bottom', 0) + 1):
                        for c in range(zone.get('left', 0), zone.get('right', 0) + 1):
                            self.put(c, r, "", source="DELETE_REV")
                applied += 1
        return applied

    def _shift_rows_up(self, removed_row):
        new_cells = {}
        for (c, r), val in self._cells.items():
            if r < removed_row:
                new_cells[(c, r)] = val
            elif r > removed_row:
                new_cells[(c, r - 1)] = val
        self._cells = new_cells

    def value(self, col, row):
        return self._cells.get((int(col), int(row)))


class PackingListImportWizard(models.TransientModel):
    _name = 'packing.list.import.wizard'
    _description = 'Importar Packing List'

    picking_id = fields.Many2one('stock.picking', string='Recepción', required=True, readonly=True)
    spreadsheet_id = fields.Many2one('documents.document', related='picking_id.spreadsheet_id', readonly=True)
    excel_file = fields.Binary(string='Archivo Excel', required=False, attachment=False)
    excel_filename = fields.Char(string='Nombre del archivo')

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== [PL_IMPORT] INICIO PROCESO DE CARGA ===")

        rows = []
        if self.excel_file:
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            rows = self._get_data_from_spreadsheet()

        _logger.info(f"[PL_IMPORT] Resultado Final: {len(rows)} filas listas para importar.")

        if not rows:
            raise UserError("No se encontraron datos válidos. Verifique las dimensiones o cantidades.")

        # --- LÓGICA DE LIMPIEZA PROFUNDA ---
        _logger.info("[PL_CLEANUP] Borrando datos previos...")
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped('lot_id')

        old_move_lines.write({'qty_done': 0})
        self.env.flush_all()
        if old_lots:
            quants = self.env['stock.quant'].sudo().search([('lot_id', 'in', old_lots.ids)])
            quants.sudo().unlink()

        old_move_lines.unlink()
        for lot in old_lots:
            if self.env['stock.move.line'].search_count([('lot_id', '=', lot.id)]) == 0:
                try:
                    with self.env.cr.savepoint():
                        lot.unlink()
                except Exception as e:
                    _logger.warning(f"[PL_CLEANUP] No se pudo borrar lote {lot.name}: {e}")

        # --- CREACIÓN DE NUEVOS REGISTROS ---
        move_lines_created = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data['product']
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]
            if not move:
                continue

            unit_type = data.get('tipo', 'Placa')

            qty_done = 0.0
            final_alto = 0.0
            final_ancho = 0.0

            if unit_type == 'Placa':
                final_alto = data.get('alto', 0.0)
                final_ancho = data.get('ancho', 0.0)
                qty_done = round(final_alto * final_ancho, 3)
            else:
                qty_done = data.get('quantity', 0.0)
                final_alto = 0.0
                final_ancho = 0.0

            if qty_done <= 0:
                continue

            cont = data['contenedor'] or 'SN'
            if cont not in containers:
                containers[cont] = {
                    'pre': str(next_prefix),
                    'num': self._get_next_lot_number_for_prefix(str(next_prefix))
                }
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"

            grupo_ids = []
            if data.get('grupo_name'):
                grupo = self.env['stock.lot.group'].search([('name', '=', data['grupo_name'].strip())], limit=1)
                if not grupo:
                    grupo = self.env['stock.lot.group'].create({'name': data['grupo_name'].strip()})
                grupo_ids = [grupo.id]

            lot_selection_value = str(unit_type).lower()

            lot = self.env['stock.lot'].create({
                'name': l_name,
                'product_id': product.id,
                'company_id': self.picking_id.company_id.id,
                'x_grosor': data['grosor'],
                'x_alto': final_alto,
                'x_ancho': final_ancho,
                'x_color': data.get('color'),
                'x_bloque': data['bloque'],
                'x_numero_placa': data.get('numero_placa'),
                'x_atado': data['atado'],
                'x_tipo': lot_selection_value,
                'x_grupo': [(6, 0, grupo_ids)],
                'x_pedimento': data['pedimento'],
                'x_contenedor': cont,
                'x_referencia_proveedor': data['ref_proveedor'],
            })

            self.env['stock.move.line'].create({
                'move_id': move.id,
                'product_id': product.id,
                'lot_id': lot.id,
                'qty_done': qty_done,
                'location_id': self.picking_id.location_id.id,
                'location_dest_id': self.picking_id.location_dest_id.id,
                'picking_id': self.picking_id.id,
                'x_grosor_temp': data['grosor'],
                'x_alto_temp': final_alto,
                'x_ancho_temp': final_ancho,
                'x_color_temp': data.get('color'),
                'x_tipo_temp': lot_selection_value,
                'x_bloque_temp': data['bloque'],
                'x_atado_temp': data['atado'],
                'x_pedimento_temp': data['pedimento'],
                'x_contenedor_temp': cont,
                'x_referencia_proveedor_temp': data['ref_proveedor'],
                'x_grupo_temp': [(6, 0, grupo_ids)],
            })
            containers[cont]['num'] += 1
            move_lines_created += 1

        # --- SINCRONIZACIÓN WORKSHEET ---
        if self.picking_id.ws_spreadsheet_id:
            try:
                self.picking_id.ws_spreadsheet_id.sudo().unlink()
                self.picking_id.write({'worksheet_imported': False})
                _logger.info("[PL_IMPORT] Worksheet antiguo eliminado para forzar sincronización.")
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] No se pudo eliminar el Worksheet anterior: {e}")

        self.picking_id.write({'packing_list_imported': True})

        # ── SINCRONIZAR CANTIDADES EN LÍNEAS DE LA OC ─────────────────────────
        self._sync_quantities_to_po_lines()
        # ──────────────────────────────────────────────────────────────────────

        _logger.info(f"=== [PL_IMPORT] PROCESO TERMINADO. Creados {move_lines_created} registros. ===")
        return {
            'type': 'ir.actions.client', 'tag': 'display_notification',
            'params': {
                'title': 'PL Procesado',
                'message': f'Se han importado/corregido {move_lines_created} lotes. El Worksheet ha sido reiniciado.',
                'type': 'success', 'next': {'type': 'ir.actions.act_window_close'}
            }
        }

    def _sync_quantities_to_po_lines(self):
        picking = self.picking_id
        po = self.env['purchase.order'].search([('picking_ids', 'in', picking.id)], limit=1)

        if not po:
            _logger.warning("[PL_SYNC] No se encontró PO asociada al picking.")
            return

        for po_line in po.order_line:
            product = po_line.product_id
            move_lines = picking.move_line_ids.filtered(lambda ml: ml.product_id == product)
            total_embarcado = sum(ml.qty_done for ml in move_lines)

            if total_embarcado <= 0:
                continue

            vals = {'x_qty_embarcada': total_embarcado}
            if not po_line.x_qty_solicitada_original:
                vals['x_qty_solicitada_original'] = po_line.product_qty
            vals['product_qty'] = total_embarcado
            po_line.write(vals)

        _logger.info(f"[PL_SYNC] Cantidades sincronizadas a la OC {po.name}.")

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        _logger.info(f"[PL_DEBUG] Doc ID: {doc.id} | snapshot: {bool(doc.spreadsheet_snapshot)} | data: {bool(doc.spreadsheet_data)}")
        spreadsheet_json = self._get_current_spreadsheet_state(doc)
        if not spreadsheet_json or not spreadsheet_json.get('sheets'):
            _logger.warning("[PL_DEBUG] spreadsheet_json vacío o sin sheets")
            return []

        _logger.info(f"[PL_DEBUG] Sheets encontrados: {[s.get('name') for s in spreadsheet_json.get('sheets', [])]}")

        all_rows = []
        for sheet in spreadsheet_json['sheets']:
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get('cells', {}))
            _logger.info(f"[PL_DEBUG] Sheet '{sheet.get('name')}': {len(idx._cells)} celdas tras ingest")

            product = self._identify_product_from_sheet(idx)
            _logger.info(f"[PL_DEBUG] Producto identificado: {product.name if product else 'NINGUNO'}")

            if product:
                sheet_rows = self._extract_rows_from_index(idx, product)
                _logger.info(f"[PL_DEBUG] Filas extraídas para '{product.name}': {len(sheet_rows)}")
                all_rows.extend(sheet_rows)
        return all_rows

    def _get_current_spreadsheet_state(self, doc):
        _logger.info(f"[PL_DEBUG] snapshot existe: {bool(doc.spreadsheet_snapshot)} | len: {len(doc.spreadsheet_snapshot) if doc.spreadsheet_snapshot else 0}")
        _logger.info(f"[PL_DEBUG] spreadsheet_data existe: {bool(doc.spreadsheet_data)} | len: {len(doc.spreadsheet_data) if doc.spreadsheet_data else 0}")

        if doc.spreadsheet_snapshot:
            try:
                data = doc.spreadsheet_snapshot
                parsed = json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
                sheets_count = len(parsed.get('sheets', []))
                _logger.info(f"[PL_DEBUG] snapshot parseado OK | sheets: {sheets_count} | revisionId: {parsed.get('revisionId', 'N/A')}")
                if parsed and parsed.get('sheets'):
                    return self._apply_pending_revisions(doc, parsed)
            except Exception as e:
                _logger.warning(f"[PL_IMPORT] Error leyendo snapshot: {e}")

        try:
            if hasattr(doc, '_get_spreadsheet_serialized_snapshot'):
                snapshot_data = doc._get_spreadsheet_serialized_snapshot()
                _logger.info(f"[PL_DEBUG] _get_spreadsheet_serialized_snapshot: {bool(snapshot_data)}")
                if snapshot_data:
                    parsed = json.loads(snapshot_data) if isinstance(snapshot_data, str) else snapshot_data
                    if parsed and parsed.get('sheets'):
                        return self._apply_pending_revisions(doc, parsed)
        except Exception as e:
            _logger.warning(f"[PL_IMPORT] Error en _get_spreadsheet_serialized_snapshot: {e}")

        _logger.info("[PL_IMPORT] Fallback: spreadsheet_data + todas las revisiones")
        return self._load_spreadsheet_with_all_revisions(doc)

    def _apply_pending_revisions(self, doc, spreadsheet_json):
        snapshot_revision_id = spreadsheet_json.get('revisionId', '')
        _logger.info(f"[PL_DEBUG] _apply_pending_revisions | revisionId snapshot: '{snapshot_revision_id}'")

        if not snapshot_revision_id:
            _logger.info("[PL_DEBUG] Sin revisionId en snapshot, retornando json tal cual")
            return spreadsheet_json

        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')
        _logger.info(f"[PL_DEBUG] Revisiones totales en BD: {len(revisions)}")

        start_applying = False
        all_cmds = []

        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            if not start_applying:
                rev_id = rev_data.get('id') if isinstance(rev_data, dict) else None
                if rev_id == snapshot_revision_id:
                    start_applying = True
                continue
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)

        _logger.info(f"[PL_DEBUG] Comandos pendientes a aplicar tras snapshot: {len(all_cmds)}")

        if not all_cmds:
            _logger.info("[PL_DEBUG] Sin comandos pendientes, retornando snapshot directo")
            return spreadsheet_json

        for sheet in spreadsheet_json.get('sheets', []):
            sheet_id = sheet.get('id')
            idx = _PLCellsIndex()
            cells_before = len(sheet.get('cells', {}))
            idx.ingest_cells(sheet.get('cells', {}))
            applied = idx.apply_revision_commands(all_cmds, sheet_id)
            _logger.info(f"[PL_DEBUG] Sheet '{sheet.get('name')}' | celdas antes: {cells_before} | cmds aplicados: {applied} | celdas después: {len(idx._cells)}")
            sheet['cells'] = {
                f"{self._col_to_letter(c)}{r + 1}": {'content': v}
                for (c, r), v in idx._cells.items()
            }

        return spreadsheet_json

    def _load_spreadsheet_with_all_revisions(self, doc):
        spreadsheet_json = self._load_spreadsheet_json(doc)
        _logger.info(f"[PL_DEBUG] _load_spreadsheet_json: {bool(spreadsheet_json)} | sheets: {len(spreadsheet_json.get('sheets', [])) if spreadsheet_json else 0}")
        if not spreadsheet_json:
            return None

        revisions = self.env['spreadsheet.revision'].sudo().with_context(active_test=False).search([
            ('res_model', '=', 'documents.document'),
            ('res_id', '=', doc.id)
        ], order='id asc')
        _logger.info(f"[PL_DEBUG] Revisiones en fallback: {len(revisions)}")

        all_cmds = []
        for rev in revisions:
            rev_data = json.loads(rev.commands) if isinstance(rev.commands, str) else rev.commands
            if isinstance(rev_data, dict) and rev_data.get('type') == 'SNAPSHOT_CREATED':
                continue
            if isinstance(rev_data, dict) and 'commands' in rev_data:
                all_cmds.extend(rev_data['commands'])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)

        _logger.info(f"[PL_DEBUG] Comandos totales en fallback: {len(all_cmds)}")

        for sheet in spreadsheet_json.get('sheets', []):
            idx = _PLCellsIndex()
            cells_before = len(sheet.get('cells', {}))
            idx.ingest_cells(sheet.get('cells', {}))
            applied = idx.apply_revision_commands(all_cmds, sheet.get('id'))
            _logger.info(f"[PL_DEBUG] Fallback sheet '{sheet.get('name')}' | celdas antes: {cells_before} | cmds: {applied} | celdas después: {len(idx._cells)}")

            # Log muestra las primeras celdas para verificar contenido
            sample = list(idx._cells.items())[:10]
            _logger.info(f"[PL_DEBUG] Muestra celdas: {sample}")

            sheet['cells'] = {
                f"{self._col_to_letter(c)}{r + 1}": {'content': v}
                for (c, r), v in idx._cells.items()
            }

        return spreadsheet_json

    def _col_to_letter(self, col):
        result = ""
        col += 1
        while col:
            col, remainder = divmod(col - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def _identify_product_from_sheet(self, idx):
        p_info = None
        for r in range(3):
            label = str(idx.value(0, r) or "").upper()
            val_b = idx.value(1, r)
            _logger.info(f"[PL_DEBUG] identify fila {r}: A='{label}' B='{val_b}'")
            if "PRODUCTO:" in label:
                p_info = val_b
                break
        if not p_info:
            p_info = idx.value(1, 0)
        if not p_info:
            _logger.warning("[PL_DEBUG] No se encontró info de producto en la hoja")
            return None
        p_name = str(p_info).split('(')[0].strip()
        _logger.info(f"[PL_DEBUG] Buscando producto con nombre: '{p_name}'")
        result = self.env['product.product'].search(
            ['|', ('name', '=', p_name), ('default_code', '=', p_name)], limit=1
        )
        if not result:
            _logger.warning(f"[PL_DEBUG] Producto '{p_name}' NO encontrado en BD")
        return result

    def _extract_rows_from_index(self, idx, product):
        rows = []
        unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
        _logger.info(f"[PL_DEBUG] Extrayendo filas para '{product.name}' | unit_type: {unit_type}")

        if unit_type == 'Placa':
            idx_peso = 3
            idx_notas = 4
            idx_bloque = 5
            idx_placa = 6
            idx_atado = 7
            idx_grupo = 8
            idx_pedimento = 9
            idx_contenedor = 10
            idx_ref = 11
        else:
            idx_peso = 2
            idx_notas = 3
            idx_bloque = 4
            idx_placa = 5
            idx_atado = 6
            idx_grupo = 7
            idx_pedimento = 8
            idx_contenedor = 9
            idx_ref = 10

        filas_validas = 0
        filas_invalidas = 0

        for r in range(3, 300):
            val_b = self._to_float(idx.value(1, r))
            val_c = self._to_float(idx.value(2, r))

            es_valido = False
            if unit_type == 'Placa':
                if val_b > 0 and val_c > 0:
                    es_valido = True
            else:
                if val_b > 0:
                    es_valido = True

            if es_valido:
                filas_validas += 1
                rows.append({
                    'product': product,
                    'grosor': str(idx.value(0, r) or '').strip(),
                    'alto': val_b if unit_type == 'Placa' else 0.0,
                    'ancho': val_c if unit_type == 'Placa' else 0.0,
                    'quantity': val_b if unit_type != 'Placa' else 0.0,
                    'color': str(idx.value(idx_notas, r) or '').strip(),
                    'bloque': str(idx.value(idx_bloque, r) or '').strip(),
                    'numero_placa': str(idx.value(idx_placa, r) or '').strip(),
                    'atado': str(idx.value(idx_atado, r) or '').strip(),
                    'tipo': unit_type,
                    'grupo_name': str(idx.value(idx_grupo, r) or '').strip(),
                    'pedimento': str(idx.value(idx_pedimento, r) or '').strip(),
                    'contenedor': str(idx.value(idx_contenedor, r) or 'SN').strip(),
                    'ref_proveedor': str(idx.value(idx_ref, r) or '').strip(),
                })
            else:
                # Solo loggear las primeras 5 filas inválidas no vacías para no saturar
                if filas_invalidas < 5 and (idx.value(0, r) or idx.value(1, r) or idx.value(2, r)):
                    _logger.info(f"[PL_DEBUG] Fila {r+1} inválida | A='{idx.value(0,r)}' B='{idx.value(1,r)}' C='{idx.value(2,r)}'")
                    filas_invalidas += 1

        _logger.info(f"[PL_DEBUG] Total filas válidas: {filas_validas} | inválidas con contenido: {filas_invalidas}")
        return rows

    def _to_float(self, val):
        if not val:
            return 0.0
        try:
            return float(str(val).replace(',', '.').strip())
        except:
            return 0.0

    def _get_next_global_prefix(self):
        self.env.cr.execute(
            """SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
               FROM stock_lot
               WHERE name ~ '^[0-9]+-[0-9]+$' AND company_id = %s
               ORDER BY prefix_num DESC LIMIT 1""",
            (self.picking_id.company_id.id,)
        )
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute(
            """SELECT name FROM stock_lot
               WHERE name LIKE %s AND company_id = %s
               ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC LIMIT 1""",
            (f'{prefix}-%', self.picking_id.company_id.id)
        )
        res = self.env.cr.fetchone()
        return int(res[0].split('-')[1]) + 1 if res else 1

    def _load_spreadsheet_json(self, doc):
        if doc.spreadsheet_data:
            try:
                data = doc.spreadsheet_data
                return json.loads(data.decode('utf-8') if isinstance(data, bytes) else data)
            except:
                pass
        return None

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []
        for sheet in wb.worksheets:
            p_info = sheet['B1'].value
            if not p_info:
                continue
            product = self.env['product.product'].search(
                [('name', 'ilike', str(p_info).split('(')[0].strip())], limit=1
            )
            if not product:
                continue

            unit_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'

            if unit_type == 'Placa':
                col_notas = 5
                col_bloque = 6
                col_placa = 7
                col_atado = 8
                col_grupo = 9
                col_pedimento = 10
                col_contenedor = 11
                col_ref = 12
            else:
                col_notas = 4
                col_bloque = 5
                col_placa = 6
                col_atado = 7
                col_grupo = 8
                col_pedimento = 9
                col_contenedor = 10
                col_ref = 11

            for r in range(4, sheet.max_row + 1):
                val_b = self._to_float(sheet.cell(r, 2).value)
                val_c = self._to_float(sheet.cell(r, 3).value)

                es_valido = False
                if unit_type == 'Placa':
                    if val_b > 0 and val_c > 0:
                        es_valido = True
                else:
                    if val_b > 0:
                        es_valido = True

                if es_valido:
                    rows.append({
                        'product': product,
                        'grosor': str(sheet.cell(r, 1).value or '').strip(),
                        'alto': val_b if unit_type == 'Placa' else 0.0,
                        'ancho': val_c if unit_type == 'Placa' else 0.0,
                        'quantity': val_b if unit_type != 'Placa' else 0.0,
                        'color': str(sheet.cell(r, col_notas).value or '').strip(),
                        'bloque': str(sheet.cell(r, col_bloque).value or '').strip(),
                        'numero_placa': str(sheet.cell(r, col_placa).value or '').strip(),
                        'atado': str(sheet.cell(r, col_atado).value or '').strip(),
                        'tipo': unit_type,
                        'grupo_name': str(sheet.cell(r, col_grupo).value or '').strip(),
                        'pedimento': str(sheet.cell(r, col_pedimento).value or '').strip(),
                        'contenedor': str(sheet.cell(r, col_contenedor).value or 'SN').strip(),
                        'ref_proveedor': str(sheet.cell(r, col_ref).value or '').strip(),
                    })
        return rows```

## ./wizard/supplier_link_wizard_views.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="view_purchase_supplier_portal_link_wizard_form" model="ir.ui.view">
        <field name="name">purchase.supplier.portal.link.wizard.form</field>
        <field name="model">purchase.supplier.portal.link.wizard</field>
        <field name="arch" type="xml">
            <form string="Link Portal Proveedor">
                <sheet>
                    <group>
                        <field name="purchase_id" readonly="1"/>
                        <field name="picking_id" readonly="1"/>
                        <field name="expiration_date" readonly="1"/>
                    </group>

                    <group>
                        <!-- Copia con widget -->
                        <field name="portal_url" readonly="1" widget="CopyClipboardChar"/>
                    </group>

                    <div class="alert alert-info" role="alert">
                        Este link es único por Orden de Compra. Si vuelve a generar/abrir, se reutiliza el mismo token.
                    </div>
                </sheet>
                <footer>
                    <button string="Renovar vigencia / Actualizar recepción"
                            type="object"
                            name="action_refresh"
                            class="btn-primary"/>
                    <button string="Cerrar" special="cancel" class="btn-secondary"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>
```

## ./wizard/supplier_link_wizard.py
```py
# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class PurchaseSupplierPortalLinkWizard(models.TransientModel):
    _name = 'purchase.supplier.portal.link.wizard'
    _description = 'Wizard: Copiar Link Portal Proveedor'

    purchase_id = fields.Many2one('purchase.order', string='Orden de Compra', required=True, readonly=True)
    access_id = fields.Many2one('stock.picking.supplier.access', string='Acceso', readonly=True)

    portal_url = fields.Char(string='Link', readonly=True)
    expiration_date = fields.Datetime(string='Expira', readonly=True)
    picking_id = fields.Many2one('stock.picking', string='Recepción', readonly=True)

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        purchase_id = res.get('purchase_id') or self.env.context.get('default_purchase_id')
        if not purchase_id:
            return res

        po = self.env['purchase.order'].browse(purchase_id).exists()
        if not po:
            return res

        if po.state not in ['purchase', 'done']:
            raise UserError(_("Debe confirmar la Orden de Compra antes de generar el link."))

        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        res.update({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })
        return res

    def action_refresh(self):
        """Refresca picking vigente y renueva expiración manteniendo el mismo token."""
        self.ensure_one()
        po = self.purchase_id
        target_picking = po._get_target_incoming_picking_for_supplier_portal()
        if not target_picking:
            raise UserError(_("No se encontraron recepciones pendientes para esta Orden de Compra."))

        access = po._get_or_create_supplier_access(target_picking)

        self.write({
            'access_id': access.id,
            'portal_url': access.portal_url,
            'expiration_date': access.expiration_date,
            'picking_id': access.picking_id.id,
        })

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Link actualizado'),
                'message': _('Se renovó la vigencia y se apuntó a la recepción vigente. El link NO cambió.'),
                'type': 'success',
                'sticky': False,
            }
        }
```

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
                    <field name="ws_spreadsheet_id" invisible="1"/>
                    <group>
                        <field name="picking_id" readonly="1"/>
                        <field name="excel_filename" invisible="1"/>
                        <field name="excel_file" filename="excel_filename" 
                               invisible="ws_spreadsheet_id != False"/>
                    </group>
                    
                    <div class="alert alert-success" role="alert" invisible="ws_spreadsheet_id == False">
                        <p><strong><i class="fa fa-table"></i> Spreadsheet Detectado:</strong></p>
                        <p>El sistema leerá las columnas <strong>"ALTO REAL (m)"</strong> y <strong>"ANCHO REAL (m)"</strong> directamente de tu hoja de cálculo activa.</p>
                        <p>Asegúrate de haber guardado los cambios en el Spreadsheet antes de procesar.</p>
                    </div>

                    <div class="alert alert-info" role="alert" invisible="ws_spreadsheet_id != False">
                        <p>Sube el archivo Excel con las medidas reales si no estás usando la hoja de cálculo de Odoo.</p>
                    </div>
                </sheet>
                <footer>
                    <button string="Actualizar Medidas Reales" name="action_import_worksheet" type="object" class="btn-primary"/>
                    <button string="Cancelar" class="btn-secondary" special="cancel"/>
                </footer>
            </form>
        </field>
    </record>
</odoo>```

## ./wizard/worksheet_import_wizard.py
```py
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

            domain_base = [
                ('picking_id', '=', self.picking_id.id),
                ('lot_id.name', '=', lot_name)
            ]
            
            move_line = self.env['stock.move.line'].search(domain_base + [('product_id', '=', product.id)], limit=1)

            if not move_line:
                _logger.info(f"Fallback búsqueda lote: '{lot_name}' sin filtro de producto.")
                move_line = self.env['stock.move.line'].search(domain_base, limit=1)

            if not move_line or not move_line.lot_id:
                _logger.warning(f"No se encontró el lote '{lot_name}' para el producto {product.name} en esta recepción (Picking ID: {self.picking_id.id}).")
                continue

            lot = move_line.lot_id
            alto_real = data['alto_real']
            ancho_real = data['ancho_real']

            if alto_real == 0.0 and ancho_real == 0.0:
                m2_faltante = lot.x_alto * lot.x_ancho if lot.x_alto and lot.x_ancho else 0
                total_missing_pieces += 1
                total_missing_m2 += m2_faltante
                
                move_lines_to_delete.append(move_line)
                lots_to_delete.append(lot)
            else:
                lot.write({
                    'x_alto': alto_real,
                    'x_ancho': ancho_real
                })
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

            for r in range(3, 250):
                lot_name = str(idx.value(0, r) or '').strip()
                if not lot_name or lot_name == 'Nº Lote': continue

                alto_r = self._to_float(idx.value(13, r))
                ancho_r = self._to_float(idx.value(14, r))
                
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
            return 0.0```

