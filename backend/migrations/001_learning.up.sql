-- ADR014 Option A, D173. Synthetic/local until separately released.
CREATE SCHEMA learning;

CREATE TABLE learning.record_registry (
    record_id uuid PRIMARY KEY,
    record_kind text NOT NULL CHECK (record_kind IN ('original','curated')),
    generation integer NOT NULL CHECK (generation >= 0),
    created_at timestamptz NOT NULL,
    tombstoned_at timestamptz,
    blocked_at timestamptz,
    UNIQUE (record_id, record_kind),
    UNIQUE (record_id, generation),
    CHECK ((record_kind = 'original' AND generation = 0) OR
        (record_kind = 'curated' AND generation > 0)),
    CHECK (blocked_at IS NULL OR blocked_at >= created_at),
    CHECK (tombstoned_at IS NULL OR tombstoned_at >= created_at)
);

CREATE TABLE learning.original_submission (
    record_id uuid PRIMARY KEY,
    record_kind text NOT NULL DEFAULT 'original' CHECK (record_kind = 'original'),
    received_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (record_id, record_kind)
        REFERENCES learning.record_registry (record_id, record_kind),
    CHECK (expires_at - received_at = interval '2160 hours'),
    barcode text CHECK (barcode ~ '^(?:[0-9]{8}|[0-9]{12,14})$'),
    product_name text CHECK (char_length(product_name) <= 500),
    market text NOT NULL CHECK (market IN ('IN', 'EU', 'unknown')),
    ingredients_text text CHECK (char_length(ingredients_text) <= 20000),
    ingredients_status text NOT NULL
        CHECK (ingredients_status IN ('complete','partial','missing','unreadable')),
    declared_category text CHECK (declared_category IN
        ('general','fats_nuts_seeds','beverage','excluded','unknown')),
    category text NOT NULL
        CHECK (category IN ('general','fats_nuts_seeds','beverage','excluded','unknown')),
    source_refs jsonb NOT NULL
        CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) <= 100),
    observations jsonb NOT NULL
        CHECK (jsonb_typeof(observations) = 'array' AND jsonb_array_length(observations) <= 100),
    scoring_facts jsonb CHECK (scoring_facts IS NULL OR (
        jsonb_typeof(scoring_facts) = 'object' AND
        scoring_facts ?& ARRAY['category_source_ids','cheese','redMeat','plainWater','nonNutritiveSweetener'] AND
        scoring_facts - ARRAY['category_source_ids','cheese','redMeat','plainWater','nonNutritiveSweetener'] = '{}'::jsonb)),
    CHECK (category = 'unknown' OR COALESCE(
        jsonb_typeof(scoring_facts -> 'category_source_ids') = 'array' AND
        jsonb_array_length(scoring_facts -> 'category_source_ids') > 0, false)),
    issue_codes jsonb NOT NULL
        CHECK (jsonb_typeof(issue_codes) = 'array' AND jsonb_array_length(issue_codes) <= 100),
    versions jsonb NOT NULL CHECK (jsonb_typeof(versions) = 'object'),
    storage_schema_version smallint NOT NULL CHECK (storage_schema_version = 1),
    CHECK (ingredients_status <> 'complete' OR
        (ingredients_text IS NOT NULL AND length(btrim(ingredients_text)) > 0)),
    CHECK (octet_length(source_refs::text) + octet_length(observations::text) +
        COALESCE(octet_length(scoring_facts::text), 0) + octet_length(issue_codes::text) +
        octet_length(versions::text) <= 524288)
);
CREATE INDEX original_due ON learning.original_submission (expires_at, record_id);
CREATE INDEX original_source_lookup ON learning.original_submission USING gin (source_refs jsonb_path_ops);
CREATE INDEX original_barcode_lookup ON learning.original_submission (barcode);

CREATE TABLE learning.curated_example (
    record_id uuid PRIMARY KEY,
    record_kind text NOT NULL DEFAULT 'curated' CHECK (record_kind = 'curated'),
    reviewed_at timestamptz NOT NULL,
    next_review_at timestamptz NOT NULL,
    review_protocol_version text NOT NULL
        CHECK (char_length(review_protocol_version) BETWEEN 1 AND 160),
    review_scope text NOT NULL
        CHECK (review_scope IN ('product_facts','training_example','correction_pair')),
    rights_status text NOT NULL
        CHECK (rights_status IN ('eligible','withdrawn','deletion_pending')),
    correction_before jsonb CHECK (correction_before IS NULL OR (
        jsonb_typeof(correction_before) = 'object' AND
        octet_length(correction_before::text) <= 524288)),
    CHECK ((review_scope = 'correction_pair') = (correction_before IS NOT NULL)),
    FOREIGN KEY (record_id, record_kind)
        REFERENCES learning.record_registry (record_id, record_kind),
    CHECK (next_review_at =
        (((reviewed_at AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC')),
    barcode text CHECK (barcode ~ '^(?:[0-9]{8}|[0-9]{12,14})$'),
    product_name text CHECK (char_length(product_name) <= 500),
    market text NOT NULL CHECK (market IN ('IN', 'EU', 'unknown')),
    ingredients_text text CHECK (char_length(ingredients_text) <= 20000),
    ingredients_status text NOT NULL
        CHECK (ingredients_status IN ('complete','partial','missing','unreadable')),
    declared_category text CHECK (declared_category IN
        ('general','fats_nuts_seeds','beverage','excluded','unknown')),
    category text NOT NULL
        CHECK (category IN ('general','fats_nuts_seeds','beverage','excluded','unknown')),
    source_refs jsonb NOT NULL
        CHECK (jsonb_typeof(source_refs) = 'array' AND jsonb_array_length(source_refs) <= 100),
    observations jsonb NOT NULL
        CHECK (jsonb_typeof(observations) = 'array' AND jsonb_array_length(observations) <= 100),
    scoring_facts jsonb CHECK (scoring_facts IS NULL OR (
        jsonb_typeof(scoring_facts) = 'object' AND
        scoring_facts ?& ARRAY['category_source_ids','cheese','redMeat','plainWater','nonNutritiveSweetener'] AND
        scoring_facts - ARRAY['category_source_ids','cheese','redMeat','plainWater','nonNutritiveSweetener'] = '{}'::jsonb)),
    CHECK (category = 'unknown' OR COALESCE(
        jsonb_typeof(scoring_facts -> 'category_source_ids') = 'array' AND
        jsonb_array_length(scoring_facts -> 'category_source_ids') > 0, false)),
    issue_codes jsonb NOT NULL
        CHECK (jsonb_typeof(issue_codes) = 'array' AND jsonb_array_length(issue_codes) <= 100),
    versions jsonb NOT NULL CHECK (jsonb_typeof(versions) = 'object'),
    storage_schema_version smallint NOT NULL CHECK (storage_schema_version = 1),
    CHECK (ingredients_status <> 'complete' OR
        (ingredients_text IS NOT NULL AND length(btrim(ingredients_text)) > 0)),
    CHECK (octet_length(source_refs::text) + octet_length(observations::text) +
        COALESCE(octet_length(scoring_facts::text), 0) + octet_length(issue_codes::text) +
        octet_length(versions::text) <= 524288)
);
CREATE INDEX curated_review_due ON learning.curated_example (next_review_at, record_id);
CREATE INDEX curated_source_lookup ON learning.curated_example USING gin (source_refs jsonb_path_ops);
CREATE INDEX curated_before_source_lookup ON learning.curated_example USING gin ((correction_before -> 'source_refs') jsonb_path_ops);
CREATE INDEX curated_barcode_lookup ON learning.curated_example (barcode);

CREATE TABLE learning.curation_link (
    curated_id uuid NOT NULL,
    curated_kind text NOT NULL DEFAULT 'curated' CHECK (curated_kind = 'curated'),
    child_generation integer NOT NULL,
    source_record_id uuid NOT NULL,
    source_generation integer NOT NULL,
    derivation_kind text NOT NULL CHECK (derivation_kind IN ('curation','correction','revision')),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (curated_id, source_record_id),
    FOREIGN KEY (curated_id, curated_kind)
        REFERENCES learning.record_registry (record_id, record_kind),
    FOREIGN KEY (curated_id, child_generation)
        REFERENCES learning.record_registry (record_id, generation),
    FOREIGN KEY (source_record_id, source_generation)
        REFERENCES learning.record_registry (record_id, generation),
    CHECK (child_generation > source_generation)
);
CREATE INDEX curation_descendants ON learning.curation_link (source_record_id);

CREATE TABLE learning.artifact (
    artifact_id uuid PRIMARY KEY,
    artifact_kind text NOT NULL CHECK (artifact_kind IN ('dataset','model','export')),
    generation integer NOT NULL CHECK (generation >= 0),
    version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 160),
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    state text NOT NULL CHECK (state IN ('draft','approved','blocked','retired','deleted')),
    created_at timestamptz NOT NULL,
    approved_at timestamptz,
    deleted_at timestamptz,
    storage_object_id uuid NOT NULL UNIQUE,
    UNIQUE (artifact_id, artifact_kind),
    UNIQUE (artifact_id, generation),
    CHECK (state <> 'approved' OR approved_at IS NOT NULL),
    CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
    CHECK (approved_at IS NULL OR approved_at >= created_at),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE learning.artifact_member (
    artifact_id uuid NOT NULL,
    artifact_kind text NOT NULL CHECK (artifact_kind IN ('dataset','export')),
    curated_id uuid NOT NULL,
    record_kind text NOT NULL DEFAULT 'curated' CHECK (record_kind = 'curated'),
    PRIMARY KEY (artifact_id, curated_id),
    FOREIGN KEY (artifact_id, artifact_kind)
        REFERENCES learning.artifact (artifact_id, artifact_kind),
    FOREIGN KEY (curated_id, record_kind)
        REFERENCES learning.record_registry (record_id, record_kind)
);
CREATE INDEX artifact_by_example ON learning.artifact_member (curated_id);

CREATE TABLE learning.artifact_dependency (
    artifact_id uuid NOT NULL,
    child_generation integer NOT NULL,
    input_artifact_id uuid NOT NULL,
    input_generation integer NOT NULL,
    PRIMARY KEY (artifact_id, input_artifact_id),
    FOREIGN KEY (artifact_id, child_generation)
        REFERENCES learning.artifact (artifact_id, generation),
    FOREIGN KEY (input_artifact_id, input_generation)
        REFERENCES learning.artifact (artifact_id, generation),
    CHECK (child_generation > input_generation)
);
CREATE INDEX artifact_descendants ON learning.artifact_dependency (input_artifact_id);

CREATE TABLE learning.backup_inventory (
    backup_id uuid PRIMARY KEY,
    backup_kind text NOT NULL CHECK (backup_kind IN ('neon_history','manual_dump','restore_branch')),
    provider_reference text NOT NULL CHECK (provider_reference ~ '^[A-Za-z0-9_-]{1,160}$'),
    observed_at timestamptz NOT NULL,
    covers_from timestamptz NOT NULL,
    covers_through timestamptz NOT NULL,
    originals_included boolean NOT NULL,
    earliest_original_expiry timestamptz,
    delete_by timestamptz,
    unrecoverable_verified_at timestamptz,
    state text NOT NULL CHECK (state IN ('present','deletion_pending','verified_unrecoverable')),
    ledger_checkpoint_sha256 text CHECK (ledger_checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
    CHECK (covers_from <= covers_through AND covers_through <= observed_at),
    CHECK (originals_included = (earliest_original_expiry IS NOT NULL)),
    CHECK (NOT originals_included OR backup_kind <> 'manual_dump' OR
        (delete_by IS NOT NULL AND delete_by <= earliest_original_expiry)),
    CHECK ((state = 'verified_unrecoverable') = (unrecoverable_verified_at IS NOT NULL)),
    CHECK (unrecoverable_verified_at IS NULL OR unrecoverable_verified_at >= observed_at)
);

CREATE TABLE learning.deletion_job (
    deletion_id uuid PRIMARY KEY,
    record_id uuid,
    record_kind text CHECK (record_kind IN ('original','curated')),
    artifact_id uuid REFERENCES learning.artifact (artifact_id),
    source_selector jsonb CHECK (source_selector IS NULL OR (
        jsonb_typeof(source_selector) = 'object' AND
        source_selector ?& ARRAY['kind','rights_reference'] AND
        source_selector - ARRAY['kind','rights_reference','title','edition'] = '{}'::jsonb)),
    backup_id uuid REFERENCES learning.backup_inventory (backup_id),
    propagate boolean NOT NULL,
    rescinded_at timestamptz,
    rescind_reason text CHECK (rescind_reason IN ('scope_corrected','source_reauthorised')),
    reason text NOT NULL CHECK (reason IN
        ('expiry','rights_withdrawal','correction','explicit_request','invalid_content','no_longer_needed')),
    state text NOT NULL CHECK (state IN ('queued','running','blocked','verified')),
    requested_at timestamptz NOT NULL,
    completed_at timestamptz,
    last_error_code text CHECK (last_error_code IN
        ('artifact_unavailable','backup_window_open','ledger_unavailable','database_retry','review_required')),
    ledger_checkpoint_sha256 text CHECK (ledger_checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
    FOREIGN KEY (record_id, record_kind)
        REFERENCES learning.record_registry (record_id, record_kind),
    CHECK (num_nonnulls(record_id, artifact_id, source_selector, backup_id) = 1),
    CHECK ((record_id IS NULL) = (record_kind IS NULL)),
    CHECK (reason <> 'expiry' OR (record_id IS NOT NULL AND record_kind = 'original')),
    CHECK (CASE
        WHEN backup_id IS NOT NULL THEN NOT propagate
        WHEN record_id IS NOT NULL AND record_kind = 'original'
             AND reason IN ('expiry','no_longer_needed') THEN NOT propagate
        ELSE propagate END),
    CHECK ((rescinded_at IS NULL) = (rescind_reason IS NULL)),
    CHECK (rescinded_at IS NULL OR rescinded_at >= requested_at),
    CHECK ((state = 'verified') = (completed_at IS NOT NULL)),
    CHECK (completed_at IS NULL OR completed_at >= requested_at),
    CHECK (state <> 'verified' OR ledger_checkpoint_sha256 IS NOT NULL)
);
CREATE INDEX deletion_pending ON learning.deletion_job (state, requested_at, deletion_id);

CREATE INDEX source_revocations ON learning.deletion_job USING gin (source_selector jsonb_path_ops) WHERE source_selector IS NOT NULL;
