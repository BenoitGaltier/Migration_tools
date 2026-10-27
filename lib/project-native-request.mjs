import { request } from "node:http";

// Native migrations can wait on a Designer confirmation for more than fetch's
// five-minute response-header limit. Keep one request, never retry the command.
export async function projectNativeRequest(baseUrl, token, pathname, body, timeoutMs = 15 * 60_000) {
  const url = new URL(pathname, baseUrl);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password) throw new Error("Native project commands require the authenticated local Designer bridge.");
  const bytes = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": bytes.length
    } }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; if (text.length > 1_048_576) outgoing.destroy(new Error("Native response is too large.")); });
      response.on("error", reject);
      response.on("end", () => {
        let payload;
        try { payload = JSON.parse(text); } catch { reject(new Error("Designer returned an invalid native response. Inspect it before retrying.")); return; }
        if (response.statusCode < 200 || response.statusCode >= 300) reject(new Error(payload.error || `Designer command failed (HTTP ${response.statusCode})`));
        else resolve(payload);
      });
    });
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new Error("Native project command is still pending or disconnected. Inspect Designer before retrying; the command was not cancelled.")));
    outgoing.on("error", reject);
    outgoing.end(bytes);
  });
}
