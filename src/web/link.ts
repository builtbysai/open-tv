import { effect, signal } from "@preact/signals";
import { Controller, type CommandBody } from "../remote/controller";
import { activeTv, activeTvId, forgetTv, pairedTvs, say } from "../remote/pairing";

// The phone keeps one live connection, to the TV it last used.
export const controller = signal<Controller | null>(null);

export function startLink(): () => void {
  return effect(() => {
    void pairedTvs.value;
    void activeTvId.value;
    const tv = activeTv();
    if (!tv) {
      controller.value = null;
      return;
    }
    const c = new Controller(tv);
    controller.value = c;
    void c.start();
    // The TV removed this phone: forget the pairing so the phone offers to pair again.
    const stopWatch = c.removed.subscribe((gone) => {
      if (gone) {
        forgetTv(tv.tvId);
        say(`${tv.name} removed this phone`);
      }
    });
    return () => {
      stopWatch();
      c.stop();
    };
  });
}

// Sends a command and tells the person only when it failed.
export async function tell(body: CommandBody): Promise<boolean> {
  const c = controller.value;
  if (!c) {
    say("Pair a TV first");
    return false;
  }
  const r = await c.send(body);
  if (!r.ok) say(r.error || "That did not work");
  return r.ok;
}
export function press(body: CommandBody) {
  controller.value?.press(body);
}
