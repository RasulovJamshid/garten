const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/** All `{var}` placeholder names referenced in a template body, deduped. */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * A typo'd `{amout}` must fail on save, not silently render as literal
 * text to 300 parents (05-telegram-spec.md §5) — every placeholder used in
 * either language body must be declared in `variables[]`.
 */
export function validateTemplateVariables(
  bodyUz: string,
  bodyRu: string,
  variables: string[],
): void {
  const declared = new Set(variables);
  const undeclared = new Set<string>();
  for (const v of [...extractVariables(bodyUz), ...extractVariables(bodyRu)]) {
    if (!declared.has(v)) undeclared.add(v);
  }
  if (undeclared.size > 0) {
    throw new Error(
      `Template references undeclared variable(s): ${[...undeclared].join(', ')}. ` +
        `Add them to variables[] or fix the typo.`,
    );
  }
}

/**
 * Renders `{var}` placeholders from `data`. Throws rather than emitting a
 * broken message with a literal `{amount}` in it if a declared variable is
 * missing at send time — a malformed notification is worse than a delayed
 * one.
 */
export function renderTemplate(body: string, data: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (whole, name: string) => {
    if (!(name in data)) {
      throw new Error(`Missing value for template variable "{${name}}"`);
    }
    return data[name];
  });
}
