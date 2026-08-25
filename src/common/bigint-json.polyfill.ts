/**
 * JSON has no int64. Every money column is Postgres BIGINT tiyin, which
 * Prisma maps to JS BigInt — Express's res.json() calls JSON.stringify,
 * which throws on a raw BigInt. Serialize as a string at the API boundary
 * everywhere, once, instead of remembering it at every response
 * (api-spec §2, "Money"). Must be imported before anything touches Prisma.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};
