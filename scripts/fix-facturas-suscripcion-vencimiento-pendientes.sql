-- =============================================================================
-- Corrección SEGURA: solo facturas tipo suscripción, estado Pendiente, saldo > 0
-- =============================================================================
-- NO toca facturas Pagadas / Anuladas / con saldo 0.
-- Reemplazá zentra_erp por el schema tenant (erp_*) si aplica.
--
-- Recomendación: ejecutar primero la sección C de audit-facturas-suscripcion-vencimiento.sql
-- (mismas CTE + filtros pendientes) en un SELECT y revisar filas.
-- =============================================================================

BEGIN;

WITH base AS (
  SELECT
    f.id,
    f.fecha::date AS fe,
    f.fecha_vencimiento::date AS fv_guardada,
    GREATEST(1, LEAST(COALESCE(s.dia_vencimiento, 10), 31))::int AS dia_v
  FROM zentra_erp.facturas f
  INNER JOIN zentra_erp.suscripciones s ON s.id = f.suscripcion_id
  WHERE lower(trim(f.tipo::text)) = 'suscripcion'
    AND f.suscripcion_id IS NOT NULL
    AND f.estado = 'Pendiente'
    AND f.saldo > 0
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
    make_date(c.y, c.mo, LEAST(GREATEST(c.dia_v, 1), c.dim_mes_emision)) AS cand_mismo_mes
  FROM cand c
),
cand3 AS (
  SELECT c2.*, (c2.cand_mismo_mes >= c2.fe) AS cabe_en_mes_emision
  FROM cand2 c2
),
sig AS (
  SELECT
    c3.id,
    c3.fv_guardada,
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
),
final AS (
  SELECT id, fv_esperada
  FROM sig
  WHERE fv_guardada IS DISTINCT FROM fv_esperada
)
UPDATE zentra_erp.facturas f
SET
  fecha_vencimiento = final.fv_esperada,
  updated_at = now()
FROM final
WHERE f.id = final.id;

-- Si el conteo no coincide con lo esperado: ROLLBACK;
COMMIT;
