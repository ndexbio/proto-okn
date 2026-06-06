/**
 * CX2 attributeDeclarations handling
 *
 * Per the CX2 v2 specification, the `attributeDeclarations` aspect declares, per
 * aspect (`nodes`, `edges`, `networkAttributes`), a map of
 *   fullName -> { d (data type), a? (alias), v? (default value) }
 *
 * Two rules drive how a node/edge attribute value is actually stored and read:
 *  - Alias: "If an alias is declared, the full attribute name can no longer be used
 *    in the nodes or edges data blocks; the alias must be used instead." Aliases are
 *    not permitted for networkAttributes.
 *  - Default: "If an element is missing this attribute, it will be automatically
 *    assigned the default value."
 *
 * This module parses the declarations and normalizes each element's `v` bag to
 * canonical full-name keys, so the rest of the converter can read stable names
 * (`represents`, `name`, `interaction`, ...) regardless of how a file was serialized.
 */

/**
 * A single attribute declaration: data type, optional alias, optional default.
 */
export interface AttributeDeclaration {
  d: string;          // data type (string | integer | double | boolean | long | list_of_*)
  a?: string;         // alias (short name the data block must use when present)
  v?: unknown;        // default value (materialized when an element omits the attribute)
}

/**
 * Declarations for one aspect, keyed by canonical full attribute name.
 */
export type AspectDeclarations = Record<string, AttributeDeclaration>;

/**
 * Parsed attributeDeclarations for the aspects the converter reads.
 */
export interface CX2Declarations {
  nodes: AspectDeclarations;
  edges: AspectDeclarations;
  networkAttributes: AspectDeclarations;
}

/**
 * Parse the `attributeDeclarations` aspect from a CX2 aspect array.
 *
 * The aspect is an array with (typically) a single object holding `nodes`,
 * `edges`, and `networkAttributes` declaration maps. Missing aspects yield empty
 * maps so callers can index without guarding.
 */
export function parseAttributeDeclarations(aspects: unknown[]): CX2Declarations {
  const empty: CX2Declarations = { nodes: {}, edges: {}, networkAttributes: {} };

  for (const aspect of aspects) {
    if (typeof aspect !== 'object' || aspect === null) {
      continue;
    }
    const aspectObj = aspect as Record<string, unknown>;
    if (!('attributeDeclarations' in aspectObj) || !Array.isArray(aspectObj.attributeDeclarations)) {
      continue;
    }

    const decl = aspectObj.attributeDeclarations[0];
    if (typeof decl !== 'object' || decl === null) {
      return empty;
    }

    const declObj = decl as Record<string, unknown>;
    return {
      nodes: toAspectDeclarations(declObj.nodes),
      edges: toAspectDeclarations(declObj.edges),
      networkAttributes: toAspectDeclarations(declObj.networkAttributes),
    };
  }

  return empty;
}

/**
 * Coerce a raw declaration map into AspectDeclarations, ignoring malformed entries.
 */
function toAspectDeclarations(raw: unknown): AspectDeclarations {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }

  const out: AspectDeclarations = {};
  for (const [fullName, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof spec !== 'object' || spec === null) {
      continue;
    }
    const specObj = spec as Record<string, unknown>;
    const declaration: AttributeDeclaration = {
      d: typeof specObj.d === 'string' ? specObj.d : 'string',
    };
    if (typeof specObj.a === 'string') {
      declaration.a = specObj.a;
    }
    if ('v' in specObj) {
      declaration.v = specObj.v;
    }
    out[fullName] = declaration;
  }
  return out;
}

/**
 * Normalize one element's `v` attribute bag to canonical full-name keys.
 *
 * For each declared attribute:
 *  1. Read the value from the alias key (`decl.a`) when one is declared and present
 *     (the spec-correct location), falling back to the full name if a non-conforming
 *     file used it anyway.
 *  2. If neither is present and the declaration carries a default `v`, materialize it.
 *  3. Otherwise the attribute is genuinely absent and is omitted.
 *
 * Any keys present in the data but not covered by a declaration are passed through
 * unchanged. Presence is tested with `in` (not truthiness) so legitimate falsy
 * values and defaults (`false`, `0`, `""`) are preserved.
 */
export function normalizeAttributes(
  rawV: Record<string, unknown> | undefined,
  decls: AspectDeclarations
): Record<string, unknown> {
  const raw = rawV ?? {};
  const out: Record<string, unknown> = {};
  const declaredDataKeys = new Set<string>();

  for (const [fullName, decl] of Object.entries(decls)) {
    const aliasKey = decl.a;
    declaredDataKeys.add(fullName);
    if (aliasKey) {
      declaredDataKeys.add(aliasKey);
    }

    if (aliasKey && aliasKey in raw) {
      out[fullName] = raw[aliasKey];
    } else if (fullName in raw) {
      out[fullName] = raw[fullName];
    } else if ('v' in decl) {
      out[fullName] = decl.v;
    }
    // else: truly absent with no default -> omit
  }

  // Pass through any undeclared attributes verbatim.
  for (const [key, value] of Object.entries(raw)) {
    if (!declaredDataKeys.has(key) && !(key in out)) {
      out[key] = value;
    }
  }

  return out;
}
