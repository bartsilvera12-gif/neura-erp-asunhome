-- =============================================================================
-- En lo de Mari — Carga completa del menú + reventa
-- Solo schema enlodemari. Idempotente (clave: SKU). NO duplica si se re-ejecuta.
-- =============================================================================

-- Helper Menú (ya existe de migración previa; lo recreamos para idempotencia).
CREATE OR REPLACE FUNCTION enlodemari._upsert_producto_menu(
  p_empresa uuid, p_categoria uuid, p_sku text, p_nombre text, p_precio numeric, p_descripcion text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM enlodemari.productos WHERE empresa_id = p_empresa AND sku = p_sku;
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
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE enlodemari.productos
    SET nombre = p_nombre, descripcion = p_descripcion, precio_venta = p_precio,
        es_vendible = true, es_insumo = false, controla_stock = false, valorizado = false,
        categoria_principal_id = p_categoria, unidad_medida = 'UNIDAD',
        activo = true, updated_at = now()
    WHERE id = v_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM enlodemari.producto_categorias
    WHERE empresa_id = p_empresa AND producto_id = v_id AND categoria_id = p_categoria
  ) THEN
    INSERT INTO enlodemari.producto_categorias (empresa_id, producto_id, categoria_id, es_principal)
    VALUES (p_empresa, v_id, p_categoria, true);
  END IF;
END;
$$;

-- Helper Reventa: controla_stock=true, valorizado=true, stock=0 (se llena por Compras).
CREATE OR REPLACE FUNCTION enlodemari._upsert_producto_reventa(
  p_empresa uuid, p_categoria uuid, p_sku text, p_nombre text, p_precio numeric, p_descripcion text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM enlodemari.productos WHERE empresa_id = p_empresa AND sku = p_sku;
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
      true, false, true, true,
      0, 1
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE enlodemari.productos
    SET nombre = p_nombre, descripcion = p_descripcion, precio_venta = p_precio,
        es_vendible = true, es_insumo = false, controla_stock = true, valorizado = true,
        categoria_principal_id = p_categoria, unidad_medida = 'UNIDAD',
        activo = true, updated_at = now()
    WHERE id = v_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM enlodemari.producto_categorias
    WHERE empresa_id = p_empresa AND producto_id = v_id AND categoria_id = p_categoria
  ) THEN
    INSERT INTO enlodemari.producto_categorias (empresa_id, producto_id, categoria_id, es_principal)
    VALUES (p_empresa, v_id, p_categoria, true);
  END IF;
END;
$$;

-- Helper categoría (idempotente, con parent opcional).
CREATE OR REPLACE FUNCTION enlodemari._ensure_categoria(
  p_empresa uuid, p_nombre text, p_codigo text, p_parent uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM enlodemari.categorias_productos
    WHERE empresa_id = p_empresa AND nombre = p_nombre;
  IF v_id IS NULL THEN
    INSERT INTO enlodemari.categorias_productos (empresa_id, nombre, codigo, parent_id, activo)
    VALUES (p_empresa, p_nombre, p_codigo, p_parent, true)
    RETURNING id INTO v_id;
  ELSE
    UPDATE enlodemari.categorias_productos
    SET parent_id = COALESCE(p_parent, parent_id), activo = true
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_emp uuid := '3983553a-de4b-4edf-bc6f-3f86025a97dc';
  -- Padres
  v_especiales uuid;
  v_bebidas uuid;
  -- Menú hijas
  v_hamburguesas uuid;
  v_lomitos uuid;
  v_lomitos_arabes uuid;
  v_papas uuid;
  v_panchos uuid;
  v_pizzas uuid;
  v_lompizzas uuid;
  v_extras uuid;
  -- Reventa hijas
  v_gaseosas uuid;
  v_cervezas uuid;
  v_vinos uuid;
  v_jugos uuid;
  v_aguas uuid;
BEGIN
  -- Padres
  v_especiales     := enlodemari._ensure_categoria(v_emp, 'ESPECIALES', 'especiales', NULL);
  v_bebidas        := enlodemari._ensure_categoria(v_emp, 'BEBIDAS', 'bebidas', NULL);

  -- Menú hijas (parent = ESPECIALES)
  v_hamburguesas   := enlodemari._ensure_categoria(v_emp, 'HAMBURGUESAS', 'hamburguesas', v_especiales);
  v_lomitos        := enlodemari._ensure_categoria(v_emp, 'LOMITOS', 'lomitos', v_especiales);
  v_lomitos_arabes := enlodemari._ensure_categoria(v_emp, 'LOMITOS ARABES', 'lomitos_arabes', v_especiales);
  v_papas          := enlodemari._ensure_categoria(v_emp, 'PAPAS FRITAS', 'papas_fritas', v_especiales);
  v_panchos        := enlodemari._ensure_categoria(v_emp, 'PANCHOS', 'panchos', v_especiales);
  v_pizzas         := enlodemari._ensure_categoria(v_emp, 'PIZZAS', 'pizzas', v_especiales);
  v_lompizzas      := enlodemari._ensure_categoria(v_emp, 'LOMPIZZAS', 'lompizzas', v_especiales);
  v_extras         := enlodemari._ensure_categoria(v_emp, 'EXTRAS', 'extras', v_especiales);

  -- Reventa hijas (parent = BEBIDAS)
  v_gaseosas       := enlodemari._ensure_categoria(v_emp, 'GASEOSAS', 'gaseosas', v_bebidas);
  v_cervezas       := enlodemari._ensure_categoria(v_emp, 'CERVEZAS', 'cervezas', v_bebidas);
  v_vinos          := enlodemari._ensure_categoria(v_emp, 'VINOS', 'vinos', v_bebidas);
  v_jugos          := enlodemari._ensure_categoria(v_emp, 'JUGOS', 'jugos', v_bebidas);
  v_aguas          := enlodemari._ensure_categoria(v_emp, 'AGUAS', 'aguas', v_bebidas);

  -- ============================================================
  -- MENÚ — ESPECIALES (nuevos)
  -- ============================================================
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_especiales, 'ESP-CHURRASQUITO-QUESO', 'CHURRASQUITO CON QUESO DERRETIDO', 14000, 'Pan de super pancho, salsa de ajo, repollo, tomate, pollo, carne, queso.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_especiales, 'ESP-CHIVITO-PAPAS', 'CHIVITO CON PAPAS FRITAS', 55000, 'Pan, carne, huevo, queso mozzarella, cebolla, panceta, katupiry, aceituna, orégano, papas fritas.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_especiales, 'ESP-BIFE-A-CABALLO', 'BIFE A CABALLO', 45000, 'Lechuga, tomate, cebolla, carne, huevo, pan tostado.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_especiales, 'ESP-PICADAS', 'PICADAS', 65000, 'Carne, pollo, queso, jamón, pepperoni, chorizo picante, super pancho cortadito, papas fritas, aceitunas, salsas.');

  -- PAPAS FRITAS
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_papas, 'ESP-PAPAS-CHICO',           'PAPAS FRITAS CHICO',     12000, 'Porción chica de papas fritas.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_papas, 'ESP-PAPAS-GRANDES',         'PAPAS FRITAS GRANDES',   17000, 'Porción grande de papas fritas.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_papas, 'ESP-PAPAS-FAMILIAR',        'PAPAS FRITAS FAMILIAR',  25000, 'Porción familiar de papas fritas.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_papas, 'ESP-PAPAS-CHEDDAR-PANCETA', 'PAPAS FRITAS CON CHEDDAR Y PANCETA', 21000, 'Papas fritas con cheddar y panceta.');

  -- PANCHOS
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_panchos, 'ESP-SUPER-PANCHO',        'SUPER PANCHOS',                     13000, 'Super pancho.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_panchos, 'ESP-SUPER-PANCHO-QUESO',  'SUPER PANCHOS CON QUESO DERRETIDO', 13000, 'Super pancho con queso derretido.');

  -- ============================================================
  -- MENÚ — PIZZAS (sin borde + con borde para cada sabor)
  -- ============================================================
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MUZZARELLA-SB',      'PIZZA MUZZARELLA SIN BORDE',      40000, 'Salsa, muzzarella, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MUZZARELLA-CB',      'PIZZA MUZZARELLA CON BORDE',      55000, 'Salsa, muzzarella, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-JAMON-QUESO-SB',     'PIZZA JAMÓN Y QUESO SIN BORDE',   50000, 'Salsa, muzzarella, jamón, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-JAMON-QUESO-CB',     'PIZZA JAMÓN Y QUESO CON BORDE',   60000, 'Salsa, muzzarella, jamón, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MARGARITA-SB',       'PIZZA MARGARITA SIN BORDE',       50000, 'Salsa, muzzarella, tomate, locote rojo y verde, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MARGARITA-CB',       'PIZZA MARGARITA CON BORDE',       60000, 'Salsa, muzzarella, tomate, locote rojo y verde, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-KATUPIRY-SB',        'PIZZA KATUPIRY SIN BORDE',        50000, 'Salsa, muzzarella, katupiry, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-KATUPIRY-CB',        'PIZZA KATUPIRY CON BORDE',        60000, 'Salsa, muzzarella, katupiry, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-NAPOLITANA-SB',      'PIZZA NAPOLITANA SIN BORDE',      50000, 'Salsa, muzzarella, jamón, tomate, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-NAPOLITANA-CB',      'PIZZA NAPOLITANA CON BORDE',      60000, 'Salsa, muzzarella, jamón, tomate, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-KATUPIRY-POLLO-SB',  'PIZZA KATUPIRY CON POLLO SIN BORDE', 50000, 'Salsa, muzzarella, katupiry, pollo, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-KATUPIRY-POLLO-CB',  'PIZZA KATUPIRY CON POLLO CON BORDE', 60000, 'Salsa, muzzarella, katupiry, pollo, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PEPPERONI-SB',       'PIZZA PEPPERONI SIN BORDE',       50000, 'Salsa, muzzarella, pepperoni, locote rojo y verde, aceituna. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PEPPERONI-CB',       'PIZZA PEPPERONI CON BORDE',       60000, 'Salsa, muzzarella, pepperoni, locote rojo y verde, aceituna. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHOCLO-SB',          'PIZZA CHOCLO SIN BORDE',          50000, 'Salsa, muzzarella, choclo, aceituna, katupiry, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHOCLO-CB',          'PIZZA CHOCLO CON BORDE',          60000, 'Salsa, muzzarella, choclo, aceituna, katupiry, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PALMITO-SB',         'PIZZA PALMITO SIN BORDE',         50000, 'Salsa, muzzarella, palmito, salsa golf, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PALMITO-CB',         'PIZZA PALMITO CON BORDE',         60000, 'Salsa, muzzarella, palmito, salsa golf, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-ATUN-SB',            'PIZZA ATÚN SIN BORDE',            50000, 'Salsa, muzzarella, atún, cebolla salteada, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-ATUN-CB',            'PIZZA ATÚN CON BORDE',            60000, 'Salsa, muzzarella, atún, cebolla salteada, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CARNE-LOMITO-SB',    'PIZZA CARNE DE LOMITO SIN BORDE', 50000, 'Muzzarella, carne de lomito, katupiry, locote rojo y verde, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CARNE-LOMITO-CB',    'PIZZA CARNE DE LOMITO CON BORDE', 60000, 'Muzzarella, carne de lomito, katupiry, locote rojo y verde, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PRIMAVERA-SB',       'PIZZA PRIMAVERA SIN BORDE',       50000, 'Salsa, queso, jamón, tomate, choclo, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PRIMAVERA-CB',       'PIZZA PRIMAVERA CON BORDE',       60000, 'Salsa, queso, jamón, tomate, choclo, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHICAGO-SB',         'PIZZA CHICAGO SIN BORDE',         50000, 'Salsa, muzzarella, pancho, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHICAGO-CB',         'PIZZA CHICAGO CON BORDE',         60000, 'Salsa, muzzarella, pancho, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-TROPICAL-SB',        'PIZZA TROPICAL SIN BORDE',        50000, 'Salsa, queso, palmito, katupiry, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-TROPICAL-CB',        'PIZZA TROPICAL CON BORDE',        60000, 'Salsa, queso, palmito, katupiry, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MEXICANA-SB',        'PIZZA MEXICANA SIN BORDE',        50000, 'Salsa, muzzarella, carne lomito, aceituna, morrón, orégano, picante. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-MEXICANA-CB',        'PIZZA MEXICANA CON BORDE',        60000, 'Salsa, muzzarella, carne lomito, aceituna, morrón, orégano, picante. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PANCETA-SB',         'PIZZA PANCETA SIN BORDE',         50000, 'Salsa, muzzarella, panceta, cebolla salteada, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-PANCETA-CB',         'PIZZA PANCETA CON BORDE',         60000, 'Salsa, muzzarella, panceta, cebolla salteada, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-VEGETARIANA-SB',     'PIZZA VEGETARIANA SIN BORDE',     50000, 'Salsa, muzzarella, tomate, locote, palmito, choclo, cebolla, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-VEGETARIANA-CB',     'PIZZA VEGETARIANA CON BORDE',     60000, 'Salsa, muzzarella, tomate, locote, palmito, choclo, cebolla, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CUATRO-QUESOS-SB',   'PIZZA CUATRO QUESOS SIN BORDE',   50000, 'Salsa, muzzarella, roquefort, katupiry, queso rallado, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CUATRO-QUESOS-CB',   'PIZZA CUATRO QUESOS CON BORDE',   60000, 'Salsa, muzzarella, roquefort, katupiry, queso rallado, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-FUGAZZETA-SB',       'PIZZA FUGAZZETA SIN BORDE',       50000, 'Salsa, queso, cebolla salteada, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-FUGAZZETA-CB',       'PIZZA FUGAZZETA CON BORDE',       60000, 'Salsa, queso, cebolla salteada, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHAMPINON-SB',       'PIZZA CHAMPIÑON SIN BORDE',       50000, 'Salsa, muzzarella, champiñón, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHAMPINON-CB',       'PIZZA CHAMPIÑON CON BORDE',       60000, 'Salsa, muzzarella, champiñón, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHEDDAR-PANCETA-SB', 'PIZZA CHEDDAR Y PANCETA SIN BORDE', 50000, 'Salsa, muzzarella, cheddar, panceta, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CHEDDAR-PANCETA-CB', 'PIZZA CHEDDAR Y PANCETA CON BORDE', 60000, 'Salsa, muzzarella, cheddar, panceta, aceituna, orégano. Con borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CASA-SB',            'PIZZA DE LA CASA SIN BORDE',      55000, 'Salsa, muzzarella, chorizo picante, pancho, carne de lomito, katupiry, locote, aceituna, orégano. Sin borde.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_pizzas, 'PIZ-CASA-CB',            'PIZZA DE LA CASA CON BORDE',      65000, 'Salsa, muzzarella, chorizo picante, pancho, carne de lomito, katupiry, locote, aceituna, orégano. Con borde.');

  -- Extras
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_extras, 'PIZ-AGREGADO-OPCIONAL', 'AGREGADO OPCIONAL PIZZA', 5000, 'Agregado opcional para pizzas.');

  -- LOMPIZZAS
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_lompizzas, 'PIZ-LOMPIZZA-6', 'LOMPIZZA 6 PORCIONES', 75000, 'Salsa de ajo, muzzarella doble, lomito, jamón, huevo, katupiry, panceta, locote, tomate, pepperoni, aceituna, orégano.');
  PERFORM enlodemari._upsert_producto_menu(v_emp, v_lompizzas, 'PIZ-LOMPIZZA-8', 'LOMPIZZA 8 PORCIONES', 95000, 'Salsa de ajo, muzzarella doble, lomito, jamón, huevo, katupiry, panceta, locote, tomate, pepperoni, aceituna, orégano.');

  -- ============================================================
  -- REVENTA — GASEOSAS
  -- ============================================================
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-250',                'COCA COLA 250 ML',                 5000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-500',                'COCA COLA 500 ML',                 8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-FANTA-PINA-500',          'FANTA PIÑA 500 ML',                8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-FANTA-NARANJA-500',       'FANTA NARANJA 500 ML',             8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-FANTA-GUARANA-500',       'FANTA GUARANÁ 500 ML',             8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-SPRITE-500',              'SPRITE 500 ML',                    8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-1L-RET',             'COCA COLA 1 LITRO RETORNABLE',     10000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-15L-RET',            'COCA COLA 1.5 LITRO RETORNABLE',   13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-FANTA-GUARANA-15L-RET',   'FANTA GUARANÁ 1.5 LITRO RETORNABLE', 13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-SPRITE-15L-RET',          'SPRITE 1.5 LITRO RETORNABLE',      13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-2L',                 'COCA COLA 2 LITROS',               18000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-3L',                 'COCA COLA 3 LITROS',               24000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-SCHWEPPES-TONICA-500',    'SCHWEPPES TÓNICA 500 ML',          8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-PASO-TOROS-1L',           'PASO DE LOS TOROS 1 LITRO',        10000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-PASO-TOROS-500',          'PASO DE LOS TOROS 500 ML',         7000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_gaseosas, 'REV-GAS-COCA-LATA',               'COCA COLA LATA',                   9000, NULL);

  -- REVENTA — CERVEZAS
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-OURO-FINO-LATA',     'OURO FINO LATA',          5000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-PILSEN-LATA',        'PILSEN LATA',             5000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-BUD-66-LATA',        'BUD 66 LATA',             8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-SKOLL-1L',           'SKOLL BOTELLA DE LITRO',  12000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-PILSEN-1L',          'PILSEN BOTELLA DE LITRO', 12000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-OURO-FINO-1L',       'OURO FINO BOTELLA DE LITRO', 12000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-BUD-NEGRA-BOTELLA',  'BUD NEGRA BOTELLA',       18000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-SKOLL-LATA',         'SKOLL LATA',              5000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-SKOLL-ABRE-FACIL',   'SKOLL ABRE FÁCIL',        9000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_cervezas, 'REV-CERV-MILLER-BOTELLA',     'MILLER BOTELLA',          18000, NULL);

  -- REVENTA — VINOS
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_vinos, 'REV-VINO-SANTA-ELENA',       'SANTA ELENA',         32000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_vinos, 'REV-VINO-CANCAO',            'CANCAO',              27000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_vinos, 'REV-VINO-SANTA-CLAUDIA',     'SANTA CLAUDIA',       30000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_vinos, 'REV-VINO-VALENTIN-LACRADO',  'VALENTIN LACRADO',    32000, NULL);

  -- REVENTA — JUGOS
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-ACUARIUS-MANZANA-15L', 'ACUARIUS MANZANA 1.5 LITRO',   16000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-ACUARIUS-NARANJA-15L', 'ACUARIUS NARANJA 1.5 LITRO',   16000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-FRUGOS-CHICO-DURAZNO', 'FRUGOS CHICO DURAZNO',         6000,  NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-FRUGOS-CHICO-MANZANA', 'FRUGOS CHICO MANZANA',         6000,  NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-FRUGOS-DURAZNO-1L',    'FRUGOS 1 LITRO DURAZNO',       13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-FRUGOS-MANZANA-1L',    'FRUGOS 1 LITRO MANZANA',       13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-FRUGOS-NARANJA-1L',    'FRUGOS 1 LITRO NARANJA',       13000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-DEL-VALLE-15L',        'DEL VALLE BOTELLA 1.5 LITRO',  15000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-POWER-GOLD-RUSH-500',  'POWER GOLD RUSH 500 ML',       10000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-DEL-VALLE-250',        'DEL VALLE CHICO BOTELLA 250 ML', 5000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-DEL-VALLE-FRESH-500',  'DEL VALLE FRESH BOTELLA 500 ML', 8000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-DEL-VALLE-FRESH-15L',  'DEL VALLE FRESH BOTELLA 1.5 LITRO', 15000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_jugos, 'REV-JUGO-ADES-1L',              'ADES 1 LITRO',                 14000, NULL);

  -- REVENTA — AGUAS
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_aguas, 'REV-AGUA-500', 'AGUA 500 ML',   4000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_aguas, 'REV-AGUA-1L',  'AGUA 1 LITRO',  6000, NULL);
  PERFORM enlodemari._upsert_producto_reventa(v_emp, v_aguas, 'REV-AGUA-2L',  'AGUA 2 LITROS', 8000, NULL);
END $$;
