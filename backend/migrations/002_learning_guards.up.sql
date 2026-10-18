-- No grants to runtime roles. Only the exclusive trusted writer may perform DML.
REVOKE ALL ON SCHEMA learning FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA learning FROM PUBLIC;

CREATE FUNCTION learning.source_matches(sources jsonb, selector jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(sources) s
        WHERE s->>'kind'=selector->>'kind'
        AND s->>'rights_reference'=selector->>'rights_reference'
        AND (NOT selector ? 'title' OR s->>'title'=selector->>'title')
        AND (NOT selector ? 'edition' OR NOT s ? 'edition'
             OR s->>'edition'=selector->>'edition'))
$$;

CREATE FUNCTION learning.immutable_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.record_id, NEW.record_kind, NEW.generation, NEW.created_at)
       IS DISTINCT FROM
       (OLD.record_id, OLD.record_kind, OLD.generation, OLD.created_at) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_registry';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER registry_immutable BEFORE UPDATE ON learning.record_registry
FOR EACH ROW EXECUTE FUNCTION learning.immutable_record();

CREATE FUNCTION learning.immutable_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'original_submission' OR
       (to_jsonb(NEW) - ARRAY['reviewed_at','next_review_at','rights_status'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['reviewed_at','next_review_at','rights_status']) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_payload';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER original_immutable BEFORE UPDATE ON learning.original_submission
FOR EACH ROW EXECUTE FUNCTION learning.immutable_payload();
CREATE TRIGGER curated_immutable BEFORE UPDATE ON learning.curated_example
FOR EACH ROW EXECUTE FUNCTION learning.immutable_payload();

CREATE FUNCTION learning.immutable_artifact_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.artifact_id,NEW.generation) IS DISTINCT FROM
       (OLD.artifact_id,OLD.generation) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_artifact';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER artifact_immutable BEFORE UPDATE ON learning.artifact
FOR EACH ROW EXECUTE FUNCTION learning.immutable_artifact_generation();

CREATE FUNCTION learning.original_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM learning.record_registry r
        WHERE r.record_id=NEW.record_id AND r.created_at=NEW.received_at) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='receipt_mismatch';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER original_receipt BEFORE INSERT ON learning.original_submission
FOR EACH ROW EXECUTE FUNCTION learning.original_receipt();
