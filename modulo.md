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
    'version': '19.0.3.0.0',
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
"""
Fase 2: Controller del Portal de Proveedor — Endpoints jerárquicos.

Endpoints NUEVOS (v2) que leen/escriben en los modelos de stock_transit_allocation:
  - supplier.proforma.header
  - supplier.shipment
  - supplier.shipment.invoice
  - supplier.shipment.packing  (+rows)
  - supplier.shipment.container

Los endpoints VIEJOS (/supplier/pl/<token> y /supplier/pl/submit) se mantienen
como fallback para OCs que aún no tienen proforma.header.
"""
import json
import base64
from odoo import http
from odoo.http import request
from markupsafe import Markup
import logging

_logger = logging.getLogger(__name__)


class SupplierPortalController(http.Controller):

    # =====================================================================
    #  HELPERS
    # =====================================================================

    def _validate_token(self, token):
        """Retorna el access record o False."""
        access = request.env['stock.picking.supplier.access'].sudo().search(
            [('access_token', '=', token)], limit=1
        )
        if not access or access.is_expired:
            return False
        return access

    def _get_or_create_proforma(self, access):
        """Obtiene o crea el proforma.header para la OC del access."""
        po = access.purchase_id
        if not po:
            return False

        Proforma = request.env['supplier.proforma.header'].sudo()
        header = Proforma.search([('purchase_id', '=', po.id)], limit=1)
        if not header:
            header = Proforma.create({
                'purchase_id': po.id,
                'access_id': access.id,
            })
        elif not header.access_id:
            header.write({'access_id': access.id})
        return header

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
            if not product:
                continue
            pid = product.id
            if pid not in bucket:
                u_type = product.product_tmpl_id.x_unidad_del_producto or 'Placa'
                bucket[pid] = {
                    "id": pid,
                    "name": product.display_name or product.name,
                    "code": product.default_code or "",
                    "qty_ordered": 0.0,
                    "uom": (move.product_uom and move.product_uom.name) or "",
                    "unit_type": u_type,
                }
            bucket[pid]["qty_ordered"] += (move.product_uom_qty or 0.0)
        products = list(bucket.values())
        products.sort(key=lambda x: (x.get("name") or "").lower())
        return products

    def _serialize_proforma(self, header):
        """Serializa la proforma y toda su jerarquía a JSON-safe dict."""
        shipments = []
        for s in header.shipment_ids.sorted('sequence'):
            invoices = [{
                'id': inv.id,
                'invoice_number': inv.invoice_number or '',
                'invoice_date': str(inv.invoice_date) if inv.invoice_date else '',
                'amount': inv.amount or 0.0,
                'currency_id': inv.currency_id.id if inv.currency_id else False,
                'currency_name': inv.currency_id.name if inv.currency_id else '',
                'scope': inv.scope or 'full_shipment',
                'container_ids': inv.container_ids.ids,
            } for inv in s.invoice_ids]

            packings = [{
                'id': pl.id,
                'packing_number': pl.packing_number or '',
                'packing_date': str(pl.packing_date) if pl.packing_date else '',
                'scope': pl.scope or 'full_shipment',
                'container_ids': pl.container_ids.ids,
                'row_count': pl.row_count,
                'rows': [{
                    'id': row.id,
                    'product_id': row.product_id.id,
                    'product_name': row.product_id.display_name,
                    'container_id': row.container_id.id if row.container_id else False,
                    'tipo': row.tipo or 'Placa',
                    'grosor': row.grosor or '',
                    'alto': row.alto,
                    'ancho': row.ancho,
                    'peso': row.peso,
                    'quantity': row.quantity,
                    'bloque': row.bloque or '',
                    'numero_placa': row.numero_placa or '',
                    'atado': row.atado or '',
                    'color': row.color or '',
                    'grupo_name': row.grupo_name or '',
                    'pedimento': row.pedimento or '',
                    'ref_proveedor': row.ref_proveedor or '',
                    'area_m2': row.area_m2,
                } for row in pl.row_ids.sorted('sequence')]
            } for pl in s.packing_ids]

            containers = [{
                'id': c.id,
                'container_number': c.container_number or '',
                'seal_number': c.seal_number or '',
                'container_type': c.container_type or '',
                'weight': c.weight or 0.0,
                'volume': c.volume or 0.0,
                'packages': c.packages or 0,
                'notes': c.notes or '',
            } for c in s.container_ids]

            shipments.append({
                'id': s.id,
                'name': s.name or '',
                'sequence': s.sequence,
                'shipment_type': s.shipment_type or 'maritime',
                'shipping_line': s.shipping_line or '',
                'vessel_name': s.vessel_name or '',
                'etd': str(s.etd) if s.etd else '',
                'eta': str(s.eta) if s.eta else '',
                'port_origin': s.port_origin or '',
                'port_destination': s.port_destination or '',
                'bl_number': s.bl_number or '',
                'bl_date': str(s.bl_date) if s.bl_date else '',
                'status': s.status or 'draft',
                'notes': s.notes or '',
                'container_count': s.container_count,
                'invoice_count': s.invoice_count,
                'packing_count': s.packing_count,
                'invoices': invoices,
                'packings': packings,
                'containers': containers,
                'voyage_id': s.voyage_id.id if s.voyage_id else False,
            })

        return {
            'id': header.id,
            'proforma_number': header.proforma_number or '',
            'invoice_global_number': header.invoice_global_number or '',
            'payment_terms': header.payment_terms or '',
            'country_origin': header.country_origin or '',
            'port_origin': header.port_origin or '',
            'port_destination': header.port_destination or '',
            'incoterm': header.incoterm or '',
            'general_notes': header.general_notes or '',
            'status': header.status or 'draft',
            'shipments': shipments,
        }

    def _sync_flat_to_picking(self, header, picking):
        """Popula los campos flat del picking con un resumen de la proforma (retrocompatibilidad)."""
        if not picking:
            return

        all_bl = []
        all_containers = []
        all_seals = []
        all_types = []
        total_pkgs = 0
        total_weight = 0.0
        total_volume = 0.0

        first_shipment = header.shipment_ids.sorted('sequence')[:1]

        for s in header.shipment_ids:
            if s.bl_number:
                all_bl.append(s.bl_number)
            for c in s.container_ids:
                if c.container_number:
                    all_containers.append(c.container_number)
                if c.seal_number:
                    all_seals.append(c.seal_number)
                if c.container_type:
                    all_types.append(c.container_type)
                total_pkgs += c.packages or 0
                total_weight += c.weight or 0.0
                total_volume += c.volume or 0.0

        vals = {
            'supplier_proforma_number': header.proforma_number or '',
            'supplier_payment_terms': header.payment_terms or '',
            'supplier_country_origin': header.country_origin or '',
            'supplier_origin': header.port_origin or '',
            'supplier_destination': header.port_destination or '',
            'supplier_incoterm_payment': header.incoterm or '',
            'supplier_bl_number': ', '.join(all_bl) if all_bl else '',
            'supplier_container_no': ', '.join(all_containers) if all_containers else '',
            'supplier_seal_no': ', '.join(all_seals) if all_seals else '',
            'supplier_container_type': ', '.join(set(all_types)) if all_types else '',
            'supplier_total_packages': total_pkgs,
            'supplier_gross_weight': total_weight,
            'supplier_volume': total_volume,
        }

        if first_shipment:
            fs = first_shipment[0]
            vals['supplier_vessel'] = fs.vessel_name or ''
            vals['supplier_shipment_date'] = fs.etd or False

        # Solo escribir si hay picking válido
        try:
            picking.sudo().write(vals)
        except Exception as e:
            _logger.warning(f"Error sincronizando flat al picking: {e}")

    # =====================================================================
    #  ENDPOINT PRINCIPAL: CARGA DEL PORTAL (GET)
    # =====================================================================

    @http.route('/supplier/pl/<string:token>', type='http', auth='public', website=True, sitemap=False)
    def view_supplier_portal(self, token, **kwargs):
        access = self._validate_token(token)
        if not access:
            return request.render('stock_lot_packing_import.portal_not_found')
        if access.is_expired:
            return request.render('stock_lot_packing_import.portal_expired')

        # Actualizar picking a la recepción vigente
        if access.purchase_id:
            po = access.purchase_id
            pickings = po.picking_ids.filtered(
                lambda p: p.picking_type_code == 'incoming' and p.state not in ('done', 'cancel')
            )
            if pickings:
                target_picking = pickings.sorted(key=lambda p: p.id, reverse=True)[0]
                if access.picking_id.id != target_picking.id:
                    access.write({'picking_id': target_picking.id})

        picking = access.picking_id
        if not picking:
            return request.render('stock_lot_packing_import.portal_not_found')

        products = self._build_products_payload(picking)

        # Obtener/crear proforma header
        proforma = self._get_or_create_proforma(access)
        proforma_data = self._serialize_proforma(proforma) if proforma else {}

        # Datos flat del picking como fallback (para rows existentes del flujo viejo)
        existing_rows = []
        if picking.spreadsheet_id and not proforma_data.get('shipments'):
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet: {e}")

        # Header flat (retrocompatibilidad)
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
            'proforma': proforma_data,
            'token': token,
            'poName': access.purchase_id.name if access.purchase_id else (picking.origin or ""),
            'pickingName': picking.name or "",
            'companyName': picking.company_id.name or "",
            'apiVersion': 2,
        }

        values = {
            'picking': picking,
            'portal_json': Markup(json.dumps(full_data, ensure_ascii=False)),
        }
        return request.render('stock_lot_packing_import.supplier_portal_view', values)

    # =====================================================================
    #  API v2: GUARDAR DATOS GLOBALES DE LA PROFORMA
    # =====================================================================

    @http.route('/supplier/api/v2/save_globals', type='json', auth='public', csrf=False)
    def api_save_globals(self, token, globals_data):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma:
            return {'success': False, 'message': 'No se pudo crear la proforma.'}

        vals = {}
        field_map = {
            'proforma_number': 'proforma_number',
            'invoice_global_number': 'invoice_global_number',
            'payment_terms': 'payment_terms',
            'country_origin': 'country_origin',
            'port_origin': 'port_origin',
            'port_destination': 'port_destination',
            'incoterm': 'incoterm',
            'general_notes': 'general_notes',
        }
        for js_key, py_field in field_map.items():
            if js_key in globals_data:
                vals[py_field] = globals_data[js_key] or ''

        if vals:
            proforma.write(vals)

        self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True, 'proforma_id': proforma.id}

    # =====================================================================
    #  API v2: CRUD EMBARQUES
    # =====================================================================

    @http.route('/supplier/api/v2/create_shipment', type='json', auth='public', csrf=False)
    def api_create_shipment(self, token, shipment_data=None):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma:
            return {'success': False, 'message': 'Proforma no encontrada.'}

        vals = {'proforma_id': proforma.id}
        if shipment_data:
            for k in ['shipment_type', 'shipping_line', 'vessel_name',
                       'port_origin', 'port_destination', 'bl_number', 'notes']:
                if k in shipment_data:
                    vals[k] = shipment_data[k] or ''
            for k in ['etd', 'eta', 'bl_date']:
                if shipment_data.get(k):
                    vals[k] = shipment_data[k]
            if 'status' in shipment_data:
                vals['status'] = shipment_data['status']

        shipment = request.env['supplier.shipment'].sudo().create(vals)
        proforma.write({'status': 'partial'})
        self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True, 'shipment_id': shipment.id, 'name': shipment.name}

    @http.route('/supplier/api/v2/update_shipment', type='json', auth='public', csrf=False)
    def api_update_shipment(self, token, shipment_id, shipment_data):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        shipment = request.env['supplier.shipment'].sudo().browse(shipment_id)
        if not shipment.exists():
            return {'success': False, 'message': 'Embarque no encontrado.'}

        vals = {}
        for k in ['shipment_type', 'shipping_line', 'vessel_name',
                   'port_origin', 'port_destination', 'bl_number', 'notes', 'status']:
            if k in shipment_data:
                vals[k] = shipment_data[k] or '' if k != 'status' else shipment_data[k]
        for k in ['etd', 'eta', 'bl_date']:
            if k in shipment_data:
                vals[k] = shipment_data[k] or False

        if vals:
            shipment.write(vals)

        proforma = shipment.proforma_id
        self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True}

    @http.route('/supplier/api/v2/delete_shipment', type='json', auth='public', csrf=False)
    def api_delete_shipment(self, token, shipment_id):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        shipment = request.env['supplier.shipment'].sudo().browse(shipment_id)
        if shipment.exists():
            proforma = shipment.proforma_id
            shipment.unlink()
            if proforma and not proforma.shipment_ids:
                proforma.write({'status': 'draft'})
            self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True}

    # =====================================================================
    #  API v2: CRUD CONTENEDORES
    # =====================================================================

    @http.route('/supplier/api/v2/save_containers', type='json', auth='public', csrf=False)
    def api_save_containers(self, token, shipment_id, containers):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        shipment = request.env['supplier.shipment'].sudo().browse(shipment_id)
        if not shipment.exists():
            return {'success': False, 'message': 'Embarque no encontrado.'}

        Container = request.env['supplier.shipment.container'].sudo()
        existing_ids = set()

        for c in containers:
            cid = c.get('id')
            vals = {
                'container_number': c.get('container_number', ''),
                'seal_number': c.get('seal_number', ''),
                'container_type': c.get('container_type', ''),
                'weight': float(c.get('weight', 0)),
                'volume': float(c.get('volume', 0)),
                'packages': int(c.get('packages', 0)),
                'notes': c.get('notes', ''),
            }
            if cid and Container.browse(cid).exists():
                Container.browse(cid).write(vals)
                existing_ids.add(cid)
            else:
                vals['shipment_id'] = shipment.id
                new = Container.create(vals)
                existing_ids.add(new.id)

        # Eliminar contenedores que ya no están en la lista
        to_delete = shipment.container_ids.filtered(lambda c: c.id not in existing_ids)
        if to_delete:
            to_delete.unlink()

        proforma = shipment.proforma_id
        self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True, 'container_ids': list(existing_ids)}

    # =====================================================================
    #  API v2: CRUD INVOICES
    # =====================================================================

    @http.route('/supplier/api/v2/save_invoices', type='json', auth='public', csrf=False)
    def api_save_invoices(self, token, shipment_id, invoices):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        shipment = request.env['supplier.shipment'].sudo().browse(shipment_id)
        if not shipment.exists():
            return {'success': False, 'message': 'Embarque no encontrado.'}

        Invoice = request.env['supplier.shipment.invoice'].sudo()
        existing_ids = set()

        for inv in invoices:
            iid = inv.get('id')
            vals = {
                'invoice_number': inv.get('invoice_number', ''),
                'invoice_date': inv.get('invoice_date') or False,
                'amount': float(inv.get('amount', 0)),
                'scope': inv.get('scope', 'full_shipment'),
            }
            if inv.get('currency_id'):
                vals['currency_id'] = int(inv['currency_id'])
            if 'container_ids' in inv:
                vals['container_ids'] = [(6, 0, inv['container_ids'])]

            if iid and Invoice.browse(iid).exists():
                Invoice.browse(iid).write(vals)
                existing_ids.add(iid)
            else:
                vals['shipment_id'] = shipment.id
                new = Invoice.create(vals)
                existing_ids.add(new.id)

        to_delete = shipment.invoice_ids.filtered(lambda i: i.id not in existing_ids)
        if to_delete:
            to_delete.unlink()

        return {'success': True, 'invoice_ids': list(existing_ids)}

    # =====================================================================
    #  API v2: CRUD PACKING LISTS + ROWS
    # =====================================================================

    @http.route('/supplier/api/v2/save_packing', type='json', auth='public', csrf=False)
    def api_save_packing(self, token, shipment_id, packing_data, rows=None):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        shipment = request.env['supplier.shipment'].sudo().browse(shipment_id)
        if not shipment.exists():
            return {'success': False, 'message': 'Embarque no encontrado.'}

        Packing = request.env['supplier.shipment.packing'].sudo()
        Row = request.env['supplier.shipment.packing.row'].sudo()

        pid = packing_data.get('id')
        vals = {
            'packing_number': packing_data.get('packing_number', ''),
            'packing_date': packing_data.get('packing_date') or False,
            'scope': packing_data.get('scope', 'full_shipment'),
        }
        if 'container_ids' in packing_data:
            vals['container_ids'] = [(6, 0, packing_data['container_ids'])]

        if pid and Packing.browse(pid).exists():
            packing = Packing.browse(pid)
            packing.write(vals)
        else:
            vals['shipment_id'] = shipment.id
            packing = Packing.create(vals)

        # Guardar rows
        if rows is not None:
            # Borrar rows existentes y recrear (más simple y seguro)
            packing.row_ids.unlink()
            seq = 10
            for r in rows:
                Row.create({
                    'packing_id': packing.id,
                    'sequence': seq,
                    'product_id': int(r.get('product_id', 0)),
                    'container_id': int(r.get('container_id', 0)) if r.get('container_id') else False,
                    'tipo': r.get('tipo', 'Placa'),
                    'grosor': r.get('grosor', ''),
                    'alto': float(r.get('alto', 0)),
                    'ancho': float(r.get('ancho', 0)),
                    'peso': float(r.get('peso', 0)),
                    'quantity': float(r.get('quantity', 0)),
                    'bloque': r.get('bloque', ''),
                    'numero_placa': r.get('numero_placa', ''),
                    'atado': r.get('atado', ''),
                    'color': r.get('color', ''),
                    'grupo_name': r.get('grupo_name', ''),
                    'pedimento': r.get('pedimento', ''),
                    'ref_proveedor': r.get('ref_proveedor', ''),
                })
                seq += 10

        return {'success': True, 'packing_id': packing.id}

    @http.route('/supplier/api/v2/delete_packing', type='json', auth='public', csrf=False)
    def api_delete_packing(self, token, packing_id):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        packing = request.env['supplier.shipment.packing'].sudo().browse(packing_id)
        if packing.exists():
            packing.unlink()

        return {'success': True}

    # =====================================================================
    #  API v2: SUBIDA DE ARCHIVOS (BL, Invoice, PL)
    # =====================================================================

    @http.route('/supplier/api/v2/upload_file', type='json', auth='public', csrf=False)
    def api_upload_file(self, token, target_model, target_id, field_name, file_data, file_name):
        """Sube un archivo binario a un campo Binary de cualquier modelo de la jerarquía."""
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        allowed_models = {
            'supplier.shipment': ['bl_file'],
            'supplier.shipment.invoice': ['file'],
            'supplier.shipment.packing': ['file'],
        }
        if target_model not in allowed_models or field_name not in allowed_models[target_model]:
            return {'success': False, 'message': 'Modelo o campo no permitido.'}

        record = request.env[target_model].sudo().browse(target_id)
        if not record.exists():
            return {'success': False, 'message': 'Registro no encontrado.'}

        fname_field = field_name.replace('file', 'filename') if 'file' in field_name else f'{field_name}_name'
        if fname_field == 'filename':
            pass  # ya es correcto para invoice y packing
        elif field_name == 'bl_file':
            fname_field = 'bl_filename'

        write_vals = {field_name: file_data}
        if hasattr(record, fname_field):
            write_vals[fname_field] = file_name

        record.write(write_vals)
        return {'success': True}

    # =====================================================================
    #  API v2: MARCAR PROFORMA COMO COMPLETA
    # =====================================================================

    @http.route('/supplier/api/v2/complete', type='json', auth='public', csrf=False)
    def api_complete(self, token):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        if proforma:
            proforma.write({'status': 'complete'})
            self._sync_flat_to_picking(proforma, access.picking_id)

        return {'success': True}

    # =====================================================================
    #  API v2: RELOAD (recarga todos los datos jerárquicos)
    # =====================================================================

    @http.route('/supplier/api/v2/reload', type='json', auth='public', csrf=False)
    def api_reload(self, token):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma:
            return {'success': False, 'message': 'Proforma no encontrada.'}

        return {'success': True, 'proforma': self._serialize_proforma(proforma)}

    # =====================================================================
    #  ENDPOINT LEGACY: SUBMIT (flujo viejo, fallback)
    # =====================================================================

    @http.route('/supplier/pl/submit', type='json', auth='public', csrf=False)
    def submit_pl_data(self, token, rows, header=None, files=None):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        picking = access.picking_id
        if not picking:
            return {'success': False, 'message': 'Picking no encontrado.'}
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
/* v3.2 \u2014 DEBUG: Logs exhaustivos en saveGlobals, addShipment, y bindGlobalEvents */
/* Hierarchical Portal: Proforma \u2192 Shipments \u2192 Invoices/Packings/Containers */
/* Consumes API v2 endpoints. Falls back to legacy /supplier/pl/submit if apiVersion < 2 */
(function () {
    "use strict";

    console.log("[Portal] \u1f680 Script v3.2-DEBUG (Hierarchical: Proforma\u2192Shipments\u2192Docs\u2192Containers) Loaded.");

    // =========================================================================
    //  TRANSLATIONS (i18n)
    // =========================================================================
    const T = {
        en: {
            header_provider: "VENDOR", po_label: "Purchase Order:", receipt_label: "Receipt:",
            sec_proforma_globals: "Proforma Global Data",
            lbl_proforma: "Proforma No. (PI)", ph_proforma: "Ex. PI-9920",
            lbl_invoice_global: "Global Invoice", lbl_payment: "Payment Terms", ph_payment: "Ex. T/T 30%",
            lbl_country: "Country of Origin", ph_country: "Ex. China",
            lbl_port_origin: "Origin Port", ph_origin: "Ex. Shanghai",
            lbl_port_dest: "Destination Port", ph_dest: "Ex. Manzanillo",
            lbl_incoterm: "Incoterm", ph_incoterm: "Ex. CIF",
            lbl_general_notes: "General Notes",
            btn_save_globals: "Save Global Data",
            sec_shipments: "Shipments", btn_add_shipment: "Add Shipment",
            msg_no_shipments: "No shipments registered. Click 'Add Shipment' to start.",
            // Shipment tabs
            tab_logistics: "Logistics", tab_bl: "B/L", tab_invoices: "Invoices",
            tab_packings: "Packing Lists", tab_containers: "Containers",
            // Shipment fields
            lbl_shipment_type: "Type", lbl_shipping_line: "Shipping Line", lbl_vessel: "Vessel",
            lbl_etd: "ETD", lbl_eta: "ETA", lbl_status: "Status", lbl_notes: "Notes",
            lbl_bl_number: "B/L Number", lbl_bl_date: "B/L Date", lbl_bl_file: "B/L File",
            btn_save_shipment: "Save Shipment", btn_save_containers: "Save Containers",
            btn_save_invoices: "Save Invoices",
            // Invoice fields
            lbl_inv_number: "Invoice No.", lbl_inv_date: "Date", lbl_inv_amount: "Amount",
            lbl_inv_scope: "Scope", scope_full: "Full Shipment", scope_specific: "Specific Containers",
            // Container fields
            lbl_cont_number: "Container No.", lbl_cont_seal: "Seal No.", lbl_cont_type: "Type",
            lbl_cont_weight: "Weight (kg)", lbl_cont_volume: "Volume (m\u00b3)", lbl_cont_packages: "Packages",
            // Packing fields
            lbl_pk_number: "Packing No.", lbl_pk_date: "Date", lbl_pk_scope: "Scope",
            lbl_pk_file: "Packing File",
            // Buttons
            btn_add: "Add", btn_remove: "Remove", btn_add_invoice: "+ Invoice", btn_add_container: "+ Container",
            btn_add_packing: "+ Packing List",
            btn_save_packing: "Save Packing", btn_delete_packing: "Delete",
            // Footer
            footer_total_shipments: "Shipments:", footer_total_containers: "Containers:",
            footer_total_invoices: "Invoices:", btn_complete: "Mark as Complete",
            // Product rows (legacy/packing)
            requested: "Requested:", btn_add_row: "Add Item", btn_add_multi: "+5 Rows",
            col_block: "Block", col_atado: "Bundle", col_plate_num: "Plate No.",
            col_ref: "Reference", col_thickness: "Thickness", col_height: "Height (m)",
            col_width: "Width (m)", col_area: "Area (m\u00b2)", col_notes: "Notes",
            col_qty: "Quantity", col_weight: "Weight (kg)",
            lbl_type_placa: "Slab/Plate", lbl_type_formato: "Tile/Format", lbl_type_pieza: "Piece/Unit",
            lbl_packages: "N\u00b0 Packages", lbl_desc_goods: "Description of Goods",
            col_crate_h: "Crate H", col_crate_w: "Crate W", col_crate_t: "Crate T",
            col_fmt_h: "Item Height", col_fmt_w: "Item Width",
            // Messages
            msg_saved: "Saved successfully", msg_error: "Error: ", msg_confirm_delete: "Delete this item?",
            msg_confirm_complete: "Mark proforma as complete? This signals the supplier has finished entering data.",
            msg_loading: "Loading...", msg_saving: "Saving...",
            opt_select: "Select...",
            opt_maritime: "Maritime", opt_air: "Air", opt_land: "Land",
            st_draft: "Draft", st_in_production: "In Production", st_booked: "Booked",
            st_departed: "Departed", st_in_transit: "In Transit", st_arrived: "Arrived", st_delivered: "Delivered",
        },
        es: {
            header_provider: "PROVEEDOR", po_label: "Orden de Compra:", receipt_label: "Recepci\u00f3n:",
            sec_proforma_globals: "Datos Globales de la Proforma",
            lbl_proforma: "No. Proforma (PI)", ph_proforma: "Ej. PI-9920",
            lbl_invoice_global: "Factura Global", lbl_payment: "Condiciones de Pago", ph_payment: "Ej. T/T 30%",
            lbl_country: "Pa\u00eds Origen", ph_country: "Ej. China",
            lbl_port_origin: "Puerto Origen", ph_origin: "Ej. Shanghai",
            lbl_port_dest: "Puerto Destino", ph_dest: "Ej. Manzanillo",
            lbl_incoterm: "Incoterm", ph_incoterm: "Ej. CIF",
            lbl_general_notes: "Observaciones Generales",
            btn_save_globals: "Guardar Datos Globales",
            sec_shipments: "Embarques", btn_add_shipment: "Agregar Embarque",
            msg_no_shipments: "No hay embarques registrados. Presione 'Agregar Embarque' para comenzar.",
            tab_logistics: "Log\u00edstica", tab_bl: "B/L", tab_invoices: "Invoices",
            tab_packings: "Packing Lists", tab_containers: "Contenedores",
            lbl_shipment_type: "Tipo", lbl_shipping_line: "Naviera", lbl_vessel: "Buque",
            lbl_etd: "ETD", lbl_eta: "ETA", lbl_status: "Estatus", lbl_notes: "Observaciones",
            lbl_bl_number: "No. B/L", lbl_bl_date: "Fecha B/L", lbl_bl_file: "Archivo B/L",
            btn_save_shipment: "Guardar Embarque", btn_save_containers: "Guardar Contenedores",
            btn_save_invoices: "Guardar Invoices",
            lbl_inv_number: "No. Invoice", lbl_inv_date: "Fecha", lbl_inv_amount: "Monto",
            lbl_inv_scope: "Alcance", scope_full: "Todo el Embarque", scope_specific: "Contenedores Espec\u00edficos",
            lbl_cont_number: "No. Contenedor", lbl_cont_seal: "No. Sello", lbl_cont_type: "Tipo",
            lbl_cont_weight: "Peso (kg)", lbl_cont_volume: "Volumen (m\u00b3)", lbl_cont_packages: "Paquetes",
            lbl_pk_number: "No. Packing", lbl_pk_date: "Fecha", lbl_pk_scope: "Alcance",
            lbl_pk_file: "Archivo PL",
            btn_add: "Agregar", btn_remove: "Eliminar", btn_add_invoice: "+ Invoice", btn_add_container: "+ Contenedor",
            btn_add_packing: "+ Packing List",
            btn_save_packing: "Guardar Packing", btn_delete_packing: "Eliminar",
            footer_total_shipments: "Embarques:", footer_total_containers: "Contenedores:",
            footer_total_invoices: "Invoices:", btn_complete: "Marcar como Completa",
            requested: "Solicitado:", btn_add_row: "Agregar Item", btn_add_multi: "+5 Filas",
            col_block: "Bloque", col_atado: "Atado", col_plate_num: "No. Placa",
            col_ref: "Referencia", col_thickness: "Grosor", col_height: "Alto (m)",
            col_width: "Ancho (m)", col_area: "\u00c1rea (m\u00b2)", col_notes: "Notas",
            col_qty: "Cantidad", col_weight: "Peso (kg)",
            lbl_type_placa: "Placa", lbl_type_formato: "Formato", lbl_type_pieza: "Pieza",
            lbl_packages: "N\u00b0 Paquetes", lbl_desc_goods: "Desc. Bienes",
            col_crate_h: "Alto Caja", col_crate_w: "Ancho Caja", col_crate_t: "Grosor Caja",
            col_fmt_h: "Alto Item", col_fmt_w: "Ancho Item",
            msg_saved: "Guardado correctamente", msg_error: "Error: ", msg_confirm_delete: "\u00bfEliminar este registro?",
            msg_confirm_complete: "\u00bfMarcar la proforma como completa? Esto indica que el proveedor termin\u00f3 de capturar datos.",
            msg_loading: "Cargando...", msg_saving: "Guardando...",
            opt_select: "Seleccionar...",
            opt_maritime: "Mar\u00edtimo", opt_air: "A\u00e9reo", opt_land: "Terrestre",
            st_draft: "Borrador", st_in_production: "En Producci\u00f3n", st_booked: "Reservado",
            st_departed: "Despachado", st_in_transit: "En Tr\u00e1nsito", st_arrived: "Lleg\u00f3", st_delivered: "Entregado",
        },
        zh: {
            header_provider: "\u4f9b\u5e94\u5546", po_label: "\u91c7\u8d2d\u8ba2\u5355:", receipt_label: "\u6536\u8d27\u5355:",
            sec_proforma_globals: "\u5f62\u5f0f\u53d1\u7968\u5168\u5c40\u6570\u636e",
            lbl_proforma: "\u5f62\u5f0f\u53d1\u7968\u53f7", ph_proforma: "\u4f8b\u5982 PI-9920",
            lbl_invoice_global: "\u5168\u5c40\u53d1\u7968", lbl_payment: "\u4ed8\u6b3e\u6761\u4ef6", ph_payment: "\u4f8b\u5982 T/T 30%",
            lbl_country: "\u539f\u4ea7\u56fd", ph_country: "\u4f8b\u5982 China",
            lbl_port_origin: "\u8d77\u8fd0\u6e2f", ph_origin: "\u4f8b\u5982 Shanghai",
            lbl_port_dest: "\u76ee\u7684\u6e2f", ph_dest: "\u4f8b\u5982 Manzanillo",
            lbl_incoterm: "\u8d38\u6613\u6761\u6b3e", ph_incoterm: "\u4f8b\u5982 CIF",
            lbl_general_notes: "\u4e00\u822c\u5907\u6ce8",
            btn_save_globals: "\u4fdd\u5b58\u5168\u5c40\u6570\u636e",
            sec_shipments: "\u53d1\u8d27", btn_add_shipment: "\u6dfb\u52a0\u53d1\u8d27",
            msg_no_shipments: "\u6ca1\u6709\u53d1\u8d27\u8bb0\u5f55\u3002\u70b9\u51fb\u0027\u6dfb\u52a0\u53d1\u8d27\u0027\u5f00\u59cb\u3002",
            tab_logistics: "\u7269\u6d41", tab_bl: "\u63d0\u5355", tab_invoices: "\u53d1\u7968",
            tab_packings: "\u88c5\u7bb1\u5355", tab_containers: "\u96c6\u88c5\u7bb1",
            lbl_shipment_type: "\u7c7b\u578b", lbl_shipping_line: "\u8239\u516c\u53f8", lbl_vessel: "\u8239\u540d",
            lbl_etd: "\u9884\u8ba1\u79bb\u6e2f", lbl_eta: "\u9884\u8ba1\u5230\u6e2f", lbl_status: "\u72b6\u6001", lbl_notes: "\u5907\u6ce8",
            lbl_bl_number: "\u63d0\u5355\u53f7", lbl_bl_date: "\u63d0\u5355\u65e5\u671f", lbl_bl_file: "\u63d0\u5355\u6587\u4ef6",
            btn_save_shipment: "\u4fdd\u5b58\u53d1\u8d27", btn_save_containers: "\u4fdd\u5b58\u96c6\u88c5\u7bb1",
            btn_save_invoices: "\u4fdd\u5b58\u53d1\u7968",
            lbl_inv_number: "\u53d1\u7968\u53f7", lbl_inv_date: "\u65e5\u671f", lbl_inv_amount: "\u91d1\u989d",
            lbl_inv_scope: "\u8303\u56f4", scope_full: "\u6574\u6279", scope_specific: "\u6307\u5b9a\u96c6\u88c5\u7bb1",
            lbl_cont_number: "\u96c6\u88c5\u7bb1\u53f7", lbl_cont_seal: "\u5c01\u6761\u53f7", lbl_cont_type: "\u7c7b\u578b",
            lbl_cont_weight: "\u91cd\u91cf (kg)", lbl_cont_volume: "\u4f53\u79ef (m\u00b3)", lbl_cont_packages: "\u4ef6\u6570",
            lbl_pk_number: "\u88c5\u7bb1\u5355\u53f7", lbl_pk_date: "\u65e5\u671f", lbl_pk_scope: "\u8303\u56f4",
            lbl_pk_file: "\u88c5\u7bb1\u5355\u6587\u4ef6",
            btn_add: "\u6dfb\u52a0", btn_remove: "\u5220\u9664", btn_add_invoice: "+ \u53d1\u7968", btn_add_container: "+ \u96c6\u88c5\u7bb1",
            btn_add_packing: "+ \u88c5\u7bb1\u5355",
            btn_save_packing: "\u4fdd\u5b58\u88c5\u7bb1\u5355", btn_delete_packing: "\u5220\u9664",
            footer_total_shipments: "\u53d1\u8d27:", footer_total_containers: "\u96c6\u88c5\u7bb1:",
            footer_total_invoices: "\u53d1\u7968:", btn_complete: "\u6807\u8bb0\u4e3a\u5b8c\u6210",
            requested: "\u9700\u6c42\u91cf:", btn_add_row: "\u6dfb\u52a0", btn_add_multi: "+5\u884c",
            col_block: "\u8352\u6599\u53f7", col_atado: "\u6346\u5305\u53f7", col_plate_num: "\u677f\u53f7",
            col_ref: "\u53c2\u8003", col_thickness: "\u539a\u5ea6", col_height: "\u9ad8\u5ea6 (m)",
            col_width: "\u5bbd\u5ea6 (m)", col_area: "\u9762\u79ef (m\u00b2)", col_notes: "\u5907\u6ce8",
            col_qty: "\u6570\u91cf", col_weight: "\u91cd\u91cf (kg)",
            lbl_type_placa: "\u5927\u677f", lbl_type_formato: "\u89c4\u683c\u677f", lbl_type_pieza: "\u4ef6",
            lbl_packages: "\u5305\u6570", lbl_desc_goods: "\u8d27\u7269\u63cf\u8ff0",
            col_crate_h: "\u7bb1\u9ad8", col_crate_w: "\u7bb1\u5bbd", col_crate_t: "\u7bb1\u539a",
            col_fmt_h: "\u7269\u54c1\u9ad8\u5ea6", col_fmt_w: "\u7269\u54c1\u5bbd\u5ea6",
            msg_saved: "\u4fdd\u5b58\u6210\u529f", msg_error: "\u9519\u8bef: ", msg_confirm_delete: "\u5220\u9664\u6b64\u8bb0\u5f55\uff1f",
            msg_confirm_complete: "\u6807\u8bb0\u4e3a\u5b8c\u6210\uff1f",
            msg_loading: "\u52a0\u8f7d\u4e2d...", msg_saving: "\u4fdd\u5b58\u4e2d...",
            opt_select: "\u8bf7\u9009\u62e9...",
            opt_maritime: "\u6d77\u8fd0", opt_air: "\u7a7a\u8fd0", opt_land: "\u9646\u8fd0",
            st_draft: "\u8349\u7a3f", st_in_production: "\u751f\u4ea7\u4e2d", st_booked: "\u5df2\u9884\u8ba2",
            st_departed: "\u5df2\u53d1\u8fd0", st_in_transit: "\u8fd0\u8f93\u4e2d", st_arrived: "\u5df2\u5230\u8fbe", st_delivered: "\u5df2\u4ea4\u4ed8",
        }
    };

    // =========================================================================
    //  HELPERS
    // =========================================================================
    function jsonRpc(url, params) {
        console.log(`[Portal][RPC] >>> POST ${url}`, JSON.stringify(params).substring(0, 300));
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Math.floor(Math.random() * 99999) })
        }).then(r => {
            console.log(`[Portal][RPC] <<< ${url} HTTP status: ${r.status} ${r.statusText}`);
            if (!r.ok) {
                throw new Error(`HTTP ${r.status}: ${r.statusText}`);
            }
            return r.json();
        }).then(d => {
            console.log(`[Portal][RPC] <<< ${url} parsed JSON:`, JSON.stringify(d).substring(0, 500));
            if (d.error) {
                const msg = d.error.data?.message || d.error.message || 'RPC Error';
                console.error('[Portal][RPC] ERROR detail:', JSON.stringify(d.error).substring(0, 1000));
                throw new Error(msg);
            }
            return d.result;
        }).catch(err => {
            console.error(`[Portal][RPC] CATCH ${url}:`, err.message, err);
            throw err;
        });
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    // =========================================================================
    //  MAIN CLASS
    // =========================================================================
    class SupplierPortal {
        constructor() {
            console.log("[Portal] Constructor called");
            this.data = {};
            this.products = [];
            this.proforma = {};
            this.token = '';
            this.currentLang = localStorage.getItem('portal_lang') || 'en';
            this.expandedShipmentId = null;
            this.activeTabByShipment = {}; // shipmentId -> tabName
            // Packing rows state per packing (for product detail rows)
            this.packingRows = {}; // packingId -> [rows]
            this.nextRowId = 1;
            this._eventsBound = false;

            if (document.readyState === 'loading') {
                console.log("[Portal] DOM loading, deferring init to DOMContentLoaded");
                document.addEventListener('DOMContentLoaded', () => this.init());
            } else {
                console.log("[Portal] DOM already ready, calling init() immediately");
                this.init();
            }
        }

        t(key) { return (T[this.currentLang] || T['en'])[key] || key; }

        init() {
            console.log("[Portal] ========== init() START ==========");
            try {
                // Language
                const langSel = document.getElementById('lang-selector');
                console.log("[Portal] lang-selector element:", langSel ? '\u2713 found' : '\u2717 NOT FOUND');
                if (langSel) {
                    langSel.value = this.currentLang;
                    langSel.addEventListener('change', e => {
                        this.currentLang = e.target.value;
                        localStorage.setItem('portal_lang', this.currentLang);
                        this.updateStaticI18n();
                        this.renderAll();
                    });
                }

                // Parse payload
                const el = document.getElementById('portal-data-store');
                console.log("[Portal] portal-data-store element:", el ? '\u2713 found' : '\u2717 NOT FOUND');
                if (!el) throw new Error('No payload element #portal-data-store');

                console.log("[Portal] portal-data-store dataset.payload (first 300 chars):", (el.dataset.payload || '').substring(0, 300));
                this.data = JSON.parse(el.dataset.payload);
                console.log("[Portal] Parsed data keys:", Object.keys(this.data));

                this.token = this.data.token || '';
                console.log("[Portal] Token:", this.token ? `\u2713 (${this.token.substring(0, 8)}...)` : '\u2717 EMPTY/MISSING');

                this.products = this.data.products || [];
                console.log("[Portal] Products count:", this.products.length);

                this.proforma = this.data.proforma || {};
                console.log("[Portal] Proforma ID:", this.proforma.id, "Status:", this.proforma.status, "Shipments:", (this.proforma.shipments || []).length);

                this.updateStaticI18n();
                this.fillGlobalsForm();

                // FIX: Bindear eventos ANTES de renderAll para que los botones
                // funcionen incluso si renderAll lanza una excepci\u00f3n
                console.log("[Portal] About to call bindGlobalEvents()...");
                this.bindGlobalEvents();
                console.log("[Portal] bindGlobalEvents() completed, _eventsBound:", this._eventsBound);

                console.log("[Portal] About to call renderAll()...");
                this.renderAll();
                console.log("[Portal] renderAll() completed");

                console.log("[Portal] ========== init() OK ==========");
            } catch (err) {
                console.error("[Portal] ========== init() ERROR ==========", err);
                console.error("[Portal] Error stack:", err.stack);
                // Asegurar que los eventos globales siempre est\u00e9n bindeados
                if (!this._eventsBound) {
                    console.log("[Portal] Attempting emergency bindGlobalEvents...");
                    try { this.bindGlobalEvents(); } catch(_e) {
                        console.error("[Portal] Emergency bindGlobalEvents FAILED:", _e);
                    }
                }
                const c = document.getElementById('shipments-container');
                if (c) c.innerHTML = `<div class="empty-state"><p style="color:red">${esc(err.message)}</p></div>`;
            }
        }

        updateStaticI18n() {
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const k = el.dataset.i18n;
                if (k) el.innerText = this.t(k);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const k = el.dataset.i18nPlaceholder;
                if (k) el.placeholder = this.t(k);
            });
        }

        // =====================================================================
        //  GLOBALS FORM
        // =====================================================================
        fillGlobalsForm() {
            console.log("[Portal] fillGlobalsForm() called");
            const p = this.proforma;
            const map = {
                'g-proforma-number': 'proforma_number',
                'g-invoice-global': 'invoice_global_number',
                'g-payment-terms': 'payment_terms',
                'g-country-origin': 'country_origin',
                'g-port-origin': 'port_origin',
                'g-port-destination': 'port_destination',
                'g-incoterm': 'incoterm',
                'g-general-notes': 'general_notes',
            };
            for (const [domId, key] of Object.entries(map)) {
                const el = document.getElementById(domId);
                const exists = !!el;
                const val = p[key] || '';
                if (el && p[key]) el.value = p[key];
                console.log(`[Portal]   fillGlobals: #${domId} \u2192 ${exists ? '\u2713' : '\u2717 NOT FOUND'} | proforma.${key} = "${val}"`);
            }
            this.updateStatusBadge();
        }

        getGlobalsFromForm() {
            const data = {
                proforma_number: document.getElementById('g-proforma-number')?.value || '',
                invoice_global_number: document.getElementById('g-invoice-global')?.value || '',
                payment_terms: document.getElementById('g-payment-terms')?.value || '',
                country_origin: document.getElementById('g-country-origin')?.value || '',
                port_origin: document.getElementById('g-port-origin')?.value || '',
                port_destination: document.getElementById('g-port-destination')?.value || '',
                incoterm: document.getElementById('g-incoterm')?.value || '',
                general_notes: document.getElementById('g-general-notes')?.value || '',
            };
            console.log("[Portal] getGlobalsFromForm() \u2192", JSON.stringify(data));
            return data;
        }

        updateStatusBadge() {
            const badge = document.getElementById('proforma-status-badge');
            if (!badge) return;
            const st = this.proforma.status || 'draft';
            badge.className = `badge-status status-${st}`;
            badge.textContent = st.charAt(0).toUpperCase() + st.slice(1);
        }

        async saveGlobals() {
            console.log("[Portal] ====== saveGlobals() CALLED ======");
            const btn = document.getElementById('btn-save-globals');
            console.log("[Portal] saveGlobals: btn element:", btn ? '\u2713' : '\u2717');
            console.log("[Portal] saveGlobals: token:", this.token ? `\u2713 (${this.token.substring(0, 8)}...)` : '\u2717 EMPTY');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fa fa-spinner fa-spin me-2"></i> ${this.t('msg_saving')}`;
            }

            const globalsData = this.getGlobalsFromForm();
            console.log("[Portal] saveGlobals: payload to send:", JSON.stringify(globalsData));

            try {
                console.log("[Portal] saveGlobals: calling jsonRpc /supplier/api/v2/save_globals ...");
                const res = await jsonRpc('/supplier/api/v2/save_globals', {
                    token: this.token,
                    globals_data: globalsData
                });
                console.log("[Portal] saveGlobals: response:", JSON.stringify(res));
                if (res.success) {
                    this.toast(this.t('msg_saved'), 'success');
                    // Update local state
                    Object.assign(this.proforma, globalsData);
                    console.log("[Portal] saveGlobals: \u2713 SUCCESS, local proforma updated");
                } else {
                    console.warn("[Portal] saveGlobals: server returned success=false:", res.message);
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                console.error("[Portal] saveGlobals: EXCEPTION:", e.message, e.stack);
                this.toast(this.t('msg_error') + e.message, 'error');
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa fa-save me-2"></i> ${this.t('btn_save_globals')}`;
            }
            console.log("[Portal] ====== saveGlobals() END ======");
        }

        // =====================================================================
        //  RENDER ALL
        // =====================================================================
        renderAll() {
            console.log("[Portal] renderAll() called");
            this.renderShipments();
            this.updateFooterTotals();
            this.updateStatusBadge();
        }

        // =====================================================================
        //  SHIPMENTS
        // =====================================================================
        renderShipments() {
            const container = document.getElementById('shipments-container');
            if (!container) {
                console.warn("[Portal] renderShipments: #shipments-container not found");
                return;
            }
            const countBadge = document.getElementById('shipment-count-badge');
            const shipments = this.proforma.shipments || [];

            console.log("[Portal] renderShipments: count =", shipments.length);

            if (countBadge) countBadge.textContent = shipments.length;

            if (shipments.length === 0) {
                container.innerHTML = '';
                container.appendChild(this.createEmptyState());
                return;
            }

            // Remove empty state if present
            const es = container.querySelector('.empty-state');
            if (es) es.remove();

            // Reconcile DOM: update existing, add new, remove deleted
            const existingIds = new Set();
            shipments.forEach(s => {
                existingIds.add(s.id);
                let block = container.querySelector(`.shipment-block[data-shipment-id="${s.id}"]`);
                if (!block) {
                    block = this.createShipmentBlock(s);
                    container.appendChild(block);
                } else {
                    this.updateShipmentBlockHeader(block, s);
                }
                // If expanded, re-render body
                if (this.expandedShipmentId === s.id) {
                    block.classList.add('expanded');
                    const body = block.querySelector('.shipment-block-body');
                    body.style.display = 'block';
                    this.renderShipmentBody(body, s);
                }
            });

            // Remove deleted
            container.querySelectorAll('.shipment-block').forEach(b => {
                const id = parseInt(b.dataset.shipmentId);
                if (!existingIds.has(id)) b.remove();
            });
        }

        createEmptyState() {
            const d = document.createElement('div');
            d.className = 'empty-state';
            d.id = 'no-shipments-msg';
            d.innerHTML = `<i class="fa fa-inbox fa-3x"></i><p>${this.t('msg_no_shipments')}</p>`;
            return d;
        }

        createShipmentBlock(s) {
            const block = document.createElement('div');
            block.className = 'shipment-block';
            block.dataset.shipmentId = s.id;

            block.innerHTML = `
                <div class="shipment-block-header">
                    <div class="shipment-block-title">
                        <span class="shipment-name">${esc(s.name)}</span>
                        <span class="shipment-status-pill st-${s.status || 'draft'}">${this.t('st_' + (s.status || 'draft'))}</span>
                        <span class="shipment-summary-chips">
                            <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                            <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                            <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>
                        </span>
                    </div>
                    <div class="shipment-block-actions">
                        <button type="button" class="btn-toggle-shipment" title="Expand/Collapse"><i class="fa fa-chevron-down"></i></button>
                        <button type="button" class="btn-delete-shipment" title="Delete"><i class="fa fa-trash"></i></button>
                    </div>
                </div>
                <div class="shipment-block-body" style="display:none;"></div>`;

            // Toggle
            block.querySelector('.btn-toggle-shipment').addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleShipment(s.id);
            });
            block.querySelector('.shipment-block-header').addEventListener('click', () => {
                this.toggleShipment(s.id);
            });
            // Delete
            block.querySelector('.btn-delete-shipment').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteShipment(s.id);
            });

            return block;
        }

        updateShipmentBlockHeader(block, s) {
            block.querySelector('.shipment-name').textContent = s.name;
            const pill = block.querySelector('.shipment-status-pill');
            pill.className = `shipment-status-pill st-${s.status || 'draft'}`;
            pill.textContent = this.t('st_' + (s.status || 'draft'));
            const chips = block.querySelector('.shipment-summary-chips');
            chips.innerHTML = `
                <span class="chip"><i class="fa fa-cube"></i> ${(s.containers || []).length}</span>
                <span class="chip"><i class="fa fa-file-text-o"></i> ${(s.invoices || []).length}</span>
                <span class="chip"><i class="fa fa-list"></i> ${(s.packings || []).length}</span>`;
        }

        toggleShipment(shipmentId) {
            console.log("[Portal] toggleShipment:", shipmentId);
            const container = document.getElementById('shipments-container');
            if (!container) return;
            const wasExpanded = this.expandedShipmentId === shipmentId;

            // Collapse all
            container.querySelectorAll('.shipment-block').forEach(b => {
                b.classList.remove('expanded');
                b.querySelector('.shipment-block-body').style.display = 'none';
            });

            if (wasExpanded) {
                this.expandedShipmentId = null;
            } else {
                this.expandedShipmentId = shipmentId;
                const block = container.querySelector(`.shipment-block[data-shipment-id="${shipmentId}"]`);
                if (block) {
                    block.classList.add('expanded');
                    const body = block.querySelector('.shipment-block-body');
                    body.style.display = 'block';
                    const s = (this.proforma.shipments || []).find(x => x.id === shipmentId);
                    if (s) this.renderShipmentBody(body, s);
                    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }

        async addShipment() {
            console.log("[Portal] ====== addShipment() CALLED ======");
            console.log("[Portal] addShipment: token:", this.token ? `\u2713 (${this.token.substring(0, 8)}...)` : '\u2717 EMPTY');
            console.log("[Portal] addShipment: current proforma.id:", this.proforma.id);
            console.log("[Portal] addShipment: current shipments count:", (this.proforma.shipments || []).length);

            try {
                console.log("[Portal] addShipment: calling jsonRpc /supplier/api/v2/create_shipment ...");
                const res = await jsonRpc('/supplier/api/v2/create_shipment', { token: this.token });
                console.log("[Portal] addShipment: response:", JSON.stringify(res));
                if (res.success) {
                    console.log("[Portal] addShipment: \u2713 SUCCESS, new shipment_id:", res.shipment_id);
                    console.log("[Portal] addShipment: reloading proforma...");
                    await this.reloadProforma();
                    console.log("[Portal] addShipment: proforma reloaded, shipments:", (this.proforma.shipments || []).length);
                    this.expandedShipmentId = res.shipment_id;
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    console.warn("[Portal] addShipment: server returned success=false:", res.message);
                    this.toast(this.t('msg_error') + (res.message || ''), 'error');
                }
            } catch (e) {
                console.error("[Portal] addShipment: EXCEPTION:", e.message, e.stack);
                this.toast(this.t('msg_error') + e.message, 'error');
            }
            console.log("[Portal] ====== addShipment() END ======");
        }

        async deleteShipment(shipmentId) {
            console.log("[Portal] deleteShipment:", shipmentId);
            if (!confirm(this.t('msg_confirm_delete'))) return;
            try {
                await jsonRpc('/supplier/api/v2/delete_shipment', { token: this.token, shipment_id: shipmentId });
                if (this.expandedShipmentId === shipmentId) this.expandedShipmentId = null;
                await this.reloadProforma();
                this.renderAll();
                this.toast(this.t('msg_saved'), 'success');
            } catch (e) {
                this.toast(this.t('msg_error') + e.message, 'error');
            }
        }

        // =====================================================================
        //  SHIPMENT BODY (tabs)
        // =====================================================================
        renderShipmentBody(bodyEl, s) {
            const activeTab = this.activeTabByShipment[s.id] || 'logistics';

            bodyEl.innerHTML = `
                <div class="shipment-tabs">
                    ${this._tabBtn('logistics', 'fa-truck', this.t('tab_logistics'), activeTab, s.id)}
                    ${this._tabBtn('bl', 'fa-file-text', this.t('tab_bl'), activeTab, s.id)}
                    ${this._tabBtn('invoices', 'fa-file-invoice-dollar', this.t('tab_invoices'), activeTab, s.id, (s.invoices||[]).length)}
                    ${this._tabBtn('packings', 'fa-boxes', this.t('tab_packings'), activeTab, s.id, (s.packings||[]).length)}
                    ${this._tabBtn('containers', 'fa-cube', this.t('tab_containers'), activeTab, s.id, (s.containers||[]).length)}
                </div>
                <div id="stab-logistics-${s.id}" class="shipment-tab-content ${activeTab==='logistics'?'active':''}"></div>
                <div id="stab-bl-${s.id}" class="shipment-tab-content ${activeTab==='bl'?'active':''}"></div>
                <div id="stab-invoices-${s.id}" class="shipment-tab-content ${activeTab==='invoices'?'active':''}"></div>
                <div id="stab-packings-${s.id}" class="shipment-tab-content ${activeTab==='packings'?'active':''}"></div>
                <div id="stab-containers-${s.id}" class="shipment-tab-content ${activeTab==='containers'?'active':''}"></div>`;

            // Tab click handlers
            bodyEl.querySelectorAll('.shipment-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const name = tab.dataset.tab;
                    this.activeTabByShipment[s.id] = name;
                    bodyEl.querySelectorAll('.shipment-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
                    bodyEl.querySelectorAll('.shipment-tab-content').forEach(c => c.classList.toggle('active', c.id === `stab-${name}-${s.id}`));
                    this.renderTabContent(name, s);
                });
            });

            this.renderTabContent(activeTab, s);
        }

        _tabBtn(name, icon, label, active, sid, count) {
            const isActive = active === name ? 'active' : '';
            const countHtml = count !== undefined ? `<span class="tab-count">${count}</span>` : '';
            return `<div class="shipment-tab ${isActive}" data-tab="${name}"><i class="fa ${icon}"></i> ${label} ${countHtml}</div>`;
        }

        renderTabContent(tabName, s) {
            const el = document.getElementById(`stab-${tabName}-${s.id}`);
            if (!el) return;

            switch (tabName) {
                case 'logistics': this.renderLogisticsTab(el, s); break;
                case 'bl': this.renderBLTab(el, s); break;
                case 'invoices': this.renderInvoicesTab(el, s); break;
                case 'packings': this.renderPackingsTab(el, s); break;
                case 'containers': this.renderContainersTab(el, s); break;
            }
        }

        // --- LOGISTICS TAB ---
        renderLogisticsTab(el, s) {
            const statusOpts = ['draft','in_production','booked','departed','in_transit','arrived','delivered']
                .map(v => `<option value="${v}" ${s.status===v?'selected':''}>${this.t('st_'+v)}</option>`).join('');
            const typeOpts = ['maritime','air','land']
                .map(v => `<option value="${v}" ${s.shipment_type===v?'selected':''}>${this.t('opt_'+v)}</option>`).join('');

            el.innerHTML = `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_shipment_type')}</label>
                        <select data-sf="shipment_type"><option value="">${this.t('opt_select')}</option>${typeOpts}</select>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_shipping_line')}</label>
                        <input type="text" data-sf="shipping_line" value="${esc(s.shipping_line)}" placeholder="Ej. MAERSK"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_vessel')}</label>
                        <input type="text" data-sf="vessel_name" value="${esc(s.vessel_name)}" placeholder="Ej. SEALAND VOYAGER"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_etd')}</label>
                        <input type="date" data-sf="etd" value="${esc(s.etd)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_eta')}</label>
                        <input type="date" data-sf="eta" value="${esc(s.eta)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_origin')}</label>
                        <input type="text" data-sf="port_origin" value="${esc(s.port_origin)}" placeholder="${this.t('ph_origin')}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_port_dest')}</label>
                        <input type="text" data-sf="port_destination" value="${esc(s.port_destination)}" placeholder="${this.t('ph_dest')}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_status')}</label>
                        <select data-sf="status">${statusOpts}</select>
                    </div>
                    <div class="sf-field sf-wide">
                        <label>${this.t('lbl_notes')}</label>
                        <textarea data-sf="notes" rows="2">${esc(s.notes)}</textarea>
                    </div>
                </div>
                <div class="text-end">
                    <button type="button" class="btn-save-section btn-save-shipment-data" data-sid="${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            el.querySelector('.btn-save-shipment-data').addEventListener('click', () => this.saveShipmentData(s.id, el));
        }

        async saveShipmentData(shipmentId, formEl) {
            console.log("[Portal] saveShipmentData:", shipmentId);
            const data = {};
            formEl.querySelectorAll('[data-sf]').forEach(input => {
                data[input.dataset.sf] = input.value;
            });
            console.log("[Portal] saveShipmentData payload:", JSON.stringify(data));
            try {
                const res = await jsonRpc('/supplier/api/v2/update_shipment', {
                    token: this.token, shipment_id: shipmentId, shipment_data: data
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } else {
                    this.toast(this.t('msg_error') + (res.message||''), 'error');
                }
            } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // --- BL TAB ---
        renderBLTab(el, s) {
            el.innerHTML = `
                <div class="shipment-form-grid">
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_number')}</label>
                        <input type="text" id="bl-num-${s.id}" value="${esc(s.bl_number)}" placeholder="Ej. COSU123456"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_date')}</label>
                        <input type="date" id="bl-date-${s.id}" value="${esc(s.bl_date)}"/>
                    </div>
                    <div class="sf-field">
                        <label>${this.t('lbl_bl_file')}</label>
                        <input type="file" id="bl-file-${s.id}" accept=".pdf,.jpg,.jpeg,.png"/>
                    </div>
                </div>
                <div class="text-end mt-2">
                    <button type="button" class="btn-save-section" id="btn-save-bl-${s.id}">
                        <i class="fa fa-save me-2"></i> ${this.t('btn_save_shipment')}
                    </button>
                </div>`;

            document.getElementById(`btn-save-bl-${s.id}`).addEventListener('click', async () => {
                console.log("[Portal] saveBL for shipment:", s.id);
                const blData = {
                    bl_number: document.getElementById(`bl-num-${s.id}`).value,
                    bl_date: document.getElementById(`bl-date-${s.id}`).value || false,
                };
                try {
                    await jsonRpc('/supplier/api/v2/update_shipment', {
                        token: this.token, shipment_id: s.id, shipment_data: blData
                    });
                    // Upload file if selected
                    const fileInput = document.getElementById(`bl-file-${s.id}`);
                    if (fileInput.files.length > 0) {
                        const fileData = await this.readFileAsBase64(fileInput.files[0]);
                        await jsonRpc('/supplier/api/v2/upload_file', {
                            token: this.token,
                            target_model: 'supplier.shipment',
                            target_id: s.id,
                            field_name: 'bl_file',
                            file_data: fileData.data,
                            file_name: fileData.name
                        });
                    }
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
            });
        }

        // --- INVOICES TAB ---
        renderInvoicesTab(el, s) {
            const invoices = s.invoices || [];
            let html = '';
            invoices.forEach((inv, idx) => {
                html += this._invoiceCard(inv, idx, s);
            });
            html += `<button type="button" class="btn-add-sub-item btn-add-inv" data-sid="${s.id}"><i class="fa fa-plus me-2"></i>${this.t('btn_add_invoice')}</button>`;
            html += `<div class="text-end mt-3"><button type="button" class="btn-save-section btn-save-all-invoices" data-sid="${s.id}"><i class="fa fa-save me-2"></i>${this.t('btn_save_invoices')}</button></div>`;
            el.innerHTML = html;

            el.querySelector('.btn-add-inv').addEventListener('click', () => {
                s.invoices = s.invoices || [];
                s.invoices.push({ id: 0, invoice_number: '', invoice_date: '', amount: 0, scope: 'full_shipment', container_ids: [] });
                this.renderTabContent('invoices', s);
            });

            el.querySelectorAll('.btn-remove-inv').forEach(btn => {
                btn.addEventListener('click', () => {
                    const i = parseInt(btn.dataset.idx);
                    s.invoices.splice(i, 1);
                    this.renderTabContent('invoices', s);
                });
            });

            el.querySelector('.btn-save-all-invoices').addEventListener('click', () => this.saveInvoices(s));
        }

        _invoiceCard(inv, idx, s) {
            return `<div class="sub-item-card">
                <div class="sub-item-header">
                    <span class="sub-item-title">Invoice #${idx+1}</span>
                    <div class="sub-item-actions"><button type="button" class="btn-remove-inv" data-idx="${idx}"><i class="fa fa-trash"></i></button></div>
                </div>
                <div class="sub-item-grid">
                    <div class="sub-item-field">
                        <label>${this.t('lbl_inv_number')}</label>
                        <input type="text" data-inv-idx="${idx}" data-inv-f="invoice_number" value="${esc(inv.invoice_number)}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_inv_date')}</label>
                        <input type="date" data-inv-idx="${idx}" data-inv-f="invoice_date" value="${esc(inv.invoice_date)}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_inv_amount')}</label>
                        <input type="number" step="0.01" data-inv-idx="${idx}" data-inv-f="amount" value="${inv.amount||0}"/>
                    </div>
                    <div class="sub-item-field">
                        <label>${this.t('lbl_inv_scope')}</label>
                        <select data-inv-idx="${idx}" data-inv-f="scope">
                            <option value="full_shipment" ${inv.scope==='full_shipment'?'selected':''}>${this.t('scope_full')}</option>
                            <option value="specific_containers" ${inv.scope==='specific_containers'?'selected':''}>${this.t('scope_specific')}</option>
                        </select>
                    </div>
                </div>
            </div>`;
        }

        async saveInvoices(s) {
            console.log("[Portal] saveInvoices for shipment:", s.id);
            const el = document.getElementById(`stab-invoices-${s.id}`);
            const invoicesData = [];
            (s.invoices || []).forEach((inv, idx) => {
                const data = { id: inv.id || 0 };
                el.querySelectorAll(`[data-inv-idx="${idx}"]`).forEach(input => {
                    const f = input.dataset.invF;
                    data[f] = input.value;
                });
                data.amount = parseFloat(data.amount) || 0;
                invoicesData.push(data);
            });
            console.log("[Portal] saveInvoices payload:", JSON.stringify(invoicesData));

            try {
                const res = await jsonRpc('/supplier/api/v2/save_invoices', {
                    token: this.token, shipment_id: s.id, invoices: invoicesData
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // --- CONTAINERS TAB ---
        renderContainersTab(el, s) {
            const containers = s.containers || [];
            let html = '';
            containers.forEach((c, idx) => {
                html += `<div class="sub-item-card">
                    <div class="sub-item-header">
                        <span class="sub-item-title">${esc(c.container_number) || 'Container #'+(idx+1)}</span>
                        <div class="sub-item-actions"><button type="button" class="btn-remove-cnt" data-idx="${idx}"><i class="fa fa-trash"></i></button></div>
                    </div>
                    <div class="sub-item-grid">
                        <div class="sub-item-field"><label>${this.t('lbl_cont_number')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="container_number" value="${esc(c.container_number)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_seal')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="seal_number" value="${esc(c.seal_number)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_type')}</label><input type="text" data-cnt-idx="${idx}" data-cnt-f="container_type" value="${esc(c.container_type)}" placeholder="40HC, 20GP"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_weight')}</label><input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="weight" value="${c.weight||0}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_volume')}</label><input type="number" step="0.01" data-cnt-idx="${idx}" data-cnt-f="volume" value="${c.volume||0}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_cont_packages')}</label><input type="number" data-cnt-idx="${idx}" data-cnt-f="packages" value="${c.packages||0}"/></div>
                    </div>
                </div>`;
            });

            html += `<button type="button" class="btn-add-sub-item btn-add-cnt" data-sid="${s.id}"><i class="fa fa-plus me-2"></i>${this.t('btn_add_container')}</button>`;
            html += `<div class="text-end mt-3"><button type="button" class="btn-save-section btn-save-all-cnts" data-sid="${s.id}"><i class="fa fa-save me-2"></i>${this.t('btn_save_containers')}</button></div>`;
            el.innerHTML = html;

            el.querySelector('.btn-add-cnt').addEventListener('click', () => {
                s.containers = s.containers || [];
                s.containers.push({ id: 0, container_number: '', seal_number: '', container_type: '', weight: 0, volume: 0, packages: 0, notes: '' });
                this.renderTabContent('containers', s);
            });

            el.querySelectorAll('.btn-remove-cnt').forEach(btn => {
                btn.addEventListener('click', () => {
                    s.containers.splice(parseInt(btn.dataset.idx), 1);
                    this.renderTabContent('containers', s);
                });
            });

            el.querySelector('.btn-save-all-cnts').addEventListener('click', () => this.saveContainers(s));
        }

        async saveContainers(s) {
            console.log("[Portal] saveContainers for shipment:", s.id);
            const el = document.getElementById(`stab-containers-${s.id}`);
            const containersData = [];
            (s.containers || []).forEach((c, idx) => {
                const data = { id: c.id || 0 };
                el.querySelectorAll(`[data-cnt-idx="${idx}"]`).forEach(input => {
                    data[input.dataset.cntF] = input.value;
                });
                data.weight = parseFloat(data.weight) || 0;
                data.volume = parseFloat(data.volume) || 0;
                data.packages = parseInt(data.packages) || 0;
                containersData.push(data);
            });
            console.log("[Portal] saveContainers payload:", JSON.stringify(containersData));

            try {
                const res = await jsonRpc('/supplier/api/v2/save_containers', {
                    token: this.token, shipment_id: s.id, containers: containersData
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // --- PACKINGS TAB ---
        renderPackingsTab(el, s) {
            const packings = s.packings || [];
            let html = '';

            packings.forEach((pk, idx) => {
                const rowCount = (pk.rows || []).length;
                html += `<div class="sub-item-card" data-packing-id="${pk.id}">
                    <div class="sub-item-header">
                        <span class="sub-item-title">${esc(pk.packing_number) || 'Packing #'+(idx+1)} <small class="text-muted">(${rowCount} rows)</small></span>
                        <div class="sub-item-actions">
                            <button type="button" class="btn-toggle-packing-rows" data-pk-id="${pk.id}" title="Edit rows"><i class="fa fa-edit"></i></button>
                            <button type="button" class="btn-delete-pk" data-pk-id="${pk.id}"><i class="fa fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="sub-item-grid">
                        <div class="sub-item-field"><label>${this.t('lbl_pk_number')}</label><input type="text" data-pk-id="${pk.id}" data-pk-f="packing_number" value="${esc(pk.packing_number)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_pk_date')}</label><input type="date" data-pk-id="${pk.id}" data-pk-f="packing_date" value="${esc(pk.packing_date)}"/></div>
                        <div class="sub-item-field"><label>${this.t('lbl_pk_scope')}</label>
                            <select data-pk-id="${pk.id}" data-pk-f="scope">
                                <option value="full_shipment" ${pk.scope==='full_shipment'?'selected':''}>${this.t('scope_full')}</option>
                                <option value="specific_containers" ${pk.scope==='specific_containers'?'selected':''}>${this.t('scope_specific')}</option>
                            </select>
                        </div>
                    </div>
                    <!-- Packing rows (product detail) - expandable -->
                    <div class="packing-rows-area" id="pk-rows-${pk.id}" style="display:none; margin-top: 1rem;"></div>
                    <div class="text-end mt-2">
                        <button type="button" class="btn-save-section btn-save-pk" data-pk-id="${pk.id}" data-sid="${s.id}" style="font-size:0.8rem;padding:6px 16px;">
                            <i class="fa fa-save me-1"></i> ${this.t('btn_save_packing')}
                        </button>
                    </div>
                </div>`;
            });

            html += `<button type="button" class="btn-add-sub-item btn-add-pk" data-sid="${s.id}"><i class="fa fa-plus me-2"></i>${this.t('btn_add_packing')}</button>`;
            el.innerHTML = html;

            // Add packing
            el.querySelector('.btn-add-pk').addEventListener('click', async () => {
                console.log("[Portal] addPacking for shipment:", s.id);
                try {
                    const res = await jsonRpc('/supplier/api/v2/save_packing', {
                        token: this.token, shipment_id: s.id,
                        packing_data: { packing_number: '', scope: 'full_shipment' },
                        rows: []
                    });
                    if (res.success) {
                        await this.reloadProforma();
                        this.renderAll();
                        this.toast(this.t('msg_saved'), 'success');
                    }
                } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
            });

            // Delete packing
            el.querySelectorAll('.btn-delete-pk').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm(this.t('msg_confirm_delete'))) return;
                    try {
                        await jsonRpc('/supplier/api/v2/delete_packing', { token: this.token, packing_id: parseInt(btn.dataset.pkId) });
                        await this.reloadProforma();
                        this.renderAll();
                        this.toast(this.t('msg_saved'), 'success');
                    } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
                });
            });

            // Save packing
            el.querySelectorAll('.btn-save-pk').forEach(btn => {
                btn.addEventListener('click', () => this.savePacking(parseInt(btn.dataset.pkId), parseInt(btn.dataset.sid), el));
            });

            // Toggle packing rows
            el.querySelectorAll('.btn-toggle-packing-rows').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pkId = parseInt(btn.dataset.pkId);
                    const area = document.getElementById(`pk-rows-${pkId}`);
                    if (!area) return;
                    const wasVisible = area.style.display !== 'none';
                    area.style.display = wasVisible ? 'none' : 'block';
                    if (!wasVisible) {
                        const pk = packings.find(p => p.id === pkId);
                        this.renderPackingRows(area, pk, s);
                    }
                });
            });
        }

        async savePacking(packingId, shipmentId, formEl) {
            console.log("[Portal] savePacking:", packingId, "shipment:", shipmentId);
            const pkData = {};
            formEl.querySelectorAll(`[data-pk-id="${packingId}"][data-pk-f]`).forEach(input => {
                pkData[input.dataset.pkF] = input.value;
            });
            pkData.id = packingId;

            // Gather rows if they exist
            const rowsKey = `pk_${packingId}`;
            const rows = this.packingRows[rowsKey] || [];
            const rowsPayload = rows.filter(r => {
                if (r.tipo === 'Placa') return r.alto > 0 && r.ancho > 0;
                return r.quantity > 0;
            }).map(r => ({
                product_id: r.product_id,
                container_id: r.container_id || 0,
                tipo: r.tipo,
                grosor: r.grosor || '',
                alto: r.alto || 0,
                ancho: r.ancho || 0,
                peso: r.peso || 0,
                quantity: r.quantity || 0,
                bloque: r.bloque || '',
                numero_placa: r.numero_placa || '',
                atado: r.atado || '',
                color: r.color || '',
                grupo_name: r.grupo_name || '',
                pedimento: r.pedimento || '',
                ref_proveedor: r.ref_proveedor || '',
            }));

            console.log("[Portal] savePacking pkData:", JSON.stringify(pkData), "rows:", rowsPayload.length);

            try {
                const res = await jsonRpc('/supplier/api/v2/save_packing', {
                    token: this.token,
                    shipment_id: shipmentId,
                    packing_data: pkData,
                    rows: rowsPayload.length > 0 ? rowsPayload : null
                });
                if (res.success) {
                    await this.reloadProforma();
                    this.renderAll();
                    this.toast(this.t('msg_saved'), 'success');
                }
            } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // =====================================================================
        //  PACKING ROWS (product detail lines) \u2014 reuses old logic
        // =====================================================================
        renderPackingRows(area, pk, s) {
            if (!pk) return;
            const rowsKey = `pk_${pk.id}`;

            // Initialize rows from server data if not yet loaded
            if (!this.packingRows[rowsKey]) {
                if (pk.rows && pk.rows.length > 0) {
                    this.packingRows[rowsKey] = pk.rows.map(r => ({ ...r, _id: this.nextRowId++ }));
                } else {
                    // Create one empty row per product
                    this.packingRows[rowsKey] = [];
                    this.products.forEach(p => {
                        this.packingRows[rowsKey].push(this._newProductRow(p));
                    });
                }
            }

            const rows = this.packingRows[rowsKey];
            let html = '';

            this.products.forEach(product => {
                const unitType = product.unit_type || 'Placa';
                const typeLabel = this.t(`lbl_type_${unitType.toLowerCase()}`);
                const pRows = rows.filter(r => r.product_id === product.id);

                html += `<div class="product-section">
                    <div class="product-header">
                        <div><h3>${esc(product.name)} <span class="text-muted small ms-2">(${esc(product.code)})</span>
                            <span class="badge bg-secondary ms-2" style="font-size:0.7em">${typeLabel}</span></h3></div>
                        <div class="meta">${this.t('requested')} <strong class="text-dark">${product.qty_ordered} ${product.uom}</strong></div>
                    </div>
                    <div class="table-responsive"><table class="portal-table"><thead><tr>`;

                if (unitType === 'Placa') {
                    html += `<th>${this.t('col_block')}</th><th>${this.t('col_atado')}</th><th>${this.t('col_plate_num')}</th><th>${this.t('col_ref')}</th><th>${this.t('col_thickness')}</th><th>${this.t('col_height')}</th><th>${this.t('col_width')}</th><th>${this.t('col_area')}</th><th>${this.t('col_notes')}</th>`;
                } else if (unitType === 'Formato') {
                    html += `<th>${this.t('lbl_packages')}</th><th>${this.t('col_qty')}</th><th class="bg-light">${this.t('col_crate_h')}</th><th class="bg-light">${this.t('col_crate_w')}</th><th class="bg-light">${this.t('col_crate_t')}</th><th>${this.t('col_thickness')}</th><th>${this.t('col_weight')}</th><th class="bg-light">${this.t('col_fmt_h')}</th><th class="bg-light">${this.t('col_fmt_w')}</th>`;
                } else {
                    html += `<th>${this.t('lbl_packages')}</th><th>${this.t('col_qty')}</th><th>${this.t('col_ref')}</th><th>${this.t('col_weight')}</th><th>${this.t('lbl_desc_goods')}</th>`;
                }
                html += `<th style="width:50px"></th></tr></thead><tbody>`;

                pRows.forEach(row => {
                    const rid = row._id;
                    html += `<tr data-row-id="${rid}" data-pk-key="${rowsKey}">`;

                    const inp = (field, val, ph, type='text', step='') =>
                        `<div class="input-group-portal"><input type="${type}" step="${step}" class="input-field" data-field="${field}" value="${esc(val||'')}" placeholder="${ph}">
                         <button type="button" class="btn-fill-down" data-row-id="${rid}" data-field="${field}" data-pk-key="${rowsKey}" tabindex="-1"><i class="fa fa-arrow-down"></i></button></div>`;

                    if (unitType === 'Placa') {
                        const area = ((row.alto||0) * (row.ancho||0)).toFixed(2);
                        html += `<td data-label="${this.t('col_block')}">${inp('bloque', row.bloque, '')}</td>
                            <td data-label="${this.t('col_atado')}">${inp('atado', row.atado, '')}</td>
                            <td data-label="${this.t('col_plate_num')}">${inp('numero_placa', row.numero_placa, '')}</td>
                            <td data-label="${this.t('col_ref')}">${inp('ref_proveedor', row.ref_proveedor, '')}</td>
                            <td data-label="${this.t('col_thickness')}">${inp('grosor', row.grosor, '', 'text')}</td>
                            <td data-label="${this.t('col_height')}">${inp('alto', row.alto, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_width')}">${inp('ancho', row.ancho, '', 'number', '0.01')}</td>
                            <td data-label="${this.t('col_area')}"><span class="area-display">${area}</span></td>
                            <td data-label="${this.t('col_notes')}">${inp('color', row.color, '')}</td>`;
                    } else if (unitType === 'Formato') {
                        html += `<td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('crate_h', row.crate_h||'', '', 'text')}</td>
                            <td>${inp('crate_w', row.crate_w||'', '', 'text')}</td>
                            <td>${inp('crate_t', row.crate_t||'', '', 'text')}</td>
                            <td>${inp('grosor', row.grosor, '', 'text')}</td>
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>
                            <td>${inp('fmt_h', row.fmt_h||'', '', 'text')}</td>
                            <td>${inp('fmt_w', row.fmt_w||'', '', 'text')}</td>`;
                    } else {
                        html += `<td>${inp('atado', row.atado, '')}</td>
                            <td>${inp('quantity', row.quantity, '', 'number', '1')}</td>
                            <td>${inp('ref_proveedor', row.ref_proveedor, '')}</td>
                            <td>${inp('peso', row.peso, '', 'number', '0.01')}</td>
                            <td>${inp('color', row.color, '')}</td>`;
                    }

                    html += `<td class="text-center"><button class="btn-action btn-delete-row" type="button"><i class="fa fa-trash"></i></button></td></tr>`;
                });

                html += `</tbody></table>
                    <div class="table-actions">
                        <button class="btn-add-row action-add-pk-row" data-product-id="${product.id}" data-pk-key="${rowsKey}" type="button"><i class="fa fa-plus-circle me-2"></i>${this.t('btn_add_row')}</button>
                        <button class="btn-add-row ms-2 action-add-pk-multi" data-product-id="${product.id}" data-pk-key="${rowsKey}" type="button">${this.t('btn_add_multi')}</button>
                    </div></div></div>`;
            });

            area.innerHTML = html;

            // Bind row events via delegation
            area.addEventListener('input', e => {
                if (e.target.classList.contains('input-field')) {
                    const tr = e.target.closest('tr');
                    const rid = parseInt(tr.dataset.rowId);
                    const key = tr.dataset.pkKey;
                    const field = e.target.dataset.field;
                    const rws = this.packingRows[key];
                    const row = rws?.find(r => r._id === rid);
                    if (!row) return;
                    if (['alto','ancho','quantity','peso','weight'].includes(field)) {
                        row[field] = parseFloat(e.target.value) || 0;
                    } else {
                        row[field] = e.target.value;
                    }
                    if ((field === 'alto' || field === 'ancho') && row.tipo === 'Placa') {
                        const span = tr.querySelector('.area-display');
                        if (span) span.textContent = ((row.alto||0) * (row.ancho||0)).toFixed(2);
                    }
                }
            });

            area.addEventListener('click', e => {
                const delBtn = e.target.closest('.btn-delete-row');
                const addBtn = e.target.closest('.action-add-pk-row');
                const addMulti = e.target.closest('.action-add-pk-multi');
                const fillBtn = e.target.closest('.btn-fill-down');

                if (delBtn) {
                    const tr = delBtn.closest('tr');
                    const rid = parseInt(tr.dataset.rowId);
                    const key = tr.dataset.pkKey;
                    this.packingRows[key] = (this.packingRows[key]||[]).filter(r => r._id !== rid);
                    this.renderPackingRows(area, pk, s);
                } else if (addBtn) {
                    const pid = parseInt(addBtn.dataset.productId);
                    const key = addBtn.dataset.pkKey;
                    const p = this.products.find(x => x.id === pid);
                    if (p) { this.packingRows[key].push(this._newProductRow(p)); this.renderPackingRows(area, pk, s); }
                } else if (addMulti) {
                    const pid = parseInt(addMulti.dataset.productId);
                    const key = addMulti.dataset.pkKey;
                    const p = this.products.find(x => x.id === pid);
                    if (p) { for (let i=0;i<5;i++) this.packingRows[key].push(this._newProductRow(p)); this.renderPackingRows(area, pk, s); }
                } else if (fillBtn) {
                    const rid = parseInt(fillBtn.dataset.rowId);
                    const field = fillBtn.dataset.field;
                    const key = fillBtn.dataset.pkKey;
                    const rws = this.packingRows[key] || [];
                    const src = rws.find(r => r._id === rid);
                    if (!src) return;
                    let started = false;
                    rws.forEach(r => {
                        if (r._id === rid) { started = true; return; }
                        if (started && r.product_id === src.product_id) r[field] = src[field];
                    });
                    this.renderPackingRows(area, pk, s);
                }
            });
        }

        _newProductRow(product) {
            const unitType = product.unit_type || 'Placa';
            return {
                _id: this.nextRowId++,
                product_id: product.id,
                tipo: unitType,
                bloque: '', numero_placa: '', atado: '', grosor: '',
                alto: 0, ancho: 0, peso: 0, quantity: 0, weight: 0,
                color: '', ref_proveedor: '', grupo_name: '', pedimento: '',
                crate_h: '', crate_w: '', crate_t: '', fmt_h: '', fmt_w: '',
                container_id: 0,
            };
        }

        // =====================================================================
        //  RELOAD & FOOTER
        // =====================================================================
        async reloadProforma() {
            console.log("[Portal] reloadProforma() calling /supplier/api/v2/reload ...");
            try {
                const res = await jsonRpc('/supplier/api/v2/reload', { token: this.token });
                console.log("[Portal] reloadProforma: success:", res.success, "proforma id:", res.proforma?.id, "shipments:", (res.proforma?.shipments || []).length);
                if (res.success && res.proforma) {
                    this.proforma = res.proforma;
                }
            } catch (e) {
                console.error('[Portal] reloadProforma ERROR:', e.message, e.stack);
            }
        }

        updateFooterTotals() {
            const shipments = this.proforma.shipments || [];
            let totalContainers = 0, totalInvoices = 0;
            shipments.forEach(s => {
                totalContainers += (s.containers || []).length;
                totalInvoices += (s.invoices || []).length;
            });

            const setEl = (id, val) => { const e = document.getElementById(id); if(e) e.textContent = val; };
            setEl('total-shipments', shipments.length);
            setEl('total-containers', totalContainers);
            setEl('total-invoices', totalInvoices);

            const btn = document.getElementById('btn-complete-proforma');
            if (btn) btn.disabled = shipments.length === 0;
        }

        async completeProforma() {
            console.log("[Portal] completeProforma() called");
            if (!confirm(this.t('msg_confirm_complete'))) return;
            try {
                await jsonRpc('/supplier/api/v2/complete', { token: this.token });
                await this.reloadProforma();
                this.renderAll();
                this.toast(this.t('msg_saved'), 'success');
            } catch(e) { this.toast(this.t('msg_error') + e.message, 'error'); }
        }

        // =====================================================================
        //  GLOBAL EVENTS
        // =====================================================================
        bindGlobalEvents() {
            console.log("[Portal] ====== bindGlobalEvents() START ======");
            if (this._eventsBound) {
                console.log("[Portal] bindGlobalEvents: SKIPPED (already bound)");
                return;
            }
            this._eventsBound = true;

            const btnSaveGlobals = document.getElementById('btn-save-globals');
            const btnAddShipment = document.getElementById('btn-add-shipment');
            const btnComplete = document.getElementById('btn-complete-proforma');

            console.log("[Portal] bindGlobalEvents: #btn-save-globals:", btnSaveGlobals ? '\u2713 FOUND' : '\u2717 NOT FOUND');
            console.log("[Portal] bindGlobalEvents: #btn-add-shipment:", btnAddShipment ? '\u2713 FOUND' : '\u2717 NOT FOUND');
            console.log("[Portal] bindGlobalEvents: #btn-complete-proforma:", btnComplete ? '\u2713 FOUND' : '\u2717 NOT FOUND');

            if (btnSaveGlobals) {
                console.log("[Portal] bindGlobalEvents: btnSaveGlobals tagName:", btnSaveGlobals.tagName, "type:", btnSaveGlobals.type, "disabled:", btnSaveGlobals.disabled, "id:", btnSaveGlobals.id);
                console.log("[Portal] bindGlobalEvents: btnSaveGlobals outerHTML (first 200):", btnSaveGlobals.outerHTML.substring(0, 200));
                // Check for any parent form that might intercept
                const parentForm = btnSaveGlobals.closest('form');
                if (parentForm) {
                    console.warn("[Portal] \u26a0\ufe0f btn-save-globals is INSIDE a <form>! action:", parentForm.action, "method:", parentForm.method);
                    console.log("[Portal] Preventing form default submit...");
                    parentForm.addEventListener('submit', (e) => {
                        console.log("[Portal] \u26a0\ufe0f FORM SUBMIT intercepted! Preventing default.");
                        e.preventDefault();
                    });
                }
                btnSaveGlobals.addEventListener('click', (e) => {
                    console.log("[Portal] \u1f514 btn-save-globals CLICK event fired!");
                    console.log("[Portal] click event detail:", { type: e.type, target: e.target.tagName, currentTarget: e.currentTarget.tagName, defaultPrevented: e.defaultPrevented, bubbles: e.bubbles });
                    e.preventDefault();
                    e.stopPropagation();
                    this.saveGlobals();
                });
                console.log("[Portal] \u2713 btn-save-globals click handler attached");
            } else {
                console.error("[Portal] \u2717 btn-save-globals NOT FOUND \u2014 checking all buttons in DOM...");
                const allBtns = document.querySelectorAll('button');
                console.log("[Portal] Total <button> elements in DOM:", allBtns.length);
                allBtns.forEach((b, i) => {
                    if (b.id || b.className.includes('save') || b.className.includes('global') || b.textContent.includes('Guardar') || b.textContent.includes('Save')) {
                        console.log(`[Portal]   button[${i}]: id="${b.id}" class="${b.className}" text="${b.textContent.trim().substring(0, 50)}"`);
                    }
                });
            }

            if (btnAddShipment) {
                console.log("[Portal] bindGlobalEvents: btnAddShipment tagName:", btnAddShipment.tagName, "type:", btnAddShipment.type, "disabled:", btnAddShipment.disabled, "id:", btnAddShipment.id);
                console.log("[Portal] bindGlobalEvents: btnAddShipment outerHTML (first 200):", btnAddShipment.outerHTML.substring(0, 200));
                const parentForm = btnAddShipment.closest('form');
                if (parentForm) {
                    console.warn("[Portal] \u26a0\ufe0f btn-add-shipment is INSIDE a <form>! action:", parentForm.action, "method:", parentForm.method);
                    parentForm.addEventListener('submit', (e) => {
                        console.log("[Portal] \u26a0\ufe0f FORM SUBMIT intercepted on add-shipment form! Preventing default.");
                        e.preventDefault();
                    });
                }
                btnAddShipment.addEventListener('click', (e) => {
                    console.log("[Portal] \u1f514 btn-add-shipment CLICK event fired!");
                    console.log("[Portal] click event detail:", { type: e.type, target: e.target.tagName, currentTarget: e.currentTarget.tagName, defaultPrevented: e.defaultPrevented });
                    e.preventDefault();
                    e.stopPropagation();
                    this.addShipment();
                });
                console.log("[Portal] \u2713 btn-add-shipment click handler attached");
            } else {
                console.error("[Portal] \u2717 btn-add-shipment NOT FOUND \u2014 checking all buttons in DOM...");
                const allBtns = document.querySelectorAll('button');
                allBtns.forEach((b, i) => {
                    if (b.id || b.className.includes('shipment') || b.className.includes('add') || b.textContent.includes('Embarque') || b.textContent.includes('Shipment')) {
                        console.log(`[Portal]   button[${i}]: id="${b.id}" class="${b.className}" text="${b.textContent.trim().substring(0, 50)}"`);
                    }
                });
            }

            if (btnComplete) {
                btnComplete.addEventListener('click', (e) => {
                    console.log("[Portal] \u1f514 btn-complete-proforma CLICK event fired!");
                    e.preventDefault();
                    e.stopPropagation();
                    this.completeProforma();
                });
                console.log("[Portal] \u2713 btn-complete-proforma click handler attached");
            }

            // === SAFETY NET: document-level click listener for debugging ===
            document.addEventListener('click', (e) => {
                const target = e.target;
                const btn = target.closest('button') || target.closest('[role="button"]') || target.closest('a');
                if (btn) {
                    const id = btn.id || '';
                    const cls = btn.className || '';
                    const txt = (btn.textContent || '').trim().substring(0, 40);
                    if (id.includes('save') || id.includes('shipment') || id.includes('global') ||
                        cls.includes('save') || cls.includes('shipment') || cls.includes('global') ||
                        txt.includes('Guardar') || txt.includes('Save') || txt.includes('Embarque') || txt.includes('Shipment')) {
                        console.log(`[Portal][DOC-CLICK] Detected click on relevant button: id="${id}" class="${cls}" text="${txt}" tagName="${btn.tagName}" disabled=${btn.disabled}`);
                    }
                }
            }, true); // capture phase

            console.log("[Portal] ====== bindGlobalEvents() END ======");
        }

        // =====================================================================
        //  UTILITIES
        // =====================================================================
        readFileAsBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve({ name: file.name, data: e.target.result.split(',')[1] });
                reader.onerror = () => reject(new Error('File read failed'));
                reader.readAsDataURL(file);
            });
        }

        toast(msg, type='info') {
            console.log(`[Portal] Toast [${type}]: ${msg}`);
            let toastEl = document.querySelector('.portal-toast');
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.className = 'portal-toast';
                document.body.appendChild(toastEl);
            }
            toastEl.className = `portal-toast toast-${type}`;
            toastEl.textContent = msg;
            requestAnimationFrame(() => { toastEl.classList.add('show'); });
            setTimeout(() => { toastEl.classList.remove('show'); }, 3000);
        }
    }

    window.supplierPortal = new SupplierPortal();
})();```

## ./static/src/scss/supplier_portal.scss
```scss
/* static/src/scss/supplier_portal.scss */
/* v3.0 — Hierarchical Portal: Proforma → Shipments → Docs → Containers */

/* --- Variables: Palette Cream & Wood --- */
$bg-body: #F9F9F7;
$bg-card: #FFFFFF;
$bg-input: #FFFFFF;
$primary-wood: #8B5A2B;
$primary-hover: #6D4C41;
$secondary-wood: #D7CCC8;

$text-main: #2C2C2C;
$text-muted: #666666;
$border-color: #E0E0E0;
$input-border: #CCCCCC;

$accent-blue: #2563EB;
$accent-green: #16A34A;
$accent-orange: #EA580C;
$accent-red: #DC2626;

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
    background: rgba(255, 255, 255, 0.98);
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

/* --- SHIPMENT CARD & FORMS (reutilizado para globals) --- */
.shipment-card {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 10px;
    margin-bottom: 2rem;
    box-shadow: 0 5px 20px rgba(0,0,0,0.03);
    overflow: hidden;

    .card-header {
        background: #F4F0EB;
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

/* --- BADGE DE STATUS --- */
.badge-status {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;

    &.status-draft { background: #F3F4F6; color: #6B7280; }
    &.status-partial { background: #FEF3C7; color: #92400E; }
    &.status-complete { background: #D1FAE5; color: #065F46; }
}

/* ============================================================ */
/*  SHIPMENTS SECTION — Accordion / Block layout                */
/* ============================================================ */

.shipments-section {
    margin-bottom: 2rem;
}

.section-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.2rem;
    padding: 0 0.2rem;

    .section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        
        i { color: $primary-wood; font-size: 1.2rem; }
        h3 { margin: 0; font-size: 1.15rem; color: $primary-wood; font-weight: 700; }
    }
}

.shipment-count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    border-radius: 12px;
    background: $primary-wood;
    color: #FFF;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0 6px;
}

.btn-add-shipment {
    display: flex;
    align-items: center;
    padding: 8px 20px;
    border-radius: 8px;
    background: $primary-wood;
    color: #FFF;
    border: none;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;

    &:hover { background: $primary-hover; }
    &:active { transform: scale(0.97); }
}

.btn-save-section {
    display: inline-flex;
    align-items: center;
    padding: 8px 24px;
    border-radius: 8px;
    background: $accent-blue;
    color: #FFF;
    border: none;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s, transform 0.1s;

    &:hover { background: darken($accent-blue, 8%); }
    &:active { transform: scale(0.97); }
    &:disabled { background: #CCC; color: #888; cursor: not-allowed; }

    &.btn-save-success {
        background: $accent-green;
        &:hover { background: darken($accent-green, 8%); }
    }
    &.btn-save-danger {
        background: $accent-red;
        &:hover { background: darken($accent-red, 8%); }
    }
}

.empty-state {
    text-align: center;
    padding: 3rem 2rem;
    color: $text-muted;
    background: #FAFAFA;
    border: 2px dashed $border-color;
    border-radius: 10px;

    i { color: #D0D0D0; margin-bottom: 1rem; }
    p { margin: 0; font-size: 0.9rem; }
}

/* --- SHIPMENT BLOCK (accordion item) --- */
.shipment-block {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 10px;
    margin-bottom: 1rem;
    box-shadow: 0 2px 10px rgba(0,0,0,0.03);
    overflow: hidden;
    transition: box-shadow 0.2s;

    &.expanded {
        box-shadow: 0 4px 20px rgba(139, 90, 43, 0.1);
        border-color: $primary-wood;
    }
}

.shipment-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.8rem 1.2rem;
    background: #F8F6F3;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid transparent;
    transition: background 0.2s;

    .expanded & {
        background: #F4F0EB;
        border-bottom-color: $secondary-wood;
    }

    &:hover { background: #F0ECE6; }
}

.shipment-block-title {
    display: flex;
    align-items: center;
    gap: 10px;

    .shipment-name {
        font-weight: 700;
        font-size: 1rem;
        color: $primary-wood;
    }

    .shipment-status-pill {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 10px;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        background: #F3F4F6;
        color: #6B7280;

        &.st-draft { background: #F3F4F6; color: #6B7280; }
        &.st-in_production { background: #DBEAFE; color: #1E40AF; }
        &.st-booked { background: #E0E7FF; color: #3730A3; }
        &.st-departed { background: #FEF3C7; color: #92400E; }
        &.st-in_transit { background: #FDE68A; color: #78350F; }
        &.st-arrived { background: #D1FAE5; color: #065F46; }
        &.st-delivered { background: #A7F3D0; color: #047857; }
    }

    .shipment-summary-chips {
        display: flex;
        gap: 6px;
        margin-left: 10px;
        
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 6px;
            font-size: 0.7rem;
            font-weight: 600;
            background: #F0F0F0;
            color: $text-muted;

            i { font-size: 0.65rem; }
        }
    }
}

.shipment-block-actions {
    display: flex;
    gap: 6px;

    button {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        border: 1px solid $border-color;
        background: #FFF;
        color: $text-muted;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 0.85rem;

        &:hover { background: #F5F5F5; color: $text-main; }
    }

    .btn-delete-shipment:hover {
        background: #FFEBEE;
        color: $accent-red;
        border-color: #FFCDD2;
    }

    .btn-toggle-shipment {
        i { transition: transform 0.2s; }
        .expanded & i { transform: rotate(180deg); }
    }
}

.shipment-block-body {
    padding: 1.5rem;
    
    @include mobile { padding: 1rem; }
}

/* --- TABS dentro de embarque --- */
.shipment-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid $border-color;
    margin-bottom: 1.5rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}

.shipment-tab {
    padding: 10px 20px;
    font-size: 0.82rem;
    font-weight: 600;
    color: $text-muted;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    transition: all 0.2s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;

    &:hover { color: $primary-wood; background: rgba(139, 90, 43, 0.04); }

    &.active {
        color: $primary-wood;
        border-bottom-color: $primary-wood;
        font-weight: 700;
    }

    .tab-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        border-radius: 9px;
        background: #E5E7EB;
        color: $text-muted;
        font-size: 0.65rem;
        font-weight: 700;
        padding: 0 4px;
    }

    &.active .tab-count {
        background: $primary-wood;
        color: #FFF;
    }
}

.shipment-tab-content {
    display: none;
    &.active { display: block; }
}

/* --- SUB-ITEMS: Invoices, Packings, Containers --- */
.sub-item-card {
    background: #FAFAFA;
    border: 1px solid $border-color;
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.8rem;
    position: relative;

    .sub-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.8rem;

        .sub-item-title {
            font-weight: 700;
            font-size: 0.9rem;
            color: $text-main;
        }

        .sub-item-actions button {
            width: 28px;
            height: 28px;
            border-radius: 4px;
            border: 1px solid #E5E7EB;
            background: #FFF;
            color: $text-muted;
            cursor: pointer;
            font-size: 0.75rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;

            &:hover { background: #FFEBEE; color: $accent-red; }
        }
    }

    .sub-item-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.8rem;

        @include mobile { grid-template-columns: 1fr; }
    }

    .sub-item-field {
        display: flex;
        flex-direction: column;

        label {
            font-size: 0.72rem;
            color: $text-muted;
            font-weight: 600;
            margin-bottom: 3px;
            text-transform: uppercase;
        }

        input, select, textarea {
            background: #FFF;
            border: 1px solid $input-border;
            color: $text-main;
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 0.85rem;

            &:focus {
                outline: none;
                border-color: $primary-wood;
                box-shadow: 0 0 0 2px rgba(139, 90, 43, 0.1);
            }
        }
    }

    .sub-item-field-wide {
        grid-column: 1 / -1;
    }
}

.btn-add-sub-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 10px;
    border-radius: 8px;
    border: 1px dashed $primary-wood;
    background: transparent;
    color: $primary-wood;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
    margin-top: 0.5rem;

    &:hover { background: rgba(139, 90, 43, 0.06); }
}

/* --- PACKING ROWS TABLE (reutilizado del viejo portal) --- */
.product-section {
    background: $bg-card;
    border: 1px solid $border-color;
    border-radius: 10px;
    margin-bottom: 1.5rem;
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
    min-width: 900px;

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
        
        .text-accent { 
            color: $primary-wood; 
            font-weight: 800; 
            font-size: 1.1rem; 
        }
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
}

/* --- SAVE FEEDBACK (toast inline) --- */
.save-feedback {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.3s;

    &.visible { opacity: 1; }
    &.success { background: #D1FAE5; color: #065F46; }
    &.error { background: #FEE2E2; color: #991B1B; }
}

/* --- SHIPMENT LOGISTICS GRID (dentro de tab Datos) --- */
.shipment-form-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;

    @include tablet { grid-template-columns: repeat(2, 1fr); }
    @include mobile { grid-template-columns: 1fr; }

    .sf-field {
        display: flex;
        flex-direction: column;

        label {
            font-size: 0.75rem;
            color: $text-muted;
            font-weight: 600;
            margin-bottom: 4px;
            text-transform: uppercase;
        }

        input, select, textarea {
            background: #FFF;
            border: 1px solid $input-border;
            color: $text-main;
            border-radius: 5px;
            padding: 7px 10px;
            font-size: 0.87rem;

            &:focus {
                outline: none;
                border-color: $primary-wood;
                box-shadow: 0 0 0 2px rgba(139, 90, 43, 0.1);
            }
            &::placeholder { color: #BBB; }
        }

        &.sf-wide { grid-column: 1 / -1; }
    }
}

/* --- NOTIFICATION TOAST --- */
.portal-toast {
    position: fixed;
    top: 70px;
    right: 20px;
    z-index: 2000;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    transform: translateX(120%);
    transition: transform 0.3s ease;

    &.show { transform: translateX(0); }
    &.toast-success { background: #065F46; color: #FFF; }
    &.toast-error { background: #991B1B; color: #FFF; }
    &.toast-info { background: $accent-blue; color: #FFF; }
}

/* --- LOADING OVERLAY --- */
.loading-overlay {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: 10px;

    .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid #E5E7EB;
        border-top-color: $primary-wood;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* File upload indicator */
.file-upload-zone {
    border: 2px dashed $border-color;
    border-radius: 8px;
    padding: 1rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: #FAFAFA;
    
    &:hover, &.dragover {
        border-color: $primary-wood;
        background: rgba(139, 90, 43, 0.04);
    }

    .file-list {
        margin-top: 8px;
        font-size: 0.8rem;
        color: $text-muted;
    }
}

/* --- PACKING ROW SUMMARY inside Packing tab --- */
.packing-rows-summary {
    margin-top: 1rem;
    padding: 0.8rem;
    background: #F8F6F3;
    border-radius: 8px;
    border: 1px solid $secondary-wood;
    
    .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
        font-size: 0.85rem;
        
        .summary-label { color: $text-muted; font-weight: 600; }
        .summary-value { color: $primary-wood; font-weight: 700; }
    }
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
                    
                    <!-- ============================================ -->
                    <!--  SECCION 1: DATOS GLOBALES DE LA PROFORMA    -->
                    <!-- ============================================ -->
                    <div class="shipment-card" id="proforma-globals-card">
                        <div class="card-header">
                            <i class="fa fa-file-invoice fa-lg"></i>
                            <h3 data-i18n="sec_proforma_globals">Datos Globales de la Proforma</h3>
                            <span class="badge-status ms-auto" id="proforma-status-badge"></span>
                        </div>
                        <div class="card-body" id="proforma-globals-form">
                            
                            <div class="modern-form-grid">
                                <div class="form-group">
                                    <label><i class="fa fa-hashtag me-1"></i> <span data-i18n="lbl_proforma">No. Proforma (PI)</span></label>
                                    <input type="text" id="g-proforma-number" class="form-control" data-i18n-placeholder="ph_proforma" placeholder="Ej. PI-9920"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-file-text-o me-1"></i> <span data-i18n="lbl_invoice_global">Factura Global</span></label>
                                    <input type="text" id="g-invoice-global" class="form-control" placeholder="Ej. INV-GLOBAL-001"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-credit-card me-1"></i> <span data-i18n="lbl_payment">Condiciones de Pago</span></label>
                                    <input type="text" id="g-payment-terms" class="form-control" data-i18n-placeholder="ph_payment" placeholder="Ej. T/T 30%"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-flag me-1"></i> <span data-i18n="lbl_country">País Origen</span></label>
                                    <input type="text" id="g-country-origin" class="form-control" data-i18n-placeholder="ph_country" placeholder="Ej. China"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-anchor me-1"></i> <span data-i18n="lbl_port_origin">Puerto Origen</span></label>
                                    <input type="text" id="g-port-origin" class="form-control" data-i18n-placeholder="ph_origin" placeholder="Ej. Shanghai"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-map-marker me-1"></i> <span data-i18n="lbl_port_dest">Puerto Destino</span></label>
                                    <input type="text" id="g-port-destination" class="form-control" data-i18n-placeholder="ph_dest" placeholder="Ej. Manzanillo"/>
                                </div>
                                <div class="form-group">
                                    <label><i class="fa fa-balance-scale me-1"></i> <span data-i18n="lbl_incoterm">Incoterm</span></label>
                                    <input type="text" id="g-incoterm" class="form-control" data-i18n-placeholder="ph_incoterm" placeholder="Ej. CIF"/>
                                </div>
                                <div class="form-group full-width">
                                    <label><i class="fa fa-comment-o me-1"></i> <span data-i18n="lbl_general_notes">Observaciones Generales</span></label>
                                    <textarea id="g-general-notes" class="form-control" rows="2" placeholder="Notas generales sobre esta operación..."></textarea>
                                </div>
                            </div>

                            <div class="text-end mt-3">
                                <button id="btn-save-globals" type="button" class="btn-save-section">
                                    <i class="fa fa-save me-2"></i> <span data-i18n="btn_save_globals">Guardar Datos Globales</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- ============================================ -->
                    <!--  SECCION 2: LISTA DE EMBARQUES               -->
                    <!-- ============================================ -->
                    <div class="shipments-section" id="shipments-section">
                        <div class="section-header-bar">
                            <div class="section-title">
                                <i class="fa fa-ship me-2"></i>
                                <h3 data-i18n="sec_shipments">Embarques</h3>
                                <span class="shipment-count-badge" id="shipment-count-badge">0</span>
                            </div>
                            <button id="btn-add-shipment" type="button" class="btn-add-shipment">
                                <i class="fa fa-plus-circle me-2"></i> <span data-i18n="btn_add_shipment">Agregar Embarque</span>
                            </button>
                        </div>

                        <!-- Contenedor dinámico de embarques (JS lo llena) -->
                        <div id="shipments-container">
                            <div class="empty-state" id="no-shipments-msg">
                                <i class="fa fa-inbox fa-3x"></i>
                                <p data-i18n="msg_no_shipments">No hay embarques registrados. Presione "Agregar Embarque" para comenzar.</p>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- FOOTER -->
                <div class="submit-footer">
                    <div class="summary">
                        <div><span data-i18n="footer_total_shipments">Embarques:</span> <span id="total-shipments" class="text-accent fw-bold">0</span></div>
                        <div><span data-i18n="footer_total_containers">Contenedores:</span> <span id="total-containers" class="text-accent fw-bold">0</span></div>
                        <div><span data-i18n="footer_total_invoices">Invoices:</span> <span id="total-invoices" class="text-accent fw-bold">0</span></div>
                    </div>
                    
                    <div class="d-flex gap-2">
                        <button id="btn-complete-proforma" type="button" class="btn-primary-custom" disabled="disabled">
                            <i class="fa fa-check-circle me-2"></i> <span data-i18n="btn_complete">Marcar como Completa</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- ============================================ -->
            <!--  CARGA DIRECTA DEL SCRIPT (DEBUG FALLBACK)   -->
            <!--  Si el bundle de assets_frontend no lo carga -->
            <!--  este tag lo fuerza. Quitar en producción.   -->
            <!-- ============================================ -->
            <script>
                // Diagnóstico inmediato: si este log aparece, el template SÍ se renderiza
                console.log("[Portal][INLINE] Template rendered OK. Checking if main script loaded...");
                
                // Esperar un momento y verificar si el script principal se cargó
                setTimeout(function() {
                    if (window.supplierPortal) {
                        console.log("[Portal][INLINE] ✓ Main script loaded via asset bundle. supplierPortal instance exists.");
                    } else {
                        console.error("[Portal][INLINE] ✗ Main script NOT loaded via asset bundle! Loading directly...");
                        // Cargar el script directamente como fallback
                        var s = document.createElement('script');
                        s.src = '/stock_lot_packing_import/static/src/js/supplier_portal.js?v=' + Date.now();
                        s.onload = function() { console.log("[Portal][INLINE] ✓ Script loaded via direct injection."); };
                        s.onerror = function() { console.error("[Portal][INLINE] ✗ Script FAILED to load even via direct injection!"); };
                        document.body.appendChild(s);
                    }
                }, 1500);
            </script>

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
from odoo import models, fields, _
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
        if col is None or row is None:
            return

        key = (int(col), int(row))
        if content in (None, False, ""):
            if key in self._cells:
                del self._cells[key]
        else:
            self._cells[key] = str(content)

    def ingest_cells(self, raw_cells):
        if not raw_cells:
            return

        for key, cell_data in raw_cells.items():
            col, row = self._parse_cell_key(key)
            if col is None or row is None:
                continue

            content = self._extract_content(cell_data)
            if content not in (None, False, ""):
                self.put(col, row, content, source="snapshot")

    def _parse_cell_key(self, key):
        if isinstance(key, str) and key and key[0].isalpha():
            match = re.match(r"^([A-Z]+)(\d+)$", key.upper())
            if match:
                col_str, row_str = match.groups()
                col = 0
                for char in col_str:
                    col = col * 26 + (ord(char) - ord("A") + 1)
                return col - 1, int(row_str) - 1

        if isinstance(key, str) and "," in key:
            parts = key.split(",")
            if len(parts) == 2:
                try:
                    return int(parts[0]), int(parts[1])
                except Exception:
                    return None, None

        return None, None

    def _extract_content(self, cell_data):
        if isinstance(cell_data, dict):
            return (
                cell_data.get("content")
                or cell_data.get("value")
                or cell_data.get("text")
                or ""
            )
        return cell_data or ""

    def apply_revision_commands(self, commands, target_sheet_id):
        applied = 0

        for cmd in commands:
            if isinstance(cmd, list):
                applied += self.apply_revision_commands(cmd, target_sheet_id)
                continue

            if not isinstance(cmd, dict):
                continue

            if cmd.get("sheetId") and cmd.get("sheetId") != target_sheet_id:
                continue

            cmd_type = cmd.get("type")

            if cmd_type == "UPDATE_CELL":
                col, row = cmd.get("col"), cmd.get("row")
                if col is not None and row is not None:
                    content = self._extract_content(cmd)
                    self.put(col, row, content, source="UPDATE_CELL_REV")
                    applied += 1

            elif cmd_type == "REMOVE_COLUMNS_ROWS":
                if cmd.get("dimension") == "row":
                    elements = sorted(cmd.get("elements", []), reverse=True)
                    for row_idx in elements:
                        self._shift_rows_up(row_idx)
                    applied += 1

            elif cmd_type in ("DELETE_CONTENT", "CLEAR_CELL"):
                zones = cmd.get("zones") or cmd.get("target") or []
                if isinstance(zones, dict):
                    zones = [zones]

                for zone in zones:
                    top = zone.get("top", 0)
                    bottom = zone.get("bottom", 0)
                    left = zone.get("left", 0)
                    right = zone.get("right", 0)

                    for r in range(top, bottom + 1):
                        for c in range(left, right + 1):
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
    _name = "packing.list.import.wizard"
    _description = "Importar Packing List"

    picking_id = fields.Many2one(
        "stock.picking", string="Recepción", required=True, readonly=True
    )
    spreadsheet_id = fields.Many2one(
        "documents.document",
        related="picking_id.spreadsheet_id",
        readonly=True,
    )
    excel_file = fields.Binary(string="Archivo Excel", required=False, attachment=False)
    excel_filename = fields.Char(string="Nombre del archivo")

    def action_import_excel(self):
        self.ensure_one()
        _logger.info("=== [PL_IMPORT] INICIO PROCESO DE CARGA ===")

        rows = []
        if self.excel_file:
            _logger.info("[PL_IMPORT] Fuente seleccionada: archivo Excel")
            rows = self._get_data_from_excel_file()
        elif self.spreadsheet_id:
            _logger.info("[PL_IMPORT] Fuente seleccionada: spreadsheet")
            rows = self._get_data_from_spreadsheet()
        else:
            _logger.warning("[PL_IMPORT] No se recibió excel_file ni spreadsheet_id")

        _logger.info("[PL_IMPORT] Resultado Final: %s filas listas para importar.", len(rows))

        if not rows:
            raise UserError(
                _(
                    "No se encontraron datos válidos para importar. "
                    "Revise que la hoja contenga un producto reconocible y filas con cantidades/dimensiones mayores a cero."
                )
            )

        # --- LÓGICA DE LIMPIEZA PROFUNDA ---
        _logger.info("[PL_CLEANUP] Borrando datos previos...")
        old_move_lines = self.picking_id.move_line_ids
        old_lots = old_move_lines.mapped("lot_id")

        if old_move_lines:
            old_move_lines.write({"qty_done": 0})
            self.env.flush_all()

        if old_lots:
            quants = self.env["stock.quant"].sudo().search([("lot_id", "in", old_lots.ids)])
            if quants:
                quants.sudo().unlink()

        if old_move_lines:
            old_move_lines.unlink()

        for lot in old_lots:
            if self.env["stock.move.line"].search_count([("lot_id", "=", lot.id)]) == 0:
                try:
                    with self.env.cr.savepoint():
                        lot.unlink()
                except Exception as e:
                    _logger.warning("[PL_CLEANUP] No se pudo borrar lote %s: %s", lot.name, e)

        # --- CREACIÓN DE NUEVOS REGISTROS ---
        move_lines_created = 0
        skipped_without_move = 0
        skipped_qty_zero = 0
        next_prefix = self._get_next_global_prefix()
        containers = {}

        for data in rows:
            product = data["product"]
            move = self.picking_id.move_ids.filtered(lambda m: m.product_id == product)[:1]

            if not move:
                skipped_without_move += 1
                _logger.warning(
                    "[PL_IMPORT] No existe stock.move para producto '%s' en picking %s. Fila omitida.",
                    product.display_name,
                    self.picking_id.name,
                )
                continue

            unit_type = data.get("tipo", "Placa")

            qty_done = 0.0
            final_alto = 0.0
            final_ancho = 0.0

            if unit_type == "Placa":
                final_alto = data.get("alto", 0.0)
                final_ancho = data.get("ancho", 0.0)
                qty_done = round(final_alto * final_ancho, 3)
            else:
                qty_done = data.get("quantity", 0.0)
                final_alto = 0.0
                final_ancho = 0.0

            if qty_done <= 0:
                skipped_qty_zero += 1
                _logger.info(
                    "[PL_IMPORT] Fila omitida por qty_done<=0 | product=%s | tipo=%s | alto=%s | ancho=%s | quantity=%s",
                    product.display_name,
                    unit_type,
                    data.get("alto"),
                    data.get("ancho"),
                    data.get("quantity"),
                )
                continue

            cont = (data.get("contenedor") or "SN").strip() or "SN"

            if cont not in containers:
                containers[cont] = {
                    "pre": str(next_prefix),
                    "num": self._get_next_lot_number_for_prefix(str(next_prefix)),
                }
                next_prefix += 1

            l_name = f"{containers[cont]['pre']}-{containers[cont]['num']:02d}"

            grupo_ids = []
            if data.get("grupo_name"):
                grupo_name = data["grupo_name"].strip()
                grupo = self.env["stock.lot.group"].search([("name", "=", grupo_name)], limit=1)
                if not grupo:
                    grupo = self.env["stock.lot.group"].create({"name": grupo_name})
                grupo_ids = [grupo.id]

            lot_selection_value = str(unit_type).lower()

            lot = self.env["stock.lot"].create({
                "name": l_name,
                "product_id": product.id,
                "company_id": self.picking_id.company_id.id,
                "x_grosor": data.get("grosor"),
                "x_alto": final_alto,
                "x_ancho": final_ancho,
                "x_color": data.get("color"),
                "x_bloque": data.get("bloque"),
                "x_numero_placa": data.get("numero_placa"),
                "x_atado": data.get("atado"),
                "x_tipo": lot_selection_value,
                "x_grupo": [(6, 0, grupo_ids)],
                "x_pedimento": data.get("pedimento"),
                "x_contenedor": cont,
                "x_referencia_proveedor": data.get("ref_proveedor"),
            })

            self.env["stock.move.line"].create({
                "move_id": move.id,
                "product_id": product.id,
                "lot_id": lot.id,
                "qty_done": qty_done,
                "location_id": self.picking_id.location_id.id,
                "location_dest_id": self.picking_id.location_dest_id.id,
                "picking_id": self.picking_id.id,
                "x_grosor_temp": data.get("grosor"),
                "x_alto_temp": final_alto,
                "x_ancho_temp": final_ancho,
                "x_color_temp": data.get("color"),
                "x_tipo_temp": lot_selection_value,
                "x_bloque_temp": data.get("bloque"),
                "x_atado_temp": data.get("atado"),
                "x_pedimento_temp": data.get("pedimento"),
                "x_contenedor_temp": cont,
                "x_referencia_proveedor_temp": data.get("ref_proveedor"),
                "x_grupo_temp": [(6, 0, grupo_ids)],
            })

            containers[cont]["num"] += 1
            move_lines_created += 1

        # --- SINCRONIZACIÓN WORKSHEET ---
        if self.picking_id.ws_spreadsheet_id:
            try:
                self.picking_id.ws_spreadsheet_id.sudo().unlink()
                self.picking_id.write({"worksheet_imported": False})
                _logger.info("[PL_IMPORT] Worksheet antiguo eliminado para forzar sincronización.")
            except Exception as e:
                _logger.warning("[PL_IMPORT] No se pudo eliminar el Worksheet anterior: %s", e)

        self.picking_id.write({"packing_list_imported": True})

        # ── SINCRONIZAR CANTIDADES EN LÍNEAS DE LA OC ─────────────────────────
        self._sync_quantities_to_po_lines()
        # ──────────────────────────────────────────────────────────────────────

        _logger.info(
            "=== [PL_IMPORT] PROCESO TERMINADO. Creados %s registros | sin move: %s | qty=0: %s ===",
            move_lines_created,
            skipped_without_move,
            skipped_qty_zero,
        )

        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": "PL Procesado",
                "message": (
                    f"Se han importado/corregido {move_lines_created} lotes. "
                    f"Omitidos sin movimiento: {skipped_without_move}. "
                    f"Omitidos por cantidad 0: {skipped_qty_zero}. "
                    "El Worksheet ha sido reiniciado."
                ),
                "type": "success",
                "next": {"type": "ir.actions.act_window_close"},
            },
        }

    def _sync_quantities_to_po_lines(self):
        picking = self.picking_id
        po = self.env["purchase.order"].search([("picking_ids", "in", picking.id)], limit=1)

        if not po:
            _logger.warning("[PL_SYNC] No se encontró PO asociada al picking.")
            return

        for po_line in po.order_line:
            product = po_line.product_id
            move_lines = picking.move_line_ids.filtered(lambda ml: ml.product_id == product)
            total_embarcado = sum(move_lines.mapped("qty_done"))

            if total_embarcado <= 0:
                continue

            vals = {"x_qty_embarcada": total_embarcado}
            if not po_line.x_qty_solicitada_original:
                vals["x_qty_solicitada_original"] = po_line.product_qty
            vals["product_qty"] = total_embarcado
            po_line.write(vals)

        _logger.info("[PL_SYNC] Cantidades sincronizadas a la OC %s.", po.name)

    def _get_data_from_spreadsheet(self):
        doc = self.spreadsheet_id
        if not doc:
            _logger.warning("[PL_DEBUG] No hay spreadsheet_id relacionado al picking")
            return []

        _logger.info(
            "[PL_DEBUG] Doc ID: %s | snapshot: %s | data: %s",
            doc.id,
            bool(doc.spreadsheet_snapshot),
            bool(doc.spreadsheet_data),
        )

        spreadsheet_json = self._get_current_spreadsheet_state(doc)
        if not spreadsheet_json or not spreadsheet_json.get("sheets"):
            _logger.warning("[PL_DEBUG] spreadsheet_json vacío o sin sheets")
            return []

        _logger.info(
            "[PL_DEBUG] Sheets encontrados: %s",
            [s.get("name") for s in spreadsheet_json.get("sheets", [])],
        )

        all_rows = []
        products_not_found = []

        for sheet in spreadsheet_json["sheets"]:
            idx = _PLCellsIndex()
            idx.ingest_cells(sheet.get("cells", {}))
            _logger.info(
                "[PL_DEBUG] Sheet '%s': %s celdas tras ingest",
                sheet.get("name"),
                len(idx._cells),
            )

            product = self._identify_product_from_sheet(idx)
            _logger.info(
                "[PL_DEBUG] Producto identificado en hoja '%s': %s",
                sheet.get("name"),
                product.name if product else "NINGUNO",
            )

            if not product:
                products_not_found.append(sheet.get("name"))
                continue

            sheet_rows = self._extract_rows_from_index(idx, product)
            _logger.info(
                "[PL_DEBUG] Filas extraídas para '%s': %s",
                product.name,
                len(sheet_rows),
            )
            all_rows.extend(sheet_rows)

        if products_not_found:
            _logger.warning(
                "[PL_DEBUG] Hojas sin producto identificado: %s",
                products_not_found,
            )

        return all_rows

    def _get_current_spreadsheet_state(self, doc):
        snapshot_len = len(doc.spreadsheet_snapshot) if doc.spreadsheet_snapshot else 0
        data_len = len(doc.spreadsheet_data) if doc.spreadsheet_data else 0

        _logger.info(
            "[PL_DEBUG] snapshot existe: %s | len: %s",
            bool(doc.spreadsheet_snapshot),
            snapshot_len,
        )
        _logger.info(
            "[PL_DEBUG] spreadsheet_data existe: %s | len: %s",
            bool(doc.spreadsheet_data),
            data_len,
        )

        if doc.spreadsheet_snapshot:
            try:
                parsed = self._safe_json_load(doc.spreadsheet_snapshot)
                if parsed:
                    sheets_count = len(parsed.get("sheets", []))
                    _logger.info(
                        "[PL_DEBUG] snapshot parseado OK | sheets: %s | revisionId: %s",
                        sheets_count,
                        parsed.get("revisionId", "N/A"),
                    )
                    if parsed.get("sheets"):
                        return self._apply_pending_revisions(doc, parsed)
            except Exception as e:
                _logger.warning("[PL_IMPORT] Error leyendo snapshot: %s", e)

        try:
            if hasattr(doc, "_get_spreadsheet_serialized_snapshot"):
                snapshot_data = doc._get_spreadsheet_serialized_snapshot()
                _logger.info(
                    "[PL_DEBUG] _get_spreadsheet_serialized_snapshot: %s",
                    bool(snapshot_data),
                )
                if snapshot_data:
                    parsed = self._safe_json_load(snapshot_data)
                    if parsed and parsed.get("sheets"):
                        return self._apply_pending_revisions(doc, parsed)
        except Exception as e:
            _logger.warning("[PL_IMPORT] Error en _get_spreadsheet_serialized_snapshot: %s", e)

        _logger.info("[PL_IMPORT] Fallback: spreadsheet_data + todas las revisiones")
        return self._load_spreadsheet_with_all_revisions(doc)

    def _apply_pending_revisions(self, doc, spreadsheet_json):
        snapshot_revision_id = spreadsheet_json.get("revisionId", "")
        _logger.info(
            "[PL_DEBUG] _apply_pending_revisions | revisionId snapshot: '%s'",
            snapshot_revision_id,
        )

        if not snapshot_revision_id:
            _logger.info("[PL_DEBUG] Sin revisionId en snapshot, retornando json tal cual")
            return spreadsheet_json

        revisions = self.env["spreadsheet.revision"].sudo().with_context(active_test=False).search([
            ("res_model", "=", "documents.document"),
            ("res_id", "=", doc.id),
        ], order="id asc")
        _logger.info("[PL_DEBUG] Revisiones totales en BD: %s", len(revisions))

        start_applying = False
        all_cmds = []

        for rev in revisions:
            rev_data = self._safe_json_load(rev.commands)
            if not rev_data:
                continue

            if not start_applying:
                rev_id = rev_data.get("id") if isinstance(rev_data, dict) else None
                if rev_id == snapshot_revision_id:
                    start_applying = True
                continue

            if isinstance(rev_data, dict) and rev_data.get("type") == "SNAPSHOT_CREATED":
                continue

            if isinstance(rev_data, dict) and "commands" in rev_data:
                all_cmds.extend(rev_data["commands"])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)

        _logger.info(
            "[PL_DEBUG] Comandos pendientes a aplicar tras snapshot: %s",
            len(all_cmds),
        )

        if not all_cmds:
            _logger.info("[PL_DEBUG] Sin comandos pendientes, retornando snapshot directo")
            return spreadsheet_json

        for sheet in spreadsheet_json.get("sheets", []):
            sheet_id = sheet.get("id")
            idx = _PLCellsIndex()
            cells_before = len(sheet.get("cells", {}))
            idx.ingest_cells(sheet.get("cells", {}))
            applied = idx.apply_revision_commands(all_cmds, sheet_id)

            _logger.info(
                "[PL_DEBUG] Sheet '%s' | celdas antes: %s | cmds aplicados: %s | celdas después: %s",
                sheet.get("name"),
                cells_before,
                applied,
                len(idx._cells),
            )

            sheet["cells"] = {
                f"{self._col_to_letter(c)}{r + 1}": {"content": v}
                for (c, r), v in idx._cells.items()
            }

        return spreadsheet_json

    def _load_spreadsheet_with_all_revisions(self, doc):
        spreadsheet_json = self._load_spreadsheet_json(doc)
        _logger.info(
            "[PL_DEBUG] _load_spreadsheet_json: %s | sheets: %s",
            bool(spreadsheet_json),
            len(spreadsheet_json.get("sheets", [])) if spreadsheet_json else 0,
        )

        if not spreadsheet_json:
            return None

        revisions = self.env["spreadsheet.revision"].sudo().with_context(active_test=False).search([
            ("res_model", "=", "documents.document"),
            ("res_id", "=", doc.id),
        ], order="id asc")
        _logger.info("[PL_DEBUG] Revisiones en fallback: %s", len(revisions))

        all_cmds = []
        for rev in revisions:
            rev_data = self._safe_json_load(rev.commands)
            if not rev_data:
                continue

            if isinstance(rev_data, dict) and rev_data.get("type") == "SNAPSHOT_CREATED":
                continue

            if isinstance(rev_data, dict) and "commands" in rev_data:
                all_cmds.extend(rev_data["commands"])
            elif isinstance(rev_data, list):
                all_cmds.extend(rev_data)

        _logger.info("[PL_DEBUG] Comandos totales en fallback: %s", len(all_cmds))

        for sheet in spreadsheet_json.get("sheets", []):
            idx = _PLCellsIndex()
            cells_before = len(sheet.get("cells", {}))
            idx.ingest_cells(sheet.get("cells", {}))
            applied = idx.apply_revision_commands(all_cmds, sheet.get("id"))

            _logger.info(
                "[PL_DEBUG] Fallback sheet '%s' | celdas antes: %s | cmds: %s | celdas después: %s",
                sheet.get("name"),
                cells_before,
                applied,
                len(idx._cells),
            )

            sample = list(idx._cells.items())[:10]
            _logger.info("[PL_DEBUG] Muestra celdas: %s", sample)

            sheet["cells"] = {
                f"{self._col_to_letter(c)}{r + 1}": {"content": v}
                for (c, r), v in idx._cells.items()
            }

        return spreadsheet_json

    def _safe_json_load(self, payload):
        if not payload:
            return None

        try:
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8")
            if isinstance(payload, str):
                payload = payload.strip()
                if not payload:
                    return None
                return json.loads(payload)
            if isinstance(payload, dict):
                return payload
            if isinstance(payload, list):
                return payload
        except Exception as e:
            _logger.warning("[PL_DEBUG] No se pudo parsear JSON: %s", e)

        return None

    def _col_to_letter(self, col):
        result = ""
        col += 1
        while col:
            col, remainder = divmod(col - 1, 26)
            result = chr(65 + remainder) + result
        return result

    def _normalize_product_text(self, text):
        if not text:
            return ""

        text = str(text).strip()
        text = re.sub(r"\(\s*\)", "", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _extract_short_product_name(self, text):
        if not text:
            return ""

        short_name = str(text).split("(")[0].strip()
        short_name = re.sub(r"\s+", " ", short_name)
        return short_name.strip()

    def _find_product_by_header(self, raw_product_value):
        Product = self.env["product.product"]

        raw_name = str(raw_product_value or "").strip()
        clean_name = self._normalize_product_text(raw_name)
        short_name = self._extract_short_product_name(clean_name)

        _logger.info(
            "[PL_DEBUG] Buscando producto | raw='%s' | clean='%s' | short='%s'",
            raw_name,
            clean_name,
            short_name,
        )

        search_attempts = []

        if clean_name:
            search_attempts.extend([
                ("name", "=", clean_name, "name exacto clean"),
                ("default_code", "=", clean_name, "default_code exacto clean"),
                ("name", "ilike", clean_name, "name ilike clean"),
                ("default_code", "ilike", clean_name, "default_code ilike clean"),
            ])

        if short_name and short_name != clean_name:
            search_attempts.extend([
                ("name", "=", short_name, "name exacto short"),
                ("default_code", "=", short_name, "default_code exacto short"),
                ("name", "ilike", short_name, "name ilike short"),
                ("default_code", "ilike", short_name, "default_code ilike short"),
            ])

        for field_name, operator, value, label in search_attempts:
            product = Product.search([(field_name, operator, value)], limit=1)
            if product:
                _logger.info(
                    "[PL_DEBUG] Producto encontrado por %s: %s",
                    label,
                    product.display_name,
                )
                return product

        _logger.warning(
            "[PL_DEBUG] No se encontró producto para raw='%s' | clean='%s' | short='%s'",
            raw_name,
            clean_name,
            short_name,
        )
        return None

    def _identify_product_from_sheet(self, idx):
        p_info = None

        for r in range(3):
            label = str(idx.value(0, r) or "").upper().strip()
            val_b = idx.value(1, r)
            _logger.info("[PL_DEBUG] identify fila %s: A='%s' B='%s'", r, label, val_b)
            if "PRODUCTO:" in label:
                p_info = val_b
                break

        if not p_info:
            p_info = idx.value(1, 0)

        if not p_info:
            _logger.warning("[PL_DEBUG] No se encontró info de producto en la hoja")
            return None

        return self._find_product_by_header(p_info)

    def _extract_rows_from_index(self, idx, product):
        rows = []
        unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"
        _logger.info(
            "[PL_DEBUG] Extrayendo filas para '%s' | unit_type: %s",
            product.name,
            unit_type,
        )

        if unit_type == "Placa":
            idx_notas = 4
            idx_bloque = 5
            idx_placa = 6
            idx_atado = 7
            idx_grupo = 8
            idx_pedimento = 9
            idx_contenedor = 10
            idx_ref = 11
        else:
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
            raw_a = idx.value(0, r)
            raw_b = idx.value(1, r)
            raw_c = idx.value(2, r)

            val_b = self._to_float(raw_b)
            val_c = self._to_float(raw_c)

            es_valido = False
            if unit_type == "Placa":
                if val_b > 0 and val_c > 0:
                    es_valido = True
            else:
                if val_b > 0:
                    es_valido = True

            if es_valido:
                filas_validas += 1
                rows.append({
                    "product": product,
                    "grosor": str(raw_a or "").strip(),
                    "alto": val_b if unit_type == "Placa" else 0.0,
                    "ancho": val_c if unit_type == "Placa" else 0.0,
                    "quantity": val_b if unit_type != "Placa" else 0.0,
                    "color": str(idx.value(idx_notas, r) or "").strip(),
                    "bloque": str(idx.value(idx_bloque, r) or "").strip(),
                    "numero_placa": str(idx.value(idx_placa, r) or "").strip(),
                    "atado": str(idx.value(idx_atado, r) or "").strip(),
                    "tipo": unit_type,
                    "grupo_name": str(idx.value(idx_grupo, r) or "").strip(),
                    "pedimento": str(idx.value(idx_pedimento, r) or "").strip(),
                    "contenedor": str(idx.value(idx_contenedor, r) or "SN").strip(),
                    "ref_proveedor": str(idx.value(idx_ref, r) or "").strip(),
                })
            else:
                if filas_invalidas < 5 and (raw_a or raw_b or raw_c):
                    _logger.info(
                        "[PL_DEBUG] Fila %s inválida | A='%s' B='%s' C='%s'",
                        r + 1,
                        raw_a,
                        raw_b,
                        raw_c,
                    )
                    filas_invalidas += 1

        _logger.info(
            "[PL_DEBUG] Total filas válidas: %s | inválidas con contenido: %s",
            filas_validas,
            filas_invalidas,
        )
        return rows

    def _to_float(self, val):
        if val in (None, False, ""):
            return 0.0

        try:
            txt = str(val).strip()
            txt = txt.replace(" ", "")
            txt = txt.replace(",", ".")
            return float(txt)
        except Exception:
            return 0.0

    def _get_next_global_prefix(self):
        self.env.cr.execute(
            """
            SELECT CAST(SUBSTRING(name FROM '^([0-9]+)-') AS INTEGER) as prefix_num
            FROM stock_lot
            WHERE name ~ '^[0-9]+-[0-9]+$'
              AND company_id = %s
            ORDER BY prefix_num DESC
            LIMIT 1
            """,
            (self.picking_id.company_id.id,),
        )
        res = self.env.cr.fetchone()
        return (res[0] + 1) if res and res[0] else 1

    def _get_next_lot_number_for_prefix(self, prefix):
        self.env.cr.execute(
            """
            SELECT name
            FROM stock_lot
            WHERE name LIKE %s
              AND company_id = %s
            ORDER BY CAST(SUBSTRING(name FROM '-([0-9]+)$') AS INTEGER) DESC
            LIMIT 1
            """,
            (f"{prefix}-%", self.picking_id.company_id.id),
        )
        res = self.env.cr.fetchone()
        return int(res[0].split("-")[1]) + 1 if res else 1

    def _load_spreadsheet_json(self, doc):
        if not doc.spreadsheet_data:
            return None

        try:
            return self._safe_json_load(doc.spreadsheet_data)
        except Exception as e:
            _logger.warning("[PL_DEBUG] Error leyendo spreadsheet_data: %s", e)
            return None

    def _get_data_from_excel_file(self):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(base64.b64decode(self.excel_file)), data_only=True)
        rows = []

        for sheet in wb.worksheets:
            p_info = sheet["B1"].value
            if not p_info:
                _logger.warning("[PL_DEBUG][XLSX] Hoja '%s' sin encabezado de producto en B1", sheet.title)
                continue

            product = self._find_product_by_header(p_info)
            if not product:
                _logger.warning(
                    "[PL_DEBUG][XLSX] No se encontró producto para hoja '%s' con encabezado '%s'",
                    sheet.title,
                    p_info,
                )
                continue

            unit_type = product.product_tmpl_id.x_unidad_del_producto or "Placa"

            if unit_type == "Placa":
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
                raw_b = sheet.cell(r, 2).value
                raw_c = sheet.cell(r, 3).value

                val_b = self._to_float(raw_b)
                val_c = self._to_float(raw_c)

                es_valido = False
                if unit_type == "Placa":
                    if val_b > 0 and val_c > 0:
                        es_valido = True
                else:
                    if val_b > 0:
                        es_valido = True

                if es_valido:
                    rows.append({
                        "product": product,
                        "grosor": str(sheet.cell(r, 1).value or "").strip(),
                        "alto": val_b if unit_type == "Placa" else 0.0,
                        "ancho": val_c if unit_type == "Placa" else 0.0,
                        "quantity": val_b if unit_type != "Placa" else 0.0,
                        "color": str(sheet.cell(r, col_notas).value or "").strip(),
                        "bloque": str(sheet.cell(r, col_bloque).value or "").strip(),
                        "numero_placa": str(sheet.cell(r, col_placa).value or "").strip(),
                        "atado": str(sheet.cell(r, col_atado).value or "").strip(),
                        "tipo": unit_type,
                        "grupo_name": str(sheet.cell(r, col_grupo).value or "").strip(),
                        "pedimento": str(sheet.cell(r, col_pedimento).value or "").strip(),
                        "contenedor": str(sheet.cell(r, col_contenedor).value or "SN").strip(),
                        "ref_proveedor": str(sheet.cell(r, col_ref).value or "").strip(),
                    })

        _logger.info("[PL_DEBUG][XLSX] Total filas extraídas desde Excel: %s", len(rows))
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

