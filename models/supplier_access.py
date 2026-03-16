_supplier_access_unique_purchase = models.Constraint(
    'UNIQUE(purchase_id)',
    'Ya existe un link para esta Orden de Compra.',
)
