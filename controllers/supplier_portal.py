# -*- coding: utf-8 -*-
# controllers/supplier_portal.py

import json

from odoo import http
from odoo.http import request
from markupsafe import Markup


class SupplierPortalController(http.Controller):

    # =====================================================================
    #  HELPERS GENERALES
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

    def _safe_int(self, value, default=0):
        try:
            if value in (None, False, ''):
                return default
            return int(value)
        except Exception:
            return default

    def _safe_float(self, value, default=0.0):
        try:
            if value in (None, False, ''):
                return default
            return float(value)
        except Exception:
            return default

    def _normalize_id_list(self, values):
        if not values:
            return []
        result = []
        for val in values:
            iv = self._safe_int(val, 0)
            if iv:
                result.append(iv)
        return list(dict.fromkeys(result))

    def _belongs_to_proforma(self, proforma, shipment=None, packing=None, row=None, invoice=None, container=None):
        """Valida pertenencia de cualquier registro a la proforma actual."""
        if not proforma:
            return False

        try:
            if shipment is not None:
                return bool(shipment.exists() and shipment.proforma_id.id == proforma.id)

            if packing is not None:
                return bool(
                    packing.exists()
                    and packing.shipment_id
                    and packing.shipment_id.proforma_id.id == proforma.id
                )

            if row is not None:
                return bool(
                    row.exists()
                    and row.packing_id
                    and row.packing_id.shipment_id
                    and row.packing_id.shipment_id.proforma_id.id == proforma.id
                )

            if invoice is not None:
                return bool(
                    invoice.exists()
                    and invoice.shipment_id
                    and invoice.shipment_id.proforma_id.id == proforma.id
                )

            if container is not None:
                return bool(
                    container.exists()
                    and container.shipment_id
                    and container.shipment_id.proforma_id.id == proforma.id
                )
        except Exception:
            return False

        return False

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

    # =====================================================================
    #  HELPERS DE VALIDACIÓN DE CONTENEDORES / PACKINGS
    # =====================================================================

    def _validate_container_ids_for_shipment(self, shipment, container_ids):
        """Valida que los container_ids pertenezcan al shipment."""
        normalized = self._normalize_id_list(container_ids)
        shipment_container_ids = set(shipment.container_ids.ids)
        invalid = [cid for cid in normalized if cid not in shipment_container_ids]
        if invalid:
            return False, "Uno o más contenedores no pertenecen al embarque actual."
        return True, normalized

    def _validate_packing_scope_and_containers(self, shipment, packing_vals, rows=None):
        """
        Reglas:
        - scope=full_shipment -> container_ids opcional
        - scope=specific_containers -> container_ids obligatorio
        - row.container_id, si viene, debe pertenecer al shipment
        - si scope=specific_containers, row.container_id debe estar dentro de packing.container_ids
        """
        scope = packing_vals.get('scope') or 'full_shipment'
        container_ids = self._normalize_id_list(packing_vals.get('container_ids', []))

        ok, result = self._validate_container_ids_for_shipment(shipment, container_ids)
        if not ok:
            return False, result, None

        valid_container_ids = result

        if scope == 'specific_containers' and not valid_container_ids:
            return False, "Si el packing aplica a contenedores específicos, debe seleccionar al menos un contenedor.", None

        if rows:
            shipment_container_ids = set(shipment.container_ids.ids)
            packing_container_ids = set(valid_container_ids)

            for idx, row in enumerate(rows, start=1):
                row_container_id = self._safe_int(row.get('container_id'), 0)
                if row_container_id:
                    if row_container_id not in shipment_container_ids:
                        return False, "La fila %s apunta a un contenedor que no pertenece al embarque." % idx, None
                    if scope == 'specific_containers' and row_container_id not in packing_container_ids:
                        return False, "La fila %s usa un contenedor fuera del alcance del packing." % idx, None

        return True, "", valid_container_ids

    def _compute_packing_derived_flags(self, packing):
        container_ids = packing.container_ids.ids
        row_container_ids = packing.row_ids.filtered(lambda r: r.container_id).mapped('container_id').ids
        row_container_ids = list(dict.fromkeys(row_container_ids))

        all_related_container_ids = list(dict.fromkeys(container_ids + row_container_ids))
        rows_without_container = packing.row_ids.filtered(lambda r: not r.container_id)
        is_single_container = len(all_related_container_ids) == 1
        is_multi_container = len(all_related_container_ids) > 1

        if is_single_container:
            suggested_mode = 'container_first'
        elif is_multi_container:
            suggested_mode = 'global_packing'
        else:
            suggested_mode = 'unassigned'

        return {
            'container_count_derived': len(all_related_container_ids),
            'row_container_ids': row_container_ids,
            'all_related_container_ids': all_related_container_ids,
            'has_rows_without_container': bool(rows_without_container),
            'rows_without_container_count': len(rows_without_container),
            'is_single_container': is_single_container,
            'is_multi_container': is_multi_container,
            'suggested_mode': suggested_mode,
        }

    # =====================================================================
    #  SERIALIZACIÓN
    # =====================================================================

    def _serialize_proforma(self, header):
        """Serializa la proforma y toda su jerarquía a JSON-safe dict."""
        shipments = []
        for s in header.shipment_ids.sorted('sequence'):
            containers = [{
                'id': c.id,
                'container_number': c.container_number or '',
                'seal_number': c.seal_number or '',
                'container_type': c.container_type or '',
                'weight': c.weight or 0.0,
                'volume': c.volume or 0.0,
                'packages': c.packages or 0,
                'notes': c.notes or '',
                'packing_ids': c.packing_ids.ids if hasattr(c, 'packing_ids') else [],
            } for c in s.container_ids]

            invoices = [{
                'id': inv.id,
                'invoice_number': inv.invoice_number or '',
                'invoice_date': str(inv.invoice_date) if inv.invoice_date else '',
                'amount': inv.amount or 0.0,
                'currency_id': inv.currency_id.id if inv.currency_id else False,
                'currency_name': inv.currency_id.name if inv.currency_id else '',
                'scope': inv.scope or 'full_shipment',
                'container_ids': inv.container_ids.ids,
                'is_multi_container': len(inv.container_ids.ids) > 1,
            } for inv in s.invoice_ids]

            packings = []
            for pl in s.packing_ids.sorted('sequence'):
                derived = self._compute_packing_derived_flags(pl)

                rows_payload = []
                for row in pl.row_ids.sorted('sequence'):
                    rows_payload.append({
                        'id': row.id,
                        'product_id': row.product_id.id,
                        'product_name': row.product_id.display_name,
                        'container_id': row.container_id.id if row.container_id else False,
                        'container_number': row.container_id.container_number if row.container_id else '',
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
                    })

                packings.append({
                    'id': pl.id,
                    'packing_number': pl.packing_number or '',
                    'packing_date': str(pl.packing_date) if pl.packing_date else '',
                    'scope': pl.scope or 'full_shipment',
                    'container_ids': pl.container_ids.ids,
                    'row_count': pl.row_count,
                    'rows': rows_payload,
                    'container_count_derived': derived['container_count_derived'],
                    'row_container_ids': derived['row_container_ids'],
                    'all_related_container_ids': derived['all_related_container_ids'],
                    'has_rows_without_container': derived['has_rows_without_container'],
                    'rows_without_container_count': derived['rows_without_container_count'],
                    'is_single_container': derived['is_single_container'],
                    'is_multi_container': derived['is_multi_container'],
                    'suggested_mode': derived['suggested_mode'],
                })

            shipment_container_ids = set(s.container_ids.ids)
            packing_related_container_ids = set()
            containers_without_packing = []

            for pl in s.packing_ids:
                d = self._compute_packing_derived_flags(pl)
                packing_related_container_ids.update(d['all_related_container_ids'])

            for c in s.container_ids:
                if c.id not in packing_related_container_ids:
                    containers_without_packing.append(c.id)

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
                'containers_without_packing': containers_without_packing,
                'has_multi_container_packings': any(p['is_multi_container'] for p in packings),
                'has_packings_without_container': any(p['has_rows_without_container'] for p in packings),
                'all_container_ids': list(shipment_container_ids),
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

    # =====================================================================
    #  SYNC PICKING / SPREADSHEET
    # =====================================================================

    def _sync_flat_to_picking(self, header, picking):
        """Popula los campos flat del picking con un resumen de la proforma (retrocompatibilidad)."""
        if not picking or not header:
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
            'supplier_container_type': ', '.join(sorted(set(all_types))) if all_types else '',
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
        except Exception:
            pass

    def _sync_packing_rows_to_spreadsheet(self, header, picking):
        """
        Consolida TODAS las rows de TODOS los packings de la proforma
        y las escribe al spreadsheet del picking.
        """
        if not picking or not header:
            return

        all_rows = []
        for shipment in header.shipment_ids:
            for packing in shipment.packing_ids:
                packing_container_ids = packing.container_ids.ids
                packing_container_numbers = packing.container_ids.mapped('container_number')

                for row in packing.row_ids.sorted('sequence'):
                    container_name = ''
                    if row.container_id and row.container_id.container_number:
                        container_name = row.container_id.container_number
                    elif packing.scope == 'specific_containers' and len(packing_container_numbers) == 1:
                        container_name = packing_container_numbers[0] or ''
                    elif packing.scope == 'specific_containers' and len(packing_container_numbers) > 1:
                        container_name = 'MULTI'
                    else:
                        container_name = 'SN'

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
                        'packing_id': packing.id,
                        'packing_scope': packing.scope or 'full_shipment',
                        'packing_container_ids': packing_container_ids,
                    })

        if not all_rows:
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
            picking.sudo().update_packing_list_from_portal(all_rows, header_data=header_data)
        except Exception:
            pass

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
            except Exception:
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

        proforma = self._get_or_create_proforma(access)
        shipment = request.env['supplier.shipment'].sudo().browse(self._safe_int(shipment_id))
        if not shipment.exists() or not self._belongs_to_proforma(proforma, shipment=shipment):
            return {'success': False, 'message': 'Embarque no encontrado o no autorizado.'}

        vals = {}
        for k in ['shipment_type', 'shipping_line', 'vessel_name',
                  'port_origin', 'port_destination', 'bl_number', 'notes', 'status']:
            if k in shipment_data:
                if k == 'status':
                    vals[k] = shipment_data[k]
                else:
                    vals[k] = shipment_data[k] or ''

        for k in ['etd', 'eta', 'bl_date']:
            if k in shipment_data:
                vals[k] = shipment_data[k] or False

        if vals:
            shipment.write(vals)

        self._sync_flat_to_picking(shipment.proforma_id, access.picking_id)

        return {'success': True}

    @http.route('/supplier/api/v2/delete_shipment', type='json', auth='public', csrf=False)
    def api_delete_shipment(self, token, shipment_id):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        shipment = request.env['supplier.shipment'].sudo().browse(self._safe_int(shipment_id))
        if not shipment.exists() or not self._belongs_to_proforma(proforma, shipment=shipment):
            return {'success': False, 'message': 'Embarque no encontrado o no autorizado.'}

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

        proforma = self._get_or_create_proforma(access)
        shipment = request.env['supplier.shipment'].sudo().browse(self._safe_int(shipment_id))
        if not shipment.exists() or not self._belongs_to_proforma(proforma, shipment=shipment):
            return {'success': False, 'message': 'Embarque no encontrado o no autorizado.'}

        Container = request.env['supplier.shipment.container'].sudo()
        existing_ids = set()

        for c in containers:
            cid = self._safe_int(c.get('id'), 0)
            vals = {
                'container_number': c.get('container_number', ''),
                'seal_number': c.get('seal_number', ''),
                'container_type': c.get('container_type', ''),
                'weight': self._safe_float(c.get('weight', 0)),
                'volume': self._safe_float(c.get('volume', 0)),
                'packages': self._safe_int(c.get('packages', 0)),
                'notes': c.get('notes', ''),
            }

            if cid:
                record = Container.browse(cid)
                if not record.exists() or record.shipment_id.id != shipment.id:
                    return {'success': False, 'message': 'Uno de los contenedores no pertenece al embarque actual.'}
                record.write(vals)
                existing_ids.add(record.id)
            else:
                vals['shipment_id'] = shipment.id
                new = Container.create(vals)
                existing_ids.add(new.id)

        to_delete = shipment.container_ids.filtered(lambda c: c.id not in existing_ids)
        if to_delete:
            used_in_packings = request.env['supplier.shipment.packing'].sudo().search([
                ('shipment_id', '=', shipment.id),
                ('container_ids', 'in', to_delete.ids),
            ], limit=1)

            used_in_rows = request.env['supplier.shipment.packing.row'].sudo().search([
                ('container_id', 'in', to_delete.ids),
                ('packing_id.shipment_id', '=', shipment.id),
            ], limit=1)

            used_in_invoices = request.env['supplier.shipment.invoice'].sudo().search([
                ('shipment_id', '=', shipment.id),
                ('container_ids', 'in', to_delete.ids),
            ], limit=1)

            if used_in_packings or used_in_rows or used_in_invoices:
                return {
                    'success': False,
                    'message': 'No puede eliminar contenedores que ya están siendo usados en packings, filas o invoices.'
                }

            to_delete.unlink()

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

        proforma = self._get_or_create_proforma(access)
        shipment = request.env['supplier.shipment'].sudo().browse(self._safe_int(shipment_id))
        if not shipment.exists() or not self._belongs_to_proforma(proforma, shipment=shipment):
            return {'success': False, 'message': 'Embarque no encontrado o no autorizado.'}

        Invoice = request.env['supplier.shipment.invoice'].sudo()
        existing_ids = set()

        for inv in invoices:
            iid = self._safe_int(inv.get('id'), 0)
            scope = inv.get('scope', 'full_shipment')
            container_ids = self._normalize_id_list(inv.get('container_ids', []))

            ok, result = self._validate_container_ids_for_shipment(shipment, container_ids)
            if not ok:
                return {'success': False, 'message': result}

            if scope == 'specific_containers' and not result:
                return {
                    'success': False,
                    'message': 'Si el invoice aplica a contenedores específicos, debe seleccionar al menos un contenedor.'
                }

            vals = {
                'invoice_number': inv.get('invoice_number', ''),
                'invoice_date': inv.get('invoice_date') or False,
                'amount': self._safe_float(inv.get('amount', 0)),
                'scope': scope,
                'container_ids': [(6, 0, result)],
            }

            if inv.get('currency_id'):
                vals['currency_id'] = self._safe_int(inv['currency_id'])

            if iid:
                record = Invoice.browse(iid)
                if not record.exists() or not self._belongs_to_proforma(proforma, invoice=record):
                    return {'success': False, 'message': 'Uno de los invoices no pertenece a la proforma actual.'}
                record.write(vals)
                existing_ids.add(record.id)
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

        proforma = self._get_or_create_proforma(access)
        shipment = request.env['supplier.shipment'].sudo().browse(self._safe_int(shipment_id))
        if not shipment.exists() or not self._belongs_to_proforma(proforma, shipment=shipment):
            return {'success': False, 'message': 'Embarque no encontrado o no autorizado.'}

        Packing = request.env['supplier.shipment.packing'].sudo()
        Row = request.env['supplier.shipment.packing.row'].sudo()

        pid = self._safe_int(packing_data.get('id'), 0)
        scope = packing_data.get('scope', 'full_shipment')
        packing_container_ids_raw = packing_data.get('container_ids', [])

        packing_vals = {
            'packing_number': packing_data.get('packing_number', ''),
            'packing_date': packing_data.get('packing_date') or False,
            'scope': scope,
            'container_ids': packing_container_ids_raw,
        }

        ok, msg, normalized_container_ids = self._validate_packing_scope_and_containers(
            shipment, packing_vals, rows=rows or []
        )
        if not ok:
            return {'success': False, 'message': msg}

        vals = {
            'packing_number': packing_data.get('packing_number', ''),
            'packing_date': packing_data.get('packing_date') or False,
            'scope': scope,
            'container_ids': [(6, 0, normalized_container_ids)],
        }

        if pid:
            packing = Packing.browse(pid)
            if not packing.exists() or not self._belongs_to_proforma(proforma, packing=packing):
                return {'success': False, 'message': 'Packing no encontrado o no autorizado.'}
            packing.write(vals)
        else:
            vals['shipment_id'] = shipment.id
            packing = Packing.create(vals)

        if rows is not None:
            existing_rows = {row.id: row for row in packing.row_ids}
            incoming_ids = set()
            sequence = 10

            shipment_container_ids = set(shipment.container_ids.ids)
            packing_container_ids = set(normalized_container_ids)

            for idx, r in enumerate(rows, start=1):
                row_id = self._safe_int(r.get('id'), 0)
                row_container_id = self._safe_int(r.get('container_id'), 0)

                if row_container_id and row_container_id not in shipment_container_ids:
                    return {
                        'success': False,
                        'message': 'La fila %s contiene un contenedor inválido para este embarque.' % idx
                    }

                if scope == 'specific_containers' and row_container_id and row_container_id not in packing_container_ids:
                    return {
                        'success': False,
                        'message': 'La fila %s contiene un contenedor fuera del alcance del packing.' % idx
                    }

                row_vals = {
                    'packing_id': packing.id,
                    'sequence': sequence,
                    'product_id': self._safe_int(r.get('product_id'), 0),
                    'container_id': row_container_id or False,
                    'tipo': r.get('tipo', 'Placa'),
                    'grosor': r.get('grosor', ''),
                    'alto': self._safe_float(r.get('alto', 0)),
                    'ancho': self._safe_float(r.get('ancho', 0)),
                    'peso': self._safe_float(r.get('peso', 0)),
                    'quantity': self._safe_float(r.get('quantity', 0)),
                    'bloque': r.get('bloque', ''),
                    'numero_placa': r.get('numero_placa', ''),
                    'atado': r.get('atado', ''),
                    'color': r.get('color', ''),
                    'grupo_name': r.get('grupo_name', ''),
                    'pedimento': r.get('pedimento', ''),
                    'ref_proveedor': r.get('ref_proveedor', ''),
                }

                if not row_vals['product_id']:
                    return {'success': False, 'message': 'Todas las filas deben tener producto.'}

                if row_id:
                    row_record = existing_rows.get(row_id)
                    if not row_record:
                        return {'success': False, 'message': 'Una de las filas no pertenece al packing actual.'}
                    row_record.write(row_vals)
                    incoming_ids.add(row_record.id)
                else:
                    new_row = Row.create(row_vals)
                    incoming_ids.add(new_row.id)

                sequence += 10

            rows_to_delete = packing.row_ids.filtered(lambda rr: rr.id not in incoming_ids)
            if rows_to_delete:
                rows_to_delete.unlink()

        self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

        return {'success': True, 'packing_id': packing.id}

    @http.route('/supplier/api/v2/delete_packing', type='json', auth='public', csrf=False)
    def api_delete_packing(self, token, packing_id):
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        packing = request.env['supplier.shipment.packing'].sudo().browse(self._safe_int(packing_id))
        if not packing.exists() or not self._belongs_to_proforma(proforma, packing=packing):
            return {'success': False, 'message': 'Packing no encontrado o no autorizado.'}

        packing.unlink()
        self._sync_packing_rows_to_spreadsheet(proforma, access.picking_id)

        return {'success': True}

    # =====================================================================
    #  API v2: SUBIDA DE ARCHIVOS (BL, Invoice, PL)
    # =====================================================================

    @http.route('/supplier/api/v2/upload_file', type='json', auth='public', csrf=False)
    def api_upload_file(self, token, target_model, target_id, field_name, file_data, file_name):
        """Sube un archivo binario a un campo Binary de cualquier modelo permitido."""
        access = self._validate_token(token)
        if not access:
            return {'success': False, 'message': 'Token inválido.'}

        proforma = self._get_or_create_proforma(access)
        if not proforma:
            return {'success': False, 'message': 'Proforma no encontrada.'}

        allowed_models = {
            'supplier.shipment': ['bl_file'],
            'supplier.shipment.invoice': ['file'],
            'supplier.shipment.packing': ['file'],
        }

        if target_model not in allowed_models or field_name not in allowed_models[target_model]:
            return {'success': False, 'message': 'Modelo o campo no permitido.'}

        record = request.env[target_model].sudo().browse(self._safe_int(target_id))
        if not record.exists():
            return {'success': False, 'message': 'Registro no encontrado.'}

        authorized = False
        if target_model == 'supplier.shipment':
            authorized = self._belongs_to_proforma(proforma, shipment=record)
        elif target_model == 'supplier.shipment.invoice':
            authorized = self._belongs_to_proforma(proforma, invoice=record)
        elif target_model == 'supplier.shipment.packing':
            authorized = self._belongs_to_proforma(proforma, packing=record)

        if not authorized:
            return {'success': False, 'message': 'Registro no autorizado para este token.'}

        if not file_data:
            return {'success': False, 'message': 'No se recibió contenido de archivo.'}

        if not file_name:
            file_name = 'archivo'

        fname_field = field_name.replace('file', 'filename') if 'file' in field_name else f'{field_name}_name'
        if field_name == 'bl_file':
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
        if not proforma:
            return {'success': False, 'message': 'Proforma no encontrada.'}

        if not proforma.shipment_ids:
            return {'success': False, 'message': 'Debe existir al menos un embarque antes de completar la proforma.'}

        for shipment in proforma.shipment_ids:
            for packing in shipment.packing_ids:
                if packing.scope == 'specific_containers' and not packing.container_ids:
                    return {
                        'success': False,
                        'message': 'Existe un packing con alcance a contenedores específicos pero sin contenedores asignados.'
                    }
                if packing.scope == 'specific_containers':
                    invalid_rows = packing.row_ids.filtered(
                        lambda r: r.container_id and r.container_id.id not in packing.container_ids.ids
                    )
                    if invalid_rows:
                        return {
                            'success': False,
                            'message': 'Existe un packing con filas usando contenedores fuera de su alcance.'
                        }

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

        proforma = self._get_or_create_proforma(access)
        Row = request.env['supplier.shipment.packing.row'].sudo()
        row = Row.browse(self._safe_int(row_id))
        if not row.exists():
            return {'success': False, 'message': 'Fila no encontrada.'}

        if not self._belongs_to_proforma(proforma, row=row):
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

        proforma = self._get_or_create_proforma(access)
        Row = request.env['supplier.shipment.packing.row'].sudo()
        row = Row.browse(self._safe_int(row_id))
        if not row.exists():
            return {'success': False, 'message': 'Fila no encontrada.'}

        if not self._belongs_to_proforma(proforma, row=row):
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
            return {'success': False, 'message': str(e)}