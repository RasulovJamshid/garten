-- Upgrade only the unmodified system administrator template.
-- Customized grants/scopes and intentional revocations remain unchanged.
-- The existing role_permission trigger invalidates permission caches.
WITH eligible AS (
  SELECT r.id FROM role r
  JOIN role_permission rp ON rp.role_id = r.id
  WHERE r.is_system AND r.code = 'administrator'
  GROUP BY r.id
  HAVING jsonb_object_agg(rp.permission_key, rp.scope) = '{"child:read":"all","child:create":"all","child:update":"all","child:status":"all","group:read":"all","group:manage":"all","guardian:read":"all","guardian:manage":"all","consent:read":"all","consent:manage":"all","user:manage":"all","role:manage":"all","settings:manage":"all","landing:manage":"all","landing:publish":"all","branch:manage":"all","holiday:manage":"all","announcement:manage":"all","notification:send":"all","notification_template:manage":"all","report:read":"all","dashboard:read":"all","file:read":"all","file:manage":"all"}'::jsonb
)
INSERT INTO role_permission(role_id, permission_key, scope)
SELECT eligible.id, additions.key, 'all'
FROM eligible CROSS JOIN (VALUES ('attendance:read'),('attendance:checkin'),('attendance:checkout'),('attendance:correct'),('pickup:read'),('pickup:manage'),('pickup:temporary'),('medical:alerts')) AS additions(key)
ON CONFLICT (role_id, permission_key) DO NOTHING;
