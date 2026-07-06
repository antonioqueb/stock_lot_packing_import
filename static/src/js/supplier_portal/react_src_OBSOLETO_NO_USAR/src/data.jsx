/* global React */
// Mock data — represents a real Proforma in mid-fill state

const MOCK_PROFORMA = {
  vendor: 'YUNFU JINQI STONE CO., LTD.',
  vendor_country: 'China',
  po_name: 'PO-2026/0418',
  picking_name: 'WH/IN/02418',
  payload_currency: 'USD',
  globals: {
    proforma_number: 'PI-9920-A',
    invoice_global: '',
    payment_terms: 'T/T 30% advance, 70% B/L copy',
    country_origin: 'China',
    port_origin: 'Shanghai',
    port_destination: 'Manzanillo',
    incoterm: 'CIF',
    general_notes: '',
  },
  // Requested products (from the PO)
  products: [
    { id: 'p1', name: 'Calacatta Gold Polished',     ref: 'CG-POL-20', kind: 'placa', requested_qty: 240, unit: 'placa', dim_text: '320×160×2cm' },
    { id: 'p2', name: 'Statuario Venato Honed',      ref: 'SV-HON-20', kind: 'placa', requested_qty: 120, unit: 'placa', dim_text: '320×160×2cm' },
    { id: 'p3', name: 'Carrara Bianco 60×60 Tile',   ref: 'CB-T60',    kind: 'formato', requested_qty: 480, unit: 'caja', dim_text: '60×60×2cm' },
  ],
  shipments: [
    {
      id: 's1',
      number: 1,
      type: 'maritime',
      shipping_line: 'COSCO Shipping Lines',
      vessel: 'COSCO TAICANG / 042E',
      etd: '2026-06-12',
      eta: '2026-07-04',
      status: 'booked',
      notes: '',
      bl_number: 'COSU6817042500',
      bl_date: '2026-06-13',
      bl_file: 'BL-COSU6817042500.pdf',
      invoices: [
        { id: 'inv1', number: 'JQ-INV-2026-088', date: '2026-06-10', amount: 62400, currency: 'USD', scope: 'full', containers: [] },
        { id: 'inv2', number: 'JQ-INV-2026-089', date: '2026-06-11', amount: 28800, currency: 'USD', scope: 'specific', containers: ['c1'] },
      ],
      containers: [
        { id: 'c1', number: 'COSU6817042', seal: 'CN8821044', type: '40HQ', weight: 27500, volume: 67.2, packages: 12 },
        { id: 'c2', number: 'COSU6817043', seal: 'CN8821045', type: '40HQ', weight: 26800, volume: 67.2, packages: 11 },
      ],
      packings: [
        {
          id: 'pk1', number: 'PK-2026-088-A', date: '2026-06-10',
          products: ['p1'],
          blocks: [
            { id: 'b1', name: 'B-2024-117', count: 18, photo: true,  product: 'p1' },
            { id: 'b2', name: 'B-2024-118', count: 16, photo: true,  product: 'p1' },
            { id: 'b3', name: 'B-2024-119', count: 14, photo: false, product: 'p1' },
          ],
          rows_filled: 38,
          rows_total: 48,
        },
        {
          id: 'pk2', number: 'PK-2026-088-B', date: '2026-06-11',
          products: ['p2'],
          blocks: [
            { id: 'b4', name: 'B-2024-204', count: 12, photo: true, product: 'p2' },
          ],
          rows_filled: 0,
          rows_total: 12,
        },
      ],
      documents: [
        { id: 'd1', name: 'Certificate-of-Origin.pdf', kind: 'CO',  size: 248120, uploaded: '2026-06-08' },
        { id: 'd2', name: 'Fumigation-Cert.pdf',       kind: 'PHYTO', size: 132002, uploaded: '2026-06-08' },
      ],
    },
    {
      id: 's2',
      number: 2,
      type: 'maritime',
      shipping_line: 'MSC',
      vessel: 'MSC LORETO / 326W',
      etd: '2026-07-04',
      eta: '2026-07-28',
      status: 'in_production',
      notes: '',
      bl_number: '',
      bl_date: '',
      bl_file: '',
      invoices: [
        { id: 'inv3', number: 'JQ-INV-2026-092', date: '', amount: 0, currency: 'USD', scope: 'full', containers: [] },
      ],
      containers: [
        { id: 'c3', number: '', seal: '', type: '40HQ', weight: 0, volume: 0, packages: 0 },
      ],
      packings: [],
      documents: [],
    },
    {
      id: 's3',
      number: 3,
      type: '',
      shipping_line: '', vessel: '', etd: '', eta: '', status: 'draft', notes: '',
      bl_number: '', bl_date: '', bl_file: '',
      invoices: [], containers: [], packings: [], documents: [],
    },
  ],
};

// Sample slab rows for packing pk1, block b1 (used in spreadsheet view)
const SAMPLE_ROWS = [
  // Block 1 — 6 slabs of 18 filled, demo subset
  { id: 'r1', block: 'B-2024-117', atado: 'A-01', plate: 'P-001', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r2', block: 'B-2024-117', atado: 'A-01', plate: 'P-002', ref: 'CG-POL-20', thickness: 2, h: 3.20, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r3', block: 'B-2024-117', atado: 'A-01', plate: 'P-003', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.58, notes: 'edge chip', container: 'COSU6817042', photo: false, errors: [] },
  { id: 'r4', block: 'B-2024-117', atado: 'A-01', plate: 'P-004', ref: 'CG-POL-20', thickness: 2, h: 0,    w: 1.60, notes: '', container: 'COSU6817042', photo: false, errors: ['Falta alto'] },
  { id: 'r5', block: 'B-2024-117', atado: 'A-01', plate: 'P-005', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r6', block: 'B-2024-117', atado: 'A-01', plate: 'P-006', ref: 'CG-POL-20', thickness: 2, h: 3.20, w: 1.60, notes: '', container: '', photo: true,  errors: ['Asignar contenedor'] },
  // Block 2
  { id: 'r7', block: 'B-2024-118', atado: 'A-02', plate: 'P-007', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r8', block: 'B-2024-118', atado: 'A-02', plate: 'P-008', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r9', block: 'B-2024-118', atado: 'A-02', plate: 'P-009', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817042', photo: true,  errors: [] },
  { id: 'r10', block: 'B-2024-118', atado: 'A-02', plate: 'P-010', ref: 'CG-POL-20', thickness: 2, h: 3.18, w: 1.60, notes: '', container: 'COSU6817043', photo: false, errors: [] },
  // Block 3 (empty)
  { id: 'r11', block: 'B-2024-119', atado: 'A-03', plate: 'P-011', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto','Falta largo','Asignar contenedor'] },
  { id: 'r12', block: 'B-2024-119', atado: 'A-03', plate: 'P-012', ref: 'CG-POL-20', thickness: 2, h: 0, w: 0, notes: '', container: '', photo: false, errors: ['Falta alto','Falta largo','Asignar contenedor'] },
];

// Sections used in sidebar / overview
const SECTIONS = [
  { id: 'overview',  label: 'Vista general',          icon: 'home' },
  { id: 'globals',   label: 'Datos de la Proforma',   icon: 'globe' },
  { id: 'shipments', label: 'Embarques',              icon: 'ship', children: true },
  { id: 'review',    label: 'Revisar y enviar',       icon: 'flag' },
];

// Compute per-section completion
function computeStatus(proforma) {
  const g = proforma.globals;
  const required = ['proforma_number'];
  const filled = required.filter(k => (g[k] || '').toString().trim().length > 0).length;
  const globals_pct = Math.round(filled / required.length * 100);
  const globals_status = globals_pct === 100 ? 'done' : globals_pct > 0 ? 'partial' : 'todo';

  // Compra nacional: solo cuentan los pasos visibles (invoices + packing).
  // Logística, B/L y contenedores están ocultos, así que no deben bloquear
  // el 100% ni la posibilidad de marcar como completa.
  const isNational = !!(typeof window !== 'undefined' && window.PORTAL_NATIONAL);
  const shipments_status = proforma.shipments.map(s => {
    const hasLog = s.type && s.shipping_line && s.etd;
    const hasBL  = !!s.bl_number;
    const hasInv = s.invoices.length > 0 && s.invoices.every(i => i.number && i.amount);
    const hasContainers = s.containers.length > 0 && s.containers.every(c => c.number);
    const hasPacking    = s.packings.length > 0 && s.packings.every(p => p.rows_filled >= p.rows_total);
    const checks = isNational ? [hasInv, hasPacking] : [hasLog, hasBL, hasInv, hasContainers, hasPacking];
    const score = checks.filter(Boolean).length;
    const total = checks.length;
    return {
      id: s.id,
      pct: Math.round(score / total * 100),
      status: score === total ? 'done' : score > 0 ? 'partial' : 'todo',
      tabs: { hasLog, hasBL, hasInv, hasContainers, hasPacking },
    };
  });

  const ship_done = shipments_status.filter(s => s.status === 'done').length;
  const ship_pct = proforma.shipments.length === 0 ? 0
    : Math.round(shipments_status.reduce((a,b) => a + b.pct, 0) / shipments_status.length);
  const ship_overall = ship_pct === 100 ? 'done' : ship_pct > 0 ? 'partial' : 'todo';

  const overall = Math.round((globals_pct + ship_pct) / 2);

  return { globals_pct, globals_status, ship_pct, ship_overall, ship_done, shipments_status, overall };
}

window.MOCK_PROFORMA = MOCK_PROFORMA;
window.SAMPLE_ROWS = SAMPLE_ROWS;
window.SECTIONS = SECTIONS;
window.computeStatus = computeStatus;
