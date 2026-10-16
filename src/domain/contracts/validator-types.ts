/** Runtime shape of one precompiled Ajv validator. */
export interface ContractIssue {
  readonly instancePath: string;
  readonly schemaPath?: string;
  readonly keyword?: string;
  readonly message?: string;
}

export interface ContractValidator {
  (data: unknown): boolean;
  errors?: readonly ContractIssue[] | null;
}

export function validatorByName(
  validators: object,
  schema: string,
): ContractValidator {
  if (!Object.hasOwn(validators, schema)) {
    throw new Error(`No contract validator for ${schema}.`);
  }
  // The generated maps only store ContractValidator functions.
  const candidate: unknown = Reflect.get(validators, schema);
  if (typeof candidate !== 'function') {
    throw new Error(`Contract validator for ${schema} is missing.`);
  }
  return candidate as ContractValidator;
}

export function validationDetail(validator: ContractValidator): string {
  const errors = validator.errors ?? [];
  if (errors.length === 0) {
    return 'rejected';
  }
  return errors
    .map((error) => `${error.instancePath || '/'} ${error.message ?? error.keyword ?? 'invalid'}`)
    .join('; ');
}
