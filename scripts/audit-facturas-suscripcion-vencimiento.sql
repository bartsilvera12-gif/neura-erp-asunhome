-- =============================================================================
-- Auditoría: facturas de suscripción con vencimiento potencialmente mal calculado
-- =============================================================================
-- Reemplazá el schema (ej. zentra_erp o erp_<uuid>) según el tenant.
-- Contexto: si `tipo` cayó en "credito" por error, fecha_vencimiento suele ser
-- emisión + ~30 días (calendario), no el día de vencimiento del ciclo mensual.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Suscripción declarada pero vencimiento "largo" (heurística > 35 días)
-- -----------------------------------------------------------------------------
SELECT
  f.id,
  f.empresa_id,
  f.cliente_id,
  f.suscripcion_id,
  f.numero_factura,
  f.fecha::date AS fecha_emision,
  f.fecha_vencimiento::date AS fecha_vencimiento_actual,
  (f.fecha_vencimiento::date - f.fecha::date) AS dias_emision_a_vencimiento,
  f.estado,
  f.saldo,
  f.tipo,
  s.dia_vencimiento,
  s.dia_facturacion
FROM zentra_erp.facturas f
INNER JOIN zentra_erp.suscripciones s ON s.id = f.suscripcion_id
WHERE lower(trim(f.tipo::text)) = 'suscripcion'
  AND f.suscripcion_id IS NOT NULL
  AND (f.fecha_vencimiento::date - f.fecha::date) > 35
ORDER BY f.fecha DESC;

-- -----------------------------------------------------------------------------
-- B) Tipo crédito pero con suscripcion_id (clasificación inconsistente)
-- -----------------------------------------------------------------------------
SELECT
  f.id,
  f.empresa_id,
  f.cliente_id,
  f.suscripcion_id,
  f.numero_factura,
  f.fecha::date,
  f.fecha_vencimiento::date,
  f.estado,
  f.saldo,
  f.tipo
FROM zentra_erp.facturas f
WHERE f.suscripcion_id IS NOT NULL
  AND lower(trim(f.tipo::text)) = 'credito'
ORDER BY f.fecha DESC;

-- -----------------------------------------------------------------------------
-- C) "Esperado" según regla mensual (misma idea que fechaVencimientoSuscripcion en TS)
--     Solo filas donde el guardado difiere del esperado (para revisión).
-- -----------------------------------------------------------------------------
WITH base AS (
  SELECT
    f.id,
    f.numero_factura,
    f.fecha::date AS fe,
    f.fecha_vencimiento::date AS fv_guardada,
    f.estado,
    f.saldo,
    GREATEST(1, LEAST(COALESCE(s.dia_vencimiento, 10), 31))::int AS dia_v
  FROM zentra_erp.facturas f
  INNER JOIN zentra_erp.suscripciones s ON s.id = f.suscripcion_id
  WHERE lower(trim(f.tipo::text)) = 'suscripcion'
    AND f.suscripcion_id IS NOT NULL
),
cand AS (
  SELECT
    b.*,
    EXTRACT(YEAR FROM b.fe)::int AS y,
    EXTRACT(MONTH FROM b.fe)::int AS mo,
    EXTRACT(
      DAY FROM ((date_trunc('month', b.fe::timestamp) + interval '1 month - 1 day')::date)
    )::int AS dim_mes_emision
  FROM base b
),
cand2 AS (
  SELECT
    c.*,
    LEAST(GREATEST(c.dia_v, 1), c.dim_mes_emision) AS dv,
    make_date(c.y, c.mo, LEAST(GREATEST(c.dia_v, 1), c.dim_mes_emision)) AS cand_mismo_mes
  FROM cand c
),
cand3 AS (
  SELECT
    c2.*,
    (c2.cand_mismo_mes >= c2.fe) AS cabe_en_mes_emision
  FROM cand2 c2
),
sig AS (
  SELECT
    c3.*,
    CASE
      WHEN c3.cabe_en_mes_emision THEN c3.cand_mismo_mes
      ELSE make_date(
        CASE WHEN c3.mo = 12 THEN c3.y + 1 ELSE c3.y END,
        CASE WHEN c3.mo = 12 THEN 1 ELSE c3.mo + 1 END,
        LEAST(
          GREATEST(c3.dia_v, 1),
          EXTRACT(
            DAY FROM (
              (
                make_date(
                  CASE WHEN c3.mo = 12 THEN c3.y + 1 ELSE c3.y END,
                  CASE WHEN c3.mo = 12 THEN 1 ELSE c3.mo + 1 END,
                  1
                ) + interval '1 month - 1 day'
              )::date
            )
          )::int
        )
      )
    END AS fv_esperada
  FROM cand3 c3
)
SELECT
  id,
  numero_factura,
  fe AS fecha_emision,
  fv_guardada AS fecha_vencimiento_en_bd,
  fv_esperada AS fecha_vencimiento_esperada_regla_mensual,
  estado,
  saldo,
  dia_v
FROM sig
WHERE fv_guardada IS DISTINCT FROM fv_esperada
ORDER BY fe DESC;
