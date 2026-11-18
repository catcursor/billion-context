import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore } from "../src/persist.ts";
import { UnifiedStore } from "../src/storage/store.ts";

const posixOnly = { skip: process.platform === "win32" };
const mode = (file: string): number => statSync(file).mode & 0o777;

test("upgrading protects the default session directory, preserving a configured parent", posixOnly, async () => {
    const root = mkdtempSync(join(tmpdir(), "bili-default-mode-"));
    const priorData = process.env.XDG_DATA_HOME;
    const priorDir = process.env.BILI_SESSIONS_DIR;
    try {
        process.env.XDG_DATA_HOME = root;
        delete process.env.BILI_SESSIONS_DIR;
        const sessions = join(root, "billion-context", "sessions");
        mkdirSync(sessions, { recursive: true });
        chmodSync(sessions, 0o755);
        const store = new SessionStore({ enabled: true, debounceMs: 5 });
        await store.flushAll();
        assert.equal(mode(sessions), 0o700);
        const shared = join(root, "custom");
        mkdirSync(shared);
        chmodSync(shared, 0o755);
        process.env.BILI_SESSIONS_DIR = shared;
        const custom = new SessionStore({ enabled: true, debounceMs: 5 });
        await custom.flushAll();
        assert.equal(mode(shared), 0o755);
    } finally {
        if (priorData === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = priorData;
        if (priorDir === undefined) delete process.env.BILI_SESSIONS_DIR;
        else process.env.BILI_SESSIONS_DIR = priorDir;
        rmSync(root, { recursive: true, force: true });
    }
});

test("fresh session database, live journals and backup are owner-only under umask 000", posixOnly, () => {
    const root = mkdtempSync(join(tmpdir(), "bili-sqlite-mode-"));
    const priorMask = process.umask(0);
    try {
        const folder = join(root, "sessions");
        const file = join(folder, "index.db");
        const store = UnifiedStore.open(file);
        try {
            assert.equal(mode(folder), 0o700);
            for (const suffix of ["", "-wal", "-shm"]) assert.equal(mode(file + suffix), 0o600, suffix || "index.db");
            const backup = join(root, "snapshot.db");
            assert.ok(store.backupInto(backup) > 0);
            assert.equal(mode(backup), 0o600);
            assert.throws(() => store.backupInto(backup), /already exists/);
        } finally {
            store.close();
        }
    } finally {
        process.umask(priorMask);
        rmSync(root, { recursive: true, force: true });
    }
});
