import type { PriceCheckShortcutBinding } from "../../src/services/priceCheckShortcut";

interface GlobalShortcutRegistrar {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export function toElectronAccelerator(binding: PriceCheckShortcutBinding) {
  return [
    binding.ctrlKey ? "Control" : undefined,
    binding.altKey ? "Alt" : undefined,
    binding.metaKey ? "Super" : undefined,
    binding.shiftKey ? "Shift" : undefined,
    binding.key,
  ]
    .filter((part): part is string => Boolean(part))
    .join("+");
}

export class PriceCheckGlobalShortcut {
  private activeAccelerator: string | undefined;

  constructor(private readonly registrar: GlobalShortcutRegistrar) {}

  register(binding: PriceCheckShortcutBinding, callback: () => void) {
    const accelerator = toElectronAccelerator(binding);
    if (accelerator === this.activeAccelerator) {
      return true;
    }
    if (!this.registrar.register(accelerator, callback)) {
      return false;
    }
    if (this.activeAccelerator) {
      this.registrar.unregister(this.activeAccelerator);
    }
    this.activeAccelerator = accelerator;
    return true;
  }

  stop() {
    if (!this.activeAccelerator) {
      return;
    }
    this.registrar.unregister(this.activeAccelerator);
    this.activeAccelerator = undefined;
  }
}
