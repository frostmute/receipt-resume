import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(site, f), "utf8");
const html = read("index.html"), js = read("script.js"), css = read("styles.css"), data = read("data.js"), plain = read("resume.html");

test("title, viewport, description and link preview", () => {
  assert.match(html, /<title>Jonathan J\. Wagner — Résumé, printed on demand<\/title>/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/);
  assert.match(html, /property="og:image" content="https:\/\/[^"]+\/og\.png"/);
  assert.ok(existsSync(join(site, "og.png")));
});

test("résumé content from the PDF is present", () => {
  for (const s of ["DataAnnotation.Tech".toUpperCase(), "CELEBRATEEXCELLENCE.COM", "210GEEKS.COM", "DEEPSPACEGHOST.COM", "INDEPENDENT OPEN-SOURCE DEVELOPER",
                   "MAESTRO COLLEGE", "CLIMBHIRE IT SUPPORT PROGRAM", "APPBREWERY", "ADOBE CERTIFIED PROFESSIONAL", "CASHIER: JONATHAN", "TERMS &amp;", "TEAR HERE FOR PDF",
                   "Google Data Centers", "Sheriff Javier Salazar", "Reduced average repair turnaround time"])
    assert.ok(html.includes(s), "missing: " + s);
  for (const r of ["make-it-rain", "claw2manus", "Tetromino", "antikythera-template", "moon-note"]) {
    assert.ok(data.includes('"name":"' + r + '"'), "project missing " + r);
    assert.ok(existsSync(join(site, "img", "p-" + r + ".png")) && existsSync(join(site, "img", "qr-" + r + ".svg")));
  }
});

test("contact: email, LinkedIn, GitHub and the netlify portfolio; no phone number anywhere", () => {
  assert.match(html, /mailto:jonathanjameswagner@proton\.me/);
  assert.match(html, /linkedin\.com\/in\/jonathanjwagner/);
  assert.match(html, /github\.com\/frostmute/);
  assert.match(html, /jonathanjwagner\.netlify\.app/);
  assert.ok(!/jjwagner\.vercel\.app/.test(html + plain), "old portfolio link must not appear as his portfolio");
  for (const f of ["index.html", "script.js", "data.js", "resume.html"]) {
    const t = read(f);
    assert.ok(!/\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/.test(t) && !/tel:/i.test(t), "phone number found in " + f);
  }
  const pdf = readFileSync(join(site, "resume.pdf"));
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});

test("live GitHub: client-side events and repos with a fallback", () => {
  assert.match(js, /api\.github\.com\/users\/frostmute\/events\/public/);
  assert.match(js, /api\.github\.com\/users\/frostmute\/repos/);
  assert.match(js, /OFFLINE COPY/);
  assert.match(js, /mailto\(/);
});

test("recruiter paths: skip, print-all, plain résumé, keyboard", () => {
  assert.match(html, /id="mode"/);
  assert.match(html, /data-act="all"/);
  assert.match(html, /href="resume\.html"/);
  assert.match(js, /instant = true/);
  assert.match(js, /ArrowRight/);
});

test("every local asset referenced exists; nothing loads from another origin", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1])
    .concat([...css.matchAll(/url\("([^"]+)"\)/g)].map(m => m[1]));
  for (const r of refs) {
    if (/^(https?:|mailto:)/.test(r)) continue;
    if (r === "./") continue;
    assert.ok(existsSync(join(site, r)), "missing asset " + r);
  }
  assert.ok(!/<script[^>]+src="https?:/.test(html), "no remote scripts");
  assert.ok(!/<link[^>]+href="https?:[^"]+\.css/.test(html), "no remote css");
  for (const p of JSON.parse(data.replace(/^[\s\S]*?window\.JW=/, "").replace(/;\s*$/, "")).projects)
    assert.ok(existsSync(join(site, p.img)) && existsSync(join(site, p.qr)));
});

test("no placeholders left", () => {
  for (const f of ["index.html", "script.js", "resume.html"]) assert.ok(!/lorem|ipsum|TODO|FIXME|\{\{/.test(read(f)), f);
});
