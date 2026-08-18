-- Al aprobar NC SET: si el saldo queda ~0, marcar factura como Corregida NC siempre (excepto Anulado).
-- Antes: si la factura ya estaba "Pagado", permanecía "Pagado" y los reportes sumaban el monto bruto + la nueva factura.

CREATE OR REPLACE FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(
  p_data_schema text,
  p_nota_credito_id uuid,
  p_factura_id uuid,
  p_empresa_id uuid,
  p_monto numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  s text := btrim(p_data_schema);
  fq text := quote_ident(btrim(p_data_schema));
  saldo_act numeric;
  otra uuid;
BEGIN
  IF s IS NULL OR s = '' THEN
    RAISE EXCEPTION 'nota_credito_aplicar_aprobacion_set: schema vacío';
  END IF;

  EXECUTE format(
    'SELECT id FROM %s.nota_credito
     WHERE factura_id = $1 AND empresa_id = $2 AND estado_erp = ''aprobada'' AND id <> $3
     LIMIT 1',
    fq
  ) INTO otra USING p_factura_id, p_empresa_id, p_nota_credito_id;
  IF otra IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe otra nota de crédito aprobada para esta factura';
  END IF;

  EXECUTE format(
    'SELECT saldo FROM %s.facturas WHERE id = $1 AND empresa_id = $2 FOR UPDATE',
    fq
  ) INTO saldo_act USING p_factura_id, p_empresa_id;

  IF saldo_act IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF p_monto > saldo_act + 0.02 THEN
    RAISE EXCEPTION 'El monto de la NC (%) supera el saldo pendiente (%)', p_monto, saldo_act;
  END IF;

  EXECUTE format(
    'UPDATE %s.facturas SET
       saldo = GREATEST(0::numeric, saldo - $1),
       estado = CASE
         WHEN estado = ''Anulado'' THEN ''Anulado''
         WHEN GREATEST(0::numeric, saldo - $1) <= 0.0001 THEN ''Corregida NC''
         ELSE estado
       END,
       updated_at = now()
     WHERE id = $2 AND empresa_id = $3',
    fq
  ) USING p_monto, p_factura_id, p_empresa_id;

  EXECUTE format(
    'UPDATE %s.nota_credito SET estado_erp = ''aprobada'', updated_at = now()
     WHERE id = $1 AND empresa_id = $2 AND estado_erp <> ''anulada_borrador''',
    fq
  ) USING p_nota_credito_id, p_empresa_id;
END;
$$;

COMMENT ON FUNCTION zentra_erp.nota_credito_aplicar_aprobacion_set(text, uuid, uuid, uuid, numeric) IS
  'Resta NC del saldo; si queda en ~0 (salvo Anulado), estado Corregida NC (incluye factura previamente Pagado).';

-- Backfill: Pagado + saldo ~0 + NC aprobada → Corregida NC (reportes / dashboard ya netean por NC; esto alinea estado).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT btrim(e.data_schema) AS ds
    FROM zentra_erp.empresas e
    WHERE e.data_schema IS NOT NULL
      AND btrim(e.data_schema) <> ''
      AND btrim(e.data_schema) <> 'zentra_erp'
      AND btrim(e.data_schema) ~ '^erp_[a-z0-9_]+$'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = r.ds AND table_name = 'nota_credito'
    ) THEN
      EXECUTE format(
        'UPDATE %I.facturas f SET estado = ''Corregida NC'', updated_at = now()
         WHERE f.saldo <= 0.0001 AND f.estado = ''Pagado''
           AND EXISTS (
             SELECT 1 FROM %I.nota_credito nc
             WHERE nc.factura_id = f.id AND nc.empresa_id = f.empresa_id
               AND nc.estado_erp = ''aprobada''
           )',
        r.ds,
        r.ds
      );
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
