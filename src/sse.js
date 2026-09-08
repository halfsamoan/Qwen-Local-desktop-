/** @param {string} event */
function eventData(event) {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
}

/** @param {string} buffer @param {boolean} [flush] */
export function takeSseData(buffer, flush = false) {
  /** @type {string[]} */
  const events = [];
  let rest = buffer;
  let separator = /\r?\n\r?\n/.exec(rest);
  while (separator?.index !== undefined) {
    const data = eventData(rest.slice(0, separator.index));
    if (data) events.push(data);
    rest = rest.slice(separator.index + separator[0].length);
    separator = /\r?\n\r?\n/.exec(rest);
  }
  if (flush && rest.trim()) {
    const data = eventData(rest);
    if (data) events.push(data);
    rest = "";
  }
  return { events, rest };
}

/** @param {string} data */
export function parseChatDelta(data) {
  if (data === "[DONE]") return { done: true, text: "" };
  try {
    const payload = JSON.parse(data);
    return { done: false, text: payload.choices?.[0]?.delta?.content ?? "" };
  } catch {
    return null;
  }
}
