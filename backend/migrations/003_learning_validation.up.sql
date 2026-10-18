-- Recheck the format at the database boundary, including administrative writers.
CREATE FUNCTION learning.object_keys(value jsonb, required text[], optional text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_typeof(value)='object' AND value ?& required
        AND value - (required || optional) = '{}'::jsonb, false)
$$;

CREATE FUNCTION learning.uuid_text(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_typeof(value)='string' AND value #>> '{}' ~
        '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$$;

CREATE FUNCTION learning.code_array(value jsonb, cap integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    RETURN jsonb_array_length(value)<=cap AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(value) v WHERE jsonb_typeof(v)<>'string'
        OR NOT (v #>> '{}' ~ '^[a-z][a-z0-9_.]{0,79}$'));
END $$;

CREATE FUNCTION learning.source_ids(value jsonb, defined jsonb, required boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    RETURN jsonb_array_length(value) BETWEEN (CASE WHEN required THEN 1 ELSE 0 END) AND 100
        AND (SELECT count(*)=count(DISTINCT v) FROM jsonb_array_elements(value) v)
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value) v
            WHERE NOT learning.uuid_text(v) OR NOT defined @> jsonb_build_array(v));
END $$;

-- Match Python 3.14 str.strip, including tabs/newlines and Unicode whitespace.
CREATE FUNCTION learning.nonblank_text(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(length(btrim(value, U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'))>0,false)
$$;

CREATE FUNCTION learning.valid_product(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    s jsonb; o jsonb; f jsonb; v jsonb; item jsonb; k text;
    defined jsonb := '[]'::jsonb;
    seen jsonb := '[]'::jsonb;
    known boolean;
    expected text;
    fact_names text[] := ARRAY['cheese','redMeat','plainWater','nonNutritiveSweetener'];
BEGIN
    IF NOT learning.object_keys(p, ARRAY['barcode','product_name','market',
        'ingredients_text','ingredients_status','declared_category','category',
        'source_refs','observations','scoring_facts','issue_codes','versions'], ARRAY[]::text[])
        OR octet_length(p::text)>524288 THEN RETURN false; END IF;
    FOREACH k IN ARRAY ARRAY['market','category','ingredients_status'] LOOP
        IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    END LOOP;
    IF jsonb_typeof(p->'market') <> 'string' OR p->>'market' NOT IN ('IN','EU','unknown')
        OR p->>'category' NOT IN ('general','fats_nuts_seeds','beverage','excluded','unknown')
        OR p->>'ingredients_status' NOT IN ('complete','partial','missing','unreadable')
        OR NOT learning.code_array(p->'issue_codes',100) THEN RETURN false; END IF;
    IF jsonb_typeof(p->'barcode')<>'null' AND (jsonb_typeof(p->'barcode')<>'string'
        OR NOT (p->>'barcode' ~ '^(?:[0-9]{8}|[0-9]{12,14})$')) THEN RETURN false; END IF;
    IF jsonb_typeof(p->'product_name')<>'null' AND (jsonb_typeof(p->'product_name')<>'string'
        OR char_length(p->>'product_name')>500) THEN RETURN false; END IF;
    IF jsonb_typeof(p->'ingredients_text')<>'null' AND (jsonb_typeof(p->'ingredients_text')<>'string'
        OR char_length(p->>'ingredients_text')>20000) THEN RETURN false; END IF;
    IF p->>'ingredients_status'='complete' AND
        (jsonb_typeof(p->'ingredients_text')<>'string' OR NOT learning.nonblank_text(p->>'ingredients_text'))
        THEN RETURN false; END IF;
    IF jsonb_typeof(p->'declared_category')<>'null' AND p->>'declared_category' NOT IN
        ('general','fats_nuts_seeds','beverage','excluded','unknown') THEN RETURN false; END IF;
    IF jsonb_typeof(p->'source_refs') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p->'observations') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p->'source_refs')>100 OR jsonb_array_length(p->'observations')>100
        THEN RETURN false; END IF;
    FOR s IN SELECT * FROM jsonb_array_elements(p->'source_refs') LOOP
        FOREACH k IN ARRAY ARRAY['kind','title','rights_state'] LOOP
            IF jsonb_typeof(s->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
        END LOOP;
        IF NOT learning.object_keys(s, ARRAY['source_id','kind','title','rights_state'],
            ARRAY['edition','rights_reference']) OR NOT learning.uuid_text(s->'source_id')
            OR defined @> jsonb_build_array(s->'source_id')
            OR s->>'kind' NOT IN ('label','off','user_correction')
            OR s->>'title' NOT IN ('Ingredient panel','Nutrition panel','Combined label photo',
                'Open Food Facts product','User correction')
            OR s->>'rights_state' NOT IN ('unreviewed','eligible','restricted','withdrawn')
            THEN RETURN false; END IF;
        IF (s ? 'rights_reference' OR s->>'kind'='off') AND
            NOT learning.uuid_text(s->'rights_reference') THEN RETURN false; END IF;
        IF s ? 'edition' AND (jsonb_typeof(s->'edition')<>'string' OR NOT (s->>'edition' ~
            '^(?:rev-[0-9]{1,9}|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$'))
            THEN RETURN false; END IF;
        defined := defined || jsonb_build_array(s->'source_id');
    END LOOP;
    FOR o IN SELECT * FROM jsonb_array_elements(p->'observations') LOOP
        FOREACH k IN ARRAY ARRAY['field','kind'] LOOP
            IF jsonb_typeof(o->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
        END LOOP;
        IF NOT learning.uuid_text(o->'observation_id') OR seen @> jsonb_build_array(o->'observation_id')
            OR o->>'field' NOT IN ('energy','sugars','added_sugars','saturates','salt','sodium',
                'protein','fibre','fat','fvl') OR NOT learning.code_array(o->'issue_codes',100)
            OR NOT learning.code_array(o->'derivation_codes',12) THEN RETURN false; END IF;
        seen := seen || jsonb_build_array(o->'observation_id');
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(o->'derivation_codes') d
            WHERE d NOT IN ('declared','kcal_to_kj','sodium_to_salt','serving_conversion',
                'manual_correction','unsupported')) THEN RETURN false; END IF;
        IF o->>'kind'='missing' THEN
            IF jsonb_typeof(o->'reason') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
            IF NOT learning.object_keys(o, ARRAY['observation_id','field','kind','reason',
                'issue_codes','derivation_codes'], ARRAY[]::text[]) OR o->>'reason' NOT IN
                ('not_declared','unreadable','ambiguous','unsupported_basis',
                 'conflicting_sources','not_available') THEN RETURN false; END IF;
        ELSE
            IF NOT learning.object_keys(o, ARRAY['observation_id','field','kind','value','unit',
                'basis','source_ids','issue_codes','derivation_codes'],ARRAY['previous_source_ids'])
                OR o->>'kind' NOT IN ('read','uncertain','corrected')
                OR jsonb_typeof(o->'value')<>'number' THEN RETURN false; END IF;
            PERFORM (o->>'value')::float8;
            IF jsonb_typeof(o->'basis') IS DISTINCT FROM 'string'
                OR jsonb_typeof(o->'unit') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
            expected := CASE o->>'field' WHEN 'energy' THEN 'kJ' WHEN 'fvl' THEN 'percent' ELSE 'g' END;
            IF (o->>'value')::numeric<0 OR o->>'unit' IS DISTINCT FROM expected
                OR o->>'basis' NOT IN ('per_100_g','per_100_ml','per_serving')
                OR NOT learning.source_ids(o->'source_ids',defined,true)
                OR ((o->>'kind'='corrected') <> (o ? 'previous_source_ids'))
                OR (o->>'kind'='uncertain' AND jsonb_array_length(o->'issue_codes')=0)
                THEN RETURN false; END IF;
            IF o ? 'previous_source_ids' AND NOT
                learning.source_ids(o->'previous_source_ids',defined,true) THEN RETURN false; END IF;
        END IF;
    END LOOP;
    f := p->'scoring_facts';
    IF jsonb_typeof(f)='null' THEN
        IF p->>'category'<>'unknown' THEN RETURN false; END IF;
    ELSE
        IF NOT learning.object_keys(f, ARRAY['category_source_ids'] || fact_names, ARRAY[]::text[])
            OR NOT learning.source_ids(f->'category_source_ids',defined,p->>'category'<>'unknown')
            OR (p->>'category'='unknown' AND jsonb_array_length(f->'category_source_ids')<>0)
            THEN RETURN false; END IF;
        FOREACH k IN ARRAY fact_names LOOP
            item := f->k;
            known := item->>'state' IN ('present','absent');
            IF known THEN
                IF NOT learning.object_keys(item,ARRAY['state','source_ids'],ARRAY[]::text[])
                    OR NOT learning.source_ids(item->'source_ids',defined,true) THEN RETURN false; END IF;
            ELSE
                IF NOT learning.object_keys(item,ARRAY['state'],ARRAY[]::text[])
                    OR item->>'state' IS DISTINCT FROM 'unknown' THEN RETURN false; END IF;
            END IF;
        END LOOP;
        IF f->'plainWater'->>'state'='present' AND
            (f->'cheese'->>'state'='present' OR f->'redMeat'->>'state'='present'
             OR f->'nonNutritiveSweetener'->>'state'='present') THEN RETURN false; END IF;
        IF p->>'category' IN ('beverage','fats_nuts_seeds') AND
            (f->'cheese'->>'state'='present' OR f->'redMeat'->>'state'='present') THEN RETURN false; END IF;
        IF p->>'category' IN ('general','fats_nuts_seeds') AND
            f->'plainWater'->>'state'='present' THEN RETURN false; END IF;
    END IF;
    v := p->'versions';
    known := v->>'server_resource_state'='known';
    IF NOT learning.object_keys(v, ARRAY['ingestion_policy_version','contract_version',
        'server_resource_state','client_resource_status'] || CASE WHEN known THEN ARRAY[
        'method_id','method_edition','method_bundle_sha256','taxonomy_version','evidence_version']
        ELSE ARRAY[]::text[] END, ARRAY[]::text[]) OR v->>'contract_version'<>'0.3.0-draft'
        OR v->>'server_resource_state' NOT IN ('known','unavailable')
        OR v->>'client_resource_status' NOT IN ('match','mismatch','unavailable') THEN RETURN false; END IF;
    FOR k,item IN SELECT * FROM jsonb_each(v) LOOP
        IF jsonb_typeof(item)<>'string' OR char_length(item #>> '{}') NOT BETWEEN 1 AND 160
            THEN RETURN false; END IF;
    END LOOP;
    IF known AND NOT (v->>'method_bundle_sha256' ~ '^[a-f0-9]{64}$') THEN RETURN false; END IF;
    RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION learning.validate_payload_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    p jsonb;
BEGIN
    p := to_jsonb(NEW) - ARRAY['record_id','record_kind','received_at','expires_at',
        'reviewed_at','next_review_at','review_protocol_version','review_scope','rights_status',
        'correction_before','storage_schema_version'];
    IF NOT learning.valid_product(p) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='storage_invalid';
    END IF;
    IF TG_TABLE_NAME='curated_example' THEN
        IF NEW.correction_before IS NOT NULL THEN
            IF NOT learning.valid_product(NEW.correction_before) THEN
                RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='storage_invalid';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER original_valid BEFORE INSERT ON learning.original_submission
FOR EACH ROW EXECUTE FUNCTION learning.validate_payload_row();
CREATE TRIGGER curated_valid BEFORE INSERT ON learning.curated_example
FOR EACH ROW EXECUTE FUNCTION learning.validate_payload_row();
