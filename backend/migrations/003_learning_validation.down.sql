DROP TRIGGER curated_valid ON learning.curated_example;
DROP TRIGGER original_valid ON learning.original_submission;
DROP FUNCTION learning.validate_payload_row();
DROP FUNCTION learning.valid_product(jsonb);
DROP FUNCTION learning.nonblank_text(text);
DROP FUNCTION learning.source_ids(jsonb,jsonb,boolean);
DROP FUNCTION learning.code_array(jsonb,integer);
DROP FUNCTION learning.uuid_text(jsonb);
DROP FUNCTION learning.object_keys(jsonb,text[],text[]);
