-- Papu_store / combos_populares: únicamente group_title y group_order por sort_order (1–3)
-- cuando el catálogo real no coincide con cantidades fijas en la migración anterior.
--
-- IMPORTANTE (producto): NO se modifica chat_flow_options.next_node_code aquí.
-- El destino de cada botón lo define el usuario en el editor (next_node_code por opción).
-- Idempotente: re-ejecutar restablece títulos/orden de grupo esperados.

CREATE OR REPLACE FUNCTION pg_temp.neura_papu_groups_by_sort(schema_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format(
    'UPDATE %I.chat_flow_options o
       SET group_title = CASE o.sort_order
           WHEN 1 THEN ''Opción estándar''
           WHEN 2 THEN ''Combos populares''
           WHEN 3 THEN ''Aumentá tus Chances''
           ELSE o.group_title
         END,
         group_order = CASE o.sort_order
           WHEN 1 THEN 2
           WHEN 2 THEN 0
           WHEN 3 THEN 1
           ELSE o.group_order
         END
     FROM %I.chat_flow_nodes n
     WHERE o.node_id = n.id
       AND n.flow_code = ''Papu_store''
       AND n.node_code = ''combos_populares''
       AND o.sort_order IN (1, 2, 3)',
    schema_name,
    schema_name
  );
END;
$$;

DO $$
DECLARE
  sch text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'zentra_erp' AND table_name = 'chat_flow_nodes'
  ) THEN
    PERFORM pg_temp.neura_papu_groups_by_sort('zentra_erp');
  END IF;

  FOR sch IN
    SELECT n.nspname
    FROM pg_namespace n
    JOIN pg_class c ON c.relnamespace = n.oid
    WHERE c.relkind = 'r'
      AND c.relname = 'chat_flow_nodes'
      AND (
        n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname ~ '^erp_[a-zA-Z0-9_]+$'
      )
  LOOP
    PERFORM pg_temp.neura_papu_groups_by_sort(sch);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS pg_temp.neura_papu_groups_by_sort(text);
