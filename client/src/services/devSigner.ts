import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { decode } from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

// Dev-only NIP-07 signer for browsers without a Nostr extension (e.g. iOS Simulator Safari).
// Uses VITE_DEV_NSEC if set; otherwise generates a throwaway key and keeps it in localStorage
// so the same identity survives reloads. Never loaded in production builds.
// Open the app with ?devpubkey=<npub or hex> to log in read-only as any account (signing throws).

const STORAGE_KEY = "dev_signer_sk";

function loadSecretKey(): Uint8Array {
  const nsec = import.meta.env.VITE_DEV_NSEC as string | undefined;
  if (nsec) {
    const decoded = decode(nsec);
    if (decoded.type !== "nsec") throw new Error("VITE_DEV_NSEC must be an nsec");
    return decoded.data;
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return hexToBytes(stored);

  const sk = generateSecretKey();
  localStorage.setItem(STORAGE_KEY, bytesToHex(sk));
  return sk;
}

function readOnlyPubkey(): string | undefined {
  const param = new URLSearchParams(location.search).get("devpubkey");
  if (!param) return undefined;
  if (/^[0-9a-f]{64}$/i.test(param)) return param.toLowerCase();
  const decoded = decode(param);
  if (decoded.type !== "npub") throw new Error("devpubkey must be an npub or hex pubkey");
  return decoded.data;
}

export function installDevSigner() {
  if (window.nostr) return;

  const readOnly = readOnlyPubkey();
  if (readOnly) {
    window.nostr = {
      async getPublicKey() {
        return readOnly;
      },
      async signEvent() {
        throw new Error("Dev signer is read-only (devpubkey)");
      },
    };
    console.info(`[dev-signer] read-only window.nostr installed for pubkey ${readOnly}`);
    return;
  }

  const sk = loadSecretKey();
  const pubkey = getPublicKey(sk);

  window.nostr = {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(event) {
      return finalizeEvent(event as any, sk) as unknown as Record<string, unknown>;
    },
  };

  console.info(`[dev-signer] window.nostr installed for pubkey ${pubkey}`);
}
