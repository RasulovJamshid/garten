import ts from 'typescript';

/** Infer response contracts from actual controller return types, including Prisma selects. */
export function responseContracts() {
  const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, '.');
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const contracts: Record<string, any> = {};
  const decorators = (node: ts.Node) =>
    ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
  const calls = (node: ts.Node) =>
    decorators(node)
      .map((d) => d.expression)
      .filter(ts.isCallExpression);
  const name = (call: ts.CallExpression) => call.expression.getText();
  function schema(input: ts.Type, depth = 0, seen = new Set<ts.Type>()): any {
    const type = checker.getAwaitedType(input) ?? input;
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
      return { description: 'Dynamic JSON value; see endpoint description.' };
    if (type.flags & ts.TypeFlags.StringLike)
      return { type: 'string', ...(type.isStringLiteral() ? { enum: [type.value] } : {}) };
    if (type.flags & ts.TypeFlags.NumberLike)
      return { type: 'number', ...(type.isNumberLiteral() ? { enum: [type.value] } : {}) };
    if (type.flags & ts.TypeFlags.BigIntLike)
      return {
        type: 'string',
        pattern: '^-?[0-9]+$',
        description: 'Integer serialized as a decimal string; monetary values are tiyin.',
      };
    if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
    if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never)) return null;
    if (type.flags & ts.TypeFlags.Null) return { nullable: true };
    if (type.isUnion()) {
      const nullable = type.types.some((t) => !!(t.flags & ts.TypeFlags.Null));
      const options = type.types
        .filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)))
        .map((t) => schema(t, depth, seen))
        .filter(Boolean);
      const distinct = [...new Map(options.map((o) => [JSON.stringify(o), o])).values()];
      if (distinct.length === 1) return { ...distinct[0], ...(nullable ? { nullable: true } : {}) };
      if (distinct.every((o) => o.type === 'string' && o.enum))
        return {
          type: 'string',
          enum: distinct.flatMap((o) => o.enum),
          ...(nullable ? { nullable: true } : {}),
        };
      return { oneOf: distinct, ...(nullable ? { nullable: true } : {}) };
    }
    if (type.getSymbol()?.getName() === 'Date') return { type: 'string', format: 'date-time' };
    if (checker.isArrayType(type) || checker.isTupleType(type))
      return {
        type: 'array',
        items:
          schema(checker.getIndexTypeOfType(type, ts.IndexKind.Number)!, depth + 1, seen) ?? {},
      };
    if (depth > 12 || seen.has(type)) return { type: 'object', additionalProperties: true };
    const next = new Set(seen).add(type);
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const property of checker.getPropertiesOfType(type)) {
      if (property.flags & ts.SymbolFlags.Method) continue;
      const at =
        property.valueDeclaration ?? property.declarations?.[0] ?? program.getSourceFiles()[0];
      if (!at) continue;
      const value = checker.getTypeOfSymbolAtLocation(property, at);
      const definition = schema(value, depth + 1, next);
      if (!definition) continue;
      properties[property.name] = definition;
      if (
        !(property.flags & ts.SymbolFlags.Optional) &&
        !(value.isUnion() && value.types.some((t) => !!(t.flags & ts.TypeFlags.Undefined)))
      )
        required.push(property.name);
    }
    const index = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      ...(index ? { additionalProperties: schema(index, depth + 1, next) ?? {} } : {}),
    };
  }
  for (const source of program
    .getSourceFiles()
    .filter((f) => f.fileName.endsWith('.controller.ts'))) {
    for (const declaration of source.statements.filter(ts.isClassDeclaration)) {
      let publicPageSchema: any;
      if (declaration.name?.text === 'PublicLandingController') {
        const helper = declaration.members.find(
          (member) => ts.isMethodDeclaration(member) && member.name.getText() === 'respondWithPage',
        );
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'json' &&
            node.arguments[0]
          )
            publicPageSchema = schema(checker.getTypeAtLocation(node.arguments[0]));
          ts.forEachChild(node, visit);
        };
        if (helper) visit(helper);
      }
      for (const method of declaration.members.filter(ts.isMethodDeclaration)) {
        const route = calls(method).find((c) =>
          ['Get', 'Post', 'Put', 'Patch', 'Delete'].includes(name(c)),
        );
        if (!route) continue;
        const signature = checker.getSignatureFromDeclaration(method)!;
        const status = calls(method).find((c) => name(c) === 'HttpCode');
        contracts[`${declaration.name!.text}_${method.name.getText()}`] = {
          public: [...calls(declaration), ...calls(method)].some((call) => name(call) === 'Public'),
          status: status
            ? Number(status.arguments[0].getText())
            : name(route) === 'Post'
              ? 201
              : 200,
          schema:
            publicPageSchema && ['page', 'defaultPage'].includes(method.name.getText())
              ? publicPageSchema
              : schema(checker.getReturnTypeOfSignature(signature)),
          query: Object.fromEntries(
            method.parameters.flatMap((parameter) => {
              const query = calls(parameter).find((c) => name(c) === 'Query');
              return query?.arguments[0] && ts.isStringLiteral(query.arguments[0])
                ? [
                    [
                      query.arguments[0].text,
                      !parameter.questionToken &&
                        !parameter.initializer &&
                        !(checker.getTypeAtLocation(parameter) as ts.UnionType).types?.some(
                          (t) => !!(t.flags & ts.TypeFlags.Undefined),
                        ),
                    ],
                  ]
                : [];
            }),
          ),
        };
      }
    }
  }
  return contracts;
}
