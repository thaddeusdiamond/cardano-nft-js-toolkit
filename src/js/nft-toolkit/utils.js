export function validate(assertion, error) {
  if (!assertion) {
    throw error;
  }
}

export function validated(assertion, error) {
  validate(assertion, error);
  return assertion;
}
