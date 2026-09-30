import { useEffect, useState } from "react";
import type { ProfileContent } from "applesauce-core/helpers/profile";
import { eventStore } from "@/services/nostr";

/** Subscribes to a user's profile in the EventStore, loading it from relays if missing */
export function useProfile(pubkey: string | undefined): ProfileContent | undefined {
  const [profile, setProfile] = useState<ProfileContent | undefined>(undefined);

  useEffect(() => {
    setProfile(undefined);
    if (!pubkey) return;
    const sub = eventStore.profile(pubkey).subscribe(setProfile);
    return () => sub.unsubscribe();
  }, [pubkey]);

  return profile;
}
