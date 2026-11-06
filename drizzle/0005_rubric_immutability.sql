-- Versões de rubrica publicadas são imutáveis (garantia no banco, não só na aplicação).
-- Exclusões em cascata (ex.: exclusão da empresa) continuam permitidas: pg_trigger_depth() > 1.
CREATE OR REPLACE FUNCTION guard_rubric_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'versão de rubrica publicada não pode ser excluída' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'archived'
     AND (NEW.scale_min, NEW.scale_max, NEW.thresholds, NEW.min_coverage, NEW.evaluator_guidance, NEW.content_hash, NEW.version, NEW.rubric_id)
       IS NOT DISTINCT FROM
         (OLD.scale_min, OLD.scale_max, OLD.thresholds, OLD.min_coverage, OLD.evaluator_guidance, OLD.content_hash, OLD.version, OLD.rubric_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'versão de rubrica publicada é imutável' USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER rubric_versions_immutable BEFORE UPDATE OR DELETE ON rubric_versions
  FOR EACH ROW EXECUTE FUNCTION guard_rubric_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_criteria() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status rubric_version_status;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO v_status FROM rubric_versions WHERE id = COALESCE(NEW.rubric_version_id, OLD.rubric_version_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'critérios de versão publicada são imutáveis' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rubric_version_id <> OLD.rubric_version_id THEN
    RAISE EXCEPTION 'critério não pode mudar de versão' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER criteria_immutable BEFORE INSERT OR UPDATE OR DELETE ON criteria
  FOR EACH ROW EXECUTE FUNCTION guard_criteria();
