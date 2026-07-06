# Portal del proveedor — fuente única de verdad

## ⚠️ REGLA: el archivo que se edita es `react_exact.bundle.js`

- `react_exact.bundle.js` es **LA FUENTE ÚNICA DE VERDAD** del portal React del
  proveedor. Es JavaScript legible (transpilado de JSX a `React.createElement`,
  NO minificado) y se edita directamente.
- Se sirve desde `views/supplier_portal_templates.xml` con cache-busting por
  versión del módulo: **cada cambio al bundle exige bumpear la versión en
  `__manifest__.py`**, si no, los navegadores de los proveedores seguirán
  usando la versión cacheada.

## ⛔ `react_src_OBSOLETO_NO_USAR/`

Son los fuentes JSX originales, congelados el 2026-05-21. El bundle se siguió
editando directamente después de esa fecha y hoy contiene semanas de trabajo
que NO existen en esos fuentes (packing v2, i18n-pl-v2, plataformas, tarima,
declaración del proveedor, etc.).

**NUNCA reconstruyas el bundle desde esa carpeta: destruirías todo ese
trabajo.** Se conserva solo como referencia histórica de la estructura.

## Cómo editar el bundle con seguridad

1. Los cambios se hacen con reemplazos exactos de texto (el archivo tiene
   ~9,000 líneas). Verifica cada coincidencia antes de reemplazar.
2. Verifica la sintaxis después de cada edición:
   `node --check react_exact.bundle.js`
3. Textos visibles al proveedor: el portal traduce comparando NODOS DE TEXTO
   COMPLETOS contra los diccionarios i18n (líneas gigantes `/* i18n-pl-v2 */` y
   `/* i18n-declaracion */`, una por idioma: EN/ZH/IT/PT). Todo texto nuevo en
   español necesita su entrada en los 4 diccionarios, o se mostrará en español
   para todos los idiomas.
4. Bumpea la versión del módulo y actualiza con `-u stock_lot_packing_import`.

## Futuro (opcional)

Si el trabajo de UI crece, lo correcto es des-bundlear este archivo a módulos
JSX y montar un build con esbuild (`npm run build` / watch). Hasta entonces,
NO existe paso de build: bundle = fuente.
