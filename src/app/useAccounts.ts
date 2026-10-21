import { useEffect, useRef, useState } from "react";
import { accountProvider } from "../providers/accounts";
import type { EpisodicProvider } from "../providers/contracts";
import { friendlyError } from "../domain/errors";
import {
  forgetAccount,
  loadSavedAccounts,
  saveAccount,
} from "../persistence/saved-accounts";
import type { AccountDraft } from "../transfer/bundle";
type Connect = (
  provider: EpisodicProvider,
  signal: AbortSignal,
) => Promise<number>;
// Remembered Xtream accounts reconnect when the app opens. Credentials are stored only
// for accounts the user chose to remember on this device.
export function useAccounts(
  connectAccount: Connect,
  setNotice: (message: string) => void,
) {
  const [saved, setSaved] = useState(loadSavedAccounts);
  const connect = useRef(connectAccount);
  connect.current = connectAccount;
  const connectDraft = async (account: AccountDraft) => {
    try {
      const count = await connect.current(
        accountProvider(account),
        AbortSignal.timeout(30000),
      );
      return count;
    } catch (error) {
      setNotice(friendlyError(error));
      return 0;
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    for (const account of loadSavedAccounts())
      void connect
        .current(
          accountProvider(account),
          AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        )
        .catch(() => {
          /* The source list shows the error; sign in again to retry. */
        });
    return () => controller.abort();
  }, []);
  return {
    saved,
    connect: connectDraft,
    save: (account: AccountDraft) => setSaved(saveAccount(account)),
    forget: (account: AccountDraft) => setSaved(forgetAccount(account)),
  };
}
