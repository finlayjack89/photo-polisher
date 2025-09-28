// src/lib/image-orientation-utils.ts
import imageCompression from 'browser-image-compression';

export const correctImageOrientation = async (file: File): Promise<File> => {
  try {
    // This library automatically corrects orientation based on EXIF data.
    // We will set a high quality and keep the resolution to prevent any
    // unwanted compression during this essential normalization step.
    const options = {
      maxSizeMB: 50,
      useWebWorker: true,
      initialQuality: 1.0,    // Keep original quality
      alwaysKeepResolution: true // Do not resize the image
    };
    const correctedFile = await imageCompression(file, options);
    return correctedFile;
  } catch (error) {
    console.error('Error correcting image orientation:', error);
    return file; // Return original file if correction fails
  }
};
