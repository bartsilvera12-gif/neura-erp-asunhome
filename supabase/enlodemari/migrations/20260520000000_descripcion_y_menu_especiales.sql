-- =============================================================================
-- En lo de Mari — Descripción de productos + carga inicial del menú "Especiales"
-- Solo schema enlodemari. Idempotente. Sin tablas nuevas.
-- =============================================================================

-- 1) Columna descripción en productos (aditiva, nullable).
ALTER TABLE enlodemari.productos
  ADD COLUMN IF NOT EXISTS descripcion text;

COMMENT ON COLUMN enlodemari.productos.descripcion IS
  'Descripción detallada del producto (visible en Menú y edición).';

-- 2) Helper upsert (clave natural: SKU).
CREATE OR REPLACE FUNCTION enlodemari._upsert_producto_menu(
  p_empresa uuid,
  p_categoria uuid,
  p_sku text,
  p_nombre text,
  p_precio numeric,
  p_descripcion text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM enlodemari.productos
    WHERE empresa_id = p_empresa AND sku = p_sku;

  IF v_id IS NULL THEN
    INSERT INTO enlodemari.productos (
      empresa_id, nombre, sku, descripcion,
      costo_promedio, precio_venta, stock_actual, stock_minimo,
      unidad_medida, metodo_valuacion, activo,
      categoria_principal_id,
      es_vendible, es_insumo, controla_stock, valorizado,
      tiempo_prep_minutos, factor_compra_receta
    ) VALUES (
      p_empresa, p_nombre, p_sku, p_descripcion,
      0, p_precio, 0, 0,
      'UNIDAD', 'CPP', true,
      p_categoria,
      true, false, false, false,
      0, 1
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE enlodemari.productos
    SET nombre = p_nombre,
        descripcion = p_descripcion,
        precio_venta = p_precio,
        es_vendible = true,
        es_insumo = false,
        controla_stock = false,
        valorizado = false,
        categoria_principal_id = p_categoria,
        unidad_medida = 'UNIDAD',
        activo = true,
        updated_at = now()
    WHERE id = v_id;
  END IF;

  -- Puente producto_categorias.es_principal (idempotente)
  IF NOT EXISTS (
    SELECT 1 FROM enlodemari.producto_categorias
    WHERE empresa_id = p_empresa AND producto_id = v_id AND categoria_id = p_categoria
  ) THEN
    INSERT INTO enlodemari.producto_categorias (empresa_id, producto_id, categoria_id, es_principal)
    VALUES (p_empresa, v_id, p_categoria, true);
  END IF;
END;
$$;

-- 3) Categorías + productos
DO $$
DECLARE
  v_empresa uuid := '3983553a-de4b-4edf-bc6f-3f86025a97dc'; -- En lo de Mari
  v_especiales_id uuid;
  v_hamburguesas_id uuid;
  v_lomitos_id uuid;
  v_lomitos_arabes_id uuid;
  v_extras_id uuid;
BEGIN
  -- Categoría padre "ESPECIALES"
  SELECT id INTO v_especiales_id FROM enlodemari.categorias_productos
    WHERE empresa_id = v_empresa AND nombre = 'ESPECIALES';
  IF v_especiales_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, descripcion, parent_id, activo)
    VALUES (v_empresa, 'ESPECIALES', 'especiales', 'Menú de especiales', NULL, true)
    RETURNING id INTO v_especiales_id;
  END IF;

  -- Hijas
  SELECT id INTO v_hamburguesas_id FROM enlodemari.categorias_productos
    WHERE empresa_id = v_empresa AND nombre = 'HAMBURGUESAS';
  IF v_hamburguesas_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
    VALUES (v_empresa, 'HAMBURGUESAS', 'hamburguesas', v_especiales_id, true)
    RETURNING id INTO v_hamburguesas_id;
  ELSE
    UPDATE enlodemari.categorias_productos SET parent_id = v_especiales_id WHERE id = v_hamburguesas_id AND (parent_id IS NULL OR parent_id <> v_especiales_id);
  END IF;

  SELECT id INTO v_lomitos_id FROM enlodemari.categorias_productos
    WHERE empresa_id = v_empresa AND nombre = 'LOMITOS';
  IF v_lomitos_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
    VALUES (v_empresa, 'LOMITOS', 'lomitos', v_especiales_id, true)
    RETURNING id INTO v_lomitos_id;
  ELSE
    UPDATE enlodemari.categorias_productos SET parent_id = v_especiales_id WHERE id = v_lomitos_id AND (parent_id IS NULL OR parent_id <> v_especiales_id);
  END IF;

  SELECT id INTO v_lomitos_arabes_id FROM enlodemari.categorias_productos
    WHERE empresa_id = v_empresa AND nombre = 'LOMITOS ARABES';
  IF v_lomitos_arabes_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
    VALUES (v_empresa, 'LOMITOS ARABES', 'lomitos_arabes', v_especiales_id, true)
    RETURNING id INTO v_lomitos_arabes_id;
  ELSE
    UPDATE enlodemari.categorias_productos SET parent_id = v_especiales_id WHERE id = v_lomitos_arabes_id AND (parent_id IS NULL OR parent_id <> v_especiales_id);
  END IF;

  SELECT id INTO v_extras_id FROM enlodemari.categorias_productos
    WHERE empresa_id = v_empresa AND nombre = 'EXTRAS';
  IF v_extras_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
    VALUES (v_empresa, 'EXTRAS', 'extras', v_especiales_id, true)
    RETURNING id INTO v_extras_id;
  ELSE
    UPDATE enlodemari.categorias_productos SET parent_id = v_especiales_id WHERE id = v_extras_id AND (parent_id IS NULL OR parent_id <> v_especiales_id);
  END IF;

  -- Upsert productos (clave: SKU)
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-NORMAL',          'HAMBURGUESA NORMAL', 14000, 'Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-NORMAL-DOBLE',    'HAMBURGUESA NORMAL DOBLE', 22000, 'Pan, doble carne, huevo, triple queso, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-CASERA',          'HAMBURGUESA CASERA', 17000, 'Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-CASERA-DOBLE',    'HAMBURGUESA CASERA DOBLE', 27000, 'Pan, doble carne, huevo, triple queso, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-CASERA-AROS-PAPAS','HAMBURGUESA CASERA C/ AROS DE CEBOLLA Y PAPAS', 28000, 'Pan hamburguesa casero, doble queso, huevo, cheddar, panceta, aros de cebolla, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-PARRILLERA',      'HAMBURGUESA PARRILLERA', 19000, 'Pan, carne, huevo, doble queso, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_hamburguesas_id, 'ESP-HAMB-PARRILLERA-DOBLE','HAMBURGUESA PARRILLERA DOBLE', 29000, 'Pan, doble carne, huevo, triple queso, lechuga, tomate, mayonesa.');

  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_id, 'ESP-LOM-SANDWICH',         'LOMITO SANDWICH', 22000, 'Pan, carne, doble queso, huevo, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_id, 'ESP-LOM-SANDWICH-DOBLE',   'LOMITO SANDWICH DOBLE', 32000, 'Pan, doble carne, triple queso, huevo, lechuga, tomate, mayonesa.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_id, 'ESP-LOM-BAGUETTE',         'LOMITO BAGUETTE', 27000, 'Pan, carne, doble queso, panceta, cebolla, huevo, lechuga, tomate, mayonesa.');

  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_arabes_id, 'ESP-LOM-ARABE-POLLO',     'LOMITO ARABE POLLO', 24000, 'Pan árabe, pollo, queso, repollo, tomate, salsa de ajo.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_arabes_id, 'ESP-LOM-ARABE-CARNE',     'LOMITO ARABE CARNE', 26000, 'Pan árabe, carne, queso, repollo, tomate, salsa de ajo.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_arabes_id, 'ESP-LOM-ARABE-MIXTO',     'LOMITO ARABE MIXTO', 24000, 'Pan árabe, carne, pollo, queso, repollo, tomate, salsa de ajo.');
  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_lomitos_arabes_id, 'ESP-LOM-ARABE-ESPECIAL',  'LOMITO ARABE ESPECIAL', 30000, 'Pan árabe, carne, pollo, pepperoni, catupiry, queso mozzarella, repollo, tomate, salsa de ajo.');

  PERFORM enlodemari._upsert_producto_menu(v_empresa, v_extras_id, 'ESP-AGREGADO-OPCIONAL', 'AGREGADO OPCIONAL', 3000, 'Agregado opcional para productos del menú.');
END $$;
