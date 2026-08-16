import SftpClient from "ssh2-sftp-client";

/**
 * Collecting price catalogs from a supplier's SFTP mailbox.
 *
 * Shaw writes a new 832 every time a price on the agreement changes and leaves
 * it in place, so the job here is: connect, see what's new since last time,
 * take only that, and never hold the connection open longer than it takes.
 */

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  /** Read from the env var named on the feed — never stored in the database. */
  password: string;
  remotePath: string | null;
}

export interface RemoteFile {
  name: string;
  size: number;
  modifiedAt: string | null;
  text: string;
}

/** Files worth reading. Anything else in the mailbox is left alone. */
function looksLikeCatalog(name: string): boolean {
  return /\.(832|edi|x12|txt|dat)$/i.test(name) || /^\d+$/.test(name);
}

/** Never drag down a whole mailbox in one run. */
export const MAX_FILES_PER_RUN = 10;
/** A price catalog is text; anything this big is not one. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface SftpFetch {
  files: RemoteFile[];
  /** Everything we saw, so an empty result can be explained. */
  seen: number;
  error: string | null;
  warnings: string[];
}

/**
 * Fetch catalogs we haven't taken before.
 *
 * `alreadyHave` is the set of file names already recorded against this feed —
 * the supplier does not delete what we have read, so without it every poll
 * would re-import the same prices.
 */
export async function fetchNewCatalogs(
  target: SftpTarget,
  alreadyHave: Set<string>,
): Promise<SftpFetch> {
  const warnings: string[] = [];
  if (!target.host) return { files: [], seen: 0, error: "No SFTP host is configured.", warnings };
  if (!target.username) return { files: [], seen: 0, error: "No SFTP username is configured.", warnings };
  if (!target.password) {
    return { files: [], seen: 0, error: "No password available — check the credential env var is set in this environment.", warnings };
  }

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: target.host,
      port: target.port || 22,
      username: target.username,
      password: target.password,
      readyTimeout: 20_000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      files: [],
      seen: 0,
      error: `Could not sign in to ${target.host}: ${msg}`,
      warnings,
    };
  }

  try {
    const dir = target.remotePath?.trim() || ".";
    const listing = await sftp.list(dir);
    const candidates = listing
      .filter((f) => f.type === "-" && looksLikeCatalog(f.name))
      // Oldest first: prices applied in the order the supplier issued them.
      .sort((a, b) => (a.modifyTime ?? 0) - (b.modifyTime ?? 0));

    const fresh = candidates.filter((f) => !alreadyHave.has(f.name));
    if (candidates.length && !fresh.length) {
      warnings.push(`Nothing new — all ${candidates.length} catalogs in ${dir} have been read before.`);
    }

    const take = fresh.slice(0, MAX_FILES_PER_RUN);
    if (fresh.length > take.length) {
      // Say so. A silent cap reads as "we're caught up" when we are not.
      warnings.push(
        `${fresh.length} new files are waiting; took the ${take.length} oldest this run. The rest come on the next poll.`,
      );
    }

    const files: RemoteFile[] = [];
    for (const f of take) {
      if (f.size > MAX_FILE_BYTES) {
        warnings.push(`Skipped ${f.name} — ${Math.round(f.size / 1e6)}MB is too large to be a price catalog.`);
        continue;
      }
      const buf = (await sftp.get(`${dir.replace(/\/+$/, "")}/${f.name}`)) as Buffer;
      files.push({
        name: f.name,
        size: f.size,
        modifiedAt: f.modifyTime ? new Date(f.modifyTime).toISOString() : null,
        text: buf.toString("utf8"),
      });
    }

    return { files, seen: candidates.length, error: null, warnings };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { files: [], seen: 0, error: `Signed in, but could not read the mailbox: ${msg}`, warnings };
  } finally {
    // Always hang up, including on the error paths above.
    try {
      await sftp.end();
    } catch {
      /* already gone */
    }
  }
}

/** Just prove the login works, and report what's in there. */
export async function probeSftp(
  target: SftpTarget,
): Promise<{ ok: boolean; message: string; names: string[] }> {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: target.host,
      port: target.port || 22,
      username: target.username,
      password: target.password,
      readyTimeout: 20_000,
    });
    const dir = target.remotePath?.trim() || ".";
    const listing = await sftp.list(dir);
    const names = listing.filter((f) => f.type === "-").map((f) => f.name);
    return {
      ok: true,
      message: names.length
        ? `Signed in. ${names.length} file${names.length === 1 ? "" : "s"} in ${dir}.`
        : `Signed in, but ${dir} is empty. Ask Shaw which directory the 832 is written to.`,
      names: names.slice(0, 25),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e), names: [] };
  } finally {
    try {
      await sftp.end();
    } catch {
      /* already gone */
    }
  }
}
