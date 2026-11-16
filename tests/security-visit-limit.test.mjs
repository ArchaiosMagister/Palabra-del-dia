import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const rate = read('database/site_visit_rate_limit_60_10m.sql');
const revoke = read('database/revoke_inactive_teacher_authorizations_20261116.sql');

test('El contador limita visitas por curso a 60 en una ventana móvil de 10 minutos', () => {
  assert.ok(rate.includes("CREATE SCHEMA app_private;"), 'Tabla privada no expuesta');
  assert.ok(rate.includes('REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;'));
  assert.ok(rate.includes("ALTER TABLE app_private.site_visit_rate_limits ENABLE ROW LEVEL SECURITY;"));
  assert.ok(rate.includes("SET search_path TO ''"), 'Ruta de búsqueda cerrada');
  assert.ok(rate.includes("WHERE course_id=p_course_id\n    FOR UPDATE;"), 'Bloqueo de fila por curso');
  assert.ok(rate.includes("clock_timestamp()"), 'Lectura del reloj después del bloqueo');
  assert.ok(rate.includes("interval '10 minutes'"));
  assert.ok(rate.includes("IF cardinality(v_recent) >= 60 THEN"));
  assert.ok(rate.includes('array_append(v_recent,v_now)'));
  assert.ok(rate.includes("GRANT EXECUTE ON FUNCTION public.record_site_visit(uuid)\n  TO anon, authenticated, service_role;"));
  assert.ok(!/\b(?:ip_address|user_agent|visitor_id|session_id|email)\b/i.test(rate));
  assert.ok(!/\b(?:TRUNCATE TABLE|DELETE FROM public\.site_visit_counters)\b/i.test(rate));
});

test('Revocar solo autorizaciones sin sesión y cancelar en caso de variación', () => {
  assert.ok(revoke.includes('LOCK TABLE auth.sessions IN SHARE MODE;'));
  assert.ok(revoke.includes('v_total<>30 OR v_with_session<>13 OR v_without_session<>17'));
  assert.ok(revoke.includes('NOT EXISTS (\n      SELECT 1 FROM auth.sessions s WHERE s.user_id=t.auth_user_id'));
  assert.ok(revoke.includes('IF v_removed<>17 THEN'));
  assert.ok(revoke.includes('DELETE FROM public.teacher_admins t'));
  assert.ok(!/\bDELETE\s+FROM\s+auth\.(?:users|sessions)\b/i.test(revoke));
});

test('Ambas webs conservan la llamada de visitas original', () => {
  for (const page of ['index.html', '4eso/index.html']) {
    const html = read(page);
    assert.ok(html.includes('client.rpc("record_site_visit",{p_course_id:SITE_COURSE_ID})'), page);
    assert.ok(html.includes('sessionStorage.getItem(key)'), page);
  }
});
