// Offline contract generation. Never boots Nest or accesses a database.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'openapi.json'), 'utf8'));
const controllers = new Map();
// Swagger loses nullable primitive types and omits validator constraints.
function enrich(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) { enrich(file); continue; }
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const cls of source.statements.filter(ts.isClassDeclaration)) {
      const schema = spec.components.schemas[cls.name?.text];
      if (!schema?.properties) continue;
      for (const property of cls.members.filter(ts.isPropertyDeclaration)) {
        const name = property.name.getText(source);
        const field = schema.properties[name];
        if (!field) continue;
        let type = property.type;
        if (type && ts.isUnionTypeNode(type)) {
          const nonNull = type.types.filter(t => !['null', 'undefined'].includes(t.getText(source)));
          if (nonNull.length < type.types.length) field.nullable = true;
          if (nonNull.length === 1) type = nonNull[0];
        }
        const primitive = type && ({ [ts.SyntaxKind.StringKeyword]: 'string', [ts.SyntaxKind.NumberKeyword]: 'number', [ts.SyntaxKind.BooleanKeyword]: 'boolean' })[type.kind];
        if (primitive) field.type = primitive;
        for (const d of ts.getDecorators(property) || []) {
          if (!ts.isCallExpression(d.expression)) continue;
          const call = d.expression, validator = call.expression.getText(source);
          const value = call.arguments[0];
          const number = value && Number(value.getText(source));
          const constraint = {Min: 'minimum', Max: 'maximum', MinLength: 'minLength', MaxLength: 'maxLength', ArrayMinSize: 'minItems', ArrayMaxSize: 'maxItems'}[validator];
          if (constraint && Number.isFinite(number)) field[constraint] = number;
          if (validator === 'IsInt') field.type = 'integer';
          if (validator === 'IsUUID') field.format = 'uuid';
          if (validator === 'IsEmail') field.format = 'email';
          if (validator === 'IsDateString') field.format = name.endsWith('At') ? 'date-time' : 'date';
          if (validator === 'Matches' && value && ts.isRegularExpressionLiteral(value)) {
            const literal = value.getText(source);
            field.pattern = literal.slice(1, literal.lastIndexOf('/'));
          }
        }
      }
    }
  }
}
enrich(path.join(root, 'src'));
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.controller.ts')) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const cls of source.statements.filter(ts.isClassDeclaration)) {
        const decorators = node => (ts.getDecorators(node) || []).map(d => d.expression).filter(ts.isCallExpression);
        const args = (node, name) => decorators(node).find(d => d.expression.getText(source) === name)?.arguments;
        const permissions = node => args(node, 'RequirePermissions')?.map(a => a.text);
        const classPermissions = permissions(cls) || [];
        for (const method of cls.members.filter(ts.isMethodDeclaration)) {
          const route = decorators(method).find(d => ['Get', 'Post', 'Put', 'Patch', 'Delete'].includes(d.expression.getText(source)));
          if (!route) continue;
          controllers.set(`${cls.name.text}_${method.name.getText(source)}`, {
            permissions: permissions(method) ?? classPermissions,
            public: !!args(method, 'Public') || !!args(cls, 'Public'),
          });
        }
      }
    }
  }
}
walk(path.join(root, 'src'));
function resolve(schema, seen = new Set()) {
  if (!schema) return {};
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    if (seen.has(name)) throw Error(`Recursive request schema: ${name}`);
    return resolve(spec.components.schemas[name], new Set([...seen, name]));
  }
  const result = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, resolve(v, seen)]));
  if (schema.items) result.items = resolve(schema.items, seen);
  for (const key of ['allOf', 'oneOf', 'anyOf']) if (schema[key]) result[key] = schema[key].map(s => resolve(s, seen));
  return result;
}
const operations = [], excluded = [];
for (const [fullPath, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const metadata = controllers.get(operation.operationId);
    if (!metadata) throw Error(`Missing controller metadata: ${operation.operationId}`);
    const route = fullPath.replace(/^\/api\/v1/, '');
    if (metadata.public || ['/auth/me', '/auth/bootstrap'].includes(route)) {
      excluded.push({ id: operation.operationId, reason: metadata.public ? 'Public/integration endpoint or dedicated login flow' : 'Session bootstrap' });
      continue;
    }
    const content = operation.requestBody?.content || {};
    const mime = Object.keys(content)[0];
    const parameters = (operation.parameters || []).map(p => ({ ...p, schema: resolve(p.schema) }));
    for (const match of route.matchAll(/\{([^}]+)\}/g)) {
      if (!parameters.some(p => p.in === 'path' && p.name === match[1])) parameters.push({ name: match[1], in: 'path', required: true, schema: { type: 'string' } });
    }
    if (route.startsWith('/reports/')) {
      const format = parameters.find(p => p.name === 'format');
      if (format) format.schema = { type: 'string', enum: ['json', 'xlsx', 'pdf'], default: 'json' };
    }
    if (route.endsWith('/receipt')) parameters.push({ name: 'format', in: 'query', schema: { type: 'string', enum: ['pdf', 'html'], default: 'pdf' } });
    if (route === '/imports/validate') parameters.find(p => p.name === 'entity').required = true;
    const body = mime ? resolve(content[mime].schema) : null;
    if (body && !body.properties && body.type !== 'array') throw Error(`Unusable request schema: ${operation.operationId}`);
    operations.push({
      id: operation.operationId, title: operation.summary || operation.operationId,
      group: operation.tags?.[0] || route.split('/')[1], path: route,
      method: method.toUpperCase(), permissions: metadata.permissions,
      parameters: parameters.filter(p => p.in !== 'header'), body, multipart: mime === 'multipart/form-data',
      idempotent: parameters.some(p => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key'),
      download: route.startsWith('/files/') && method === 'get' || route.startsWith('/imports/templates/') || route.endsWith('/receipt'),
    });
  }
}
const documentedIds = new Set(Object.values(spec.paths).flatMap(methods => Object.values(methods)).map(o => o.operationId));
for (const id of controllers.keys()) {
  if (!documentedIds.has(id)) throw Error('OpenAPI is stale; missing ' + id + '. Run npm run openapi first.');
}
const output = JSON.stringify({ operations, excluded }, null, 2) + '\n';
const destination = path.join(root, 'mobile/assets/api-contract.json');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output) {
    console.error('Mobile contract is stale. Run npm run mobile:contract.');
    process.exit(1);
  }
} else fs.writeFileSync(destination, output);
console.log(`${operations.length} mobile operations; ${excluded.length} dedicated/public endpoints accounted for.`);
