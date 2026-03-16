# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import ValidationError


class SupplierShipmentDocument(models.Model):
    _name = 'supplier.shipment.document'
    _description = 'Documento de Embarque / Pago del Proveedor'
    _order = 'document_type, create_date desc'

    shipment_id = fields.Integer(
        string='Embarque ID',
        index=True,
        help='ID del supplier.shipment (sin FK para evitar dependencia circular)',
    )
    proforma_id = fields.Integer(
        string='Proforma ID',
        index=True,
        help='ID del supplier.proforma.header (sin FK para evitar dependencia circular)',
    )

    purchase_id = fields.Many2one(
        'purchase.order',
        string='Orden de Compra',
        index=True,
        ondelete='cascade',
        help='Se usa para documentos de pago gestionados internamente desde la OC.',
    )

    document_type = fields.Selection([
        ('bl', 'Bill of Lading (B/L)'),
        ('invoice', 'Invoice'),
        ('packing_list', 'Packing List'),
        ('eur1', 'EUR1'),
        ('certificate_origin', 'Certificado de Origen'),
        ('fumigation', 'Comprobante de Fumigación'),
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

    _unique_upload_token_per_scope = models.Constraint(
        'UNIQUE(shipment_id, proforma_id, purchase_id, document_type, upload_token)',
        'Este archivo ya fue subido para este tipo de documento en el mismo alcance.',
    )

    @api.constrains('document_type', 'shipment_id', 'proforma_id', 'purchase_id')
    def _check_document_scope(self):
        payment_types = {'advance_payment', 'invoice_payment', 'other_payment'}
        shipment_types = {'bl', 'invoice', 'packing_list', 'eur1', 'certificate_origin', 'fumigation'}

        for rec in self:
            if rec.document_type in payment_types:
                if not rec.purchase_id:
                    raise ValidationError('Los documentos de pago deben quedar ligados a una Orden de Compra.')
                if rec.shipment_id or rec.proforma_id:
                    raise ValidationError('Los documentos de pago no deben quedar ligados al portal/proforma/embarque.')
            elif rec.document_type in shipment_types:
                if rec.purchase_id:
                    raise ValidationError('Los documentos logísticos del portal no deben quedar ligados directamente a la Orden de Compra.')

    @api.model
    def check_duplicate(self, shipment_id, proforma_id, purchase_id, document_type, upload_token):
        domain = [
            ('document_type', '=', document_type),
            ('upload_token', '=', upload_token),
        ]

        if shipment_id:
            domain.append(('shipment_id', '=', shipment_id))
        elif proforma_id:
            domain.append(('proforma_id', '=', proforma_id))
        elif purchase_id:
            domain.append(('purchase_id', '=', purchase_id))
        else:
            return False

        return self.search_count(domain) > 0

    @api.model_create_multi
    def create(self, vals_list):
        payment_types = {'advance_payment', 'invoice_payment', 'other_payment'}

        for vals in vals_list:
            if vals.get('purchase_id') and vals.get('document_type') in payment_types:
                vals['shipment_id'] = False
                vals['proforma_id'] = False

        return super().create(vals_list)