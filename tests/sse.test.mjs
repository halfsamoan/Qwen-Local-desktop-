import assert from "node:assert/strict";
import test from "node:test";
import { parseChatDelta, takeSseData } from "../src/sse.js";

test("handles chunk boundaries, CRLF, malformed data, DONE, and final unterminated event", () => {
  let buffer = 'data: {"choices":[{"delta":{"content":"Hel';
  let parsed = takeSseData(buffer);
  assert.deepEqual(parsed.events, []);

  buffer = parsed.rest + 'lo"}}]}\r\n\r\ndata: broken\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"!"}}]}';
  parsed = takeSseData(buffer, true);
  assert.deepEqual(parsed.events.length, 4);
  assert.deepEqual(parseChatDelta(parsed.events[0]), { done: false, text: "Hello" });
  assert.equal(parseChatDelta(parsed.events[1]), null);
  assert.deepEqual(parseChatDelta(parsed.events[2]), { done: true, text: "" });
  assert.deepEqual(parseChatDelta(parsed.events[3]), { done: false, text: "!" });
  assert.equal(parsed.rest, "");
});
