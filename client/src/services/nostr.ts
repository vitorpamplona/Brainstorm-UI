import { nip19 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import { merge, mergeMap, type Subscription } from "rxjs";
import { EventStore } from "applesauce-core";
import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import { RelayPool } from "applesauce-relay";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  }
}

export interface NostrUser {
  pubkey: string;
  npub: string;
  /** Latest kind 0 / 10002 events seen for this user, used to seed the EventStore on reload */
  cachedEvents?: NostrEvent[];
}

// Relays that aggregate profiles (kind 0) and relay lists (kind 10002) for most users
const INDEXER_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
  "wss://relay.ditto.pub",
];

// Kinds kept in the session cache for the logged in user
const CACHED_KINDS = [kinds.Metadata, kinds.RelayList];

const eventStore = new EventStore({ verifyEvent });

// Cap how long an unresponsive relay can hold up a request (applesauce default is 10s)
const pool = new RelayPool({ eoseTimeout: 3000 });

// Events missing from the store are loaded from the pointer's relay hints first, then the indexers
const loader = createEventLoaderForStore(eventStore, pool, {
  bufferTime: 100,
  extraRelays: INDEXER_RELAYS,
});

let currentUser: NostrUser | null = null;
let userSubs: Subscription[] = [];

export function getCurrentUser(): NostrUser | null {
  if (currentUser) return currentUser;

  const stored = sessionStorage.getItem("nostr_user");
  if (stored) {
    try {
      setCurrentUser(JSON.parse(stored));
      return currentUser;
    } catch {
      return null;
    }
  }
  return null;
}

function saveCurrentUser() {
  if (currentUser) {
    sessionStorage.setItem("nostr_user", JSON.stringify(currentUser));
  } else {
    sessionStorage.removeItem("nostr_user");
  }
}

/**
 * Fetches the user's profile and relay list from the indexers, then fetches the profile
 * again from the user's own outbox relays (NIP-65). The store keeps whichever is newest.
 */
function refreshUserMetadata(pubkey: string) {
  return merge(
    loader({ kind: kinds.Metadata, pubkey, cache: false }),
    loader({ kind: kinds.RelayList, pubkey, cache: false }).pipe(
      mergeMap((relayList) =>
        loader({ kind: kinds.Metadata, pubkey, relays: getOutboxes(relayList), cache: false }),
      ),
    ),
  ).subscribe();
}

/** Keeps the session cache in sync with the newest cached-kind events in the store */
function cacheUserEvents(pubkey: string) {
  return merge(...CACHED_KINDS.map((kind) => eventStore.replaceable(kind, pubkey))).subscribe(() => {
    if (!currentUser || currentUser.pubkey !== pubkey) return;
    const cachedEvents = CACHED_KINDS.map((kind) => eventStore.getReplaceable(kind, pubkey)).filter(
      (event): event is NostrEvent => !!event,
    );
    currentUser = { ...currentUser, cachedEvents };
    saveCurrentUser();
  });
}

function setCurrentUser(user: NostrUser | null) {
  userSubs.forEach((sub) => sub.unsubscribe());
  userSubs = [];
  currentUser = user;
  saveCurrentUser();
  if (!user) return;

  // Seed the store from the session cache so the profile renders without a relay round trip
  for (const event of user.cachedEvents ?? []) {
    try {
      eventStore.add(event);
    } catch {}
  }

  userSubs.push(cacheUserEvents(user.pubkey), refreshUserMetadata(user.pubkey));
}

export async function connectNostr(): Promise<NostrUser> {
  if (!window.nostr) {
    throw new Error("No Nostr extension found. Please install a NIP-07 compatible extension like nos2x or Alby.");
  }

  let pubkey: string;
  try {
    pubkey = await window.nostr.getPublicKey();
  } catch {
    throw new Error("Permission denied. Please allow the Nostr extension to share your public key.");
  }

  if (!pubkey || typeof pubkey !== "string") {
    throw new Error("Invalid public key received from extension.");
  }

  const user: NostrUser = {
    pubkey,
    npub: nip19.npubEncode(pubkey),
  };

  // The profile loads in the background; pages read it with useProfile()
  setCurrentUser(user);
  return user;
}

export function logout() {
  setCurrentUser(null);
}

export { eventStore, pool };
