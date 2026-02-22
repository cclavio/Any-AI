import type { User } from "../session/User";
import type { DeviceCommand } from "../agent/device-commands";
import type { PhotoData } from "@mentra/sdk";
import { getDefaultSoundUrl } from "../constants/config";
import { isDbAvailable, db, photos } from "../db";
import { isStorageAvailable, buildStoragePath, uploadPhoto } from "../db/storage";

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
      case "check_schedule":
        return this.checkSchedule();
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
      console.log(`📸 [DEVICE-CMD] Photo captured for ${this.user.userId}: ${photo.requestId} (${photo.size} bytes)`);

      // Fire-and-forget: persist to Supabase Storage + DB
      this.persistPhoto(photo).catch((err) => {
        console.error(`📸 [DEVICE-CMD] Photo persist failed for ${this.user.userId}:`, err);
      });

      return "Photo saved";
    } catch (error) {
      console.error(`📸 [DEVICE-CMD] Photo capture failed for ${this.user.userId}:`, error);
      return "Photo capture failed";
    }
  }

  /**
   * Read today's calendar schedule from in-memory cache (no LLM call).
   */
  private checkSchedule(): string {
    return this.user.calendar.formatScheduleReadout();
  }

  /**
   * Persist a photo to Supabase Storage + insert metadata row.
   * Called fire-and-forget — errors are logged but don't block the voice response.
   */
  private async persistPhoto(photo: PhotoData): Promise<void> {
    if (!isStorageAvailable() || !isDbAvailable()) return;

    const userId = this.user.userId;
    const storagePath = buildStoragePath(userId, photo.requestId, photo.timestamp, photo.mimeType);

    await uploadPhoto(storagePath, photo.buffer, photo.mimeType);

    await db.insert(photos).values({
      userId,
      requestId: photo.requestId,
      storagePath,
      filename: photo.filename,
      mimeType: photo.mimeType,
      sizeBytes: photo.size,
      saved: true,
      capturedAt: photo.timestamp,
    });

    console.log(`📸 [DEVICE-CMD] Photo persisted: ${storagePath}`);
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
