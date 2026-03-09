# -*- coding: utf-8 -*-
"""
Fase 2: Controller del Portal de Proveedor — Endpoints jerárquicos.
v3.3 — Incluye has_image en serialización + endpoints upload/delete row image
      + preservación de imágenes al re-guardar packing rows.
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
                    'has_image': bool(row.image),
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

        try:
            picking.sudo().write(vals)
        except Exception as e:
            _logger.warning(f"Error sincronizando flat al picking: {e}")

    def _sync_packing_rows_to_spreadsheet(self, header, picking):
        """Consolida TODAS las rows de TODOS los packings de la proforma
        y las escribe al spreadsheet del picking."""
        if not picking or not header:
            return

        all_rows = []
        for shipment in header.shipment_ids:
            for packing in shipment.packing_ids:
                for row in packing.row_ids.sorted('sequence'):
                    container_name = ''
                    if row.container_id and row.container_id.container_number:
                        container_name = row.container_id.container_number
                    elif shipment.container_ids:
                        container_name = shipment.container_ids[0].container_number or ''

                    all_rows.append({
                        'product_id': row.product_id.id,
                        'grosor': row.grosor or '',
                        'alto': row.alto or 0,
                        'ancho': row.ancho or 0,
                        'peso': row.peso or 0,
                        'quantity': row.quantity or 0,
                        'color': row.color or '',
                        'bloque': row.bloque or '',
                        'numero_placa': row.numero_placa or '',
                        'atado': row.atado or '',
                        'tipo': row.tipo or 'Placa',
                        'grupo_name': row.grupo_name or '',
                        'pedimento': row.pedimento or '',
                        'contenedor': container_name or 'SN',
                        'ref_proveedor': row.ref_proveedor or '',
                    })

        if not all_rows:
            _logger.info("[Portal] _sync_packing_rows_to_spreadsheet: No rows to sync")
            return

        header_data = {
            'proforma_number': header.proforma_number or '',
            'payment_terms': header.payment_terms or '',
            'country_origin': header.country_origin or '',
            'origin': header.port_origin or '',
            'destination': header.port_destination or '',
            'incoterm': header.incoterm or '',
            'invoice_number': header.invoice_global_number or '',
        }

        first_shipment = header.shipment_ids.sorted('sequence')[:1]
        if first_shipment:
            fs = first_shipment[0]
            header_data.update({
                'vessel': fs.vessel_name or '',
                'shipment_date': str(fs.etd) if fs.etd else '',
                'bl_number': fs.bl_number or '',
            })

        try:
            _logger.info(
                "[Portal] Syncing %d rows to spreadsheet for picking %s",
                len(all_rows), picking.name
            )
            picking.sudo().update_packing_list_from_portal(all_rows, header_data=header_data)
        except Exception as e:
            _logger.warning(f"[Portal] Error syncing to spreadsheet: {e}")

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

        proforma = self._get_or_create_proforma(access)
        proforma_data = self._serialize_proforma(proforma) if proforma else {}

        existing_rows = []
        if picking.spreadsheet_id and not proforma_data.get('shipments'):
            try:
                existing_rows = picking.sudo().get_packing_list_data_for_portal()
            except Exception as e:
                _logger.error(f"Error recuperando datos del spreadsheet: {e}")

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
        self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

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
            self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

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
    #  API v2: CRUD PACKING LISTS + ROWS (con preservación de imágenes)
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

        # Guardar rows — PRESERVAR imágenes existentes
        if rows is not None:
            # Construir mapa de imágenes existentes por (product, grosor, alto, ancho, qty)
            existing_images = {}
            for old_row in packing.row_ids:
                if old_row.image:
                    key = (
                        old_row.product_id.id,
                        (old_row.grosor or '').strip(),
                        round(old_row.alto or 0, 4),
                        round(old_row.ancho or 0, 4),
                        round(old_row.quantity or 0, 4),
                    )
                    existing_images[key] = {
                        'image': old_row.image,
                        'image_filename': old_row.image_filename,
                    }

            packing.row_ids.unlink()
            seq = 10
            for r in rows:
                row_vals = {
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
                }

                # Recuperar imagen existente por matching de dimensiones
                match_key = (
                    int(r.get('product_id', 0)),
                    (r.get('grosor', '') or '').strip(),
                    round(float(r.get('alto', 0)), 4),
                    round(float(r.get('ancho', 0)), 4),
                    round(float(r.get('quantity', 0)), 4),
                )
                if match_key in existing_images:
                    img_data = existing_images.pop(match_key)
                    row_vals['image'] = img_data['image']
                    row_vals['image_filename'] = img_data['image_filename']

                Row.create(row_vals)
                seq += 10

        proforma = shipment.proforma_id
        self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

        return {'success': True, 'packing_id': packing.id}

    @http.route('/supplier/api/v2/delete_packing', type='json', auth='public', csrf=False)
    def api_delete_packing(self, token, packing_id):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        packing = request.env['supplier.shipment.packing'].sudo().browse(packing_id)
        if packing.exists():
            proforma = packing.shipment_id.proforma_id
            packing.unlink()
            self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

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
            pass
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
            self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

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
    #  API v2: SUBIDA / ELIMINACIÓN DE IMAGEN POR FILA DE PACKING
    # =====================================================================

    @http.route('/supplier/api/v2/upload_row_image', type='json', auth='public', csrf=False)
    def api_upload_row_image(self, token, row_id, image_data, image_name=None):
        """Sube una imagen (base64) a una fila específica del packing list."""
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        Row = request.env['supplier.shipment.packing.row'].sudo()
        row = Row.browse(int(row_id))
        if not row.exists():
            return {'success': False, 'message': 'Fila no encontrada.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma or row.packing_id.shipment_id.proforma_id.id != proforma.id:
            return {'success': False, 'message': 'Fila no pertenece a esta proforma.'}

        vals = {'image': image_data}
        if image_name:
            vals['image_filename'] = image_name

        row.write(vals)
        return {'success': True, 'row_id': row.id}

    @http.route('/supplier/api/v2/delete_row_image', type='json', auth='public', csrf=False)
    def api_delete_row_image(self, token, row_id):
        """Elimina la imagen de una fila del packing list."""
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        Row = request.env['supplier.shipment.packing.row'].sudo()
        row = Row.browse(int(row_id))
        if not row.exists():
            return {'success': False, 'message': 'Fila no encontrada.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma or row.packing_id.shipment_id.proforma_id.id != proforma.id:
            return {'success': False, 'message': 'Fila no pertenece a esta proforma.'}

        row.write({'image': False, 'image_filename': False})
        return {'success': True}

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
            return {'success': False, 'message': str(e)}