import type { User } from "../session/User";
import type { DeviceCommand } from "../agent/device-commands";
import { getDefaultSoundUrl } from "../constants/config";

/**
 * DeviceCommandHandler — executes hardware device commands
 * (photo capture, battery check, etc.) bypassing the AI agent pipeline.
 */
export class DeviceCommandHandler {
  constructor(private user: User) {}

  /**
   * Execute a device command. Returns a spoken confirmation message.
   */
  async execute(command: DeviceCommand): Promise<string> {
    switch (command.type) {
      case "take_photo":
        return this.takePhoto();
      case "check_battery":
        return this.checkBattery();
    }
  }

  /**
   * Capture a photo and save it to the device camera roll.
   */
  private async takePhoto(): Promise<string> {
    const session = this.user.appSession;
    if (!session) {
      return "No glasses connected";
    }

    // Play shutter sound for audio feedback
    const shutterUrl = getDefaultSoundUrl("shutter.mp3");
    if (shutterUrl) {
      session.audio.playAudio({ audioUrl: shutterUrl }).catch(() => {});
    }

    try {
      console.log(`📸 [DEVICE-CMD] Requesting photo with saveToGallery=true for ${this.user.userId}`);
      const photo = await session.camera.requestPhoto({
        saveToGallery: true,
        size: "large",
      });
      // Log the full response to diagnose whether saveToGallery is acknowledged
      console.log(`📸 [DEVICE-CMD] Photo response for ${this.user.userId}:`, {
        requestId: photo.requestId,
        size: photo.size,
        mimeType: photo.mimeType,
        filename: photo.filename,
        // Check if the SDK passes savedToGallery through (not in PhotoData type, but may exist at runtime)
        savedToGallery: (photo as any).savedToGallery,
        allKeys: Object.keys(photo),
      });
      return "Photo saved";
    } catch (error) {
      console.error(`📸 [DEVICE-CMD] Photo capture failed for ${this.user.userId}:`, error);
      return "Photo capture failed";
    }
  }

  /**
   * Read glasses battery level from device state.
   */
  private async checkBattery(): Promise<string> {
    const session = this.user.appSession;
    if (!session) {
      return "No glasses connected";
    }

    const level = session.device.state.batteryLevel.value;
    const charging = session.device.state.charging.value;

    if (level === null || level === undefined) {
      return "Battery level is not available right now";
    }

    const chargingStr = charging ? " and charging" : "";
    return `Battery is at ${level} percent${chargingStr}`;
  }
}
