const DEFAULT_SOUND = "/sounds/new-data.wav";

let notificationSound = null;

export function prepareNotificationSounds() {
  if (typeof window === "undefined") return;
  if (!notificationSound) {
    notificationSound = new Audio(DEFAULT_SOUND);
    notificationSound.preload = "auto";
  }
}

function playSoundFile() {
  if (!notificationSound || typeof window === "undefined") return;
  try {
    notificationSound.currentTime = 0;
    notificationSound.play().catch(() => {});
  } catch {
    // ignore
  }
}

/** Call inside a user gesture (e.g. login click) to satisfy autoplay policy */
export function unlockNotificationAudio() {
  prepareNotificationSounds();
  if (!notificationSound) return;

  const prevVolume = notificationSound.volume;
  notificationSound.volume = 0.01;
  notificationSound
    .play()
    .then(() => {
      notificationSound.pause();
      notificationSound.currentTime = 0;
      notificationSound.volume = prevVolume;
    })
    .catch(() => {
      notificationSound.volume = prevVolume;
    });
}

export function playNewUserSound() {
  prepareNotificationSounds();
  playSoundFile();
}

export function playNewDataSound() {
  prepareNotificationSounds();
  playSoundFile();
}

export function playNotificationSound() {
  prepareNotificationSounds();
  playSoundFile();
}

if (typeof window !== "undefined") {
  prepareNotificationSounds();
}
