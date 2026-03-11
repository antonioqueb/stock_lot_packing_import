# -*- coding: utf-8 -*-
import uuid
from odoo import models, fields, api


class SupplierShipmentDocument(models.Model):
    _name = 'supplier.shipment.document'
    _description = 'Documento de Embarque / Pago del Proveedor'
    _order = 'document_type, create_date desc'

    shipment_id = fields.Many2one(
        'supplier.shipment', string='Embarque',
        ondelete='cascade', index=True,
    )
    proforma_id = fields.Many2one(
        'supplier.proforma.header', string='Proforma',
        ondelete='cascade', index=True,
        help='Para documentos globales (pagos) que no van ligados a un embarque específico.',
    )

    document_type = fields.Selection([
        # — Documentos por embarque —
        ('bl', 'Bill of Lading (B/L)'),
        ('invoice', 'Invoice'),
        ('packing_list', 'Packing List'),
        ('eur1', 'EUR1'),
        ('certificate_origin', 'Certificado de Origen'),
        ('fumigation', 'Comprobante de Fumigación'),
        # — Pagos (globales, ligados a proforma) —
        ('advance_payment', 'Anticipo'),
        ('invoice_payment', 'Pago por Invoice'),
        ('other_payment', 'Otro Pago'),
    ], string='Tipo de Documento', required=True, index=True)

    name = fields.Char(string='Nombre del Archivo', required=True)
    file_data = fields.Binary(string='Archivo', required=True, attachment=True)
    file_size = fields.Integer(string='Tamaño (bytes)')
    mime_type = fields.Char(string='Tipo MIME')
    dpi_value = fields.Integer(string='DPI detectado', default=0)
    upload_token = fields.Char(
        string='Token de deduplicación',
        help='Hash o identificador para evitar duplicados.',
    )
    notes = fields.Text(string='Notas')

    _sql_constraints = [
        (
            'unique_upload_token_per_scope',
            'unique(shipment_id, proforma_id, document_type, upload_token)',
            'Este archivo ya fue subido para este tipo de documento.',
        ),
    ]

    @api.model
    def check_duplicate(self, shipment_id, proforma_id, document_type, upload_token):
        """Revisa si un archivo ya fue subido (por hash/nombre+tamaño)."""
        domain = [
            ('document_type', '=', document_type),
            ('upload_token', '=', upload_token),
        ]
        if shipment_id:
            domain.append(('shipment_id', '=', shipment_id))
        if proforma_id:
            domain.append(('proforma_id', '=', proforma_id))

        return self.search_count(domain) > 0