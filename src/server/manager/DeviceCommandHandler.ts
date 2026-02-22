import type { User } from "../session/User";
import type { DeviceCommand } from "../agent/device-commands";
import { getDefaultSoundUrl } from "../constants/config";

/**
 * DeviceCommandHandler — executes hardware device commands
 * (photo capture, etc.) bypassing the AI agent pipeline.
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
      await session.camera.requestPhoto({
        saveToGallery: true,
        size: "large",
      });
      return "Photo saved";
    } catch (error) {
      console.error(`Failed to capture photo for ${this.user.userId}:`, error);
      return "Photo capture failed";
    }
  }
}
