import { useState } from "react";
import AccountSettings from "./AccountSettings";
import AccountSyncPanel from "./AccountSyncPanel";
import type { LocalProfile } from "./accountStore";
import type { AutomaticSyncController } from "./useAutomaticSync";

export default function AccountCenter({ automatic, onBusy }: {
  automatic: AutomaticSyncController;
  onBusy: (busy: boolean) => void;
}) {
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  return <>
    <AccountSettings onBusy={onBusy} onChange={setProfile} />
    {profile && profile.key !== "local" && <AccountSyncPanel profile={profile} automatic={automatic} onBusy={onBusy} />}
  </>;
}
