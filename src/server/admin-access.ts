import type http from "node:http";
import { isLoopbackAddress } from "../util.js";

export const BILI_TUNNEL_HEADER = "x-bili-tunnel";

// #1537: reduce a Host-header value or a URL hostname to its bare lowercase
// name — strip a trailing :port and the [..] brackets around an IPv6 literal.
// Returns undefined for empty/unparseable input. The admin-origin gate uses it
// to match on the hostname alone (see isTrustedAdminOrigin).
function normalizeAdminHostname(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const v = value.trim().toLowerCase();
    if (!v) return undefined;
    if (v.startsWith("[")) {
        const end = v.indexOf("]");
        if (end === -1) return undefined;
        return v.slice(1, end);
    }
    // Bare IPv6 literal (no brackets): more than one colon means there is no
    // host:port split to perform — return it untouched.
    if ((v.match(/:/g) ?? []).length > 1) return v;
    const idx = v.lastIndexOf(":");
    if (idx !== -1) return v.slice(0, idx);
    return v;
}

function isTrustedAdminOrigin(origin: string | undefined, host: string | undefined, trustedHostnames: Set<string>): boolean {
    // Host must name one of OUR loopback identities regardless of whether an
    // Origin header is present. A same-origin browser GET/fetch (the DNS
    // rebinding read path: evil.com → 127.0.0.1) often carries NO Origin
    // header, so gating on Origin alone would leave config reads exposed.
    // #1537: match on the bare hostname and IGNORE the port — an SSH forward
    // (ssh -L 18787:127.0.0.1:8787) legitimately presents a different local
    // port while still arriving from loopback. The anti-rebinding property is
    // preserved because an attacker's rebound domain (evil.com) can never equal
    // a loopback NAME; only the port is relaxed.
    const hn = normalizeAdminHostname(host);
    if (!hn || !trustedHostnames.has(hn)) return false;
    if (!origin) return true; // non-browser client (curl, CLI UI) on a trusted Host
    try {
        const parsed = new URL(origin);
        // #3513 (desktop variant): the dsh desktop Electron app renders its
        // settings pane from the custom scheme origin dsh-app://app, not an
        // http origin. Browsers set the Origin header themselves — page
        // content cannot forge it — and the dsh-app scheme exists only inside
        // the dsh Electron app (a registered custom protocol), so a website
        // can never produce a request whose Origin is dsh-app://. Accepting
        // that exact origin (scheme dsh-app, hostname "app") admits the
        // desktop embed probe without weakening the anti-rebinding property:
        // rebinding attacks arrive with http/https attacker hostnames and
        // still fail the hostname check below. Any other custom scheme or a
        // different dsh-app hostname stays rejected.
        if (parsed.protocol === "dsh-app:") {
            return normalizeAdminHostname(parsed.hostname) === "app";
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
        const ohn = normalizeAdminHostname(parsed.hostname);
        return ohn !== undefined && trustedHostnames.has(ohn);
    } catch {
        return false;
    }
}

/** Check transport, Host and Origin before exposing local management data.
 * Also used by the startup-failure listener before server initialization. */
export function adminGateDenial(req: http.IncomingMessage, bindHost: string): string | undefined {
    if (req.headers[BILI_TUNNEL_HEADER] !== undefined) {
        return "management endpoints are not reachable through the bili tunnel";
    }
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
        return `management endpoints are loopback-only; access denied for ${req.socket.remoteAddress ?? "unknown"}`;
    }
    if (!isTrustedAdminOrigin(req.headers.origin, req.headers.host, adminTrustedHostnames(bindHost))) {
        return "management request origin does not match the local bili UI";
    }
    return undefined;
}

function adminTrustedHostnames(bindHost: string): Set<string> {
    const names = ["localhost", "127.0.0.1", "::1"];
    const bound = normalizeAdminHostname(bindHost);
    if (bound && bound !== "0.0.0.0" && bound !== "::" && !names.includes(bound)) {
        names.push(bound);
    }
    return new Set(names);
}
