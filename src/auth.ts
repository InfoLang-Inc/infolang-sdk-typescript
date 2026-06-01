/**
 * Authentication providers for the InfoLang SDK.
 *
 * A provider returns the headers to attach to each request. `headers()` is
 * called before every request so providers can refresh short-lived tokens.
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { InfoLangConfigError } from "./errors.js";

export const DEFAULT_SESSION_PATH = join(homedir(), ".config", "infolang", "session.json");

export interface AuthProvider {
  headers(): Promise<Record<string, string>>;
}

/** Bearer authentication with an InfoLang API key (`il_live_...`). */
export class ApiKeyAuth implements AuthProvider {
  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new InfoLangConfigError("apiKey must not be empty");
  }

  async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}

/** Self-hosted dev key in `key:namespace` form (matches INFOLANG_API_KEYS). */
export class DevKeyAuth implements AuthProvider {
  readonly namespace: string;
  private readonly token: string;

  constructor(devKey: string) {
    const idx = devKey.indexOf(":");
    if (idx < 0) throw new InfoLangConfigError("dev key must be in 'key:namespace' form");
    this.token = devKey.slice(0, idx);
    this.namespace = devKey.slice(idx + 1);
  }

  async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${this.token}` };
  }
}

interface Session {
  access_token?: string;
  refresh_token?: string;
  token_url?: string;
  expires_at?: number;
  expires_in?: number;
  [key: string]: unknown;
}

/**
 * OAuth bearer token read from the cursor-setup session file (default
 * `~/.config/infolang/session.json`, written by `npx @infolang/cursor-setup`).
 * Refreshes transparently when the file carries a `refresh_token` + `token_url`.
 */
export class SessionFileAuth implements AuthProvider {
  private cache?: Session;

  constructor(private readonly path: string = DEFAULT_SESSION_PATH) {}

  private async load(): Promise<Session> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      throw new InfoLangConfigError(
        `session file not found at ${this.path}; run 'npx @infolang/cursor-setup'`,
      );
    }
    try {
      return JSON.parse(raw) as Session;
    } catch {
      throw new InfoLangConfigError(`session file at ${this.path} is not valid JSON`);
    }
  }

  async headers(): Promise<Record<string, string>> {
    let session = this.cache ?? (await this.load());
    if (this.isExpired(session)) session = await this.refresh(session);
    this.cache = session;
    if (!session.access_token) {
      throw new InfoLangConfigError("session file is missing 'access_token'");
    }
    return { Authorization: `Bearer ${session.access_token}` };
  }

  private isExpired(session: Session): boolean {
    if (typeof session.expires_at !== "number") return false;
    // Refresh 30s early to avoid races at the boundary.
    return Date.now() / 1000 >= session.expires_at - 30;
  }

  private async refresh(session: Session): Promise<Session> {
    if (!session.refresh_token || !session.token_url) return session;
    const resp = await fetch(session.token_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: session.refresh_token,
      }),
    });
    if (!resp.ok) return session;
    const data = (await resp.json()) as Session;
    const merged: Session = { ...session, ...data };
    if (typeof data.expires_in === "number") {
      merged.expires_at = Date.now() / 1000 + data.expires_in;
    }
    try {
      await writeFile(this.path, JSON.stringify(merged));
    } catch {
      // Best effort; refreshed token is still usable in memory.
    }
    return merged;
  }
}

/** Worker-to-origin shared secret. For internal integrators only. */
export class OriginAuth implements AuthProvider {
  constructor(
    private readonly workspace: string,
    private readonly secret: string,
  ) {}

  async headers(): Promise<Record<string, string>> {
    return {
      "X-InfoLang-Workspace": this.workspace,
      "X-InfoLang-Origin-Secret": this.secret,
    };
  }
}
