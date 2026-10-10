import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../src/app/help/contact-card/route";
import { CONTACTS, HELP_CHECKED_ON, LOCAL_CENTER } from "../src/app/help/contacts";

test("offline contact file contains the published contacts, sources and freshness limits", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.match(response.headers.get("Content-Disposition") ?? "", /^attachment;/);
  const text = await response.text();
  for (const contact of CONTACTS) {
    assert.ok(text.includes(`${contact.name}: ${contact.number}`));
    assert.ok(text.includes(contact.detail));
    for (const source of contact.sources) assert.ok(text.includes(source.url));
  }
  assert.ok(text.includes(HELP_CHECKED_ON));
  assert.ok(text.includes(LOCAL_CENTER.body));
  assert.ok(text.includes("운영 방식은 바뀔 수"));
  assert.ok(text.includes("통신망이 필요"));
});
