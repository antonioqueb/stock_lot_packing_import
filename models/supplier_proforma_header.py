# -*- coding: utf-8 -*-

from odoo import api, fields, models


class SupplierProformaHeader(models.Model):
    _name = 'supplier.proforma.header'
    _description = 'Cabecera de Proforma del Portal de Proveedor'
    _order = 'create_date desc, id desc'

    purchase_id = fields.Many2one(
        'purchase.order',
        string='Orden de Compra',
        required=True,
        index=True,
        ondelete='cascade',
    )
    access_id = fields.Many2one(
        'stock.picking.supplier.access',
        string='Acceso proveedor',
        index=True,
        ondelete='set null',
    )

    proforma_number = fields.Char(string='No. de Proforma', copy=False)
    portal_overall_pct = fields.Integer(
        string='Avance del portal (%)', copy=False,
        help='Porcentaje de avance reportado por el PROPIO portal del '
             'proveedor (el mismo número que él ve). Fuente de verdad del '
             'avance de captura.',
    )

    def write(self, vals):
        res = super().write(vals)
        # PI capturada en el portal → reflejar en la OC (vínculo PO↔PI).
        if 'proforma_number' in vals and not self.env.context.get('skip_pi_sync'):
            for header in self:
                po = header.purchase_id
                if not po:
                    continue
                new_num = header.proforma_number or ''
                if (po.partner_ref or '') != new_num:
                    if po.partner_ref and po.partner_ref != new_num:
                        po.message_post(body=(
                            'El proveedor capturó en el portal el No. de PI '
                            '"%s" (antes: "%s").' % (new_num, po.partner_ref)
                        ))
                    po.with_context(skip_pi_sync=True).write({
                        'partner_ref': new_num,
                    })
        return res
    invoice_global_number = fields.Char(string='No. de factura global', copy=False)
    payment_terms = fields.Char(string='Términos de pago', copy=False)
    country_origin = fields.Char(string='País de origen', copy=False)
    port_origin = fields.Char(string='Puerto de origen', copy=False)
    port_destination = fields.Char(string='Puerto destino', copy=False)
    incoterm = fields.Char(string='Incoterm', copy=False)
    general_notes = fields.Text(string='Observaciones generales', copy=False)

    status = fields.Selection(
        [
            ('draft', 'Borrador'),
            ('partial', 'Parcial'),
            ('complete', 'Completa'),
        ],
        string='Estado',
        default='draft',
        required=True,
        index=True,
        copy=False,
    )

    shipment_ids = fields.One2many(
        'supplier.shipment',
        'proforma_id',
        string='Embarques',
        copy=False,
    )

    _supplier_proforma_unique_purchase = models.Constraint(
        'UNIQUE(purchase_id)',
        'Ya existe una proforma de proveedor para esta Orden de Compra.',
    )

    def _portal_progress(self):
        """% de avance de captura del portal. Fuente ÚNICA reutilizable: el
        servicio del portal y la torre de control llaman este mismo método, así
        el dashboard siempre coincide con lo que ve el proveedor."""
        self.ensure_one()
        sections = {}
        total_weight = 0
        completed_weight = 0

        weight = 10
        total_weight += weight
        globals_filled = (
            bool(self.proforma_number) and bool(self.payment_terms)
            and bool(self.country_origin) and bool(self.incoterm)
        )
        if globals_filled:
            completed_weight += weight
        sections["globals"] = {"filled": globals_filled, "weight": weight}

        weight = 5
        total_weight += weight
        has_shipments = bool(self.shipment_ids)
        if has_shipments:
            completed_weight += weight
        sections["has_shipments"] = {"filled": has_shipments, "weight": weight}

        if not has_shipments:
            percent = round((completed_weight / total_weight) * 100) if total_weight else 0
            return {"percent": percent, "sections": sections}

        doc_model = self.env["supplier.shipment.document"].sudo()
        all_docs = doc_model.search([("shipment_id", "in", self.shipment_ids.ids)])
        doc_index_by_shipment = {}
        for doc in all_docs:
            if doc.shipment_id:
                doc_index_by_shipment.setdefault(doc.shipment_id, set()).add(doc.document_type)

        shipment_doc_types_required = ["bl", "invoice", "packing_list"]
        shipment_doc_types_extra = ["eur1", "certificate_origin", "fumigation"]

        for shipment in self.shipment_ids:
            prefix = "ship_%s" % shipment.id
            shipment_doc_types = doc_index_by_shipment.get(shipment.id, set())

            weight = 5
            total_weight += weight
            has_logistics = bool(shipment.vessel_name or shipment.shipping_line) and bool(shipment.etd or shipment.eta)
            if has_logistics:
                completed_weight += weight
            sections["%s_logistics" % prefix] = {"filled": has_logistics, "weight": weight}

            weight = 3
            total_weight += weight
            has_bl_info = bool(shipment.bl_number)
            if has_bl_info:
                completed_weight += weight
            sections["%s_bl_info" % prefix] = {"filled": has_bl_info, "weight": weight}

            weight = 3
            total_weight += weight
            has_containers = bool(shipment.container_ids)
            if has_containers:
                completed_weight += weight
            sections["%s_containers" % prefix] = {"filled": has_containers, "weight": weight}

            weight = 5
            total_weight += weight
            has_packings = bool(shipment.packing_ids) and any(pk.row_ids for pk in shipment.packing_ids)
            if has_packings:
                completed_weight += weight
            sections["%s_packings" % prefix] = {"filled": has_packings, "weight": weight}

            for doc_type in shipment_doc_types_required:
                weight = 8
                total_weight += weight
                has_doc = doc_type in shipment_doc_types
                if has_doc:
                    completed_weight += weight
                sections["%s_doc_%s" % (prefix, doc_type)] = {"filled": has_doc, "weight": weight}

            for doc_type in shipment_doc_types_extra:
                weight = 4
                total_weight += weight
                has_doc = doc_type in shipment_doc_types
                if has_doc:
                    completed_weight += weight
                sections["%s_doc_%s" % (prefix, doc_type)] = {"filled": has_doc, "weight": weight}

        percent = round((completed_weight / total_weight) * 100) if total_weight else 0
        return {"percent": percent, "sections": sections}


class SupplierShipment(models.Model):
    _name = 'supplier.shipment'
    _description = 'Embarque del Portal de Proveedor'
    _order = 'proforma_id, sequence, id'

    name = fields.Char(string='Referencia', default='/', required=True, copy=False)
    sequence = fields.Integer(string='No. embarque', default=1, index=True)

    proforma_id = fields.Many2one(
        'supplier.proforma.header',
        string='Proforma',
        required=True,
        index=True,
        ondelete='cascade',
    )

    shipment_type = fields.Selection(
        [
            ('maritime', 'Marítimo'),
            ('air', 'Aéreo'),
            ('land', 'Terrestre'),
        ],
        string='Tipo de transporte',
        default='maritime',
        required=True,
    )
    shipping_line = fields.Char(string='Naviera / Aerolínea')
    # Catálogo del TARIFARIO (no texto libre): permite seleccionar la tarifa
    # correcta del embarque. El Char shipping_line se conserva sincronizado
    # para reportes/vistas existentes.
    naviera_id = fields.Many2one('res.partner', string='Naviera (catálogo)')
    forwarder_id = fields.Many2one('res.partner', string='Forwarder (catálogo)')
    vessel_name = fields.Char(string='Buque / viaje')
    etd = fields.Date(string='ETD')
    eta = fields.Date(string='ETA')
    port_origin = fields.Char(string='Puerto origen')
    port_destination = fields.Char(string='Puerto destino')
    bl_number = fields.Char(string='No. B/L')
    bl_date = fields.Date(string='Fecha B/L')
    notes = fields.Text(string='Notas')

    status = fields.Selection(
        [
            ('draft', 'Borrador'),
            ('in_production', 'En producción'),
            ('booked', 'Reservado'),
            ('departed', 'Despachado'),
            ('in_transit', 'En tránsito'),
            ('arrived', 'Llegó'),
            ('delivered', 'Entregado'),
            ('cancel', 'Cancelado'),
        ],
        string='Estado',
        default='draft',
        required=True,
        index=True,
    )

    container_ids = fields.One2many(
        'supplier.shipment.container',
        'shipment_id',
        string='Contenedores',
        copy=False,
    )
    invoice_ids = fields.One2many(
        'supplier.shipment.invoice',
        'shipment_id',
        string='Invoices',
        copy=False,
    )
    packing_ids = fields.One2many(
        'supplier.shipment.packing',
        'shipment_id',
        string='Packing Lists',
        copy=False,
    )
    block_image_ids = fields.One2many(
        'supplier.shipment.block.image',
        'shipment_id',
        string='Fotos por bloque',
        copy=False,
    )

    container_count = fields.Integer(
        string='Contenedores',
        compute='_compute_counts',
    )
    invoice_count = fields.Integer(
        string='Invoices',
        compute='_compute_counts',
    )
    packing_count = fields.Integer(
        string='Packing Lists',
        compute='_compute_counts',
    )

    @api.depends('container_ids', 'invoice_ids', 'packing_ids')
    def _compute_counts(self):
        for rec in self:
            rec.container_count = len(rec.container_ids)
            rec.invoice_count = len(rec.invoice_ids)
            rec.packing_count = len(rec.packing_ids)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            proforma_id = vals.get('proforma_id')
            if proforma_id and not vals.get('sequence'):
                siblings = self.search([('proforma_id', '=', proforma_id)])
                vals['sequence'] = (max(siblings.mapped('sequence') or [0]) + 1)

            if not vals.get('name') or vals.get('name') == '/':
                proforma = self.env['supplier.proforma.header'].sudo().browse(proforma_id)
                po_name = proforma.purchase_id.name if proforma and proforma.purchase_id else 'PO'
                seq = vals.get('sequence') or 1
                vals['name'] = '%s / EMB-%02d' % (po_name, seq)

            if proforma_id:
                proforma = self.env['supplier.proforma.header'].sudo().browse(proforma_id)
                if proforma:
                    vals.setdefault('port_origin', proforma.port_origin or '')
                    vals.setdefault('port_destination', proforma.port_destination or '')

        return super().create(vals_list)


class SupplierShipmentContainer(models.Model):
    _name = 'supplier.shipment.container'
    _description = 'Contenedor de Embarque del Portal de Proveedor'
    _order = 'shipment_id, id'

    shipment_id = fields.Many2one(
        'supplier.shipment',
        string='Embarque',
        required=True,
        index=True,
        ondelete='cascade',
    )
    container_number = fields.Char(string='No. contenedor', index=True)
    seal_number = fields.Char(string='No. sello')
    container_type = fields.Char(string='Tipo de contenedor')
    weight = fields.Float(string='Peso bruto')
    volume = fields.Float(string='Volumen')
    packages = fields.Integer(string='Paquetes / bultos')
    notes = fields.Text(string='Notas')

    packing_ids = fields.Many2many(
        'supplier.shipment.packing',
        'supplier_shipment_packing_container_rel',
        'container_id',
        'packing_id',
        string='Packing Lists',
        copy=False,
    )


class SupplierShipmentInvoice(models.Model):
    _name = 'supplier.shipment.invoice'
    _description = 'Invoice de Embarque del Portal de Proveedor'
    _order = 'shipment_id, invoice_date, id'

    shipment_id = fields.Many2one(
        'supplier.shipment',
        string='Embarque',
        required=True,
        index=True,
        ondelete='cascade',
    )
    invoice_number = fields.Char(string='No. invoice', index=True)
    invoice_date = fields.Date(string='Fecha invoice')
    amount = fields.Float(string='Monto')
    currency_id = fields.Many2one(
        'res.currency',
        string='Moneda',
        default=lambda self: self.env.company.currency_id.id,
    )
    scope = fields.Selection(
        [
            ('full_shipment', 'Todo el embarque'),
            ('specific_containers', 'Contenedores específicos'),
        ],
        string='Alcance',
        default='full_shipment',
        required=True,
    )
    container_ids = fields.Many2many(
        'supplier.shipment.container',
        'supplier_shipment_invoice_container_rel',
        'invoice_id',
        'container_id',
        string='Contenedores',
        copy=False,
    )


class SupplierShipmentPacking(models.Model):
    _name = 'supplier.shipment.packing'
    _description = 'Packing List de Embarque del Portal de Proveedor'
    _order = 'shipment_id, packing_date, id'

    shipment_id = fields.Many2one(
        'supplier.shipment',
        string='Embarque',
        required=True,
        index=True,
        ondelete='cascade',
    )
    packing_number = fields.Char(string='No. packing', index=True)
    packing_date = fields.Date(string='Fecha packing')
    scope = fields.Selection(
        [
            ('full_shipment', 'Todo el embarque'),
            ('specific_containers', 'Contenedores específicos'),
        ],
        string='Alcance',
        default='full_shipment',
        required=True,
    )
    container_ids = fields.Many2many(
        'supplier.shipment.container',
        'supplier_shipment_packing_container_rel',
        'packing_id',
        'container_id',
        string='Contenedores',
        copy=False,
    )
    row_ids = fields.One2many(
        'supplier.shipment.packing.row',
        'packing_id',
        string='Filas',
        copy=False,
    )
    row_count = fields.Integer(
        string='Filas',
        compute='_compute_row_count',
    )

    @api.depends('row_ids')
    def _compute_row_count(self):
        for rec in self:
            rec.row_count = len(rec.row_ids)


class SupplierShipmentPackingRow(models.Model):
    _name = 'supplier.shipment.packing.row'
    _description = 'Fila de Packing List del Portal de Proveedor'
    _order = 'packing_id, sequence, id'

    packing_id = fields.Many2one(
        'supplier.shipment.packing',
        string='Packing List',
        required=True,
        index=True,
        ondelete='cascade',
    )
    sequence = fields.Integer(string='Secuencia', default=10)
    product_id = fields.Many2one(
        'product.product',
        string='Producto',
        required=True,
        index=True,
        ondelete='restrict',
    )
    container_id = fields.Many2one(
        'supplier.shipment.container',
        string='Contenedor',
        index=True,
        ondelete='set null',
    )

    # Trazabilidad PI/PO por fila (cada fila del PL sabe de qué línea de
    # compra proviene). Se asigna automáticamente en FIFO al sincronizar el
    # embarque; el usuario no la captura.
    # NOTA: NO llamar 'proforma_id' — stock_transit_allocation ya define ese
    # nombre como related almacenado a shipment_id.proforma_id (la proforma
    # del embarque). Este campo es la PI de la LÍNEA de compra, que en una
    # factura de carga multi-PO puede ser otra.
    purchase_line_id = fields.Many2one(
        'purchase.order.line',
        string='Línea de compra (PO)',
        index=True,
        ondelete='set null',
        copy=False,
    )
    pi_header_id = fields.Many2one(
        'supplier.proforma.header',
        string='PI de la línea',
        index=True,
        ondelete='set null',
        copy=False,
    )
    pi_manual = fields.Boolean(
        string='PI asignada manualmente',
        copy=False,
        help='True cuando el proveedor eligió la PI de esta fila en el portal; '
             'el FIFO automático NUNCA la reasigna.',
    )

    tipo = fields.Selection(
        [
            ('Placa', 'Placa'),
            ('Pieza', 'Pieza'),
            ('Formato', 'Formato'),
        ],
        string='Tipo',
        default='Placa',
        required=True,
    )
    grosor = fields.Char(string='Grosor')
    alto = fields.Float(string='Alto')
    ancho = fields.Float(string='Largo')
    peso = fields.Float(string='Peso')
    quantity = fields.Float(string='Cantidad')
    bloque = fields.Char(string='Bloque')
    numero_placa = fields.Char(string='No. placa')
    atado = fields.Char(string='Atado')
    color = fields.Char(string='Color / notas')
    grupo_name = fields.Char(string='Grupo')
    pedimento = fields.Char(string='Pedimento')
    ref_proveedor = fields.Char(string='Ref. proveedor')

    area_m2 = fields.Float(
        string='Área / cantidad efectiva',
        compute='_compute_area_m2',
        store=True,
    )
    image = fields.Binary(string='Foto', attachment=True, copy=False)
    image_filename = fields.Char(string='Nombre de foto', copy=False)

    @api.depends('tipo', 'alto', 'ancho', 'quantity')
    def _compute_area_m2(self):
        for rec in self:
            if (rec.tipo or '').lower() == 'placa':
                rec.area_m2 = (rec.alto or 0.0) * (rec.ancho or 0.0)
            else:
                rec.area_m2 = rec.quantity or 0.0


class SupplierShipmentBlockImage(models.Model):
    _name = 'supplier.shipment.block.image'
    _description = 'Foto de Bloque del Portal de Proveedor'
    _order = 'shipment_id, block_name, id'

    shipment_id = fields.Many2one(
        'supplier.shipment',
        string='Embarque',
        required=True,
        index=True,
        ondelete='cascade',
    )
    block_name = fields.Char(string='Bloque', required=True, index=True)
    product_id = fields.Many2one(
        'product.product',
        string='Producto',
        required=True,
        index=True,
        ondelete='restrict',
    )
    image = fields.Binary(string='Foto', attachment=True, required=True, copy=False)
    image_filename = fields.Char(string='Nombre de archivo', copy=False)
    notes = fields.Text(string='Notas')

    _supplier_block_image_unique = models.Constraint(
        'UNIQUE(shipment_id, block_name, product_id)',
        'Ya existe una foto para este bloque y producto en el embarque.',
    )
