import PocketBase, { LocalAuthStore } from "pocketbase";

export const POCKETBASE_URL = String(
  import.meta.env.VITE_POCKETBASE_URL || "",
).replace(/\/$/u, "");
export const GUEST_COLLECTION = "guests";
const credentialKey = "pagevoice-guest-credentials-v1";
const authKey = `pagevoice-pocketbase-auth:${window.location.host}`;

export const pocketbase = POCKETBASE_URL
  ? new PocketBase(POCKETBASE_URL, new LocalAuthStore(authKey))
  : null;
let identityPromise = null;
const synced = new Map();
const pendingSaves = new Map();

function readCredentials() {
  try {
    const value = JSON.parse(localStorage.getItem(credentialKey) || "null");
    if (
      value &&
      typeof value.email === "string" &&
      typeof value.password === "string"
    )
      return value;
  } catch {
    // A damaged local guest key must not stop a new device library from opening.
  }
  return null;
}

function writeCredentials(value) {
  try {
    localStorage.setItem(credentialKey, JSON.stringify(value));
  } catch {
    throw new Error(
      "This browser cannot retain the private guest-library key.",
    );
  }
}

function makeCredentials() {
  const id = crypto.randomUUID().replaceAll("-", "");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const password = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { email: `guest-${id}@device.pagevoice.invalid`, password };
}

async function authenticateGuest() {
  if (!pocketbase) return null;
  const auth = pocketbase.collection(GUEST_COLLECTION);
  if (pocketbase.authStore.isValid) {
    try {
      const refreshed = await auth.authRefresh();
      return { token: refreshed.token, ownerId: refreshed.record.id };
    } catch (error) {
      if (![400, 401, 403, 404].includes(error.status)) throw error;
      pocketbase.authStore.clear();
    }
  }

  let credentials = readCredentials();
  if (credentials) {
    try {
      const loggedIn = await auth.authWithPassword(
        credentials.email,
        credentials.password,
      );
      return { token: loggedIn.token, ownerId: loggedIn.record.id };
    } catch (error) {
      if (![400, 401, 403, 404].includes(error.status)) throw error;
      localStorage.removeItem(credentialKey);
    }
  }

  credentials = makeCredentials();
  await auth.create({
    ...credentials,
    passwordConfirm: credentials.password,
    emailVisibility: false,
  });
  // Keep the recovery secret only in this browser profile. It is never shown,
  // sent to PageVoice, or used as a human account credential.
  writeCredentials(credentials);
  const loggedIn = await auth.authWithPassword(
    credentials.email,
    credentials.password,
  );
  return { token: loggedIn.token, ownerId: loggedIn.record.id };
}

export function ensureGuestIdentity() {
  if (!pocketbase) return Promise.resolve(null);
  if (!identityPromise) {
    identityPromise = authenticateGuest().finally(() => {
      identityPromise = null;
    });
  }
  return identityPromise;
}

function metadata(project) {
  return {
    title: String(project.title || "Untitled book").slice(0, 300),
    author: String(project.author || "").slice(0, 300),
    language: String(project.language || "en").slice(0, 8),
    status: String(project.status || "uploaded").slice(0, 32),
    format: String(project.format || "m4b").slice(0, 8),
    output_ready: Boolean(project.output),
    completed_sentences: Number(project.progress?.complete || 0),
    total_sentences: Number(project.progress?.total || 0),
    deleted: false,
    deleted_at: "",
  };
}

function signature(project) {
  const value = metadata(project);
  return JSON.stringify({
    id: project.id,
    title: value.title,
    author: value.author,
    language: value.language,
    status: value.status,
    format: value.format,
    output_ready: value.output_ready,
    total_sentences: value.total_sentences,
  });
}

async function getBookRecord(projectId) {
  try {
    return await pocketbase
      .collection("books")
      .getFirstListItem(`project_id = "${projectId}"`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export function saveBookMetadata(project) {
  if (!pocketbase || !project?.id) return Promise.resolve();
  const previous = pendingSaves.get(project.id) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const nextSignature = signature(project);
      if (synced.get(project.id) === nextSignature) return;
      const existing = await getBookRecord(project.id);
      const values = metadata(project);
      if (existing) {
        await pocketbase.collection("books").update(existing.id, values);
      } else {
        const owner = pocketbase.authStore.record?.id;
        if (!owner) throw new Error("The private guest library is not ready.");
        await pocketbase.collection("books").create({
          ...values,
          owner,
          project_id: project.id,
        });
      }
      synced.set(project.id, nextSignature);
    });
  pendingSaves.set(project.id, task);
  return task.finally(() => {
    if (pendingSaves.get(project.id) === task) pendingSaves.delete(project.id);
  });
}

export async function markBookDeleted(projectId) {
  if (!pocketbase) return;
  await pendingSaves.get(projectId)?.catch(() => {});
  const record = await getBookRecord(projectId);
  if (record)
    await pocketbase.collection("books").update(record.id, {
      deleted: true,
      deleted_at: new Date().toISOString(),
    });
  synced.delete(projectId);
}

export async function restoreBookMetadata(project) {
  if (!pocketbase) return;
  await pendingSaves.get(project.id)?.catch(() => {});
  const record = await getBookRecord(project.id);
  if (record)
    await pocketbase.collection("books").update(record.id, {
      deleted: false,
      deleted_at: "",
    });
  synced.delete(project.id);
  await saveBookMetadata(project);
}

export async function purgeBookMetadata(projectId) {
  if (!pocketbase) return;
  await pendingSaves.get(projectId)?.catch(() => {});
  const record = await getBookRecord(projectId);
  if (record) await pocketbase.collection("books").delete(record.id);
  synced.delete(projectId);
}

export async function purgeExpiredBookMetadata() {
  if (!pocketbase) return;
  const records = await pocketbase.collection("books").getFullList({
    filter: "deleted = true",
    fields: "id,project_id,deleted_at",
  });
  const expiry = Date.now() - 60_000;
  await Promise.all(
    records
      .filter((record) => Date.parse(record.deleted_at) < expiry)
      .map((record) => pocketbase.collection("books").delete(record.id)),
  );
}
