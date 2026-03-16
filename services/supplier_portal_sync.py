# -*- coding: utf-8 -*-

import logging

from .supplier_portal_base import SupplierPortalBaseService

_logger = logging.getLogger(__name__)


class SupplierPortalSyncService(SupplierPortalBaseService):
    """
    Sincronización de datos del portal hacia stock.picking y spreadsheet.
    """

    def sync_flat_to_picking(self, header, picking):
        if not picking or not header:
            return

        all_bl = []
        all_containers = []
        all_seals = []
        all_types = []
        total_packages = 0
        total_weight = 0.0
        total_volume = 0.0

        first_shipment = self.sorted_shipments(header.shipment_ids)[:1]

        for shipment in header.shipment_ids:
            if shipment.bl_number:
                all_bl.append(shipment.bl_number)

            for container in shipment.container_ids:
                if container.container_number:
                    all_containers.append(container.container_number)
                if container.seal_number:
                    all_seals.append(container.seal_number)
                if container.container_type:
                    all_types.append(container.container_type)

                total_packages += container.packages or 0
                total_weight += container.weight or 0.0
                total_volume += container.volume or 0.0

        vals = {
            "supplier_proforma_number": header.proforma_number or "",
            "supplier_payment_terms": header.payment_terms or "",
            "supplier_country_origin": header.country_origin or "",
            "supplier_origin": header.port_origin or "",
            "supplier_destination": header.port_destination or "",
            "supplier_incoterm_payment": header.incoterm or "",
            "supplier_bl_number": ", ".join(all_bl) if all_bl else "",
            "supplier_container_no": ", ".join(all_containers) if all_containers else "",
            "supplier_seal_no": ", ".join(all_seals) if all_seals else "",
            "supplier_container_type": ", ".join(sorted(set(all_types))) if all_types else "",
            "supplier_total_packages": total_packages,
            "supplier_gross_weight": total_weight,
            "supplier_volume": total_volume,
        }

        if first_shipment:
            first = first_shipment[0]
            vals["supplier_vessel"] = first.vessel_name or ""
            vals["supplier_shipment_date"] = first.etd or False

        try:
            picking.sudo().write(vals)
        except Exception:
            _logger.exception(
                "[Portal] Error sincronizando cabecera de proforma al picking %s.",
                picking.id,
            )

    def sync_packing_rows_to_spreadsheet(self, header, picking):
        if not picking or not header:
            return

        all_rows = []

        for shipment in self.sorted_shipments(header.shipment_ids):
            for packing in self.sorted_packings(shipment.packing_ids):
                packing_container_ids = packing.container_ids.ids
                packing_container_numbers = packing.container_ids.mapped("container_number")

                for row in packing.row_ids.sorted("sequence"):
                    container_name = ""
                    if row.container_id and row.container_id.container_number:
                        container_name = row.container_id.container_number
                    elif packing.scope == "specific_containers" and len(packing_container_numbers) == 1:
                        container_name = packing_container_numbers[0] or ""
                    elif packing.scope == "specific_containers" and len(packing_container_numbers) > 1:
                        container_name = "MULTI"
                    else:
                        container_name = "SN"

                    all_rows.append({
                        "product_id": row.product_id.id,
                        "grosor": row.grosor or "",
                        "alto": row.alto or 0,
                        "ancho": row.ancho or 0,
                        "peso": row.peso or 0,
                        "quantity": row.quantity or 0,
                        "color": row.color or "",
                        "bloque": row.bloque or "",
                        "numero_placa": row.numero_placa or "",
                        "atado": row.atado or "",
                        "tipo": row.tipo or "Placa",
                        "grupo_name": row.grupo_name or "",
                        "pedimento": row.pedimento or "",
                        "contenedor": container_name or "SN",
                        "ref_proveedor": row.ref_proveedor or "",
                        "packing_id": packing.id,
                        "packing_scope": packing.scope or "full_shipment",
                        "packing_container_ids": packing_container_ids,
                    })

        if not all_rows:
            return

        header_data = {
            "proforma_number": header.proforma_number or "",
            "payment_terms": header.payment_terms or "",
            "country_origin": header.country_origin or "",
            "origin": header.port_origin or "",
            "destination": header.port_destination or "",
            "incoterm": header.incoterm or "",
            "invoice_number": header.invoice_global_number or "",
        }

        first_shipment = self.sorted_shipments(header.shipment_ids)[:1]
        if first_shipment:
            first = first_shipment[0]
            header_data.update({
                "vessel": first.vessel_name or "",
                "shipment_date": str(first.etd) if first.etd else "",
                "bl_number": first.bl_number or "",
            })

        try:
            picking.sudo().update_packing_list_from_portal(all_rows, header_data=header_data)
        except Exception:
            _logger.exception(
                "[Portal] Error sincronizando filas del portal al spreadsheet del picking %s.",
                picking.id,
            )