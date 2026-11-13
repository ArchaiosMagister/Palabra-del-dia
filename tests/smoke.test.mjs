import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const sites = [
  { name: "Bachillerato", dir: "", cache: "palabra-shell-bach-" },
  { name: "4.º ESO", dir: "4eso", cache: "palabra-shell-4eso-" },
];

const text = (dir, name) => fs.readFileSync(path.join(root, dir, name), "utf8");
const relative = (dir, name) => path.join(root, dir, name);
const hexLuminance = hex => {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return channels.reduce((sum, c, i) =>
    sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), 0);
};
const contrast = (a, b) => {
  const x = hexLuminance(a), y = hexLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const colors = (css, rule) => {
  const match = css.match(rule);
  assert.ok(match, "Color rule missing: " + rule);
  return match[1];
};

for (const site of sites) {
  test(site.name + ": scripts inline are valid JavaScript", () => {
    const html = text(site.dir, "index.html");
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).filter(Boolean);
    assert.equal(scripts.length, 2);
    scripts.forEach((source, index) => new vm.Script(source, { filename: site.name + "-inline-" + index }));
  });

  test(site.name + ": main functions and private panels remain present", () => {
    const html = text(site.dir, "index.html");
    for (const expected of [
      'id="tab-dictionary"', 'id="tab-ranking"', 'id="tab-personal"',
      'id="personal-rank-list"', 'id="teacher-admin"',
      'id="teacher-login-form"', 'autocomplete="current-password"',
      'id="teacher-visit-count"', 'id="student-accent-options"',
      'async function checkStudentLink()', 'async function loadEntryTeacherStats(',
      'function renderPersonalRanking()', 'async function vote(',
      'await checkStudentLink();',
      'claim-teacher-code', 'claim-student-code',
      'record_site_visit', 'site_visit_counters',
    ]) {
      assert.ok(html.includes(expected), "Missing required functionality: " + expected);
    }
    const usernameTag = html.match(/<input id="teacher-username"[^>]*>/)?.[0];
    assert.ok(usernameTag, "Missing username control");
    assert.ok(usernameTag.includes('autocomplete="off"'), "The username must not be prefilled");
    assert.ok(!/\\bvalue=/.test(usernameTag), "The username must start blank");
    assert.ok(html.includes('<form id="teacher-login-form" autocomplete="off">'));
    assert.ok(html.includes('if(username!=="MagisterArchaios")'), "Teacher identity must remain checked");
    assert.ok(!html.includes("SUPABASE_SERVICE_ROLE_KEY"), "Secret key must not be in the browser");
  });

  test(site.name + ": installable PWA uses a relative identity and scoped assets", () => {
    const html = text(site.dir, "index.html");
    const manifest = JSON.parse(text(site.dir, "manifest.webmanifest"));
    assert.equal(manifest.id, "./");
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");
    assert.equal(manifest.display, "standalone");
    assert.ok(html.includes('rel="manifest"'));
    assert.ok(html.includes('rel="apple-touch-icon"'));
    assert.ok(html.includes('serviceWorker.register("./sw.js"'));
    for (const icon of manifest.icons) {
      assert.ok(fs.existsSync(relative(site.dir, icon.src)), "Missing icon: " + icon.src);
    }
  });

  test(site.name + ": voluntary web updater and iOS icon instructions", () => {
    const html = text(site.dir, "index.html");
    assert.ok(html.includes('id="site-update"'), "Missing visible update button");
    assert.ok(html.includes('id="site-update-status"'), "Missing accessible update status");
    assert.ok(html.includes("async function updateSite()"), "Missing update handler");
    assert.ok(html.includes('navigator.serviceWorker.getRegistration("./")'), "Updates this PWA scope only");
    assert.ok(html.includes('registration.update()'), "Checks for service-worker updates");
    assert.ok(html.includes('cache: "no-store"'), "Checks the current HTML from network");
    assert.ok(html.includes('button.dataset.readyToReload = "true"'), "Reload requires a second click");
    assert.ok(html.includes("location.reload()"), "Manual reload available");
    assert.ok(html.includes("iOS no permite cambiar automáticamente"), "Honest iOS icon limitation");
    assert.ok(html.includes("conserva antes tu código o QR personal"), "Protect login recovery");
    assert.ok(!html.includes("navigator.serviceWorker.getRegistrations()"), "Do not affect other PWAs");
  });

  test(site.name + ": service worker is isolated and does not cache authenticated requests", () => {
    const js = text(site.dir, "sw.js");
    new vm.Script(js);
    const versionMatch = js.match(/const CACHE = "([^"]+)";/);
    assert.ok(versionMatch);
    assert.ok(versionMatch[1].startsWith(site.cache));
    assert.ok(js.includes('key.startsWith("' + site.cache + '")'));
    assert.ok(js.includes('req.mode === "navigate"'));
    assert.ok(js.includes('new URL(req.url).origin !== self.location.origin'));
    assert.ok(!js.includes("supabase.co"), "Never cache Supabase responses");
  });

  test(site.name + ": readable primary/secondary text in 12 light/dark accents", () => {
    const html = text(site.dir, "index.html");
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const base = colors(css, /:root\{[^}]*--paper2:(#[\da-fA-F]{6});/);
    const backdrop = colors(css, /:root\{--paper:(#[\da-fA-F]{6});/);
    const muted = colors(css, /:root\{[^}]*--muted:(#[\da-fA-F]{6});/);
    assert.ok(contrast(muted, base) >= 4.5, "Secondary text contrast on cards");
    assert.ok(contrast(muted, backdrop) >= 4.5, "Secondary text contrast on page");
    const palette = [...css.matchAll(/:root\[data-student-accent="([^"]+)"\]\{--red:(#[\da-fA-F]{6});--gold:(#[\da-fA-F]{6})\}/g)];
    assert.equal(palette.length, 12);
    const darkBase = colors(css, /:root\[data-theme="dark"\]\{[^}]*--paper2:(#[\da-fA-F]{6});/);
    for (const [, name, primary] of palette) {
      assert.ok(contrast(primary, base) >= 4.5, name + " light accent needs contrast");
      const dark = colors(css, new RegExp(':root\\[data-theme="dark"\\]\\[data-student-accent="' + name + '"\\]\\{--red:(#[\\da-fA-F]{6});'));
      assert.ok(contrast(dark, darkBase) >= 4.5, name + " dark accent needs contrast");
    }
    assert.ok(css.includes(".rank-score{text-align:right;color:var(--red)"), "Ranking scores must use readable color");
    assert.ok(css.includes(".preview-term{") && css.includes("color:var(--red)"));
    assert.ok(css.includes("--accent-wash:color-mix("));
  });
}

test("The two installed PWAs never evict each other's caches", () => {
  const bach = text("", "sw.js"), eso = text("4eso", "sw.js");
  const name = source => source.match(/const CACHE = "([^"]+)";/)[1];
  assert.notEqual(name(bach), name(eso));
  assert.ok(!name(eso).startsWith("palabra-shell-bach-"));
  assert.ok(!name(bach).startsWith("palabra-shell-4eso-"));
});
